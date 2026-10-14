import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Calculator,
  Car,
  ChevronRight,
  Coffee,
  Dumbbell,
  GripVertical,
  Leaf,
  Minus,
  Shield,
  Train,
  Trees,
  Utensils,
  ShoppingBag,
  Sparkles,
  Star,
  Info,
  Activity,
  Target,
  X,
} from "@/lib/icons";
import type { NomadaBreakdown } from "@/lib/adapters";
import type { Neighborhood } from "@/lib/adapters";
import { LIQUIDITY_COLORS } from "@/data/marketActivity";
import { OPP_COLORS, getScoreColor, getScoreLabel } from "@/config/mapColors";
import { auth, GOAL_LABEL, recommendation, type Goal } from "@/lib/auth";
import { useTarget, TARGET_OPTIONS } from "@/contexts/TargetContext";
import { formatCOP, formatNumber, formatPct, yieldColor } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLang, AutoTranslate } from "@/lib/i18n";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import { useListings, useCiudadStats, useBarrios, useBarriosRaw } from "@/hooks/useBarrios";
import { useFavoritos, useToggleFavorito } from "@/hooks/useUser";
import type { ApiListing } from "@/lib/adapters";

type View = "city" | "barrio" | "listings";

// ── Panel persistence helpers ───────────────────────────────────────────────

const PANEL_LS = { pos: "urbi_panel_pos", size: "urbi_panel_size" };

const PANEL_MIN_W = 300;
const PANEL_MIN_H = 200;
const panelMaxW = () => Math.floor(window.innerWidth * 0.85);
const panelMaxH = () => Math.floor(window.innerHeight * 0.85);

function readPanelSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(PANEL_LS.size);
    if (raw) {
      const p = JSON.parse(raw) as { width: number; height: number };
      return {
        width: Math.max(PANEL_MIN_W, Math.min(panelMaxW(), p.width)),
        height: Math.max(PANEL_MIN_H, Math.min(panelMaxH(), p.height)),
      };
    }
  } catch {}
  return { width: 380, height: 520 };
}

function readPanelPos(width: number): { left: number; top: number } {
  if (typeof window === "undefined") return { left: 20, top: 80 };
  try {
    const raw = localStorage.getItem(PANEL_LS.pos);
    if (raw) {
      const p = JSON.parse(raw) as { left: number; top: number };
      return {
        left: Math.max(0, Math.min(window.innerWidth - width - 8, p.left)),
        top: Math.max(70, Math.min(window.innerHeight - 200, p.top)),
      };
    }
  } catch {}
  return { left: Math.max(0, window.innerWidth - width - 20), top: 80 };
}

type Props = {
  selected: Neighborhood | null;
  onClear: () => void;
  onSelect?: (n: Neighborhood) => void;
  onGoToMLS?: (n: Neighborhood) => void;
  perfil?: string;
  risk?: string;
};

const GOAL_TO_PERFIL: Record<string, string> = {
  airbnb: "airbnb",
  "renta-larga": "largo_plazo",
  valorizacion: "largo_plazo",
  mediano_plazo: "mediano_plazo",
};

type SortKey = "relevancia" | "precio_asc" | "precio_desc" | "area";

function sortListings(listings: ApiListing[], key: SortKey): ApiListing[] {
  const s = [...listings];
  if (key === "relevancia") {
    s.sort((a, b) => (b.relevancia_score ?? 0) - (a.relevancia_score ?? 0));
  } else if (key === "precio_asc") {
    s.sort((a, b) => (a.precio_cop ?? 0) - (b.precio_cop ?? 0));
  } else if (key === "precio_desc") {
    s.sort((a, b) => (b.precio_cop ?? 0) - (a.precio_cop ?? 0));
  } else if (key === "area") {
    s.sort((a, b) => (b.area_m2 ?? 0) - (a.area_m2 ?? 0));
  }
  return s;
}

function matchColor(score: number): string {
  if (score >= 75) return "#0F8A4F";
  if (score >= 55) return "#0F8A4F";
  if (score >= 35) return "#F2B807";
  return "#5B5F5C";
}

