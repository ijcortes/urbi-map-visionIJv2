import { seo } from "@/lib/seo";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { PlanCta } from "@/components/PlanCta";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

const FEATURES = [
  "Tu convenio publicado en el mapa de Medellín Social",
  "Visible para compradores e inversores activos en la zona",
  "Gestión del deal desde el dashboard de tu negocio",
  "Integración bidireccional con GHL (creación y actualización automática)",
  "Categorías: descuento, servicio especial, convenio profesional",
  "Alcance: barrio, comuna o ciudad",
  "Estadísticas de vistas e interacciones del deal",
];

const FAQ = [
  {
    q: "¿Qué es un Deal en Medellín Social?",
    a: "Un convenio o beneficio especial que tu negocio ofrece a la comunidad de compradores, inversores y realtors del MLS. Puede ser un descuento, un servicio preferencial o una alianza comercial.",
  },
  {
    q: "¿Quién puede publicar un Deal?",
    a: "Cualquier negocio o tienda registrada en Medellín Social. Se requiere tener un perfil de negocio activo antes de publicar.",
  },
  {
    q: "¿Cuánto dura el Deal activo?",
    a: "El período lo defines tú al crear el deal. Puedes actualizarlo o cerrarlo en cualquier momento desde tu dashboard.",
  },
  {
    q: "¿Cómo llega el deal a los usuarios?",
    a: "Aparece en el mapa y en el panel de comunidad del barrio o zona que selecciones. Usuarios que están buscando propiedades en esa zona lo ven directamente.",
  },
];

export const Route = createFileRoute("/planes_/deal")({
  head: () => seo({ title: "Deal · Medellín Social", description: "Promociona una oferta de tu negocio a vecinos y visitantes de tu barrio en Medellín.", path: "/planes/deal" }),
  component: DealPage,
});

function DealPage() {
  const user = typeof window !== "undefined" ? auth.get() : null;
  const email: Record<string, string> = user?.email ? { email: user.email } : {};

  return (
    <ComunidadLayout>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${K.tealDeep} 0%, ${K.tealMid} 50%, ${K.teal} 100%)`,
        padding: "56px 20px 48px", textAlign: "center",
      }}>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>
          Para negocios y tiendas
        </p>
        <h1 style={{ fontFamily: K.serif, fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 900, color: "#fff", marginBottom: 12, lineHeight: 1.1 }}>
          Deal / Convenio
        </h1>
        <p style={{ color: "rgba(255,255,255,0.78)", fontSize: 15, maxWidth: 460, margin: "0 auto 32px", lineHeight: 1.65 }}>
          Publica un beneficio especial para la comunidad de compradores e inversores que buscan propiedades en tu zona.
        </p>
        <div style={{ display: "inline-block", background: "rgba(255,255,255,0.12)", borderRadius: 14, padding: "20px 36px" }}>
          <p style={{ fontFamily: K.serif, fontSize: "2.8rem", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.04em" }}>
            $29<span style={{ fontSize: "1.1rem", fontWeight: 400 }}>/mo</span>
          </p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>por deal activo</p>
        </div>
      </div>

      <div style={{ background: K.paper }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px 72px" }}>

          <PlanCta plan="deal" planLabel="Deal" label="Publicar mi Deal →" params={email} />

          {/* Features */}
          <h2 style={{ fontFamily: K.serif, fontSize: "1.3rem", fontWeight: 800, color: K.ink, marginBottom: 20 }}>
            Todo lo que incluye
          </h2>
          <div style={{ background: "#fff", border: `1px solid ${K.line}`, borderRadius: 14, padding: "8px 0", marginBottom: 48 }}>
            {FEATURES.map((f, i) => (
              <div key={f} style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "13px 20px",
                borderBottom: i < FEATURES.length - 1 ? `1px solid ${K.line}` : "none",
              }}>
                <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "#E7F4EC", color: K.teal, fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>✓</span>
                <span style={{ fontSize: 14, color: K.ink, lineHeight: 1.5 }}>{f}</span>
              </div>
            ))}
          </div>

          {/* Upgrade callout */}
          <div style={{ background: K.tealLight, border: `1px solid ${K.teal}40`, borderRadius: 12, padding: "18px 20px", marginBottom: 48, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: K.tealDeep, marginBottom: 2 }}>¿Eres agente o agencia?</p>
              <p style={{ fontSize: 12, color: K.muted }}>Los planes de realtor incluyen herramientas de marketing y CRM completo.</p>
            </div>
            <a href="/planes" style={{ fontSize: 12, fontWeight: 700, color: K.teal, textDecoration: "none", whiteSpace: "nowrap" }}>
              Ver planes de agente →
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
