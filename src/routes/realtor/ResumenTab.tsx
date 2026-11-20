import {
  useDesempeno, useEmbudo, useRealtorPerfil, useInteligenciaBarrio, type Embudo,
} from "@/hooks/useRealtorDashboard";
import type { ZonaNivel } from "@/lib/realtorApi";
import { C, fmt, fmtCOP, Card, Gauge, Stat } from "./_kit";

const pctN = (v: number | null | undefined) => (v == null ? null : v * 100);
const fmtMes = (n: number | null | undefined) => (n == null ? "—" : `$${(n / 1e6).toFixed(n >= 1e6 ? 1 : 0)}M/mes`);

// Embudo horizontal (ancho ∝ conteo, rampa ordinal + % de conversión).
function Funnel({ stages, title, nota, compact }: { stages: { label: string; value: number }[]; title?: string; nota?: string; compact?: boolean }) {
  const top = Math.max(stages[0]?.value ?? 0, 1);
  return (
    <div>
      {title && <div className="mb-3 text-[13px] font-semibold tracking-tight" style={{ color: C.ink }}>{title}</div>}
      <div className="flex flex-col gap-2">
        {stages.map((s, i) => {
          const w = Math.max(6, (s.value / top) * 100);
          const conv = i > 0 && stages[i - 1].value > 0 ? s.value / stages[i - 1].value : null;
          return (
            <div key={s.label} className="flex items-center gap-3">
              <div className={`${compact ? "w-24" : "w-28"} shrink-0 text-right text-[11.5px]`} style={{ color: C.sub }}>{s.label}</div>
              <div className="relative h-8 flex-1 overflow-hidden rounded-md" style={{ background: C.soft }}>
                <div className="flex h-full items-center rounded-md pl-2.5" style={{ width: `${w}%`, background: C.ramp[Math.min(i, C.ramp.length - 1)] }}>
                  <span className="text-[12px] font-bold tabular-nums text-white">{fmt(s.value)}</span>
                </div>
              </div>
              <div className="w-11 shrink-0 text-[11px] tabular-nums" style={{ color: conv == null ? "transparent" : conv >= 0.5 ? C.good : conv >= 0.15 ? C.warn : C.bad }}>
                {conv == null ? "" : `${Math.round(conv * 100)}%`}
              </div>
            </div>
          );
        })}
      </div>
      {nota && <div className="mt-3 text-[10.5px] leading-relaxed" style={{ color: C.muted }}>{nota}</div>}
    </div>
  );
}

