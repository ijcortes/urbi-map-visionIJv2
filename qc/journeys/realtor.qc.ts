import { test, expect } from "@playwright/test";
import { openClean } from "./_helpers";

// Agente "realtor": directorio de agentes, plan de realtor destacado, publicar
// propiedad y login (sin credenciales: solo que el camino esté vivo).
test.describe("realtor", () => {
  for (const path of ["/agentes", "/planes/featured-realtor", "/publicar", "/login", "/agentes/registro"]) {
    test(`carga ${path}`, async ({ page }) => {
      const check = await openClean(page, path);
      await expect(page.locator("main, #root, body").first()).toBeVisible();
      check();
    });
  }
});
