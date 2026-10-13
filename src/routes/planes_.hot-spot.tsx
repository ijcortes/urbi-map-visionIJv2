import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { GHL, ghlRedirect } from "@/config/ghl";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

const BASE = [
  "CRM integrado",
  "Calendar Automation",
  "2-Way Text & Email",
  "Social Messaging Integration",
  "Google Business Messaging & Call Tracking",
  "Reputation Management",
  "Web Chat Tool",
];

const MARKETING = [
  "Web Site administrado y personalizado",
  "AI Social Media Content & Scheduler",
  "AI Voice, Chat & Text Agents",
  "Email Marketing Tool",
  "Text Marketing Tool",
  "SMS & Email Templates",
  "Customizable Forms & Surveys",
  "Websites · Landing Pages · Funnels",
  "Customizable Automations & Workflows",
];

const PLATFORM = [
  "Payment Processing (recurrente + descuentos)",
  "Memberships",
  "Course Sales Page & Tools",
  "Communities",
  "Blogs",
  "Affiliate Manager",
  "Opportunity Mgmt & Forecasting",
  "Special Offers & Hot Spot Promotions",
  "Featured Event Promotions (Barrio / Comuna / Ciudad)",
  "Featured Realtor (Barrio / Comuna / Ciudad)",
];

const PROMO_SCOPES = [
  { cat: "Special Offers",   unit: "/mo",     levels: [["Barrio", "$49"], ["Comuna", "$199"], ["Ciudad", "$499"]] },
  { cat: "Featured Events",  unit: "/evento", levels: [["Barrio", "$79"], ["Comuna", "$249"], ["Ciudad", "$599"]] },
  { cat: "Featured Realtor", unit: "/mo",     levels: [["Barrio", "$199"], ["Comuna", "$999"], ["Ciudad", "$2,499"]] },
];

const FAQ = [
  {
    q: "¿Qué significa 'Unlimited' en el precio especial?",
    a: "El precio especial de lanzamiento es $199/mo (precio regular $299/mo). El setup fee es $49 (precio regular $99). Cupo limitado.",
  },
  {
    q: "¿Qué son las Hot Spot Promotions?",
    a: "Posicionamiento destacado de tu agencia, propiedades o eventos a nivel barrio, comuna o ciudad dentro del mapa de Medellín Social. Cupo exclusivo por nivel.",
  },
  {
    q: "¿El Affiliate Manager qué permite?",
    a: "Gestionar embajadores y afiliados que refieren clientes a tu agencia. Cada referido queda trackeado con su comisión automática en GHL.",
  },
  {
    q: "¿Puedo tener múltiples Hot Spots?",
    a: "Sí. Puedes patrocinar varios niveles (barrio + comuna, por ejemplo) y cada uno se gestiona por separado en el dashboard.",
  },
];

export const Route = createFileRoute("/planes_/hot-spot")({
  component: HotSpotPage,
});

function HotSpotPage() {
  const user = typeof window !== "undefined" ? auth.get() : null;
  const email: Record<string, string> = user?.email ? { email: user.email } : {};

  return (
    <ComunidadLayout>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${K.tealDeep} 0%, #063d2e 50%, ${K.tealDeep} 100%)`,
        padding: "56px 20px 48px", textAlign: "center",
      }}>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>
          Para Negocios Locales
        </p>
        <h1 style={{ fontFamily: K.serif, fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 900, color: "#fff", marginBottom: 12, lineHeight: 1.1 }}>
          Hot Spot
        </h1>
        <p style={{ color: "rgba(255,255,255,0.78)", fontSize: 15, maxWidth: 480, margin: "0 auto 32px", lineHeight: 1.65 }}>
          Plataforma completa para agencias. Afiliados, comunidades, membresías, forecasting y posicionamiento exclusivo en el mapa.
        </p>
        <div style={{ display: "inline-block", background: "rgba(255,255,255,0.12)", borderRadius: 14, padding: "20px 36px" }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textDecoration: "line-through", marginBottom: 2 }}>$299/mo precio regular</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <p style={{ fontFamily: K.serif, fontSize: "2.4rem", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.04em", margin: 0 }}>
              $199
            </p>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>/mo</span>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
            precio especial cupo limitado · setup <s>$99</s> $49
          </p>
        </div>
      </div>

      <div style={{ background: K.paper }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px 72px" }}>

          <button
            onClick={() => ghlRedirect(GHL.hot_spot, email)}
            style={{
              display: "block", width: "100%", background: K.tealDeep, color: "#fff",
              border: "none", borderRadius: 10, padding: "14px 0",
              fontWeight: 700, fontSize: 15, cursor: "pointer",
              fontFamily: "inherit", marginBottom: 40,
            }}
          >
            Contactar para Hot Spot →
          </button>

          {/* Platform features — highlighted */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.2rem", fontWeight: 800, color: K.ink, marginBottom: 14 }}>
            Exclusivo Hot Spot
          </h2>
          <div style={{ background: "#fff", border: `2px solid ${K.tealDeep}`, borderRadius: 12, padding: "6px 0", marginBottom: 28 }}>
            {PLATFORM.map((f, i) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: i < PLATFORM.length - 1 ? `1px solid ${K.line}` : "none" }}>
                <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "#E7F4EC", color: K.teal, fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                <span style={{ fontSize: 14, color: K.ink, fontWeight: 500 }}>{f}</span>
              </div>
            ))}
          </div>

          {/* Marketing features */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.2rem", fontWeight: 800, color: K.ink, marginBottom: 14 }}>
            Marketing & Automatización — incluido
          </h2>
          <div style={{ background: "#fff", border: `1px solid ${K.line}`, borderRadius: 12, padding: "6px 0", marginBottom: 28 }}>
            {MARKETING.map((f, i) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderBottom: i < MARKETING.length - 1 ? `1px solid ${K.line}` : "none" }}>
                <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: K.faint, color: K.muted, fontSize: 10, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                <span style={{ fontSize: 13.5, color: K.muted }}>{f}</span>
              </div>
            ))}
          </div>

          {/* Base features */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.2rem", fontWeight: 800, color: K.ink, marginBottom: 14 }}>
            Comunicación & CRM — incluido
          </h2>
          <div style={{ background: "#fff", border: `1px solid ${K.line}`, borderRadius: 12, padding: "6px 0", marginBottom: 40 }}>
            {BASE.map((f, i) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderBottom: i < BASE.length - 1 ? `1px solid ${K.line}` : "none" }}>
                <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: K.faint, color: K.muted, fontSize: 10, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                <span style={{ fontSize: 13.5, color: K.muted }}>{f}</span>
              </div>
            ))}
          </div>

          {/* Promo scopes */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.2rem", fontWeight: 800, color: K.ink, marginBottom: 14 }}>
            Alcance de promociones
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 48 }}>
            {PROMO_SCOPES.map(({ cat, unit, levels }) => (
              <div key={cat} style={{ background: "#fff", border: `1px solid ${K.line}`, borderRadius: 10, padding: "14px" }}>
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: K.teal, marginBottom: 6 }}>{cat}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {levels.map(([l, p]) => (
                    <span key={l} style={{ fontSize: 12.5, color: K.muted, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{l}</span>
                      <span style={{ fontWeight: 700, color: K.ink, whiteSpace: "nowrap" }}>{p}<span style={{ fontWeight: 400, color: K.muted, fontSize: 10 }}>{unit}</span></span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
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
