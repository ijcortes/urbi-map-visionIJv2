import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { buildViewportParams, appendFilterParams, appendZoneParams, viewportCacheKey, roundCoord } from "@/lib/listingParams";
import { getStoredSegmento, setStoredSegmento, pruneTiposForSegmento, TIPOS_POR_SEGMENTO } from "@/lib/segmento";
import { SegmentGate } from "@/components/SegmentGate";
import { originalListingUrl } from "@/lib/originalListing";
import { OriginalListingLink } from "@/components/OriginalListingLink";
import { matchAliases } from "@/lib/barrioSearch";
import { validateGhlUrl, PLAN_PRICES } from "@/config/ghl";
import { BREAKPOINTS, isMobileWidth } from "@/lib/breakpoints";

const bounds = { west: -75.60012, south: 6.20049, east: -75.5, north: 6.3 };
const src = (p: string) => readFileSync(`${process.cwd()}/src/${p}`, "utf8");

describe("filter state -> API params", () => {
  it("sends segmento, ocultar_destacados, moneda and never compact", () => {
    const p = buildViewportParams({
      bounds, zoom: 11.7,
      filters: { segmento: "comercial", ocultarDestacados: true, precioMax: 500 },
      zone: {}, price: { currency: "USD", trm: 4000, supportsMoneda: true },
    });
    expect(p.get("segmento")).toBe("comercial");
    expect(p.get("ocultar_destacados")).toBe("true");
    expect(p.has("compact")).toBe(false); // would strip photos/barrio/municipio the cards+popups render
    expect(p.get("zoom")).toBe("11");
    expect(p.get("moneda")).toBe("USD");
    expect(p.has("zona_completa")).toBe(false);
  });
  it("omits ocultar_destacados when off", () => {
    const p = new URLSearchParams();
    appendFilterParams(p, { segmento: "residencial", ocultarDestacados: false });
    expect(p.has("ocultar_destacados")).toBe(false);
  });
  it("zona_completa only for an explicit zone", () => {
    const a = new URLSearchParams(); appendZoneParams(a, {});
    expect(a.has("zona_completa")).toBe(false);
    const b = new URLSearchParams(); appendZoneParams(b, { cdComuna: 14 });
    expect(b.get("zona_completa")).toBe("true");
    expect(b.get("cd_comuna")).toBe("14");
  });
  it("rounds bounds and ignores bbox in key for explicit zone", () => {
    expect(roundCoord(-75.60012)).toBe(-75.6);
    const z = { barrioId: 5 };
    const k1 = viewportCacheKey(buildViewportParams({ bounds, zoom: 12, filters: {}, zone: z }), z);
    const k2 = viewportCacheKey(buildViewportParams({ bounds: { ...bounds, west: -75.7 }, zoom: 12, filters: {}, zone: z }), z);
    expect(k1).toBe(k2);
    const f1 = viewportCacheKey(buildViewportParams({ bounds, zoom: 12, filters: {}, zone: {} }), {});
    const f2 = viewportCacheKey(buildViewportParams({ bounds: { ...bounds, west: -75.7 }, zoom: 12, filters: {}, zone: {} }), {});
    expect(f1).not.toBe(f2);
  });
});

describe("segment gate", () => {
  beforeEach(() => { cleanup(); localStorage.clear(); });
  it("persists and reads the segment", () => {
    expect(getStoredSegmento()).toBeNull();
    setStoredSegmento("comercial");
    expect(getStoredSegmento()).toBe("comercial");
  });
  it("prunes tipos and has no apartaestudio", () => {
    expect(pruneTiposForSegmento(["apartamento", "local"], "residencial")).toEqual(["apartamento"]);
    expect(pruneTiposForSegmento(["casa"], "comercial")).toBeNull();
    expect(JSON.stringify(TIPOS_POR_SEGMENTO)).not.toMatch(/apartaestudio|studio/i);
  });
  it("renders and reports the choice", () => {
    const onChoose = vi.fn();
    render(<SegmentGate onChoose={onChoose} />);
    fireEvent.click(screen.getByTestId("segment-comercial"));
    expect(onChoose).toHaveBeenCalledWith("comercial");
  });
});

describe("camera never mutates filters (autoSelect removed)", () => {
  it("MapView has no autoSelect props/logic and map.tsx does not wire them", () => {
    const mv = src("components/MapView.tsx"), pg = src("routes/map.tsx");
    expect(mv).not.toMatch(/onAutoSelect/);
    expect(pg).not.toMatch(/onAutoSelect/);
    expect(pg).not.toMatch(/apartaestudio/i);
  });
});

