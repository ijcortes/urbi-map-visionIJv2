import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { formatCOP, formatDate } from "@/lib/format";
import { useState, useEffect } from "react";
import { auth } from "@/lib/auth";
import { authHeaders, authCredentials } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

interface Solicitud {
  id: number;
  estado: string;
  mensaje: string | null;
  created_at: string;
  listing_id: number;
  tipo_operacion: string;
  tipo_inmueble: string;
  precio_cop: number;
  area_m2: number | null;
  habitaciones: number | null;
  barrio_id: number | null;
  direccion: string | null;
  fotos: string[] | null;
  propietario_nombre: string;
  propietario_apellido: string;
  propietario_email: string;
}

export const Route = createFileRoute("/solicitudes")({
  head: () => seo({ title: "Solicitudes · Medellín Social", description: "Solicitudes de tus inmuebles.", noindex: true }),
  component: SolicitudesPage,
});

function SolicitudesPage() {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? auth.get() : null;

  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notAgente, setNotAgente] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    fetch(API_ENDPOINTS.listingsPropiosSolicitudesPendientes, {
      headers: authHeaders(),
      credentials: authCredentials,
    })
      .then(async (r) => {
        if (r.status === 403) { setNotAgente(true); return []; }
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setSolicitudes(data);
      })
      .catch(() => setError("No se pudieron cargar las solicitudes."))
      .finally(() => setLoading(false));
  }, []);

  async function responder(solId: number, accion: "aceptar" | "rechazar") {
    setProcessing(solId);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("accion", accion);
      const res = await fetch(API_ENDPOINTS.listingsPropiosSolicitudById(solId), {
        method: "PATCH",
        headers: authHeaders(),
        credentials: authCredentials,
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());

      setSolicitudes((prev) =>
        prev.map((s) => s.id === solId ? { ...s, estado: accion === "aceptar" ? "aceptada" : "rechazada" } : s)
      );
    } catch {
      setError("Error procesando la solicitud. Intenta de nuevo.");
    } finally {
      setProcessing(null);
    }
  }

  if (!user) return null;

  const pendientes = solicitudes.filter((s) => s.estado === "pendiente");
  const procesadas = solicitudes.filter((s) => s.estado !== "pendiente");

  return (
    <ComunidadLayout>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px" }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: K.serif, fontSize: "1.9rem", fontWeight: 900, color: K.ink, marginBottom: 8 }}>
            Solicitudes de gestión
          </h1>
          <p style={{ color: K.muted, fontSize: 14 }}>
            Propietarios que quieren que gestiones su propiedad en el MLS.
          </p>
        </div>

        {error && (
          <div style={{
            background: K.coralLight, border: `1px solid ${K.coral}`,
            borderRadius: 8, padding: "10px 14px", marginBottom: 20,
            fontSize: 13, color: K.coral,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            {error}
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: K.coral, fontWeight: 700 }}>✕</button>
          </div>
        )}

        {notAgente && (
          <div style={{
            background: K.coralLight, border: `1px solid ${K.coral}`,
            borderRadius: 12, padding: "24px",
            textAlign: "center",
          }}>
            <p style={{ fontWeight: 700, color: K.coral, marginBottom: 8 }}>Acceso restringido</p>
            <p style={{ fontSize: 13, color: K.muted }}>Esta sección es solo para agentes verificados.</p>
          </div>
        )}

        {loading && !notAgente && (
          <div style={{ textAlign: "center", padding: 40, color: K.muted }}>Cargando solicitudes…</div>
        )}

        {!loading && !notAgente && solicitudes.length === 0 && (
          <div style={{
            textAlign: "center", padding: "48px 24px",
            border: `1px dashed ${K.line}`, borderRadius: 14,
            color: K.muted,
          }}>
            <p style={{ fontSize: 18, marginBottom: 8 }}>Sin solicitudes pendientes</p>
            <p style={{ fontSize: 13 }}>Cuando un propietario te solicite, aparecerá aquí.</p>
          </div>
        )}

        {/* Pendientes */}
        {pendientes.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontFamily: K.serif, fontSize: "1.1rem", fontWeight: 700, color: K.ink, marginBottom: 16 }}>
              Pendientes ({pendientes.length})
            </h2>
            <div style={{ display: "grid", gap: 16 }}>
              {pendientes.map((s) => (
                <SolicitudCard
                  key={s.id}
                  sol={s}
                  processing={processing === s.id}
                  onAceptar={() => responder(s.id, "aceptar")}
                  onRechazar={() => responder(s.id, "rechazar")}
                />
              ))}
            </div>
          </section>
        )}

        {/* Procesadas */}
        {procesadas.length > 0 && (
          <section>
            <h2 style={{ fontFamily: K.serif, fontSize: "1.1rem", fontWeight: 700, color: K.ink, marginBottom: 16 }}>
              Historial ({procesadas.length})
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              {procesadas.map((s) => (
                <SolicitudCard
                  key={s.id}
                  sol={s}
                  processing={false}
                  onAceptar={() => {}}
                  onRechazar={() => {}}
                  readOnly
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </ComunidadLayout>
  );
}

function SolicitudCard({
  sol,
  processing,
  onAceptar,
  onRechazar,
  readOnly = false,
}: {
  sol: Solicitud;
  processing: boolean;
  onAceptar: () => void;
  onRechazar: () => void;
  readOnly?: boolean;
}) {
  const foto = sol.fotos?.[0];
  const precio = formatCOP(sol.precio_cop);
  const propietario = `${sol.propietario_nombre} ${sol.propietario_apellido}`.trim();
  const date = formatDate(sol.created_at);

  const estadoBadge = {
    pendiente:  { bg: "#FFF6D6", color: "#856404", label: "Pendiente" },
    aceptada:   { bg: K.tealLight, color: K.tealDeep, label: "Aceptada" },
    rechazada:  { bg: K.coralLight, color: K.coral, label: "Rechazada" },
  }[sol.estado] ?? { bg: K.tealLight, color: K.tealDeep, label: sol.estado };

  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${K.line}`,
      borderRadius: 14,
      overflow: "hidden",
      opacity: readOnly && sol.estado === "rechazada" ? 0.7 : 1,
      transition: "opacity 0.2s",
    }}>
      <div style={{ display: "flex", gap: 0 }}>
        {/* Foto */}
        {foto && (
          <div style={{
            width: 100, flexShrink: 0,
            background: K.line,
            overflow: "hidden",
          }}>
            <img src={foto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14, color: K.ink }}>
                {sol.tipo_inmueble} en {sol.tipo_operacion}
              </span>
              {sol.direccion && (
                <span style={{ fontSize: 12, color: K.muted, marginLeft: 8 }}>{sol.direccion}</span>
              )}
            </div>
            <span style={{
              background: estadoBadge.bg, color: estadoBadge.color,
              borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {estadoBadge.label}
            </span>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: K.tealDeep }}>{precio}</span>
            {sol.area_m2 && <span style={{ fontSize: 13, color: K.muted }}>{sol.area_m2} m²</span>}
            {sol.habitaciones && <span style={{ fontSize: 13, color: K.muted }}>{sol.habitaciones} hab.</span>}
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: sol.mensaje ? 10 : 0, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: K.muted }}>
              Propietario: <strong style={{ color: K.ink }}>{propietario}</strong>
            </span>
            <a href={`mailto:${sol.propietario_email}`} style={{ fontSize: 12, color: K.teal }}>
              {sol.propietario_email}
            </a>
            <span style={{ fontSize: 12, color: K.muted }}>{date}</span>
          </div>

          {sol.mensaje && (
            <div style={{
              background: K.paper, borderRadius: 6, padding: "8px 12px",
              fontSize: 13, color: K.ink, fontStyle: "italic", marginBottom: 0,
              borderLeft: `3px solid ${K.teal}`,
            }}>
              "{sol.mensaje}"
            </div>
          )}
        </div>

        {/* Actions */}
        {!readOnly && sol.estado === "pendiente" && (
          <div style={{
            flexShrink: 0, display: "flex", flexDirection: "column",
            gap: 8, padding: "16px", justifyContent: "center",
            borderLeft: `1px solid ${K.line}`,
          }}>
            <button
              disabled={processing}
              onClick={onAceptar}
              style={{
                background: K.teal, color: "#fff",
                border: "none", borderRadius: 8,
                padding: "10px 18px", fontWeight: 700, fontSize: 13,
                cursor: processing ? "not-allowed" : "pointer",
                opacity: processing ? 0.6 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {processing ? "…" : "Aceptar"}
            </button>
            <button
              disabled={processing}
              onClick={onRechazar}
              style={{
                background: "#fff", color: K.coral,
                border: `1px solid ${K.coral}`, borderRadius: 8,
                padding: "10px 18px", fontWeight: 700, fontSize: 13,
                cursor: processing ? "not-allowed" : "pointer",
                opacity: processing ? 0.6 : 1,
                whiteSpace: "nowrap",
              }}
            >
              Rechazar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
