import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Bed, Bath, Maximize2, Building2, Calendar,
  TrendingUp, Phone, ExternalLink, AlertCircle, MapPin, Share2, X as CloseIcon,
} from "@/lib/icons";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { MAPBOX_TOKEN } from "@/lib/mapboxToken";
import { yieldColor, yieldLabel } from "@/lib/format";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import type { ApiListingDetail } from "@/lib/adapters";
import { SiteNavbar } from "@/components/SiteNavbar";
import { PhotoGallery } from "@/components/PhotoGallery";
import { toast } from "sonner";
import { OriginalListingLink } from "@/components/OriginalListingLink";

export const Route = createFileRoute("/listing/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/map", search: { listing: Number(params.id) } });
  },
  component: ListingPage,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
});

const SOURCE_LABEL: Record<string, string> = {
  fincaraiz: "Ver en Fincaraíz",
  metrocuadrado: "Ver en Metrocuadrado",
  medellinliving: "Ver en MedellinLiving",
};

function TipoOpBadge({ tipo }: { tipo?: string | null }) {
  return (
    <span
      className="rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wider"
      style={{
        background: tipo === "arriendo" ? "#0F8A4F" : "#CE1126",
        color:      "#FFFFFF",
      }}
    >
      {tipo ?? "—"}
    </span>
  );
}

function PriceBadge({
  pctBajoMediana,
  tipoOp,
}: {
  pctBajoMediana?: number | null;
  tipoOp?: string | null;
}) {
  if (pctBajoMediana == null) return null;
  let label: string, color: string, emoji: string, desc: string;
  if (pctBajoMediana > 10) {
    label = "BUENA OFERTA";
    color = "#0A5C36";
    emoji = "🟢";
    desc =
      tipoOp === "arriendo"
        ? `${pctBajoMediana.toFixed(0)}% bajo el arriendo mediano del barrio`
        : `${pctBajoMediana.toFixed(0)}% bajo la mediana de precio/m²`;
  } else if (pctBajoMediana < -15) {
    label = "SOBRE PRECIO";
    color = "#CE1126";
    emoji = "🔴";
    desc = `${Math.abs(pctBajoMediana).toFixed(0)}% sobre la mediana del barrio`;
  } else {
    label = "PRECIO JUSTO";
    color = "#6E726E";
    emoji = "⚪";
    desc = "Dentro del rango habitual del barrio";
  }
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: `${color}18`, border: `1px solid ${color}44` }}
    >
      <div className="text-sm font-bold" style={{ color }}>
        {emoji} {label}
      </div>
      <div className="mt-0.5 text-xs" style={{ color: '#5B5F5C' }}>{desc}</div>
    </div>
  );
}

function ScoreBar({
  label,
  value,
  max = 100,
}: {
  label: string;
  value?: number | null;
  max?: number;
}) {
  const pct = value != null ? Math.min(100, (value / max) * 100) : 0;
  const color =
    value != null
      ? pct >= 70
        ? "#0F8A4F"
        : pct >= 50
          ? "#8A6A00"
          : "#CE1126"
      : "#6E726E";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold" style={{ color }}>
          {value != null ? value.toFixed(0) : "—"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function Chip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm" style={{ border: '0.5px solid #E5E0D5', background: '#F3F0E8' }}>
      <span className="text-muted-foreground">{icon}</span>
      <span style={{ color: '#111418' }}>{label}</span>
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-xl p-5 text-center" style={{ border: '1px dashed #E5E0D5' }}>
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-1 text-xs italic" style={{ color: '#6E726E' }}>Será agregado próximamente</div>
    </div>
  );
}

