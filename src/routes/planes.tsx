import { useState } from "react";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { createFileRoute } from "@tanstack/react-router";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { PLAN_PRICES as PP } from "@/config/ghl";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;


const FAQ = [
  {
    q: "¿Cuánto dura el precio especial de lanzamiento?",
    a: "El precio especial es por tiempo limitado. Al suscribirte en este período, mantienes ese precio mientras tu plan esté activo.",
  },
  {
    q: "¿Qué incluye el setup fee?",
    a: "Configuración de teléfono dedicado, integración con WhatsApp, agentes de AI y conexión al web site. Es pago único — no se repite mensualmente.",
  },
  {
    q: "¿Los precios por uso vienen incluidos?",
    a: "No. Llamadas, SMS, emails y AI se cobran por consumo en todos los productos. Son costos de operador que se pasan directamente sin margen.",
  },
  {
    q: "¿Qué son las Hot Spot Promotions?",
    a: "Posicionamiento exclusivo de tu negocio en el mapa de Medellín Social — a nivel barrio, comuna o ciudad. Cupo único por nivel.",
  },
  {
    q: "¿Un Deal requiere tener Hot Spot?",
    a: "No. Cualquier negocio puede publicar un Deal de forma independiente por $29/mo, sin necesidad de otros productos.",
  },
];

export const Route = createFileRoute("/planes")({
  validateSearch: () => ({}),
  component: PlanesPage,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
});

