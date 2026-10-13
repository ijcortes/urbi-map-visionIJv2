import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateString, __i18nInternals } from "./i18n";

// Scans the Spanish literals the MAP PAGE components render (placeholders, aria-labels,
// titles, JSX text) and fails when one has no English translation. Prevents Spanish/
// Spanglish regressions like "Precio mínimo" -> "Price mínimo".
const FILES = [
  "components/MapFilterBar.tsx",
  "components/MLSPanel.tsx",
  "components/ListingMiniPopup.tsx",
  "components/listing-popup/ListingPopup.tsx",
  "components/listing-popup/PopupPriceHistory.tsx",
];

const SPANISH_HINT = /[áéíóúñ¿¡Ñ]|(?:^|\s)(?:el|la|los|las|de|del|para|con|sin|por|más|tu|un|una|que|en|al|este|esta)(?:\s|$)/i;
// Literals that are intentionally data/brand/format strings, not UI copy.
const IGNORE = [/^https?:/, /^[\w./-]+$/, /\$\{/, /^\s*$/];
// Known remaining gaps (tracked, not hidden): shrink this list, never grow it.
const KNOWN_GAPS = new Set<string>([]);

function literals(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:placeholder|aria-label|title|alt)="([^"{}]+)"/g)) out.push(m[1]);
  for (const m of src.matchAll(/>\s*([^<>{}\n]*[A-Za-zÁÉÍÓÚáéíóúñ][^<>{}\n]*?)\s*</g)) out.push(m[1]);
  return out.map((s) => s.trim()).filter((s) => s.length > 2);
}

describe("map-page component literals are translatable", () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      const missing = [...new Set(literals(src))]
        .filter((s) => SPANISH_HINT.test(s) && !IGNORE.some((r) => r.test(s)))
        .filter((s) => translateString(s) === s && !KNOWN_GAPS.has(s) && !__i18nInternals.PROTECT.has(s));
      expect(missing).toEqual([]);
    });
  }
});
