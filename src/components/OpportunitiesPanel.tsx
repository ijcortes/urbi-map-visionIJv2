import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Flame, MapPin } from "@/lib/icons";
import { LIQUIDITY_COLORS } from "@/data/marketActivity";
import type { Neighborhood } from "@/lib/adapters";
import { useOportunidades } from "@/hooks/useOportunidades";
import { useBarriosRaw } from "@/hooks/useBarrios";
import { barrioToNeighborhood } from "@/lib/adapters";
import { AutoTranslate } from "@/lib/i18n";

type Props = {
  onSelect: (n: Neighborhood) => void;
  perfil?: string;
  mostrarOportunidades?: boolean;
};

export function OpportunitiesPanel({ onSelect, perfil, mostrarOportunidades = false }: Props) {
  const [open, setOpen] = useState(true);
  const { data: oportunidades = [] } = useOportunidades(perfil);
  const { data: barriosRaw = [] } = useBarriosRaw(perfil);

  if (!mostrarOportunidades) return null;

  function handleVerEnMapa(barrio_id: number | undefined, barrio: string) {
    if (barrio_id !== undefined) {
      const b = barriosRaw.find((x) => x.barrio_id === barrio_id);
      if (b) { onSelect(barrioToNeighborhood(b)); return; }
    }
    // fallback: match by name
    const b = barriosRaw.find((x) => (x.nombre ?? "").toUpperCase() === barrio);
    if (b) onSelect(barrioToNeighborhood(b));
  }

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-20 hidden w-[340px] overflow-hidden rounded-2xl border border-border bg-surface/85 shadow-2xl backdrop-blur-xl md:block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-4 py-3 text-left transition hover:bg-background/30"
      >
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Flame className="h-4 w-4 text-warning" />
            Oportunidades detectadas ({oportunidades.length})
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">Según tu perfil de inversión</div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="max-h-[55dvh] overflow-y-auto"
          >
            <div className="divide-y divide-border/60">
              {oportunidades.map((opp, i) => {
                const liq = LIQUIDITY_COLORS[opp.liquidez] ?? LIQUIDITY_COLORS["MEDIA"];
                return (
                  <motion.div
                    key={opp.barrio_id ?? opp.barrio}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="px-4 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{opp.emoji}</span>
                      <span className="font-display text-sm font-semibold">{titleCase(opp.barrio)}</span>
                    </div>
                    <div
                      className="mt-1.5 inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                      style={{ borderColor: opp.color, color: opp.color, background: `${opp.color}15` }}
                    >
                      {opp.tipo}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">"<AutoTranslate text={opp.descripcion} />"</p>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        Score <span className="font-semibold text-foreground">{opp.score}</span>
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        Liquidez{" "}
                        <span
                          className="rounded px-1 py-0.5 text-[10px] font-semibold"
                          style={{ color: liq.border, background: liq.bg }}
                        >
                          {opp.liquidez}
                        </span>
                      </span>
                    </div>
                    <button
                      onClick={() => handleVerEnMapa(opp.barrio_id, opp.barrio)}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary transition hover:text-primary/80"
                    >
                      <MapPin className="h-3 w-3" /> Ver en mapa →
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
