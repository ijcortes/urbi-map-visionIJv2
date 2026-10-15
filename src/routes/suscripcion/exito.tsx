import { seo } from "@/lib/seo";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { auth } from "@/lib/auth";
import { getToken } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

export const Route = createFileRoute("/suscripcion/exito")({
  head: () => seo({ title: "Suscripción activa · Medellín Social", description: "Tu suscripción quedó activa.", noindex: true }),
  validateSearch: (s: Record<string, unknown>) => ({
    plan: (s.plan as string) ?? "",
  }),
  component: ExitoPage,
});

function ExitoPage() {
  const { plan } = Route.useSearch();
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) { setSynced(true); return; }

    // Refresh user plan in localStorage from DB
    fetch(API_ENDPOINTS.suscripcionesMiPlan, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plan && data.plan !== "free") {
          auth.patch({ plan: data.plan as "pro" | "agente" });
          window.dispatchEvent(new Event("medellin-social:user"));
        }
      })
      .catch(() => {})
      .finally(() => setSynced(true));
  }, []);

  const planNombre = plan === "agente" ? "MLS Agente" : plan === "pro" ? "MLS Pro" : "MLS";

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#FAF8F3", padding: 20,
    }}>
      <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <h1 style={{ fontFamily: K.serif, fontSize: "2rem", fontWeight: 900, color: K.ink, marginBottom: 12 }}>
          ¡Bienvenido a {planNombre}!
        </h1>
        <p style={{ color: K.muted, fontSize: 15, lineHeight: 1.7, marginBottom: 32 }}>
          Tu suscripción está activa. Ahora tienes acceso completo al análisis profesional del mercado.
          Recibirás un email de confirmación en los próximos minutos.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link
            to="/map"
            style={{
              background: K.teal, color: "#fff",
              padding: "13px 24px", borderRadius: 8,
              fontWeight: 700, fontSize: 14, textDecoration: "none",
              display: "block",
            }}
          >
            Ir al MLS Pro →
          </Link>
          {plan === "agente" && (
            <Link
              to="/publicar"
              style={{
                background: K.tealLight, color: K.tealDeep,
                padding: "11px 24px", borderRadius: 8,
                fontWeight: 700, fontSize: 13, textDecoration: "none",
                display: "block",
              }}
            >
              Publicar mi primera propiedad
            </Link>
          )}
          <Link
            to="/planes"
            style={{ fontSize: 13, color: K.muted, textDecoration: "none" }}
          >
            Ver detalles de mi plan
          </Link>
        </div>

        {!synced && (
          <p style={{ fontSize: 12, color: K.muted, marginTop: 20 }}>
            Activando plan…
          </p>
        )}
      </div>
    </div>
  );
}