export function FloatingPanel({ selected, onClear, onSelect, onGoToMLS, perfil: perfilProp, risk: riskProp }: Props) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>("city");
  const [minimized, setMinimized] = useState(true);
  const user = typeof window !== "undefined" ? auth.get() : null;
  const perfil = perfilProp ?? GOAL_TO_PERFIL[user?.goal ?? ""];
  const risk = riskProp ?? user?.risk;

  const [size, setSize] = useState<{ width: number; height: number }>(() =>
    typeof window !== "undefined" ? readPanelSize() : { width: 380, height: 520 }
  );
  const [pos, setPos] = useState<{ left: number; top: number }>(() =>
    typeof window !== "undefined" ? readPanelPos(size.width) : { left: 20, top: 80 }
  );

  // Capture latest size/pos in refs so event handlers are always current
  const sizeRef = useRef(size);
  const posRef = useRef(pos);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { posRef.current = pos; }, [pos]);

  // Keep the floating panel inside the viewport after resize / rotation.
  useEffect(() => {
    const onResize = () => {
      const w = Math.max(PANEL_MIN_W, Math.min(panelMaxW(), sizeRef.current.width));
      const h = Math.max(PANEL_MIN_H, Math.min(panelMaxH(), sizeRef.current.height));
      if (w !== sizeRef.current.width || h !== sizeRef.current.height) setSize({ width: w, height: h });
      const left = Math.max(0, Math.min(window.innerWidth - w - 8, posRef.current.left));
      const top = Math.max(70, Math.min(window.innerHeight - 200, posRef.current.top));
      if (left !== posRef.current.left || top !== posRef.current.top) setPos({ left, top });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (selected) {
      setView("barrio");
      setMinimized(false);
    } else {
      setView("city");
    }
  }, [selected?.id]);

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const offsetX = e.clientX - posRef.current.left;
    const offsetY = e.clientY - posRef.current.top;
    document.body.style.cursor = "grabbing";

    const onMove = (ev: MouseEvent) => {
      setPos({
        left: Math.max(0, Math.min(window.innerWidth - sizeRef.current.width - 8, ev.clientX - offsetX)),
        top: Math.max(70, Math.min(window.innerHeight - 200, ev.clientY - offsetY)),
      });
    };

    const onUp = (ev: MouseEvent) => {
      const newPos = {
        left: Math.max(0, Math.min(window.innerWidth - sizeRef.current.width - 8, ev.clientX - offsetX)),
        top: Math.max(70, Math.min(window.innerHeight - 200, ev.clientY - offsetY)),
      };
      setPos(newPos);
      localStorage.setItem(PANEL_LS.pos, JSON.stringify(newPos));
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = sizeRef.current.width;
    const startH = sizeRef.current.height;
    document.body.style.cursor = "se-resize";

    const onMove = (ev: MouseEvent) => {
      const maxH = Math.min(panelMaxH(), window.innerHeight - posRef.current.top - 20);
      setSize({
        width: Math.max(PANEL_MIN_W, Math.min(panelMaxW(), startW + (ev.clientX - startX))),
        height: Math.max(PANEL_MIN_H, Math.min(maxH, startH + (ev.clientY - startY))),
      });
    };

    const onUp = (ev: MouseEvent) => {
      const maxH = Math.min(panelMaxH(), window.innerHeight - posRef.current.top - 20);
      const newSize = {
        width: Math.max(PANEL_MIN_W, Math.min(panelMaxW(), startW + (ev.clientX - startX))),
        height: Math.max(PANEL_MIN_H, Math.min(maxH, startH + (ev.clientY - startY))),
      };
      setSize(newSize);
      localStorage.setItem(PANEL_LS.size, JSON.stringify(newSize));
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ---- Mobile bottom sheet ----
  if (isMobile) {
    if (!selected) return null;
    return (
      <AnimatePresence>
        <motion.div
          initial={{ y: 400 }}
          animate={{ y: minimized ? 360 : 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="absolute inset-x-0 bottom-0 z-20 max-h-[78dvh] overflow-hidden rounded-t-2xl"
          style={{ background: '#FAF8F3', borderTop: '0.5px solid #E5E0D5', '--background': '#FFFFFF', '--foreground': '#111418', '--surface': '#FAF8F3', '--surface-elevated': '#F3F0E8', '--muted-foreground': '#5B5F5C', '--border': 'rgb(184 164 138 / 50%)' } as React.CSSProperties}
          drag="y"
          dragConstraints={{ top: 0, bottom: 360 }}
          onDragEnd={(_, info) => setMinimized(info.offset.y > 80)}
        >
          <div className="flex justify-center pt-2">
            <div className="h-1.5 w-10 rounded-full bg-border" />
          </div>
          <div className="max-h-[70dvh] overflow-y-auto px-4" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))", overscrollBehavior: "contain" }}>
            <PanelContent view={view} setView={setView} selected={selected} onClear={onClear} user={user} onSelect={onSelect} onGoToMLS={onGoToMLS} />
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ---- Desktop draggable floating panel ----
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <AnimatePresence mode="wait">
        {minimized ? (
          selected ? (
          <motion.button
            key="min"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            onClick={() => setMinimized(false)}
            className="pointer-events-auto absolute right-4 top-1/2 flex h-32 -translate-y-1/2 items-center justify-center gap-2 rounded-l-xl px-2 text-xs font-medium text-[#0F8A4F]"
            style={{ background: '#FAF8F3', border: '0.5px solid #E5E0D5', boxShadow: '0 2px 12px rgba(26,18,8,0.1)' }}
          >
            <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            <span style={{ writingMode: "vertical-rl" }} className="rotate-180 uppercase tracking-widest">
              Panel
            </span>
          </motion.button>
          ) : null
        ) : (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.22 }}
            style={{
              position: "absolute",
              left: pos.left,
              top: pos.top,
              width: size.width,
              height: size.height,
              minHeight: 200,
              maxHeight: `calc(100dvh - ${pos.top + 20}px)`,
              background: '#FAF8F3',
              border: '0.5px solid #E5E0D5',
              boxShadow: '0 8px 32px rgba(26,18,8,0.15)',
              '--background': '#FFFFFF',
              '--foreground': '#111418',
              '--surface': '#FAF8F3',
              '--surface-elevated': '#F3F0E8',
              '--muted-foreground': '#5B5F5C',
              '--border': 'rgb(184 164 138 / 50%)',
            } as React.CSSProperties}
            className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl"
          >
            {/* Drag handle */}
            <div
              onMouseDown={startDrag}
              className="flex h-10 shrink-0 cursor-grab select-none items-center justify-between px-3"
              style={{ background: '#F3F0E8', borderBottom: '0.5px solid #E5E0D5' }}
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <GripVertical className="h-4 w-4" />
                <span className="text-[10px] font-medium uppercase tracking-widest">Mueve el panel</span>
              </div>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setMinimized(true)}
                className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-background/60 hover:text-foreground"
                title="Minimizar"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <PanelContent view={view} setView={setView} selected={selected} onClear={onClear} user={user} onSelect={onSelect} onGoToMLS={onGoToMLS} />
            </div>

            {/* Resize handle — bottom-right corner */}
            <div
              onMouseDown={startResize}
              className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-se-resize opacity-30 hover:opacity-70 transition-opacity"
              title="Redimensionar"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="h-full w-full text-muted-foreground">
                <circle cx="13" cy="13" r="1.4" />
                <circle cx="9" cy="13" r="1.4" />
                <circle cx="13" cy="9" r="1.4" />
                <circle cx="5" cy="13" r="1.4" />
                <circle cx="9" cy="9" r="1.4" />
                <circle cx="13" cy="5" r="1.4" />
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PanelContent({
  view,
  setView,
  selected,
  onClear,
  user,
  onSelect,
  onGoToMLS,
}: {
  view: View;
  setView: (v: View) => void;
  selected: Neighborhood | null;
  onClear: () => void;
  user: ReturnType<typeof auth.get>;
  onSelect?: (n: Neighborhood) => void;
  onGoToMLS?: (n: Neighborhood) => void;
}) {
  return (
    <AnimatePresence mode="wait">
      {view === "city" && (
        <motion.div key="city" {...transition}>
          <CityOverview goal={user?.goal} onSelect={onSelect} />
        </motion.div>
      )}
      {view === "barrio" && selected && (
        <motion.div key={`b-${selected.id}`} {...transition}>
          <BarrioDetail
            n={selected}
            goal={user?.goal}
            onBack={() => {
              onClear();
              setView("city");
            }}
            onListings={() => setView("listings")}
            onGoToMLS={onGoToMLS}
          />
        </motion.div>
      )}
      {view === "listings" && selected && (
        <motion.div key={`l-${selected.id}`} {...transition}>
          <ListingsView
            n={selected}
            onBack={() => setView("barrio")}
            perfil={GOAL_TO_PERFIL[user?.goal ?? ""]}
            risk={user?.risk}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const transition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

/* ------------- City overview ------------- */

function goalToPerfil(goal?: Goal | null): string | undefined {
  if (goal === "airbnb") return "airbnb";
  if (goal === "mediano_plazo") return "mediano_plazo";
  if (goal === "renta-larga" || goal === "valorizacion") return "largo_plazo";
  return undefined;
}

function CityOverview({ goal, onSelect }: { goal?: Goal; onSelect?: (n: Neighborhood) => void }) {
  const perfil = goalToPerfil(goal);
  const { data: apiStats } = useCiudadStats(perfil);
  const { data: barriosRaw } = useBarriosRaw(perfil);
  const { data: allBarriosNeighborhood } = useBarrios(perfil);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !allBarriosNeighborhood) return [];
    const q = searchQuery.trim().toUpperCase();
    return allBarriosNeighborhood
      .filter((n) => n.nombre.toUpperCase().includes(q) || n.comuna?.toUpperCase().includes(q))
      .slice(0, 8);
  }, [searchQuery, allBarriosNeighborhood]);

  // Fallback: compute stats from all-Valle barrios when API returns nothing
  const computedStats = useMemo(() => {
    if (!barriosRaw?.length) return null;
    const withYield = barriosRaw.filter((b) => b.mercado.yield_bruto_pct != null);
    const yields = withYield.map((b) => b.mercado.yield_bruto_pct!);
    const prices = barriosRaw
      .filter((b) => b.mercado.precio_m2_cop != null)
      .map((b) => b.mercado.precio_m2_cop!)
      .sort((a, b) => a - b);
    const yieldPromedio =
      yields.length > 0
        ? Math.round((yields.reduce((s, v) => s + v, 0) / yields.length) * 10) / 10
        : null;
    const precioMediana = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null;
    const top5 = [...withYield]
      .sort((a, b) => (b.mercado.yield_bruto_pct ?? 0) - (a.mercado.yield_bruto_pct ?? 0))
      .slice(0, 5)
      .map((b) => ({
        barrio_id: b.barrio_id,
        nombre: b.nombre,
        municipio: b.municipio,
        score: b.scores.score_activo,
        yield_bruto_pct: b.mercado.yield_bruto_pct,
        precio_m2_cop: b.mercado.precio_m2_cop,
      }));
    return {
      barrios_analizados: withYield.length,
      yield_promedio: yieldPromedio,
      precio_m2_mediana: precioMediana,
      oportunidades_activas: 0,
      top5,
    };
  }, [barriosRaw]);

  const stats = apiStats ?? computedStats;

  const chartData = stats?.top5.map((b) => ({
    name: shortName(b.nombre ?? ""),
    yield: b.yield_bruto_pct ?? 0,
  })) ?? [];

  const bestName = stats?.top5[0]?.nombre
    ? stats.top5[0].nombre.split(" ").map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ")
    : "—";

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-widest text-primary">Vista de ciudad</div>
        <h2 className="mt-1 font-display text-xl font-semibold">Medellín · Valle de Aburrá</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tu perfil:{" "}
          <span className="text-foreground">{goal ? GOAL_LABEL[goal] : "—"}</span>
        </p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
          placeholder="Buscar barrio…"
          className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
        />
        {searchFocused && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
            {searchResults.map((n) => (
              <button
                key={n.id}
                onMouseDown={() => {
                  setSearchQuery("");
                  onSelect?.(n);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-primary/10"
              >
                <div>
                  <span className="font-medium">{titleCase(n.nombre)}</span>
                  <span className="ml-1 text-[11px] text-muted-foreground">{n.comuna}</span>
                </div>
                {n.score_activo != null && (
                  <span className="text-[11px] font-semibold text-primary">{n.score_activo}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Yield promedio" value={stats ? `${stats.yield_promedio ?? "—"}%` : "…"} accent="cyan" />
        <Metric label="Barrios analizados" value={stats ? String(stats.barrios_analizados) : "…"} />
        <Metric label="Precio m² mediana" value={stats?.precio_m2_mediana ? formatCOP(stats.precio_m2_mediana) : "…"} />
        <Metric label="Mejor zona perfil" value={bestName} accent="green" />
      </div>

      <Section title="Top 5 barrios por yield">
        <div className="h-40">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6E726E" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6E726E" }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "rgba(29,158,117,0.06)" }}
                contentStyle={tooltipStyle}
                formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, "Yield"]}
              />
              <Bar dataKey="yield" radius={[6, 6, 0, 0]} fill="url(#barGrad)" />
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0F8A4F" />
                  <stop offset="100%" stopColor="#003893" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {!stats && (
          <div className="mt-1 h-1 w-full animate-pulse rounded-full bg-primary/20" />
        )}
      </Section>

      <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-primary">
          <Sparkles className="h-3 w-3" /> Recomendación
        </div>
        <p className="text-sm leading-relaxed">{recommendation(goal as never)}</p>
      </div>

      {apiStats?.ultima_actualizacion_listings && (() => {
        const days = Math.round((Date.now() - new Date(apiStats.ultima_actualizacion_listings!).getTime()) / 86_400_000);
        return (
          <p className="text-center text-[10px] text-muted-foreground">
            Datos actualizados hace {days === 0 ? "hoy" : `${days} día${days === 1 ? "" : "s"}`}
          </p>
        );
      })()}
      <p className="pt-1 text-center text-[11px] text-muted-foreground">
        Haz clic en un barrio del mapa para ver su análisis →
      </p>
    </div>
  );
}

function shortName(s: string) {
  return s.length > 8 ? s.slice(0, 7) + "…" : s;
}

/* ------------- Barrio detail ------------- */

// ── Valorización DANE 2015-2025 ────────────────────────────────────────────────
const DANE_VARS = [11.9, 7.6, 7.8, 10.6, 8.7, 7.0, 7.1, 9.5, 15.9, 10.1, 8.3];
const VALORIZ_MULT: Record<number, number> = { 5: 1.15, 4: 1.05, 3: 1.0 };

function calcValorizStats(estrato: number) {
  const mult = VALORIZ_MULT[estrato] ?? 0.9;
  // Compound growth 2015→2025
  const acumulado = DANE_VARS.reduce(
    (acc, v) => (1 + acc / 100) * (1 + (v * mult) / 100) * 100 - 100,
    0,
  );
  const ultimoAnio = DANE_VARS[DANE_VARS.length - 1] * mult;
  // Compound 5yr projection from last 5yr DANE avg
  const avg5 = DANE_VARS.slice(-5).reduce((s, v) => s + v, 0) / 5;
  const proj5 = (Math.pow(1 + (avg5 * mult) / 100, 5) - 1) * 100;
  return {
    acumulado: Math.round(acumulado),
    ultimoAnio: parseFloat(ultimoAnio.toFixed(1)),
    proj5: Math.round(proj5),
  };
}

const SEGURIDAD_COLORS: Record<string, string> = {
  "ALTA":     "#0F8A4F",
  "MEDIA":    "#0F8A4F",
  "BAJA":     "#F2B807",
  "MUY BAJA": "#CE1126",
  "SIN DATOS": "#5B5F5C",
};

const TRAFICO_COLORS: Record<string, string> = {
  "bajo":  "#0F8A4F",
  "medio": "#F2B807",
  "alto":  "#CE1126",
};

const VERDE_COLORS: Record<string, string> = {
  "ALTA":    "#0F8A4F",
  "MEDIA":   "#0F8A4F",
  "BAJA":    "#F2B807",
  "MÍNIMA":  "#CE1126",
  "SIN DATOS": "#5B5F5C",
};

// Interpolate gray (#8A8E8A) → plant green (#0F8A4F) based on 0–1 ratio
function verdeColor(ratio: number): string {
  const r = Math.round(156 + (34 - 156) * ratio);
  const g = Math.round(163 + (197 - 163) * ratio);
  const b = Math.round(175 + (94 - 175) * ratio);
  return `rgb(${r},${g},${b})`;
}

// Categorías POT (raw.pot_usos_medellin.areagraluso) — mixtura alta = más
// flexible para desarrollo/inversión, espacio público = más restrictivo.
const USO_SUELO_COLORS: Record<string, string> = {
  "Áreas y corredores de alta mixtura":  "#0F8A4F",
  "Áreas y corredores de media mixtura": "#0F8A4F",
  "Áreas de baja mixtura":               "#F2B807",
  "Uso Dotacional":                      "#6366f1",
  "Espacio Público Existente":           "#5B5F5C",
  "Espacio Público Proyectado":          "#8A8E8A",
};

const MERCADO_REAL_COLORS: Record<string, string> = {
  "vendedor":    "#CE1126",  // poco inventario, se vende rápido
  "balanceado":  "#F2B807",
  "comprador":   "#0F8A4F",  // mucho inventario, más poder de negociación
};

const SALUD_COLORS: Record<string, string> = {
  "MUY SALUDABLE": "#0F8A4F",
  "SALUDABLE":     "#0F8A4F",
  "PRECAUCIÓN":    "#F2B807",
  "ALERTA":        "#CE1126",
};

function fmtConn(v: number | null | undefined, suffix: string): string {
  return v != null ? `${v} ${suffix}` : "Sin datos";
}

const _GOAL_TO_PERFIL: Record<string, string> = {
  airbnb: "airbnb",
  "renta-larga": "largo_plazo",
  valorizacion: "largo_plazo",
  mediano_plazo: "mediano_plazo",
};

function BarrioDetail({ n, onBack, onListings, goal, onGoToMLS }: { n: Neighborhood; onBack: () => void; onListings: () => void; goal?: Goal; onGoToMLS?: (n: Neighborhood) => void }) {
  const perfil = _GOAL_TO_PERFIL[goal ?? ""];
  const risk = auth.get()?.risk;
  const { target, setTarget } = useTarget();
  const scoreColor = getScoreColor(n.score_activo ?? null, undefined, perfil, risk);
  const scoreLbl = getScoreLabel(n.score_activo ?? null, perfil, risk);

  const { data: listingsData, isLoading: listingsLoading } = useListings(n.id, 6);
  const apiListings = listingsData?.listings ?? [];
  const listings: ApiListing[] = apiListings.slice(0, 3);

  const { data: allBarrios } = useBarrios();
  const maxVerdePct = useMemo(() => {
    const vals = allBarrios?.map((b) => b.verde_pct ?? 0).filter((v) => v > 0) ?? [];
    return vals.length ? Math.max(...vals) : 40;
  }, [allBarrios]);
  const { data: apiFavs = [] } = useFavoritos();
  const { add: addFav, remove: removeFav } = useToggleFavorito();
  const isRealBarrio = n.id < 800_000;
  const apiFav = apiFavs.some((f) => f.barrio_id === n.id);
  const [fav, setFav] = useState<boolean>(() => isRealBarrio ? apiFav : auth.isFavorite(n.id));

  useEffect(() => {
    setFav(isRealBarrio ? apiFav : auth.isFavorite(n.id));
  }, [n.id, apiFav, isRealBarrio]);

  // Log view to history once per neighborhood
  useEffect(() => {
    auth.pushHistory({ type: "view", label: `Vio ${titleCase(n.nombre)}`, barrioId: n.id });
  }, [n.id]);

  const toggleFav = useCallback(() => {
    if (isRealBarrio) {
      if (apiFav) {
        removeFav.mutate(n.id);
      } else {
        addFav.mutate(n.id);
      }
    } else {
      auth.toggleFavorite({ id: n.id, nombre: titleCase(n.nombre), yield: n.yield });
      setFav(auth.isFavorite(n.id));
    }
  }, [isRealBarrio, apiFav, n.id, n.nombre, n.yield, addFav, removeFav]);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground transition hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Volver a ciudad
      </button>

      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0F8A4F', margin: '0 0 4px' }}>Barrio</p>
            <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: '1.5rem', fontWeight: 900, color: '#111418', margin: 0, letterSpacing: '-0.5px', lineHeight: 1.1 }}>{titleCase(n.nombre)}</h2>
            <p style={{ marginTop: 3, fontSize: 11, color: '#5B5F5C' }}>{n.comuna}</p>
          </div>
          <button
            onClick={toggleFav}
            disabled={addFav.isPending || removeFav.isPending}
            title={fav ? "Quitar de favoritos" : "Guardar en favoritos"}
            className={`grid h-9 w-9 place-items-center rounded-full border transition disabled:opacity-50 ${
              fav ? "border-warning/60 bg-warning/15 text-warning" : "border-border bg-background/40 text-muted-foreground hover:text-warning"
            }`}
          >
            <Star className={`h-4 w-4 ${fav ? "fill-warning" : ""}`} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>Estrato {n.estrato}</Badge>
          <Badge>{n.municipio}</Badge>
          <Badge color={scoreColor}>{scoreLbl}</Badge>
        </div>
      </div>

      <div className="flex gap-2">
        {onGoToMLS && (
          <button
            onClick={() => onGoToMLS(n)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/20"
          >
            🏠 Ver listings en el mapa
          </button>
        )}
        <Link
          to="/eventos/$barrio_slug"
          params={{ barrio_slug: 'el-poblado' }}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 py-2.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
        >
          💬 Ir a comunidad
        </Link>
      </div>

      {/* Target selector */}
      <div className="flex gap-1.5 flex-wrap">
        {TARGET_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTarget(opt.value)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all"
            style={target === opt.value
              ? { background: '#0F8A4F', color: '#FFFFFF', border: '0.5px solid #0F8A4F' }
              : { background: '#F3F0E8', color: '#5B5F5C', border: '0.5px solid #E5E0D5' }
            }
          >
            <span>{opt.icon}</span>
            <span>{opt.labelEs}</span>
          </button>
        ))}
      </div>

      {/* Target-specific metrics */}
      {target === 'buyer' && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Precio m²" value={formatCOP(n.precio_m2)} />
          <Metric label="Años recupero" value={n.anos_recupero != null ? `${n.anos_recupero.toFixed(1)} años` : "—"} />
        </div>
      )}
      {target === 'seller' && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Liquidez zona" value={n.liquidez_api?.score != null ? `${n.liquidez_api.score}/100` : "—"} accent="cyan" />
          <Metric label="Tiempo estimado venta" value={n.liquidez_api?.tiempo_estimado_venta ?? "—"} />
        </div>
      )}
      {target === 'landlord' && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Yield bruto" value={formatPct(n.yield)} accent="cyan" />
          <Metric label="Arriendo prom." value={`${formatCOP(n.arriendo)}/mes`} />
        </div>
      )}
      {target === 'renter' && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Arriendo mediana" value={`${formatCOP(n.arriendo)}/mes`} />
          <Metric label="Precio m²" value={formatCOP(n.precio_m2)} />
        </div>
      )}
      {target === 'investor' && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Precio m² (venta)" value={formatCOP(n.precio_m2)} />
          <Metric label="Arriendo prom." value={`${formatCOP(n.arriendo)}/mes`} />
          <Metric label="Yield bruto" value={formatPct(n.yield)} accent="cyan" />
          <Metric label="Años recupero" value={n.anos_recupero != null ? `${n.anos_recupero.toFixed(1)} años` : "—"} />
        </div>
      )}

      <Section title="Corrección inmobiliaria">
        <div style={{ borderRadius: 10, border: '1px solid rgb(184 164 138 / 55%)', background: 'rgba(255,255,255,0.55)', padding: 12, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#5B5F5C' }}>Precio publicado:</span>
            <span style={{ color: '#111418', fontWeight: 600 }}>{formatCOP(n.precio_m2)}/m²</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#5B5F5C' }}>Precio negociación:</span>
            <span style={{ color: '#0F8A4F', fontWeight: 600 }}>~{formatCOP(Math.round(n.precio_m2 * 0.97))}/m² <span style={{ color: '#6E726E' }}>(-3%)</span></span>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid rgb(184 164 138 / 40%)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#5B5F5C' }}>Arriendo publicado:</span>
            <span style={{ color: '#111418', fontWeight: 600 }}>{formatCOP(n.arriendo)}/mes</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#5B5F5C' }}>Arriendo neto:</span>
            <span style={{ color: '#0F8A4F', fontWeight: 600 }}>~{formatCOP(Math.round(n.arriendo * 0.90))}/mes <span style={{ color: '#6E726E' }}>(-10%)</span></span>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid rgb(184 164 138 / 40%)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#5B5F5C' }}>Yield publicado:</span>
            <span style={{ color: '#111418', fontWeight: 600 }}>{formatPct(n.yield)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#5B5F5C' }}>Yield real est.:</span>
            <span style={{ color: '#0F8A4F', fontWeight: 600 }}>{n.yield != null ? formatPct(Math.round(n.yield * (0.90 / 0.97) * 10) / 10) : "—"}</span>
          </div>
        </div>
        <p style={{ marginTop: 6, fontSize: 10, lineHeight: 1.5, color: '#6E726E' }}>
          ℹ️ Precio de negociación estimado descontando comisión inmobiliaria (3% venta, 10% arriendo).
          Dato real disponible próximamente con escrituras SNR.
        </p>
      </Section>

      <Section title="Conectividad">
        <div className="space-y-2">
          {goal === "airbnb" ? (
            <>
              <ConnRow icon={<Coffee className="h-3.5 w-3.5" />} label="Cafés en 500m" value={fmtConn(n.n_cafes_500m, "locales")} />
              <ConnRow icon={<Trees className="h-3.5 w-3.5" />} label="Parque más cercano" value={`${n.dist_parque.toFixed(1)} km`} />
              <ConnRow icon={<Sparkles className="h-3.5 w-3.5" />} label="Zona turística" value={n.zona_turistica === true ? "Sí" : n.zona_turistica === false ? "No" : "Sin datos"} />
            </>
          ) : goal === "mediano_plazo" ? (
            <>
              <ConnRow icon={<Coffee className="h-3.5 w-3.5" />} label="Cafés en 500m" value={fmtConn(n.n_cafes_500m, "locales")} />
              <ConnRow icon={<Briefcase className="h-3.5 w-3.5" />} label="Coworking en 1km" value={fmtConn(n.n_coworking_1km, "espacios")} />
              <ConnRow icon={<Dumbbell className="h-3.5 w-3.5" />} label="Gimnasios en 1km" value={fmtConn(n.n_gimnasios_1km, "centros")} />
            </>
          ) : goal === "renta-larga" ? (
            <>
              <ConnRow icon={<Train className="h-3.5 w-3.5" />} label="Metro más cercano" value={`${n.dist_metro.toFixed(1)} km`} />
              <ConnRow icon={<Trees className="h-3.5 w-3.5" />} label="Parque más cercano" value={`${n.dist_parque.toFixed(1)} km`} />
              <ConnRow icon={<ShoppingBag className="h-3.5 w-3.5" />} label="Mall más cercano" value={`${n.dist_mall.toFixed(1)} km`} />
            </>
          ) : (
            <>
              <ConnRow icon={<Train className="h-3.5 w-3.5" />} label="Metro más cercano" value={`${n.dist_metro.toFixed(1)} km`} />
              <ConnRow icon={<Trees className="h-3.5 w-3.5" />} label="Parque más cercano" value={`${n.dist_parque.toFixed(1)} km`} />
              <ConnRow icon={<ShoppingBag className="h-3.5 w-3.5" />} label="Mall más cercano" value={`${n.dist_mall.toFixed(1)} km`} />
            </>
          )}
        </div>
      </Section>

      {goal === "airbnb" && n.airbnb_data && <AirbnbSection n={n} />}
      {goal === "airbnb" && n.amenidades && <AmenadidsSection n={n} />}

      {goal === "mediano_plazo" && <NomadaSection n={n} />}

      <SeguridadSection n={n} />
      <VerdeSection n={n} maxVerdePct={maxVerdePct} />
      <TraficoSection n={n} />
      <UsoSueloSection n={n} />
      <LiquiditySection n={n} />

      <ValorizacionSection n={n} />

      <SaludFinancieraSection n={n} />

      <OpportunityBanner n={n} />

      <div className="flex flex-col gap-2">
        <Link
          to="/simulador"
          search={{ barrio: n.id }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-gradient-to-r from-primary to-accent py-2.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 glow-cyan"
        >
          <Calculator className="h-3.5 w-3.5" />
          Simular inversión aquí <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <CatastroSection n={n} />
      <MercadoRealSection n={n} />
    </div>
  );
}

/* ------------- Renta media section ------------- */

function demandaIndexColor(idx: number | null | undefined): string {
  if (idx == null) return "#5B5F5C";
  if (idx >= 70) return "#0F8A4F";
  if (idx >= 40) return "#F2B807";
  return "#CE1126";
}

function NomadaSection({ n }: { n: Neighborhood }) {
  const idx = n.indice_nomada;
  const idxColor = demandaIndexColor(idx);
  const idxLabel = idx == null ? "Sin datos" : idx >= 70 ? "ALTA" : idx >= 40 ? "MEDIA" : "BAJA";

  // Renta media
  const rentaMedia = n.precio_renta_media_p50;
  const arriendo = n.arriendo;
  const rentaDisplay = rentaMedia ?? (arriendo > 0 ? Math.round(arriendo * 1.4) : null);
  const rentaEstimada = !rentaMedia && rentaDisplay != null;
  const premiumPct = n.premium_vs_largo_pct != null
    ? Math.round(n.premium_vs_largo_pct)
    : (arriendo > 0 && rentaDisplay
        ? Math.round(((rentaDisplay - arriendo) / arriendo) * 100)
        : null);
  const yieldMedia = n.yield_renta_media_pct;
  const yieldLargo = n.yield;

  // PBN
  const estadoPrecio = n.estado_precio;
  const pbnJusto = n.pbn_precio_justo;

  // Score breakdown (new weights: yield 45, demanda 20, pbn 25, seg 10)
  const bd: NomadaBreakdown | null | undefined = n.nomada_breakdown;
  const totalScore = bd
    ? (bd.pts_yield ?? 0) + (bd.pts_nomada ?? 0) + (bd.pts_pbn ?? 0) + (bd.pts_seguridad ?? 0)
    : null;

  const PBN_COLORS: Record<string, string> = {
    BAJO: "#0F8A4F",
    NORMAL: "#0F8A4F",
    SOBRE: "#CE1126",
  };
  const pbnColor = estadoPrecio ? (PBN_COLORS[estadoPrecio] ?? "#5B5F5C") : "#5B5F5C";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-primary">
          <Briefcase className="h-3 w-3" /> Perfil Renta Media
        </div>
        <p className="text-xs text-muted-foreground">
          Arriendos de 1 a 6 meses · Ejecutivos y profesionales en movilidad.
        </p>
      </div>

      {/* 1. Demanda de zona */}
      <Section title="📍 Demanda de la zona">
        {idx != null && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-3 rounded-xl border p-3"
            style={{ borderColor: `${idxColor}66`, background: `${idxColor}10` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: idxColor }}>
                Demanda de zona: {Math.round(idx)}/100
              </span>
              <span
                className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ background: `${idxColor}22`, color: idxColor }}
              >
                {idxLabel}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, idx)}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{ background: idxColor }}
              />
            </div>
          </motion.div>
        )}
        <div className="mt-3 rounded-lg border border-border bg-white/60 p-3 text-xs leading-relaxed text-muted-foreground">
          {(idx ?? 0) >= 70 ? (
            "✅ Alta demanda de renta media. Cafés, coworking y servicios consolidados. Zona con flujo sostenido de ejecutivos y profesionales remotos."
          ) : (idx ?? 0) >= 40 ? (
            "⚡ Demanda de zona moderada. Infraestructura disponible. Potencial creciente para arriendos de 1 a 6 meses."
          ) : (
            "⚠️ Demanda limitada en esta zona. Considera zonas con mayor densidad de servicios para renta media."
          )}
        </div>
      </Section>

      {/* 2. Rendimiento estimado */}
      <Section title="💰 Rendimiento estimado">
        <div className="rounded-xl border border-border bg-white/60 p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Arriendo tradicional:</span>
            <span>{formatCOP(arriendo)}/mes</span>
          </div>
          {rentaDisplay != null && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Renta media estimada:{rentaEstimada && <span className="ml-0.5 text-warning">*</span>}
                </span>
                <span className="text-success font-semibold">{formatCOP(rentaDisplay)}/mes</span>
              </div>
              {premiumPct != null && premiumPct > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premium vs largo plazo:</span>
                  <span className="text-success font-semibold">+{premiumPct}% más</span>
                </div>
              )}
            </>
          )}
          <hr className="border-border" />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Yield renta media:</span>
            <span className="font-semibold" style={{ color: yieldColor(yieldMedia ?? 0) }}>
              {yieldMedia != null ? `${yieldMedia.toFixed(1)}%` : "Sin datos"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Yield largo plazo (ref):</span>
            <span className="text-muted-foreground">{yieldLargo != null ? `${yieldLargo.toFixed(1)}%` : "Sin datos"}</span>
          </div>
        </div>
        {rentaEstimada && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            * Estimado. Sin datos directos de renta media — proyectado como arriendo × 1.4.
          </p>
        )}
      </Section>

      {/* 3. Precio justo PBN */}
      {estadoPrecio && (
        <Section title="📊 Precio justo (PBN)">
          <div
            className="rounded-xl border p-3"
            style={{ borderColor: `${pbnColor}66`, background: `${pbnColor}10` }}
          >
            <div className="flex items-center justify-between">
              <span
                className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ background: `${pbnColor}22`, color: pbnColor }}
              >
                {estadoPrecio}
              </span>
              {pbnJusto && (
                <span className="text-xs text-muted-foreground">
                  PBN justo: <span className="font-semibold text-foreground">{formatCOP(pbnJusto)}/m²</span>
                </span>
              )}
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="text-muted-foreground">Precio actual:</span>
              <span className="font-semibold">{formatCOP(n.precio_m2)}/m²</span>
            </div>
          </div>
        </Section>
      )}

      {/* 4. Score breakdown (new weights) */}
      {bd && totalScore != null && (
        <Section title="🎯 ¿Por qué este score?">
          <div className="rounded-xl border border-border bg-white/60 p-3 text-xs space-y-1.5">
            <ScoreRow label="Yield renta media" pts={bd.pts_yield} max={45} highlight />
            <ScoreRow label="Precio justo (PBN)" pts={bd.pts_pbn} max={25} />
            <ScoreRow label="Demanda de zona" pts={bd.pts_nomada} max={20} />
            <ScoreRow label="Seguridad percibida" pts={bd.pts_seguridad} max={10} />
            <hr className="border-border" />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="text-primary">{totalScore}/100</span>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function ScoreRow({ label, pts, max, highlight }: { label: string; pts: number | null | undefined; max: number; highlight?: boolean }) {
  const val = pts ?? 0;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-muted-foreground ${highlight ? "font-medium text-foreground/80" : ""}`}>{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="h-1 w-16 overflow-hidden rounded-full bg-background/60">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${(val / max) * 100}%`,
              background: highlight ? "#0F8A4F" : "#003893",
            }}
          />
        </div>
        <span className={`w-10 text-right ${highlight ? "font-semibold text-primary" : ""}`}>
          {pts != null ? `${pts}/${max}` : `—/${max}`}
        </span>
      </div>
    </div>
  );
}

