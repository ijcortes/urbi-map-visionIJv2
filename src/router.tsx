import { useEffect } from "react";
import { createRouter, useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "@/lib/icons";
import { routeTree } from "./routeTree.gen";
import { captureError } from "@/lib/sentry";

const STALE_CHUNK_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // A lazy chunk that 404s after a deploy: reload once to get the new build instead of a dead end.
    if (STALE_CHUNK_RE.test(error?.message ?? "")) {
      try {
        const k = "ms.chunkReloadAt";
        if (Date.now() - Number(sessionStorage.getItem(k) || 0) > 60_000) {
          sessionStorage.setItem(k, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch { /* storage blocked */ }
    }
    captureError(error);
  }, [error]);

  return (
    <div className="paper-theme grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <AlertTriangle className="h-6 w-6 text-danger" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Algo salió mal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ocurrió un error inesperado. Intenta de nuevo.
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-danger">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Intentar de nuevo
          </button>
          <a
            href="/"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
