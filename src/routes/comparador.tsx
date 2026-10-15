import { seo } from "@/lib/seo";
import { createFileRoute, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ArrowLeft, Lock, Plus, X, ChevronDown, ChevronUp,
  Trophy, MapPin, Clock, Trash2, Home, Building2, BarChart2,
} from "@/lib/icons";
import { MapNavbar } from "@/components/MapNavbar";
import { formatCOP, formatPct, yieldColor } from "@/lib/format";
import { useBarriosRaw, useCompararRaw } from "@/hooks/useBarrios";
import { barrioToNeighborhood } from "@/lib/adapters";
import { auth } from "@/lib/auth";
import { useIsPro, useIsAgente } from "@/components/LockedField";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { useComparadorStore } from "@/hooks/useComparadorStore";
import type { ApiBarrio } from "@/lib/adapters";
import type { ApiListing } from "@/lib/adapters";
import { toast } from "sonner";

// ─── Route ────────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  tab: z.enum(["barrios", "inmuebles"]).optional(),
  listings: z.string().optional(), // comma-separated IDs
});

export const Route = createFileRoute("/comparador")({
  head: () => seo({ title: "Comparador · Medellin Social", description: "Compara barrios o inmuebles específicos lado a lado.", path: "/comparador" }),
  validateSearch: searchSchema,
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("medellin-social.user");
    if (!raw) {
      localStorage.setItem("registro_origen", "mls");
      throw redirect({ to: "/login" });
    }
    const u = JSON.parse(raw);
    if (u.plan !== "agente" && u.esAgente !== true) {
      throw redirect({ to: "/planes", search: { audiencia: "agente" } });
    }
  },
  component: ComparadorPage,
});

// ─── Colors ────────────────────────────────────────────────────────────────────

const COLORS = ["#0F8A4F", "#8A6A00", "#5B5F5C", "#1F5BC6", "#CE1126"];

function getPaperScoreColor(score: number): string {
  if (score >= 60) return "#0F8A4F";
  if (score >= 40) return "#8A6A00";
  return "#CE1126";
}

function scoreToCategory(score: number): string {
  if (score >= 80) return "EXCELENTE";
  if (score >= 60) return "BUENO";
  if (score >= 40) return "MODERADO";
  if (score >= 20) return "BAJO";
  return "MUY BAJO";
}

function getProfileScore(b: ApiBarrio, goal?: string): { score: number | null; cat: string | null } {
  if (goal === "airbnb") return { score: b.scores.corto, cat: b.scores.cat_corto };
  if (goal === "renta-larga") return { score: b.scores.largo, cat: b.scores.cat_largo };
  return { score: b.scores.mediano, cat: b.scores.cat_mediano };
}

function goalToScoreLabel(goal?: string): string {
  if (goal === "airbnb") return "Score Airbnb";
  if (goal === "renta-larga") return "Score Arriendo largo";
  return "Score Renta media";
}


const INVERSION_FILTROS = [
  { id: null, label: "Todos" },
  { id: "airbnb", label: "Airbnb" },
  { id: "nomadas", label: "Nómadas" },
  { id: "renta-larga", label: "Renta larga" },
  { id: "compra", label: "Compra" },
] as const;

type InversionFiltro = (typeof INVERSION_FILTROS)[number]["id"];

const BAR_METRICS: {
  key: string;
  label: string;
  dir: "↑" | "↓";
  getValue: (b: ApiBarrio) => number | null;
  fmt: (v: number) => string;
}[] = [
  { key: "yield", label: "Yield bruto", dir: "↑", getValue: (b) => b.mercado.yield_bruto_pct, fmt: (v) => `${v.toFixed(1)}%` },
  { key: "seguridad", label: "Seguridad", dir: "↑", getValue: (b) => b.seguridad.score, fmt: (v) => `${v}/100` },
  { key: "nomada", label: "Demanda de zona", dir: "↑", getValue: (b) => b.conectividad.indice_nomada, fmt: (v) => v.toFixed(1) },
  { key: "liquidez", label: "Liquidez", dir: "↑", getValue: (b) => b.liquidez.score, fmt: (v) => `${v}/100` },
  { key: "precio_m2", label: "Precio m²", dir: "↓", getValue: (b) => b.mercado.precio_m2_cop, fmt: (v) => formatCOP(v) },
];

// ─── Historial section ─────────────────────────────────────────────────────────