/* ------------- Airbnb rendimiento ------------- */

function AirbnbSection({ n }: { n: Neighborhood }) {
  const ab = n.airbnb_data!;
  const fewData = (ab.n_listings ?? 0) < 5;
  const yieldReal = ab.yield_airbnb_real_pct;
  const yieldEst = ab.yield_airbnb_pct;
  const yieldMostrar = yieldReal ?? yieldEst;
  const esReal = yieldReal != null;
  const gapGrande =
    yieldReal != null && yieldEst != null && Math.abs(yieldEst - yieldReal) > 2;

  return (
    <Section title="📊 Rendimiento Airbnb">
      {fewData && (
        <p className="mb-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          ⚠️ Pocos datos Airbnb en esta zona ({ab.n_listings ?? 0} listings)
        </p>
      )}
      <div className="rounded-xl border border-border bg-white/60 p-3 text-xs space-y-2.5">

        {/* Yield con badge */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Yield Airbnb:</span>
          <div className="flex items-center gap-2">
            <span
              className="font-semibold text-sm"
              style={{ color: yieldMostrar != null ? yieldColor(yieldMostrar) : undefined }}
            >
              {yieldMostrar != null ? `${yieldMostrar.toFixed(1)}%` : "Sin datos"}
            </span>
            {esReal ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                ✅ Dato real AirROI
              </span>
            ) : yieldEst != null ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-warning/15 text-warning border border-warning/30">
                ⚠️ Estimado
              </span>
            ) : null}
          </div>
        </div>

        {/* Gap warning */}
        {gapGrande && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning leading-snug">
            ⚠️ El yield real ({yieldReal!.toFixed(1)}%) es menor al estimado ({yieldEst!.toFixed(1)}%). Los datos de AirROI son más precisos.
          </p>
        )}

        {/* Ocupación con percentiles */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Ocupación</div>
          {ab.ocupacion_p25_pct != null && ab.ocupacion_p75_pct != null ? (
            <div className="text-center font-semibold text-primary text-sm">
              {ab.ocupacion_p25_pct.toFixed(0)}% — {ab.ocupacion_pct != null ? `${ab.ocupacion_pct.toFixed(0)}%` : "—"} — {ab.ocupacion_p75_pct.toFixed(0)}%
              <div className="text-[10px] font-normal text-muted-foreground mt-0.5">p25 · mediana · p75</div>
            </div>
          ) : ab.ocupacion_pct != null ? (
            <div className="text-center font-semibold text-primary text-sm">{ab.ocupacion_pct.toFixed(0)}%</div>
          ) : (
            <div className="text-center text-muted-foreground text-[11px]">Sin datos reales de ocupación en esta zona</div>
          )}
        </div>

        {/* ADR */}
        {ab.adr_cop != null && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Precio por noche:</span>
            <span className="font-semibold">{formatCOP(ab.adr_cop)}</span>
          </div>
        )}

        {/* Ingresos anuales */}
        {ab.ingresos_anuales_p50_cop != null && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Ingresos anuales estimados:</span>
            <span className="font-semibold text-emerald-400">
              {formatCOP(ab.ingresos_anuales_p50_cop)}
            </span>
          </div>
        )}

        {/* Rating */}
        {ab.rating_promedio != null && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Calidad:</span>
            <span className="font-medium">
              ⭐ {ab.rating_promedio.toFixed(2)}
              {ab.reviews_promedio != null && (
                <span className="text-muted-foreground"> · {Math.round(ab.reviews_promedio)} reseñas</span>
              )}
            </span>
          </div>
        )}

        {/* Room types */}
        {(ab.n_entire_home != null || ab.n_private_room != null) && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Tipo de anuncio:</span>
            <span className="text-right">
              {ab.n_entire_home != null && <span>{ab.n_entire_home} casa entera</span>}
              {ab.n_entire_home != null && ab.n_private_room != null && <span className="text-muted-foreground"> · </span>}
              {ab.n_private_room != null && <span>{ab.n_private_room} hab. privada</span>}
            </span>
          </div>
        )}

        {ab.n_listings != null && (
          <div className="text-[10px] text-right text-muted-foreground">
            Basado en {ab.n_listings} listings activos
          </div>
        )}
      </div>
    </Section>
  );
}

