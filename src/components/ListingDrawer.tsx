import { formatAntiguedad } from "@/lib/antiguedad";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceDot,
} from "recharts";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  X, Heart, Phone, ExternalLink, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  MapPin, Clock, Building2, Bed, Bath, Maximize2, Share2,
  Shield, Bell, BellRing, User, BarChart2, Plus, Check, Calendar,
  Home, Car, Layers, Map,
  Waves, Elevator, Dumbbell, Camera, Train, Trees, WashingMachine,
  Users, Wind, Utensils, Lock, Baby, GraduationCap, ShoppingBag,
  Binoculars, Flame, Package, BookOpen, Drop, Road, Sun, Star,
} from "@/lib/icons";
import { useTarget } from "@/contexts/TargetContext";
import { useIsPro, useIsAgente } from "@/components/LockedField";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { MAPBOX_TOKEN } from "@/lib/mapboxToken";
import { formatCOP } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import { favKey, useFavoritosListings } from "@/hooks/useFavoritosListings";
import { auth } from "@/lib/auth";
import { ReclamarListingModal } from "@/components/ReclamarListingModal";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import type { ApiListingDetail, ApiListingAgente, ApiListingAgentes, SimilarListing } from "@/lib/adapters";
import { toEmbedSrc } from "@/lib/embed";
import { PhotoGallery } from "@/components/PhotoGallery";
import { useComparadorStore } from "@/hooks/useComparadorStore";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import { OriginalListingLink } from "@/components/OriginalListingLink";
import { formatDate } from "@/lib/format";
import { useLang, translateString, Name } from "@/lib/i18n";
import { useUnit, formatArea } from "@/hooks/useUnit";

// ─── helpers ──────────────────────────────────────────────────────────────────

const TIPO_INMUEBLE_COLOR: Record<string, string> = {
  apartamento:   "#0F8A4F",
  casa:          "#CE1126",
  casa_lote:     "#CE1126",
  finca:         "#CE1126",
  lote:          "#8A6A00",
  local:         "#1F5BC6",
  oficina:       "#6D4AA8",
  bodega:        "#6E726E",
  consultorio:   "#6E726E",
};

function diasLabel(dias: number | null | undefined, lang: string): string | null {
  if (dias == null || dias < 0) return null;
  const en = lang === "en";
  if (dias === 0) return en ? "Posted today" : "Publicado hoy";
  if (dias === 1) return en ? "1 day ago" : "Hace 1 día";
  if (dias < 7) return en ? `${dias} days ago` : `Hace ${dias} días`;
  if (dias < 30) { const w = Math.floor(dias / 7); return en ? `${w} wk ago` : `Hace ${w} sem.`; }
  if (dias < 365) { const m = Math.floor(dias / 30); return en ? `${m} mo ago` : `Hace ${m} mes${m > 1 ? "es" : ""}`; }
  const y = Math.floor(dias / 365); return en ? `${y}+ yr ago` : `Hace +${y} año${y > 1 ? "s" : ""}`;
}

const SOURCE_LABEL: Record<string, string> = {
  fincaraiz:      "Ver en Fincaraíz →",
  metrocuadrado:  "Ver en Metrocuadrado →",
  medellinliving: "Ver en MedellinLiving →",
};

function normalizeTipoOp(val: string | null | undefined): "arriendo" | "venta" {
  if (!val) return "venta";
  const v = val.toLowerCase();
  if (v.includes("arriend") || v === "rent" || v === "rental" || v === "long-term rental") return "arriendo";
  return "venta";
}

/** Limpia descripciones del scraper: mojibake, símbolos sueltos, espaciado.
 *  Espejo de clean() en scripts/traductor.py — cambiar los dos a la vez. */
