const TOKEN_KEY = "medellin-social.token";
const SESSION_MARKER_KEY = "medellin-social.session";

/** VITE_AUTH_COOKIE_MODE=1 (with AUTH_COOKIE_MODE=1 on the API, served from the same
 *  site): the JWT lives only in an HttpOnly cookie that scripts cannot read; the
 *  browser keeps just a "logged in" marker. Default: Bearer token in localStorage. */
export const COOKIE_MODE = import.meta.env.VITE_AUTH_COOKIE_MODE === "1";
const COOKIE_SESSION = "cookie-session";

/** Logged-in check / Bearer value. In cookie mode returns a marker, never the JWT. */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  if (COOKIE_MODE) return localStorage.getItem(SESSION_MARKER_KEY) ? COOKIE_SESSION : null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string): void {
  if (typeof window === "undefined") return;
  if (COOKIE_MODE) {
    localStorage.setItem(SESSION_MARKER_KEY, "1");
    localStorage.removeItem(TOKEN_KEY); // never keep a readable copy
    return;
  }
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_MARKER_KEY);
}

/** Auth for a hand-written fetch(): spread into headers and pass `credentials`. */
export function authHeaders(): Record<string, string> {
  if (COOKIE_MODE) return { "X-Requested-With": "fetch" };
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
export const authCredentials: RequestCredentials | undefined = COOKIE_MODE ? "include" : undefined;

type FetchOptions = RequestInit & { skipAuth?: boolean };

export async function apiFetch<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { skipAuth, ...init } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  const token = getToken();
  if (!skipAuth) Object.assign(headers, authHeaders());

  const res = await fetch(url, { ...init, headers, credentials: init.credentials ?? authCredentials });

  if (res.status === 401) {
    clearToken();
    // Only bounce to /login when a session actually expired (a token was sent).
    // The MLS is public — anonymous users on public pages must not be redirected.
    if (typeof window !== "undefined" && token) {
      window.location.href = "/login";
    }
    throw new Error("Sesión expirada. Por favor inicia sesión nuevamente.");
  }

  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const err = await res.json();
      msg = (err as { detail?: string; message?: string }).detail ?? (err as { message?: string }).message ?? msg;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
