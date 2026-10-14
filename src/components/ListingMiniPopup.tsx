import { X, ChevronRight, Bed, Bath, Maximize2, Clock, MapPin, Plus, Check } from "@/lib/icons";
import { OriginalListingLink } from "@/components/OriginalListingLink";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import { formatArea } from "@/hooks/useUnit";
import type { ApiListing } from "@/lib/adapters";
import { useComparadorStore } from "@/hooks/useComparadorStore";
import { useIsAgente } from "@/components/LockedField";
import { toast } from "sonner";

const POPUP_WIDTH = 300;
const POPUP_HEIGHT = 340;

function BuildingPlaceholder() {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: "linear-gradient(135deg, #0F8A4F 0%, #0A5C36 100%)" }}
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
  );
}

function diasLabel(dias: number | null | undefined): string | null {
  if (dias == null || dias < 0) return null;
  if (dias === 0) return "Publicado hoy";
  if (dias === 1) return "Hace 1 día";
  if (dias < 7) return `Hace ${dias} días`;
  if (dias < 30) return `Hace ${Math.floor(dias / 7)} sem.`;
  return `Hace ${Math.floor(dias / 30)} mes${Math.floor(dias / 30) > 1 ? "es" : ""}`;
}

type Props = {
  listing: ApiListing;
  x?: number;
  y?: number;
  onClose: () => void;
  onViewMore: (id: number) => void;
};

export function ListingMiniPopup({ listing, onClose, onViewMore }: Props) {
  const isAgente = useIsAgente();
  const { formatPrice, formatSecondary, unit, lang } = usePriceFormat();
  const { addListing, removeListing, isSelected, canAdd } = useComparadorStore();
  const selected = isSelected(listing.id);

  // Always center over the visible map area (viewport minus right panel on desktop)
  const panelWidth = window.innerWidth >= 768 ? 380 : 0;
  const mapWidth = window.innerWidth - panelWidth;
  const left = Math.max(12, (mapWidth - POPUP_WIDTH) / 2);
  const top = Math.max(80, (window.innerHeight - POPUP_HEIGHT) / 2 - 40);

  const tipo = listing.tipo_operacion;
  const dias = diasLabel(listing.dias_en_mercado);

  return (
    <>
      {/* Transparent backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popup */}
      <div
        className="fixed z-50 overflow-hidden rounded-xl shadow-2xl"
        style={{ left, top, width: POPUP_WIDTH, background: "#FAF8F3", border: "0.5px solid #E5E0D5" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo */}
        <div className="relative h-[155px] overflow-hidden">
          {listing.foto_principal ? (
            <img src={listing.foto_principal} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <BuildingPlaceholder />
          )}

          <button
            onClick={onClose}
            className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          {tipo && (
            <span
              className="absolute left-2 top-2 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: tipo === "arriendo" ? "#E7F4EC" : "#FCE8EA",
                color: tipo === "arriendo" ? "#0F8A4F" : "#CE1126",
              }}
            >
              {tipo}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="space-y-2 p-3">
          <div className="text-base font-bold leading-tight" style={{ color: "#111418" }}>
            {formatPrice(listing.precio_cop)}
            {formatSecondary(listing.precio_cop) && (
              <span className="ml-2 text-[11px] font-normal" style={{ color: "#6E726E" }}>{formatSecondary(listing.precio_cop)}</span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs" style={{ color: "#5B5F5C" }}>
            {listing.area_m2 != null && (
              <span className="flex items-center gap-0.5">
                <Maximize2 className="h-3 w-3 shrink-0" />{formatArea(listing.area_m2, unit)}
              </span>
            )}
            {listing.habitaciones != null && (
              <span className="flex items-center gap-0.5">
                <Bed className="h-3 w-3 shrink-0" />{listing.habitaciones}
              </span>
            )}
            {listing.banos != null && (
              <span className="flex items-center gap-0.5">
                <Bath className="h-3 w-3 shrink-0" />{listing.banos}
              </span>
            )}
          </div>

          {listing.barrio_nombre && (
            <div className="flex items-center gap-1 text-[11px]" style={{ color: "#6E726E" }}>
              <MapPin className="h-3 w-3 shrink-0" />{listing.barrio_nombre}
            </div>
          )}

          {dias && (
            <div className="flex items-center gap-1 text-[11px]" style={{ color: "#6E726E" }}>
              <Clock className="h-3 w-3 shrink-0" />{dias}
            </div>
          )}

          {isAgente && (
            <button
              onClick={() => {
                if (selected) {
                  removeListing(listing.id);
                } else if (canAdd) {
                  addListing(listing);
                } else {
                  toast.info(lang === "en" ? "Maximum 5 properties in the comparator" : "Máximo 5 inmuebles en el comparador");
                }
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition"
              style={selected
                ? { background: "#E7F4EC", color: "#0A5C36", border: "1px solid #0F8A4F" }
                : { background: "transparent", color: "#0F8A4F", border: "1px solid #0F8A4F" }
              }
            >
              {selected
                ? <><Check className="h-3.5 w-3.5" /> En comparación</>
                : <><Plus className="h-3.5 w-3.5" /> Agregar a comparación</>
              }
            </button>
          )}
          <OriginalListingLink listing={listing} variant="compact" className="w-full" />
          <button
            onClick={() => onViewMore(listing.id)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white transition hover:opacity-90"
            style={{ background: "#0F8A4F" }}
          >
            Ver más <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
