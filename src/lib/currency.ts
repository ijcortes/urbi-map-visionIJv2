// User's explicit display-currency choice (COP | USD), independent of UI language.
// Stored in localStorage + cookie, synced across tabs. When nothing was chosen,
// usePriceFormat falls back to the UI-language default (en -> USD, es -> COP).
import type { Currency } from "./format";

export const CURRENCY_KEY = "medellin-social.currency";
const listeners = new Set<() => void>();

export function parseCurrency(v: unknown): Currency | null {
  return v === "COP" || v === "USD" ? v : null;
}

export function getStoredCurrency(): Currency | null {
  if (typeof window === "undefined") return null;
  try {
    return parseCurrency(window.localStorage.getItem(CURRENCY_KEY));
  } catch {
    return null;
  }
}

export function setStoredCurrency(c: Currency | null): void {
  if (typeof window === "undefined") return;
  try {
    if (c) window.localStorage.setItem(CURRENCY_KEY, c);
    else window.localStorage.removeItem(CURRENCY_KEY);
    document.cookie = `${CURRENCY_KEY}=${c ?? ""}; path=/; max-age=${c ? 31536000 : 0}; SameSite=Lax`;
  } catch {
    /* storage blocked: choice lives for this session only */
  }
  listeners.forEach((l) => l());
}

export function subscribeCurrency(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CURRENCY_KEY || e.key === null) cb();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