/* ------------- Amenidades Airbnb ------------- */

function AmeBar({ label, pct }: { label: string; pct: number | null }) {
  const val = pct ?? 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground text-[11px]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/60 transition-all"
          style={{ width: `${Math.min(val, 100)}%` }}
        />
      </div>
      <span className="w-8 text-right shrink-0 font-medium">{val.toFixed(0)}%</span>
    </div>
  );
}

function AmenadidsSection({ n }: { n: Neighborhood }) {
  const am = n.amenidades!;
  return (
    <Section title="🏠 Amenidades del mercado">
      <div className="rounded-xl border border-border bg-white/60 p-3 text-xs space-y-2">
        <p className="text-[11px] text-muted-foreground mb-2">% de propiedades en la zona con:</p>
        <AmeBar label="WiFi" pct={am.pct_wifi != null ? am.pct_wifi * 100 : null} />
        <AmeBar label="AC" pct={am.pct_ac != null ? am.pct_ac * 100 : null} />
        <AmeBar label="Cocina" pct={am.pct_kitchen != null ? am.pct_kitchen * 100 : null} />
        <AmeBar label="Lavadora" pct={am.pct_washer != null ? am.pct_washer * 100 : null} />
        {am.score_equipamiento != null && (
          <div className="flex justify-between items-center pt-1 border-t border-border">
            <span className="text-muted-foreground">Score equipamiento:</span>
            <span className="font-semibold">{am.score_equipamiento}/100</span>
          </div>
        )}
        {am.n_listings_base != null && (
          <div className="text-[10px] text-right text-muted-foreground">
            Basado en {am.n_listings_base} listings de Airbnb en la zona
          </div>
        )}
      </div>
    </Section>
  );
}

