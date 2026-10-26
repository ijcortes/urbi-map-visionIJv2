import { test, expect } from "@playwright/test";
import { openClean, API } from "./_helpers";

// Agente "negocio": directorio y ofertas por barrio, formulario para unirse,
// planes de negocio.
test.describe("negocio", () => {
  test("directorio de El Poblado carga", async ({ page }) => {
    const check = await openClean(page, "/local-business/el-poblado");
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    check();
  });

  test("formulario para unirse tiene email", async ({ page }) => {
    const check = await openClean(page, "/negocios/unirse");
    await expect(page.locator('input[type="email"]').first()).toBeAttached();
    check();
  });

  for (const ep of ["business/directorio?ciudad_id=1&cd_comuna=14", "business/deals?ciudad_id=1&cd_comuna=14", "business/planes"]) {
    test(`API ${ep} @api`, async ({ request }) => {
      const r = await request.get(`${API}/${ep}`);
      expect(r.status()).toBe(200);
    });
  }
});