// Grid "Información del mercado" de la zona del realtor (spec Katy §3).
function MercadoZona({ codigo, nivel }: { codigo: string; nivel?: string }) {
  const { data: b } = useInteligenciaBarrio(codigo, nivel as ZonaNivel | undefined);
  if (!b) return null;
  const m = b.mercado, a = b.airbnb, s = b.seguridad, con = b.conectividad, v = b.valorizacion, liq = b.liquidez;
  const Bloc = ({ title, rows }: { title: string; rows: [string, string][] }) => (
    <div className="rounded-xl p-4" style={{ background: C.soft, border: `1px solid ${C.line}` }}>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: C.brand }}>{title}</div>
      <div className="flex flex-col gap-1.5">
        {rows.map(([k, val]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <span className="text-[11.5px]" style={{ color: C.sub }}>{k}</span>
            <span className="text-[12px] font-semibold tabular-nums" style={{ color: C.ink }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
  const km = (d: number | null) => (d == null ? "—" : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);
  return (
    <Card title={`📊 Información del mercado — ${b.nombre ?? codigo}`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Bloc title="Venta" rows={[
          ["Precio por m²", fmtCOP(m.precio_m2_cop)],
          ["Facilidad de venta", liq.categoria ?? "—"],
          ["Tiempo para vender", liq.tiempo_estimado_venta ?? "—"],
        ]} />
        <Bloc title="Arriendo largo plazo" rows={[
          ["Arriendo típico", fmtCOP(m.arriendo_p50_cop)],
          ["Ganancia anual", m.yield_bruto_pct != null ? `${m.yield_bruto_pct.toFixed(1)}%` : "—"],
          ["Años para recuperar", m.anos_recupero != null ? `${m.anos_recupero.toFixed(1)}` : "—"],
        ]} />
        <Bloc title="Alquiler por días (Airbnb)" rows={[
          ["Días ocupado", a.ocupacion_pct != null ? `${Math.round(a.ocupacion_pct)}%` : "—"],
          ["Precio por noche", fmtCOP(a.adr_cop)],
          ["Ganancia anual", a.yield_airbnb_pct != null ? `${a.yield_airbnb_pct.toFixed(1)}%` : "—"],
        ]} />
        <Bloc title="Seguridad" rows={[
          ["Qué tan segura es", s.score != null ? `${Math.round(s.score)} de 100` : "—"],
          ["Cómo va cambiando", s.tendencia ?? "—"],
        ]} />
        <Bloc title="Ubicación" rows={[
          ["Distancia al metro", km(con.dist_metro_km)],
          ["Caminable", con.walk_score != null ? (con.walk_score >= 70 ? "Muy caminable" : con.walk_score >= 40 ? "Algo caminable" : "Requiere carro") : "—"],
          ["Colegios cerca", con.n_colegios_1km != null ? `${con.n_colegios_1km}` : "—"],
        ]} />
        <Bloc title="Valorización" rows={[
          ["Subió este año", v.var_anual_pct != null ? `+${v.var_anual_pct.toFixed(1)}%` : "—"],
          ["Se espera en 5 años", v.proyeccion_5anos_pct != null ? `+${Math.round(v.proyeccion_5anos_pct)}%` : "—"],
        ]} />
      </div>
      <div className="mt-3 text-[10.5px]" style={{ color: C.muted }}>Se actualiza cada semana o cada mes, no al instante.</div>
    </Card>
  );
}

export function ResumenTab() {
  const { data: d, isLoading } = useDesempeno();
  const { data: emb } = useEmbudo() as { data: Embudo | undefined };
  const { data: perfil } = useRealtorPerfil();

  if (isLoading) return <div className="py-16 text-center text-[13px]" style={{ color: C.muted }}>Cargando…</div>;
  if (!d) return <div className="py-16 text-center text-[13px]" style={{ color: C.muted }}>Sin datos de desempeño aún.</div>;

  const cs = d.calificacion_servicio;
  const st = d.standing;
  const zonaPrincipal = perfil?.zonas_patrocinadas?.[0];

  const demanda = [
    { label: "Vistas en mapa", value: emb?.vistas_mapa ?? 0 },
    { label: "Abrieron detalle", value: emb?.aperturas_detalle ?? 0 },
    { label: "Favoritos", value: emb?.favoritos ?? 0 },
    { label: "Visitas pedidas", value: emb?.visitas ?? 0 },
  ];
  const hayDemanda = demanda.some((s) => s.value > 0);
  const z = d.zonas ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* ① Cómo te está yendo */}
      <div>
        <div className="mb-2 text-[13px] font-semibold tracking-tight" style={{ color: C.ink }}>Cómo te está yendo</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Gauge value={st?.puntaje ?? null} label="Standing" sub={st?.ranking ? `#${st.ranking.posicion} de ${st.ranking.total}` : "Puntaje 0–100"} />
          <Gauge value={pctN(d.tasa_aceptacion)} label="Aceptación" suffix="%" sub={`llegaron ${d.asignados_90d}, aceptaste ${d.aceptados_90d}`} />
          <Stat label="Respuesta" value={d.mediana_horas_aceptar != null ? `${d.mediana_horas_aceptar.toFixed(1)}h` : "—"}
            sub={cs?.grado && cs.grado !== "—" ? `grado ${cs.grado}` : "hasta aceptar el cliente"} accent={C.brand} />
          <Gauge value={pctN(d.show_rate)} label="Asistencia" suffix="%" sub={`${d.visitas_realizadas_90d} sí, ${d.visitas_no_show_90d} no`} />
          <Stat label="Oferta / interés" value={fmt(d.ofertas_90d + d.interesados_90d)} sub={`${d.ofertas_90d} ofertas · ${d.interesados_90d} interesados`} />
          <Stat label="Vistas" value={fmt(d.vistas_30d)} sub="este mes" />
        </div>
      </div>

      {/* ② Resultados en tu zona pagada */}
      {z.length > 0 && (
        <div>
          <div className="mb-2 text-[13px] font-semibold tracking-tight" style={{ color: C.ink }}>Resultados en tu zona pagada</div>
          <div className="flex flex-col gap-4">
            {z.map((zona) => (
              <Card key={zona.zona_codigo}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[14px] font-bold" style={{ color: C.ink }}>{zona.zona_nombre} <span className="font-normal" style={{ color: C.muted }}>· {zona.nivel}</span></div>
                  <div className="text-[12px]" style={{ color: C.muted }}>{zona.tier ? `${zona.tier} · ` : ""}{fmtMes(zona.precio_mensual)}</div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><div className="text-[20px] font-bold tabular-nums" style={{ color: C.brand }}>{fmtCOP(zona.costo_por_intake)}</div><div className="text-[10.5px]" style={{ color: C.muted }}>costo por cliente conseguido</div></div>
                  <div><div className="text-[20px] font-bold tabular-nums" style={{ color: C.ink }}>{fmt(zona.vistas_30d)}</div><div className="text-[10.5px]" style={{ color: C.muted }}>visitas a tus inmuebles</div></div>
                  <div><div className="text-[20px] font-bold tabular-nums" style={{ color: C.ink }}>{fmt(zona.intakes_mes)}</div><div className="text-[10.5px]" style={{ color: C.muted }}>inmuebles nuevos este mes</div></div>
                </div>
                <div className="mt-4">
                  <Funnel compact stages={[
                    { label: "Llegaron", value: zona.intakes_mes ?? 0 },
                    { label: "Tomados", value: zona.tomados_mes ?? 0 },
                    { label: "Publicados", value: zona.publicados_total ?? 0 },
                    { label: "Cerrados", value: zona.cerrados_total ?? 0 },
                  ]} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ③ Información del mercado de tu zona */}
      {zonaPrincipal && <MercadoZona codigo={zonaPrincipal.codigo} nivel={zonaPrincipal.nivel} />}

      {/* Embudo de demanda (era "idea", ya es real): interés real por tus inmuebles */}
      {hayDemanda ? (
        <Card title="📈 Interés real en tus zonas (30 días)">
          <Funnel stages={demanda}
            nota="Quién ve el pin, abre el detalle, lo guarda como favorito y pide visita. El % es la conversión de una etapa a la siguiente." />
        </Card>
      ) : (
        <div className="rounded-2xl p-5 text-[12px]" style={{ background: C.card, border: `1px solid ${C.line}`, color: C.muted }}>
          📈 <strong style={{ color: C.ink }}>Interés real</strong> — aún sin actividad en tus zonas (30 días). Se llena con el tráfico del mapa.
        </div>
      )}
    </div>
  );
}