function PlanesPage() {
  const [filter, setFilter] = useState<"realtors" | "negocios">("realtors");
  const showRealtors = filter === "realtors";
  const showNegocios = filter === "negocios";

  return (
    <ComunidadLayout>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${K.tealDeep} 0%, ${K.tealMid} 50%, ${K.teal} 100%)`,
        padding: "52px 20px 44px",
        textAlign: "center",
      }}>
        <h1 style={{ fontFamily: K.serif, fontSize: "clamp(1.6rem, 4vw, 2.3rem)", fontWeight: 900, color: "#fff", marginBottom: 10, lineHeight: 1.15 }}>
          Planes y precios
        </h1>
        <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 15, maxWidth: 440, margin: "0 auto 28px", lineHeight: 1.6 }}>
          Productos distintos para agentes inmobiliarios y negocios locales en el Valle de Aburrá.
        </p>
        {/* Filter buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {(["realtors", "negocios"] as const).map(v => {
            const active = filter === v;
            const label = v === "realtors" ? "Para Agentes Inmobiliarios" : "Para Negocios Locales";
            return (
              <button
                key={v}
                onClick={() => setFilter(v)}
                style={{
                  padding: "9px 20px",
                  borderRadius: 99,
                  border: `2px solid ${active ? "#fff" : "rgba(255,255,255,0.4)"}`,
                  background: active ? "#fff" : "transparent",
                  color: active ? K.tealDeep : "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ background: K.paper, minHeight: "60vh" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "52px 20px 80px" }}>

          {/* ── Agentes Inmobiliarios ── */}
          {showRealtors && (
            <>
              <AudienceLabel>Para Agentes Inmobiliarios</AudienceLabel>
              <p style={{ fontSize: 13, color: K.muted, marginBottom: 24, lineHeight: 1.6 }}>
                CRM, comunicaciones y herramientas de marketing integradas con el MLS del Valle de Aburrá.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginBottom: 56 }}>
                <ProductCard
                  name="Listing Member"
                  description="Publica tus propiedades en el MLS con CRM integrado, calendario de citas y comunicación 2-vía por texto, email y WhatsApp."
                  highlights={["CRM + Calendar Automation", "2-Way Text & Email", "Google Business Messaging", "Reputation Management"]}
                  regularPrice={PP.listing_member!.regular!}
                  specialPrice={PP.listing_member!.special}
                  setup={`${PP.listing_member!.setup} setup fee`}
                  cta="Ver Listing Member →"
                  href="/planes/listing-member"
                  variant="neutral"
                />
                <ProductCard
                  name="Featured Realtor"
                  description="Sé el agente referente de tu zona. Web site administrado, AI agents que responden leads 24/7 y suite completa de marketing digital."
                  highlights={["Web site administrado", "AI Voice, Chat & Text Agents", "Email + SMS Marketing", "Funnels y automatizaciones"]}
                  regularPrice={PP.featured_realtor!.regular!}
                  specialPrice={PP.featured_realtor!.special}
                  setup={`${PP.featured_realtor!.setup} setup fee`}
                  cta="Ver Featured Realtor →"
                  href="/planes/featured-realtor"
                  variant="featured"
                  badge="Más solicitado"
                />
              </div>
            </>
          )}

          {/* ── Negocios Locales ── */}
          {showNegocios && (
            <>
              <AudienceLabel>Para Negocios Locales</AudienceLabel>
              <p style={{ fontSize: 13, color: K.muted, marginBottom: 24, lineHeight: 1.6 }}>
                Visibilidad en el mapa para restaurantes, tiendas, rooftops y cualquier negocio de la zona.
              </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, marginBottom: 56 }}>
            <ProductCard
              name="Hot Spot"
              description="Posiciona tu negocio como el referente de tu zona en el mapa. Stack completo: comunidades, membresías, affiliate manager y posicionamiento exclusivo barrio/comuna/ciudad."
              highlights={["Posicionamiento exclusivo en mapa", "Communities + Memberships", "Affiliate Manager", "Payment Processing"]}
              regularPrice={PP.hot_spot!.regular!}
              specialPrice={PP.hot_spot!.special}
              setup={<><s style={{ opacity: 0.6 }}>$99</s> $49 setup fee</>}
              cta="Ver Hot Spot →"
              href="/planes/hot-spot"
              variant="neutral"
            />
            <ProductCard
              name="Deal / Convenio"
              description="Publica una oferta especial en el mapa — descuento, convenio o promoción. Visible para compradores e inversores activos en tu zona. Sin compromisos adicionales."
              highlights={["Oferta visible en el mapa", "Alcance barrio, comuna o ciudad", "Gestión desde tu dashboard", "Sin setup fee"]}
              regularPrice={null}
              specialPrice={PP.deal!.special}
              setup="por deal activo"
              cta="Ver Deal →"
              href="/planes/deal"
              variant="neutral"
            />
          </div>
            </>
          )}

          {/* ── Referidos ── */}
          <div style={{
            background: "#fff",
            border: `1px solid ${K.line}`,
            borderRadius: 14,
            padding: "22px 28px",
            marginBottom: 56,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: K.muted, marginBottom: 5 }}>
                Afiliados y Embajadores
              </p>
              <p style={{ fontFamily: K.serif, fontSize: "1.05rem", fontWeight: 900, color: K.ink, marginBottom: 4 }}>
                Refiere y gana comisión
              </p>
              <p style={{ fontSize: 13, color: K.muted, lineHeight: 1.55 }}>
                ¿Conoces negocios o agentes que deberían estar en Medellín Social? Refiere y recibe comisión automática por cada conversión.
              </p>
            </div>
            <a
              href="mailto:hola@medellin.social?subject=Quiero ser afiliado"
              style={{
                background: K.faint, color: K.tealDeep,
                border: `1px solid ${K.line}`, borderRadius: 8,
                padding: "10px 20px", fontWeight: 700, fontSize: 13,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              Contáctanos →
            </a>
          </div>

          {/* ── FAQ ── */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.3rem", fontWeight: 800, color: K.ink, marginBottom: 20, textAlign: "center" }}>
            Preguntas frecuentes
          </h2>
          <FaqAccordion />

        </div>
      </div>
    </ComunidadLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function AudienceLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
      <h2 style={{ fontFamily: K.serif, fontSize: "1.2rem", fontWeight: 900, color: K.ink, margin: 0 }}>
        {children}
      </h2>
      <div style={{ flex: 1, height: 1, background: K.line }} />
    </div>
  );
}

function ProductCard({ name, description, highlights, regularPrice, specialPrice, setup, cta, href, variant, badge }: {
  name: string;
  description: string;
  highlights: string[];
  regularPrice: string | null;
  specialPrice: string;
  setup: React.ReactNode;
  cta: string;
  href: string;
  variant: "neutral" | "featured";
  badge?: string;
}) {
  const borderColor = variant === "featured" ? K.teal : K.line;
  const btnBg       = variant === "featured" ? K.teal : K.tealDeep;

  return (
    <div style={{
      background: "#fff",
      border: `2px solid ${borderColor}`,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: variant === "featured" ? `0 4px 24px ${K.teal}22` : "none",
      display: "flex",
      flexDirection: "column",
    }}>
      {badge && (
        <div style={{ background: K.teal, color: "#fff", textAlign: "center", padding: "5px 0", fontSize: 10, fontWeight: 800, letterSpacing: "0.7px", textTransform: "uppercase" }}>
          {badge}
        </div>
      )}
      <div style={{ padding: "22px 22px 24px", flex: 1, display: "flex", flexDirection: "column" }}>
        <h3 style={{ fontFamily: K.serif, fontSize: "1.15rem", fontWeight: 900, color: K.ink, marginBottom: 8 }}>{name}</h3>
        <p style={{ fontSize: 12.5, color: K.muted, lineHeight: 1.6, marginBottom: 16 }}>{description}</p>

        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px", display: "flex", flexDirection: "column", gap: 6 }}>
          {highlights.map(h => (
            <li key={h} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: K.ink }}>
              <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "50%", background: "#E7F4EC", color: K.teal, fontSize: 10, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>
              {h}
            </li>
          ))}
        </ul>

        <div style={{ marginTop: "auto" }}>
          {regularPrice && (
            <p style={{ fontSize: 11.5, color: K.muted, textDecoration: "line-through", marginBottom: 2 }}>
              {regularPrice} precio regular
            </p>
          )}
          <div style={{ marginBottom: 2 }}>
            <span style={{ fontFamily: K.serif, fontSize: "1.9rem", fontWeight: 900, color: K.ink, letterSpacing: "-0.04em" }}>
              {specialPrice}
            </span>
            {regularPrice && <span style={{ fontSize: "0.9rem", color: K.muted }}>/mo</span>}
          </div>
          {regularPrice && (
            <p style={{ fontSize: 11, color: K.muted, marginBottom: 4 }}>precio especial de lanzamiento</p>
          )}
          <span style={{ display: "inline-block", fontSize: 11, color: K.muted, background: K.faint, borderRadius: 6, padding: "4px 8px", marginBottom: 16 }}>
            {setup}
          </span>

          <a
            href={href}
            style={{
              display: "block", textAlign: "center",
              background: btnBg, color: "#fff",
              border: "none", borderRadius: 8, padding: "11px 0",
              fontWeight: 700, fontSize: 13, textDecoration: "none",
              fontFamily: "inherit",
            }}
          >
            {cta}
          </a>
        </div>
      </div>
    </div>
  );
}

function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div style={{ maxWidth: 580, margin: "0 auto" }}>
      {FAQ.map((item, i) => (
        <div key={item.q} style={{ borderBottom: `1px solid ${K.line}` }}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{
              width: "100%", textAlign: "left", background: "none", border: "none",
              padding: "18px 0", cursor: "pointer", display: "flex",
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
            <p style={{ fontSize: 13, color: K.muted, lineHeight: 1.7, margin: "0 0 16px" }}>
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
