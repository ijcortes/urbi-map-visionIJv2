import { useState } from "react";
import { useBarriosComunas, useBarriosPorComuna, useComparar } from "@/hooks/useBarrios";
import type { Neighborhood } from "@/lib/adapters";
import { C, fmt, fmtCOP, Card } from "./_kit";

type Metric = {
  key: string; label: string; grupo: "negocio" | "zona"; get: (n: Neighborhood) => number | null;
  fmtVal: (v: number) => string; higherBetter: boolean;
};
const km = (v: number) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`);
const METRICS: Metric[] = [
  // 💰 Negocio (lo que el realtor vende al inversionista)
  { key: "yield", label: "Yield bruto", grupo: "negocio", get: (n) => n.yield ?? null, fmtVal: (v) => `${v.toFixed(1)}%`, higherBetter: true },
  { key: "yieldrm", label: "Yield renta media", grupo: "negocio", get: (n) => n.yield_renta_media_pct ?? null, fmtVal: (v) => `${v.toFixed(1)}%`, higherBetter: true },
  { key: "recupero", label: "Años de recupero", grupo: "negocio", get: (n) => n.anos_recupero ?? null, fmtVal: (v) => `${v.toFixed(0)} años`, higherBetter: false },
  { key: "valanual", label: "Valorización anual", grupo: "negocio", get: (n) => n.valorizacion_api?.var_anual_pct ?? null, fmtVal: (v) => `+${v.toFixed(1)}%`, higherBetter: true },
  { key: "val5", label: "Proyección 5 años", grupo: "negocio", get: (n) => n.valorizacion_api?.proyeccion_5anos_pct ?? null, fmtVal: (v) => `+${v.toFixed(0)}%`, higherBetter: true },
  { key: "liq", label: "Liquidez", grupo: "negocio", get: (n) => n.liquidez_api?.score ?? null, fmtVal: (v) => `${Math.round(v)}/100`, higherBetter: true },
  // 📍 Precio & zona (público — lo que ya ven todos)
  { key: "precio", label: "Precio / m²", grupo: "zona", get: (n) => n.precio_m2 ?? null, fmtVal: (v) => fmtCOP(v), higherBetter: false },
  { key: "arr", label: "Arriendo típico", grupo: "zona", get: (n) => n.arriendo ?? null, fmtVal: (v) => fmtCOP(v), higherBetter: false },
  { key: "seg", label: "Seguridad", grupo: "zona", get: (n) => n.seguridad_score ?? null, fmtVal: (v) => `${Math.round(v)}/100`, higherBetter: true },
  { key: "verde", label: "Zonas verdes", grupo: "zona", get: (n) => n.verde_pct ?? null, fmtVal: (v) => `${v.toFixed(1)}%`, higherBetter: true },
  { key: "metro", label: "Dist. al metro", grupo: "zona", get: (n) => n.dist_metro ?? null, fmtVal: km, higherBetter: false },
  { key: "estrato", label: "Estrato", grupo: "zona", get: (n) => n.estrato ?? null, fmtVal: (v) => `${v}`, higherBetter: true },
];
const GRUPOS: { id: "negocio" | "zona"; label: string }[] = [
  { id: "negocio", label: "💰 Rentabilidad & negocio" },
  { id: "zona", label: "📍 Precio & zona" },
];

export function ComparadorTab() {
  const [comuna, setComuna] = useState<string | null>(null);
  const [sel, setSel] = useState<{ id: number; nombre: string }[]>([]);
  const { data: comunas } = useBarriosComunas();
  const { data: barrios } = useBarriosPorComuna(comuna);
  const { data: comp } = useComparar(sel.map((s) => s.id));

  const add = (id: number, nombre: string) => {
    if (sel.length >= 4 || sel.some((s) => s.id === id)) return;
    setSel([...sel, { id, nombre }]);
  };
  const remove = (id: number) => setSel(sel.filter((s) => s.id !== id));

  return (
    <div className="flex flex-col gap-5">
      <Card title="Compara barrios (hasta 4)">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>Comuna</span>
            <select className="rounded-xl border bg-white px-3 py-2 text-[13px]" style={{ borderColor: C.line, color: C.ink }}
              value={comuna ?? ""} onChange={(e) => setComuna(e.target.value || null)}>
              <option value="">Elige comuna…</option>
              {(comunas ?? []).map((c) => <option key={c.key} value={c.key}>{c.label} · {c.municipio}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>Agregar barrio</span>
            <select className="rounded-xl border bg-white px-3 py-2 text-[13px]" style={{ borderColor: C.line, color: C.ink }} disabled={!comuna}
              value="" onChange={(e) => { const b = (barrios ?? []).find((x) => x.id === Number(e.target.value)); if (b) add(b.id, b.nombre); }}>
              <option value="">Elige barrio…</option>
              {(barrios ?? []).filter((b) => !sel.some((s) => s.id === b.id)).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          </label>
        </div>
        {sel.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sel.map((s, i) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white"
                style={{ background: C.cat[i % C.cat.length] }}>
                {s.nombre}
                <button onClick={() => remove(s.id)} className="opacity-80 hover:opacity-100">✕</button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {sel.length < 2 ? (
        <div className="rounded-2xl px-5 py-10 text-center text-[13px]" style={{ background: C.card, border: `1px solid ${C.line}`, color: C.muted }}>
          Agrega al menos 2 barrios para comparar.
        </div>
      ) : comp && comp.length > 0 ? (
        <div className="flex flex-col gap-6">
          {GRUPOS.map((g) => (
            <div key={g.id}>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>{g.label}</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {METRICS.filter((m) => m.grupo === g.id).map((m) => {
                  const vals = comp.map((n) => ({ nombre: n.nombre, v: m.get(n) }));
                  const nums = vals.map((x) => x.v).filter((x): x is number => x != null);
                  const max = Math.max(...nums, 1);
                  const best = nums.length ? (m.higherBetter ? Math.max(...nums) : Math.min(...nums)) : null;
                  return (
                    <Card key={m.key} title={m.label}>
                      <div className="flex flex-col gap-2">
                        {vals.map((x, i) => {
                          const w = x.v == null ? 0 : Math.max(5, (x.v / max) * 100);
                          const isBest = x.v != null && x.v === best;
                          return (
                            <div key={i} className="flex items-center gap-2.5">
                              <div className="w-24 shrink-0 truncate text-[11.5px]" style={{ color: C.sub }} title={x.nombre}>{x.nombre}</div>
                              <div className="h-6 flex-1 overflow-hidden rounded" style={{ background: C.soft }}>
                                <div className="h-full rounded" style={{ width: `${w}%`, background: C.cat[i % C.cat.length], opacity: isBest ? 1 : 0.55 }} />
                              </div>
                              <div className="w-24 shrink-0 text-right text-[12px] font-semibold tabular-nums" style={{ color: isBest ? C.brand : C.ink }}>
                                {x.v == null ? "—" : m.fmtVal(x.v)}{isBest && " ★"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-10 text-center text-[13px]" style={{ color: C.muted }}>Cargando comparación…</div>
      )}
    </div>
  );
}
