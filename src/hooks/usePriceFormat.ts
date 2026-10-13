import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLang } from "@/lib/i18n";
import { useTrm } from "@/hooks/useTrm";
import { useUnit } from "@/hooks/useUnit";
import {
  type Currency,
  formatCompact,
  formatMoney,
  formatPerArea,
  copToUsd,
  usdToCop,
} from "@/lib/format";
import { getStoredCurrency, setStoredCurrency, subscribeCurrency } from "@/lib/currency";

/**
 * One price formatter for list, card, map popup, drawer and detail.
 * - currency = the user's explicit choice, else en -> USD / es -> COP.
 * - USD needs the single TRM (useTrm); until it loads we keep showing COP
 *   (effectiveCurrency === "COP") rather than inventing a rate.
 */
export function usePriceFormat() {
  const { lang } = useLang();
  const { valor: trm, isReady } = useTrm();
  const { unit } = useUnit();
  const stored = useSyncExternalStore(subscribeCurrency, getStoredCurrency, () => null);
  const preferred: Currency = stored ?? (lang === "en" ? "USD" : "COP");
  const currency: Currency = preferred === "USD" && !isReady ? "COP" : preferred;

  const toDisplay = useCallback(
    (cop: number): number => (currency === "USD" && trm ? copToUsd(cop, trm) : cop),
    [currency, trm],
  );
  /** typed value in the display currency -> COP (canonical). */
  const toCop = useCallback(
    (v: number): number => (currency === "USD" && trm ? usdToCop(v, trm) : Math.round(v)),
    [currency, trm],
  );
  const formatPrice = useCallback(
    (cop: number | null | undefined, opts?: { suffix?: boolean }): string =>
      cop == null || !Number.isFinite(cop) || cop <= 0
        ? "—"
        : formatMoney(toDisplay(cop), currency, lang, opts),
    [currency, lang, toDisplay],
  );
  /** Same amount in the OTHER currency (for "~$X USD" secondary lines); null if unavailable. */
  const formatSecondary = useCallback(
    (cop: number | null | undefined): string | null => {
      if (cop == null || !Number.isFinite(cop) || cop <= 0) return null;
      if (currency === "COP") return trm ? `~${formatMoney(copToUsd(cop, trm), "USD", lang)}` : null;
      return `~${formatMoney(cop, "COP", lang)}`;
    },
    [currency, lang, trm],
  );
  const formatPriceCompact = useCallback(
    (cop: number | null | undefined): string =>
      cop == null || !Number.isFinite(cop) ? "—" : formatCompact(toDisplay(cop), lang),
    [lang, toDisplay],
  );
  const formatPricePerArea = useCallback(
    (copPerM2: number | null | undefined): string =>
      copPerM2 == null || !Number.isFinite(copPerM2) || copPerM2 <= 0
        ? "—"
        : formatPerArea(toDisplay(copPerM2), currency, unit, lang),
    [currency, lang, toDisplay, unit],
  );

  return useMemo(
    () => ({
      currency,
      preferredCurrency: preferred,
      setCurrency: setStoredCurrency,
      trm,
      trmReady: isReady,
      lang,
      unit,
      toDisplay,
      toCop,
      formatPrice,
      formatSecondary,
      formatPriceCompact,
      formatPricePerArea,
    }),
    [currency, preferred, trm, isReady, lang, unit, toDisplay, toCop, formatPrice, formatSecondary, formatPriceCompact, formatPricePerArea],
  );
}
