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

  const btn = "flex min-h-[56px] w-full flex-col items-start rounded-xl border px-4 py-3 text-left transition";
  return (
    <div
      data-testid="segment-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="segment-gate-title"
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 p-3 sm:items-center"
      onClick={() => onChoose("residencial")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <h2 id="segment-gate-title" className="text-lg font-semibold text-neutral-900">¿Qué estás buscando?</h2>
        <p className="mt-1 text-sm text-neutral-600">Elige el tipo de inmueble. Puedes cambiarlo cuando quieras.</p>
        <div className="mt-4 grid gap-3">
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
