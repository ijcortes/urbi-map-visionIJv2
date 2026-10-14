import { describe, it, expect } from "vitest";
import { mapTourReady } from "@/lib/segmento";

describe("map tour vs segment gate", () => {
  it("never opens while the gate is pending or open", () => {
    expect(mapTourReady("pending", true, false)).toBe(false);
    expect(mapTourReady("open", true, false)).toBe(false);
  });
  it("opens once the gate is done, data is loaded and it is not a deep link", () => {
    expect(mapTourReady("done", true, false)).toBe(true);
    expect(mapTourReady("done", false, false)).toBe(false);
    expect(mapTourReady("done", true, true)).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { PHRASES } from "@/lib/i18n-phrases";

describe("map legend + studio label regressions", () => {
  it("translates the legend labels to EN", () => {
    const m = new Map(PHRASES as [string, string][]);
    expect(m.get("Tipos")).toBe("Types");
    expect(m.get("Cerrar leyenda")).toBe("Close legend");
  });
  it("shows Studio (not '0 hab') in popup, drawer and card", () => {
    for (const f of ["components/FloatingPanel.tsx", "components/ListingDrawer.tsx", "components/MLSPanel.tsx"]) {
      expect(readFileSync(`src/${f}`, "utf8")).toContain('=== 0 ? "Studio"');
    }
  });
});
