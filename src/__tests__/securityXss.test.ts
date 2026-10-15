import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "@/lib/safeUrl";
import { buildNegocioPopupContent } from "@/lib/negocioPopup";

const K = { ink: "#000", tealDeep: "#066", amarillo: "#fc0", muted: "#777", coral: "#f55", coralLight: "#fee" };
const EVIL = `<img src=x onerror=alert(1)>"'`;

describe("safeHttpUrl", () => {
  it("accepts only http(s)", () => {
    expect(safeHttpUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(safeHttpUrl("http://a.com")).toBe("http://a.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "", "  ", null, undefined, 5]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});

describe("local-business popup (H3)", () => {
  const props = {
    nombre: EVIL, direccion: EVIL, categoria: EVIL, rating_google: 4.5,
    website: "javascript:alert(document.cookie)", foto_url: "data:image/svg+xml,<svg onload=alert(1)>",
    telefono: "300 123", lat: 6.2, lon: -75.5,
  };

  it("renders hostile fields as text, never as markup", () => {
    const root = buildNegocioPopupContent(props, K);
    expect(root.querySelector("img")).toBeNull();            // no injected <img>, foto_url rejected
    expect(root.textContent).toContain(EVIL);                // shown literally
    expect(root.innerHTML).not.toContain("<img");
    expect(root.innerHTML).not.toMatch(/onerror=alert\(1\)>/); // payload only exists entity-escaped
  });

  it("drops non-http(s) website and keeps safe links hardened", () => {
    const root = buildNegocioPopupContent(props, K);
    const hrefs = [...root.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.startsWith("javascript:"))).toBe(false);
    expect(hrefs.length).toBe(2); // WA + Maps, no Web
    for (const a of root.querySelectorAll("a")) expect(a.getAttribute("rel")).toContain("noopener");

    const ok = buildNegocioPopupContent({ ...props, website: "https://ok.example/p?q=1", foto_url: "https://cdn.example/a.jpg" }, K);
    expect([...ok.querySelectorAll("a")].some((a) => a.getAttribute("href") === "https://ok.example/p?q=1")).toBe(true);
    expect(ok.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/a.jpg");
  });
});
