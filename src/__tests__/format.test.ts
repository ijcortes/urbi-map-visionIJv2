import { describe, it, expect } from "vitest";
import {
  formatCOP,
  formatUSD,
  formatMoney,
  formatCompact,
  formatPerArea,
  formatPct,
  parsePriceInput,
  yieldColor,
  usdToCop,
} from "@/lib/format";
import { appendPriceParams } from "@/lib/adapters";

describe("formatCOP (exact, never rounded to K/M)", () => {
  it("400K COP stays exact", () => {
    expect(formatCOP(400_000, "es")).toBe("$400.000 COP");
    expect(formatCOP(400_000, "en")).toBe("$400,000 COP");
  });
  it("2.5M COP is not rounded to $3M", () => {
    expect(formatCOP(2_500_000, "es")).toBe("$2.500.000 COP");
    expect(formatCOP(1_200_000, "es")).toBe("$1.200.000 COP");
  });
  it("large values keep every digit", () => {
    expect(formatCOP(300_000_000, "es")).toMatch(/300\.000\.000/);
  });
  it("null / NaN price renders a dash, never $0", () => {
    expect(formatCOP(null)).toBe("—");
    expect(formatCOP(undefined)).toBe("—");
    expect(formatCOP(Number.NaN)).toBe("—");
  });
  it("formats zero without crashing", () => {
    expect(() => formatCOP(0)).not.toThrow();
  });
  it("puts the minus sign before the $", () => {
    expect(formatCOP(-344_400, "es")).toBe("-$344.400 COP");
    expect(formatCOP(-2_500_000, "es")).toBe("-$2.500.000 COP");
    expect(formatCOP(-500, "es")).toBe("-$500 COP");
  });
});

describe("formatUSD (exact)", () => {
  it("1,200 USD is $1,200 not $1k", () => {
    expect(formatUSD(1_200, "en")).toBe("$1,200 USD");
  });
  it("1,550 USD is not rounded to $2k", () => {
    expect(formatUSD(1_550, "en")).toBe("$1,550 USD");
  });
  it("400 USD is not $0k", () => {
    expect(formatUSD(400, "en")).toBe("$400 USD");
  });
});

describe("formatCompact (slider chips only)", () => {
  it("never yields 0K or $0M for non-zero amounts", () => {
    for (const v of [1, 50, 400, 499, 500, 999, 1_000, 400_000, 999_499, 999_500, 999_999, 1_000_000]) {
      const out = formatCompact(v, "en");
      expect(out).not.toMatch(/\$0(\.0)?[KM]/);
      expect(out).not.toBe("$0");
    }
  });
  it("exact below 1K", () => {
    expect(formatCompact(500, "en")).toBe("$500");
  });
  it("K with one decimal below 1M, promotes to M instead of 1000K", () => {
    expect(formatCompact(400_000, "en")).toBe("$400K");
    expect(formatCompact(344_400, "en")).toBe("$344.4K");
    expect(formatCompact(999_600, "en")).toBe("$1M");
  });
  it("M with one decimal", () => {
    expect(formatCompact(2_500_000, "en")).toBe("$2.5M");
    expect(formatCompact(2_500_000, "es")).toBe("$2,5M");
  });
  it("null -> dash", () => {
    expect(formatCompact(null)).toBe("—");
  });
});

describe("price per area", () => {
  it("is exact per m2 and converts to ft2", () => {
    expect(formatPerArea(4_500_000, "COP", "m2", "es")).toBe("$4.500.000/m²");
    expect(formatPerArea(4_500_000, "COP", "sqft", "en")).toBe("$418,064/ft²");
  });
});

describe("TRM / currency conversion", () => {
  it("TRM not loaded -> caller keeps COP; USD conversion helpers need a rate", () => {
    // usePriceFormat falls back to COP when trm === null; the pure helper formats whatever it is given
    expect(formatMoney(2_500_000, "COP", "en")).toBe("$2,500,000 COP");
  });
  it("USD typed -> COP uses the single TRM", () => {
    expect(usdToCop(1_200, 4_000)).toBe(4_800_000);
  });
});

describe("parsePriceInput", () => {
  it("accepts 2,500 / 2.500 / 2500 / spaces / symbols", () => {
    expect(parsePriceInput("2,500")).toBe(2500);
    expect(parsePriceInput("2.500")).toBe(2500);
    expect(parsePriceInput("2500")).toBe(2500);
    expect(parsePriceInput("$ 2 500 000")).toBe(2_500_000);
  });
  it("empty / garbage -> null", () => {
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
  });
});

describe("appendPriceParams (moneda adapter)", () => {
  it("falls back to COP-converted values when the backend lacks moneda", () => {
    const p = new URLSearchParams();
    appendPriceParams(p, 4_800_000, 10_000_000, { currency: "USD", trm: 4000, supportsMoneda: false });
    expect(p.get("precio_min")).toBe("4800000");
    expect(p.get("moneda")).toBeNull();
  });
  it("sends moneda=USD with USD values when supported", () => {
    const p = new URLSearchParams();
    appendPriceParams(p, 4_800_000, 10_000_000, { currency: "USD", trm: 4000, supportsMoneda: true });
    expect(p.get("moneda")).toBe("USD");
    expect(p.get("precio_min")).toBe("1200");
    expect(p.get("precio_max")).toBe("2500");
  });
  it("sends COP when TRM is not loaded even if USD is chosen", () => {
    const p = new URLSearchParams();
    appendPriceParams(p, 4_800_000, null, { currency: "USD", trm: null, supportsMoneda: true });
    expect(p.get("moneda")).toBe("COP");
    expect(p.get("precio_min")).toBe("4800000");
    expect(p.get("precio_max")).toBeNull();
  });
});

describe("formatPct", () => {
  it("appends % sign", () => {
    expect(formatPct(7.5)).toContain("%");
  });
});

describe("yieldColor", () => {
  it("returns a CSS color string", () => {
    expect(yieldColor(8)).toMatch(/^#|^rgb/);
  });
  it("handles zero yield", () => {
    expect(() => yieldColor(0)).not.toThrow();
  });
});
