import { seo } from "@/lib/seo";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, getToken } from "@/lib/apiClient";
import { API_BASE_URL } from "@/config/api";
import { validateGhlUrl } from "@/config/ghl";
import { useT } from "@/lib/i18n";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { K } from "@/design/tokens";

type Nivel = "barrio" | "comuna";
type Zona = {
  zona_nivel: Nivel; zona_codigo: string; nombre: string; nivel: string;
  precio_mensual: number; cupos: number; municipio?: string;
};
type ZonasOut = { barrios: Zona[]; comunas: Zona[]; capacidad: Record<Nivel, number> };
type CheckoutOut = { modo: "ghl_stripe" | "simulado"; checkout_url?: string; mensaje?: string; total: number };

type Search = { zona_nivel?: Nivel; zona_codigo?: string };

export const Route = createFileRoute("/planes_/featured-realtor")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    zona_nivel: s.zona_nivel === "barrio" || s.zona_nivel === "comuna" ? s.zona_nivel : undefined,
    zona_codigo: typeof s.zona_codigo === "string" ? s.zona_codigo.slice(0, 40) : undefined,
  }),
  head: () => seo({
    title: "Realtor Preferido · Medellín Social",
    description: "Sé el realtor preferido de tu barrio o comuna: los compradores y vendedores de tu zona te ven primero.",
    path: "/planes/featured-realtor",
  }),
  component: RealtorPreferidoPage,
});

const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO") + " COP";

