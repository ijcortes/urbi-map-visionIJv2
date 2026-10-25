import { useState, useMemo, useEffect, useRef } from "react";
import { OriginalListingLink } from "@/components/OriginalListingLink";
import { originalListingUrl } from "@/lib/originalListing";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowLeft, ExternalLink, Plus, Check, ArrowUpDown } from "@/lib/icons";
import { useNavigate } from "@tanstack/react-router";
import type { ApiListing, BarrioOption, Neighborhood } from "@/lib/adapters";
import { formatCOP } from "@/lib/format";
import { favKey, useFavoritosListings } from "@/hooks/useFavoritosListings";
import { auth } from "@/lib/auth";
import { useTarget, targetTipoOperacion } from "@/contexts/TargetContext";
import { type SharedFilters, EMPTY_SHARED_FILTERS } from "@/components/MapFilterBar";
import { useComparadorStore } from "@/hooks/useComparadorStore";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import { useIsPro, useIsAgente } from "@/components/LockedField";
import { useLang } from "@/lib/i18n";
import { useUnit, formatArea } from "@/hooks/useUnit";
import { toast } from "sonner";

type Props = {
  barrio: Neighborhood;
  listings: ApiListing[];
  total?: number;
  isLoading: boolean;
  onBack: () => void;
  onListingSelect: (listing: ApiListing, screenX: number, screenY: number) => void;
  /** Hover en una card → el mapa resalta dónde queda (Ken, 23-oct). */
  onListingHover?: (id: number | null) => void;
  highlightedListingId?: number | null;
  activeBarrioName?: string | null;
  onBarrioFilter?: (barrio: string | null) => void;
  allBarrios?: BarrioOption[];
  onBarrioNavigate?: (opt: BarrioOption) => void;
  radioUsadoMetros?: number | null;
  barriosIncluidos?: string[] | null;
  premiumExpanded?: ApiListing[];
  premiumIsLoading?: boolean;
  premiumRadio?: number | null;
  premiumBarriosIncluidos?: string[] | null;
  onPremiumExpand?: (v: boolean) => void;
  externalFilters?: SharedFilters;
  /** Resets all filters (empty-state button). */
  onClearFilters?: () => void;
  // Commune drill-down
  activeComuna?: string | null;
  activeMunicipio?: string | null;
  comunaBarrios?: Array<{ barrio_id: number; nombre: string }>;
  onBackToComuna?: () => void;
  onSelectBarrioInComune?: (barrioId: number) => void;
};

// Internal-only filters — common filters (precio, hab, tipo, area, banos, antiguedad, tipoOp)
// now live in SharedFilters and come via the externalFilters prop from map.tsx.
type Filters = {
  modalidad: "corto" | "medio" | "largo" | null;
  scoreMin: number | null;
  scoreMax: number | null;
  yieldMin: number | null;
  yieldMax: number | null;
};

const TIPO_LABELS: Record<string, string> = {
  apartamento:   "Apartamento",
  casa:          "Casa",
  casa_lote:     "Casa-Lote",
  finca:         "Finca",
  local:         "Local comercial",
  oficina:       "Oficina",
  bodega:        "Bodega",
  consultorio:   "Consultorio",
  lote:          "Lote",
};

const TIPO_GRUPOS = [
  { label: "Residencial", tipos: ["apartamento", "casa", "casa_lote", "finca"] },
  { label: "Comercial",   tipos: ["local", "oficina", "bodega", "consultorio"] },
  { label: "Terreno",     tipos: ["lote"] },
];

const TIPO_INMUEBLE_COLOR: Record<string, string> = {
  apartamento:   '#0F8A4F',
  casa:          '#CE1126',
  casa_lote:     '#CE1126',
  finca:         '#CE1126',
  lote:          '#8A6A00',
  local:         '#1F5BC6',
  oficina:       '#6D4AA8',
  bodega:        '#6E726E',
  consultorio:   '#6E726E',
};