function cleanDescripcion(text: string): string {
  return text
    // Reemplaza el carácter de reemplazo Unicode y emojis rotos ("? Ubicación")
    .replace(/�/g, "")
    // CR real del scraper ("\r\n" / "\r") → salto de línea normal
    .replace(/\r\n?/g, "\n")
    // Mojibake: "\r"/"\n"/"\t" como texto literal (backslash+letra) → su whitespace,
    // antes de colapsar backslashes (nunca legítimos en descripciones)
    .replace(/\\+[rn]/g, "\n")
    .replace(/\\+t/g, " ")
    .replace(/\\+/g, " ")
    // Bullets/símbolos sueltos al inicio de línea (?, *, /, -, •, ·, flechas…) → "• "
    .replace(/^[\s]*[?*•·▪◦‣▶►➤/−–—-]+[\s]+/gm, "• ")
    // "?" pegado antes de texto (emoji perdido): "? Ubicación" → "Ubicación"
    .replace(/(^|\n)\s*\?\s+/g, "$1")
    // Quita caracteres de control / no imprimibles
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Asteriscos de énfasis/markdown sueltos ("**Piscina**"); los de bullet ya se convirtieron
    .replace(/\*+/g, "")
    // Slashes decorativos: solo runs de 2+ ("////"); se conservan 3/4, y/o, N/A
    .replace(/\/{2,}/g, " ")
    // Líneas que quedaron solo con "• " (bullet huérfano)
    .replace(/^[ \t]*•[ \t]*$/gm, "")
    // Colapsa 3+ saltos de línea a máximo 2
    .replace(/\n{3,}/g, "\n\n")
    // Colapsa espacios/tabs múltiples
    .replace(/[ \t]{2,}/g, " ")
    // Espacios al final de cada línea
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// ─── sub-components ────────────────────────────────────────────────────────────

function CollapsibleDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 280;
  const needsTruncate = text.length > LIMIT;
  return (
    <div className="space-y-1.5">
      {/* data-i18n-skip: our hook owns this text; keep the dict translator out (no Spanglish) */}
      <p data-i18n-skip className="whitespace-pre-line text-sm leading-relaxed text-[#111418]">
        {!expanded && needsTruncate ? text.slice(0, LIMIT) + "…" : text}
      </p>
      {needsTruncate && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-[#0F8A4F] transition hover:text-[#0A5C36]"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
  );
}

const POT_LABEL: Record<string, string> = {
  "Áreas de baja mixtura":              "Zona residencial tranquila",
  "Áreas y corredores de media mixtura":"Zona mixta (residencial + comercio)",
  "Áreas y corredores de alta mixtura": "Zona activa (comercio, oficinas, restaurantes)",
  "Espacio Público Existente":          "Espacio público (parque, plaza)",
  "Espacio Público Proyectado":         "Futuro espacio público",
  "Uso Dotacional":                     "Equipamiento urbano (colegio, hospital, etc.)",
};

const AMENITY_ICON_MAP: [RegExp, React.ElementType][] = [
  [/piscin/i,                          Waves],
  [/ascensor|elevador/i,               Elevator],
  [/gimnas|gym/i,                      Dumbbell],
  [/vigilan|circuito|cámara|cctv/i,    Camera],
  [/transport|metro|bus|tren/i,        Train],
  [/zonas? verde|parque|jardín/i,      Trees],
  [/parqueadero|garaje/i,              Car],
  [/lavander/i,                        WashingMachine],
  [/salón|salon|comunal/i,             Users],
  [/balcón|balcon|terraza/i,           Wind],
  [/cocina|estufa/i,                   Utensils],
  [/conjunto cerrado|portería|porteria|conjunto/i, Lock],
  [/niños|niño|infantil/i,             Baby],
  [/colegio|universidad|escuela/i,     GraduationCap],
  [/supermercado|centro comercial|comerciale/i, ShoppingBag],
  [/vista panorám|panoramic/i,         Binoculars],
  [/vista/i,                           Sun],
  [/calentador|gas natural|instalación/i, Flame],
  [/depósito|deposito|bodega/i,        Package],
  [/biblioteca|estudio/i,              BookOpen],
  [/closet|clóset/i,                   Star],
  [/baño|bano/i,                       Drop],
  [/citófono|citofono|interfón/i,      Phone],
  [/sobre vía|vía principal/i,         Road],
  [/área urbana|urbana|residencial/i,  Building2],
  [/cuarto de servicio/i,              Home],
];

function amenityIcon(a: string): React.ElementType {
  for (const [re, Icon] of AMENITY_ICON_MAP) {
    if (re.test(a)) return Icon;
  }
  return Check;
}

function Amenidades({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const clean = items.filter((a) => a && a.trim());
  if (clean.length === 0) return null;
  const CAP = 12;
  const shown = expanded ? clean : clean.slice(0, CAP);
  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-semibold text-[#111418]">Qué tiene</h3>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((a, i) => {
          const Icon = amenityIcon(a);
          return (
            <span
              key={`${a}-${i}`}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
              style={{ background: "#F3F0E8", border: "0.5px solid #E5E0D5", color: "#111418" }}
            >
              <Icon className="h-3 w-3 shrink-0 text-[#0F8A4F]" /> {a}
            </span>
          );
        })}
        {clean.length > CAP && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-[#0F8A4F] transition hover:text-[#0A5C36]"
            style={{ border: "0.5px solid #0F8A4F" }}
          >
            {expanded ? "Ver menos" : `+${clean.length - CAP} más`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── InfoTip — botón ⓘ con popover al click (cierra al clic afuera) ──────────────

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Más información"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold leading-none transition"
        style={{ border: "1px solid #C9C4B8", color: open ? "#0F8A4F" : "#6E726E", cursor: "pointer" }}
      >
        i
      </button>
      {open && (
        <span
          className="absolute z-50 block rounded-xl shadow-2xl"
          style={{ bottom: "calc(100% + 8px)", left: -8, width: "min(240px, 70vw)", background: "#111418", color: "#fff", padding: "10px 12px" }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="absolute" style={{ bottom: -6, left: 12, width: 12, height: 6, background: "#111418", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
          <span className="block text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.82)" }}>{text}</span>
        </span>
      )}
    </span>
  );
}

// ─── ValorEstimado — "Estimated market value" estilo Zillow (Zestimate) ──────────

function ValorEstimado({ listing }: { listing: ApiListingDetail }) {
  const isVenta = normalizeTipoOp(listing.tipo_operacion) === "venta";
  const area = listing.area_m2;
  const barrio = listing.barrio_nombre ?? "el barrio";

  // Valor estimado (Zestimate) + rango de venta, desde medianas del barrio × área.
  const p50 = listing.precio_m2_mediana_barrio;
  const p25 = listing.precio_m2_p25;
  const p75 = listing.precio_m2_p75;
  const valor = isVenta && p50 && area ? Math.round(p50 * area) : null;
  const rangoMin = isVenta && p25 && area ? Math.round(p25 * area) : null;
  const rangoMax = isVenta && p75 && area ? Math.round(p75 * area) : null;

  // Renta estimada del barrio (canon típico p50).
  const renta = listing.arriendo_p50_barrio ?? null;

  // Avalúo catastral (comuna) × área — base fiscal, típicamente menor al mercado.
  const avaluoM2 = listing.avaluo_m2_catastro;
  const avaluo = isVenta && avaluoM2 && area ? Math.round(avaluoM2 * area) : null;

  // Predial anual estimado = avalúo × tarifa municipal (‰ por estrato, Medellín).
  const PREDIAL_MILAJE: Record<number, number> = { 1: 5, 2: 5, 3: 6, 4: 8, 5: 10, 6: 11 };
  const milaje = listing.estrato_real != null ? PREDIAL_MILAJE[listing.estrato_real] ?? 8 : 8;
  const predial = avaluo != null ? Math.round(avaluo * milaje / 1000) : null;

  if (valor == null && renta == null && avaluo == null) return null;

  const Row = ({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 border-b py-3 last:border-0" style={{ borderColor: "#E5E0D5" }}>
      <div className="flex items-center gap-1.5 pt-0.5">
        <span className="text-[13px]" style={{ color: "#5B5F5C" }}>{label}</span>
        <InfoTip text={tip} />
      </div>
      <div className="text-right">{children}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: "#111418" }}>Valor estimado</h3>
      <div>
        {valor != null && (
          <Row label="Valor de mercado" tip={`Precio de venta probable, estimado con el precio/m² típico de ${barrio} multiplicado por los ${area}m² de este inmueble.`}>
            <div className="text-[19px] font-semibold tabular-nums leading-none" style={{ color: "#0F8A4F" }}>{formatCOP(valor)}</div>
            {rangoMin != null && rangoMax != null && (
              <div className="mt-1 text-[11px] tabular-nums" style={{ color: "#6E726E" }}>{formatCOP(rangoMin)} – {formatCOP(rangoMax)}</div>
            )}
          </Row>
        )}
        {renta != null && (
          <Row label="Renta estimada" tip={`Canon de arriendo mensual típico para inmuebles similares en ${barrio}.`}>
            <div className="text-[15px] font-semibold tabular-nums" style={{ color: "#111418" }}>{formatCOP(renta)}<span className="text-[11px] font-normal" style={{ color: "#6E726E" }}>/mes</span></div>
          </Row>
        )}
        {avaluo != null && (
          <Row
            label="Avalúo catastral"
            tip={`Valor fiscal del predio según el catastro de Medellín (estimado con el avalúo/m² de la comuna). Es la base sobre la que se cobran los impuestos y casi siempre es menor al precio de mercado — aquí, cerca de ${valor && avaluo ? Math.round(valor / avaluo) : 4}× por debajo.`}
          >
            <div className="text-[15px] font-semibold tabular-nums" style={{ color: "#111418" }}>{formatCOP(avaluo)}</div>
          </Row>
        )}
        {predial != null && (
          <Row
            label="Predial estimado"
            tip={`Impuesto predial anual aproximado: avalúo catastral × tarifa del municipio (~${milaje} por mil${listing.estrato_real != null ? ` para estrato ${listing.estrato_real}` : ""} en Medellín). La tarifa exacta la fija la Alcaldía según estrato y uso.`}
          >
            <div className="text-[15px] font-semibold tabular-nums" style={{ color: "#111418" }}>{formatCOP(predial)}<span className="text-[11px] font-normal" style={{ color: "#6E726E" }}>/año</span></div>
          </Row>
        )}
      </div>
    </div>
  );
}

function YieldMultiModal({ listing }: { listing: ApiListingDetail }) {
  const precio = listing.precio_cop;
  const arrLargo = listing.arriendo_p50_barrio;
  const yieldAirbnbPct = listing.yield_bruto_pct;
  const nomada = listing.indice_nomada ?? 0;
  if (!precio) return null;
  const arrNomadaMensual = arrLargo ? arrLargo * 1.35 : null;
  const rows = [
    { label: "Airbnb (corto)",  ingreso: yieldAirbnbPct ? precio * yieldAirbnbPct / 100 / 12 : null, yield: yieldAirbnbPct ?? null },
    { label: "Nómadas (medio)", ingreso: arrNomadaMensual, yield: arrNomadaMensual ? (arrNomadaMensual * 12) / precio * 100 : null },
    { label: "Renta larga",     ingreso: arrLargo ?? null, yield: arrLargo ? (arrLargo * 12) / precio * 100 : null },
  ];
  if (rows.every((r) => r.ingreso == null)) return null;
  const mejorOpcion = nomada > 6 ? "Airbnb — zona turística activa" : nomada > 3 ? "Nómadas — demanda internacional" : "Renta larga — zona residencial estable";

  let razon: string;
  if (nomada > 6 && (listing.score_corto ?? 0) > 60) {
    razon = `Alta demanda turística en la zona (${nomada.toFixed(1)}/10) con buen potencial de ocupación para renta corta.`;
  } else if (nomada >= 3) {
    razon = "Zona mixta con demanda de profesionales y nómadas digitales. Balance entre ocupación y estabilidad.";
  } else {
    razon = `Zona principalmente residencial (índice nómada ${nomada.toFixed(1)}/10). Mayor estabilidad de ocupación a largo plazo.`;
  }
  const segScore = listing.seguridad_score ?? null;
  if (segScore != null && segScore < 40) {
    razon += " — considera el índice de seguridad antes de decidir.";
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-[#111418]">Si arriendas esta propiedad</h3>
      <div className="overflow-hidden rounded-xl" style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF" }}>
        {rows.map(({ label, ingreso, yield: yPct }) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm" style={{ borderBottom: "0.5px solid #F3F0E8" }}>
            <span className="text-[#5B5F5C]">{label}</span>
            <div className="flex items-center gap-2 text-right">
              {ingreso != null && <span className="text-xs text-[#5B5F5C]">{formatCOP(ingreso)}/mes</span>}
              {yPct != null && <span className="font-semibold text-[#0F8A4F]">{yPct.toFixed(1)}%</span>}
            </div>
          </div>
        ))}
        <div className="px-4 py-2.5 space-y-1" style={{ background: "#F3F0E8" }}>
          <div>
            <span className="text-xs text-[#5B5F5C]">Mejor opción para {listing.barrio_nombre ?? "la zona"}: </span>
            <span className="text-xs font-semibold text-[#111418]">{mejorOpcion}</span>
          </div>
          <p className="text-[12px] italic leading-snug text-[#5B5F5C]">{razon}</p>
        </div>
      </div>
    </div>
  );
}

function AlertModal({ listing, onClose }: { listing: ApiListingDetail; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  async function crearAlerta() {
    setLoading(true);
    try {
      await apiFetch(API_ENDPOINTS.alertasCrear, {
        method: "POST",
        body: JSON.stringify({
          barrio_id: listing.barrio_id,
          tipo_operacion: listing.tipo_operacion ?? "venta",
          precio_max: listing.precio_cop,
          tipo_inmueble: listing.tipo_inmueble,
        }),
      });
      toast.success("Alerta creada ✅ Te avisamos si baja de precio.");
      onClose();
    } catch {
      toast.error("Error al crear la alerta");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl p-5 shadow-2xl"
        style={{ background: "#FAF8F3", border: "0.5px solid #E5E0D5" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-[#0F8A4F]" />
            <span className="font-semibold text-[#111418]">Alerta de precio</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="grid h-11 w-11 place-items-center text-[#5B5F5C] hover:text-[#111418]"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-sm text-[#5B5F5C]">
          Te avisamos si esta propiedad baja de precio o aparece algo similar en{" "}
          <strong>{listing.barrio_nombre ?? "el barrio"}</strong>.
        </p>
        <button
          onClick={crearAlerta}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          style={{ background: "#0F8A4F" }}
        >
          <Bell className="h-4 w-4" />
          {loading ? "Creando…" : "Crear alerta →"}
        </button>
      </div>
    </div>
  );
}

// ─── BarrioReport ─────────────────────────────────────────────────────────────

type BarrioFetch = {
  seguridad?: { score?: number | null } | null;
  conectividad?: {
    dist_metro_km?: number | null;
    indice_nomada?: number | null;
    n_colegios_1km?: number | null;
    dist_colegio_km?: number | null;
    walk_score?: number | null;
    transit_score?: number | null;
  } | null;
  liquidez?: { score?: number | null } | null;
  trafico?: { nivel?: string | null; jam_prom?: number | null } | null;
};

/** Score bar en escala 1-10 estilo Zillow. Recibe score interno 0-100. Público. */
function ScoreBar({ label, score, sub }: { label: string; score: number; sub: string }) {
  const color = score >= 70 ? "#0F8A4F" : score >= 40 ? "#8A6A00" : "#CE1126";
  const s10 = score > 0 ? Math.max(1, Math.round(score / 10)) : 0;
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: "#F3F0E8", border: "0.5px solid #E5E0D5" }}>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="min-w-0 text-xs font-semibold text-[#5B5F5C]">{label}</span>
        <span className="shrink-0 text-lg font-bold" style={{ color }}>{s10}<span className="text-[11px] font-normal text-[#6E726E]">/10</span></span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "#E5E0D5" }}>
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <div className="mt-1 text-[11px]" style={{ color: "#6E726E" }}>{sub}</div>
    </div>
  );
}

/** "Cómo moverse" (Walk/Transit) + colegios cercanos. Público, estilo Zillow. */
function GettingAround({ barrioId }: { barrioId: number }) {
  const { data } = useQuery<BarrioFetch>({
    queryKey: ["barrio-full", barrioId],
    queryFn: () => apiFetch<BarrioFetch>(API_ENDPOINTS.barrio(barrioId)),
    staleTime: 300_000,
  });
  const c = data?.conectividad;
  const trafico = data?.trafico;
  if (!c && trafico?.nivel == null) return null;
  const walk = c?.walk_score;
  const transit = c?.transit_score;
  const nColegios = c?.n_colegios_1km;
  const distColegio = c?.dist_colegio_km;
  const walkSub = (s: number) => s >= 70 ? "Muy caminable" : s >= 40 ? "Algo caminable" : "Requiere carro";
  const transitSub = (s: number) => s >= 70 ? "Metro a pasos" : s >= 40 ? "Metro cercano" : "Metro lejos";

  // Score de colegios 0-100 desde densidad en 1km (n*16, satura ~6+ colegios).
  const colegioScore = nColegios != null && nColegios > 0 ? Math.min(100, nColegios * 16) : null;
  const colegioSub = nColegios != null
    ? `${nColegios} a 1 km${distColegio != null ? ` · ${distColegio.toFixed(1)} km` : ""}`
    : "";

  // jamFactor HERE (0=libre, 10=parado) invertido a score 0-100 (100=fluido), estilo walk/transit.
  const traficoScore = trafico?.jam_prom != null ? Math.max(0, Math.min(100, (10 - trafico.jam_prom) * 10)) : null;
  const traficoSub = trafico?.nivel === "bajo" ? "Vías fluidas" : trafico?.nivel === "alto" ? "Tráfico pesado" : "Tráfico moderado";

  const tiles: { label: string; score: number; sub: string }[] = [];
  if (walk != null) tiles.push({ label: "Caminabilidad", score: walk, sub: walkSub(walk) });
  if (transit != null) tiles.push({ label: "Transporte público", score: transit, sub: transitSub(transit) });
  if (colegioScore != null) tiles.push({ label: "Colegios", score: colegioScore, sub: colegioSub });
  if (traficoScore != null) tiles.push({ label: "Tráfico", score: traficoScore, sub: traficoSub });
  if (tiles.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-semibold" style={{ color: "#111418" }}>Entorno</h3>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(130px, 1fr))` }}>
        {tiles.map((t) => (
          <ScoreBar key={t.label} label={t.label} score={t.score} sub={t.sub} />
        ))}
      </div>
    </div>
  );
}


// ─── Agendar visita — popup estilo Zillow (día con flechas + hora desplegable) ──

const DIAS_VENTANA = 5; // días visibles por página

// toLocaleDateString('es') da "lun."/"ene." (minúscula + punto); normalizamos a
// "Lun"/"Ene" para conservar el estilo previo. EN sale "Mon"/"Oct" tal cual.
const cap = (s: string) => s.replace(/\.$/, "").replace(/^\p{L}/u, (c) => c.toUpperCase());

type DiaInfo = { date: Date; label: string; sub: string; largo: string };
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function dayInfo(d: Date, lang: string): DiaInfo {
  const loc = lang === "en" ? "en-US" : "es-CO";
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
  const diff = Math.round((d0.getTime() - t0.getTime()) / 86400000);
  const hoy = lang === "en" ? "Today" : "Hoy";
  const manana = lang === "en" ? "Tomorrow" : "Mañana";
  const label = diff === 0 ? hoy : diff === 1 ? manana : cap(d.toLocaleDateString(loc, { weekday: "short" }));
  const largo = diff === 0 ? hoy : diff === 1 ? manana : cap(d.toLocaleDateString(loc, { weekday: "long" }));
  const mes = cap(d.toLocaleDateString(loc, { month: "short" }));
  return { date: d, label, sub: `${d.getDate()} ${mes}`, largo };
}
function proximosDias(n: number, lang: string): DiaInfo[] {
  const dias: DiaInfo[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dias.push(dayInfo(d, lang));
  }
  return dias;
}

function horasVisita(): string[] {
  const out: string[] = [];
  for (let h = 8; h <= 18; h++) {
    for (const m of [0, 30]) {
      if (h === 18 && m === 30) break;
      const ampm = h < 12 ? "AM" : "PM";
      const hh = h <= 12 ? h : h - 12;
      out.push(`${hh}:${String(m).padStart(2, "0")} ${ampm}`);
    }
  }
  return out;
}

// Select compacto reutilizado por los 4 campos de calificación del lead.
function CampoSelect({
  label, value, onChange, opciones,
}: { label: string; value: string; onChange: (v: string) => void; opciones: [string, string][] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#5B5F5C]">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl px-3 py-2.5 text-sm transition focus:outline-none"
        style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF", color: value ? "#111418" : "#6E726E" }}
      >
        <option value="">Sin especificar</option>
        {opciones.map(([v, txt]) => (
          <option key={v} value={v} style={{ color: "#111418" }}>{txt}</option>
        ))}
      </select>
    </div>
  );
}

function ScheduleVisitModal({
  agente, listingId, listingUrl, onClose,
}: { agente?: ApiListingAgente | null; listingId?: number | null; listingUrl?: string | null; onClose: () => void }) {
  const { lang } = useLang();
  // Slots reales del agente de zona (horario propio menos reservados). Si no hay
  // agente/horario configurado, cae al horario genérico (fallback).
  const [slotMap, setSlotMap] = useState<Record<string, string[]> | null>(null);
  useEffect(() => {
    if (listingId == null) return;
    apiFetch<{ configured: boolean; slots: Record<string, string[]> }>(API_ENDPOINTS.listingSlots(listingId))
      .then((r) => { if (r.configured && Object.keys(r.slots).length) setSlotMap(r.slots); })
      .catch(() => {});
  }, [listingId]);

  const [page, setPage] = useState(0);
  const [diaIdx, setDiaIdx] = useState(0);
  const [hora, setHora] = useState("");
  const [nombre, setNombre] = useState(() => auth.get()?.name ?? "");
  const [telefono, setTelefono] = useState("");
  // Calificación del lead (Zillow paso 2) — opcional, colapsada: no frena el envío.
  const [mostrarMas, setMostrarMas] = useState(false);
  const [intencion, setIntencion] = useState("");
  const [presupuesto, setPresupuesto] = useState("");
  const [plazo, setPlazo] = useState("");
  const [credito, setCredito] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);  // recap "cuando" tras confirmar

  const realMode = !!slotMap;
  const dias = useMemo<DiaInfo[]>(
    () => (slotMap ? Object.keys(slotMap).sort().map((iso) => dayInfo(new Date(iso + "T12:00:00"), lang)) : proximosDias(30, lang)),
    [slotMap, lang],
  );
  const diaSel = dias[Math.min(diaIdx, dias.length - 1)];
  const horas = realMode ? (diaSel ? slotMap![dateKey(diaSel.date)] ?? [] : []) : horasVisita();

  const maxPage = Math.max(0, Math.ceil(dias.length / DIAS_VENTANA) - 1);
  const visibles = dias.slice(page * DIAS_VENTANA, page * DIAS_VENTANA + DIAS_VENTANA);
  const puedeEnviar = !!hora && nombre.trim().length > 1 && telefono.replace(/\D/g, "").length >= 7;

  async function confirmar() {
    if (!puedeEnviar || enviando || !diaSel) return;
    const dia = diaSel;
    const cuando = `${dia.largo} ${dia.sub} ${lang === "en" ? "at" : "a las"} ${hora}`;
    const [hm, ampm] = hora.split(" ");
    const [hh, mm] = hm.split(":").map(Number);
    const fecha = new Date(dia.date);
    fecha.setHours(ampm === "PM" && hh !== 12 ? hh + 12 : hh, mm, 0, 0);

    // Persistir la solicitud para la agenda del realtor.
    setEnviando(true);
    try {
      if (listingUrl) {
        await apiFetch(API_ENDPOINTS.visitas, {
          method: "POST",
          body: JSON.stringify({
            listing_url: listingUrl,
            nombre: nombre.trim(),
            telefono: telefono.trim(),
            fecha_visita: fecha.toISOString(),
            mensaje: cuando,
            // Calificación del lead — solo se mandan los que el usuario llenó.
            intencion: intencion || undefined,
            presupuesto: presupuesto || undefined,
            plazo: plazo || undefined,
            credito: credito || undefined,
            // Sin agente de zona → el backend enruta al buzón interno por email.
            sin_agente: !agente,
          }),
        });
      }
      // Solo se guarda la solicitud (nombre, contacto, listing, fecha). El agente
      // la ve en su agenda y contacta al interesado. Sin WhatsApp automático.
      // Pantalla de confirmación con recap → el usuario cierra con "Listo".
      setEnviado(cuando);
    } catch {
      toast.error("No pudimos registrar la visita. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agendar visita"
        className="relative w-full max-w-md overflow-hidden rounded-2xl"
        style={{ background: "#FFFFFF", boxShadow: "0 25px 60px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Confirmación — recap tras enviar; cubre el formulario hasta "Listo". */}
        {enviado && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white px-8 py-10 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full" style={{ background: "#E7F4EC" }}>
              <Check className="h-7 w-7" style={{ color: "#0F8A4F" }} />
            </div>
            <h3 className="text-lg font-bold" style={{ fontFamily: "'Fraunces', Georgia, serif", color: "#111418" }}>
              ¡Visita solicitada!
            </h3>
            <p className="text-sm font-medium capitalize" style={{ color: "#111418" }}>{enviado}</p>
            {agente && <p className="text-[13px]" style={{ color: "#5B5F5C" }}>Con <Name>{agente.nombre}</Name></p>}
            <p className="mt-1 text-[13px]" style={{ color: "#5B5F5C" }}>Te contactaremos pronto para confirmar.</p>
            <button
              onClick={onClose}
              className="mt-4 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ background: "#0F8A4F" }}
            >
              Listo
            </button>
          </div>
        )}
        {/* Header con acento */}
        <div className="px-6 pt-6 pb-5" style={{ background: "linear-gradient(135deg, #0F8A4F 0%, #0A5C36 100%)" }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5 text-white">
              <Calendar className="h-5 w-5" />
              <h3 className="text-lg font-bold" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                Agendar una visita
              </h3>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="grid h-7 w-7 place-items-center rounded-lg text-white/80 transition hover:bg-white/15 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          {agente && (
            <p className="mt-1.5 text-[13px] text-white/85">Con <Name>{agente.nombre}</Name></p>
          )}
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Día — flechas laterales + ventana de días */}
          <div>
            <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[#5B5F5C]">Elige un día</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Días anteriores"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition disabled:opacity-30"
                style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF", color: "#0F8A4F" }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="grid flex-1 grid-cols-5 gap-1.5">
                {visibles.map((d) => {
                  const abs = dias.indexOf(d);
                  const sel = abs === diaIdx;
                  return (
                    <button
                      key={abs}
                      onClick={() => { setDiaIdx(abs); setHora(""); }}
                      className="flex flex-col items-center rounded-xl py-2 text-center transition"
                      style={sel
                        ? { background: "#0F8A4F", color: "#FFFFFF", boxShadow: "0 2px 8px rgba(29,158,117,0.3)" }
                        : { background: "#F3F0E8", color: "#5B5F5C" }}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide">{d.label}</span>
                      <span className="text-[13px] font-bold leading-tight">{d.date.getDate()}</span>
                      <span className="text-[9px] opacity-75">{cap(d.date.toLocaleDateString(lang === "en" ? "en-US" : "es-CO", { month: "short" }))}</span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                disabled={page === maxPage}
                aria-label="Días siguientes"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition disabled:opacity-30"
                style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF", color: "#0F8A4F" }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Hora — lista desplegable */}
          <div>
            <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[#5B5F5C]">Elige una hora</div>
            <div className="relative">
              <select
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full appearance-none rounded-xl px-4 py-3 pr-10 text-sm font-medium transition focus:outline-none"
                style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF", color: hora ? "#111418" : "#6E726E" }}
              >
                <option value="" disabled>Selecciona una hora</option>
                {horas.map((h) => (
                  <option key={h} value={h} style={{ color: "#111418" }}>{h}</option>
                ))}
              </select>
              <Clock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6E726E]" />
            </div>
          </div>

          {/* Contacto del solicitante — para que el agente devuelva la llamada */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#5B5F5C]">Tu nombre</div>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre"
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF", color: "#111418" }}
              />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#5B5F5C]">Tu teléfono</div>
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                inputMode="tel"
                placeholder="300 000 0000"
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF", color: "#111418" }}
              />
            </div>
          </div>

          {/* Calificación del lead — opcional, colapsada. Al agente le llega "con
              quién habla" (presupuesto/plazo/crédito); no obliga para no frenar. */}
          <div>
            <button
              type="button"
              onClick={() => setMostrarMas((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider transition"
              style={{ color: "#5B5F5C", background: mostrarMas ? "#F3F0E8" : "transparent" }}
            >
              <span>Cuéntanos más para preparar tu visita (opcional)</span>
              <ChevronRight className={`h-4 w-4 transition-transform ${mostrarMas ? "rotate-90" : ""}`} />
            </button>
            {mostrarMas && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <CampoSelect label="¿Para qué?" value={intencion} onChange={setIntencion}
                  opciones={[["vivir", "Para vivir"], ["invertir", "Para invertir"]]} />
                <CampoSelect label="Presupuesto" value={presupuesto} onChange={setPresupuesto}
                  opciones={[["<200M", "Menos de $200M"], ["200-500M", "$200M – $500M"], ["500-1000M", "$500M – $1.000M"], [">1000M", "Más de $1.000M"]]} />
                <CampoSelect label="¿Cuándo?" value={plazo} onChange={setPlazo}
                  opciones={[["ya", "Lo antes posible"], ["1-3m", "1 a 3 meses"], ["3-6m", "3 a 6 meses"], ["explorando", "Solo explorando"]]} />
                <CampoSelect label="Crédito" value={credito} onChange={setCredito}
                  opciones={[["contado", "De contado"], ["aprobado", "Crédito aprobado"], ["en_tramite", "En trámite"], ["no", "Aún no"]]} />
              </div>
            )}
          </div>

          <button
            onClick={confirmar}
            disabled={!puedeEnviar || enviando}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            style={{ background: "#0F8A4F" }}
          >
            <Calendar className="h-4 w-4" />
            {enviando ? "Enviando…" : "Solicitar visita"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tarjetas de contacto del realtor (columna 2) ───────────────────────────────

function waLink(agente: ApiListingAgente, listingId: number): string {
  const tel = agente.telefono.replace(/\D/g, "");
  const num = tel.startsWith("57") ? tel : `57${tel}`;
  const text = encodeURIComponent(`Hola ${agente.nombre}, me interesa este inmueble (ID: ${listingId}).`);
  return `https://wa.me/+${num}?text=${text}`;
}

/** Realtor de comuna — patrocinio principal ($1k), tarjeta prominente. El de
 *  barrio (secundario) aparece discreto como un botón al lado, estilo agendar. */
function RealtorPrimaryCard({
  listingId, agente, secondary, onSchedule,
}: { listingId: number; agente: ApiListingAgente; secondary?: ApiListingAgente | null; onSchedule: () => void }) {
  const esComuna = agente.zona_nivel === "comuna";
  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid #0F8A4F", background: "#FFFFFF", boxShadow: "0 4px 16px rgba(29,158,117,0.12)" }}>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full" style={{ background: "#E7F4EC", border: "2px solid #0F8A4F" }}>
          {agente.foto_url
            ? <img src={agente.foto_url} alt={agente.nombre} className="h-full w-full object-cover" />
            : <User className="h-7 w-7" style={{ color: "#0F8A4F" }} />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-bold" style={{ color: "#111418" }}><Name>{agente.nombre}</Name></div>
          <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#0A5C36" }}>
            <Shield className="h-3 w-3" /> Agente de la {esComuna ? "comuna" : "zona"}
          </div>
        </div>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <a
          href={waLink(agente, listingId)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "#0F8A4F" }}
        >
          <Phone className="h-4 w-4" /> Contactar
        </a>
        <button
          onClick={onSchedule}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition hover:opacity-90"
          style={{ border: "1px solid #0F8A4F", color: "#0A5C36", background: "#E7F4EC" }}
        >
          <Calendar className="h-4 w-4" /> Agendar visita
        </button>
        {/* Realtor 2 (barrio) — discreto, un botón al lado como los de arriba */}
        {secondary && (
          <a
            href={waLink(secondary, listingId)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-1.5 pt-1 text-[11px] transition hover:opacity-70"
            style={{ color: "#6E726E" }}
          >
            <User className="h-3 w-3" />
            <span className="truncate">También: <Name>{secondary.nombre}</Name>, agente del barrio</span>
          </a>
        )}
      </div>
    </div>
  );
}

/** Fallback sin patrocinio: contacto genérico del equipo. */
function RealtorFallbackCard({ waUrl, onSchedule }: { waUrl: string; onSchedule: () => void }) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF" }}>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: "#E7F4EC" }}>
          <User className="h-6 w-6" style={{ color: "#0F8A4F" }} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: "#111418" }}>Equipo Medellín Social</div>
          <div className="text-[11px]" style={{ color: "#5B5F5C" }}>Contacto</div>
        </div>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "#0F8A4F" }}
        >
          <Phone className="h-4 w-4" /> Contactar
        </a>
        <button
          onClick={onSchedule}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition hover:opacity-90"
          style={{ border: "1px solid #0F8A4F", color: "#0A5C36", background: "#E7F4EC" }}
        >
          <Calendar className="h-4 w-4" /> Agendar visita
        </button>
      </div>
    </div>
  );
}

/** Columna 2 completa: comuna (principal) + barrio (secundario), o fallback. */
function RealtorColumn({
  listingId, agentes, waUrl, onSchedule,
}: { listingId: number; agentes?: ApiListingAgentes | null; waUrl: string; onSchedule: () => void }) {
  const comuna = agentes?.comuna ?? null;
  const barrio = agentes?.barrio ?? null;
  if (!comuna && !barrio) return <RealtorFallbackCard waUrl={waUrl} onSchedule={onSchedule} />;
  // Comuna = principal; barrio = botón discreto al lado. Sin comuna, barrio sube a principal.
  const principal = comuna ?? barrio!;
  const secundario = comuna ? barrio : null;
  return (
    <RealtorPrimaryCard listingId={listingId} agente={principal} secondary={secundario} onSchedule={onSchedule} />
  );
}

// ─── main component ────────────────────────────────────────────────────────────

type Props = {
  listingId: number | null;
  onClose: () => void;
};

export function ListingDrawer({ listingId, onClose }: Props) {
  const { formatPrice, formatSecondary, formatPricePerArea } = usePriceFormat();
  const { lang } = useLang();
  const { unit } = useUnit();
  const isMobile = useIsMobile();
  const dragControls = useDragControls();
  const navigate = useNavigate();
  const { isFav, toggle: toggleFav } = useFavoritosListings();
  const { target } = useTarget();
  const isInvestor = target === "investor";
  const isLandlord = target === "landlord";
  const isPro = useIsPro();
  const { addListing, removeListing, isSelected: isInComparador, canAdd: canAddToComparador } = useComparadorStore();
  const closedRef = useRef(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showReclamar, setShowReclamar] = useState(false);

  const { data: agentes } = useQuery<ApiListingAgentes>({
    queryKey: ["listing-agente", listingId],
    queryFn: () => apiFetch<ApiListingAgentes>(API_ENDPOINTS.listingAgente(listingId!)),
    enabled: listingId != null,
    staleTime: 300_000,
  });
  // Realtor para el modal de agenda: comuna (principal) o barrio si no hay comuna.
  const agenteContacto = agentes?.comuna ?? agentes?.barrio ?? null;

  const { data: listing, isLoading } = useQuery<ApiListingDetail>({
    queryKey: ["listing-drawer", listingId],
    queryFn: () => apiFetch(API_ENDPOINTS.listing(listingId!)),
    enabled: listingId != null,
    staleTime: 60_000,
  });

  const { data: similares } = useQuery<SimilarListing[]>({
    queryKey: ["listing-similares", listingId],
    queryFn: () => apiFetch(API_ENDPOINTS.listingSimilares(listingId!)),
    enabled: listingId != null && !!listing,
    staleTime: 120_000,
  });

  // Regla de negocio: inmueble = público; inteligencia de barrio/mercado = solo realtor.
  // Flag local (plan==='agente') OR señal server-side (buena_oferta/pct_bajo_mediana
  // solo llegan non-null si is_agente() pasó — cubre aprobados en tabla `agentes`).
  const isRealtor =
    useIsAgente() || listing?.buena_oferta != null || listing?.pct_bajo_mediana != null;

  useEffect(() => {
    if (!listingId) return;
    closedRef.current = false;
    apiFetch(API_ENDPOINTS.listingVista(listingId), { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    return () => { closedRef.current = true; };
  }, [listingId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    // Lock page scroll while the drawer is open at ANY breakpoint (a viewport flip while
    // open can no longer leave overflow:hidden stuck or fail to lock).
    if (listingId) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      // iOS: the map canvas under the sheet kept receiving touches (pan/zoom behind the
      // drawer). styles.css turns map pointer events off while this class is set.
      document.body.classList.add("drawer-open");
      return () => {
        document.body.style.overflow = prev;
        document.body.classList.remove("drawer-open");
      };
    }
  }, [listingId]);

  // Update meta tags while popup is open
  useEffect(() => {
    if (!listing) return;
    const prevTitle = document.title;
    const price = formatPrice(listing.precio_cop);
    const tipo  = (listing.tipo_inmueble ?? "Inmueble").replace(/_/g, " ");
    const barrio = listing.barrio_nombre ?? "Medellín";
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const en = lang === "en";
    const tipoT = en ? translateString(cap(tipo)) : cap(tipo);
    document.title = `${tipoT} ${en ? "in" : "en"} ${barrio} | ${price} — Medellín Social`;
    const metaEl = document.querySelector('meta[name="description"]');
    const prevDesc = metaEl?.getAttribute("content") ?? null;
    metaEl?.setAttribute("content", (en
      ? `${tipoT} in ${barrio} for ${price}. See photos, analysis and contact the agent.`
      : `${tipoT} en ${barrio} por ${price}. Ver fotos, análisis y contactar agente.`));
    return () => {
      document.title = prevTitle;
      if (metaEl && prevDesc) metaEl.setAttribute("content", prevDesc);
    };
  }, [listing, lang, formatPrice]);

  if (!listingId) return null;

  const tipoOp = normalizeTipoOp(listing?.tipo_operacion);
  const fuente = (listing?.fuente ?? "").toLowerCase();
  const lat    = listing?.lat;
  const lon    = listing?.lon;

  const heroMapUrl =
    lat != null && lon != null
      ? `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-l+1D9E75(${lon},${lat})/${lon},${lat},15,0/560x220@2x?access_token=${MAPBOX_TOKEN}`
      : null;

  const waText = encodeURIComponent(
    `Hola, me interesa este inmueble en ${listing?.barrio_nombre ?? "Medellín"} por ${formatPrice(listing?.precio_cop)}. ID: ${listingId}`,
  );
  const waUrl = `https://wa.me/+573122502394?text=${waText}`;

  function handleShare() {
    const url = `${window.location.origin}/map?listing=${listingId}`;
    void copyText(url).then((ok) => (ok ? toast.success("Link copiado ✅") : toast.error("No se pudo copiar el link")));
  }

  // ─── Reusable fragments ────────────────────────────────────────────────────

  const tourSrc = toEmbedSrc(listing?.tour_url) ?? toEmbedSrc(listing?.video_url);
  const tourSection = tourSrc ? (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: "#111418" }}>
        Tour 3D / Video
      </h3>
      <div className="overflow-hidden rounded-xl" style={{ border: "0.5px solid #E5E0D5", aspectRatio: "16 / 9" }}>
        <iframe
          src={tourSrc}
          title="Tour 3D"
          className="h-full w-full"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer"
          allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"
          allowFullScreen
        />
      </div>
    </div>
  ) : null;

  const esDestacado = listing?.fuente_display === "propio_pro" || listing?.fuente_display === "agente_verificado";
  // Sello de due diligence: solo aplica a publicaciones propias (modelo unificado).
  const esPropio = listing?.fuente === "propio";
  const badgesRow = listing ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {esPropio && (
        listing.verificado ? (
          <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: "#0A5C36", color: "#FFFFFF" }}>
            ✓ Verificado
          </span>
        ) : (
          <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: "#F3F0E8", color: "#8A7A64", border: "1px solid #E5E0D5" }}>
            Sin verificar
          </span>
        )
      )}
      {esDestacado && (
        <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: "#FCD116", color: "#111418" }}>
          ★ Destacado
        </span>
      )}
      <span
        className="rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider"
        style={{ background: tipoOp === "arriendo" ? "#0F8A4F" : "#CE1126", color: "#FFFFFF" }}
      >
        {tipoOp === "arriendo" ? "Arriendo" : "Venta"}
      </span>
      {listing.tipo_inmueble && (
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider capitalize"
          style={{ background: TIPO_INMUEBLE_COLOR[listing.tipo_inmueble] ?? "#6E726E", color: "#FFFFFF" }}
        >
          {listing.tipo_inmueble.replace(/_/g, " ")}
        </span>
      )}
    </div>
  ) : null;

  // Specs inline — van a la derecha del precio (mismo nivel), estilo Zillow.
  const specsInline = listing && (listing.area_m2 != null || listing.habitaciones != null || listing.banos != null) ? (
    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#111418" }}>
      {listing.area_m2 != null && <span className="flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5 text-[#5B5F5C]" />{formatArea(listing.area_m2, unit)}</span>}
      {listing.habitaciones != null && <span className="flex items-center gap-1"><Bed className="h-3.5 w-3.5 text-[#5B5F5C]" />{listing.habitaciones === 0 ? "Studio" : `${listing.habitaciones} hab`}</span>}
      {listing.banos != null && <span className="flex items-center gap-1"><Bath className="h-3.5 w-3.5 text-[#5B5F5C]" />{listing.banos} baños</span>}
    </div>
  ) : null;

  // Tabla de datos estilo Zillow (2 columnas). Cada celda solo si hay dato.
  const precioM2Label = (v: number) => formatPricePerArea(v);
  const facts: { icon: React.ReactNode; text: string }[] = [];
  if (listing?.tipo_inmueble) facts.push({ icon: <Home className="h-4 w-4" />, text: listing.tipo_inmueble.replace(/_/g, " ") });
  if (listing?.nombre_edificio) facts.push({ icon: <Building2 className="h-4 w-4" />, text: listing.nombre_edificio });
  const antiguedadTxt = formatAntiguedad(listing?.antiguedad, lang);
  if (antiguedadTxt) facts.push({ icon: <Clock className="h-4 w-4" />, text: antiguedadTxt });
  if (listing?.tipo_operacion === "venta" && listing?.precio_m2) facts.push({ icon: <BarChart2 className="h-4 w-4" />, text: `${precioM2Label(listing.precio_m2)}` });
  if (listing?.parqueaderos != null && listing.parqueaderos > 0) facts.push({ icon: <Car className="h-4 w-4" />, text: `${listing.parqueaderos} parqueadero${listing.parqueaderos === 1 ? "" : "s"}` });
  if (listing?.estrato_real != null) facts.push({ icon: <Shield className="h-4 w-4" />, text: `Estrato ${listing.estrato_real}` });
  if (listing?.piso != null) facts.push({ icon: <Layers className="h-4 w-4" />, text: `Piso ${listing.piso}` });
  if (listing?.uso_suelo_pot) facts.push({ icon: <Map className="h-4 w-4" />, text: POT_LABEL[listing.uso_suelo_pot] ?? listing.uso_suelo_pot });
  if (listing?.estado_inmueble) facts.push({ icon: <Check className="h-4 w-4" />, text: listing.estado_inmueble.toLowerCase() });
  const factsTable = facts.length > 0 ? (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl" style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF" }}>
      {facts.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-4 py-3 text-sm capitalize"
          style={{
            color: "#111418",
            borderRight: i % 2 === 0 ? "0.5px solid #F3F0E8" : "none",
            borderBottom: i < facts.length - (facts.length % 2 === 0 ? 2 : 1) ? "0.5px solid #F3F0E8" : "none",
          }}
        >
          <span className="shrink-0 text-[#0F8A4F]">{f.icon}</span>
          <span className="font-medium">{f.text}</span>
        </div>
      ))}
    </div>
  ) : null;

  // Línea de actividad estilo Zillow: días · vistas · guardados · (velocidad venta = realtor).
  const activityParts: string[] = [];
  if (listing?.dias_en_mercado != null && listing.dias_en_mercado >= 0)
    activityParts.push(listing.dias_en_mercado === 0 ? "Publicado hoy" : `${listing.dias_en_mercado} días en el mercado`);
  if (listing?.vistas) activityParts.push(`${listing.vistas} vistas`);
  if (listing?.favoritos_count) activityParts.push(`${listing.favoritos_count} guardados`);
  // Solo afirmamos "se vende más rápido" cuando el barrio es realmente líquido
  // (score ≥ 65, por encima del promedio); si no, no hacemos la afirmación.
  if (isRealtor && listing?.liquidez_score != null && listing.liquidez_score >= 65)
    activityParts.push(`se vende más rápido que ${Math.round(listing.liquidez_score)}% de la zona`);
  const activityLine = activityParts.length > 0 ? (
    <div className="text-xs" style={{ color: "#5B5F5C" }}>{activityParts.join("  ·  ")}</div>
  ) : null;

  // Favorito arriba, junto al precio — grande y visible sin scroll (antes vivía
  // enterrado al fondo del drawer, en ctaButtons).
  const favButton = listing ? (
    <button
      onClick={() => { if (!auth.get()) return; toggleFav(favKey(listing), listing.barrio_id); }}
      title={isFav(favKey(listing)) ? "Quitar de favoritos" : "Guardar"}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition"
      style={{ border: "0.5px solid #E5E0D5", background: isFav(favKey(listing)) ? "#FCE8EA" : "#FFFFFF" }}
    >
      <Heart className="h-5 w-5" style={{ color: isFav(favKey(listing)) ? "#CE1126" : "#5B5F5C" }} fill={isFav(favKey(listing)) ? "#CE1126" : "none"} />
    </button>
  ) : null;

  // Contactar/agendar viven en la columna de realtores. ctaButtons = acciones secundarias.
  const ctaButtons = listing ? (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        {isRealtor && (
          <button
            onClick={() => {
              const inComp = isInComparador(listing.id);
              if (inComp) {
                removeListing(listing.id);
                toast.success("Quitado del comparador");
              } else if (canAddToComparador) {
                addListing(listing as any);
                toast.success("Agregado al comparador");
              } else {
                toast.info("Máximo 5 inmuebles en el comparador");
              }
            }}
            title={isInComparador(listing.id) ? "Quitar del comparador" : "Agregar a comparación"}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-xs font-semibold transition"
            style={isInComparador(listing.id)
              ? { background: "#E7F4EC", color: "#0A5C36", border: "1px solid #0F8A4F" }
              : { border: "0.5px solid #0F8A4F", color: "#0F8A4F", background: "#FFFFFF" }
            }
          >
            {isInComparador(listing.id)
              ? <><Check className="h-3.5 w-3.5" /></>
              : <><Plus className="h-3.5 w-3.5" /> Comparar</>
            }
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleShare}
          title="Copiar link"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition"
          style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF" }}
        >
          <Share2 className="h-4 w-4 text-[#5B5F5C]" />
        </button>
      </div>
      <p className="text-[10px] leading-relaxed" style={{ color: "#9A8B76" }}>
        Información publicada por fuentes externas y propietarios. Medellín Social no
        garantiza la exactitud de precios, disponibilidad ni detalles — verifica con el
        agente antes de decidir.
      </p>
      {!esPropio && (
        <button
          onClick={() => {
            if (!auth.get()) {
              localStorage.setItem("registro_origen", "reclamo");
              window.location.href = "/register";
              return;
            }
            setShowReclamar(true);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition hover:opacity-90"
          style={{ border: "0.5px solid #0F8A4F", background: "#E7F4EC", color: "#0A5C36" }}
        >
          ¿Este inmueble es tuyo? Reclámalo
        </button>
      )}
      {isPro && listing.barrio_id && (
        <button
          onClick={() => setShowAlertModal(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition hover:opacity-90"
          style={{ border: "0.5px solid #0F8A4F", background: "#E7F4EC", color: "#0A5C36" }}
        >
          <Bell className="h-3.5 w-3.5" />
          Alertarme cuando baje de precio
        </button>
      )}
      {isRealtor && listing.tipo_operacion === "venta" && (
        <button
          onClick={() => {
            onClose();
            navigate({ to: "/simulador", search: { listing_id: listing.id } });
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition hover:opacity-90"
          style={{ border: "0.5px solid #0F8A4F", background: "transparent", color: "#0A5C36" }}
        >
          <BarChart2 className="h-3.5 w-3.5" />
          Simular esta propiedad
        </button>
      )}
    </div>
  ) : null;

  // Analysis sections (left col + mobile)
  const analysisContent = listing ? (
    <>
      {/* Qué tiene — amenidades */}
      {listing.amenidades && listing.amenidades.length > 0 && (
        <Amenidades items={listing.amenidades} />
      )}

      {/* Description — solo si existe */}
      {listing.descripcion && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#111418]">Descripción</h3>
          {/* Traducción offline bidireccional: si el idioma del source != idioma
              elegido y hay traducción, muéstrala; si no, el source (limpio). */}
          <CollapsibleDescription
            text={listing.descripcion_src_lang && listing.descripcion_src_lang !== lang && listing.descripcion_trad
              ? listing.descripcion_trad
              : cleanDescripcion(listing.descripcion)}
          />
        </div>
      )}

      {/* Historial de precio — todos los targets */}
      {(() => {
        const historia = listing.precio_historia ?? [];
        const fmtFecha = (d: Date) => formatDate(d, lang);

        // Sin historial (≈97% de los inmuebles): mostramos precio actual + fecha/año
        // y avisamos que estamos recopilando el histórico completo.
        if (historia.length === 0) {
          const fechaListado =
            listing.dias_en_mercado != null && listing.dias_en_mercado >= 0
              ? new Date(Date.now() - listing.dias_en_mercado * 86400000)
              : listing.fecha_scraping
                ? new Date(`${listing.fecha_scraping}T00:00:00`)
                : null;
          return (
            <div className="space-y-3">
              <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: "#111418" }}>Historial de precio</h3>
              <div className="flex items-baseline justify-between border-b pb-3" style={{ borderColor: "#E5E0D5" }}>
                <div>
                  <div className="text-[13px]" style={{ color: "#111418" }}>Publicado en venta</div>
                  {fechaListado && <div className="text-[11px]" style={{ color: "#6E726E" }}>{fmtFecha(fechaListado)}</div>}
                </div>
                <div className="text-[15px] font-semibold tabular-nums" style={{ color: "#111418" }}>
                  {formatPrice(listing.precio_cop)}
                </div>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "#6E726E" }}>
                Aún no hay cambios de precio registrados para este inmueble. Registramos cada variación desde su publicación.
              </p>
            </div>
          );
        }

        if (historia.length <= 2) {
          return (
            <div className="space-y-3">
              <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: "#111418" }}>Historial de precio</h3>
              <div className="space-y-2.5">
                {historia.map((h, i) => {
                  const daysAgo = Math.floor((Date.now() - new Date(h.fecha).getTime()) / 86400000);
                  const cuandoLabel = daysAgo === 0 ? (lang === "en" ? "Today" : "Hoy") : daysAgo === 1 ? (lang === "en" ? "1 day ago" : "Hace 1 día") : (lang === "en" ? `${daysAgo} days ago` : `Hace ${daysAgo} días`);
                  const sube = (h.delta_pct ?? 0) > 0;
                  const color = sube ? "#B4462F" : "#0F8A4F";
                  return (
                    <div key={i} className="flex items-baseline justify-between border-b pb-2.5 last:border-0" style={{ borderColor: "#E5E0D5" }}>
                      <div>
                        <div className="text-[13px]" style={{ color: "#111418" }}>{sube ? "Subió de precio" : "Bajó de precio"}</div>
                        <div className="text-[11px]" style={{ color: "#6E726E" }}>{cuandoLabel}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[14px] font-semibold tabular-nums" style={{ color: "#111418" }}>{formatPrice(h.precio)}</div>
                        {h.delta_pct != null && (
                          <div className="text-[11px] font-medium tabular-nums" style={{ color }}>
                            {sube ? "+" : "−"}{Math.abs(h.delta_pct).toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        // 3+ cambios → gráfica de área estilo Zillow
        const sorted = [...historia].sort((a, b) => a.fecha.localeCompare(b.fecha));
        const chartData = [
          ...sorted.map(h => ({
            fecha: h.fecha.slice(5, 10).replace("-", "/"), // MM/DD
            precio: h.precio,
          })),
          { fecha: lang === "en" ? "Today" : "Hoy", precio: listing.precio_cop ?? 0 },
        ];
        const currentPrecioM = listing.precio_cop ?? 0;

        return (
          <div className="space-y-3">
            <h3 className="text-[13px] font-semibold tracking-tight" style={{ color: "#111418" }}>Historial de precio</h3>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0F8A4F" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="#0F8A4F" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: "#6E726E" }} tickLine={false} axisLine={false} dy={4} />
                  <YAxis hide domain={["auto", "auto"]} />
                  <RechartsTooltip
                    formatter={(val: unknown) => [formatPrice(Number(val)), lang === "en" ? "Price" : "Precio"]}
                    contentStyle={{ background: "#111418", border: "none", borderRadius: 8, color: "#fff", fontSize: 11, padding: "6px 10px" }}
                    labelStyle={{ color: "rgba(255,255,255,0.6)", fontSize: 10 }}
                  />
                  <Area
                    type="monotone" dataKey="precio"
                    stroke="#0F8A4F" strokeWidth={2} fill="url(#priceFill)"
                    dot={{ r: 2.5, fill: "#0F8A4F", strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: "#0F8A4F" }}
                  />
                  <ReferenceDot x={lang === "en" ? "Today" : "Hoy"} y={currentPrecioM} r={4} fill="#111418" stroke="#fff" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Entorno — Walk/Transit score + colegios cercanos (público) */}
      {listing.barrio_id && <GettingAround barrioId={listing.barrio_id} />}

      {/* Valor estimado de mercado (Zestimate) — se auto-oculta si no hay medianas (público) */}
      <ValorEstimado listing={listing} />

      {/* ── INVESTOR: rentabilidad (mercado → solo realtor) ── */}
      {isRealtor && isInvestor && (
        <>
          <YieldMultiModal listing={listing} />
          {isPro && listing.score_corto != null && (
            <div className="flex items-center justify-between border-b py-3 text-[13px]" style={{ borderColor: "#E5E0D5" }}>
              <span style={{ color: "#5B5F5C" }}>Score de inversión</span>
              <span className="font-semibold tabular-nums" style={{ color: "#111418" }}>{Math.round(listing.score_corto / 10)}/10</span>
            </div>
          )}
        </>
      )}

      {/* ── LANDLORD: yield sin badge de compra (mercado → solo realtor) ────────── */}
      {isRealtor && isLandlord && <YieldMultiModal listing={listing} />}


      {/* CTA único para usuarios free */}
      {!isPro && (
        <a
          href="/planes"
          className="flex w-full items-center justify-center rounded-xl py-3 text-[13px] font-semibold transition hover:opacity-90"
          style={{ background: "#111418", color: "#FFFFFF" }}
        >
          Desbloquea el análisis completo con MLS Pro
        </a>
      )}

      {/* Mini mapa */}
      {heroMapUrl && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#111418]">Ubicación</h3>
          <div className="overflow-hidden rounded-xl" style={{ border: "0.5px solid #E5E0D5" }}>
            <img src={heroMapUrl} alt={lang === "en" ? `Location in ${listing.barrio_nombre}` : `Ubicación en ${listing.barrio_nombre}`} className="h-40 w-full object-cover" loading="lazy" />
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-[#5B5F5C]" style={{ borderTop: "0.5px solid #E5E0D5", background: "#FAFAFA" }}>
              <MapPin className="h-3 w-3 shrink-0" />
              {listing.barrio_nombre && <span><Name>{listing.barrio_nombre}</Name></span>}
              {listing.estrato_real != null && <span>· Estrato {listing.estrato_real}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  ) : null;

  const similaresSection = similares && similares.length > 0 ? (
    <div className="space-y-3 border-t pb-6" style={{ borderColor: "#E5E0D5", paddingTop: 20 }}>
      <h3 className="text-base font-bold" style={{ fontFamily: "'Fraunces', Georgia, serif", color: "#111418" }}>
        Propiedades similares
      </h3>
      <div className="grid grid-cols-2 gap-2.5">
        {similares.slice(0, 4).map((s) => (
          <button
            key={s.id}
            onClick={() => onClose()}
            onClickCapture={() => { window.dispatchEvent(new CustomEvent("open-listing-drawer", { detail: { id: s.id } })); }}
            className="group flex flex-col overflow-hidden rounded-xl text-left transition hover:shadow-md"
            style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF" }}
          >
            <div className="relative h-36 overflow-hidden" style={{ background: "#F3F0E8" }}>
              {s.foto_principal ? (
                <img src={s.foto_principal} alt={s.tipo_inmueble ?? "Foto"} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center" style={{ background: "linear-gradient(135deg, #0F8A4F 0%, #0A5C36 100%)" }}>
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 28, height: 28, opacity: 0.45 }}>
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
            </div>
            <div className="space-y-0.5 p-2.5">
              <div className="text-sm font-semibold" style={{ color: "#111418" }}>{formatPrice(s.precio_cop)}</div>
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "#5B5F5C" }}>
                {s.area_m2 != null && <span>{formatArea(s.area_m2, unit)}</span>}
                {s.habitaciones != null && <span>· {s.habitaciones} hab</span>}
                {s.banos != null && <span>· {s.banos} baños</span>}
              </div>
              {s.barrio_nombre && (
                <div className="flex items-center gap-1 text-[11px]" style={{ color: "#5B5F5C" }}>
                  <MapPin className="h-2.5 w-2.5 shrink-0" />
                  <Name>{s.barrio_nombre}</Name>
                </div>
              )}
              {s.dias_en_mercado != null && <div className="text-[10px]" style={{ color: "#5B5F5C" }}>{diasLabel(s.dias_en_mercado, lang) ?? `${s.dias_en_mercado}d`}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const modalStyle = {
    "--background": "#FFFFFF",
    "--foreground": "#111418",
    "--muted-foreground": "#5B5F5C",
    "--border": "rgb(184 164 138 / 50%)",
  } as React.CSSProperties;

  const loadingSpinner = (
    <div className="flex h-40 items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#0F8A4F] border-t-transparent" />
    </div>
  );

  // ── Mobile: bottom sheet ────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <AnimatePresence>
          {listingId && (
            <>
              <motion.div
                key="drawer-backdrop-mobile"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/50"
                onClick={onClose}
              />
              <motion.div
                key="listing-drawer-mobile"
                data-tour="listing-drawer"
                initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 32, stiffness: 300 }}
                drag="y"
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.4 }}
                onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
                className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-2xl shadow-2xl"
                style={{ height: "90dvh", background: "#FAF8F3", ...modalStyle }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="relative flex shrink-0 items-center justify-center py-3"
                  onPointerDown={(e) => dragControls.start(e)}
                  style={{ touchAction: "none", cursor: "grab" }}
                >
                  <div className="h-1 w-10 rounded-full bg-[#C9C4B8]" />
                  <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Cerrar" className="absolute right-4 grid h-7 w-7 place-items-center rounded-lg text-[#5B5F5C] transition hover:bg-[#F3F0E8]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                  <PhotoGallery fotos={listing?.fotos} titulo={listing?.tipo_inmueble ?? undefined} />
                  <div className="space-y-5 px-5 py-5">
                    {isLoading && loadingSpinner}
                    {listing && (
                      <>
                        {/* Precio + badges */}
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div data-i18n-skip="true">
                              <div className="font-display text-2xl font-bold leading-tight" style={{ fontFamily: "'Fraunces', Georgia, serif", color: "#111418" }}>
                                {formatPrice(listing.precio_cop)}
                              </div>
                              {listing.precio_cop && (
                                <div className="text-xs text-[#5B5F5C]">
                                  {formatSecondary(listing.precio_cop)}
                                </div>
                              )}
                            </div>
                            <div className="flex items-start gap-2">
                              {badgesRow}
                              {favButton}
                            </div>
                          </div>
                          <OriginalListingLink listing={listing} className="w-full" />
                          {(listing.barrio_nombre || listing.municipio) && (
                            <div className="flex items-center gap-1 text-xs text-[#5B5F5C]">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {[
                                listing.barrio_display ?? listing.barrio_nombre,
                                listing.comuna_nombre,
                                listing.municipio_display ?? listing.municipio,
                              ].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        {specsInline}
                        {factsTable}
                        {activityLine}
                        <RealtorColumn
                          listingId={listing.id}
                          agentes={agentes}
                          waUrl={waUrl}
                          onSchedule={() => setShowScheduleModal(true)}
                        />
                        {analysisContent}
                        {similaresSection}
                        {ctaButtons}
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
        {showAlertModal && listing && <AlertModal listing={listing} onClose={() => setShowAlertModal(false)} />}
        {showScheduleModal && <ScheduleVisitModal agente={agenteContacto} listingId={listing?.id ?? null} listingUrl={listing?.url ?? null} onClose={() => setShowScheduleModal(false)} />}
        {showReclamar && listingId && <ReclamarListingModal listingId={listingId} onClose={() => setShowReclamar(false)} />}
      </>
    );
  }

  // ── Desktop: 2-column Zillow-style modal ────────────────────────────────────

  // Columna 2 — SOLO realtores de la zona: comuna (principal) + barrio (secundario).
  const rightColContent = listing ? (
    <div className="px-4 py-5">
      <RealtorColumn
        listingId={listing.id}
        agentes={agentes}
        waUrl={waUrl}
        onSchedule={() => setShowScheduleModal(true)}
      />
    </div>
  ) : null;

  // Left column (galería va full-width arriba, fuera de las columnas)
  const leftColContent = (
    <div>
      {isLoading && loadingSpinner}
      {listing && (
        <div className="space-y-5 px-5 py-5">
          {/* Header: precio (izq) + specs (der) al mismo nivel */}
          <div>
            <div className="flex items-start justify-between gap-3">
              <div data-i18n-skip="true">
                <div className="font-display text-3xl font-bold leading-tight" style={{ fontFamily: "'Fraunces', Georgia, serif", color: "#111418" }}>
                  {formatPrice(listing.precio_cop)}
                </div>
                {listing.precio_cop && (
                  <div className="text-xs text-[#5B5F5C]">
                    {formatSecondary(listing.precio_cop)}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-start gap-3 pt-1.5">
                {specsInline}
                {favButton}
              </div>
            </div>
            <OriginalListingLink listing={listing} className="mt-3 w-full" />
            <div className="mt-2 space-y-2">
              {badgesRow}
              {(listing.barrio_nombre || listing.municipio) && (
                <div className="flex items-center gap-1 text-sm text-[#5B5F5C]">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="font-medium">
                    {[
                      listing.barrio_display ?? listing.barrio_nombre,
                      listing.comuna_nombre,
                      listing.municipio_display ?? listing.municipio,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              )}
            </div>
          </div>
          {factsTable}
          {tourSection}
          {activityLine}
          {analysisContent}
          {similaresSection}
          {ctaButtons}
        </div>
      )}
    </div>
  );

  return (
    <>
      <AnimatePresence>
        {listingId && (
          <>
            <motion.div
              key="drawer-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/50"
              onClick={onClose}
            />
            <motion.div
              key="listing-drawer"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`}
              data-tour="listing-drawer"
              className="fixed z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl"
              style={{
                top: "50%",
                left: "50%",
                width: "min(1400px, 98vw)",
                height: "90dvh",
                background: "#FAF8F3",
                border: "0.5px solid #E5E0D5",
                boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
                ...modalStyle,
              } as React.CSSProperties}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header bar */}
              <div
                className="sticky top-0 z-10 flex shrink-0 items-center justify-between bg-[#FAF8F3] px-5 py-3.5"
                style={{ borderBottom: "0.5px solid #E5E0D5" }}
              >
                <span className="text-[11px] font-medium uppercase tracking-widest text-[#5B5F5C]">
                  Detalle del inmueble
                </span>
                <button
                  onClick={onClose}
                  aria-label="Cerrar"
                  className="grid h-11 w-11 place-items-center rounded-lg text-[#5B5F5C] transition hover:bg-[#F3F0E8] hover:text-[#111418]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body: galería full-width arriba, luego 2 columnas (Zillow) */}
              <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
                <PhotoGallery fotos={listing?.fotos} titulo={listing?.tipo_inmueble ?? undefined} height={420} />
                <div className="flex items-start">
                  {/* Columna 1 — información */}
                  <div className="flex-1" style={{ borderRight: "0.5px solid #E5E0D5" }}>
                    {leftColContent}
                  </div>
                  {/* Columna 2 — contacto realtor + agendar visita (sticky) */}
                  <div className="shrink-0 self-stretch" style={{ width: "37%" }}>
                    <div className="sticky top-0">{rightColContent}</div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {showAlertModal && listing && <AlertModal listing={listing} onClose={() => setShowAlertModal(false)} />}
      {showScheduleModal && <ScheduleVisitModal agente={agenteContacto} listingId={listing?.id ?? null} listingUrl={listing?.url ?? null} onClose={() => setShowScheduleModal(false)} />}
      {showReclamar && listingId && <ReclamarListingModal listingId={listingId} onClose={() => setShowReclamar(false)} />}
    </>
  );
}
