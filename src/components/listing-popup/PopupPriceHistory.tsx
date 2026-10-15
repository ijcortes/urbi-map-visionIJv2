import {
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import { formatDate } from "@/lib/format";

type HistoriaItem = { precio: number; fecha: string; delta_pct?: number | null };

type Props = {
  historia?: HistoriaItem[] | null;
  /** Current listing price — appended as the final "Hoy" point. */
  precioActual?: number | null;
};

/** Price history mini-chart. The API returns exact duplicates (same fecha+precio),
 *  so dedupe first; renders only with >1 real point, otherwise null. */
export function PopupPriceHistory({ historia, precioActual }: Props) {
  const { formatPrice, lang } = usePriceFormat();
  if (!historia || historia.length === 0) return null;

  const seen = new Set<string>();
  const puntos = historia
    .filter((h) => {
      const k = `${h.fecha}|${h.precio}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (puntos.length < 2) return null;

  const fmtFecha = (iso: string) =>
    formatDate(new Date(`${iso}T12:00:00`), lang, { day: "2-digit", month: "short" });

  const todayLabel = lang === "en" ? "Today" : "Hoy";
  const chartData = puntos.map((h) => ({
    fecha: fmtFecha(h.fecha),
    precio: h.precio,
  }));
  if (precioActual) {
    chartData.push({ fecha: todayLabel, precio: precioActual });
  }
  const ultimo = chartData[chartData.length - 1];

  return (
    <section className="space-y-1.5" aria-label="Historial de precio">
      <h3 className="text-xs font-semibold" style={{ color: "#111418" }}>Historial de precio</h3>
      <div className="overflow-hidden rounded-lg" style={{ border: "0.5px solid #E5E0D5", background: "#FFFFFF" }}>
        <div className="px-1 pb-1 pt-2" style={{ height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
              <XAxis dataKey="fecha" tick={{ fontSize: 9, fill: "#6E726E" }} tickLine={false} axisLine={false} />
              <YAxis hide domain={["auto", "auto"]} />
              <RechartsTooltip
                formatter={(val: unknown) => [formatPrice(Number(val)), lang === "en" ? "Price" : "Precio"]}
                contentStyle={{ background: "#111418", border: "none", borderRadius: 8, color: "#fff", fontSize: 11 }}
                labelStyle={{ color: "rgba(255,255,255,0.7)", fontSize: 10 }}
              />
              <Line
                type="monotone"
                dataKey="precio"
                stroke="#0F8A4F"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#0F8A4F", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "#0F8A4F" }}
              />
              {precioActual ? (
                <ReferenceDot x={todayLabel} y={ultimo.precio} r={4} fill="#CE1126" stroke="#fff" strokeWidth={2} />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
