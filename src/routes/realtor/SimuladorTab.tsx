import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useBarriosComunas, useBarriosPorComuna } from "@/hooks/useBarrios";
import { useSimular, type SimulacionRequest, type FlujoCajaDesglose } from "@/hooks/useCalculadora";
import { C, fmt, fmtCOP, Card, Gauge, Stat, Segmented } from "./_kit";

const PRESUPUESTOS = [200, 350, 500, 800, 1000]; // millones COP
type Modalidad = "airbnb" | "renta_media" | "renta_larga";
const MODALIDADES: { v: Modalidad; label: string }[] = [
  { v: "airbnb", label: "Airbnb" },
  { v: "renta_media", label: "Renta media" },
  { v: "renta_larga", label: "Renta larga" },
];

// Flujo de caja — "a dónde va la plata" (ingreso bruto → deducciones → neto → flujo real).
function FlujoCaja({ f }: { f: FlujoCajaDesglose }) {
  const base = Math.max(f.ingreso_bruto, 1);
  const Row = ({ label, amount, kind }: { label: string; amount: number; kind: "in" | "out" | "net" }) => {
    const col = kind === "out" ? C.bad : kind === "net" ? C.ink : C.good;
    const barCol = kind === "out" ? C.bad : C.brand;
    const w = Math.max(3, (Math.abs(amount) / base) * 100);
    return (
      <div className="flex items-center gap-3">
        <div className="w-32 shrink-0 text-[11.5px]" style={{ color: kind === "net" ? C.ink : C.sub, fontWeight: kind === "net" ? 700 : 400 }}>{label}</div>
        <div className="h-5 flex-1 overflow-hidden rounded" style={{ background: C.soft }}>
          <div className="h-full rounded" style={{ width: `${w}%`, background: barCol, opacity: kind === "net" ? 1 : 0.85 }} />
        </div>
        <div className="w-28 shrink-0 text-right text-[12px] tabular-nums" style={{ color: col, fontWeight: kind === "net" ? 700 : 500 }}>
          {kind === "out" ? "−" : ""}{fmtCOP(Math.abs(amount))}
        </div>
      </div>
    );
  };
  const outs: [string, number | null | undefined][] = [
    ["Vacancia", f.vacancia], ["Fee plataforma", f.fee_plataforma], ["Retención", f.retencion],
    ["Administración", f.administracion], ["Mantenimiento", f.mantenimiento], ["Seguro", f.seguro], ["Predial", f.predial],
  ];
  return (
    <Card title="💸 Flujo de caja mensual">
      <div className="flex flex-col gap-1.5">
        <Row label="Ingreso bruto" amount={f.ingreso_bruto} kind="in" />
        {outs.filter(([, v]) => v != null && v > 0).map(([l, v]) => <Row key={l} label={l} amount={v as number} kind="out" />)}
        <Row label="= Ingreso neto" amount={f.ingreso_neto} kind="net" />
        {f.cuota_credito != null && f.cuota_credito > 0 && <Row label="Cuota crédito" amount={f.cuota_credito} kind="out" />}
        {f.flujo_real != null && <Row label="= Flujo real" amount={f.flujo_real} kind="net" />}
      </div>
    </Card>
  );
}

