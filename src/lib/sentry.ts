// Sentry, loaded lazily so @sentry/react stays out of the initial bundle, and fully inert
// when VITE_SENTRY_DSN is unset (local dev, preview builds).
const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

type SentryModule = typeof import("@sentry/react");
let mod: SentryModule | null = null;
const queue: unknown[] = [];

/** Strip tokens / emails / query strings before an event leaves the browser. */
function scrubUrl(u?: string): string | undefined {
  if (!u) return u;
  try {
    const x = new URL(u, "http://x");
    return u.startsWith("http") ? `${x.origin}${x.pathname}` : x.pathname;
  } catch {
    return u.split("?")[0];
  }
}

export function initSentry(): void {
  if (!DSN || typeof window === "undefined") return;
  void import("@sentry/react")
    .then((S) => {
      S.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_BUILD_ID as string | undefined,
        sendDefaultPii: false,
        tracesSampleRate: 0.05,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications.",
          /Failed to fetch dynamically imported module/,
          /Importing a module script failed/,
          /Load failed/,
          /NetworkError when attempting to fetch resource/,
        ],
        beforeSend(event) {
          if (event.user) event.user = { id: event.user.id };
          if (event.request) {
            event.request.url = scrubUrl(event.request.url);
            delete event.request.cookies;
            delete event.request.query_string;
            if (event.request.headers) {
              delete (event.request.headers as Record<string, string>).Cookie;
              delete (event.request.headers as Record<string, string>).Authorization;
            }
          }
          return event;
        },
        beforeBreadcrumb(b) {
          if (b.data && typeof b.data.url === "string") b.data.url = scrubUrl(b.data.url);
          if (b.category === "ui.input") return null; // never keep typed text
          return b;
        },
      });
      mod = S;
      queue.splice(0).forEach((e) => S.captureException(e));
    })
    .catch(() => {});
}

export function captureError(e: unknown): void {
  if (!DSN) return;
  if (mod) mod.captureException(e);
  else if (queue.length < 20) queue.push(e);
}
