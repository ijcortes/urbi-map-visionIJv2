import { useState, useRef, useEffect, useMemo, useCallback } from "react";

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
import {
  ChevronDown, X, SlidersHorizontal, Search,
  UtensilsCrossed, Wind, WashingMachine, Snowflake,
  ArrowUpDown, Building2, Users, Dumbbell, Waves, Car, DoorClosed,
  Shield, Camera, Trees, Baby, TrainFront, Sofa,
} from "@/lib/icons";
import { useIsPro } from "@/components/LockedField";
import { useLang } from "@/lib/i18n";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import { CurrencyToggle } from "@/components/CurrencyToggle";
import { parsePriceInput } from "@/lib/format";
import { useUnit } from "@/hooks/useUnit";
import type { MapTab } from "./MapNavbar";
import type { BarrioOption } from "@/lib/adapters";

// ─── Shared filter state (lifted to map.tsx, passed down to both FilterBar and MLSPanel) ────
export type SharedFilters = {
  tipoOp: "todos" | "venta" | "arriendo";
  precioMin: number | null;
  precioMax: number | null;
  habitaciones: number | null;
  tipoInmueble: string[] | null;
  areaMin: number | null;
  areaMax: number | null;
  banos: number | null;
  antiguedad: string | null;
  estrato: number[] | null;
  diasMercado: "nuevo" | "reciente" | "demorado" | "mas30" | "mas60" | null;
  amenidades: string[] | null;
  amoblado: boolean | null;
  busqueda: string | null;
  soloPromium: boolean;
  estadoInmueble: "Nuevo" | "Usado" | null;
  pisoMin: number | null;
};

export const EMPTY_SHARED_FILTERS: SharedFilters = {
  tipoOp: "todos",
  precioMin: null,
  precioMax: null,
  habitaciones: null,
  tipoInmueble: null,
  areaMin: null,
  areaMax: null,
  banos: null,
  antiguedad: null,
  estrato: null,
  diasMercado: null,
  amenidades: null,
  amoblado: null,
  busqueda: null,
  soloPromium: false,
  estadoInmueble: null,
  pisoMin: null,
};

export const TAB_TIPO_OP: Record<MapTab, "venta" | "arriendo" | "todos"> = {
  buy:        "venta",
  rent:       "arriendo",
  sell:       "todos",
  agent:      "todos",
  simulator:  "todos",
  comparador: "todos",
};

// ─── Component ───────────────────────────────────────────────────────────────

type MapFilterBarProps = {
  activeTab: MapTab;
  onTabChange?: (tab: MapTab) => void;
  filters: SharedFilters;
  onFiltersChange: (f: Partial<SharedFilters>) => void;
  onResetAll?: () => void;
  allBarrios?: BarrioOption[];
  onBarrioNavigate?: (opt: BarrioOption) => void;
  onBarrioClear?: () => void;
  onSearchAll?: () => void;
  hasActiveScope?: boolean;
  // Cascader Comuna → Barrio (entre buscador y precio)
  activeComunaCd?: number | null;
  activeMunicipio?: string | null;
  onComunaSelect?: (cd: number | null, nombre: string | null, municipio?: string | null) => void;
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (c) => c.toUpperCase());
}

