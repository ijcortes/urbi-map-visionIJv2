import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X } from "@/lib/icons";
import { useComparadorStore, MAX_COMPARADOR } from "@/hooks/useComparadorStore";
import { useIsAgente } from "@/components/LockedField";
import type { ApiListing } from "@/lib/adapters";

const LS_EXPLAINED = "comparador_explicado";

// ─── Onboarding popup (primera vez) ──────────────────────────────────────────

export function ComparadorOnboarding({ onClose }: { onClose: () => void }) {
  const [noMostrar, setNoMostrar] = useState(false);

  function handleClose() {
    if (noMostrar) localStorage.setItem(LS_EXPLAINED, "1");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
        style={{ background: "#FAF8F3", border: "0.5px solid #E5E0D5" }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="font-display text-lg font-semibold text-[#111418]">
            ¿Cómo funciona el comparador?
          </h2>
          <button onClick={handleClose} aria-label="Cerrar" className="grid h-11 w-11 place-items-center text-[#6E726E] hover:text-[#111418]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {[
            { emoji: "🗺️", text: "Navega por el mapa y encuentra inmuebles que te interesen" },
            { emoji: "➕", text: 'Haz click en "+" en los que quieras comparar' },
            { emoji: "📊", text: "Selecciona entre 2 y 5 inmuebles" },
            { emoji: "✓", text: 'Presiona "Comparar" para ver el análisis lado a lado' },
          ].map(({ emoji, text }, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-xl leading-tight">{emoji}</span>
              <p className="text-sm text-[#5B5F5C]">{text}</p>
            </div>
          ))}
        </div>

        <label className="mt-5 flex items-center gap-2 text-xs text-[#6E726E]">
          <input
            type="checkbox"
            checked={noMostrar}
            onChange={(e) => setNoMostrar(e.target.checked)}
            className="accent-[#0F8A4F]"
          />
          No volver a mostrar
        </label>

        <button
          onClick={handleClose}
          className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: "#0F8A4F" }}
        >
          Entendido →
        </button>
      </div>
    </div>
  );
}

// ─── Modal "¿Comparar o agregar más?" (al llegar a 2 seleccionados) ──────────

function ComparadorPromptModal({
  onAgregar,
  onComparar,
}: {
  onAgregar: () => void;
  onComparar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
    >
      <div
        className="w-full max-w-xs rounded-2xl p-5 shadow-2xl"
        style={{ background: "#FAF8F3", border: "0.5px solid #E5E0D5" }}
      >
        <p className="mb-4 text-center text-sm font-semibold text-[#111418]">
          ¿Qué quieres hacer?
        </p>
        <div className="space-y-2">
          <button
            onClick={onAgregar}
            className="w-full rounded-xl py-2.5 text-sm font-medium transition hover:bg-[#F3F0E8]"
            style={{ border: "0.5px solid #E5E0D5", color: "#5B5F5C" }}
          >
            + Agregar más (máx. {MAX_COMPARADOR})
          </button>
          <button
            onClick={onComparar}
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: "#0F8A4F" }}
          >
            Comparar ahora →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Thumbnail del listing en el badge ───────────────────────────────────────

function Thumb({ listing }: { listing: ApiListing }) {
  return (
    <div
      className="h-8 w-8 shrink-0 overflow-hidden rounded-md"
      style={{ border: "1.5px solid rgba(255,255,255,0.3)" }}
    >
      {listing.foto_principal ? (
        <img src={listing.foto_principal} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-[10px]"
          style={{ background: "#0F8A4F", color: "#fff" }}
        >
          🏠
        </div>
      )}
    </div>
  );
}

// ─── Badge flotante principal ─────────────────────────────────────────────────

export function ComparadorBadge() {
  const isAgente = useIsAgente();
  const navigate = useNavigate();
  const { listings, clearAll } = useComparadorStore();

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [prevCount, setPrevCount] = useState(listings.length);

  // Show first-time onboarding when user first adds a listing
  useEffect(() => {
    if (listings.length === 1 && prevCount === 0) {
      const explained = localStorage.getItem(LS_EXPLAINED);
      if (!explained) setShowOnboarding(true);
    }
    // Show "comparar o agregar" prompt when reaching exactly 2
    if (listings.length === 2 && prevCount === 1) {
      const explained = localStorage.getItem(LS_EXPLAINED);
      if (explained) setShowPrompt(true);
    }
    setPrevCount(listings.length);
  }, [listings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAgente || listings.length === 0) return null;

  const slots = Array.from({ length: MAX_COMPARADOR });

  function goToComparador() {
    const ids = listings.map((l) => l.id).join(",");
    navigate({ to: "/comparador", search: { listings: ids } as any });
  }

  return (
    <>
      {showOnboarding && (
        <ComparadorOnboarding
          onClose={() => {
            setShowOnboarding(false);
            localStorage.setItem(LS_EXPLAINED, "1");
          }}
        />
      )}

      {showPrompt && (
        <ComparadorPromptModal
          onAgregar={() => setShowPrompt(false)}
          onComparar={() => {
            setShowPrompt(false);
            goToComparador();
          }}
        />
      )}

      {/* Badge flotante */}
      <div
        className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 flex-col gap-2 rounded-2xl px-4 py-3 shadow-2xl"
        style={{
          background: "#111418",
          border: "0.5px solid rgba(255,255,255,0.12)",
          minWidth: 320,
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        {/* Top row: thumbnails + count */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {slots.map((_, i) => {
              const l = listings[i];
              return l ? (
                <Thumb key={l.id} listing={l} />
              ) : (
                <div
                  key={i}
                  className="h-8 w-8 shrink-0 rounded-md"
                  style={{ border: "1.5px dashed rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)" }}
                />
              );
            })}
          </div>
          <span className="flex-1 text-center text-xs font-medium text-white/80">
            {listings.length} inmueble{listings.length !== 1 ? "s" : ""} seleccionado{listings.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Bottom row: Limpiar + Comparar */}
        <div className="flex gap-2">
          <button
            onClick={clearAll}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white/60 transition hover:text-white/90"
            style={{ border: "0.5px solid rgba(255,255,255,0.15)" }}
          >
            Limpiar
          </button>
          <button
            onClick={goToComparador}
            className="flex-1 rounded-lg py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            style={{ background: "#0F8A4F" }}
            disabled={listings.length < 2}
          >
            {listings.length < 2 ? `Agrega ${2 - listings.length} más` : "Comparar →"}
          </button>
        </div>
      </div>
    </>
  );
}