type HistorialItem = {
  id: number;
  tipo: "barrios" | "listings";
  items: number[];
  filtro_inversion?: string | null;
  nombre?: string | null;
  fecha_creacion: string;
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} días`;
  return `hace ${Math.floor(diff / 604800)} semanas`;
}

function HistorialSection({
  onLoadBarrios,
  onLoadListings,
}: {
  onLoadBarrios: (ids: number[], filtro: string | null) => void;
  onLoadListings: (ids: number[]) => void;
}) {
  const isPro = useIsPro();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery<HistorialItem[]>({
    queryKey: ["comparador-historial"],
    queryFn: () => apiFetch(API_ENDPOINTS.comparadorHistorial),
    enabled: isPro && open,
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(API_ENDPOINTS.comparadorHistorialItem(id), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparador-historial"] }),
    onError: () => toast.error("No se pudo eliminar la comparación"),
  });

  if (!isPro) return null;

  return (
    <div
      className="mt-8 rounded-2xl border"
      style={{ background: "#FAF8F3", borderColor: "#E5E0D5" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4"
      >
        <span className="text-sm font-semibold text-[#111418]">
          Mis comparaciones guardadas
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-[#5B5F5C]" /> : <ChevronDown className="h-4 w-4 text-[#5B5F5C]" />}
      </button>

      {open && (
        <div className="border-t px-5 pb-4" style={{ borderColor: "#E5E0D5" }}>
          {isLoading && (
            <p className="py-4 text-center text-xs text-[#6E726E]">Cargando historial…</p>
          )}
          {!isLoading && items.length === 0 && (
            <p className="py-4 text-center text-xs text-[#6E726E]">
              Aún no tienes comparaciones guardadas.
            </p>
          )}
          <div className="mt-3 divide-y" style={{ borderColor: "#E5E0D5" }}>
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#111418]">
                    {item.tipo === "barrios"
                      ? <Building2 className="h-3.5 w-3.5 shrink-0 text-[#0F8A4F]" />
                      : <Home className="h-3.5 w-3.5 shrink-0 text-[#CE1126]" />
                    }
                    <span className="truncate">
                      {item.nombre ?? (item.tipo === "barrios" ? `${item.items.length} barrios` : `${item.items.length} inmuebles`)}
                      {item.filtro_inversion && (
                        <span className="ml-1 text-[10px] text-[#6E726E]">· {item.filtro_inversion}</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#6E726E]">
                    <Clock className="h-3 w-3" />
                    {timeAgo(item.fecha_creacion)}
                  </div>
                </div>
                <div className="ml-3 flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (item.tipo === "barrios") {
                        onLoadBarrios(item.items, item.filtro_inversion ?? null);
                      } else {
                        onLoadListings(item.items);
                      }
                      setOpen(false);
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#0F8A4F] transition hover:bg-[#E7F4EC]"
                    style={{ border: "0.5px solid #0F8A4F" }}
                  >
                    Ver →
                  </button>
                  <button
                    onClick={() => deleteMut.mutate(item.id)}
                    className="rounded-lg p-1.5 text-[#6E726E] transition hover:text-[#CE1126]"
                    title="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB BARRIOS ─────────────────────────────────────────────────────────────

function TabBarrios({
  forcedIds,
  forcedFiltro,
}: {
  forcedIds?: number[];
  forcedFiltro?: string | null;
}) {
  const isPro = useIsPro();
  const { data: barriosRaw = [], isPlaceholderData } = useBarriosRaw();
  const barrios = useMemo(() => barriosRaw.map(barrioToNeighborhood), [barriosRaw]);
  const [ids, setIds] = useState<number[]>(forcedIds ?? []);
  const [filtroInversion, setFiltroInversion] = useState<InversionFiltro>(
    (forcedFiltro as InversionFiltro) ?? null
  );
  const [nombre, setNombre] = useState("");
  const qc = useQueryClient();

  const saveMut = useMutation({
    mutationFn: (data: { tipo: string; items: number[]; filtro_inversion?: string | null; nombre?: string }) =>
      apiFetch(API_ENDPOINTS.comparadorHistorial, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comparador-historial"] });
      toast.success("Comparación guardada");
    },
    onError: () => toast.error("No se pudo guardar la comparación"),
  });

  useEffect(() => {
    if (forcedIds && forcedIds.length > 0) setIds(forcedIds);
  }, [forcedIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isPlaceholderData || barrios.length < 2) return;
    const realIds = new Set(barrios.map((b) => b.id));
    setIds((prev) => {
      if (prev.length > 0) {
        const valid = prev.filter((id) => realIds.has(id));
        if (valid.length === 0) return [barrios[0].id, barrios[1].id];
        if (valid.length === 1) return [valid[0], barrios.find((b) => !valid.includes(b.id))!.id];
        return valid;
      }
      return [barrios[0].id, barrios[1].id];
    });
  }, [barrios, isPlaceholderData]);

  const goalForScore = filtroInversion === "airbnb" ? "airbnb"
    : filtroInversion === "renta-larga" ? "renta-larga"
    : filtroInversion === "nomadas" ? "airbnb"
    : undefined;

  const { data: rawItems = [], isLoading, isError } = useCompararRaw(ids);
  const items = useMemo(
    () => ids.map((id) => rawItems.find((b) => b.barrio_id === id)).filter(Boolean) as ApiBarrio[],
    [ids, rawItems]
  );

  const userGoal = useMemo(() => goalForScore ?? auth.get()?.goal, [goalForScore]);

  return (
    <>
      {/* Filtro tipo de inversión */}
      <div className="mt-4 flex flex-wrap gap-2">
        {INVERSION_FILTROS.map((f) => (
          <button
            key={String(f.id)}
            onClick={() => setFiltroInversion(f.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition"
            style={filtroInversion === f.id
              ? { background: "#0F8A4F", color: "#FFFFFF" }
              : { background: "#F3F0E8", color: "#5B5F5C", border: "0.5px solid #E5E0D5" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Selectores */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ids.map((id, i) => (
          <div
            key={i}
            className="flex items-center gap-1 rounded-md border px-2 py-1"
            style={{ borderColor: COLORS[i], background: `${COLORS[i]}18` }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />
            <select
              value={id}
              onChange={(e) =>
                setIds((prev) => prev.map((v, idx) => (idx === i ? Number(e.target.value) : v)))
              }
              className="bg-transparent text-sm outline-none"
              style={{ color: "#111418" }}
            >
              {barrios.map((n) => (
                <option key={n.id} value={n.id} className="bg-surface" style={{ color: "#111418" }}>
                  {titleCase(n.nombre)}
                </option>
              ))}
            </select>
            {ids.length > 1 && (
              <button
                onClick={() => setIds((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Quitar"
                className="text-muted-foreground hover:text-danger"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            const next = barrios.find((n) => !ids.includes(n.id));
            if (next) setIds([...ids, next.id]);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1 text-xs font-medium transition hover:bg-accent/10"
          style={{ borderColor: "#0A5C36", color: "#0A5C36" }}
        >
          <Plus className="h-3 w-3" /> Añadir barrio
        </button>

        {/* Guardar comparación */}
        {items.length >= 2 && (
          <>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre (opcional)"
              className="rounded-md px-2 py-1 text-xs outline-none"
              style={{ border: "0.5px solid #E5E0D5", color: "#111418", background: "#FFFFFF", width: 140 }}
            />
            <button
              onClick={() => {
                saveMut.mutate({
                  tipo: "barrios",
                  items: ids,
                  filtro_inversion: filtroInversion,
                  nombre: nombre.trim() || undefined,
                });
                setNombre("");
              }}
              disabled={saveMut.isPending}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium text-white transition hover:opacity-90"
              style={{ background: "#0F8A4F" }}
            >
              Guardar
            </button>
          </>
        )}
      </div>

      {isLoading && (
        <div className="mt-12 text-center text-sm text-muted-foreground">Cargando datos...</div>
      )}
      {isError && (
        <div className="mt-12 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Error al cargar datos del backend.
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="mt-8 grid gap-6 lg:grid-cols-5">
          <div className="rounded-2xl border border-border bg-surface/60 p-4 lg:col-span-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[10px] uppercase tracking-widest"
                    style={{ background: "#0A5C36", color: "#FFFFFF" }}
                  >
                    <th className="rounded-tl-lg py-2 px-2 font-medium">Métrica</th>
                    {items.map((b) => (
                      <th key={b.barrio_id} className="py-2 pl-3 font-medium opacity-80">
                        {titleCase(b.nombre ?? "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  <SectionLabel label={goalToScoreLabel(userGoal)} colSpan={items.length + 1} />
                  <tr className="bg-primary/5">
                    <td className="py-2.5 text-xs font-semibold text-primary">Tu perfil</td>
                    {items.map((b) => {
                      const { score, cat } = getProfileScore(b, userGoal);
                      return (
                        <td key={b.barrio_id} className="py-2.5 pl-3">
                          {fmtScore(score, cat)}
                        </td>
                      );
                    })}
                  </tr>
                  <SectionLabel label="TODOS LOS SCORES" colSpan={items.length + 1} />
                  <Row label="Corto plazo" items={items} render={(b) => fmtScore(b.scores.corto, b.scores.cat_corto)} />
                  <Row label="Mediano plazo" items={items} render={(b) => fmtScore(b.scores.mediano, b.scores.cat_mediano)} />
                  <Row label="Largo plazo" items={items} render={(b) => fmtScore(b.scores.largo, b.scores.cat_largo)} />
                  <SectionLabel label="MERCADO" colSpan={items.length + 1} />
                  <Row
                    label="Yield bruto"
                    items={items}
                    render={(b) => (
                      <span style={{ color: yieldColor(b.mercado.yield_bruto_pct ?? 0) }}>
                        {b.mercado.yield_bruto_pct != null ? formatPct(b.mercado.yield_bruto_pct) : "—"}
                      </span>
                    )}
                  />
                  <Row label="Precio m²" items={items} render={(b) => b.mercado.precio_m2_cop != null ? formatCOP(b.mercado.precio_m2_cop) : "—"} />
                  <Row label="Arriendo prom." items={items} render={(b) => b.mercado.arriendo_p50_cop != null ? `${formatCOP(b.mercado.arriendo_p50_cop)}/mes` : "—"} />
                  <Row label="Años recupero" items={items} render={(b) => b.mercado.anos_recupero != null ? `${b.mercado.anos_recupero.toFixed(1)} años` : "—"} />
                  <SectionLabel label="SEGURIDAD" colSpan={items.length + 1} />
                  <Row label="Score seguridad" items={items} render={(b) => fmtScore(b.seguridad.score, b.seguridad.categoria)} />
                  <Row label="Zona turística" items={items} render={(b) => b.seguridad.zona_turistica == null ? "—" : b.seguridad.zona_turistica ? "Sí" : "No"} />
                  <SectionLabel label="CONECTIVIDAD" colSpan={items.length + 1} />
                  <Row label="Dist. metro" items={items} render={(b) => b.conectividad.dist_metro_km != null ? `${b.conectividad.dist_metro_km.toFixed(1)} km` : "—"} />
                  <Row label="Demanda de zona" items={items} render={(b) => b.conectividad.indice_nomada != null ? b.conectividad.indice_nomada.toFixed(1) : "—"} />
                  <Row label="Cafés (500m)" items={items} render={(b) => b.conectividad.n_cafes_500m != null ? String(b.conectividad.n_cafes_500m) : "—"} />
                  <SectionLabel label="LIQUIDEZ" colSpan={items.length + 1} />
                  <Row label="Score liquidez" items={items} render={(b) => fmtScore(b.liquidez.score, b.liquidez.categoria)} />
                  <Row label="Tiempo venta est." items={items} render={(b) => b.liquidez.tiempo_estimado_venta ?? "—"} />
                </tbody>
              </table>
            </div>
          </div>
          <BarComparison items={items} />
        </div>
      )}
    </>
  );
}

// ─── TAB INMUEBLES ────────────────────────────────────────────────────────────

type ComparadorListing = ApiListing & {
  yield_estimado?: number | null;
  arriendo_p50_barrio?: number | null;
  yield_bruto_pct?: number | null;
  score_corto?: number | null;
  seguridad_score?: number | null;
  var_anual_pct?: number | null;
  indice_nomada?: number | null;
  precio_m2_p25?: number | null;
  precio_m2_p75?: number | null;
};

function priceBadgeLabel(pct: number | null | undefined): string {
  if (pct == null) return "—";
  if (pct > 10) return "✓ Buena";
  if (pct >= -10) return "◎ Justo";
  return "↑ Sobre";
}

function priceBadgeColor(pct: number | null | undefined): string {
  if (pct == null) return "#6E726E";
  if (pct > 10) return "#0F8A4F";
  if (pct >= -10) return "#8A6A00";
  return "#CE1126";
}

function diasLabel(dias: number | null | undefined): string | null {
  if (dias == null || dias < 0) return null;
  if (dias === 0) return "Hoy";
  if (dias < 7) return `${dias}d`;
  if (dias < 30) return `${Math.floor(dias / 7)}sem`;
  return `${Math.floor(dias / 30)}mes`;
}

function bestIdx(vals: (number | null | undefined)[], dir: "↑" | "↓"): number {
  const defined = vals.map((v, i) => ({ v, i })).filter(({ v }) => v != null) as { v: number; i: number }[];
  if (defined.length === 0) return -1;
  return defined.reduce((best, cur) => (dir === "↑" ? cur.v > best.v : cur.v < best.v) ? cur : best).i;
}

function worstIdx(vals: (number | null | undefined)[], dir: "↑" | "↓"): number {
  const defined = vals.map((v, i) => ({ v, i })).filter(({ v }) => v != null) as { v: number; i: number }[];
  if (defined.length === 0) return -1;
  return defined.reduce((worst, cur) => (dir === "↑" ? cur.v < worst.v : cur.v > worst.v) ? cur : worst).i;
}

function TableRow({
  label,
  vals,
  dir,
  fmt,
  render,
}: {
  label: string;
  vals?: (number | null | undefined)[];
  dir?: "↑" | "↓";
  fmt?: (v: number) => string;
  render?: (v: number | null | undefined, i: number) => React.ReactNode;
}) {
  const best = vals && dir ? bestIdx(vals, dir) : -1;
  const worst = vals && dir ? worstIdx(vals, dir) : -1;

  return (
    <tr className="border-b" style={{ borderColor: "#E5E0D5" }}>
      <td className="py-2.5 pr-4 text-[11px] text-[#6E726E] whitespace-nowrap">{label}</td>
      {(vals ?? []).map((v, i) => {
        const isBest = i === best && i !== worst;
        const isWorst = i === worst && i !== best;
        const content = render ? render(v, i) : (v != null && fmt ? fmt(v) : "—");
        return (
          <td
            key={i}
            className="py-2.5 pl-3 text-xs font-medium"
            style={{ color: isBest ? "#0A5C36" : isWorst ? "#CE1126" : "#111418" }}
          >
            <span style={isBest ? { background: "#E7F4EC", padding: "2px 6px", borderRadius: 4 } : isWorst ? { background: "#FCE8EA", padding: "2px 6px", borderRadius: 4 } : undefined}>
              {content}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function SectionHeader({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="pb-1 pt-4 text-[9px] font-bold uppercase tracking-widest"
        style={{ color: "#5B5F5C" }}
      >
        {label}
      </td>
    </tr>
  );
}

function getWinnerIdx(listings: ComparadorListing[], goal?: string): number {
  if (listings.length === 0) return 0;
  type Score = { idx: number; score: number };
  const scores: Score[] = listings.map((l, i) => {
    let s = 0;
    if (goal === "investor" || goal === "airbnb") {
      s += (l.yield_estimado ?? 0) * 10;
      s += (100 - (l.dias_en_mercado ?? 0)) * 0.1;
    } else if (goal === "landlord") {
      s += (l.arriendo_p50_barrio ?? 0) / 100_000;
    } else if (goal === "renter") {
      s -= (l.precio_cop ?? 0) / 10_000_000;
      s += 100 - (l.dias_en_mercado ?? 99);
    } else {
      // buyer: precio/m2 low + seguridad
      const pm2 = l.precio_m2 ?? 999_999_999;
      s -= pm2 / 1_000_000;
      s += (l.seguridad_score ?? 0) / 10;
      s += (l.pct_bajo_mediana ?? 0);
    }
    return { idx: i, score: s };
  });
  return scores.reduce((best, cur) => cur.score > best.score ? cur : best).idx;
}

function WinnerCard({ listing, idx, goal }: { listing: ComparadorListing; idx: number; goal?: string }) {
  const navigate = useNavigate();

  const reasonLabel = goal === "investor" || goal === "airbnb"
    ? `Mejor yield estimado (${listing.yield_estimado?.toFixed(1) ?? "—"}%)`
    : goal === "landlord"
    ? `Mayor canon estimado (${listing.arriendo_p50_barrio ? formatCOP(listing.arriendo_p50_barrio) + "/mes" : "—"})`
    : goal === "renter"
    ? `Mejor precio (${listing.precio_cop ? formatCOP(listing.precio_cop) : "—"})`
    : `Mejor precio/m² (${listing.pct_bajo_mediana != null ? listing.pct_bajo_mediana.toFixed(0) + "% vs mediana" : "—"})`;

  return (
    <div
      className="mt-8 rounded-2xl p-5"
      style={{ background: "#E7F4EC", border: "1.5px solid #0F8A4F" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-[#0A5C36]" />
        <span className="text-sm font-bold text-[#0A5C36]">MEJOR OPCIÓN</span>
      </div>
      <div className="flex items-start gap-4">
        {listing.foto_principal && (
          <img
            src={listing.foto_principal}
            alt=""
            className="h-20 w-20 shrink-0 rounded-xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-[#111418]">
            {listing.precio_cop ? formatCOP(listing.precio_cop) : "—"}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-[#5B5F5C]">
            <MapPin className="h-3 w-3 shrink-0" />
            {listing.barrio_nombre ?? "—"}
          </div>
          <div className="mt-2 text-xs text-[#0A5C36]">{reasonLabel}</div>
          {listing.seguridad_score != null && listing.seguridad_score >= 60 && (
            <div className="mt-0.5 text-xs text-[#0A5C36]">Zona segura</div>
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Link
          to="/listing/$id"
          params={{ id: String(listing.id) }}
          className="flex flex-1 items-center justify-center rounded-xl py-2.5 text-xs font-semibold text-white transition hover:opacity-90"
          style={{ background: "#0F8A4F" }}
        >
          Ver listing →
        </Link>
        <button
          onClick={() => {
            const p = new URLSearchParams();
            if (listing.barrio_id) p.set("barrio", String(listing.barrio_id));
            if (listing.precio_cop) p.set("precio", String(listing.precio_cop));
            navigate({ to: "/simulador", search: { barrio: listing.barrio_id ?? undefined, precio: listing.precio_cop ?? undefined } });
          }}
          className="flex-1 rounded-xl py-2.5 text-xs font-semibold text-[#0A5C36] transition hover:bg-[#E7F4EC]"
          style={{ border: "1px solid #0F8A4F" }}
        >
          Simular →
        </button>
      </div>
    </div>
  );
}

function toIdArray(val: unknown): number[] {
  if (Array.isArray(val)) return (val as unknown[]).map(Number).filter(Boolean);
  if (typeof val === "string") {
    const trimmed = val.trim().replace(/^\[|\]$/g, "");
    return trimmed.split(",").map((s) => Number(s.trim())).filter(Boolean);
  }
  return [];
}

function TabInmuebles({
  initialIds,
  onSwitchTab,
}: {
  initialIds?: number[] | string;
  onSwitchTab: () => void;
}) {
  const isPro = useIsPro();
  const qc = useQueryClient();
  const { listings: storeListings, removeListing, clearAll } = useComparadorStore();
  const safeInitial = toIdArray(initialIds);
  const [ids, setIds] = useState<number[]>(safeInitial.length > 0 ? safeInitial : storeListings.map((l) => l.id));

  useEffect(() => {
    const parsed = toIdArray(initialIds);
    if (parsed.length > 0) setIds(parsed);
    else setIds(storeListings.map((l) => l.id));
  }, [Array.isArray(initialIds) ? initialIds.join(",") : String(initialIds ?? ""), storeListings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const userGoal = auth.get()?.goal;
  const [nombre, setNombre] = useState("");

  const { data: listings = [], isLoading } = useQuery<ComparadorListing[]>({
    queryKey: ["comparador-listings", ids.join(",")],
    queryFn: () => apiFetch(API_ENDPOINTS.comparadorListings(ids.join(","))),
    enabled: isPro && ids.length > 0,
    staleTime: 120_000,
  });

  const saveMut = useMutation({
    mutationFn: () =>
      apiFetch(API_ENDPOINTS.comparadorHistorial, {
        method: "POST",
        body: JSON.stringify({ tipo: "listings", items: ids, nombre: nombre.trim() || undefined }),
      }),
    onSuccess: () => {
      setNombre("");
      qc.invalidateQueries({ queryKey: ["comparador-historial"] });
      toast.success("Comparación guardada");
    },
    onError: () => toast.error("No se pudo guardar la comparación"),
  });

  if (!isPro) {
    return (
      <div
        className="mt-8 flex flex-col items-center gap-4 rounded-2xl p-8 text-center"
        style={{ background: "#FAF8F3", border: "0.5px solid #E5E0D5" }}
      >
        <Lock className="h-8 w-8 text-[#5B5F5C]" />
        <div>
          <p className="font-semibold text-[#111418]">
            El Comparador de Inmuebles es exclusivo de MLS Pro
          </p>
          <p className="mt-1 text-sm text-[#5B5F5C]">
            Compara hasta 5 propiedades lado a lado con análisis de precio, yield, zona
            y recomendación automática según tu perfil de inversión.
          </p>
        </div>
        <Link
          to="/planes"
          className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "#0F8A4F" }}
        >
          Suscribirse a MLS Pro →
        </Link>
      </div>
    );
  }

  if (ids.length === 0) {
    return (
      <div
        className="mt-8 flex flex-col items-center gap-4 rounded-2xl p-8 text-center"
        style={{ background: "#FAF8F3", border: "0.5px solid #E5E0D5" }}
      >
        <BarChart2 className="h-8 w-8 text-[#6E726E]" />
        <p className="text-sm text-[#5B5F5C]">
          Navega por el mapa y usa el botón + para seleccionar inmuebles a comparar.
        </p>
        <Link
          to="/map"
          className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "#0F8A4F" }}
        >
          Ir al mapa →
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return <div className="mt-12 text-center text-sm text-[#6E726E]">Cargando datos…</div>;
  }

  if (listings.length === 0) {
    return (
      <div className="mt-8 text-center text-sm text-[#6E726E]">
        No se pudieron cargar los listings. <button onClick={() => setIds([])} className="text-[#0F8A4F] underline">Limpiar selección</button>
      </div>
    );
  }

  const n = listings.length;
  const winnerIdx = getWinnerIdx(listings, userGoal);

  return (
    <>
      {/* Header actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#111418]">
          Comparando {n} inmueble{n !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          {listings.length >= 2 && (
            <>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre (opcional)"
                className="rounded-xl px-3 py-1.5 text-xs outline-none"
                style={{ border: "0.5px solid #E5E0D5", color: "#111418", background: "#FFFFFF", width: 140 }}
              />
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="rounded-xl px-4 py-1.5 text-xs font-semibold text-[#0A5C36] transition hover:bg-[#E7F4EC]"
                style={{ border: "0.5px solid #0F8A4F" }}
              >
                Guardar comparación
              </button>
            </>
          )}
          <button
            onClick={() => { clearAll(); setIds([]); }}
            className="rounded-xl px-4 py-1.5 text-xs font-medium text-[#5B5F5C] transition hover:bg-[#F3F0E8]"
            style={{ border: "0.5px solid #E5E0D5" }}
          >
            Nueva comparación
          </button>
        </div>
      </div>

      {/* Tabla comparativa — scroll horizontal */}
      <div className="mt-6 overflow-x-auto">
        <div className="min-w-[520px] overflow-hidden rounded-2xl" style={{ border: "0.5px solid #E5E0D5" }}>
        <table className="w-full text-sm" style={{ background: "#FFFFFF" }}>
          <thead>
            <tr style={{ background: "#F3F0E8" }}>
              <th className="py-3 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-[#5B5F5C]" style={{ minWidth: 110 }}>
                Métrica
              </th>
              {listings.map((l, i) => (
                <th key={l.id} className="py-2 pl-3 text-left" style={{ minWidth: 140 }}>
                  {/* Photo header */}
                  <div className="relative">
                    <div className="h-[120px] overflow-hidden rounded-xl">
                      {l.foto_principal
                        ? <img src={l.foto_principal} alt="" className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center text-2xl" style={{ background: "linear-gradient(135deg,#0F8A4F,#0A5C36)" }}>🏠</div>
                      }
                    </div>
                    {i === winnerIdx && (
                      <div className="absolute -top-1 -right-1 rounded-full p-1" style={{ background: "#0F8A4F" }}>
                        <Trophy className="h-3.5 w-3.5 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs font-bold text-[#111418]">
                    {l.precio_cop ? formatCOP(l.precio_cop) : "—"}
                  </div>
                  <div className="text-[10px] text-[#5B5F5C]">
                    {(l.tipo_operacion ?? "").toUpperCase()} · {(l.tipo_inmueble ?? "").toUpperCase()}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-[#6E726E]">
                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                    {l.barrio_nombre ?? "—"}
                  </div>
                  <button
                    onClick={() => setIds((prev) => prev.filter((id) => id !== l.id))}
                    className="mt-1 text-[10px] text-[#6E726E] hover:text-[#CE1126]"
                  >
                    × Quitar
                  </button>
                  <Link
                    to="/listing/$id"
                    params={{ id: String(l.id) }}
                    className="mt-2 block rounded-lg py-1.5 text-center text-[10px] font-semibold text-[#0F8A4F] transition hover:bg-[#E7F4EC]"
                    style={{ border: "0.5px solid #0F8A4F" }}
                  >
                    Ver →
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionHeader label="Información básica" colSpan={n + 1} />
            <TableRow label="Precio" vals={listings.map((l) => l.precio_cop)} dir="↓" fmt={(v) => formatCOP(v)} />
            <TableRow label="Precio/m²" vals={listings.map((l) => l.precio_m2)} dir="↓" fmt={(v) => formatCOP(v)} />
            <TableRow label="Área" vals={listings.map((l) => l.area_m2)} dir="↑" fmt={(v) => `${v}m²`} />
            <TableRow label="Habitaciones" vals={listings.map((l) => l.habitaciones)} dir="↑" fmt={(v) => String(v)} />
            <TableRow label="Baños" vals={listings.map((l) => l.banos)} dir="↑" fmt={(v) => String(v)} />
            <TableRow label="Estrato" vals={listings.map((l) => l.estrato_real)} dir="↑" fmt={(v) => `Est. ${v}`} />
            <TableRow
              label="Días en mercado"
              vals={listings.map((l) => l.dias_en_mercado)}
              dir="↓"
              render={(v, _i) => (
                <span>
                  {v != null ? `${v}d` : "—"}
                  {(v ?? 0) > 90 && <span className="ml-1 text-[10px]">⚠️</span>}
                </span>
              )}
            />

            <SectionHeader label="Análisis de precio" colSpan={n + 1} />
            <TableRow
              label="Badge precio"
              vals={listings.map((l) => l.pct_bajo_mediana)}
              dir="↑"
              render={(v) => (
                <span style={{ color: priceBadgeColor(v) }}>{priceBadgeLabel(v)}</span>
              )}
            />
            <TableRow
              label="% vs mediana"
              vals={listings.map((l) => l.pct_bajo_mediana)}
              dir="↑"
              render={(v) => (v != null ? `${v > 0 ? "-" : "+"}${Math.abs(v).toFixed(0)}%` : "—")}
            />

            <SectionHeader label="Inversión" colSpan={n + 1} />
            <TableRow
              label="Yield estimado"
              vals={listings.map((l) => l.yield_estimado)}
              dir="↑"
              fmt={(v) => `${v.toFixed(1)}%`}
            />
            <TableRow
              label="Canon estimado"
              vals={listings.map((l) => l.arriendo_p50_barrio)}
              dir="↑"
              fmt={(v) => `${formatCOP(v)}/mes`}
            />
            <TableRow
              label="Valorización anual"
              vals={listings.map((l) => l.var_anual_pct)}
              dir="↑"
              fmt={(v) => `+${v.toFixed(1)}%`}
            />

            <SectionHeader label="Zona" colSpan={n + 1} />
            <TableRow
              label="Barrio"
              vals={listings.map(() => null)}
              render={(_v, i) => listings[i]?.barrio_nombre ?? "—"}
            />
            <TableRow
              label="Seguridad"
              vals={listings.map((l) => l.seguridad_score)}
              dir="↑"
              render={(v) => (
                <span style={{ color: v == null ? "#6E726E" : v >= 60 ? "#0F8A4F" : v >= 40 ? "#8A6A00" : "#CE1126" }}>
                  {v == null ? "—" : v >= 60 ? "Segura" : v >= 40 ? "Moderada" : "Baja"}
                </span>
              )}
            />
            <TableRow
              label="Demanda"
              vals={listings.map((l) => l.indice_nomada)}
              dir="↑"
              fmt={(v) => v.toFixed(1)}
            />
          </tbody>
        </table>
        </div>
      </div>

      {/* Ganador automático */}
      {listings.length >= 2 && (
        <WinnerCard listing={listings[winnerIdx]} idx={winnerIdx} goal={userGoal} />
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ComparadorPage() {
  const isPro = useIsPro();
  const isAgente = useIsAgente();
  const search = Route.useSearch();
  const navigate = useNavigate();
  // Distinguishes "haven't checked yet" (matches SSR/first paint) from a
  // confirmed non-agent — without it, the redirect effect below and
  // useIsAgente's own internal effect race on the same mount commit and can
  // fire a false-positive redirect before isAgente resolves to its real value.
  const [agentChecked, setAgentChecked] = useState(false);

  const [forcedBarrioIds, setForcedBarrioIds] = useState<number[] | undefined>();
  const [forcedBarrioFiltro, setForcedBarrioFiltro] = useState<string | null>(null);
  const [forcedListingIds, setForcedListingIds] = useState<number[] | undefined>();

  // Determine initial tab
  const initialTab: "barrios" | "inmuebles" =
    search.listings ? "inmuebles" : (search.tab ?? "barrios");
  const [activeTab, setActiveTab] = useState<"barrios" | "inmuebles">(initialTab);

  // If ?listings= param present, parse them
  const urlListingIds = useMemo(() => {
    if (!search.listings) return undefined;
    return search.listings.split(",").map(Number).filter(Boolean);
  }, [search.listings]);

  useEffect(() => {
    if (urlListingIds && urlListingIds.length > 0) {
      setForcedListingIds(urlListingIds);
      setActiveTab("inmuebles");
    }
  }, [urlListingIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // beforeLoad only runs server-side/on SPA nav — on a hard refresh the guard
  // doesn't fire, so this is the real backstop against a non-agent seeing content.
  useEffect(() => { setAgentChecked(true); }, []);
  useEffect(() => {
    if (agentChecked && !isAgente) navigate({ to: "/planes", search: { audiencia: "agente" } });
  }, [agentChecked, isAgente, navigate]);
  if (agentChecked && !isAgente) return null;

  return (
    <div className="paper-theme relative min-h-screen bg-background pb-20">
      <MapNavbar activeTab="comparador" onTabChange={() => {}} />
      <main className="mx-auto max-w-6xl px-4 pt-24 sm:px-6">
        <Link
          to="/map"
          className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-muted-foreground transition hover:text-primary"
        >
          <ArrowLeft className="h-3 w-3" /> Volver al mapa
        </Link>

        <h1 className="mt-4 font-display text-3xl font-semibold text-[#111418]">Comparador</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compara barrios o inmuebles específicos lado a lado
        </p>

        {/* Tabs */}
        <div
          className="mt-6 inline-flex rounded-xl p-1 gap-1"
          style={{ background: "#F3F0E8", border: "0.5px solid #E5E0D5" }}
        >
          {(["barrios", "inmuebles"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="rounded-lg px-5 py-2 text-sm font-semibold transition"
              style={activeTab === tab
                ? { background: "#FFFFFF", color: "#0F8A4F", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }
                : { color: "#5B5F5C" }
              }
            >
              {tab === "barrios" ? "🏘️ Barrios" : "🏠 Inmuebles"}
              {tab === "inmuebles" && !isPro && (
                <Lock className="ml-1 inline h-3 w-3 text-[#6E726E]" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "barrios" && (
          <TabBarrios
            forcedIds={forcedBarrioIds}
            forcedFiltro={forcedBarrioFiltro}
          />
        )}
        {activeTab === "inmuebles" && (
          <TabInmuebles
            initialIds={forcedListingIds ?? urlListingIds}
            onSwitchTab={() => setActiveTab("barrios")}
          />
        )}

        {/* Historial */}
        <HistorialSection
          onLoadBarrios={(ids, filtro) => {
            setForcedBarrioIds(ids);
            setForcedBarrioFiltro(filtro);
            setActiveTab("barrios");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onLoadListings={(ids) => {
            setForcedListingIds(ids);
            setActiveTab("inmuebles");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </main>
    </div>
  );
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function SectionLabel({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="pb-1 pt-3 text-[9px] font-bold uppercase tracking-widest"
        style={{ color: "#5B5F5C", borderTop: "1px solid #E5E0D5" }}
      >
        {label}
      </td>
    </tr>
  );
}

function Row({
  label,
  items,
  render,
}: {
  label: string;
  items: ApiBarrio[];
  render: (b: ApiBarrio) => React.ReactNode;
}) {
  return (
    <tr>
      <td className="py-2.5 text-xs uppercase tracking-widest text-muted-foreground">{label}</td>
      {items.map((b) => (
        <td key={b.barrio_id} className="py-2.5 pl-3 font-medium text-[#111418]">
          {render(b)}
        </td>
      ))}
    </tr>
  );
}

function fmtScore(score: number | null, _cat?: string | null): React.ReactNode {
  if (score == null) return "—";
  const color = getPaperScoreColor(score);
  const label = scoreToCategory(score);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold"
        style={{ color, border: `1px solid ${color}50`, background: `${color}18` }}
      >
        {score}
      </span>
      <span className="text-[10px] font-medium" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

function BarComparison({ items }: { items: ApiBarrio[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-4 lg:col-span-2">
      <div className="mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        Comparativa por dimensión
      </div>
      <div className="space-y-5">
        {BAR_METRICS.map((m) => {
          const vals = items.map((b) => m.getValue(b));
          const defined = vals.filter((v): v is number => v != null);
          if (defined.length === 0) return null;
          const min = Math.min(...defined);
          const max = Math.max(...defined);
          return (
            <div key={m.key}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {m.label}
                <span className="text-[9px] opacity-50">{m.dir} {m.dir === "↓" ? "menor es mejor" : "mayor es mejor"}</span>
              </div>
              <div className="space-y-1.5">
                {items.map((b, i) => {
                  const val = m.getValue(b);
                  if (val == null) return (
                    <div key={b.barrio_id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="w-20 truncate">{titleCase(b.nombre ?? "")}</span>
                      <span>—</span>
                    </div>
                  );
                  const rawPct = max === min ? 60 : ((val - min) / (max - min)) * 100;
                  const barPct = m.dir === "↓" ? 100 - rawPct : rawPct;
                  const finalPct = Math.max(8, barPct);
                  return (
                    <div key={b.barrio_id} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">
                        {titleCase(b.nombre ?? "")}
                      </span>
                      <div className="flex flex-1 items-center gap-2">
                        <div
                          className="h-3.5 rounded-sm transition-all"
                          style={{ width: `${finalPct}%`, background: COLORS[i], opacity: 0.8 }}
                        />
                        <span className="shrink-0 text-[11px] font-medium" style={{ color: COLORS[i] }}>
                          {m.fmt(val)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 text-[9px] text-muted-foreground">
        Barra más larga = mejor rendimiento relativo en cada dimensión
      </div>
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
