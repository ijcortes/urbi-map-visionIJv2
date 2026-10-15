import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Heart, CalendarClock, Plus, ShieldCheck, Clock, Maximize2, BedDouble, MapPin } from "@/lib/icons";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { auth } from "@/lib/auth";
import { formatCOP } from "@/lib/format";
import { SiteNavbar } from "@/components/SiteNavbar";
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute("/mis-propiedades")({
  head: () => seo({ title: "Mis propiedades · Medellín Social", description: "Gestiona tus inmuebles publicados.", noindex: true }),
  component: MisPropiedades,
});

// Listing del owner con métricas de desempeño (backend: /listings-propios/mis-listings).
type MiPropiedad = {
  id: string;
  tipo_operacion: string;
  tipo_inmueble: string;
  precio_cop: number | null;
  area_m2: number | null;
  habitaciones: number | null;
  estado: string;
  verificado: boolean;
  destacado: boolean;
  descripcion: string | null;
  direccion: string | null;
  barrio: string | null;
  municipio: string | null;
  fotos: string[];
  verificacion_label: string;
  vistas_total: number;
  vistas_30d: number;
  favoritos: number;
  visitas_total: number;
  visitas_pendientes: number;
};

const K = TOKENS;

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: K.muted }}>{icon}</span>
      <span className="text-sm font-semibold" style={{ color: K.ink }}>{value}</span>
      <span className="text-xs" style={{ color: K.muted }}>{label}</span>
    </div>
  );
}

function SummaryTile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex-1 rounded-xl border px-4 py-3 text-center" style={{ borderColor: K.line, background: "#FFFFFF" }}>
      <div className="text-xl font-bold" style={{ color: K.ink, fontFamily: K.serif }}>{value}</div>
      <div className="text-[11px]" style={{ color: K.muted }}>{label}</div>
    </div>
  );
}

function MisPropiedades() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!auth.get()) navigate({ to: "/login" });
  }, [navigate]);

  const { data, isLoading, error } = useQuery<MiPropiedad[]>({
    queryKey: ["mis-propiedades"],
    queryFn: () => apiFetch<MiPropiedad[]>(API_ENDPOINTS.listingsPropiosMis),
    enabled: !!auth.get(),
  });

  const props = data ?? [];
  const totVistas = props.reduce((s, p) => s + p.vistas_30d, 0);
  const totGuardados = props.reduce((s, p) => s + p.favoritos, 0);
  const totVisitas = props.reduce((s, p) => s + p.visitas_pendientes, 0);

  return (
    <div style={{ background: K.paper, minHeight: "100dvh" }}>
      <SiteNavbar />
      {/* pt-24 despeja el SiteNavbar fijo */}
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-24">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: K.serif, color: K.ink }}>
              Mis propiedades
            </h1>
            <p className="text-sm" style={{ color: K.muted }}>Desempeño y estado de tus publicaciones</p>
          </div>
          <Link
            to="/publicar"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: K.teal }}
          >
            <Plus className="h-4 w-4" /> Publicar
          </Link>
        </div>

        {isLoading && <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>}
        {error && <p className="text-sm" style={{ color: "#CE1126" }}>No pudimos cargar tus propiedades.</p>}
        {!isLoading && !error && props.length === 0 && (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: K.line, background: "#FFFFFF" }}>
            <div className="mb-2 text-3xl">🏡</div>
            <p className="text-sm font-medium" style={{ color: K.ink }}>Aún no has publicado ninguna propiedad</p>
            <Link to="/publicar" className="mt-3 inline-block text-sm font-semibold" style={{ color: K.teal }}>
              Publica la primera →
            </Link>
          </div>
        )}

        {props.length > 0 && (
          <div className="mb-5 flex gap-2">
            <SummaryTile value={props.length} label={props.length === 1 ? "propiedad" : "propiedades"} />
            <SummaryTile value={totVistas} label="vistas (30d)" />
            <SummaryTile value={totGuardados} label="guardados" />
            <SummaryTile value={totVisitas} label="visitas pend." />
          </div>
        )}

        <div className="space-y-3">
          {props.map((p) => {
            const esArriendo = p.tipo_operacion === "arriendo";
            return (
              <div key={p.id} className="overflow-hidden rounded-2xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
                <div className="flex gap-3 p-3">
                  <div className="h-28 w-36 shrink-0 overflow-hidden rounded-xl bg-[#F3F0E8]">
                    {p.fotos?.[0]
                      ? <img src={p.fotos[0]} alt="" className="h-full w-full object-cover" />
                      : <div className="grid h-full w-full place-items-center text-2xl">🏠</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                        style={{ background: esArriendo ? K.teal : K.coral }}>
                        {esArriendo ? "Arriendo" : "Venta"}
                      </span>
                      {p.destacado && (
                        <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: K.dorado, color: K.ink }}>
                          ★ Destacado
                        </span>
                      )}
                      <span
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={p.verificado ? { background: "#E7F4EC", color: K.tealDeep } : { background: "#FDF3E7", color: "#9A6A1F" }}
                      >
                        {p.verificado ? <ShieldCheck className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                        {p.verificado ? "Verificada" : p.verificacion_label}
                      </span>
                    </div>
                    <div className="mt-1.5 text-lg font-bold leading-tight" style={{ color: K.ink }}>
                      {p.precio_cop ? formatCOP(p.precio_cop) : "—"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs" style={{ color: K.muted }}>
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate capitalize">
                        {p.tipo_inmueble?.replace(/_/g, " ")} · {[p.barrio, p.municipio].filter(Boolean).join(" · ") || "Medellín"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs" style={{ color: K.ink }}>
                      {p.area_m2 != null && <span className="flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5" style={{ color: K.muted }} />{p.area_m2} m²</span>}
                      {p.habitaciones != null && <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" style={{ color: K.muted }} />{p.habitaciones} hab</span>}
                    </div>
                    {p.descripcion && (
                      <p className="mt-1.5 line-clamp-2 text-xs" style={{ color: K.muted }}>{p.descripcion}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-3 py-2.5" style={{ borderColor: K.line, background: "#FBF9F5" }}>
                  <Metric icon={<Eye className="h-4 w-4" />} value={p.vistas_30d} label={`vistas 30d · ${p.vistas_total} total`} />
                  <Metric icon={<Heart className="h-4 w-4" />} value={p.favoritos} label="guardados" />
                  <Metric icon={<CalendarClock className="h-4 w-4" />} value={p.visitas_pendientes} label={`visitas pend. · ${p.visitas_total} total`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
