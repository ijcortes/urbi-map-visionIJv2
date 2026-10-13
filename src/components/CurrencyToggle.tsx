import { usePriceFormat } from "@/hooks/usePriceFormat";

// COP | USD display choice, independent of the UI language (persisted).
export function CurrencyToggle({ compact = false }: { compact?: boolean }) {
  const { currency, preferredCurrency, setCurrency, trmReady, lang } = usePriceFormat();
  const opts: Array<"COP" | "USD"> = ["COP", "USD"];
  return (
    <div
      role="group"
      aria-label={lang === "en" ? "Display currency" : "Moneda"}
      data-i18n-skip="true"
      style={{ display: "inline-flex", border: "1px solid #E5E0D5", borderRadius: 8, overflow: "hidden" }}
    >
      {opts.map((c) => {
        const active = (preferredCurrency === c);
        const disabled = c === "USD" && !trmReady;
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={disabled ? (lang === "en" ? "Exchange rate loading…" : "Cargando tasa de cambio…") : undefined}
            onClick={() => setCurrency(c)}
            style={{
              padding: compact ? "2px 8px" : "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              background: active && currency === c ? "#0F8A4F" : active ? "#9fd6b9" : "#fff",
              color: active ? "#fff" : "#33473D",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