function RealtorPreferidoPage() {
  const t = useT();
  const search = Route.useSearch();
  const [nivel, setNivel] = useState<Nivel>(search.zona_nivel ?? "barrio");
  const [sel, setSel] = useState<string | null>(search.zona_codigo ?? null);
  const [q, setQ] = useState("");
  const [meses, setMeses] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["rp-zonas"],
    queryFn: () => apiFetch<ZonasOut>(`${API_BASE_URL}/realtor-preferido/zonas`, { skipAuth: true }),
    staleTime: 60_000,
  });

  const lista = useMemo(() => {
    const base = (nivel === "barrio" ? data?.barrios : data?.comunas) ?? [];
    const f = q.trim().toLowerCase();
    return (f ? base.filter((z) => z.nombre.toLowerCase().includes(f)) : base).slice(0, 60);
  }, [data, nivel, q]);

  const zona = useMemo(
    () => ((nivel === "barrio" ? data?.barrios : data?.comunas) ?? []).find((z) => z.zona_codigo === sel) ?? null,
    [data, nivel, sel],
  );

  async function comprar() {
    if (!zona) return;
    if (!getToken()) { window.location.href = "/login"; return; }
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<CheckoutOut>(`${API_BASE_URL}/realtor-preferido/checkout`, {
        method: "POST",
        body: JSON.stringify({ zona_nivel: zona.zona_nivel, zona_codigo: zona.zona_codigo, meses }),
      });
      if (r.modo === "ghl_stripe") {
        const url = validateGhlUrl(r.checkout_url);
        if (!url) throw new Error(t("Link de pago inválido. Escríbenos a hola@medellin.social.", "Invalid payment link. Email hola@medellin.social."));
        window.location.href = url;
        return;
      }
      setMsg({ ok: true, text: t("El pago online abre muy pronto. Te avisamos por correo apenas esté listo.", "Online payment opens very soon. We'll email you as soon as it's ready.") });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (/No eres agente/i.test(m)) {
        setMsg({ ok: false, text: t("Necesitas un perfil de agente verificado para comprar un lugar.", "You need a verified agent profile to buy a spot.") });
      } else {
        setMsg({ ok: false, text: m || t("No pudimos iniciar el pago.", "We couldn't start the payment.") });
      }
    } finally { setBusy(false); }
  }

  const card: React.CSSProperties = { background: "#fff", border: `1px solid ${K.line}`, borderRadius: 14, padding: 20 };
  const h2: React.CSSProperties = { fontFamily: K.serif, fontSize: "1.35rem", fontWeight: 800, color: K.ink, margin: "0 0 14px" };

  const BULLETS = [
    t("Apareces en la página de tu barrio y comuna, arriba de todo", "You appear on your neighborhood and commune page, at the very top"),
    t("Rotación justa y fija: todos los preferidos de la zona rotan por igual", "Fair, fixed rotation: every preferred realtor in the zone rotates equally"),
    t("Los contactos de compradores y vendedores de tu zona llegan a ti", "Buyer and seller contacts from your zone come to you"),
    t("Insignia «Preferred» en tu perfil y en el directorio de agentes", "“Preferred” badge on your profile and in the agent directory"),
    t("Cupos limitados: 4 por barrio y 8 por comuna", "Limited spots: 4 per neighborhood and 8 per commune"),
  ];

  const TIERS = [
    { n: "Member", p: t("Gratis", "Free"), f: [t("Perfil en el directorio", "Directory profile"), t("Reseñas de clientes", "Client reviews")], hi: false },
    { n: "Certified", p: t("Por verificación", "By verification"), f: [t("Todo Member", "Everything in Member"), t("Insignia de verificado", "Verified badge")], hi: false },
    { n: "Preferred", p: t("Por zona, mensual", "Per zone, monthly"), f: [t("Todo Certified", "Everything in Certified"), t("Visibilidad destacada en tu zona", "Featured visibility in your zone"), t("Leads de tu zona", "Leads from your zone")], hi: true },
  ];

  const COMP: [string, string, string][] = [
    [t("Dónde te ven", "Where you're seen"), t("Avisos individuales entre miles", "Single listings among thousands"), t("Página de tu barrio y comuna, en la cima", "Your neighborhood and commune page, on top")],
    [t("Competencia en tu zona", "Competition in your zone"), t("Ilimitada", "Unlimited"), t("Máximo 4 por barrio / 8 por comuna", "At most 4 per neighborhood / 8 per commune")],
    [t("Datos del barrio", "Neighborhood data"), t("Precios de oferta", "Asking prices"), t("Precios, mapa y comunidad del barrio", "Prices, map and neighborhood community")],
    [t("Exposición", "Exposure"), t("Depende de pagar más por aviso", "Depends on paying more per listing"), t("Rotación fija y equitativa", "Fixed, equal rotation")],
  ];

  const FAQ = [
    [t("¿Cómo funciona la rotación?", "How does the rotation work?"), t("Los preferidos de tu zona se muestran en orden fijo y repetitivo. Nadie tiene prioridad sobre otro.", "Preferred realtors in your zone are shown in a fixed, repeating order. Nobody gets priority over another.")],
    [t("¿Por qué el precio cambia según la zona?", "Why does the price depend on the zone?"), t("Las zonas con más demanda cuestan más. El nivel (A a D) se calcula con datos del mercado.", "Higher-demand zones cost more. The level (A to D) is computed from market data.")],
    [t("¿Qué pasa si la zona se llena?", "What if the zone is full?"), t("Verás 0 cupos y no se cobra. Escríbenos y te avisamos cuando se libere uno.", "You'll see 0 spots and nothing is charged. Email us and we'll tell you when one opens.")],
    [t("¿Cobran si el dueño vende sin agente?", "Do you charge if an owner sells without an agent?"), t("No. Solo se paga el lugar preferido, nunca comisión por ventas sin agente.", "No. You only pay for the preferred spot, never a commission on agent-free sales.")],
    [t("¿Cómo pago?", "How do I pay?"), t("Con tarjeta, de forma segura, a través de Stripe. Recibes confirmación por correo.", "By card, securely, via Stripe. You get an email confirmation.")],
  ];

  return (
    <ComunidadLayout>
      <div style={{ background: `linear-gradient(135deg, ${K.tealDeep} 0%, ${K.tealMid} 50%, ${K.teal} 100%)`, padding: "56px 20px 48px", textAlign: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 12 }}>
          {t("Para agentes inmobiliarios", "For real estate agents")}
        </p>
        <h1 style={{ fontFamily: K.serif, fontSize: "clamp(2rem,5vw,3rem)", fontWeight: 900, color: "#fff", margin: "0 0 12px", lineHeight: 1.1 }}>
          {t("Sé el Realtor Preferido de tu zona", "Be your zone's Preferred Realtor")}
        </h1>
        <p style={{ color: "rgba(255,255,255,0.82)", fontSize: 15, maxWidth: 520, margin: "0 auto 28px", lineHeight: 1.65 }}>
          {t("Quien busca vivir, comprar o vender en tu barrio te ve primero. Pocos cupos por zona.", "People looking to live, buy or sell in your neighborhood see you first. Few spots per zone.")}
        </p>
        <a href="#zona" style={{ display: "inline-block", background: K.dorado, color: K.ink, fontWeight: 800, padding: "13px 28px", borderRadius: 999, textDecoration: "none", fontSize: 15 }}>
          {t("Elegir mi zona →", "Choose my zone →")}
        </a>
      </div>

      <div style={{ background: K.paper }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 72px", display: "grid", gap: 36 }}>

          {/* Video */}
          <div style={{ ...card, padding: 0, overflow: "hidden", aspectRatio: "16/9", background: K.tealDeep, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }} role="img" aria-label={t("Video explicativo próximamente", "Explainer video coming soon")}>
            <span style={{ fontSize: 14, opacity: 0.85 }}>▶ {t("Video: cómo funciona (próximamente)", "Video: how it works (coming soon)")}</span>
          </div>

          <section>
            <h2 style={h2}>{t("Qué recibes", "What you get")}</h2>
            <div style={card}>
              {BULLETS.map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < BULLETS.length - 1 ? `1px solid ${K.line}` : "none" }}>
                  <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: K.tealLight, color: K.teal, fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                  <span style={{ fontSize: 14, color: K.ink }}>{b}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={h2}>{t("Frente a un portal de avisos", "Versus a listings portal")}</h2>
            <div style={{ ...card, padding: 0, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
                <thead>
                  <tr style={{ background: K.faint, textAlign: "left" }}>
                    <th style={{ padding: 12 }}></th>
                    <th style={{ padding: 12, color: K.muted }}>{t("Portal de avisos", "Listings portal")}</th>
                    <th style={{ padding: 12, color: K.teal }}>Medellín Social</th>
                  </tr>
                </thead>
                <tbody>
                  {COMP.map(([a, b, c]) => (
                    <tr key={a} style={{ borderTop: `1px solid ${K.line}` }}>
                      <td style={{ padding: 12, fontWeight: 700, color: K.ink }}>{a}</td>
                      <td style={{ padding: 12, color: K.muted }}>{b}</td>
                      <td style={{ padding: 12, color: K.ink, fontWeight: 600 }}>{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 style={h2}>{t("Tres niveles", "Three tiers")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
              {TIERS.map((x) => (
                <div key={x.n} style={{ ...card, border: x.hi ? `2px solid ${K.teal}` : card.border }}>
                  <p style={{ fontFamily: K.serif, fontWeight: 800, fontSize: 18, margin: "0 0 2px", color: x.hi ? K.teal : K.ink }}>{x.n}</p>
                  <p style={{ fontSize: 12, color: K.muted, margin: "0 0 12px" }}>{x.p}</p>
                  {x.f.map((f) => <p key={f} style={{ fontSize: 13, margin: "6px 0", color: K.ink }}>✓ {f}</p>)}
                </div>
              ))}
            </div>
          </section>

          {/* Selector de zona */}
          <section id="zona">
            <h2 style={h2}>{t("Elige tu zona", "Choose your zone")}</h2>
            <div style={card}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {(["barrio", "comuna"] as Nivel[]).map((n) => (
                  <button key={n} onClick={() => { setNivel(n); setSel(null); setQ(""); }} aria-pressed={nivel === n}
                    style={{ padding: "8px 18px", borderRadius: 999, border: `1px solid ${nivel === n ? K.teal : K.line}`, background: nivel === n ? K.teal : "#fff", color: nivel === n ? "#fff" : K.ink, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    {n === "barrio" ? t("Barrio", "Neighborhood") : t("Comuna", "Commune")}
                  </button>
                ))}
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar por nombre…", "Search by name…")} aria-label={t("Buscar zona", "Search zone")}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${K.line}`, borderRadius: 10, fontSize: 14, marginBottom: 10, fontFamily: "inherit" }} />
              <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${K.line}`, borderRadius: 10 }}>
                {isLoading && <p style={{ padding: 14, color: K.muted, fontSize: 13 }}>{t("Cargando zonas…", "Loading zones…")}</p>}
                {isError && <p style={{ padding: 14, color: K.rojo, fontSize: 13 }}>{t("No pudimos cargar las zonas. Recarga la página.", "We couldn't load the zones. Reload the page.")}</p>}
                {!isLoading && !isError && lista.length === 0 && <p style={{ padding: 14, color: K.muted, fontSize: 13 }}>{t("Sin resultados.", "No results.")}</p>}
                {lista.map((z) => {
                  const lleno = z.cupos === 0;
                  const on = z.zona_codigo === sel;
                  return (
                    <button key={z.zona_codigo} disabled={lleno} onClick={() => setSel(z.zona_codigo)} aria-pressed={on}
                      style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "11px 14px", border: "none", borderBottom: `1px solid ${K.line}`, background: on ? K.tealLight : "#fff", cursor: lleno ? "not-allowed" : "pointer", opacity: lleno ? 0.5 : 1, textAlign: "left", fontFamily: "inherit" }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: K.ink }}>{z.nombre}{z.municipio && z.municipio !== "MEDELLIN" ? ` · ${z.municipio.charAt(0) + z.municipio.slice(1).toLowerCase()}` : ""}</span>
                      <span style={{ fontSize: 12, color: K.muted, whiteSpace: "nowrap" }}>
                        {cop(z.precio_mensual)}/{t("mes", "mo")} · {lleno ? t("lleno", "full") : `${z.cupos} ${z.cupos === 1 ? t("cupo", "spot") : t("cupos", "spots")}`}
                      </span>
                    </button>
                  );
                })}
              </div>

              {zona && (
                <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                  <label style={{ fontSize: 13, color: K.muted }}>
                    {t("Meses", "Months")}{" "}
                    <select value={meses} onChange={(e) => setMeses(Number(e.target.value))} style={{ padding: "6px 8px", marginLeft: 6, borderRadius: 8, border: `1px solid ${K.line}`, fontFamily: "inherit" }}>
                      {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                  <p style={{ fontSize: 14, color: K.ink, margin: 0 }}>
                    <strong>{zona.nombre}</strong> — {cop(zona.precio_mensual * meses)} {t("en total", "total")}
                  </p>
                  <button onClick={comprar} disabled={busy}
                    style={{ background: K.teal, color: "#fff", border: "none", borderRadius: 999, padding: "13px 24px", fontWeight: 800, fontSize: 15, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
                    {busy ? t("Un momento…", "One moment…") : getToken() ? t("Pagar y activar →", "Pay and activate →") : t("Inicia sesión para continuar →", "Sign in to continue →")}
                  </button>
                  {!getToken() && (
                    <p style={{ fontSize: 12, color: K.muted, margin: 0 }}>
                      {t("¿Aún no eres agente?", "Not an agent yet?")} <a href="/agentes/registro" style={{ color: K.teal }}>{t("Regístrate", "Sign up")}</a>
                    </p>
                  )}
                </div>
              )}
              {msg && <p role="status" style={{ marginTop: 12, fontSize: 13, color: msg.ok ? K.teal : K.rojo }}>{msg.text}</p>}
              <p style={{ fontSize: 11, color: K.tertiary, marginTop: 14 }}>
                {t("Precios mensuales en pesos colombianos. Pago seguro con Stripe.", "Monthly prices in Colombian pesos. Secure payment via Stripe.")}
              </p>
            </div>
          </section>

          <section>
            <h2 style={h2}>{t("Preguntas frecuentes", "FAQ")}</h2>
            {FAQ.map(([a, b]) => (
              <details key={a} style={{ borderBottom: `1px solid ${K.line}`, padding: "12px 0" }}>
                <summary style={{ fontWeight: 700, fontSize: 14, cursor: "pointer", color: K.ink }}>{a}</summary>
                <p style={{ fontSize: 13, color: K.muted, lineHeight: 1.7, margin: "8px 0 0" }}>{b}</p>
              </details>
            ))}
            <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: K.muted }}>
              {t("¿Más preguntas?", "More questions?")} <a href="mailto:hola@medellin.social" style={{ color: K.teal }}>hola@medellin.social</a>
            </p>
          </section>
        </div>
      </div>
    </ComunidadLayout>
  );
}
