import { seo } from "@/lib/seo";
import { createFileRoute, Link } from "@tanstack/react-router";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

export const Route = createFileRoute("/suscripcion/cancelada")({
  head: () => seo({ title: "Suscripción cancelada · Medellín Social", description: "Tu pago fue cancelado.", noindex: true }),
  validateSearch: (s: Record<string, unknown>) => ({
    plan: (s.plan as string) ?? "",
  }),
  component: CanceladaPage,
});

function CanceladaPage() {
  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#FAF8F3", padding: 20,
    }}>
      <div style={{ maxWidth: 440, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>💳</div>
        <h1 style={{ fontFamily: K.serif, fontSize: "1.8rem", fontWeight: 900, color: K.ink, marginBottom: 12 }}>
          No se realizó ningún cargo
        </h1>
        <p style={{ color: K.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 32 }}>
          Cancelaste el proceso de pago. Tu plan actual no cambió.
          Puedes intentarlo de nuevo cuando quieras.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link
            to="/planes"
            style={{
              background: K.teal, color: "#fff",
              padding: "12px 24px", borderRadius: 8,
              fontWeight: 700, fontSize: 14, textDecoration: "none",
              display: "block",
            }}
          >
            Volver a los planes →
          </Link>
          <Link
            to="/"
            style={{ fontSize: 13, color: K.muted, textDecoration: "none" }}
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
