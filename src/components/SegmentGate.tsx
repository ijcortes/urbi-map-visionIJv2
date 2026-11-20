import { useEffect, useRef } from "react";
import type { Segmento } from "@/lib/segmento";

/**
 * Shown BEFORE any result: residential vs commercial. Default = residencial.
 * Esc / backdrop pick the default so the user is never stuck behind the gate.
 */
export function SegmentGate({ onChoose }: { onChoose: (s: Segmento) => void }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onChoose("residencial"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChoose]);

  const btn = "flex min-h-[48px] w-full flex-col items-start rounded-xl border px-3 py-2 text-left transition";
  return (
    <div
      data-testid="segment-gate"
      role="dialog"
      aria-modal="false"
      aria-labelledby="segment-gate-title"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex justify-center p-3"
    >
      <div
        className="pointer-events-auto w-full max-w-xs rounded-2xl bg-white p-4 shadow-2xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <h2 id="segment-gate-title" className="text-lg font-semibold text-neutral-900">¿Qué estás buscando?</h2>
        <p className="mt-1 text-sm text-neutral-600">Elige el tipo de inmueble. Puedes cambiarlo cuando quieras.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            ref={firstRef}
            type="button"
            data-testid="segment-residencial"
            onClick={() => onChoose("residencial")}
            className={`${btn} border-emerald-700 bg-emerald-50`}
          >
            <span className="text-base font-semibold text-neutral-900">Residencial</span>
            <span className="text-sm text-neutral-600">Apartamentos y casas</span>
          </button>
          <button
            type="button"
            data-testid="segment-comercial"
            onClick={() => onChoose("comercial")}
            className={`${btn} border-neutral-300 bg-white hover:bg-neutral-50`}
          >
            <span className="text-base font-semibold text-neutral-900">Comercial</span>
            <span className="text-sm text-neutral-600">Locales, oficinas, bodegas y lotes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