type ComunaGroup = { cd: number | null; nombre: string; municipio?: string; barrios: BarrioOption[] };
function groupComunas(allBarrios?: BarrioOption[]): ComunaGroup[] {
  const m = new Map<number, ComunaGroup>();
  for (const b of allBarrios ?? []) {
    if (b.cd_comuna == null || !b.comuna) continue;
    let g = m.get(b.cd_comuna);
    if (!g) { g = { cd: b.cd_comuna, nombre: b.comuna, barrios: [] }; m.set(b.cd_comuna, g); }
    g.barrios.push(b);
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}
function groupMunicipios(allBarrios?: BarrioOption[]): ComunaGroup[] {
  const m = new Map<string, ComunaGroup>();
  for (const b of allBarrios ?? []) {
    if (b.cd_comuna != null) continue; // Medellín barrios have cd_comuna
    const mun = b.municipio?.toUpperCase();
    if (!mun || mun === "MEDELLÍN" || mun === "MEDELLIN" || mun === "—") continue;
    if (!m.has(mun)) m.set(mun, { cd: null, nombre: mun, municipio: mun, barrios: [] });
    m.get(mun)!.barrios.push(b);
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Dos filtros independientes: [Comunas ▾] [Barrios ▾] */
function ZonaDosFiltros({ allBarrios, activeComunaCd, activeMunicipio, onComunaSelect, onBarrioNavigate }: {
  allBarrios?: BarrioOption[];
  activeComunaCd?: number | null;
  activeMunicipio?: string | null;
  onComunaSelect?: (cd: number | null, nombre: string | null, municipio?: string | null) => void;
  onBarrioNavigate?: (opt: BarrioOption) => void;
}) {
  const comunas       = useMemo(() => groupComunas(allBarrios),    [allBarrios]);
  const municipioGrps = useMemo(() => groupMunicipios(allBarrios), [allBarrios]);

  const activeGroup: ComunaGroup | null =
    activeComunaCd != null ? (comunas.find((c) => c.cd === activeComunaCd) ?? null) :
    activeMunicipio ? (municipioGrps.find((m) => m.municipio === activeMunicipio) ?? null) :
    null;

  const comunaValue =
    activeComunaCd != null ? String(activeComunaCd) :
    activeMunicipio ? `mun:${activeMunicipio}` : "";

  const selectStyle = (active: boolean): React.CSSProperties => ({
    height: 32, padding: "0 24px 0 10px", appearance: "none" as const,
    border: `1px solid ${active ? C.teal : C.border}`, borderRadius: 8,
    background: C.white,
    color: active ? C.tealDeep : C.ink,
    fontSize: 12, fontWeight: active ? 600 : 500,
    cursor: "pointer", outline: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B5B45' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 7px center",
    minWidth: 0, maxWidth: 160,
  });

  const handleComuna = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (!v) { onComunaSelect?.(null, null); return; }
    if (v.startsWith("mun:")) {
      const mun = v.slice(4);
      const g = municipioGrps.find((m) => m.municipio === mun);
      onComunaSelect?.(null, g?.nombre ?? mun, mun);
    } else {
      const cd = Number(v);
      const g = comunas.find((c) => c.cd === cd);
      onComunaSelect?.(cd, g?.nombre ?? null);
    }
  };

  const barriosDeZona = activeGroup
    ? activeGroup.barrios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
    : [];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {/* Comunas */}
      <div style={{ position: "relative" }}>
        <select value={comunaValue} onChange={handleComuna} style={selectStyle(!!comunaValue)}>
          <option value="">Toda la ciudad</option>
          <optgroup label="Comunas Medellín">
            {comunas.map((c) => (
              <option key={c.cd} value={String(c.cd)}>{titleCase(c.nombre)}</option>
            ))}
          </optgroup>
          {municipioGrps.length > 0 && (
            <optgroup label="Otros municipios">
              {municipioGrps.map((g) => (
                <option key={g.municipio} value={`mun:${g.municipio}`}>{titleCase(g.nombre)}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Barrios — solo aparece cuando hay una zona activa */}
      {activeGroup && barriosDeZona.length > 0 && (
        <div style={{ position: "relative" }}>
          <select
            defaultValue=""
            onChange={(e) => {
              const b = barriosDeZona.find((x) => String(x.id) === e.target.value);
              if (b) onBarrioNavigate?.(b);
              e.target.value = "";
            }}
            style={selectStyle(false)}
          >
            <option value="">Todo {titleCase(activeGroup.nombre)}</option>
            {barriosDeZona.map((b) => (
              <option key={b.id} value={String(b.id)}>{titleCase(b.nombre)}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

const C = {
  white:    "#FFFFFF",
  teal:     "#0F8A4F",
  tealDeep: "#0A5C36",
  muted:    "#5B5F5C",
  border:   "#E5E0D5",
  ink:      "#111418",
  coral:    "#CE1126",
  surface:  "#F3F0E8",
};

const TIPO_OPTIONS = [
  { value: "apartamento",   label: "Apartamento" },
  { value: "casa",          label: "Casa" },
  { value: "apartaestudio", label: "Apartaestudio" },
  { value: "lote",          label: "Lote" },
  { value: "local",         label: "Local" },
  { value: "oficina",       label: "Oficina" },
  { value: "bodega",        label: "Bodega" },
];

type DropdownId = "precio" | "habBanos" | "tipo" | "filtros" | "amenidades";

function countActive(f: SharedFilters): number {
  let n = 0;
  if (f.precioMax !== null || f.precioMin !== null) n++;
  if (f.habitaciones !== null) n++;
  if (f.banos !== null) n++;
  if (f.tipoInmueble !== null && f.tipoInmueble.length > 0) n++;
  if (f.areaMin !== null || f.areaMax !== null) n++;
  if (f.antiguedad !== null) n++;
  if (f.estrato !== null && f.estrato.length > 0) n++;
  if (f.diasMercado !== null) n++;
  if (f.amoblado !== null) n++;
  if (f.busqueda !== null) n++;
  if (f.estadoInmueble !== null) n++;
  if (f.pisoMin !== null) n++;
  return n;
}

// ─── FilterPill ───────────────────────────────────────────────────────────────

function FilterPill({
  label, active, onClear, onClick, isOpen, computedLabel,
}: {
  label: string;
  active: boolean;
  onClear?: () => void;
  onClick: (anchor: DOMRect) => void;
  isOpen: boolean;
  computedLabel?: boolean; // true if label text is lang-computed (e.g. COP/USD) rather than dict-translated
}) {
  return (
    <button
      onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
      className="map-filter-pill"
      {...(active ? { "data-active": "1" } : {})}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        background: active ? C.teal : C.white,
        color: active ? "#fff" : C.ink,
        border: `1px solid ${active ? C.teal : C.border}`,
        borderRadius: 8, padding: "0 10px",
        height: 32, fontSize: 12, fontWeight: 600,
        cursor: "pointer", whiteSpace: "nowrap",
        outline: isOpen && !active ? `2px solid ${C.teal}` : "none",
        outlineOffset: 1,
        transition: "all 0.12s",
        flexShrink: 0,
      }}
    >
      <span {...(computedLabel ? { "data-i18n-skip": "true" } : {})}>{label}</span>
      {active && onClear ? (
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          style={{ marginLeft: 2, display: "flex", alignItems: "center", opacity: 0.85 }}
        >
          <X size={11} />
        </span>
      ) : (
        <ChevronDown
          size={11}
          style={{
            opacity: 0.55, marginLeft: 2,
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      )}
    </button>
  );
}

// ─── Label helpers ────────────────────────────────────────────────────────────

// Etiquetas compactas (solo chips de slider): formatCompact de lib/format vía usePriceFormat.
type PriceFmt = (cop: number) => string;

function precioLabel(f: SharedFilters, isRent: boolean, lang: string, fmtPrice: PriceFmt): string {
  // Este label vive en un span data-i18n-skip (gotcha #1 cache-poisoning), así que
  // el diccionario DOM no lo toca — hay que devolver EN aquí mismo.
  const en = lang === "en";
  if (f.precioMin !== null && f.precioMax !== null)
    return `${fmtPrice(f.precioMin)} – ${fmtPrice(f.precioMax)}`;
  if (f.precioMax !== null) return `${en ? "Up to" : "Hasta"} ${fmtPrice(f.precioMax)}`;
  if (f.precioMin !== null) return `${en ? "From" : "Desde"} ${fmtPrice(f.precioMin)}`;
  return en ? (isRent ? "Price/mo" : "Price") : (isRent ? "Precio/mes" : "Precio");
}

function habLabel(f: SharedFilters): string {
  if (f.habitaciones === null) return "Habitaciones";
  if (f.habitaciones === 4) return "4+ hab.";
  return `${f.habitaciones} hab.`;
}

function tipoLabel(f: SharedFilters): string {
  const sel = f.tipoInmueble ?? [];
  if (sel.length === 0) return "Tipo";
  if (sel.length === 1) return TIPO_OPTIONS.find((o) => o.value === sel[0])?.label ?? "Tipo";
  return `Tipo (${sel.length})`;
}

// areaMin/areaMax en SharedFilters siempre están en m² (canónico para la API);
// estas funciones solo convierten para mostrar/capturar en ft² cuando el toggle está en sqft.
const M2_PER_FT2 = 10.7639;
function m2ToDisplay(m2: number | null, unit: "m2" | "sqft"): number | null {
  if (m2 === null) return null;
  return unit === "sqft" ? Math.round(m2 * M2_PER_FT2) : m2;
}
function displayToM2(v: number | null, unit: "m2" | "sqft"): number | null {
  if (v === null) return null;
  return unit === "sqft" ? Math.round(v / M2_PER_FT2) : v;
}

// Sin esto, cada keystroke re-deriva el texto desde el m² canónico ya redondeado
// (1000 ft² → 93 m² → 1001 ft²) y el número visible se corre bajo el dedo del usuario.
// El texto tecleado manda hasta que cambia la unidad o el valor se resetea desde afuera.
function useAreaFieldText(
  m2Value: number | null,
  unit: "m2" | "sqft",
  onCommit: (m2: number | null) => void,
) {
  const lastM2 = useRef(m2Value);
  const [text, setText] = useState<string>(() => m2ToDisplay(m2Value, unit)?.toString() ?? "");

  useEffect(() => {
    if (m2Value !== lastM2.current) {
      lastM2.current = m2Value;
      setText(m2ToDisplay(m2Value, unit)?.toString() ?? "");
    }
  }, [m2Value]);

  useEffect(() => {
    lastM2.current = m2Value;
    setText(m2ToDisplay(m2Value, unit)?.toString() ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  const handleChange = (raw: string) => {
    setText(raw);
    const m2 = raw ? displayToM2(Number(raw), unit) : null;
    lastM2.current = m2;
    onCommit(m2);
  };

  return { text, handleChange };
}

// precioMin/precioMax en SharedFilters siempre están en COP (canónico para la
// API). El usuario teclea en su moneda de visualización (COP|USD, independiente
// del idioma) → se convierte a COP con la TRM única (usePriceFormat.toCop).
// Texto libre ("2,500" / "2.500" / "2500"), commit con debounce y recalculo
// cuando cambia la moneda/TRM (p.ej. al cargar la TRM).
const PRICE_DEBOUNCE_MS = 350;
function usePriceFieldText(
  copValue: number | null,
  pf: { currency: string; toCop: (v: number) => number; toDisplay: (cop: number) => number },
  onCommit: (cop: number | null) => void,
) {
  const show = (cop: number | null) => (cop === null ? "" : String(Math.round(pf.toDisplay(cop))));
  const lastCop = useRef(copValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ pf, onCommit });
  latest.current = { pf, onCommit };
  const [text, setText] = useState<string>(() => show(copValue));

  // valor externo (reset, slider) o cambio de moneda/TRM → recalcular el texto
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    lastCop.current = copValue;
    setText(show(copValue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copValue, pf.currency, pf.toCop]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleChange = (raw: string) => {
    setText(raw);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const n = parsePriceInput(raw);
      const cop = n === null ? null : latest.current.pf.toCop(n);
      lastCop.current = cop;
      latest.current.onCommit(cop);
    }, PRICE_DEBOUNCE_MS);
  };

  return { text, handleChange };
}

function banosLabel(f: SharedFilters): string {
  if (f.banos === null) return "Baños";
  if (f.banos === 4) return "4+ baños";
  return `${f.banos} baños`;
}

function habBanosLabel(f: SharedFilters): string {
  const parts: string[] = [];
  if (f.habitaciones !== null) parts.push(f.habitaciones === 4 ? "4+ hab." : `${f.habitaciones} hab.`);
  if (f.banos !== null) parts.push(f.banos === 4 ? "4+ baños" : `${f.banos} baños`);
  return parts.length > 0 ? parts.join(", ") : "Hab. y Baños";
}

// ─── Dropdown panels ──────────────────────────────────────────────────────────

const panelBase: React.CSSProperties = {
  background: "#fff", borderRadius: 12,
  border: `1px solid ${C.border}`,
  boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
  padding: 16, minWidth: 240,
};

const labelSm: React.CSSProperties = {
  fontSize: 10, color: C.muted, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.6px",
  marginBottom: 8, display: "block",
};

function BtnGroup({
  options, current, onChange,
}: {
  options: { value: number | null; label: string }[];
  current: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          style={{
            padding: "5px 12px", borderRadius: 8, fontSize: 12,
            border: `1px solid ${current === o.value ? C.teal : C.border}`,
            background: current === o.value ? C.teal : C.white,
            color: current === o.value ? "#fff" : C.ink,
            cursor: "pointer", fontWeight: current === o.value ? 600 : 400,
            transition: "all 0.1s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumInput({
  placeholder, value, onChange,
}: {
  placeholder: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      style={{
        width: "100%", border: `1px solid ${C.border}`, borderRadius: 8,
        padding: "7px 10px", fontSize: 12, outline: "none", background: C.white,
        color: C.ink,
      }}
    />
  );
}

function PrecioPanel({
  filters, isRent, onChange, onClose, lang, fmtPrice,
}: {
  filters: SharedFilters;
  isRent: boolean;
  onChange: (f: Partial<SharedFilters>) => void;
  onClose: () => void;
  lang: string;
  fmtPrice: PriceFmt;
}) {
  const TOTAL_MIN = 0;
  // Ranges scaled to where listings actually live, not the p99 outlier tail:
  // a ~280px track spread over the full p99 (venta ~9B) gave the whole typical
  // band (200M–1B) under a fifth of the track, so a 1px drag = tens of millions
  // — the reported "big jumps". Capping venta at 2B (open "Máx" bucket above
  // that, same as before) gives every pixel a far smaller, controllable delta.
  const TOTAL_MAX = isRent ? 50_000_000 : 2_000_000_000;
  const STEP      = isRent ? 100_000    : 1_000_000;
  // Non-linear scale: most listings sit in the low/mid band, so a straight
  // linear map gives that band a sliver of the track. Power curve gives it
  // most of the drag distance instead, tail compressed into the rest.
  const CURVE     = isRent ? 2.2 : 2.0;

  const trackRef = useRef<HTMLDivElement>(null);

  // Local drag state: the thumb follows the pointer every frame, but the
  // committed filter (→ onChange → map refetch) only updates on release.
  // Firing onChange per pointermove was pushing a full viewport refetch on
  // every pixel of drag, which is what made the slider itself feel laggy.
  const [localMin, setLocalMin] = useState(filters.precioMin ?? TOTAL_MIN);
  const [localMax, setLocalMax] = useState(filters.precioMax ?? TOTAL_MAX);

  useEffect(() => {
    setLocalMin(filters.precioMin ?? TOTAL_MIN);
    setLocalMax(filters.precioMax ?? TOTAL_MAX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.precioMin, filters.precioMax, isRent]);

  const curMin = localMin;
  const curMax = localMax;

  const snap  = (v: number) => Math.round(v / STEP) * STEP;
  const toR   = (v: number) => Math.pow(Math.max(0, v - TOTAL_MIN) / (TOTAL_MAX - TOTAL_MIN), 1 / CURVE);
  const fromR = (r: number) => snap(TOTAL_MIN + Math.pow(r, CURVE) * (TOTAL_MAX - TOTAL_MIN));

  const minR = toR(curMin);
  const maxR = toR(curMax);

  const getRatio = (e: React.PointerEvent) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const BARS = 30;
  const hist = useMemo(() => {
    // Peak set in money terms (typical Medellín listing) then mapped through the
    // same curved toR() the thumbs use, so the decorative shape still lines up.
    const peak  = toR(isRent ? 2_000_000 : 350_000_000);
    const sigma = isRent ? 0.20 : 0.16;
    const raw   = Array.from({ length: BARS }, (_, i) => {
      const x = (i + 0.5) / BARS;
      return Math.exp(-0.5 * ((x - peak) / sigma) ** 2);
    });
    const maxH = Math.max(...raw);
    return raw.map(h => h / maxH);
  }, [isRent]);

  const fmt  = (v: number) => {
    // Range labels van en spans data-i18n-skip → traducir aquí.
    if (v <= TOTAL_MIN) return lang === "en" ? "Min" : "Mín";
    if (v >= TOTAL_MAX) return lang === "en" ? "Max" : "Máx";
    return fmtPrice(v);
  };

  const thumbStyle: React.CSSProperties = {
    position: "absolute", bottom: 2,
    width: 20, height: 20,
    background: "#fff", borderRadius: "50%",
    border: `2.5px solid ${C.teal}`,
    boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
    cursor: "ew-resize", touchAction: "none", zIndex: 2,
    transform: "translateX(-50%)",
  };

  return (
    <div style={{ ...panelBase, minWidth: 300, userSelect: "none" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}><CurrencyToggle compact /></div>
      {/* Range labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span data-i18n-skip="true" style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>{fmt(curMin)}</span>
        <span data-i18n-skip="true" style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>{fmt(curMax)}</span>
      </div>

      {/* Histogram + dual slider */}
      <div ref={trackRef} style={{ position: "relative", height: 76, marginBottom: 4 }}>

        {/* Histogram bars */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 24,
          display: "flex", alignItems: "flex-end", gap: 2,
        }}>
          {hist.map((h, i) => {
            const barR = (i + 0.5) / BARS;
            const inRange = barR >= minR && barR <= maxR;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.max(h * 100, 4)}%`,
                  background: inRange ? C.teal : "#D4CEC5",
                  borderRadius: "2px 2px 0 0",
                  opacity: inRange ? 0.8 : 0.3,
                  transition: "background 0.07s, opacity 0.07s",
                }}
              />
            );
          })}
        </div>

        {/* Track */}
        <div style={{
          position: "absolute", bottom: 8, left: 0, right: 0,
          height: 4, background: "#E5E0D5", borderRadius: 2,
        }}>
          <div style={{
            position: "absolute",
            left: `${minR * 100}%`,
            width: `${(maxR - minR) * 100}%`,
            height: "100%", background: C.teal, borderRadius: 2,
          }} />
        </div>

        {/* Min thumb */}
        <div
          style={{ ...thumbStyle, left: `${minR * 100}%` }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const v = fromR(getRatio(e));
            setLocalMin(Math.min(v, curMax - STEP));
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onChange({ precioMin: localMin <= TOTAL_MIN ? null : localMin });
          }}
        />

        {/* Max thumb */}
        <div
          style={{ ...thumbStyle, left: `${maxR * 100}%` }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const v = fromR(getRatio(e));
            setLocalMax(Math.max(v, curMin + STEP));
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onChange({ precioMax: localMax >= TOTAL_MAX ? null : localMax });
          }}
        />
      </div>

      <button
        onClick={onClose}
        style={{
          width: "100%", padding: "8px", borderRadius: 8,
          background: C.teal, color: "#fff", border: "none",
          fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}
      >
        Aplicar
      </button>
    </div>
  );
}

// ─── AreaPanel ────────────────────────────────────────────────────────────────

function AreaPanel({
  filters, onChange, onClose, unit,
}: {
  unit: "m2" | "sqft";
  filters: SharedFilters;
  onChange: (f: Partial<SharedFilters>) => void;
  onClose: () => void;
}) {
  const TOTAL_MIN = 0;
  const TOTAL_MAX = 600;
  const STEP      = 5;

  const curMin = filters.areaMin ?? TOTAL_MIN;
  const curMax = filters.areaMax ?? TOTAL_MAX;

  const trackRef = useRef<HTMLDivElement>(null);

  const snap  = (v: number) => Math.round(v / STEP) * STEP;
  const toR   = (v: number) => (v - TOTAL_MIN) / (TOTAL_MAX - TOTAL_MIN);
  const fromR = (r: number) => snap(TOTAL_MIN + r * (TOTAL_MAX - TOTAL_MIN));

  const minR = toR(curMin);
  const maxR = toR(curMax);

  const getRatio = (e: React.PointerEvent) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const BARS = 30;
  const hist = useMemo(() => {
    // Medellín market: peak ~65–80 m² (apartments)
    const peak  = 0.13;
    const sigma = 0.13;
    const raw   = Array.from({ length: BARS }, (_, i) => {
      const x = (i + 0.5) / BARS;
      return Math.exp(-0.5 * ((x - peak) / sigma) ** 2);
    });
    const maxH = Math.max(...raw);
    return raw.map(h => h / maxH);
  }, []);

  const fmt = (v: number) => {
    if (v <= TOTAL_MIN) return "0";
    if (v >= TOTAL_MAX) return "Sin límite";
    return `${Math.round((unit === "sqft" ? v * M2_PER_FT2 : v)).toLocaleString(unit === "sqft" ? "en-US" : "es-CO")} ${unit === "sqft" ? "ft²" : "m²"}`;
  };

  const thumbStyle: React.CSSProperties = {
    position: "absolute", bottom: 2,
    width: 20, height: 20,
    background: "#fff", borderRadius: "50%",
    border: `2.5px solid ${C.teal}`,
    boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
    cursor: "ew-resize", touchAction: "none", zIndex: 2,
    transform: "translateX(-50%)",
  };

  return (
    <div style={{ ...panelBase, minWidth: 300, userSelect: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>{fmt(curMin)}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>{fmt(curMax)}</span>
      </div>

      <div ref={trackRef} style={{ position: "relative", height: 76, marginBottom: 4 }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 24, display: "flex", alignItems: "flex-end", gap: 2 }}>
          {hist.map((h, i) => {
            const barR   = (i + 0.5) / BARS;
            const inRange = barR >= minR && barR <= maxR;
            return (
              <div key={i} style={{
                flex: 1,
                height: `${Math.max(h * 100, 4)}%`,
                background: inRange ? C.teal : "#D4CEC5",
                borderRadius: "2px 2px 0 0",
                opacity: inRange ? 0.8 : 0.3,
                transition: "background 0.07s, opacity 0.07s",
              }} />
            );
          })}
        </div>

        <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, height: 4, background: "#E5E0D5", borderRadius: 2 }}>
          <div style={{ position: "absolute", left: `${minR * 100}%`, width: `${(maxR - minR) * 100}%`, height: "100%", background: C.teal, borderRadius: 2 }} />
        </div>

        <div
          style={{ ...thumbStyle, left: `${minR * 100}%` }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const v = fromR(getRatio(e));
            onChange({ areaMin: v <= TOTAL_MIN ? null : Math.min(v, curMax - STEP) });
          }}
          onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        />

        <div
          style={{ ...thumbStyle, left: `${maxR * 100}%` }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const v = fromR(getRatio(e));
            onChange({ areaMax: v >= TOTAL_MAX ? null : Math.max(v, curMin + STEP) });
          }}
          onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        />
      </div>

      <button
        onClick={onClose}
        style={{ width: "100%", padding: "8px", borderRadius: 8, background: C.teal, color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
      >
        Aplicar
      </button>
    </div>
  );
}

// ─── HabBanosPanel ───────────────────────────────────────────────────────────

function HabBanosPanel({
  filters, onChange,
}: {
  filters: SharedFilters;
  onChange: (f: Partial<SharedFilters>) => void;
}) {
  const OPTS = [
    { value: null as number | null, label: "Cualquiera" },
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4+" },
  ];
  return (
    <div style={{ ...panelBase, minWidth: 240 }}>
      <span style={labelSm}>Habitaciones</span>
      <BtnGroup options={OPTS} current={filters.habitaciones} onChange={(v) => onChange({ habitaciones: v })} />
      <div style={{ marginTop: 14 }}>
        <span style={labelSm}>Baños</span>
        <BtnGroup options={OPTS} current={filters.banos} onChange={(v) => onChange({ banos: v })} />
      </div>
      {(filters.habitaciones !== null || filters.banos !== null) && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => onChange({ habitaciones: null, banos: null })}
            style={{ fontSize: 12, color: C.muted, background: "none", border: "none", cursor: "pointer" }}
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tipo de inmueble ───────────────────────────────────────────────────────────

function TipoPanel({
  filters, onChange,
}: {
  filters: SharedFilters;
  onChange: (f: Partial<SharedFilters>) => void;
}) {
  const sel = filters.tipoInmueble ?? [];
  const toggle = (value: string) => {
    const next = sel.includes(value) ? sel.filter((v) => v !== value) : [...sel, value];
    onChange({ tipoInmueble: next.length === 0 ? null : next });
  };
  return (
    <div style={{ ...panelBase, minWidth: 200, padding: "12px 8px" }}>
      <span style={{ ...labelSm, padding: "0 8px" }}>Tipo de inmueble</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
        {TIPO_OPTIONS.map((opt) => {
          const active = sel.includes(opt.value);
          return (
            <div
              key={opt.value}
              role="checkbox"
              aria-checked={active}
              onClick={() => toggle(opt.value)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 10px", borderRadius: 7,
                cursor: "pointer", fontSize: 13, userSelect: "none",
                background: active ? C.teal : "transparent",
                color: active ? "#fff" : C.ink,
                fontWeight: active ? 600 : 400,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.surface; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                border: `2px solid ${active ? "#fff" : C.border}`,
                background: active ? "rgba(255,255,255,0.2)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {active && (
                  <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              {opt.label}
            </div>
          );
        })}
      </div>
      {sel.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => onChange({ tipoInmueble: null })}
            style={{ fontSize: 12, color: C.muted, background: "none", border: "none", cursor: "pointer", padding: "0 8px" }}
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Amenidades ───────────────────────────────────────────────────────────────

type AmenItem = { key: string; label: string; Icon: React.ElementType };

const AMENIDADES_GROUPS: { id: string; label: string; items: AmenItem[] }[] = [
  {
    id: "interior",
    label: "INTERIOR",
    items: [
      { key: "amoblado",         label: "Amoblado",          Icon: Sofa },
      { key: "cocina_integral",  label: "Cocina integral",   Icon: UtensilsCrossed },
      { key: "aire_acondicionado", label: "Aire acondicionado", Icon: Snowflake },
      { key: "balcon",           label: "Balcón / Terraza",  Icon: Wind },
      { key: "lavanderia",       label: "Lavandería",        Icon: WashingMachine },
    ],
  },
  {
    id: "edificio",
    label: "EDIFICIO Y CONJUNTO",
    items: [
      { key: "ascensor",               label: "Ascensor",              Icon: ArrowUpDown },
      { key: "conjunto_cerrado",       label: "Conjunto cerrado",      Icon: Building2 },
      { key: "salon_comunal",          label: "Salón comunal",         Icon: Users },
      { key: "gimnasio",               label: "Gimnasio",              Icon: Dumbbell },
      { key: "piscina",                label: "Piscina",               Icon: Waves },
      { key: "parqueadero_visitantes", label: "Parqueadero visitantes",Icon: Car },
      { key: "porteria",               label: "Portería",              Icon: DoorClosed },
    ],
  },
  {
    id: "seguridad",
    label: "SEGURIDAD Y ENTORNO",
    items: [
      { key: "vigilancia",  label: "Vigilancia 24h",        Icon: Shield },
      { key: "camaras",     label: "Cámaras de seguridad",  Icon: Camera },
      { key: "zonas_verdes",label: "Zonas verdes",          Icon: Trees },
      { key: "zona_ninos",  label: "Zona de niños",         Icon: Baby },
      { key: "transporte",  label: "Cerca al transporte",   Icon: TrainFront },
    ],
  },
];

function AmenidadesPanel({
  current,
  onChange,
  onClose,
}: {
  current: string[];
  onChange: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<string[]>(current);

  const toggleKey = (key: string) =>
    setPending((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  const clearAll = () => setPending([]);

  const apply = () => { onChange(pending); onClose(); };

  const ICON_COLOR = "#6E726E";

  return (
    <div style={{ ...panelBase, width: 320, padding: 0, display: "flex", flexDirection: "column" }}>
      {/* Scrollable body */}
      <div style={{ overflowY: "auto", maxHeight: "min(460px, 70vh)", padding: "12px 16px 4px" }}>
        {AMENIDADES_GROUPS.map((group, gi) => (
          <div key={group.id}>
            <span style={{
              display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px",
              textTransform: "uppercase", color: C.muted,
              padding: gi === 0 ? "4px 0 6px" : "10px 0 6px",
              borderTop: gi > 0 ? `1px solid ${C.border}` : "none",
            }}>
              {group.label}
            </span>
            {group.items.map(({ key, label, Icon }) => {
              const checked = pending.includes(key);
              return (
                <div
                  key={key}
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleKey(key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 6px", borderRadius: 7, cursor: "pointer",
                    userSelect: "none",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.surface; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon size={16} color={checked ? C.teal : ICON_COLOR} strokeWidth={1.8} />
                  <span style={{ flex: 1, fontSize: 13, color: C.ink }}>{label}</span>
                  <span style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    border: `2px solid ${checked ? C.teal : C.border}`,
                    background: checked ? C.teal : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.12s",
                  }}>
                    {checked && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", gap: 8, padding: "12px 16px",
        borderTop: `1px solid ${C.border}`,
        background: "#fff",
      }}>
        <button
          onClick={clearAll}
          style={{
            flex: 1, padding: "8px", borderRadius: 8,
            border: `1px solid ${C.border}`, background: "transparent",
            color: C.muted, fontSize: 12, cursor: "pointer",
          }}
        >
          Limpiar
        </button>
        <button
          onClick={apply}
          disabled={pending.length === 0 && current.length === 0}
          style={{
            flex: 1, padding: "8px", borderRadius: 8, border: "none",
            background: (pending.length > 0 || current.length > 0) ? C.teal : C.border,
            color: (pending.length > 0 || current.length > 0) ? "#fff" : C.muted,
            fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          {pending.length > 0 ? `Aplicar (${pending.length})` : "Aplicar"}
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MapFilterBar({
  activeTab, onTabChange, filters, onFiltersChange, onResetAll, allBarrios, onBarrioNavigate, onBarrioClear,
  activeComunaCd, activeMunicipio, onComunaSelect,
}: MapFilterBarProps) {
  const isPro = useIsPro();
  const { lang } = useLang();
  const pf = usePriceFormat();
  const { unit } = useUnit();
  const areaUnitLabel = unit === "sqft" ? "ft²" : "m²";
  const areaMinField = useAreaFieldText(filters.areaMin, unit, (m2) => onFiltersChange({ areaMin: m2 }));
  const areaMaxField = useAreaFieldText(filters.areaMax, unit, (m2) => onFiltersChange({ areaMax: m2 }));
  const precioMinField = usePriceFieldText(filters.precioMin, pf, (cop) => {
    if (cop !== null && filters.precioMax !== null && cop > filters.precioMax) return;
    onFiltersChange({ precioMin: cop });
  });
  const precioMaxField = usePriceFieldText(filters.precioMax, pf, (cop) => {
    if (cop !== null && filters.precioMin !== null && cop < filters.precioMin) return;
    onFiltersChange({ precioMax: cop });
  });
  const [open, setOpen] = useState<DropdownId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileMore, setMobileMore] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Search autocomplete state ──────────────────────────────────────────────
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSelected, setSearchSelected] = useState<BarrioOption | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchRect, setSearchRect] = useState<DOMRect | null>(null);

  // Sync when busqueda cleared externally (Reset All)
  useEffect(() => {
    if (!filters.busqueda) { setSearchQ(""); setSearchSelected(null); }
  }, [filters.busqueda]);

  const suggestions = useMemo<BarrioOption[]>(() => {
    if (!searchQ.trim() || !allBarrios) return [];
    const q = norm(searchQ);
    return allBarrios
      .filter(b =>
        norm(b.nombre).includes(q) ||
        norm(b.municipio).includes(q) ||
        (b.comuna && norm(b.comuna).includes(q))
      )
      .slice(0, 8);
  }, [searchQ, allBarrios]);

  const handleSearchSelect = useCallback((opt: BarrioOption) => {
    setSearchSelected(opt);
    setSearchQ(opt.nombre);
    setSearchOpen(false);
    onFiltersChange({ busqueda: null });
    onBarrioNavigate?.(opt);
  }, [onBarrioNavigate, onFiltersChange]);

  const handleSearchClear = useCallback(() => {
    setSearchQ("");
    setSearchSelected(null);
    setSearchOpen(false);
    onFiltersChange({ busqueda: null });
    onBarrioClear?.();
  }, [onBarrioClear, onFiltersChange]);

  const toggle = (id: DropdownId, a: DOMRect) => {
    setAnchor(a);
    setOpen((p) => (p === id ? null : id));
  };
  const close  = () => setOpen(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!barRef.current?.contains(t) && !dropdownRef.current?.contains(t)) close();
      if (!searchRef.current?.contains(t)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (activeTab === "agent" || activeTab === "simulator" || activeTab === "comparador") return null;

  const isRent     = activeTab === "rent";
  const activeCount = countActive(filters);
  const precioActive     = filters.precioMax !== null || filters.precioMin !== null;
  const habActive        = filters.habitaciones !== null;
  const tipoActive       = (filters.tipoInmueble?.length ?? 0) > 0;
  const banosActive      = filters.banos !== null;

  // ── Sell tab: barrio selector ──────────────────────────────────────────────
  const sellContent = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Analiza tu barrio:</span>
      <select
        defaultValue=""
        onChange={(e) => {
          const opt = allBarrios?.find((b) => String(b.id) === e.target.value);
          if (opt) onBarrioNavigate?.(opt);
        }}
        style={{
          border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "5px 12px", fontSize: 12, background: C.white,
          color: C.ink, outline: "none", cursor: "pointer", minWidth: 220,
        }}
      >
        <option value="">Selecciona un barrio...</option>
        {allBarrios?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.nombre} – {b.municipio}
          </option>
        ))}
      </select>
    </div>
  );

  // ── Desktop pill row ───────────────────────────────────────────────────────
  const habBanosActive = filters.habitaciones !== null || filters.banos !== null;
  const filtrosCount = [
    (filters.estrato?.length ?? 0) > 0,
    filters.diasMercado !== null,
    filters.areaMin !== null || filters.areaMax !== null,
    filters.estadoInmueble !== null,
    filters.pisoMin !== null,
  ].filter(Boolean).length;
  const amenCount = filters.amenidades?.length ?? 0;

  const desktopContent = (
    <div style={{ display: "flex", alignItems: "center", gap: 7, overflowX: "auto", paddingBottom: 2 }}>

      {/* Search autocomplete */}
      <div ref={searchRef} style={{ position: "relative", flexShrink: 0 }}>
        <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted, pointerEvents: "none", zIndex: 1 }} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Buscar barrio o municipio..."
          value={searchQ}
          onChange={(e) => {
            const v = e.target.value;
            setSearchQ(v);
            setSearchSelected(null);
            setSearchRect(searchInputRef.current?.getBoundingClientRect() ?? null);
            setSearchOpen(!!v.trim());
            onFiltersChange({ busqueda: v || null });
          }}
          onFocus={() => {
            if (searchQ.trim()) {
              setSearchRect(searchInputRef.current?.getBoundingClientRect() ?? null);
              setSearchOpen(true);
            }
          }}
          style={{
            height: 32, paddingLeft: 28, paddingRight: (searchQ || searchSelected) ? 26 : 10,
            border: `1px solid ${searchSelected ? C.teal : searchQ ? C.teal : C.border}`,
            borderRadius: 8, fontSize: 12, color: C.ink, background: C.white,
            outline: "none", width: 210, flexShrink: 0,
          }}
        />
        {(searchQ || searchSelected) && (
          <button
            onClick={handleSearchClear}
            style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted, display: "flex", padding: 0, zIndex: 1 }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Zona: 2 filtros separados — Comunas | Barrios */}
      <ZonaDosFiltros
        allBarrios={allBarrios}
        activeComunaCd={activeComunaCd}
        activeMunicipio={activeMunicipio}
        onComunaSelect={onComunaSelect}
        onBarrioNavigate={onBarrioNavigate}
      />

      {/* Separador visual */}
      <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0, margin: "0 2px" }} />

      {/* Precio */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <FilterPill
          label={precioLabel(filters, isRent, lang, pf.formatPriceCompact)}
          active={precioActive}
          onClear={() => onFiltersChange({ precioMin: null, precioMax: null })}
          onClick={(a) => toggle("precio", a)}
          isOpen={open === "precio"}
          computedLabel
        />
      </div>

      {/* Habitaciones y Baños */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <FilterPill
          label={habBanosLabel(filters)}
          active={habBanosActive}
          onClear={habBanosActive ? () => onFiltersChange({ habitaciones: null, banos: null }) : undefined}
          onClick={(a) => toggle("habBanos", a)}
          isOpen={open === "habBanos"}
        />
      </div>

      {/* Tipo de inmueble */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <FilterPill
          label={tipoLabel(filters)}
          active={tipoActive}
          onClear={tipoActive ? () => onFiltersChange({ tipoInmueble: null }) : undefined}
          onClick={(a) => toggle("tipo", a)}
          isOpen={open === "tipo"}
        />
      </div>

      {/* Filtros */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <FilterPill
          label={filtrosCount > 0 ? `Filtros (${filtrosCount})` : "Filtros"}
          active={filtrosCount > 0}
          onClear={filtrosCount > 0 ? () => onFiltersChange({ antiguedad: null, estrato: null, diasMercado: null, soloPromium: false, areaMin: null, areaMax: null, estadoInmueble: null, pisoMin: null }) : undefined}
          onClick={(a) => toggle("filtros", a)}
          isOpen={open === "filtros"}
        />
      </div>

      {/* Amenidades */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <FilterPill
          label={amenCount > 0 ? `Amenidades (${amenCount})` : "Amenidades"}
          active={amenCount > 0}
          onClear={amenCount > 0 ? () => onFiltersChange({ amenidades: null }) : undefined}
          onClick={(a) => toggle("amenidades", a)}
          isOpen={open === "amenidades"}
        />
      </div>

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          onClick={onResetAll}
          style={{
            background: "none", border: "none", color: C.teal,
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            padding: "0 4px", flexShrink: 0,
          }}
        >
          Limpiar
        </button>
      )}
    </div>
  );

  // ── Mobile bottom sheet ────────────────────────────────────────────────────
  const mobileSheet = mobileOpen && (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.45)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}
      onClick={() => setMobileOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "16px 16px 0 0",
          padding: "20px 20px 32px", maxHeight: "80vh", overflowY: "auto",
          width: "100%", maxWidth: "100%", boxSizing: "border-box", overflowX: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Filtros</span>
          <button onClick={() => setMobileOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}>
            <X size={20} />
          </button>
        </div>

        {/* Zona: Toda la ciudad → comuna → barrio (selects nativos) */}
        <div style={{ marginBottom: 20 }}>
          <span style={labelSm}>Zona</span>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={activeComunaCd != null ? String(activeComunaCd) : (activeMunicipio ? `mun:${activeMunicipio}` : "")}
              onChange={(e) => {
                const v = e.target.value;
                // Cerrar la hoja tras elegir zona (igual que el sub-select de barrio):
                // si no, la hoja tapa el mapa y el filtro parece no aplicar ("no filtra").
                if (!v) { onComunaSelect?.(null, null); setMobileOpen(false); return; }
                if (v.startsWith("mun:")) {
                  const mun = v.slice(4);
                  const g = groupMunicipios(allBarrios).find((x) => x.municipio === mun);
                  if (g) onComunaSelect?.(null, g.nombre, g.municipio);
                  setMobileOpen(false);
                  return;
                }
                const c = groupComunas(allBarrios).find((g) => String(g.cd) === v);
                if (c) onComunaSelect?.(c.cd as number, c.nombre);
                setMobileOpen(false);
              }}
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: C.ink, background: "#fff" }}
            >
              <option value="">Toda la ciudad</option>
              <optgroup label="Comunas Medellín">
                {groupComunas(allBarrios).map((c) => (
                  <option key={c.cd} value={c.cd!}>{titleCase(c.nombre)}</option>
                ))}
              </optgroup>
              {groupMunicipios(allBarrios).length > 0 && (
                <optgroup label="Otros municipios">
                  {groupMunicipios(allBarrios).map((g) => (
                    <option key={g.municipio} value={`mun:${g.municipio}`}>{titleCase(g.nombre)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {activeComunaCd != null && (
              <select
                value=""
                onChange={(e) => {
                  const b = groupComunas(allBarrios).find((g) => g.cd === activeComunaCd)
                    ?.barrios.find((x) => String(x.id) === e.target.value);
                  if (b) { onBarrioNavigate?.(b); setMobileOpen(false); }
                }}
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: C.ink, background: "#fff" }}
              >
                <option value="">Toda la comuna</option>
                {(groupComunas(allBarrios).find((g) => g.cd === activeComunaCd)?.barrios ?? [])
                  .slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
                  .map((b) => <option key={b.id} value={b.id}>{titleCase(b.nombre)}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Precio */}
        <div style={{ marginBottom: 20 }}>
          <span style={labelSm}>{isRent ? "Precio / mes" : "Precio"} ({pf.currency})</span>
          <span style={{ marginLeft: 8 }}><CurrencyToggle compact /></span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text" inputMode="numeric" autoComplete="off" placeholder="Mínimo" aria-label="Precio mínimo" value={precioMinField.text}
              onChange={(e) => precioMinField.handleChange(e.target.value)}
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", color: C.ink, background: "#fff" }}
            />
            <input
              type="text" inputMode="numeric" autoComplete="off" placeholder="Máximo" aria-label="Precio máximo" value={precioMaxField.text}
              onChange={(e) => precioMaxField.handleChange(e.target.value)}
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", color: C.ink, background: "#fff" }}
            />
          </div>
        </div>

        {/* Habitaciones */}
        <div style={{ marginBottom: 20 }}>
          <span style={labelSm}>Habitaciones</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[null, 1, 2, 3, 4].map((h, i) => (
              <button
                key={String(h)}
                onClick={() => onFiltersChange({ habitaciones: h })}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12,
                  border: `1px solid ${filters.habitaciones === h ? C.teal : C.border}`,
                  background: filters.habitaciones === h ? C.teal : C.white,
                  color: filters.habitaciones === h ? "#fff" : C.ink,
                  cursor: "pointer",
                }}
              >
                {["Todas", "1", "2", "3", "4+"][i]}
              </button>
            ))}
          </div>
        </div>

        {/* Tipo */}
        <div style={{ marginBottom: 20 }}>
          <span style={labelSm}>Tipo de inmueble</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TIPO_OPTIONS.map((opt) => {
              const active = (filters.tipoInmueble ?? []).includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    const sel = filters.tipoInmueble ?? [];
                    const next = active ? sel.filter((v) => v !== opt.value) : [...sel, opt.value];
                    onFiltersChange({ tipoInmueble: next.length === 0 ? null : next });
                  }}
                  style={{
                    padding: "6px 12px", borderRadius: 8, fontSize: 12,
                    border: `1px solid ${active ? C.teal : C.border}`,
                    background: active ? C.teal : C.white,
                    color: active ? "#fff" : C.ink,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "buy" && (
          <>
            {/* Baños */}
            <div style={{ marginBottom: 20 }}>
              <span style={labelSm}>Baños</span>
              <div style={{ display: "flex", gap: 6 }}>
                {[null, 1, 2, 3, 4].map((b, i) => (
                  <button
                    key={String(b)}
                    onClick={() => onFiltersChange({ banos: b })}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12,
                      border: `1px solid ${filters.banos === b ? C.teal : C.border}`,
                      background: filters.banos === b ? C.teal : C.white,
                      color: filters.banos === b ? "#fff" : C.ink,
                      cursor: "pointer",
                    }}
                  >
                    {["Todos", "1", "2", "3", "4+"][i]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Estado del inmueble */}
        <div style={{ marginBottom: 20 }}>
          <span style={labelSm}>Estado del inmueble</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ value: null, label: "Cualquiera" }, { value: "Nuevo", label: "Nuevo" }, { value: "Usado", label: "Usado" }].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => onFiltersChange({ estadoInmueble: opt.value as "Nuevo" | "Usado" | null })}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12,
                  border: `1px solid ${filters.estadoInmueble === opt.value ? C.teal : C.border}`,
                  background: filters.estadoInmueble === opt.value ? C.teal : C.white,
                  color: filters.estadoInmueble === opt.value ? "#fff" : C.ink,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Piso mínimo */}
        <div style={{ marginBottom: 20 }}>
          <span style={labelSm}>Piso mínimo</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[null, 1, 5, 10, 20].map((p) => {
              const active = filters.pisoMin === p;
              return (
                <button
                  key={String(p)}
                  onClick={() => onFiltersChange({ pisoMin: p })}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12,
                    border: `1px solid ${active ? C.teal : C.border}`,
                    background: active ? C.teal : C.white,
                    color: active ? "#fff" : C.ink,
                    cursor: "pointer",
                  }}
                >
                  {p === null ? "Cualquiera" : `${p}+`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Más filtros — expandible (Área, Estrato, Tiempo en mercado, Amenidades) */}
        <button
          onClick={() => setMobileMore((v) => !v)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
            background: "none", border: "none", padding: "2px 0 16px", cursor: "pointer",
            color: C.teal, fontSize: 13, fontWeight: 700,
          }}
        >
          <span>{mobileMore ? "Menos filtros" : "Más filtros"}</span>
          <ChevronDown size={16} style={{ transform: mobileMore ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </button>

        {mobileMore && (
          <>
            {/* Área */}
            <div style={{ marginBottom: 20 }}>
              <span style={labelSm}>Área {areaUnitLabel}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number" placeholder="Mínimo" aria-label="Área mínima" value={areaMinField.text}
                  onChange={(e) => areaMinField.handleChange(e.target.value)}
                  style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", color: C.ink, background: "#fff" }}
                />
                <input
                  type="number" placeholder="Máximo" aria-label="Área máxima" value={areaMaxField.text}
                  onChange={(e) => areaMaxField.handleChange(e.target.value)}
                  style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", color: C.ink, background: "#fff" }}
                />
              </div>
            </div>

            {/* Estrato */}
            <div style={{ marginBottom: 20 }}>
              <span style={labelSm}>Estrato</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[1, 2, 3, 4, 5, 6].map((e) => {
                  const active = (filters.estrato ?? []).includes(e);
                  return (
                    <button
                      key={e}
                      onClick={() => {
                        const cur = filters.estrato ?? [];
                        const next = active ? cur.filter((x) => x !== e) : [...cur, e];
                        onFiltersChange({ estrato: next.length === 0 ? null : next });
                      }}
                      style={{
                        flex: 1, minWidth: 40, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        border: `1px solid ${active ? C.teal : C.border}`,
                        background: active ? C.teal : C.white, color: active ? "#fff" : C.ink, cursor: "pointer",
                      }}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tiempo en mercado */}
            <div style={{ marginBottom: 20 }}>
              <span style={labelSm}>{isRent ? "Tiempo publicado" : "Tiempo en mercado"}</span>
              <div style={{ display: "flex", gap: 6 }}>
                {(isRent
                  ? ([{ val: "nuevo", label: "Reciente" }, { val: "mas30", label: "+30 días" }, { val: "mas60", label: "+60 días" }] as const)
                  : ([{ val: "nuevo", label: "Nuevo" }, { val: "reciente", label: "Reciente" }, { val: "demorado", label: "Demorado" }] as const)
                ).map((opt) => {
                  const active = filters.diasMercado === opt.val;
                  return (
                    <button
                      key={opt.val}
                      onClick={() => onFiltersChange({ diasMercado: active ? null : opt.val })}
                      style={{
                        flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 12,
                        border: `1px solid ${active ? C.teal : C.border}`,
                        background: active ? C.teal : C.white, color: active ? "#fff" : C.ink, cursor: "pointer",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Amenidades */}
            <div style={{ marginBottom: 20 }}>
              <span style={labelSm}>Amenidades</span>
              {(() => {
                const merged = [...(filters.amenidades ?? []), ...(filters.amoblado ? ["amoblado"] : [])];
                return (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {AMENIDADES_GROUPS.flatMap((g) => g.items).map(({ key, label }) => {
                      const active = merged.includes(key);
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            const next = active ? merged.filter((k) => k !== key) : [...merged, key];
                            const hasAmoblado = next.includes("amoblado");
                            const rest = next.filter((k) => k !== "amoblado");
                            onFiltersChange({ amenidades: rest.length === 0 ? null : rest, amoblado: hasAmoblado ? true : null });
                          }}
                          style={{
                            padding: "6px 12px", borderRadius: 8, fontSize: 12,
                            border: `1px solid ${active ? C.teal : C.border}`,
                            background: active ? C.teal : C.white, color: active ? "#fff" : C.ink, cursor: "pointer",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <button
            onClick={() => { onResetAll?.(); setMobileOpen(false); }}
            style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer" }}
          >
            Limpiar todo
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            style={{ flex: 2, padding: "12px", borderRadius: 10, background: C.teal, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );

  // ── Floating dropdown (fixed-positioned sibling to escape stacking context) ──
  const wrapStyle: React.CSSProperties | null = anchor ? {
    position: "fixed",
    top: anchor.bottom + 4,
    left: Math.min(anchor.left, window.innerWidth - 284),
    zIndex: 200,
  } : null;

  const activePanel = open && wrapStyle ? (() => {
    switch (open) {
      case "precio":
        return (
          <div ref={dropdownRef} style={wrapStyle}>
            <PrecioPanel filters={filters} isRent={isRent} onChange={onFiltersChange} onClose={close} lang={lang} fmtPrice={pf.formatPriceCompact} />
          </div>
        );
      case "habBanos":
        return (
          <div ref={dropdownRef} style={wrapStyle}>
            <HabBanosPanel filters={filters} onChange={onFiltersChange} />
          </div>
        );
      case "tipo":
        return (
          <div ref={dropdownRef} style={wrapStyle}>
            <TipoPanel filters={filters} onChange={onFiltersChange} />
          </div>
        );
      case "amenidades":
        return (
          <div ref={dropdownRef} style={wrapStyle}>
            <AmenidadesPanel
              current={[...(filters.amenidades ?? []), ...(filters.amoblado ? ["amoblado"] : [])]}
              onChange={(keys) => {
                const hasAmoblado = keys.includes("amoblado");
                const rest = keys.filter(k => k !== "amoblado");
                onFiltersChange({ amenidades: rest.length === 0 ? null : rest, amoblado: hasAmoblado ? true : null });
              }}
              onClose={close}
            />
          </div>
        );
      case "filtros": {
        const tiempoOpts = isRent
          ? ([
              { val: "nuevo",  label: "Recién publicado", sub: "< 7 días" },
              { val: "mas30",  label: "Más de 30 días",   sub: "lleva tiempo" },
              { val: "mas60",  label: "Más de 60 días",   sub: "negociable" },
            ] as const)
          : ([
              { val: "nuevo",    label: "Nuevo",    sub: "< 7 días" },
              { val: "reciente", label: "Reciente", sub: "< 30 días" },
              { val: "demorado", label: "Demorado", sub: "> 90 días" },
            ] as const);

        const proTeasers = isRent
          ? [
              { label: "Canon mediano del barrio", desc: "¿Está por encima o debajo del mercado?" },
              { label: "Evolución de arriendos",   desc: "Cómo ha cambiado el precio en la zona" },
              { label: "Historial de disponibilidad", desc: "Cuánto tarda en arrendarse ese tipo" },
            ]
          : [
              { label: "Buenas ofertas", desc: "Propiedades bajo la mediana del barrio" },
              { label: "Yield mínimo",   desc: "Rentabilidad para inversores" },
              { label: "Score de zona",  desc: "Calidad y potencial del barrio" },
            ];

        return (
          <div ref={dropdownRef} style={wrapStyle}>
            <div style={{ ...panelBase, minWidth: 300 }}>
              <span style={{ ...labelSm, fontSize: 13, fontWeight: 700, marginBottom: 16 }}>
                Filtros
              </span>

              {/* Área */}
              <span style={labelSm}>Área {areaUnitLabel}</span>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  type="number"
                  placeholder="Mínimo"
                  aria-label="Área mínima"
                  value={areaMinField.text}
                  onChange={(e) => areaMinField.handleChange(e.target.value)}
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none", background: C.white, color: C.ink }}
                />
                <input
                  type="number"
                  placeholder="Máximo"
                  aria-label="Área máxima"
                  value={areaMaxField.text}
                  onChange={(e) => areaMaxField.handleChange(e.target.value)}
                  style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none", background: C.white, color: C.ink }}
                />
              </div>

              {/* Estrato */}
              <span style={labelSm}>Estrato</span>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {[1, 2, 3, 4, 5, 6].map((e) => {
                  const active = (filters.estrato ?? []).includes(e);
                  return (
                    <button
                      key={e}
                      onClick={() => {
                        const cur = filters.estrato ?? [];
                        const next = active ? cur.filter((x) => x !== e) : [...cur, e];
                        onFiltersChange({ estrato: next.length === 0 ? null : next });
                      }}
                      style={{
                        width: 36, height: 32, borderRadius: 8,
                        border: `1.5px solid ${active ? C.teal : C.border}`,
                        background: active ? C.teal : "transparent",
                        color: active ? "#fff" : C.ink,
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>

              {/* Tiempo en mercado */}
              <span style={labelSm}>{isRent ? "Tiempo publicado" : "Tiempo en mercado"}</span>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {tiempoOpts.map((opt) => {
                  const active = filters.diasMercado === opt.val;
                  return (
                    <button
                      key={opt.val}
                      onClick={() => onFiltersChange({ diasMercado: active ? null : opt.val })}
                      style={{
                        flex: 1, padding: "6px 4px", borderRadius: 8, cursor: "pointer",
                        border: `1.5px solid ${active ? C.teal : C.border}`,
                        background: active ? C.teal : "transparent",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: active ? "#fff" : C.ink, lineHeight: 1.3 }}>{opt.label}</div>
                      <div style={{ fontSize: 9, color: active ? "rgba(255,255,255,0.75)" : C.muted }}>{opt.sub}</div>
                    </button>
                  );
                })}
              </div>

              {/* Estado del inmueble */}
              <span style={labelSm}>Estado del inmueble</span>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {[{ value: null, label: "Cualquiera" }, { value: "Nuevo", label: "Nuevo" }, { value: "Usado", label: "Usado" }].map((opt) => (
                  <button
                    key={String(opt.value)}
                    onClick={() => onFiltersChange({ estadoInmueble: opt.value as "Nuevo" | "Usado" | null })}
                    style={{
                      flex: 1, padding: "6px 4px", borderRadius: 8, fontSize: 12,
                      border: `1px solid ${filters.estadoInmueble === opt.value ? C.teal : C.border}`,
                      background: filters.estadoInmueble === opt.value ? C.teal : "transparent",
                      color: filters.estadoInmueble === opt.value ? "#fff" : C.ink,
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Piso mínimo */}
              <span style={labelSm}>Piso mínimo</span>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {[null, 1, 5, 10, 20].map((p) => {
                  const active = filters.pisoMin === p;
                  return (
                    <button
                      key={String(p)}
                      onClick={() => onFiltersChange({ pisoMin: p })}
                      style={{
                        flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12,
                        border: `1px solid ${active ? C.teal : C.border}`,
                        background: active ? C.teal : "transparent",
                        color: active ? "#fff" : C.ink,
                        cursor: "pointer",
                      }}
                    >
                      {p === null ? "Cualquiera" : `${p}+`}
                    </button>
                  );
                })}
              </div>

              {/* PRO teasers — solo para usuarios sin plan pro */}
              {!isPro && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                <span style={labelSm}>Filtros PRO</span>
                {proTeasers.map((t) => (
                  <div key={t.label} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 10px", borderRadius: 8,
                    background: "rgba(255,201,40,0.06)",
                    border: "1px solid rgba(255,201,40,0.3)",
                    userSelect: "none",
                  }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>🔒 {t.label}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{t.desc}</div>
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: "1px",
                      background: "#FCD116", color: "#111418",
                      padding: "2px 7px", borderRadius: 999, flexShrink: 0,
                    }}>
                      PRO
                    </span>
                  </div>
                ))}
              </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                <button
                  onClick={() => { onFiltersChange({ areaMin: null, areaMax: null, antiguedad: null, estrato: null, diasMercado: null, amoblado: null, estadoInmueble: null, pisoMin: null }); close(); }}
                  style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 12, cursor: "pointer" }}
                >
                  Limpiar
                </button>
                <button
                  onClick={close}
                  style={{ flex: 1, padding: "8px", borderRadius: 8, background: C.teal, color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  })() : null;

  // Comprar/Arrendar — vivía en el header (MapNavbar), ahora en el borde
  // izquierdo de esta barra al traer ComunidadNavbar como header nuevo.
  const opToggle = onTabChange && activeTab !== "sell" && (
    <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 999, overflow: "hidden", flexShrink: 0 }}>
      {(["buy", "rent"] as const).map((id) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          style={{
            border: "none", background: activeTab === id ? C.teal : "transparent",
            color: activeTab === id ? "#fff" : C.muted, padding: "5px 12px",
            fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {id === "buy" ? "Comprar" : "Arrendar"}
        </button>
      ))}
    </div>
  );

  // Vender/Agente/Simular/Comparar salieron de esta barra → viven en el hub
  // "REAL ESTATE ▾" del navbar (destinos, no filtros del mapa). La barra queda
  // solo con modos (Comprar/Arrendar) + filtros.

  // ── Bar container ──────────────────────────────────────────────────────────
  return (
    <>
      <div
        ref={barRef}
        data-tour="filters"
        style={{
          position: "fixed", top: "var(--map-header-h, 53px)", left: 0, right: 0, zIndex: 40,
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
          boxShadow: "0 1px 2px rgba(26,18,8,0.05), 0 10px 24px -14px rgba(26,18,8,0.22)",
          height: 48,
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 16px",
        }}
      >
        {/* Desktop */}
        <div className="hidden md:flex w-full items-center" style={{ gap: 10 }}>
          {opToggle}
          {activeTab === "sell" ? sellContent : desktopContent}
        </div>

        {/* Mobile trigger */}
        <div className="flex md:hidden w-full items-center justify-between" style={{ gap: 8 }}>
          {opToggle}
          {activeTab === "sell" ? sellContent : (
            <>
              <button
                onClick={() => setMobileOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: activeCount > 0 ? C.teal : C.white,
                  color: activeCount > 0 ? "#fff" : C.ink,
                  border: `1px solid ${activeCount > 0 ? C.teal : C.border}`,
                  borderRadius: 8, padding: "0 14px", height: 34,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                <SlidersHorizontal size={13} />
                Filtros
                {activeCount > 0 && (
                  <span style={{
                    background: "#fff", color: C.teal,
                    borderRadius: 999, padding: "0 6px",
                    fontSize: 10, fontWeight: 700,
                  }}>
                    {activeCount}
                  </span>
                )}
              </button>
              {activeCount > 0 && (
                <button
                  onClick={onResetAll}
                  style={{ background: "none", border: "none", color: C.teal, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Limpiar
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Search suggestions — position:fixed so it floats above map/WebGL */}
      {searchOpen && suggestions.length > 0 && searchRect && (
        <div
          ref={searchRef}
          style={{
            position: "fixed",
            top: searchRect.bottom + 4,
            left: searchRect.left,
            zIndex: 9999,
            background: C.white, border: `1px solid ${C.border}`,
            borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.16)",
            minWidth: 240, maxHeight: 280, overflowY: "auto",
          }}
        >
          {suggestions.map((opt) => (
            <button
              key={opt.id}
              onMouseDown={(e) => { e.preventDefault(); handleSearchSelect(opt); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "9px 14px", background: "none", border: "none",
                cursor: "pointer", fontSize: 13, color: C.ink,
                borderBottom: `1px solid ${C.border}`,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.surface)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <span style={{ fontWeight: 600 }}>{opt.nombre}</span>
              <span style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>{opt.municipio}</span>
              {opt.comuna && (
                <span style={{ color: C.muted, fontSize: 11, marginLeft: 4 }}>· {opt.comuna}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {activePanel}
      {mobileSheet}
    </>
  );
}
