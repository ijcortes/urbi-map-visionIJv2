import { K } from "@/design/tokens";

export function RoutePending() {
  return (
    <div role="status" aria-live="polite" data-testid="route-pending"
      style={{ minHeight: "60dvh", display: "flex", alignItems: "center", justifyContent: "center", color: K.muted, fontSize: 14 }}>
      Cargando…
    </div>
  );
}

export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const msg = error instanceof Error ? error.message : "";
  return (
    <div role="alert" data-testid="route-error"
      style={{ minHeight: "60dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
      <p style={{ fontWeight: 700, color: K.ink }}>Algo salió mal</p>
      {msg ? <p data-i18n-skip style={{ fontSize: 12, color: K.muted, maxWidth: 420 }}>{msg}</p> : null}
      <button type="button" onClick={() => (reset ? reset() : window.location.reload())}
        style={{ minHeight: 44, padding: "0 20px", borderRadius: 10, border: "none", background: K.teal, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
        Reintentar
      </button>
    </div>
  );
}