describe("GHL link validation", () => {
  it("accepts only https allowlisted hosts", () => {
    expect(validateGhlUrl("https://pay.leadconnectorhq.com/x", [])).toBeTruthy();
    expect(validateGhlUrl("https://app.gohighlevel.com/x", [])).toBeTruthy();
    expect(validateGhlUrl("http://pay.leadconnectorhq.com/x", [])).toBeNull();
    expect(validateGhlUrl("https://evil.com/leadconnectorhq.com", [])).toBeNull();
    expect(validateGhlUrl("https://leadconnectorhq.com.evil.com/", [])).toBeNull();
    expect(validateGhlUrl("javascript:alert(1)", [])).toBeNull();
    expect(validateGhlUrl("", [])).toBeNull();
    expect(validateGhlUrl("https://pay.mydomain.co/x", ["mydomain.co"])).toBeTruthy();
  });
  it("keeps the existing displayed prices", () => {
    expect(PLAN_PRICES.listing_member?.special).toBe("$149");
    expect(PLAN_PRICES.featured_realtor?.special).toBe("$299");
    expect(PLAN_PRICES.hot_spot?.special).toBe("$199");
    expect(PLAN_PRICES.deal?.special).toBe("$29");
    expect(PLAN_PRICES.business_pro).toBeUndefined();
  });
});

describe("original listing link", () => {
  it("is hidden for propio / missing / non-http", () => {
    expect(originalListingUrl({ url: "https://fincaraiz.com.co/x", fuente: "propio" })).toBeNull();
    expect(originalListingUrl({ url: null, fuente: "fincaraiz" })).toBeNull();
    expect(originalListingUrl({ url: "javascript:x", fuente: "fincaraiz" })).toBeNull();
    expect(originalListingUrl({ url: "https://fincaraiz.com.co/x", fuente: "fincaraiz" })).toContain("fincaraiz");
  });
  it("renders a safe external anchor, nothing when url is null", () => {
    const { rerender, container } = render(<OriginalListingLink listing={{ url: "https://fincaraiz.com.co/x", fuente: "fincaraiz" }} />);
    const a = screen.getByTestId("original-listing-link");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    rerender(<OriginalListingLink listing={{ url: "https://x.co/a", fuente: "propio" }} />);
    expect(container.querySelector("[data-testid=original-listing-link]")).toBeNull();
  });
  it("is wired in drawer, route page, popups and cards", () => {
    for (const f of ["components/ListingDrawer.tsx", "routes/listing.$id.tsx", "components/ListingMiniPopup.tsx", "components/listing-popup/ListingPopup.tsx", "components/MLSPanel.tsx"])
      expect(src(f)).toContain("OriginalListingLink");
  });
});

describe("price display consistency", () => {
  it("card, popup, drawer all format through usePriceFormat (no private formatters)", () => {
    for (const f of ["components/MLSPanel.tsx", "components/ListingDrawer.tsx", "components/listing-popup/ListingPopup.tsx", "components/ListingMiniPopup.tsx"]) {
      const s = src(f);
      expect(s, f).toMatch(/usePriceFormat/);
      expect(s, f).not.toMatch(/toLocaleString\([^)]*(COP|USD|currency)/);
    }
  });
});

describe("barrio alias search", () => {
  const aliases = [
    { alias: "Ciudad del Río", alias_norm: "ciudad del rio", barrio_id: 1, asumido: false },
    { alias: "Provenza", alias_norm: "provenza", barrio_id: 2, asumido: false },
  ];
  it("finds accent-insensitively", () => {
    expect(matchAliases(aliases, "ciudad del río")[0].barrio_id).toBe(1);
    expect(matchAliases(aliases, "Provenza")[0].barrio_id).toBe(2);
  });
});

describe("mobile", () => {
  it("one breakpoint constant", () => {
    expect(BREAKPOINTS.mobile).toBe(768);
    expect(isMobileWidth(375)).toBe(true);
    expect(isMobileWidth(768)).toBe(false);
  });
  it("map root uses dynamic viewport units and never fixed w-screen/h-screen", () => {
    for (const f of ["routes/map.tsx", "components/FloatingPanel.tsx", "components/MapFilterBar.tsx"]) {
      expect(src(f), f).not.toMatch(/\bh-screen\b|\bw-screen\b|\b\d+vh\b/);
    }
  });
});