/* ------------- Seguridad ------------- */

function SeguridadSection({ n }: { n: Neighborhood }) {
  const cat = n.seguridad_categoria ?? "SIN DATOS";
  const score = n.seguridad_score;
  const nota = n.seguridad_nota;
  const color = SEGURIDAD_COLORS[cat] ?? SEGURIDAD_COLORS["SIN DATOS"];
  if (score === null || score === undefined) return null;

  const tend = n.seguridad_tendencia;
  const tendInfo = tend
    ? tend.toLowerCase().includes("mejor")
      ? { label: "↑ Mejorando", color: "#0F8A4F" }
      : tend.toLowerCase().includes("empeor")
      ? { label: "↓ Empeorando", color: "#CE1126" }
      : { label: "→ Estable", color: "#8A8E8A" }
    : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        <Shield className="h-3 w-3 text-primary" /> Seguridad
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border p-3"
        style={{ borderColor: `${color}66`, background: `${color}10` }}
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: `${color}22`, color }}>
            {cat}
          </span>
          <div className="flex items-center gap-2">
            {tendInfo && (
              <span className="text-[11px] font-semibold" style={{ color: tendInfo.color }}>
                {tendInfo.label}
              </span>
            )}
            <span className="text-[11px] font-semibold" style={{ color }}>{score}/100</span>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
          <motion.div initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.8, ease: "easeOut" }} className="h-full rounded-full" style={{ background: color }} />
        </div>
        {nota && <p className="mt-2 text-[11px] text-muted-foreground">{nota}</p>}
      </motion.div>
    </div>
  );
}

