import { test, expect } from "@playwright/test";
import { openClean, openMap, API } from "./_helpers";

// Agente "buscador de propiedades": mapa, filtros, tipos de propiedad, detalle
// de un listing y que su link original siga vivo.
const TIPOS = ["apartamento", "casa", "local"];

test.describe("buscador de propiedades", () => {
  test("mapa carga y muestra listings de una comuna", async ({ page, isMobile }) => {
    const check = await openMap(page);
    await expect(page.locator(".mapboxgl-canvas").first()).toBeVisible();
    // En celular la lista está detrás del botón "Lista".
    if (isMobile) await page.getByRole("button", { name: /^(Lista|List)$/ }).click();
    await expect(page.locator('[data-tour="listing-card"]').first()).toBeVisible({ timeout: 30_000 });
    check();
  });

  for (const tipo of TIPOS) {
    test(`API devuelve listings tipo ${tipo} @api`, async ({ request }) => {
      const r = await request.get(`${API}/listings?cd_comuna=14&tipo_inmueble=${tipo}&limit=5`);
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(Array.isArray(body.listings)).toBe(true);
    });
  }

  test("detalle de un listing abre y tiene precio @api", async ({ page, request }) => {
    const r = await request.get(`${API}/listings?cd_comuna=14&limit=1`);
    const l = (await r.json()).listings?.[0];
    test.skip(!l, "sin listings en El Poblado");
    const check = await openClean(page, `/listing/${l.id}`);
    await expect(page.locator("body")).toContainText(/\$|COP|USD/);
    check();
    if (l.url) {
      const src = await request.get(l.url, { maxRedirects: 5, failOnStatusCode: false });
      expect(src.status(), `link original ${l.url}`).toBeLessThan(400);
    }
  });

  test("filtro de precio tiene botón Aplicar", async ({ page, isMobile }) => {
    test.skip(isMobile, "en móvil los filtros van en hoja completa");
    await openMap(page);
    await page.locator(".map-filter-pill").first().click();
    const aplicar = page.getByRole("button", { name: /Aplicar|Apply/ });
    await expect(aplicar).toBeVisible();
    await aplicar.click();
    await expect(aplicar).toHaveCount(0);
  });
});
