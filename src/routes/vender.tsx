import { seo } from "@/lib/seo";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatMoney } from "@/lib/format";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import {
  useBarriosComunas,
  useBarriosPorComuna,
  type ComunaItem,
  type BarrioComunaItem,
} from "@/hooks/useBarrios";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { auth } from "@/lib/auth";
import type { ApiBarrio } from "@/lib/adapters";
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute("/vender")({
  component: VenderRoot,
  head: () => seo({ title: "Vende tu inmueble · Medellín Social", description: "Recibe una estimación de precio con datos reales del barrio y conecta con un agente de tu zona.", path: "/vender" }),
});

function VenderRoot() {
  return (
    <ComunidadLayout>
      <VenderPage />
    </ComunidadLayout>
  );
}

// ── Palette ───────────────────────────────────────────────────────────────────

const K = TOKENS;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtM(n: number | null | undefined): string {
  if (!n) return "—";
  return formatMoney(n, "COP", undefined, { suffix: false });
}

function fmtPct(n: number | null | undefined): string {
  if (!n) return "—";
  return `${n.toFixed(1)}%`;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function IconMap({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function IconGlobe({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconLockOpen({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function IconLockClosed({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconHome({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
      <polyline points="18 9 21 12" />
    </svg>
  );
}

function IconKey({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function IconCheck({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconUser({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Intencion = "venta" | "arriendo" | null;
// ── Main page ─────────────────────────────────────────────────────────────────

function VenderPage() {
  const [intencion, setIntencion] = useState<Intencion>(null);

  return (
    <div style={{ background: K.paper, minHeight: "100dvh" }}>
      <style>{`
        .vender-hero-grid { display: grid; grid-template-columns: 55fr 45fr; }
        @media (max-width: 720px) {
          .vender-hero-grid { grid-template-columns: 1fr; }
          .vender-hero-image { display: none; }
        }
      `}</style>
      <HeroSection />
      <IntencionSection intencion={intencion} setIntencion={setIntencion} />
      {intencion && <BarrioAnalysisSection intencion={intencion} />}
      <BeneficiosSection />
      <CTAFinalSection />
    </div>
  );
}

// ── Section 1: Hero ───────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section
      style={{
        background: "#fff",
        borderBottom: `1px solid ${K.line}`,
        padding: "clamp(48px, 8vw, 96px) clamp(20px, 5vw, 80px)",
      }}
    >
      <div
        className="vender-hero-grid"
        style={{
          maxWidth: 1160,
          margin: "0 auto",
          gap: "clamp(32px, 5vw, 72px)",
          alignItems: "center",
        }}
      >
        {/* Left col */}
        <div>
          <p
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "2.5px",
              textTransform: "uppercase",
              color: K.muted,
              marginBottom: 20,
            }}
          >
            Vende o arrienda con Medellín Social
          </p>

          <h1
            style={{
              fontFamily: K.serif,
              fontSize: "clamp(2.4rem, 5.5vw, 4rem)",
              fontWeight: 900,
              color: K.ink,
              lineHeight: 1.1,
              letterSpacing: "-1.5px",
              margin: "0 0 24px",
            }}
          >
            Tu propiedad.
            <br />
            El precio correcto.
            <br />
            El momento justo.
          </h1>

          <p
            style={{
              fontSize: "clamp(1rem, 1.5vw, 1.13rem)",
              color: K.muted,
              lineHeight: 1.75,
              marginBottom: 36,
              maxWidth: 480,
            }}
          >
            Llega a compradores locales e inversores extranjeros con datos
            reales del mercado.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <Link
              to="/publicar"
              style={{
                display: "inline-block",
                background: K.teal,
                color: "#fff",
                padding: "13px 28px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: "0.95rem",
                textDecoration: "none",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = K.tealMid)}
              onMouseLeave={(e) => (e.currentTarget.style.background = K.teal)}
            >
              Publicar mi propiedad →
            </Link>
            <a
              href="#analisis"
              style={{
                display: "inline-block",
                border: `2px solid ${K.teal}`,
                color: K.teal,
                padding: "11px 24px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: "0.95rem",
                textDecoration: "none",
                background: "transparent",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = K.tealLight)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Ver análisis de mi barrio
            </a>
          </div>

          <p style={{ fontSize: 12, color: K.muted, letterSpacing: "0.3px" }}>
            Sin costo &nbsp;·&nbsp; Activo en &lt;24h &nbsp;·&nbsp; 3% comisión
            solo si cerrás
          </p>
        </div>

        {/* Right col: hero image placeholder + floating card */}
        <div className="vender-hero-image" style={{ position: "relative" }}>
          <div
            style={{
              borderRadius: 12,
              overflow: "hidden",
              aspectRatio: "4/3",
              background: `linear-gradient(135deg, ${K.tealDeep} 0%, ${K.tealMid} 40%, #1a8a66 70%, #2fb87d 100%)`,
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Decorative city silhouette pattern */}
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 400 300"
              style={{ position: "absolute", inset: 0, opacity: 0.12 }}
            >
              <rect x="20"  y="180" width="30" height="120" fill="white" />
              <rect x="60"  y="140" width="40" height="160" fill="white" />
              <rect x="110" y="100" width="50" height="200" fill="white" />
              <rect x="170" y="120" width="35" height="180" fill="white" />
              <rect x="215" y="80"  width="60" height="220" fill="white" />
              <rect x="285" y="110" width="45" height="190" fill="white" />
              <rect x="340" y="150" width="35" height="150" fill="white" />
              <rect x="115" y="90"  width="10" height="12" fill="#0F8A4F" />
              <rect x="220" y="68"  width="10" height="14" fill="#0F8A4F" />
            </svg>
            <p
              style={{
                color: "rgba(255,255,255,0.35)",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                zIndex: 1,
                userSelect: "none",
              }}
            >
              Medellín · Valle de Aburrá
            </p>
          </div>

          {/* Floating metric card */}
          <div
            style={{
              position: "absolute",
              bottom: -16,
              left: -16,
              background: "#fff",
              border: `1px solid ${K.line}`,
              borderRadius: 10,
              padding: "14px 18px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
              minWidth: 190,
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: K.teal,
                textTransform: "uppercase",
                letterSpacing: "1px",
                margin: "0 0 4px",
              }}
            >
              El Poblado
            </p>
            <p
              style={{
                fontFamily: K.serif,
                fontSize: "1.25rem",
                fontWeight: 900,
                color: K.ink,
                margin: "0 0 2px",
              }}
            >
              $7.2M/m² prom.
            </p>
            <p style={{ fontSize: 12, color: K.muted, margin: 0 }}>
              28 días en mercado
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section 2: Selector de intención ─────────────────────────────────────────

function IntencionSection({
  intencion,
  setIntencion,
}: {
  intencion: Intencion;
  setIntencion: (v: Intencion) => void;
}) {
  return (
    <section
      id="analisis"
      style={{
        padding: "clamp(48px, 8vw, 80px) clamp(20px, 5vw, 80px)",
        background: K.paper,
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: K.serif,
            fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
            fontWeight: 900,
            color: K.ink,
            textAlign: "center",
            letterSpacing: "-0.5px",
            marginBottom: 36,
          }}
        >
          ¿Qué querés hacer con tu propiedad?
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          <IntencionCard
            active={intencion === "venta"}
            onClick={() => setIntencion(intencion === "venta" ? null : "venta")}
            icon={<IconHome size={28} color={intencion === "venta" ? "#fff" : K.teal} />}
            titulo="Quiero vender"
            desc="Encontrá el precio justo y el comprador correcto para tu propiedad"
          />
          <IntencionCard
            active={intencion === "arriendo"}
            onClick={() =>
              setIntencion(intencion === "arriendo" ? null : "arriendo")
            }
            icon={<IconKey size={28} color={intencion === "arriendo" ? "#fff" : K.teal} />}
            titulo="Quiero arrendar"
            desc="Maximizá tu retorno mensual con el perfil de arrendatario ideal"
          />
        </div>
      </div>
    </section>
  );
}

function IntencionCard({
  active,
  onClick,
  icon,
  titulo,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  titulo: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? K.teal : "#fff",
        border: `2px solid ${active ? K.teal : K.line}`,
        borderRadius: 12,
        padding: "28px 24px",
        textAlign: "left",
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        boxShadow: active ? `0 4px 20px rgba(29,158,117,0.22)` : "none",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.borderColor = K.teal;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 12px rgba(29,158,117,0.12)`;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.borderColor = K.line;
          (e.currentTarget as HTMLElement).style.boxShadow = "none";
        }
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          background: active ? "rgba(255,255,255,0.18)" : K.tealLight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          fontFamily: K.serif,
          fontSize: "1.15rem",
          fontWeight: 800,
          color: active ? "#fff" : K.ink,
          marginBottom: 6,
        }}
      >
        {titulo}
      </h3>
      <p style={{ fontSize: 13, color: active ? "rgba(255,255,255,0.82)" : K.muted, lineHeight: 1.6, margin: 0 }}>
        {desc}
      </p>
    </button>
  );
}

// ── Section 3: Análisis del barrio ────────────────────────────────────────────

function BarrioAnalysisSection({ intencion }: { intencion: "venta" | "arriendo" }) {
  const [comunaKey, setComunaKey] = useState<string | null>(null);
  const [barrioId, setBarrioId] = useState<number | null>(null);
  const [m2, setM2] = useState<string>("");
  const [habs, setHabs] = useState<number | null>(null);

  const { data: comunas = [] } = useBarriosComunas();
  const { data: barrios = [] } = useBarriosPorComuna(comunaKey);

  const { data: barrioData, isFetching } = useQuery<ApiBarrio>({
    queryKey: ["barrio-vender", barrioId],
    queryFn: () => apiFetch<ApiBarrio>(API_ENDPOINTS.barrio(barrioId!)),
    enabled: barrioId !== null,
    staleTime: 5 * 60_000,
  });

  const user = auth.get();
  const isPro = user?.plan === "pro" || user?.plan === "agente";
  const isLogged = !!user;

  // Reset barrio when commune changes
  function handleComunaChange(key: string) {
    setComunaKey(key);
    setBarrioId(null);
  }

  const mercado = barrioData?.mercado;
  const airbnb = barrioData?.airbnb;
  const liquidez = barrioData?.liquidez;

  // Simulator estimate
  const m2n = parseFloat(m2) || 0;
  let simLow: number | null = null;
  let simHigh: number | null = null;

  if (m2n > 0 && barrioData) {
    if (intencion === "venta" && mercado?.precio_m2_cop) {
      simLow  = Math.round(mercado.precio_m2_cop * m2n * 0.85 / 1_000_000);
      simHigh = Math.round(mercado.precio_m2_cop * m2n * 1.15 / 1_000_000);
    } else if (intencion === "arriendo" && mercado?.arriendo_p50_cop) {
      const base = mercado.arriendo_p50_cop;
      const factor = m2n > 80 ? 1.2 : m2n > 50 ? 1.0 : 0.8;
      simLow  = Math.round(base * factor * 0.85 / 1_000_000 * 10) / 10;
      simHigh = Math.round(base * factor * 1.15 / 1_000_000 * 10) / 10;
    }
  }

  return (
    <section
      style={{
        padding: "0 clamp(20px, 5vw, 80px) clamp(48px, 6vw, 80px)",
        background: K.paper,
        animation: "fadeIn 0.35s ease",
      }}
    >
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          background: "#fff",
          border: `1px solid ${K.line}`,
          borderRadius: 16,
          padding: "clamp(24px, 4vw, 48px)",
        }}
      >
        <h2
          style={{
            fontFamily: K.serif,
            fontSize: "clamp(1.3rem, 2.5vw, 1.75rem)",
            fontWeight: 900,
            color: K.ink,
            letterSpacing: "-0.4px",
            marginBottom: 24,
          }}
        >
          ¿En qué barrio está tu propiedad?
        </h2>

        {/* Selectors */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 32 }}>
          <select
            value={comunaKey ?? ""}
            onChange={(e) => handleComunaChange(e.target.value)}
            style={selectStyle}
          >
            <option value="">Comuna / Municipio ▾</option>
            {comunas.map((c: ComunaItem) => (
              <option key={c.key} value={c.key}>
                {c.label} — {c.municipio}
              </option>
            ))}
          </select>

          <select
            value={barrioId ?? ""}
            onChange={(e) => setBarrioId(Number(e.target.value))}
            disabled={!comunaKey || barrios.length === 0}
            style={{ ...selectStyle, opacity: !comunaKey ? 0.5 : 1 }}
          >
            <option value="">Barrio ▾</option>
            {barrios.map((b: BarrioComunaItem) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Pro teaser — always visible before barrio data loads */}
        {!isPro && !barrioId && (
          <ProTeaserInline intencion={intencion} isLogged={isLogged} />
        )}

        {/* Metrics */}
        {barrioId && (
          <div>
            {isFetching ? (
              <MetricsSkeleton />
            ) : (
              <>
                {intencion === "venta" ? (
                  <VentaMetrics mercado={mercado} liquidez={liquidez} />
                ) : (
                  <ArrriendoMetrics mercado={mercado} airbnb={airbnb} />
                )}

                {/* Simulator */}
                <div
                  style={{
                    marginTop: 28,
                    paddingTop: 24,
                    borderTop: `1px solid ${K.line}`,
                  }}
                >
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: K.muted,
                      letterSpacing: "1.5px",
                      textTransform: "uppercase",
                      marginBottom: 16,
                    }}
                  >
                    Estimación rápida
                  </p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 12, color: K.muted, fontWeight: 600 }}>Metros cuadrados</span>
                      <input
                        type="number"
                        placeholder="Ej. 75"
                        value={m2}
                        onChange={(e) => setM2(e.target.value)}
                        style={{
                          ...selectStyle,
                          width: 120,
                          fontFamily: "inherit",
                        }}
                      />
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 12, color: K.muted, fontWeight: 600 }}>Habitaciones</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {[1, 2, 3, 4].map((n) => (
                          <button
                            key={n}
                            onClick={() => setHabs(habs === n ? null : n)}
                            style={{
                              width: 36,
                              height: 36,
                              border: `1.5px solid ${habs === n ? K.teal : K.line}`,
                              borderRadius: 6,
                              background: habs === n ? K.teal : "#fff",
                              color: habs === n ? "#fff" : K.ink,
                              fontWeight: 700,
                              fontSize: 13,
                              cursor: "pointer",
                            }}
                          >
                            {n === 4 ? "4+" : n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {simLow !== null && simHigh !== null && (
                    <div
                      style={{
                        marginTop: 20,
                        padding: "16px 20px",
                        background: K.tealLight,
                        borderRadius: 10,
                        border: `1px solid rgba(29,158,117,0.2)`,
                      }}
                    >
                      <p style={{ color: K.muted, fontSize: 13, marginBottom: 4 }}>
                        Tu propiedad podría{" "}
                        {intencion === "venta" ? "valer" : "arrendar por"} entre
                      </p>
                      <p
                        style={{
                          fontFamily: K.serif,
                          fontSize: "1.5rem",
                          fontWeight: 900,
                          color: K.tealDeep,
                          margin: 0,
                        }}
                      >
                        {intencion === "venta"
                          ? `$${simLow}M – $${simHigh}M COP`
                          : `$${simLow}M – $${simHigh}M COP/mes`}
                      </p>
                      <p style={{ fontSize: 11, color: K.muted, marginTop: 4 }}>
                        Estimación basada en datos del mercado en este barrio. No es tasación oficial.
                      </p>
                    </div>
                  )}
                </div>

                {/* Pro CTA */}
                <ProCtaBlock intencion={intencion} isPro={isPro} isLogged={isLogged} />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: `1.5px solid ${K.line}`,
  background: K.paper,
  color: K.ink,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2362736D' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  paddingRight: 32,
  minWidth: 200,
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: K.surface,
        borderRadius: 10,
        padding: "18px 16px",
        border: `1px solid ${K.line}`,
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: K.muted,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          margin: "0 0 6px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: K.serif,
          fontSize: "1.25rem",
          fontWeight: 900,
          color: K.ink,
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 72,
            borderRadius: 10,
            background: K.line,
            animation: "pulse 1.4s ease infinite alternate",
          }}
        />
      ))}
      <style>{`@keyframes pulse { from { opacity: 0.6; } to { opacity: 0.9; } }`}</style>
    </div>
  );
}

type MercadoData = ApiBarrio["mercado"] | null | undefined;
type LiquidezData = ApiBarrio["liquidez"] | null | undefined;
type AirbnbData = ApiBarrio["airbnb"] | null | undefined;

function VentaMetrics({
  mercado,
  liquidez,
}: {
  mercado: MercadoData;
  liquidez: LiquidezData;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <MetricCard label="Precio/m²" value={fmtM(mercado?.precio_m2_cop)} />
      <MetricCard label="Precio prom. venta" value={fmtM(mercado?.precio_venta_promedio)} />
      <MetricCard label="Tiempo estimado venta" value={liquidez?.tiempo_estimado_venta ?? "—"} />
      <MetricCard label="Yield bruto" value={fmtPct(mercado?.yield_bruto_pct)} />
    </div>
  );
}

function ArrriendoMetrics({
  mercado,
  airbnb,
}: {
  mercado: MercadoData;
  airbnb: AirbnbData;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <MetricCard label="Canon promedio (p50)" value={fmtM(mercado?.arriendo_p50_cop)} />
      <MetricCard label="Yield bruto estimado" value={fmtPct(mercado?.yield_bruto_pct)} />
      <MetricCard label="Yield Airbnb" value={fmtPct(airbnb?.yield_airbnb_pct)} />
      <MetricCard label="Ocupación Airbnb" value={airbnb?.ocupacion_pct ? `${Math.round(airbnb.ocupacion_pct)}%` : "—"} />
    </div>
  );
}

function ProCtaBlock({
  intencion,
  isPro,
  isLogged,
}: {
  intencion: "venta" | "arriendo";
  isPro: boolean;
  isLogged: boolean;
}) {
  if (isPro) {
    return <ProAnalysisBlock intencion={intencion} />;
  }

  const bullets =
    intencion === "venta"
      ? [
          "En cuánto tiempo se vende una propiedad como la tuya en este barrio",
          "Si conviene vender rápido con menos margen o esperar por mejor precio",
          "Cómo posicionarla para inversores extranjeros que pagan en USD",
        ]
      : [
          "Cuánto podés ganar en Airbnb vs renta larga vs nómadas digitales",
          "Qué perfil de arrendatario maximiza tu retorno en este barrio específico",
          "El canon óptimo para no perder tiempo con el inmueble vacío",
        ];

  return (
    <div
      style={{
        marginTop: 28,
        padding: "24px",
        background: K.tealLight,
        border: `1.5px solid rgba(29,158,117,0.3)`,
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
        <IconLockClosed size={18} color={K.tealDeep} />
        <p
          style={{
            fontFamily: K.serif,
            fontSize: "1rem",
            fontWeight: 800,
            color: K.tealDeep,
            margin: 0,
          }}
        >
          Con tu Listing Destacado sabemos exactamente
        </p>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px 30px" }}>
        {bullets.map((b) => (
          <li
            key={b}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              marginBottom: 10,
              fontSize: 13,
              color: K.tealDeep,
              lineHeight: 1.5,
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 2 }}>
              <IconCheck size={13} color={K.teal} />
            </span>
            {b}
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <a
          href="/publicar"
          style={{
            display: "inline-block",
            background: K.tealDeep,
            color: "#fff",
            padding: "11px 22px",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Publicar listing patrocinado →
        </a>
        <p style={{ fontSize: 12, color: K.muted, margin: 0 }}>
          Pago único · $1,000 USD por listing
        </p>
      </div>
    </div>
  );
}

function ProAnalysisBlock({ intencion }: { intencion: "venta" | "arriendo" }) {
  return (
    <div
      style={{
        marginTop: 28,
        padding: "20px 24px",
        background: "#fff",
        border: `1.5px solid ${K.teal}`,
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <IconLockOpen size={16} color={K.teal} />
        <p
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: K.teal,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Análisis Pro — incluido en tu plan
        </p>
      </div>
      <p style={{ fontSize: 13, color: K.muted, margin: 0, lineHeight: 1.6 }}>
        {intencion === "venta"
          ? "Ves en qué rango de precios cae tu propiedad dentro del barrio, cuánto tardan en venderse propiedades similares y cómo posicionarla para compradores internacionales."
          : "Tenés acceso al comparador Airbnb vs renta larga vs renta media, el canon óptimo calculado con ocupación real del barrio y el perfil de arrendatario de mayor retorno."}
      </p>
    </div>
  );
}

// ── Pro teaser (no barrio required) ──────────────────────────────────────────

function ProTeaserInline({
  intencion,
  isLogged,
}: {
  intencion: "venta" | "arriendo";
  isLogged: boolean;
}) {
  const bullets =
    intencion === "venta"
      ? [
          "Tiempo estimado de venta según precio y barrio",
          "Posicionamiento para inversores que pagan en USD",
          "Rango de precios reales en tu zona: qué se vende barato, al precio típico y caro",
        ]
      : [
          "Comparador Airbnb vs renta larga vs nómadas digitales",
          "Canon óptimo calculado con ocupación real",
          "Perfil de arrendatario de mayor retorno por barrio",
        ];

  return (
    <div
      style={{
        padding: "20px",
        background: K.tealLight,
        border: `1.5px solid rgba(29,158,117,0.25)`,
        borderRadius: 12,
        marginBottom: 4,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
        <IconLockClosed size={16} color={K.tealDeep} />
        <p
          style={{
            fontFamily: K.serif,
            fontSize: "0.95rem",
            fontWeight: 800,
            color: K.tealDeep,
            margin: 0,
          }}
        >
          {intencion === "venta"
            ? "Tu Listing Destacado te dice cuánto vale y cuánto tarda"
            : "Tu Listing Destacado maximiza tu retorno mensual"}
        </p>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 26px" }}>
        {bullets.map((b) => (
          <li
            key={b}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              marginBottom: 7,
              fontSize: 12,
              color: K.tealDeep,
              lineHeight: 1.5,
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 2 }}>
              <IconCheck size={12} color={K.teal} />
            </span>
            {b}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <a
          href="/publicar"
          style={{
            display: "inline-block",
            background: K.tealDeep,
            color: "#fff",
            padding: "9px 18px",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          Publicar con destacado →
        </a>
        <p style={{ fontSize: 11, color: K.muted, margin: 0 }}>
          Pago único · $1,000 USD por listing
        </p>
      </div>
    </div>
  );
}

// ── Section 4: Beneficios ─────────────────────────────────────────────────────

const BENEFICIOS = [
  {
    icon: <IconMap size={20} color="#fff" />,
    titulo: "Visible en el MLS",
    desc: "Tu propiedad aparece en el mapa que usan inversores cada día",
  },
  {
    icon: <IconGlobe size={20} color="#fff" />,
    titulo: "Alcance internacional",
    desc: "Inversores de LATAM, Europa y Norteamérica buscan aquí",
  },
  {
    icon: <IconLockOpen size={20} color="#fff" />,
    titulo: "Sin costo por publicar",
    desc: "Solo pagás el 3% si cerrás la venta a través de la plataforma",
  },
] as const;

function BeneficiosSection() {
  return (
    <section
      style={{
        background: K.surface,
        borderTop: `1px solid ${K.line}`,
        borderBottom: `1px solid ${K.line}`,
        padding: "clamp(48px, 8vw, 80px) clamp(20px, 5vw, 80px)",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: K.serif,
            fontSize: "clamp(1.4rem, 2.5vw, 1.9rem)",
            fontWeight: 900,
            color: K.ink,
            textAlign: "center",
            letterSpacing: "-0.4px",
            marginBottom: 52,
          }}
        >
          ¿Por qué publicar aquí?
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "clamp(24px, 4vw, 56px)",
          }}
        >
          {BENEFICIOS.map((b) => (
            <div key={b.titulo}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: K.ink,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                {b.icon}
              </div>
              <h3
                style={{
                  fontFamily: K.serif,
                  fontSize: "1.05rem",
                  fontWeight: 800,
                  color: K.ink,
                  marginBottom: 8,
                }}
              >
                {b.titulo}
              </h3>
              <p style={{ fontSize: 13, color: K.muted, lineHeight: 1.65, margin: 0 }}>
                {b.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Section 6: CTA Final ──────────────────────────────────────────────────────

function CTAFinalSection() {
  return (
    <section
      style={{
        background: K.tealDeep,
        padding: "clamp(56px, 8vw, 96px) clamp(20px, 5vw, 80px)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: K.serif,
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
            fontWeight: 900,
            color: "#fff",
            letterSpacing: "-0.8px",
            marginBottom: 12,
          }}
        >
          ¿Listo para publicar?
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.68)",
            marginBottom: 36,
          }}
        >
          Gratis, activo en menos de 24 horas
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            to="/publicar"
            style={{
              display: "inline-block",
              background: "#fff",
              color: K.tealDeep,
              padding: "13px 28px",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: "0.95rem",
              textDecoration: "none",
            }}
          >
            Publicar mi propiedad →
          </Link>
          <Link
            to="/conectar-agente"
            search={{ listing_id: "" }}
            style={{
              display: "inline-block",
              border: "2px solid rgba(255,255,255,0.5)",
              color: "#fff",
              padding: "11px 24px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: "0.95rem",
              textDecoration: "none",
            }}
          >
            Hablar con un agente
          </Link>
        </div>
      </div>
    </section>
  );
}