function getTipoInmuebleBadgeStyle(tipo: string): React.CSSProperties {
  const bg = TIPO_INMUEBLE_COLOR[tipo] ?? '#6E726E';
  return { background: bg, color: '#FFFFFF' };
}

function tierColor(l: ApiListing): string {
  if (l.tier === "agencia_premium") return "#FCD116";
  return TIPO_INMUEBLE_COLOR[l.tipo_inmueble ?? ""] ?? "#6E726E";
}

// Listing con visibilidad pagada (owner Pro o agente verificado) → destacado.
const DESTACADO_COLOR = "#FCD116";
function esDestacado(l: ApiListing): boolean {
  return l.fuente_display === "propio_pro" || l.fuente_display === "agente_verificado";
}

// Orden que elige el usuario. "destacados" = orden del server (pro-first); el resto
// reordena por el campo elegido. Los destacados siguen fijos arriba (ver split).
type SortKey = "destacados" | "precio_asc" | "precio_desc" | "nuevo" | "area_desc";
const SORT_OPTIONS: { key: SortKey; es: string; en: string }[] = [
  { key: "destacados",  es: "Destacados",     en: "Featured" },
  { key: "precio_desc", es: "Precio ↑",       en: "Price ↑" },
  { key: "precio_asc",  es: "Precio ↓",       en: "Price ↓" },
  { key: "nuevo",       es: "Más nuevo",      en: "Newest" },
  { key: "area_desc",   es: "Área ↓",         en: "Area ↓" },
];
export function sortListings(list: ApiListing[], key: SortKey): ApiListing[] {
  if (key === "destacados") return list;  // conserva orden del server
  const arr = [...list];
  const num = (v: number | null | undefined, fallback: number) => (v == null ? fallback : v);
  switch (key) {
    case "precio_asc":  return arr.sort((a, b) => num(a.precio_cop, Infinity) - num(b.precio_cop, Infinity));
    case "precio_desc": return arr.sort((a, b) => num(b.precio_cop, -Infinity) - num(a.precio_cop, -Infinity));
    case "nuevo":       return arr.sort((a, b) => num(a.dias_en_mercado, Infinity) - num(b.dias_en_mercado, Infinity));
    case "area_desc":   return arr.sort((a, b) => num(b.area_m2, -Infinity) - num(a.area_m2, -Infinity));
  }
}

function diasLabel(dias: number | null | undefined): string | null {
  if (dias == null || dias < 0) return null;
  if (dias === 0) return "Publicado hoy";
  if (dias === 1) return "Publicado ayer";
  if (dias < 7)  return `${dias} días`;
  if (dias < 30) return `${Math.floor(dias / 7)} semana${Math.floor(dias / 7) > 1 ? "s" : ""}`;
  if (dias < 365) return `${Math.floor(dias / 30)} mes${Math.floor(dias / 30) > 1 ? "es" : ""}`;
  return `+${Math.floor(dias / 365)} año${Math.floor(dias / 365) > 1 ? "s" : ""}`;
}

