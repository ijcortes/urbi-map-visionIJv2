// Single source of truth for money / area / date formatting.
// Rules: exact values for card, popup, drawer and detail (no rounding to K/M);
// compact output is only for slider chips and never yields "$0"/"0K" for
// non-zero amounts. Number/date locale follows the UI language (es-CO / en-US).

export type Currency = "COP" | "USD";
export type FmtLang = "es" | "en";

let _lang: FmtLang = "es";
/** Called by the LanguageProvider so non-hook callers use the right locale. */
export function setFormatLang(l: FmtLang): void {
  _lang = l === "en" ? "en" : "es";
}
export function getFormatLang(): FmtLang {
  return _lang;
}
export function numberLocale(lang: FmtLang = _lang): string {
  return lang === "en" ? "en-US" : "es-CO";
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, maxFrac = 0): Intl.NumberFormat {
  const k = `${locale}|${maxFrac}`;
  let f = nfCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 });
    nfCache.set(k, f);
  }
  return f;
}

export function formatNumber(n: number, lang: FmtLang = _lang, maxFrac = 0): string {
  if (!Number.isFinite(n)) return "—";
  return nf(numberLocale(lang), maxFrac).format(n);
}

const MISSING = "—";

/** Exact money, e.g. "$2.500.000 COP" (es) / "$1,200 USD" (en). Null/NaN -> "—". */
export function formatMoney(
  amount: number | null | undefined,
  currency: Currency,
  lang: FmtLang = _lang,
  opts: { suffix?: boolean } = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return MISSING;
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const body = nf(numberLocale(lang)).format(Math.abs(rounded));
  const suffix = opts.suffix === false ? "" : ` ${currency}`;
  return `${sign}$${body}${suffix}`;
}

export function formatCOP(n: number | null | undefined, lang: FmtLang = _lang): string {
  return formatMoney(n, "COP", lang);
}
export function formatUSD(n: number | null | undefined, lang: FmtLang = _lang): string {
  return formatMoney(n, "USD", lang);
}

/**
 * Compact label for slider chips only. Exact below 1K, K with <=1 decimal below 1M
 * (promotes to M instead of "1000K"), M with <=1 decimal otherwise. Never "0K"/"$0M"
 * for a non-zero amount.
 */
export function formatCompact(amount: number | null | undefined, lang: FmtLang = _lang): string {
  if (amount == null || !Number.isFinite(amount)) return MISSING;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs < 1_000) return `${sign}$${nf(numberLocale(lang), abs < 1 && abs > 0 ? 2 : 0).format(abs)}`;
  const one = nf(numberLocale(lang), 1);
  if (abs < 999_500) {
    const k = Math.round((abs / 1_000) * 10) / 10;
    if (k < 1000) return `${sign}$${one.format(k)}K`;
  }
  const m = Math.round((abs / 1_000_000) * 10) / 10;
  if (m >= 1000) return `${sign}$${nf(numberLocale(lang)).format(Math.round(m))}M`;
  return `${sign}$${one.format(m)}M`;
}

export const M2_PER_FT2 = 10.7639;

/** Price per area, exact: per m² (es) or per ft² (en), amount already in `currency`. */
export function formatPerArea(
  perM2: number | null | undefined,
  currency: Currency,
  unit: "m2" | "sqft" = "m2",
  lang: FmtLang = _lang,
): string {
  if (perM2 == null || !Number.isFinite(perM2)) return MISSING;
  const v = unit === "sqft" ? perM2 / M2_PER_FT2 : perM2;
  return `${formatMoney(v, currency, lang, { suffix: false })}/${unit === "sqft" ? "ft²" : "m²"}`;
}

/** Parse a typed price: "2,500" / "2.500" / "$ 2 500" -> 2500. Empty/invalid -> null. */
export function parsePriceInput(text: string): number | null {
  const digits = (text ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function copToUsd(cop: number, trm: number): number {
  return cop / trm;
}
export function usdToCop(usd: number, trm: number): number {
  return Math.round(usd * trm);
}

/** Locale-aware date (es-CO / en-US). */
export function formatDate(
  d: Date | string | number | null | undefined,
  lang: FmtLang = _lang,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
): string {
  if (d == null) return MISSING;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return MISSING;
  return date.toLocaleDateString(numberLocale(lang), opts);
}

export function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

export function yieldColor(y: number | null | undefined): string {
  if (y == null) return "#6E726E";
  if (y > 10) return "#0F8A4F";
  if (y >= 7) return "#0A5C36";
  if (y >= 5) return "#8A6A00";
  return "#CE1126";
}

export function yieldLabel(y: number | null | undefined): string {
  if (y == null) return "Sin datos";
  if (y > 10) return "Excelente";
  if (y >= 7) return "Bueno";
  if (y >= 5) return "Moderado";
  return "Bajo";
}
