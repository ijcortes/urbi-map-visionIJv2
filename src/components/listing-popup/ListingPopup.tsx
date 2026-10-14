import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bath, Bed, Building2, ChevronRight, MapPin, Maximize2, X } from "@/lib/icons";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import { formatNumber, M2_PER_FT2 } from "@/lib/format";
import type { ApiListing, ApiListingDetail } from "@/lib/adapters";
import { useIsMobile } from "@/hooks/use-mobile";
import { PopupGallery } from "./PopupGallery";
import { OriginalListingLink } from "@/components/OriginalListingLink";

const POPUP_WIDTH = 300;


/** Pin data comes ALL CAPS (barrio_nombre "ALEJANDRIA") — sentence-case it while
 *  the detail (which has *_display already cased) loads. */
function titleCase(s?: string | null): string | null {
  if (!s) return null;
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

type Props = {
  listing: ApiListing; // pin data — instant header, never blank
  onClose: () => void;
  onViewMore: (id: number) => void;
};

export function ListingPopup({ listing, onClose, onViewMore }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { formatPrice, formatSecondary, formatPricePerArea, unit, lang } = usePriceFormat();

  // Same queryKey as ListingDrawer → shared cache; opening the drawer after is free.
  const { data: detail, isLoading } = useQuery<ApiListingDetail>({
    queryKey: ["listing-drawer", listing.id],
    queryFn: () => apiFetch(API_ENDPOINTS.listing(listing.id)),
    staleTime: 60_000,
  });

  // Popup = solo datos del inmueble (igual para todos). La inteligencia de
  // mercado/barrio del realtor vive en el dashboard, no aquí.

  // Esc closes; focus moves into the popup and returns to the trigger on unmount.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      // ponytail: minimal focus trap — cycle within the popup's focusables
      const nodes = containerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  // Desktop: tarjeta flotante centrada sobre el mapa visible. Móvil: bottom
  // sheet anclado abajo (más intuitivo, refiere claro al pin tocado).
  const isMobile = useIsMobile();
  const panelWidth = isMobile ? 0 : 380;
  const width = Math.min(POPUP_WIDTH, window.innerWidth - 24);
  const left = Math.max(12, (window.innerWidth - panelWidth - width) / 2);
  const posStyle: React.CSSProperties = isMobile
    ? { left: 8, right: 8, bottom: 12, width: "auto", maxHeight: "72dvh" }
    : { left, top: 72, width, maxHeight: "calc(100dvh - 120px)" };

  // Header fields: prefer detail (proper *_display casing), fall back to pin.
  const d = detail;
  const tipoOp = d?.tipo_operacion ?? listing.tipo_operacion;
  const precioCop = d?.precio_cop ?? listing.precio_cop;
  const habitaciones = d?.habitaciones ?? listing.habitaciones;
  const banos = d?.banos ?? listing.banos;
  const areaM2 = d?.area_m2 ?? listing.area_m2;
  const precioM2 = d?.precio_m2 ?? listing.precio_m2;
  const barrio = d?.barrio_display ?? titleCase(listing.barrio_nombre);
  const municipio = d?.municipio_display ?? titleCase(listing.municipio);
  const ubicacion = [barrio, municipio].filter(Boolean).join(", ");
  const tipoInmueble = titleCase(d?.tipo_inmueble ?? listing.tipo_inmueble);

  // Proyecto con precio variable → "Desde $X" (rango de cluster)
  const desdePrecio =
    d?.precio_variable && d?.precio_min_cluster && d.precio_min_cluster > 0 &&
    d.precio_min_cluster !== d.precio_max_cluster
      ? d.precio_min_cluster
      : null;

  return (
    <>
      {/* Backdrop — atenuado en móvil (señala el sheet), transparente en desktop */}
      <div className={`fixed inset-0 z-40 ${isMobile ? "bg-black/30" : ""}`} onClick={onClose} />

      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de listing en ${ubicacion || "el mapa"}`}
        tabIndex={-1}
        data-tour="listing-popup"
        className="fixed z-50 flex flex-col overflow-hidden outline-none rounded-2xl"
        style={{
          ...posStyle,
          background: "#FAF8F3",
          border: "0.5px solid #E5E0D5",
          boxShadow: "0 2px 6px rgba(26,18,8,0.10), 0 24px 48px -20px rgba(26,18,8,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {isMobile && (
          <div className="flex shrink-0 justify-center pt-2 pb-1">
            <div className="h-1 w-9 rounded-full" style={{ background: "#C9C4B8" }} />
          </div>
        )}
        {/* 1. Gallery — pin photo instantly, fotos[] from the detail when loaded */}
        <div className="relative shrink-0">
          <PopupGallery
            fotos={d?.fotos}
            fallbackFoto={listing.foto_principal}
            loading={isLoading}
            alt={`${tipoInmueble ?? "Inmueble"} en ${ubicacion || "Medellín"}`}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
          >
            <X className="h-4 w-4" />
          </button>
          {tipoOp && (
            <span
              className="absolute left-2 top-2 z-10 rounded px-2 py-0.5 text-[10px] font-bold"
              style={{
                background: tipoOp === "arriendo" ? "#E7F4EC" : "#FCE8EA",
                color: tipoOp === "arriendo" ? "#0F8A4F" : "#CE1126",
              }}
            >
              {tipoOp === "arriendo" ? "Arriendo" : "Venta"}
            </span>
          )}
          {/* Sello de verificación — solo publicaciones propias (modelo unificado). */}
          {listing.fuente === "propio" && (
            <span
              className="absolute left-2 top-9 z-10 rounded px-2 py-0.5 text-[10px] font-bold"
              style={
                listing.verificado
                  ? { background: "#0A5C36", color: "#FFFFFF" }
                  : { background: "rgba(0,0,0,0.55)", color: "#FFFFFF" }
              }
            >
              {listing.verificado ? "✓ Verificado" : "Sin verificar"}
            </span>
          )}
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 space-y-3 overflow-y-auto p-3">
          {/* 2. Price */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold leading-tight" style={{ color: "#111418" }}>
                {desdePrecio ? `${lang === "en" ? "From" : "Desde"} ${formatPrice(desdePrecio)}` : formatPrice(precioCop)}
              </span>
              {!desdePrecio && formatSecondary(precioCop) && (
                <span className="text-[11px]" style={{ color: "#6E726E" }}>
                  {formatSecondary(precioCop)}
                </span>
              )}
            </div>

            {/* 3. Specs — each hidden individually when missing */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "#5B5F5C" }}>
              {habitaciones != null && (
                <span className="flex items-center gap-1"><Bed className="h-3.5 w-3.5 shrink-0" />{habitaciones} hab</span>
              )}
              {banos != null && (
                <span className="flex items-center gap-1"><Bath className="h-3.5 w-3.5 shrink-0" />{Math.round(banos)} baños</span>
              )}
              {areaM2 != null && (
                <span className="flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5 shrink-0" />{unit === "sqft" ? `${formatNumber(Math.round(areaM2 * M2_PER_FT2), lang)} ft²` : `${formatNumber(Math.round(areaM2), lang)} m²`}</span>
              )}
              {precioM2 != null && precioM2 > 0 && (
                <span>{formatPricePerArea(precioM2)}</span>
              )}
            </div>

            {/* 4. Location — never direccion_raw (corrupt text from the scraper) */}
            {ubicacion && (
              <div className="mt-1.5 flex items-center gap-1 text-[11px]" style={{ color: "#6E726E" }}>
                <MapPin className="h-3 w-3 shrink-0" />{ubicacion}
              </div>
            )}
            {d?.nombre_edificio && (
              <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium" style={{ color: "#5B5F5C" }}>
                <Building2 className="h-3 w-3 shrink-0" />{d.nombre_edificio}
              </div>
            )}
          </div>

          {/* Características, engagement, amenidades, descripción y atribución viven
              en Popup2 (drawer). Popup1 = resumen mínimo: precio + specs + ubicación. */}
        </div>

        {/* 9. CTA único — Popup1 es muestra; el detalle + link a la fuente van en Popup2 */}
        <div className="shrink-0 space-y-2 border-t p-3" style={{ borderColor: "#E5E0D5" }}>
          <OriginalListingLink
            listing={{ url: detail?.url ?? listing.url, fuente: detail?.fuente ?? listing.fuente }}
            className="w-full"
          />
          <button
            type="button"
            onClick={() => onViewMore(listing.id)}
            data-tour="listing-popup-viewmore"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
            style={{ background: "#0F8A4F" }}
          >
            Ver detalle del inmueble <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