/* ------------- Índice verde ------------- */

function VerdeSection({ n, maxVerdePct }: { n: Neighborhood; maxVerdePct: number }) {
  const pct = n.verde_pct;
  const cat = n.verde_categoria ?? "SIN DATOS";
  if (pct === null || pct === undefined) return null;
  const ratio = Math.min(1, pct / maxVerdePct);
  const color = verdeColor(ratio);
  const barWidth = `${(ratio * 100).toFixed(1)}%`;
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        <Leaf className="h-3 w-3 text-success" /> Índice verde
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border p-3"
        style={{ borderColor: `${color}66`, background: `${color}10` }}
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: `${color}22`, color }}>
            {cat}
          </span>
          <span className="text-[11px] font-semibold" style={{ color }}>{pct.toFixed(1)}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: barWidth }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full rounded-full"
            style={{ background: color }}
          />
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          Comparado con la zona más verde del Valle de Aburrá
        </div>
      </motion.div>
    </div>
  );
}

/* ------------- Tráfico ------------- */

function fmtHora(h: number): string {
  const ampm = h < 12 || h === 24 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

function TraficoSection({ n }: { n: Neighborhood }) {
  const nivel = n.trafico_nivel;
  const jam = n.trafico_jam;
  if (nivel == null) return null;
  const color = TRAFICO_COLORS[nivel] ?? TRAFICO_COLORS["medio"];
  const barWidth = jam != null ? `${Math.min(100, (jam / 10) * 100).toFixed(0)}%` : "0%";
  const picos = [n.trafico_pico_am, n.trafico_pico_pm].filter((p): p is [number, number] => p != null);

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        <Car className="h-3 w-3 text-primary" /> Tráfico
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border p-3"
        style={{ borderColor: `${color}66`, background: `${color}10` }}
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: `${color}22`, color }}>
            {nivel}
          </span>
          {jam != null && (
            <span className="text-[11px] font-semibold" style={{ color }}>{jam.toFixed(1)}/10</span>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
          <motion.div initial={{ width: 0 }} animate={{ width: barWidth }} transition={{ duration: 0.8, ease: "easeOut" }} className="h-full rounded-full" style={{ background: color }} />
        </div>
        {picos.length > 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Hora pico: {picos.map((p) => `${fmtHora(p[0])}–${fmtHora(p[1])}`).join(" y ")}
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* ------------- Uso de suelo (POT) ------------- */

function UsoSueloSection({ n }: { n: Neighborhood }) {
  const categoria = n.uso_suelo_dominante;
  const score = n.uso_suelo_score;
  if (categoria == null) return null;
  const color = USO_SUELO_COLORS[categoria] ?? "#5B5F5C";
  const barWidth = score != null ? `${Math.min(100, score).toFixed(0)}%` : "0%";

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        <Building2 className="h-3 w-3 text-primary" /> Uso de suelo (POT)
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border p-3"
        style={{ borderColor: `${color}66`, background: `${color}10` }}
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: `${color}22`, color }}>
            {categoria}
          </span>
          {score != null && (
            <span className="text-[11px] font-semibold" style={{ color }}>{score}/100</span>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
          <motion.div initial={{ width: 0 }} animate={{ width: barWidth }} transition={{ duration: 0.8, ease: "easeOut" }} className="h-full rounded-full" style={{ background: color }} />
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          Plan de Ordenamiento Territorial de Medellín — solo disponible dentro del municipio
        </div>
      </motion.div>
    </div>
  );
}

/* ------------- Salud financiera ------------- */

function SaludFinancieraSection({ n }: { n: Neighborhood }) {
  const remates = n.n_remates_municipio ?? 0;
  const cat = remates === 0 ? "MUY SALUDABLE" : remates <= 3 ? "SALUDABLE" : remates <= 8 ? "PRECAUCIÓN" : "ALERTA";
  const color = SALUD_COLORS[cat] ?? "#5B5F5C";
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        🏦 Salud financiera
      </div>
      <div className="rounded-xl border p-3" style={{ borderColor: `${color}66`, background: `${color}10` }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: `${color}22`, color }}>
            {cat}
          </span>
          <span className="text-xs text-muted-foreground">
            {remates === 0
              ? "Sin remates activos ✅"
              : `${remates} remate${remates !== 1 ? "s" : ""} activo${remates !== 1 ? "s" : ""} en ${n.municipio}`}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">Fuente: avisos judiciales públicos</p>
    </div>
  );
}

/* ------------- Catastro ------------- */

// Thresholds sobre ratio_vs_ciudad (ratio barrio / mediana Medellín = 58.8x)
const RATIO_VS_CIUDAD_BADGE: Array<{ min: number; label: string; color: string }> = [
  { min: 3.0, label: "BRECHA MUY ALTA",  color: "#CE1126" },
  { min: 1.5, label: "BRECHA ALTA",      color: "#F2B807" },
  { min: 0.7, label: "BRECHA NORMAL",    color: "#0F8A4F" },
  { min: 0,   label: "BRECHA BAJA",      color: "#0F8A4F" },
];