function ListingCard({
  listing,
  highlighted,
  onSelect,
  cardRef,
  isFav,
  onToggleFav,
  onSimular,
  onHover,
}: {
  onHover?: (hovering: boolean) => void;
  listing: ApiListing;
  highlighted: boolean;
  onSelect: (e: React.MouseEvent) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  isFav: boolean;
  onToggleFav: () => void;
  onSimular: () => void;
}) {
  const isPro = useIsPro();
  const isRealtor = useIsAgente();
  const isMobile = useIsMobile();
  const { addListing, removeListing, isSelected, canAdd } = useComparadorStore();
  const selected = isSelected(listing.id);
  const { formatPrice, formatSecondary, formatPricePerArea } = usePriceFormat();
  const { unit } = useUnit();
  const { lang } = useLang();
  const precio    = formatPrice(listing.precio_cop);
  const precioSub = formatSecondary(listing.precio_cop);
  // precio_m2 del backend es venta-only (precio total/m²); en arriendo sería
  // canon mensual/m² (escala de miles) — dividir por 1M ahí da basura ($0.0M/m²).
  const _pm2 = listing.tipo_operacion === "venta" ? listing.precio_m2 : null;
  const m2 = _pm2 && _pm2 > 0 && _pm2 < 50_000_000 ? formatPricePerArea(_pm2) : null;
  const tipo = listing.tipo_operacion?.toUpperCase() ?? "—";
  const tipoInmueble = listing.tipo_inmueble ?? "";
  const specs = [
    listing.habitaciones != null ? (listing.habitaciones === 0 ? "Studio" : `${listing.habitaciones} hab`) : null,
    listing.banos ? `${listing.banos} baños` : null,
    listing.area_m2 ? formatArea(listing.area_m2, unit) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Mobile: vertical compact card — photo + tipo badge + price + specs + fav only.
  if (isMobile) {
    return (
      <div
        ref={cardRef}
        onClick={(e) => onSelect(e)}
        data-tour="listing-card"
        className="cursor-pointer rounded-lg border overflow-hidden"
        style={highlighted
          ? { border: '1.5px solid #0F8A4F', background: '#FFFFFF', boxShadow: '0 2px 8px rgba(29,158,117,0.15)' }
          : { border: '0.5px solid #E5E0D5', background: '#FFFFFF' }
        }
      >
        <div className="relative h-[90px] w-full overflow-hidden" style={{ background: '#F3F0E8' }}>
          {listing.foto_principal ? (
            <img src={listing.foto_principal} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ background: 'linear-gradient(135deg, #0F8A4F 0%, #0A5C36 100%)' }}>
              <span style={{ color: '#fff', opacity: 0.5, fontSize: 11, fontWeight: 700 }}>Medellín Social</span>
            </div>
          )}
          <span
            className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ background: listing.tipo_operacion === "arriendo" ? "#0F8A4F" : "#CE1126", color: "#FFFFFF" }}
          >
            {tipo}
          </span>
          {esDestacado(listing) && (
            <span
              className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{ background: DESTACADO_COLOR, color: "#111418" }}
            >
              ★
            </span>
          )}
        </div>
        <div className="flex items-start justify-between gap-2 p-2">
          <div className="min-w-0">
            <div data-i18n-skip="true" className="text-sm font-bold leading-tight text-[#111418]">{precio}</div>
            {specs && <div className="mt-0.5 truncate text-[11px] text-[#5B5F5C]">{specs}</div>}
            <OriginalListingLink listing={listing} variant="compact" className="mt-1.5" />
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
            className="grid h-11 w-11 shrink-0 place-items-center text-base leading-none transition hover:scale-110"
            aria-label={isFav ? "Quitar de favoritos" : "Guardar propiedad"}
            title={isFav ? "Quitar de favoritos" : "Guardar propiedad"}
          >
            {isFav ? "❤️" : "🤍"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      onClick={(e) => onSelect(e)}
      data-tour="listing-card"
      className="cursor-pointer rounded-lg border overflow-hidden transition-all hover:bg-[#F3F0E8]"
      style={highlighted
        ? { border: '1.5px solid #0F8A4F', background: '#FFFFFF', boxShadow: '0 2px 8px rgba(29,158,117,0.15)' }
        : { border: '0.5px solid #E5E0D5', background: '#FFFFFF' }
      }
    >
      {/* Photo */}
      <div className="relative h-[140px] w-full overflow-hidden" style={{ background: '#F3F0E8' }}>
        {listing.foto_principal ? (
          <img
            src={listing.foto_principal}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #0F8A4F 0%, #0A5C36 100%)' }}
          >
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 36, height: 36, opacity: 0.45 }}>
              <rect x="6" y="12" width="24" height="30" rx="1" fill="white"/>
              <rect x="30" y="20" width="14" height="22" rx="1" fill="white"/>
              <rect x="10" y="16" width="4" height="4" fill="#0F8A4F"/>
              <rect x="18" y="16" width="4" height="4" fill="#0F8A4F"/>
              <rect x="10" y="24" width="4" height="4" fill="#0F8A4F"/>
              <rect x="18" y="24" width="4" height="4" fill="#0F8A4F"/>
              <rect x="13" y="32" width="6" height="10" fill="#0F8A4F"/>
              <rect x="34" y="24" width="4" height="4" fill="#0F8A4F"/>
              <rect x="34" y="30" width="4" height="4" fill="#0F8A4F"/>
            </svg>
          </div>
        )}
        {/* VENTA/ARRIENDO badge over photo */}
        <span
          className="absolute top-2 left-2 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: listing.tipo_operacion === "arriendo" ? "#0F8A4F" : "#CE1126",
            color:      "#FFFFFF",
          }}
        >
          {tipo}
        </span>
        {/* Comparador "+" button — solo realtors */}
        {isRealtor && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (selected) {
                removeListing(listing.id);
              } else if (canAdd) {
                addListing(listing);
              } else {
                toast.info("Máximo 5 inmuebles en el comparador");
              }
            }}
            title={selected ? "Quitar de comparación" : canAdd ? "Agregar a comparación" : "Máximo 5 inmuebles"}
            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full shadow-md transition hover:scale-110"
            style={{
              background: selected ? "#0F8A4F" : "rgba(255,255,255,0.92)",
              border: selected ? "none" : "0.5px solid #E5E0D5",
            }}
          >
            {selected
              ? <Check className="h-3.5 w-3.5 text-white" />
              : <Plus className="h-3.5 w-3.5 text-[#0F8A4F]" />
            }
          </button>
        )}
      </div>
      <div className="p-3">
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        {esDestacado(listing) && (
          <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: DESTACADO_COLOR, color: '#111418' }}>
            ★ Destacado
          </span>
        )}
        {listing.disponible_actualmente === false && (
          <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/60 border border-border">
            YA NO DISPONIBLE
          </span>
        )}
        {isPro && listing.buena_oferta && listing.disponible_actualmente !== false && (
          <span
            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: '#E7F4EC', color: '#0A5C36', border: '0.5px solid #0F8A4F' }}
          >
            BUENA OFERTA
          </span>
        )}
        {listing.amoblado && (
          <span
            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: '#F3F0E8', color: '#5B5F5C', border: '0.5px solid #C8B99A' }}
          >
            AMOBLADO
          </span>
        )}
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: listing.tipo_operacion === "arriendo" ? "#0F8A4F" : "#CE1126",
            color:      "#FFFFFF",
          }}
        >
          {tipo}
        </span>
        {tipoInmueble && (
          <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={getTipoInmuebleBadgeStyle(tipoInmueble)}>
            {TIPO_LABELS[tipoInmueble] ?? tipoInmueble}
          </span>
        )}
      </div>

      <div data-i18n-skip="true" className="text-base font-bold leading-tight text-[#111418]">{precio}</div>
      {precioSub && <div data-i18n-skip="true" className="text-[11px] text-[#5B5F5C]">{precioSub}</div>}
      {specs && <div className="mt-1 text-xs text-[#5B5F5C]">{specs}</div>}
      {m2 && <div className="text-[11px] text-[#5B5F5C]">{m2}</div>}

      {(listing.pct_bajo_mediana ?? 0) > 5 && (
        <div className="mt-1.5 text-[11px] font-medium text-[#0A5C36]">
          {listing.pct_bajo_mediana?.toFixed(0)}% bajo la mediana del barrio
        </div>
      )}

      {diasLabel(listing.dias_en_mercado) && (
        <div
          className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium"
          title={listing.fecha_publicacion ? `Publicado el ${listing.fecha_publicacion}` : undefined}
        >
          {(listing.dias_en_mercado ?? 0) < 7 && (
            <span className="rounded px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider" style={{ background: '#FCD116', color: '#111418' }}>
              NUEVO
            </span>
          )}
          <span className={
            (listing.dias_en_mercado ?? 0) < 7
              ? "text-[#0A5C36]"
              : (listing.dias_en_mercado ?? 0) < 30
              ? "text-[#5B5F5C]"
              : (listing.dias_en_mercado ?? 0) < 90
              ? "text-[#8A6A00]"
              : "text-[#CE1126]"
          }>
            {diasLabel(listing.dias_en_mercado)}
            {(listing.dias_en_mercado ?? 0) > 90 && " · Lleva tiempo"}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        {listing.url && listing.disponible_actualmente !== false && originalListingUrl(listing) ? (
          <OriginalListingLink listing={listing} variant="compact" />
        ) : listing.disponible_actualmente === false ? (
          <span
            className="flex items-center gap-1 text-[10px] text-[#C9C4B8] capitalize cursor-default"
            title="Este listing ya no está disponible, pero sus datos son referencia histórica del mercado"
          >
            {listing.fuente ?? "—"}
            <ExternalLink className="h-2.5 w-2.5 opacity-30" />
          </span>
        ) : (
          <span className="text-[10px] text-[#6E726E] capitalize">
            {listing.fuente ?? "—"}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          {isRealtor && (
            <button
              onClick={(e) => { e.stopPropagation(); onSimular(); }}
              className="rounded px-1.5 py-0.5 text-[10px] text-[#6E726E] border border-[#E5E0D5] hover:text-[#0F8A4F] hover:border-[#0F8A4F]/40 transition"
              title="Simular inversión"
            >
              Simular
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
            className="grid h-11 w-11 place-items-center text-base leading-none transition hover:scale-110"
            aria-label={isFav ? "Quitar de favoritos" : "Guardar propiedad"}
            title={isFav ? "Quitar de favoritos" : "Guardar propiedad"}
          >
            {isFav ? "❤️" : "🤍"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MLSPanel({
  barrio,
  listings,
  total,
  isLoading,
  onBack,
  onListingSelect,
  highlightedListingId,
  onListingHover,
  activeBarrioName,
  onBarrioFilter,
  allBarrios,
  onBarrioNavigate,
  radioUsadoMetros,
  barriosIncluidos,
  premiumExpanded = [],
  premiumIsLoading = false,
  premiumRadio,
  premiumBarriosIncluidos,
  onPremiumExpand,
  externalFilters,
  onClearFilters,
  activeComuna,
  activeMunicipio,
  comunaBarrios,
  onBackToComuna,
  onSelectBarrioInComune,
}: Props) {
  const isMobile = useIsMobile();
  const [filters, setFilters] = useState<Filters>({
    modalidad: null,
    scoreMin: null,
    scoreMax: null,
    yieldMin: null,
    yieldMax: null,
  });
  // Resolved external filters with safe defaults
  const ef = externalFilters ?? EMPTY_SHARED_FILTERS;
  const navigate = useNavigate();
  const { isFav, toggle: toggleFav } = useFavoritosListings();
  const { target, setTarget } = useTarget();
  const { lang } = useLang();
  const [sortBy, setSortBy] = useState<SortKey>("destacados");

  // Reset internal filters when target or barrio changes
  useEffect(() => {
    setFilters({ modalidad: null, scoreMin: null, scoreMax: null, yieldMin: null, yieldMax: null });
  }, [target, barrio.id]);

  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Render progresivo: pinta un lote y crece al scrollear (evita renderizar 500
  // cards de golpe → primer paint ~10 cards en vez de segundos).
  const RENDER_STEP = 30;
  const [visibleCount, setVisibleCount] = useState(RENDER_STEP);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setVisibleCount(RENDER_STEP); listContainerRef.current?.scrollTo({ top: 0 }); }, [listings, sortBy, activeBarrioName]);


  const nVenta = useMemo(
    () => listings.filter((l) => l.tipo_operacion === "venta").length,
    [listings],
  );
  const nArriendo = useMemo(
    () => listings.filter((l) => l.tipo_operacion === "arriendo").length,
    [listings],
  );

  // Premium state — reads from SharedFilters (controlled by MapFilterBar)
  const premiumFilterActive = ef.soloPromium;
  const premiumInCurrent = useMemo(
    () => listings.filter((l) => l.tier === "agencia_premium").length,
    [listings],
  );

  // Shared filters (precio/hab/banos/area/estrato/tipo/dias/busqueda/tipoOp) are now
  // applied server-side in /viewport — the `listings` prop arrives pre-filtered, so the
  // panel renders the same set as the map. Only the panel-local refinements remain
  // client-side: premium toggle + investor score/yield (not part of the viewport query).
  const filtered = useMemo(() => {
    const src = (premiumFilterActive && premiumInCurrent === 0 && premiumExpanded.length > 0)
      ? premiumExpanded : listings;
    return src.filter((l) => {
      if (premiumFilterActive && l.tier !== "agencia_premium") return false;
      if (filters.scoreMin !== null && (l.barrio_score ?? 0) < filters.scoreMin) return false;
      if (filters.scoreMax !== null && (l.barrio_score ?? 0) > filters.scoreMax) return false;
      if (filters.yieldMin !== null && (l.barrio_yield ?? 0) < filters.yieldMin) return false;
      if (filters.yieldMax !== null && (l.barrio_yield ?? 0) > filters.yieldMax) return false;
      return true;
    });
  }, [listings, filters, premiumFilterActive, premiumInCurrent, premiumExpanded]);
  useEffect(() => {
    if (premiumFilterActive && premiumInCurrent === 0) {
      onPremiumExpand?.(true);
    } else {
      onPremiumExpand?.(false);
    }
  }, [premiumFilterActive, premiumInCurrent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Source: use premiumExpanded when premium filter active and no local premium
  const effectiveListings = premiumFilterActive && premiumInCurrent === 0 && premiumExpanded.length > 0
    ? premiumExpanded
    : listings;
  const effectiveRadio = premiumFilterActive && premiumInCurrent === 0 && premiumExpanded.length > 0
    ? premiumRadio
    : radioUsadoMetros;
  const effectiveBarrios = premiumFilterActive && premiumInCurrent === 0 && premiumExpanded.length > 0
    ? premiumBarriosIncluidos
    : barriosIncluidos;

  // Scroll highlighted card into view
  useEffect(() => {
    if (highlightedListingId == null) return;
    const el = cardRefs.current[highlightedListingId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlightedListingId]);

  const btnFilter = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${
      active
        ? "bg-primary/20 text-primary border border-primary/40"
        : "bg-surface/60 text-muted-foreground border border-border hover:text-foreground"
    }`;

  const headerName = toTitleCase(barrio.nombre);
  const isAtBarrioLevel = barrio.id > 0;
  const isAtTopLevel = barrio.id === -1 && !activeComuna && !activeMunicipio;
  const comunaLabel = activeComuna
    ? toTitleCase(activeComuna)
    : activeMunicipio
    ? toTitleCase(activeMunicipio)
    : isAtBarrioLevel
    ? toTitleCase(barrio.comuna ?? "")
    : null;

  const panelVars = { '--background': '#FFFFFF', '--foreground': '#111418', '--surface': '#FAF8F3', '--surface-elevated': '#F3F0E8', '--muted': '#F3F0E8', '--muted-foreground': '#5B5F5C', '--border': 'rgb(184 164 138 / 50%)', '--input': '#FAF8F3', '--card': '#FFFFFF', '--card-foreground': '#111418' } as React.CSSProperties;

  // Destacados (visibilidad pagada) arriba en su propia sección; el resto abajo.
  // filtered ya viene ordenado pro-first del API; el split solo agrega los encabezados.
  const ordenados = sortListings(filtered, sortBy);
  // "Ocultar destacados": no pinned section, and featured rows (if any slip through) rank like the rest.
  const destacados = ef.ocultarDestacados ? [] : ordenados.filter(esDestacado);
  const resto = ef.ocultarDestacados ? ordenados : ordenados.filter((l) => !esDestacado(l));
  // Solo renderiza los primeros `visibleCount` del resto; crece al scrollear.
  const restoVisible = resto.slice(0, Math.max(0, visibleCount - destacados.length));
  const hayMas = restoVisible.length < resto.length;

  // IntersectionObserver: al acercarse al final, muestra el siguiente lote.
  useEffect(() => {
    const s = sentinelRef.current, root = listContainerRef.current;
    if (!s || !root || !hayMas) return;
    const io = new IntersectionObserver(
      (es) => { if (es[0].isIntersecting) setVisibleCount((c) => c + RENDER_STEP); },
      { root, rootMargin: "600px" },
    );
    io.observe(s);
    return () => io.disconnect();
  }, [hayMas, restoVisible.length]);
  const renderCard = (l: ApiListing) => (
    <ListingCard
      key={`${l.fuente ?? "x"}-${l.id}`}
      listing={l}
      highlighted={highlightedListingId === l.id}
      onSelect={(e) => onListingSelect(l, e.clientX, e.clientY)}
      onHover={onListingHover ? (h) => onListingHover(h ? l.id : null) : undefined}
      cardRef={(el) => { cardRefs.current[l.id] = el; }}
      isFav={isFav(favKey(l))}
      onToggleFav={() => {
        if (!auth.get()) return;
        toggleFav(favKey(l), l.barrio_id);
      }}
      onSimular={() => {
        navigate({ to: "/simulador", search: { barrio: l.barrio_id ?? undefined, precio: l.precio_cop ?? undefined } });
      }}
    />
  );

  const body = (
    <>
        {/* Header — desktop clears the navbar+filterbar (104px); mobile list sits below them */}
        <div className={`border-b border-border px-4 pb-3 ${isMobile ? "pt-2" : "pt-[104px]"}`}>
          {isAtTopLevel ? (
            <button
              onClick={onBack}
              className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver al análisis
            </button>
          ) : (
            <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
              <button
                onClick={onBack}
                data-tour="breadcrumb-back"
                className="font-medium text-primary transition hover:underline"
              >
                Medellín
              </button>
              {comunaLabel && (
                <>
                  <span className="text-muted-foreground/60">›</span>
                  {isAtBarrioLevel && onBackToComuna && activeComuna ? (
                    <button onClick={onBackToComuna} className="text-primary transition hover:underline">
                      {comunaLabel}
                    </button>
                  ) : (
                    <span className={isAtBarrioLevel ? "text-muted-foreground" : "font-semibold text-foreground"}>
                      {comunaLabel}
                    </span>
                  )}
                </>
              )}
              {isAtBarrioLevel && (
                <>
                  <span className="text-muted-foreground/60">›</span>
                  <span className="font-semibold text-foreground">{headerName}</span>
                </>
              )}
            </div>
          )}

          {/* El filtro barrio-de-comuna se movió a la barra de filtros (ZonaCascader). */}
          {!isLoading && !premiumIsLoading && effectiveRadio != null && effectiveRadio > 0 && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              {premiumFilterActive && premiumInCurrent === 0
                ? `✦ Premium más cercano — ${effectiveBarrios?.slice(0,3).join(", ")}`
                : effectiveRadio === 500
                ? "+ barrios cercanos (500 m)"
                : "+ zona amplia (1 km)"}
            </p>
          )}
        </div>

        {/* Filtros internos: modalidad (solo landlord) */}
        {target === "landlord" && (
          <div className="border-b border-border px-4 py-2.5 flex gap-2 flex-wrap items-center">
            <span className="text-[11px] text-muted-foreground">Modalidad:</span>
            {([null, "corto", "medio", "largo"] as const).map((m) => (
              <button
                key={String(m)}
                onClick={() => setFilters((f) => ({ ...f, modalidad: m }))}
                className={btnFilter(filters.modalidad === m)}
              >
                {m === null ? "Todas" : m === "corto" ? "Corto" : m === "medio" ? "Medio" : "Largo"}
              </button>
            ))}
          </div>
        )}

        {/* Contador de resultados + orden */}
        {!isLoading && (
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {(() => {
                const noLocalFilters = !premiumFilterActive && filters.scoreMin === null && filters.scoreMax === null
                  && filters.yieldMin === null && filters.yieldMax === null;
                const count = noLocalFilters && total != null ? total : filtered.length;
                return `${count} ${lang === "en" ? (count === 1 ? "property" : "properties") : (count === 1 ? "propiedad" : "propiedades")}`;
              })()}
            </span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowUpDown className="h-3.5 w-3.5" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="cursor-pointer rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{lang === "en" ? o.en : o.es}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Lista */}
        <div ref={listContainerRef} data-tour="listing-panel" className={`flex-1 overflow-y-auto px-4 py-3 space-y-2.5 ${isMobile ? "pb-24" : ""}`}>
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground text-sm">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0F8A4F] border-t-transparent" />
              <span>Cargando inmuebles…</span>
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <div className="text-3xl mb-2">🏠</div>
              <div className="text-sm font-medium">Sin resultados</div>
              <div className="text-xs mt-1">Intenta con otros filtros</div>
              {onClearFilters && (
                <button
                  type="button"
                  data-testid="clear-filters"
                  onClick={onClearFilters}
                  className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 text-sm font-semibold"
                  style={{ borderColor: "#0F8A4F", color: "#0A5C36", background: "#FFFFFF" }}
                >
                  Quitar filtros
                </button>
              )}
            </div>
          )}
          {destacados.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-1 pt-1 pb-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: DESTACADO_COLOR }}>
                  ★ {lang === "en" ? "Featured in this area" : "Destacados en esta zona"}
                </span>
                <span className="h-px flex-1" style={{ background: "#E5E0D5" }} />
              </div>
              {destacados.map(renderCard)}
              {resto.length > 0 && (
                <div className="flex items-center gap-2 px-1 pt-2 pb-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {lang === "en" ? "All properties" : "Todas las propiedades"}
                  </span>
                  <span className="h-px flex-1" style={{ background: "#E5E0D5" }} />
                </div>
              )}
            </>
          )}
          {restoVisible.map(renderCard)}
          {/* Sentinel para render progresivo — dispara el siguiente lote */}
          {hayMas && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0F8A4F] border-t-transparent" />
            </div>
          )}
          {!isLoading && !hayMas && filtered.length > 0 && (
            <p className="px-3 py-4 text-center text-[10px] leading-relaxed text-muted-foreground">
              {lang === "en"
                ? "Listings come from third-party sources and owners. Medellín Social does not guarantee the accuracy of prices, availability or details — verify with the agent before deciding."
                : "Los inmuebles provienen de fuentes externas y propietarios. Medellín Social no garantiza la exactitud de precios, disponibilidad ni detalles — verifica con el agente antes de decidir."}
            </p>
          )}
        </div>
    </>
  );

  // Mobile: full-screen list (Zillow toggle) below the navbar+filterbar (top:100).
  // The map.tsx toggle button swaps between this and the full-screen map.
  if (isMobile) {
    return (
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 280 }}
        className="fixed inset-x-0 bottom-0 z-20 flex flex-col"
        style={{ top: 'calc(var(--map-header-h, 53px) + 48px)', background: '#FAF8F3', ...panelVars }}
      >
        {body}
      </motion.div>
    );
  }

  // Desktop: unchanged — right-edge overlay column (380px).
  return (
    <AnimatePresence>
      <motion.aside
        key="mls-panel"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 280 }}
        className="absolute right-0 top-0 z-20 flex h-full w-[380px] max-w-full flex-col shadow-2xl"
        style={{ background: '#FAF8F3', borderLeft: '0.5px solid #E5E0D5', ...panelVars }}
      >
        {body}
      </motion.aside>
    </AnimatePresence>
  );
}