export function SimuladorTab() {
  const [comuna, setComuna] = useState<string | null>(null);
  const [barrioId, setBarrioId] = useState<number | null>(null);
  const [presupuesto, setPresupuesto] = useState(500);
  const [modalidad, setModalidad] = useState<Modalidad>("renta_larga");
  const horizonte = 5;

  const { data: comunas } = useBarriosComunas();
  const { data: barrios } = useBarriosPorComuna(comuna);
  const sim = useSimular();

  const correr = () => {
    if (barrioId == null) return;
    const req: SimulacionRequest = {
      barrio_id: barrioId, presupuesto_cop: presupuesto * 1e6, tipo_inversion: modalidad,
      horizonte_anos: horizonte, con_credito: false,
    };
    sim.mutate(req);
  };

  const r = sim.data;
  const selField = "rounded-xl border px-3 py-2 text-[13px] bg-white";

  return (
    <div className="flex flex-col gap-5">
      {/* Parámetros */}
      <Card title="Parámetros de la simulación">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>Comuna</span>
              <select className={selField} style={{ borderColor: C.line, color: C.ink }}
                value={comuna ?? ""} onChange={(e) => { setComuna(e.target.value || null); setBarrioId(null); }}>
                <option value="">Elige comuna…</option>
                {(comunas ?? []).map((c) => <option key={c.key} value={c.key}>{c.label} · {c.municipio}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>Barrio</span>
              <select className={selField} style={{ borderColor: C.line, color: C.ink }} disabled={!comuna}
                value={barrioId ?? ""} onChange={(e) => setBarrioId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Elige barrio…</option>
                {(barrios ?? []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>Presupuesto</span>
              <Segmented value={String(presupuesto)} onChange={(v) => setPresupuesto(Number(v))}
                options={PRESUPUESTOS.map((p) => ({ v: String(p), label: p >= 1000 ? "$1.000M" : `$${p}M` }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>Modalidad</span>
              <Segmented value={modalidad} onChange={setModalidad} options={MODALIDADES} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={correr} disabled={barrioId == null || sim.isPending}
              className="ml-auto rounded-xl px-6 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-40"
              style={{ background: C.brand }}>
              {sim.isPending ? "Simulando…" : "Simular"}
            </button>
          </div>
        </div>
      </Card>

      {sim.isError && <div className="rounded-xl px-4 py-3 text-[12px]" style={{ background: "#FDECEA", color: C.bad }}>No se pudo simular esa zona. Prueba otro barrio.</div>}

      {r && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <Gauge value={r.score_oportunidad} label="Oportunidad" sub={r.rating_oportunidad} />
            <Stat label="Yield neto" value={r.yields.neto_pct != null ? `${r.yields.neto_pct.toFixed(1)}%` : "—"} sub={`bruto ${r.yields.bruto_pct.toFixed(1)}%`} accent={C.brand} />
            <Stat label="Recupero" value={r.recupero.neto_anos != null ? `${r.recupero.neto_anos.toFixed(0)} años` : `${r.recupero.bruto_anos.toFixed(0)} años`} sub="recuperar la inversión" />
            <Stat label="Ingreso/mes" value={fmtCOP(r.ingresos.mensual_cop)} sub={`${fmtCOP(r.ingresos.anual_cop)}/año`} />
            <Stat label="Ganancia 5 años" value={fmtCOP(r.valorizacion.ganancia_5anos_cop)} sub={`+${r.valorizacion.tasa_anual_pct.toFixed(1)}%/año`} accent={C.good} />
          </div>

          {/* Proyección */}
          {r.proyeccion_anual && r.proyeccion_anual.length > 0 && (
            <Card title={`📈 Proyección a ${horizonte} años — ${r.barrio}`}>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={r.proyeccion_anual} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.line} />
                    <XAxis dataKey="año" tick={{ fontSize: 11, fill: C.sub }} tickLine={false} axisLine={false}
                      tickFormatter={(v) => `Año ${v}`} />
                    <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} width={48}
                      tickFormatter={(v) => fmtCOP(Number(v))} />
                    <RTooltip formatter={(v: unknown, n) => [fmtCOP(Number(v)), n === "valor_inmueble" ? "Valor del inmueble" : "Ingresos acumulados"]}
                      labelFormatter={(l) => `Año ${l}`}
                      contentStyle={{ background: C.ink, border: "none", borderRadius: 8, color: "#fff", fontSize: 11 }} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }}
                      formatter={(v) => (v === "valor_inmueble" ? "Valor del inmueble" : "Ingresos acumulados")} />
                    <Line type="monotone" dataKey="valor_inmueble" stroke={C.ramp[2]} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="ingresos_acumulados" stroke={C.brand} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {r.flujo_caja_desglose && <FlujoCaja f={r.flujo_caja_desglose} />}

          </div>

          {r.resumen && <div className="rounded-2xl px-5 py-4 text-[13px] leading-relaxed" style={{ background: C.soft, color: C.ink, border: `1px solid ${C.line}` }}>{r.resumen}</div>}
        </>
      )}
    </div>
  );
}
