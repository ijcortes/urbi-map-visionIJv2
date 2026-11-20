// Kit visual compartido del centro de agente (Resumen / Simulador / Comparador).
// Paleta validada con el script de dataviz (colorblind-safe sobre el paper-theme).
export const C = {
  ink: "#111418", sub: "#5B5F5C", muted: "#6E726E", line: "#E7E2D6",
  card: "#FFFFFF", soft: "#F6F3EC", brand: "#0F8A4F",
  good: "#0ca30c", warn: "#fab219", bad: "#d03b3b",
  // rampa azul ordinal (etapas/tiempo) y categórica fija (zonas/series) — no ciclar.
  ramp: ["#86b6ef", "#3987e5", "#256abf", "#0f3f7e"],
  cat: ["#2a78d6", "#1baf7a", "#eda100", "#4a3aa7", "#eb6834", "#e87ba4"],
};

export const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("es-CO") : String(n);
export const fmtCOP = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}MM` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n).toLocaleString("es-CO")}`;
export const pct1 = (v: number | null | undefined, mult = 1) =>
  v == null ? "—" : `${(v * mult).toFixed(1)}%`;

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-5 ${className}`} style={{ background: C.card, border: `1px solid ${C.line}` }}>
      {title && <div className="mb-3 text-[13px] font-semibold tracking-tight" style={{ color: C.ink }}>{title}</div>}
      {children}
    </div>
  );
}

// Gauge circular 0..100 (arco por nivel: verde/ámbar/rojo).
export function Gauge({ value, label, sub, suffix = "" }: { value: number | null; label: string; sub?: string; suffix?: string }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const R = 30, CIRC = 2 * Math.PI * R;
  const dash = v == null ? 0 : CIRC * (v / 100);
  const col = v == null ? C.muted : v >= 66 ? C.brand : v >= 33 ? C.warn : C.bad;
  return (
    <div className="flex flex-col items-center rounded-2xl px-3 py-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="relative" style={{ width: 84, height: 84 }}>
        <svg width={84} height={84} viewBox="0 0 84 84">
          <circle cx={42} cy={42} r={R} fill="none" stroke={C.soft} strokeWidth={7} />
          {v != null && (
            <circle cx={42} cy={42} r={R} fill="none" stroke={col} strokeWidth={7} strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRC}`} transform="rotate(-90 42 42)" />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[19px] font-bold leading-none tabular-nums" style={{ color: C.ink }}>
            {v == null ? "—" : `${Math.round(v)}${suffix}`}
          </span>
        </div>
      </div>
      <div className="mt-2 text-center text-[12px] font-semibold" style={{ color: C.ink }}>{label}</div>
      {sub && <div className="text-center text-[10.5px]" style={{ color: C.muted }}>{sub}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex flex-col justify-center rounded-2xl px-4 py-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.muted }}>{label}</div>
      <div className="mt-1 text-[26px] font-bold leading-none tabular-nums" style={{ color: accent ?? C.ink }}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-snug" style={{ color: C.sub }}>{sub}</div>}
    </div>
  );
}

// Chips segmentados (filtros tipo pill).
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { v: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-xl p-0.5" style={{ background: C.soft, border: `1px solid ${C.line}` }}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition"
          style={value === o.v ? { background: C.card, color: C.ink, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: C.muted }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
