import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { auth } from "@/lib/auth";
import { authHeaders, authCredentials } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

interface Agente {
  id: number;
  nombre_completo: string;
  foto_perfil: string | null;
  whatsapp: string | null;
  zonas_opera: number[] | null;
  email: string | null;
  telefono: string | null;
}

export const Route = createFileRoute("/conectar-agente")({
  head: () => seo({ title: "Conecta con un agente · Medellín Social", description: "Te conectamos con un agente inmobiliario verificado de tu zona.", path: "/conectar-agente" }),
  validateSearch: (s: Record<string, unknown>) => ({
    // listing.id es UUID (modelo unificado). Se conserva como string.
    listing_id: s.listing_id != null ? String(s.listing_id) : "",
  }),
  component: ConectarAgentePage,
});

function ConectarAgentePage() {
  const { listing_id } = Route.useSearch();
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? auth.get() : null;

  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(true);
  const [enviadas, setEnviadas] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    fetch(API_ENDPOINTS.listingsPropiosAgentes)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (Array.isArray(data)) setAgentes(data);
      })
      .catch(() => setError("No se pudieron cargar los agentes."))
      .finally(() => setLoading(false));
  }, []);

  async function solicitar(agenteId: number) {
    if (!listing_id) {
      setError("No se especificó una propiedad. Vuelve a /publicar.");
      return;
    }
    setSending(agenteId);
    try {
      const fd = new FormData();
      fd.append("listing_id", String(listing_id));
      fd.append("agente_id", String(agenteId));

      const res = await fetch(API_ENDPOINTS.listingsPropiosSolicitudes, {
        method: "POST",
        headers: authHeaders(),
        credentials: authCredentials,
        body: fd,
      });

      if (res.status === 409) {
        setError("Ya enviaste una solicitud a este agente.");
        setSending(null);
        return;
      }
      if (!res.ok) throw new Error(await res.text());

      setEnviadas((prev) => new Set(prev).add(agenteId));
    } catch {
      setError("Error enviando solicitud. Intenta de nuevo.");
    } finally {
      setSending(null);
    }
  }

  if (!user) return null;

  return (
    <ComunidadLayout>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
        {/* Header */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <h1 style={{ fontFamily: K.serif, fontSize: "1.9rem", fontWeight: 900, color: K.ink, marginBottom: 10 }}>
            Conecta con un agente verificado
          </h1>
          <p style={{ color: K.muted, fontSize: 14, lineHeight: 1.7, maxWidth: 520, margin: "0 auto" }}>
            Un agente gestionará tu propiedad, la promoverá y te conectará con compradores. Tu propiedad se activa de inmediato en el MLS.
          </p>
          {listing_id ? (
            <div style={{
              display: "inline-block", marginTop: 12,
              background: K.tealLight, border: `1px solid ${K.teal}`,
              borderRadius: 20, padding: "4px 14px",
              fontSize: 12, color: K.tealDeep, fontWeight: 700,
            }}>
              Propiedad #{listing_id}
            </div>
          ) : (
            <div style={{
              marginTop: 12, padding: "10px 16px",
              background: "#FFF6D6", border: "1px solid #FFC107",
              borderRadius: 8, fontSize: 13, color: "#856404",
            }}>
              Sin propiedad seleccionada. Publica primero desde <a href="/publicar" style={{ color: K.teal }}>aquí</a>.
            </div>
          )}
        </div>

        {error && (
          <div style={{
            background: "#FCE8EA", border: `1px solid ${K.coral}`,
            borderRadius: 8, padding: "10px 14px", marginBottom: 20,
            fontSize: 13, color: K.coral,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            {error}
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: K.coral, fontWeight: 700 }}>✕</button>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: K.muted }}>Cargando agentes…</div>
        )}

        {!loading && agentes.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: K.muted }}>No hay agentes disponibles en este momento.</div>
        )}

        <div style={{ display: "grid", gap: 20 }}>
          {agentes.map((a) => {
            const sent = enviadas.has(a.id);
            const isSending = sending === a.id;
            const partes = (a.nombre_completo ?? "").trim().split(/\s+/);
            const initials = `${partes[0]?.[0] ?? ""}${partes[1]?.[0] ?? ""}`.toUpperCase();
            const barrios = a.zonas_opera?.slice(0, 3).join(", ") ?? "";

            return (
              <div
                key={a.id}
                style={{
                  background: "#fff",
                  border: `1px solid ${sent ? K.teal : K.line}`,
                  borderRadius: 14,
                  padding: "20px 24px",
                  display: "flex", gap: 18, alignItems: "flex-start",
                  boxShadow: sent ? `0 0 0 2px ${K.teal}22` : "none",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${K.teal}, ${K.tealDeep})`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, fontWeight: 800, color: "#fff",
                  flexShrink: 0, overflow: "hidden",
                }}>
                  {a.foto_perfil
                    ? <img src={a.foto_perfil} alt={a.nombre_completo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : initials}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 15, color: K.ink }}>
                      {a.nombre_completo}
                    </span>
                    <span style={{
                      background: K.tealLight, color: K.tealDeep,
                      borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 700,
                    }}>
                      Verificado
                    </span>
                  </div>

                  {barrios && (
                    <p style={{ fontSize: 12, color: K.muted, marginBottom: 0 }}>
                      <strong style={{ color: K.ink }}>Zonas:</strong> {barrios}
                    </p>
                  )}
                </div>

                {/* CTA */}
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  {sent ? (
                    <div style={{
                      background: K.tealLight, color: K.tealDeep,
                      borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 13,
                    }}>
                      Solicitud enviada ✓
                    </div>
                  ) : (
                    <button
                      disabled={isSending || !listing_id}
                      onClick={() => solicitar(a.id)}
                      style={{
                        background: isSending ? K.tealLight : K.teal,
                        color: isSending ? K.teal : "#fff",
                        border: "none", borderRadius: 8,
                        padding: "9px 18px", fontWeight: 700, fontSize: 13,
                        cursor: isSending || !listing_id ? "not-allowed" : "pointer",
                        opacity: !listing_id ? 0.5 : 1,
                        transition: "background 0.15s",
                      }}
                    >
                      {isSending ? "Enviando…" : "Solicitar gestión"}
                    </button>
                  )}
                  {a.whatsapp && (
                    <a
                      href={`https://wa.me/${a.whatsapp.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 12, color: K.teal, fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      WhatsApp →
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {enviadas.size > 0 && (
          <div style={{
            marginTop: 32, textAlign: "center",
            background: K.tealLight, border: `1px solid ${K.teal}`,
            borderRadius: 12, padding: "20px 24px",
          }}>
            <p style={{ fontWeight: 700, color: K.tealDeep, marginBottom: 6 }}>
              ¡Solicitudes enviadas!
            </p>
            <p style={{ fontSize: 13, color: K.muted, marginBottom: 16 }}>
              Los agentes revisarán tu propiedad y te responderán pronto. Recibirás un email de confirmación.
            </p>
            <a
              href="/"
              style={{
                display: "inline-block",
                background: K.teal, color: "#fff",
                padding: "9px 20px", borderRadius: 6,
                fontWeight: 700, fontSize: 13, textDecoration: "none",
              }}
            >
              Volver al inicio
            </a>
          </div>
        )}
      </div>
    </ComunidadLayout>
  );
}
