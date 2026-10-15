import { seo } from "@/lib/seo";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { PLAN_PRICES } from "@/config/ghl";
import { PlanCta } from "@/components/PlanCta";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

const FEATURES = [
  "CRM integrado",
  "Calendar Automation",
  "2-Way Text & Email",
  "Social Messaging Integration",
  "Google Business Messaging & Call Tracking",
  "Reputation Management",
  "Web Chat Tool",
];

const FAQ = [
  {
    q: "¿Qué incluye el setup fee de $150?",
    a: "Configuración inicial del teléfono dedicado, integración WhatsApp y conexión al CRM. Pago único — no se repite.",
  },
  {
    q: "¿Puedo subir a Featured Realtor después?",
    a: "Sí, en cualquier momento. Solo se cobra la diferencia de setup ($49) al hacer el upgrade.",
  },
  {
    q: "¿Cuánto dura el precio especial $149?",
    a: "Es precio de lanzamiento por tiempo limitado. Al suscribirte ahora, mantienes ese precio mientras tu plan esté activo.",
  },
];

export const Route = createFileRoute("/planes_/listing-member")({
  head: () => seo({ title: "Listing Member · Medellín Social", description: "Publica tus inmuebles con visibilidad prioritaria en el mapa de Medellín Social.", path: "/planes/listing-member" }),
  component: ListingMemberPage,
});

function ListingMemberPage() {
  const user = typeof window !== "undefined" ? auth.get() : null;
  const email: Record<string, string> = user?.email ? { email: user.email } : {};

  return (
    <ComunidadLayout>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${K.tealDeep} 0%, ${K.tealMid} 60%, ${K.teal} 100%)`,
        padding: "56px 20px 48px", textAlign: "center",
      }}>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>
          Para Agentes Inmobiliarios
        </p>
        <h1 style={{ fontFamily: K.serif, fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 900, color: "#fff", marginBottom: 12, lineHeight: 1.1 }}>
          Listing Member
        </h1>
        <p style={{ color: "rgba(255,255,255,0.78)", fontSize: 15, maxWidth: 440, margin: "0 auto 32px", lineHeight: 1.65 }}>
          CRM + comunicaciones base para agentes que están arrancando en Medellín Social.
        </p>
        <div style={{ display: "inline-block", background: "rgba(255,255,255,0.12)", borderRadius: 14, padding: "20px 36px" }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textDecoration: "line-through", marginBottom: 2 }}>{PLAN_PRICES.listing_member!.regular} precio regular</p>
          <p style={{ fontFamily: K.serif, fontSize: "3rem", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.04em" }}>
            {PLAN_PRICES.listing_member!.special}<span style={{ fontSize: "1.1rem", fontWeight: 400 }}>/mo</span>
          </p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>precio especial · + {PLAN_PRICES.listing_member!.setup} setup fee</p>
        </div>
      </div>

      <div style={{ background: K.paper }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px 72px" }}>

          <PlanCta plan="listing_member" planLabel="Listing Member" label="Comenzar como Listing Member →" params={email} />

          {/* Features */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.3rem", fontWeight: 800, color: K.ink, marginBottom: 20 }}>
            Todo lo que incluye
          </h2>
          <div style={{ background: "#fff", border: `1px solid ${K.line}`, borderRadius: 14, padding: "8px 0", marginBottom: 48 }}>
            {FEATURES.map((f, i) => (
              <div key={f} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "13px 20px",
                borderBottom: i < FEATURES.length - 1 ? `1px solid ${K.line}` : "none",
              }}>
                <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "#E7F4EC", color: K.teal, fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                <span style={{ fontSize: 14, color: K.ink }}>{f}</span>
              </div>
            ))}
          </div>

          {/* Upgrade callout */}
          <div style={{ background: K.tealLight, border: `1px solid ${K.teal}40`, borderRadius: 12, padding: "18px 20px", marginBottom: 48, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: K.tealDeep, marginBottom: 2 }}>¿Necesitas más? Featured Realtor incluye web site + AI + marketing.</p>
              <p style={{ fontSize: 12, color: K.muted }}>Upgrade en cualquier momento desde $299/mo</p>
            </div>
            <a href="/planes/featured-realtor" style={{ fontSize: 12, fontWeight: 700, color: K.teal, textDecoration: "none", whiteSpace: "nowrap" }}>
              Ver Featured Realtor →
            </a>
          </div>

          {/* FAQ */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.2rem", fontWeight: 800, color: K.ink, marginBottom: 18 }}>
            Preguntas frecuentes
          </h2>
          <FaqAccordion items={FAQ} K={K} />

        </div>
      </div>
    </ComunidadLayout>
  );
}

type KType = Record<string, string>;
function FaqAccordion({ items, K }: { items: { q: string; a: string }[]; K: KType }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      {items.map((item, i) => (
        <div key={item.q} style={{ borderBottom: `1px solid ${K.line}` }}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{
              width: "100%", textAlign: "left", background: "none", border: "none",
              padding: "16px 0", cursor: "pointer", display: "flex",
              justifyContent: "space-between", alignItems: "center", gap: 12,
              fontFamily: "inherit",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14, color: K.ink }}>{item.q}</span>
            <span style={{
              flexShrink: 0, width: 20, height: 20, borderRadius: "50%",
              background: open === i ? K.teal : K.faint,
              color: open === i ? "#fff" : K.muted,
              fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}>
              {open === i ? "−" : "+"}
            </span>
          </button>
          {open === i && (
            <p style={{ fontSize: 13, color: K.muted, lineHeight: 1.7, margin: "0 0 14px" }}>
              {item.a}
            </p>
          )}
        </div>
      ))}
      <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: K.muted }}>
        ¿Más preguntas?{" "}
        <a href="mailto:hola@medellin.social" style={{ color: K.teal }}>hola@medellin.social</a>
      </p>
    </div>
  );
}