// ─── Exported for modal reuse ─────────────────────────────────────────────────
export function ListingDetailContent({
  listing,
  similares = [],
  onClose,
  isModal = false,
}: {
  listing: ApiListingDetail;
  similares?: ApiListingDetail[];
  onClose?: () => void;
  isModal?: boolean;
}) {
  const { lat, lon } = listing;
  const { formatPrice, formatSecondary, formatPricePerArea } = usePriceFormat();
  const fuente = (listing.fuente ?? "").toLowerCase();
  const tipoOp = listing.tipo_operacion ?? "venta";

  const heroMapUrl =
    lat != null && lon != null
      ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-l+1D9E75(${lon},${lat})/${lon},${lat},15,0/800x400@2x?access_token=${MAPBOX_TOKEN}`
      : null;

  const waText = encodeURIComponent(
    `Hola, me interesa este listing en ${listing.barrio_nombre ?? ""} de ${formatPrice(listing.precio_cop)}. ID: ${listing.id}`,
  );
  const waUrl = `https://wa.me/+573122502394?text=${waText}`;

  const similarList = similares.filter((l) => l.id !== listing.id).slice(0, 4);

  const detailRows = [
    { label: "Tipo de operación", value: tipoOp.charAt(0).toUpperCase() + tipoOp.slice(1) },
    { label: "Tipo de inmueble", value: listing.tipo_inmueble },
    { label: "Área", value: listing.area_m2 ? `${listing.area_m2} m²` : null },
    { label: "Habitaciones", value: listing.habitaciones },
    { label: "Baños", value: listing.banos },
    { label: "Estrato", value: listing.estrato_real },
    { label: "Municipio", value: listing.municipio },
    { label: "Barrio", value: listing.barrio_nombre },
    { label: "Fuente", value: listing.fuente },
    {
      label: "Días en mercado",
      value: listing.dias_en_mercado != null ? `${listing.dias_en_mercado} días` : null,
    },
    {
      label: "Disponibilidad",
      value:
        listing.disponible_actualmente === false
          ? "Posiblemente no disponible"
          : listing.disponible_actualmente === true
            ? "Disponible"
            : null,
    },
  ].filter((r) => r.value != null);

  function handleShare() {
    const url = `${window.location.origin}/map?listing=${listing.id}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Link copiado ✅"));
  }

  return (
    <>
      {/* Modal header */}
      {isModal && (
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E5E0D5] bg-background/95 px-5 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0">
            <TipoOpBadge tipo={tipoOp} />
            {listing.tipo_inmueble && (
              <span className="text-sm capitalize text-muted-foreground truncate">
                {listing.tipo_inmueble}
              </span>
            )}
            {listing.barrio_nombre && (
              <span className="text-sm text-muted-foreground truncate hidden sm:inline">
                · {listing.barrio_nombre}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleShare}
              title="Copiar link"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-background/80 hover:text-foreground"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              title="Cerrar"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-background/80 hover:text-foreground"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-4 pb-20 pt-6 sm:px-6">
        <div className={isModal ? "flex flex-col gap-6" : "grid gap-8 lg:grid-cols-[1fr_360px]"}>
          {/* ── LEFT ── */}
          <div className="space-y-8 min-w-0">
            {/* Hero map */}
            <section className="overflow-hidden rounded-2xl border border-[#E5E0D5]">
              {heroMapUrl ? (
                <img
                  src={heroMapUrl}
                  alt={`Ubicación en ${listing.barrio_nombre}`}
                  className="h-72 w-full object-cover sm:h-96"
                />
              ) : (
                <div className="flex h-72 items-center justify-center bg-muted text-sm text-muted-foreground sm:h-96">
                  Sin coordenadas disponibles
                </div>
              )}
              <div className="flex items-center gap-2 border-t border-[#E5E0D5] bg-white px-4 py-2 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                {listing.barrio_nombre && <span>{listing.barrio_nombre}</span>}
                {listing.municipio && <span>· {listing.municipio}</span>}
                {listing.estrato_real != null && <span>· Estrato {listing.estrato_real}</span>}
              </div>
            </section>

            {/* Characteristics */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold" style={{ color: '#111418' }}>Características</h2>
              <div className="flex flex-wrap gap-2">
                {listing.habitaciones != null && (
                  <Chip
                    icon={<Bed className="h-4 w-4" />}
                    label={`${listing.habitaciones} habitación${listing.habitaciones !== 1 ? "es" : ""}`}
                  />
                )}
                {listing.banos != null && (
                  <Chip
                    icon={<Bath className="h-4 w-4" />}
                    label={`${listing.banos} baño${listing.banos !== 1 ? "s" : ""}`}
                  />
                )}
                {listing.area_m2 != null && (
                  <Chip icon={<Maximize2 className="h-4 w-4" />} label={`${listing.area_m2} m²`} />
                )}
                {listing.tipo_inmueble && (
                  <Chip
                    icon={<Building2 className="h-4 w-4" />}
                    label={listing.tipo_inmueble}
                  />
                )}
                {listing.dias_en_mercado != null && (
                  <Chip
                    icon={<Calendar className="h-4 w-4" />}
                    label={`${listing.dias_en_mercado} días en mercado`}
                  />
                )}
              </div>

              <div className="divide-y divide-[#E5E0D5] overflow-hidden rounded-xl border border-[#E5E0D5] bg-[#FAF8F3]">
                {detailRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium capitalize" style={{ color: '#111418' }}>{String(row.value)}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Description */}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold" style={{ color: '#111418' }}>Descripción</h2>
              {listing.descripcion ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {listing.descripcion}
                </p>
              ) : (
                <ComingSoon title="Descripción del inmueble" />
              )}
            </section>

            {/* Investment analysis — venta only, PRO gated */}
            {tipoOp === "venta" && (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold" style={{ color: '#111418' }}>Análisis de inversión</h2>
                <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] p-4">
                    <div className="text-xs text-muted-foreground">Yield estimado (renta larga)</div>
                    <div
                      className="text-2xl font-bold"
                      style={{ color: yieldColor(listing.yield_estimado) }}
                    >
                      {listing.yield_estimado != null
                        ? `${listing.yield_estimado.toFixed(1)}%`
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {listing.yield_estimado != null
                        ? yieldLabel(listing.yield_estimado)
                        : "Sin datos de arriendo en zona"}
                    </div>
                  </div>

                  <div className="space-y-1 rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] p-4">
                    <div className="text-xs text-muted-foreground">vs mediana del barrio</div>
                    <div
                      className="text-2xl font-bold"
                      style={{
                        color:
                          (listing.pct_bajo_mediana ?? 0) > 0 ? "#0A5C36" : "#CE1126",
                      }}
                    >
                      {listing.pct_bajo_mediana != null
                        ? `${listing.pct_bajo_mediana > 0 ? "−" : "+"}${Math.abs(listing.pct_bajo_mediana).toFixed(1)}%`
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Mediana zona:{" "}
                      {listing.precio_m2_mediana_barrio
                        ? formatPricePerArea(listing.precio_m2_mediana_barrio)
                        : "—"}
                    </div>
                  </div>

                  <div className="space-y-1 rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] p-4">
                    <div className="text-xs text-muted-foreground">Período de recupero estimado</div>
                    <div className="text-2xl font-bold">
                      {listing.yield_estimado && listing.yield_estimado > 0
                        ? `${(100 / listing.yield_estimado).toFixed(1)} años`
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">Basado en arriendo mediano del barrio</div>
                  </div>

                  <div className="space-y-1 rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] p-4">
                    <div className="text-xs text-muted-foreground">Arriendo referencia barrio</div>
                    <div className="text-2xl font-bold">
                      {listing.arriendo_p50_barrio
                        ? formatPrice(listing.arriendo_p50_barrio)
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Mediana mensual · {listing.tipo_inmueble ?? "inmueble"}
                    </div>
                  </div>

                  <div className="space-y-1 rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] p-4">
                    <div className="text-xs text-muted-foreground">Ingreso anual estimado</div>
                    <div className="text-2xl font-bold text-primary">
                      {listing.arriendo_p50_barrio
                        ? formatPrice(listing.arriendo_p50_barrio * 12)
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Arriendo p50 × 12 meses
                    </div>
                  </div>

                  <div className="space-y-1 rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] p-4">
                    <div className="text-xs text-muted-foreground">Valorización anual proyectada</div>
                    <div
                      className="text-2xl font-bold"
                      style={{ color: listing.var_anual_pct != null ? "#0F8A4F" : "#6E726E" }}
                    >
                      {listing.var_anual_pct != null
                        ? `+${listing.var_anual_pct.toFixed(1)}%`
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">Proyección histórica del barrio</div>
                  </div>
                </div>

                <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-5 text-center">
                  <div className="text-sm font-medium text-primary">Simulador de rentabilidad</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Simulación detallada con costos, impuestos y proyecciones — próximamente
                  </div>
                  <Link
                    to="/simulador"
                    className="mt-3 inline-block text-xs text-primary underline"
                  >
                    Usar simulador completo →
                  </Link>
                </div>
                </>
              </section>
            )}

            {/* Zona scores — PRO gated */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold" style={{ color: '#111418' }}>Contexto de zona</h2>
                <div className="space-y-4 rounded-xl border border-[#E5E0D5] bg-[#FAF8F3] p-5">
                  <ScoreBar label="Score corto plazo (airbnb / temporada)" value={listing.score_corto} />
                  <ScoreBar label="Score mediano plazo (renta media)" value={listing.score_mediano} />
                  <ScoreBar label="Score largo plazo (renta larga)" value={listing.score_largo} />
                  <ScoreBar label="Liquidez del mercado" value={listing.liquidez_score} />
                  <ScoreBar label="Seguridad" value={listing.seguridad_score} />
                  <ScoreBar label="Índice nómada" value={listing.indice_nomada} max={10} />
                  {listing.yield_bruto_pct != null && (
                    <div className="flex justify-between border-t border-[#E5E0D5] pt-3 text-xs">
                      <span className="text-muted-foreground">Yield bruto barrio</span>
                      <span className="font-semibold text-primary">
                        {listing.yield_bruto_pct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
            </section>

            {/* Gallery + coming soon extras */}
            {(listing.fotos?.length ?? 0) > 0 && (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold" style={{ color: '#111418' }}>Galería de fotos</h2>
                <div className="overflow-hidden rounded-2xl border border-[#E5E0D5]">
                  <PhotoGallery fotos={listing.fotos} titulo={listing.tipo_inmueble ?? undefined} height={320} />
                </div>
              </section>
            )}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold" style={{ color: '#111418' }}>Más información</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <ComingSoon title="Tour virtual 360°" />
                <ComingSoon title="Historial de precios" />
                <ComingSoon title="Avalúo catastral" />
                <ComingSoon title="Amenidades del edificio" />
                <ComingSoon title="Gastos de administración" />
              </div>
            </section>

            {/* Similar listings */}
            {similarList.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold" style={{ color: '#111418' }}>Similares en la zona</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {similarList.map((s) => (
                    <Link
                      key={s.id}
                      to="/listing/$id"
                      params={{ id: String(s.id) }}
                      className="block rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] p-4 transition hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="mb-1 text-xs capitalize text-muted-foreground">
                        {s.tipo_inmueble} · {s.barrio_nombre}
                      </div>
                      <div className="font-bold">
                        {formatPrice(s.precio_cop)}
                      </div>
                      <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                        {s.habitaciones != null && <span>{s.habitaciones}hab</span>}
                        {s.area_m2 != null && <span>{s.area_m2}m²</span>}
                        {s.precio_m2 != null && tipoOp === "venta" && (
                          <span>{formatPricePerArea(s.precio_m2)}</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <aside className={isModal ? "space-y-4 order-first" : "space-y-4 lg:sticky lg:top-24 lg:self-start"}>
            {/* Price hero card */}
            <div className="space-y-4 rounded-2xl border border-[#E5E0D5] bg-white p-6 backdrop-blur-sm">
              <div>
                <div className="font-display text-3xl font-bold leading-tight" style={{ color: '#111418' }}>
                  {formatPrice(listing.precio_cop)}
                </div>
                {formatSecondary(listing.precio_cop) && (
                  <div className="mt-0.5 text-sm" style={{ color: '#5B5F5C' }}>
                    {formatSecondary(listing.precio_cop)}
                  </div>
                )}
              </div>

              <OriginalListingLink listing={listing} className="w-full" />

              {/* Key specs */}
              <div className="flex flex-wrap gap-2 text-sm">
                {listing.habitaciones != null && (
                  <span className="flex items-center gap-1 rounded-md border border-[#E5E0D5] bg-white px-2.5 py-1">
                    <Bed className="h-3.5 w-3.5 text-muted-foreground" />
                    {listing.habitaciones}
                  </span>
                )}
                {listing.banos != null && (
                  <span className="flex items-center gap-1 rounded-md border border-[#E5E0D5] bg-white px-2.5 py-1">
                    <Bath className="h-3.5 w-3.5 text-muted-foreground" />
                    {listing.banos}
                  </span>
                )}
                {listing.area_m2 != null && (
                  <span className="flex items-center gap-1 rounded-md border border-[#E5E0D5] bg-white px-2.5 py-1">
                    <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {listing.area_m2}m²
                  </span>
                )}
              </div>

              {/* Price analysis mini-table */}
              {(tipoOp === "venta" ? listing.precio_m2 : null) ||
               listing.precio_m2_mediana_barrio ||
               listing.yield_estimado ? (
                <div className="space-y-1.5 rounded-lg border border-[#E5E0D5] bg-[#FAF8F3] p-3 text-xs">
                  {listing.precio_m2 != null && tipoOp === "venta" && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Precio/m²</span>
                      <span className="font-semibold">
                        {formatPricePerArea(listing.precio_m2)}
                      </span>
                    </div>
                  )}
                  {listing.precio_m2_mediana_barrio != null && tipoOp === "venta" && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Mediana zona</span>
                      <span>
                        {formatPricePerArea(listing.precio_m2_mediana_barrio)}
                      </span>
                    </div>
                  )}
                  {listing.yield_estimado != null && tipoOp === "venta" && (
                    <div className="mt-0.5 flex justify-between border-t border-[#E5E0D5] pt-1.5">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <TrendingUp className="h-3 w-3" /> Yield est.
                      </span>
                      <span
                        className="font-semibold"
                        style={{ color: yieldColor(listing.yield_estimado) }}
                      >
                        {listing.yield_estimado.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {listing.dias_en_mercado != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Días en mercado</span>
                      <span>{listing.dias_en_mercado}d</span>
                    </div>
                  )}
                  {listing.arriendo_p50_barrio != null && tipoOp === "venta" && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Arriendo ref. barrio</span>
                      <span>{formatPrice(listing.arriendo_p50_barrio)}</span>
                    </div>
                  )}
                </div>
              ) : null}

              <PriceBadge
                pctBajoMediana={listing.pct_bajo_mediana}
                tipoOp={tipoOp}
              />

              {/* CTAs */}
              <div className="space-y-2 pt-1">
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  <Phone className="h-4 w-4" />
                  Contactar agente (WhatsApp)
                </a>
                {isModal && (
                  <button
                    onClick={handleShare}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E0D5] bg-[#F3F0E8] py-3 text-sm font-semibold text-foreground transition hover:bg-white"
                  >
                    <Share2 className="h-4 w-4" />
                    Compartir listing
                  </button>
                )}
              </div>

              {listing.disponible_actualmente === false && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ border: '1px solid rgba(184,117,23,0.35)', background: 'rgba(184,117,23,0.08)', color: '#8A6A00' }}>
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  Este listing puede ya no estar disponible
                </div>
              )}
            </div>

            {/* Barrio quick stats */}
            {listing.barrio_id != null && (
              <div className="space-y-3 rounded-2xl border border-[#E5E0D5] bg-white p-4">
                <div className="text-sm font-semibold" style={{ color: '#111418' }}>
                  Zona: {listing.barrio_nombre}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {listing.yield_bruto_pct != null && (
                    <div className="rounded-lg border border-[#E5E0D5] bg-white p-2.5 text-center">
                      <div className="font-bold text-primary">
                        {listing.yield_bruto_pct.toFixed(1)}%
                      </div>
                      <div className="text-muted-foreground">Yield zona</div>
                    </div>
                  )}
                  {listing.score_largo != null && (
                    <div className="rounded-lg border border-[#E5E0D5] bg-white p-2.5 text-center">
                      <div className="font-bold text-primary">
                        {listing.score_largo.toFixed(0)}
                      </div>
                      <div className="text-muted-foreground">Score inversión</div>
                    </div>
                  )}
                  {listing.seguridad_score != null && (
                    <div className="rounded-lg border border-[#E5E0D5] bg-white p-2.5 text-center">
                      <div className="font-bold" style={{ color: '#0F8A4F' }}>{listing.seguridad_score.toFixed(0)}</div>
                      <div className="text-muted-foreground">Seguridad</div>
                    </div>
                  )}
                  {listing.indice_nomada != null && (
                    <div className="rounded-lg border border-[#E5E0D5] bg-white p-2.5 text-center">
                      <div className="font-bold" style={{ color: '#0F8A4F' }}>{listing.indice_nomada.toFixed(1)}</div>
                      <div className="text-muted-foreground">Índice nómada</div>
                    </div>
                  )}
                </div>
                <Link
                  to="/map"
                  className="block text-center text-xs text-primary underline"
                >
                  Ver análisis completo del barrio →
                </Link>
              </div>
            )}

            {/* Listing ID for reference */}
            <div className="text-center text-xs" style={{ color: '#6E726E' }}>
              Listing ID: {listing.id}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

// ─── Full page ─────────────────────────────────────────────────────────────────
function ListingPage() {
  const { id } = Route.useParams();
  const listingId = Number(id);

  const {
    data: listing,
    isLoading,
    error,
  } = useQuery<ApiListingDetail>({
    queryKey: ["listing", listingId],
    queryFn: () => apiFetch(API_ENDPOINTS.listing(listingId)),
  });

  const { data: similares } = useQuery<{ listings: ApiListingDetail[] }>({
    queryKey: ["listing-similares", listing?.barrio_id, listing?.tipo_operacion],
    queryFn: () =>
      apiFetch(
        `${API_ENDPOINTS.allListings}?barrio_id=${listing!.barrio_id}&tipo_operacion=${listing!.tipo_operacion}&limit=5`,
      ),
    enabled: !!listing?.barrio_id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAF8F3]">
        <SiteNavbar />
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen bg-[#FAF8F3]">
        <SiteNavbar />
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <h2 className="mt-4 text-xl font-semibold">Listing no encontrado</h2>
            <Link to="/map" className="mt-4 inline-block text-primary underline">
              Volver al mapa
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tipoOp = listing.tipo_operacion ?? "venta";
  const fuente = listing.fuente ?? "";

  return (
    <div className="min-h-screen bg-[#FAF8F3]">
      <SiteNavbar />

      <main
        className="mx-auto max-w-7xl px-4 pb-8 pt-20 sm:px-6"
        style={{
          '--background': '#FFFFFF',
          '--foreground': '#111418',
          '--muted-foreground': '#5B5F5C',
          '--muted': '#F3F0E8',
          '--border': 'rgb(184 164 138 / 50%)',
          '--primary': '#0F8A4F',
          '--primary-foreground': '#FFFFFF',
        } as React.CSSProperties}
      >
        {/* Breadcrumb */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Link
            to="/map"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al mapa
          </Link>
          <span className="text-muted-foreground/40">·</span>
          <span
            className="rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wider"
            style={{
              background: tipoOp === "arriendo" ? "#E7F4EC" : "#FCE8EA",
              color:      tipoOp === "arriendo" ? "#0F8A4F" : "#CE1126",
            }}
          >
            {tipoOp}
          </span>
          {listing.tipo_inmueble && (
            <span className="text-sm capitalize text-muted-foreground">
              {listing.tipo_inmueble}
            </span>
          )}
          {listing.barrio_nombre && (
            <span className="text-sm text-muted-foreground">· {listing.barrio_nombre}</span>
          )}
          {listing.municipio && (
            <span className="text-sm text-muted-foreground">· {listing.municipio}</span>
          )}
          <span className="ml-auto text-xs" style={{ color: '#0F8A4F' }}>{fuente}</span>
        </div>

        <ListingDetailContent
          listing={listing}
          similares={similares?.listings ?? []}
        />
      </main>
    </div>
  );
}