function CatastroSection({ n }: { n: Neighborhood }) {
  const cat = n.catastro_comuna;
  if (!cat || cat.total_predios == null) return null;

  const ratio = cat.ratio_mercado_catastro;
  const rvc = cat.ratio_vs_ciudad;
  const badge = rvc != null
    ? RATIO_VS_CIUDAD_BADGE.find((b) => rvc >= b.min) ?? RATIO_VS_CIUDAD_BADGE[RATIO_VS_CIUDAD_BADGE.length - 1]
    : null;

  return (
    <Section title={`🏛️ Catastro · ${n.comuna}`}>
      <div className="rounded-xl border border-border bg-white/60 p-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total predios</div>
            <div className="mt-0.5 font-semibold">{formatNumber(cat.total_predios)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">% Apartamentos</div>
            <div className="mt-0.5 font-semibold">
              {cat.pct_apartamento != null ? `${cat.pct_apartamento}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Área mediana apto</div>
            <div className="mt-0.5 font-semibold">
              {cat.area_mediana_apto_m2 != null ? `${cat.area_mediana_apto_m2} m²` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ratio mercado/catastro</div>
            <div className="mt-0.5 font-semibold">{ratio != null ? `${ratio}x` : "—"}</div>
          </div>
        </div>
        {badge && rvc != null && (
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: `${badge.color}22`, color: badge.color }}
            >
              {badge.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {rvc.toFixed(1)}x la mediana de Medellín
            </span>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Brecha mercado/catastro vs. mediana ciudad · Medellín 2026
      </p>
    </Section>
  );
}

/* ------------- Mercado real (compraventas SNR/ORIPS) ------------- */

function MercadoRealSection({ n }: { n: Neighborhood }) {
  const mr = n.mercado_real;
  if (!mr || mr.anio_dato == null) return null;

  const color = mr.clasificacion_mercado ? MERCADO_REAL_COLORS[mr.clasificacion_mercado] ?? "#5B5F5C" : "#5B5F5C";
  const clasifLabel = mr.clasificacion_mercado === "vendedor" ? "Mercado de vendedor"
    : mr.clasificacion_mercado === "comprador" ? "Mercado de comprador"
    : mr.clasificacion_mercado === "balanceado" ? "Mercado balanceado"
    : null;

  return (
    <Section title={`🏛️ Mercado real · ${n.municipio}`}>
      <div className="rounded-xl border border-border bg-white/60 p-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ventas cerradas {mr.anio_dato}</div>
            <div className="mt-0.5 font-semibold">{mr.n_transacciones_anual != null ? formatNumber(mr.n_transacciones_anual) : "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor mediana cierre</div>
            <div className="mt-0.5 font-semibold">
              {mr.valor_mediana_anual != null ? formatCOP(mr.valor_mediana_anual) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Variación anual</div>
            <div className="mt-0.5 font-semibold">
              {mr.var_anual_pct != null ? `${mr.var_anual_pct > 0 ? "+" : ""}${mr.var_anual_pct}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Meses de inventario</div>
            <div className="mt-0.5 font-semibold">{mr.meses_inventario != null ? `${mr.meses_inventario} meses` : "—"}</div>
          </div>
        </div>
        {clasifLabel && (
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
              style={{ background: `${color}22`, color }}
            >
              {clasifLabel}
            </span>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Fuente: registro notarial SNR/ORIPS, nivel municipio (no barrio) — {mr.n_transacciones_anual != null ? formatNumber(mr.n_transacciones_anual) : "—"} transacciones reales de {n.municipio} en {mr.anio_dato}.
        {mr.ipvn_dane_pct != null && ` Índice DANE nacional del mismo año: ${mr.ipvn_dane_pct > 0 ? "+" : ""}${mr.ipvn_dane_pct}% (referencia, no aplicado como ajuste).`}
        {" "}Valor absoluto, no controla mezcla de tipo/tamaño de inmueble.
      </p>
    </Section>
  );
}

/* ------------- Valorización ------------- */

const TEND_MAP: Record<string, { label: string; color: string }> = {
  aceler:    { label: "↑ Acelerando",    color: "#0F8A4F" },
  estable:   { label: "→ Estable",       color: "#0F8A4F" },
  desacel:   { label: "↓ Desacelerando", color: "#F2B807" },
};

function tendBadge(tendencia: string | null | undefined): { label: string; color: string } | null {
  if (!tendencia) return null;
  const t = tendencia.toLowerCase();
  if (t.includes("aceler") && !t.includes("desacel")) return TEND_MAP.aceler;
  if (t.includes("desacel")) return TEND_MAP.desacel;
  if (t.includes("estable")) return TEND_MAP.estable;
  return null;
}

function ValorizacionSection({ n }: { n: Neighborhood }) {
  const api = n.valorizacion_api;
  const fallback = calcValorizStats(n.estrato);
  const isReal = api?.var_anual_pct != null;

  const varAnual = api?.var_anual_pct ?? fallback.ultimoAnio;
  const proy5 = api?.proyeccion_5anos_pct != null ? Math.round(api.proyeccion_5anos_pct) : fallback.proj5;
  const proy3 = api?.proyeccion_3anos_pct;
  const badge = tendBadge(api?.tendencia);

  return (
    <Section title="📈 Valorización histórica">
      <div className="rounded-xl border border-border bg-white/60 p-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center">
            <div className="font-display text-xl font-bold text-primary">
              +{isReal ? varAnual.toFixed(1) : Math.round(varAnual)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">último año</div>
          </div>
          <div className="text-center">
            {proy3 != null ? (
              <>
                <div className="font-display text-xl font-bold text-success">+{Math.round(proy3)}%</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">proy. 3 años</div>
              </>
            ) : (
              <>
                <div className="font-display text-xl font-bold text-success">+{fallback.acumulado}%</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">desde 2015</div>
              </>
            )}
          </div>
        </div>
        <div className="border-t border-border pt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Proyección 5 años:{" "}
            <span className="font-semibold text-foreground">+{proy5}%</span>
          </span>
          {badge && (
            <span
              className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: badge.color, background: `${badge.color}20` }}
            >
              {badge.label}
            </span>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {isReal
          ? "Fuente: datos reales del barrio"
          : `Fuente: DANE IPVN · Ajustado por estrato ${n.estrato}`}
      </p>
    </Section>
  );
}

/* ------------- Listings view ------------- */

function ListingCard({ l }: { l: ApiListing }) {
  const mc = l.relevancia_score != null ? matchColor(l.relevancia_score) : null;
  const { formatPrice, formatSecondary, formatPricePerArea } = usePriceFormat();
  const cop = l.precio_cop ?? 0;
  const primary = formatPrice(cop);
  const secondary = formatSecondary(cop);
  return (
    <div style={{ borderRadius: 10, border: '1px solid rgb(184 164 138 / 55%)', background: 'rgba(255,255,255,0.6)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#0A5C36', fontWeight: 700 }}>
            {l.tipo_inmueble ?? "—"} · {l.tipo_operacion ?? "—"}
          </div>
          <div data-i18n-skip="true" style={{ marginTop: 4, fontWeight: 800, fontSize: '1rem', color: '#111418' }}>
            {primary}
          </div>
          {secondary && <div data-i18n-skip="true" style={{ fontSize: 11, color: '#5B5F5C' }}>{secondary}</div>}
          <div style={{ marginTop: 2, fontSize: 12, color: '#33473D' }}>
            {l.area_m2 != null ? `${l.area_m2} m²` : "—"}
            {l.habitaciones != null ? ` · ${l.habitaciones === 0 ? "Studio" : `${l.habitaciones} hab`}` : ""}
            {l.banos != null ? ` · ${l.banos} baños` : ""}
          </div>
          {l.direccion_raw && (
            <div style={{ marginTop: 2, fontSize: 10, color: '#5B5F5C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.direccion_raw}
            </div>
          )}
          {l.match_razones && l.match_razones.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {l.match_razones.map((r, i) => (
                <span key={i} style={{ borderRadius: 4, background: 'rgba(8,80,65,0.08)', border: '1px solid rgba(8,80,65,0.18)', padding: '2px 6px', fontSize: 10, color: '#0A5C36', fontWeight: 600 }}>
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          {mc != null && l.match_label && (
            <span style={{ borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', backgroundColor: mc + "25", color: mc }}>
              {l.match_label}
            </span>
          )}
          {l.buena_oferta && (
            <span style={{ borderRadius: 6, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', padding: '3px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#0F8A4F' }}>
              Buena oferta
            </span>
          )}
          {l.precio_m2 != null && (
            <div style={{ fontSize: 11, color: '#33473D', fontWeight: 600 }}>{formatPricePerArea(l.precio_m2)}</div>
          )}
          {l.url && (
            <a href={l.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#0F8A4F', fontWeight: 700, textDecoration: 'none' }}>
              Ver →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ListingsView({
  n,
  onBack,
  perfil,
  risk,
}: {
  n: Neighborhood;
  onBack: () => void;
  perfil?: string;
  risk?: string;
}) {
  const { formatPrice: fmtP } = usePriceFormat();
  const defaultOp: "venta" | "arriendo" = perfil === "mediano_plazo" ? "arriendo" : "venta";
  const [op, setOp] = useState<"venta" | "arriendo">(defaultOp);
  const [precioMax, setPrecioMax] = useState<number | null>(null);
  const [areaMin, setAreaMin] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("relevancia");

  // Server-side op filter — avoids client-side case-mismatch, separate cached query per tab
  const { data: listingsData, isLoading, isFetching } = useListings(n.id, 100, 0, op);
  const listings = listingsData?.listings ?? [];
  const isPersonalized = listings.length > 0 && listings[0].relevancia_score != null;

  const maxPrecioData = listings.reduce((m, l) => Math.max(m, l.precio_cop ?? 0), 0);
  const maxAreaData = Math.ceil(listings.reduce((m, l) => Math.max(m, l.area_m2 ?? 0), 50) / 10) * 10;
  const sliderPrecio = precioMax ?? maxPrecioData;

  // Reset filters and sort on tab change
  useEffect(() => {
    setPrecioMax(null);
    setAreaMin(0);
    setSortKey("relevancia");
  }, [op]);

  const filtered = sortListings(
    listings.filter(
      (l) =>
        (precioMax === null || (l.precio_cop ?? 0) <= precioMax) &&
        (l.area_m2 ?? 0) >= areaMin,
    ),
    sortKey,
  );

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground transition hover:text-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Volver al barrio
      </button>

      <div>
        <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0F8A4F', margin: '0 0 4px' }}>Listings</p>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: '1.4rem', fontWeight: 900, color: '#111418', margin: 0, letterSpacing: '-0.5px', lineHeight: 1.1 }}>
          {titleCase(n.nombre)}
        </h2>
        <p style={{ marginTop: 3, fontSize: 11, color: '#33473D' }}>
          {isLoading
            ? "Cargando…"
            : `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""}${listingsData ? ` de ${listingsData.total} en ${op}` : ""}`}
        </p>
      </div>

      <div className="inline-flex rounded-md border border-border p-0.5">
        {(["venta", "arriendo"] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOp(o)}
            className={`rounded px-3 py-1 text-xs font-medium uppercase tracking-wider transition ${op === o ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {o}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <FilterRow
          label={
            isLoading
              ? "Precio máx · cargando…"
              : maxPrecioData > 0
              ? `Precio máx · ${fmtP(sliderPrecio)}`
              : "Precio máx · sin datos"
          }
          onReset={precioMax !== null ? () => setPrecioMax(null) : undefined}
        >
          <input
            type="range"
            min={0}
            max={maxPrecioData || 1}
            step={Math.max(5_000_000, Math.round(maxPrecioData / 50))}
            value={sliderPrecio}
            disabled={isLoading || maxPrecioData === 0}
            onChange={(e) => setPrecioMax(Number(e.target.value))}
            className="w-full accent-[#0F8A4F] disabled:opacity-40"
          />
        </FilterRow>
        <FilterRow
          label={`Área mín · ${areaMin} m²`}
          onReset={areaMin > 0 ? () => setAreaMin(0) : undefined}
        >
          <input
            type="range"
            min={0}
            max={maxAreaData || 200}
            step={5}
            value={areaMin}
            disabled={isLoading}
            onChange={(e) => setAreaMin(Number(e.target.value))}
            className="w-full accent-[#0F8A4F] disabled:opacity-40"
          />
        </FilterRow>
      </div>

      {isPersonalized && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-primary/80 font-medium tracking-wide">
            Ordenado por relevancia para tu perfil
          </span>
          <div className="inline-flex gap-0.5 rounded border border-border p-0.5">
            {([["relevancia", "Match"], ["precio_asc", "Precio ↑"], ["precio_desc", "Precio ↓"], ["area", "m²"]] as [SortKey, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition ${sortKey === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(isLoading || isFetching) && (
        <div className="h-1 w-full animate-pulse rounded-full bg-primary/20" />
      )}

      <div className="space-y-2">
        {filtered.map((l) => <ListingCard key={l.id} l={l} />)}
        {!isLoading && filtered.length === 0 && listings.length > 0 && (
          <div style={{ borderRadius: 8, border: '1px dashed rgb(184 164 138 / 70%)', padding: '24px', textAlign: 'center', fontSize: 12, color: '#33473D' }}>
            No hay listings con estos filtros.
          </div>
        )}
        {!isLoading && listings.length === 0 && (
          <div style={{ borderRadius: 8, border: '1px dashed rgb(184 164 138 / 70%)', padding: '24px', textAlign: 'center', fontSize: 12, color: '#33473D' }}>
            No hay listings de {op} disponibles.
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------- Atoms ------------- */

function Metric({ label, value, accent }: { label: string; value: string; accent?: "cyan" | "green" }) {
  return (
    <div style={{ borderRadius: 12, border: '1px solid rgb(184 164 138 / 55%)', background: 'rgba(255,255,255,0.55)', padding: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#5B5F5C', fontWeight: 600 }}>{label}</div>
      <div style={{
        marginTop: 4, fontSize: '1rem', fontWeight: 700,
        color: accent === 'cyan' ? '#0F8A4F' : accent === 'green' ? '#0F8A4F' : '#111418',
      }}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#5B5F5C' }}>{title}</div>
      {children}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={
        color
          ? { display: 'inline-flex', alignItems: 'center', borderRadius: 6, border: `1px solid ${color}66`, padding: '2px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color, background: `${color}18` }
          : { display: 'inline-flex', alignItems: 'center', borderRadius: 6, border: '1px solid rgb(184 164 138 / 60%)', padding: '2px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#4a3b2a', background: 'rgba(0,0,0,0.05)' }
      }
    >
      {children}
    </span>
  );
}

function ConnRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8, border: '1px solid rgb(184 164 138 / 50%)', background: 'rgba(255,255,255,0.5)', padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#5B5F5C' }}>
        <span style={{ color: '#0F8A4F' }}>{icon}</span> {label}
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#111418' }}>{value}</span>
    </div>
  );
}

function FilterRow({ label, children, onReset }: { label: string; children: React.ReactNode; onReset?: () => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span style={{ fontSize: 11, color: '#33473D', fontWeight: 600 }}>{label}</span>
        {onReset && (
          <button onClick={onReset} className="text-[10px] text-primary hover:underline">
            resetear
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

const tooltipStyle: React.CSSProperties = {
  background: "rgba(17,24,39,0.95)",
  border: "1px solid rgba(29,158,117,0.4)",
  borderRadius: 8,
  fontSize: 11,
  color: "#f9fafb",
};

/* ------------- Liquidity / Opportunity ------------- */

function LiquiditySection({ n }: { n: Neighborhood }) {
  const apiLiq = n.liquidez_api;
  const cat = (apiLiq?.categoria ?? "MEDIA") as import("@/data/marketActivity").LiquidityCat;
  const colors = LIQUIDITY_COLORS[cat] ?? LIQUIDITY_COLORS["MEDIA"];
  const score = apiLiq?.score ?? 50;
  const tiempoEstimado = apiLiq?.tiempo_estimado_venta ?? "—";
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          <Activity className="h-3 w-3 text-primary" /> 💧 Actividad de Mercado
        </div>
        <button
          onClick={() => setShowInfo(true)}
          className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground transition hover:bg-background/60 hover:text-primary"
          title="¿Cómo calculamos esto?"
        >
          <Info className="h-3 w-3" />
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border p-3"
        style={{ borderColor: colors.border, background: colors.bg }}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.border }}>
            {cat}
          </div>
          <div className="text-[11px] font-semibold" style={{ color: colors.border }}>
            {score}/100
          </div>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Tiempo estimado: <span className="text-foreground">{tiempoEstimado}</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full rounded-full"
            style={{ background: colors.border }}
          />
        </div>
      </motion.div>

      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground/80">
        Basado en volumen de mercado activo. Liquidez real disponible próximamente con datos de transacciones oficiales.
      </p>

      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowInfo(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6"
            >
              <button
                onClick={() => setShowInfo(false)}
                className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              <h3 className="font-display text-lg font-semibold">¿Cómo calculamos esto?</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Este índice mide la actividad del mercado inmobiliario basado en:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>• Tiempo de publicación de listings activos</li>
                <li>• Volumen de propiedades en venta</li>
                <li>• Interés de la zona (demanda Airbnb)</li>
              </ul>
              <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                📌 <span className="text-foreground">Próximamente:</span> integraremos datos reales de transacciones de la
                Superintendencia de Notariado y Registro para mostrar tiempo real de venta por barrio.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const OPP_EMOJIS: Record<string, string> = {
  "PRECIO BAJO MERCADO": "🎯",
  "ALTO RENDIMIENTO": "📈",
  "INVERSIÓN SEGURA": "🛡️",
};

function OpportunityBanner({ n }: { n: Neighborhood }) {
  const apiOpp = n.oportunidad;
  if (!apiOpp?.detectada) return null;
  const tipo = (apiOpp.tipo ?? "ALTO RENDIMIENTO").toUpperCase();
  const color = OPP_COLORS[tipo as keyof typeof OPP_COLORS] ?? "#0A5C36";
  const emoji = OPP_EMOJIS[tipo] ?? "📊";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border p-3"
      style={{ borderColor: color, background: `${color}15` }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color }}>
        <Target className="h-3 w-3" /> {emoji} Oportunidad detectada
      </div>
      <div className="mt-1 text-sm font-semibold" style={{ color }}>
        {tipo}
      </div>
      {apiOpp.descripcion && (
        <p className="mt-1 text-xs leading-relaxed text-foreground/90">"<AutoTranslate text={apiOpp.descripcion} />"</p>
      )}
    </motion.div>
  );
}

