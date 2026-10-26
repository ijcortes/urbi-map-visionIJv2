import { test, expect } from "@playwright/test";
import { openClean, SUBMIT, QC_TAG, API } from "./_helpers";

// Agente "suscriptor": entra al home, explora un barrio, busca eventos y
// (con QC_SUBMIT=1) manda un artículo. La suscripción vive en GHL (ghl.qc.ts).
test.describe("suscriptor", () => {
  test("home → barrio → eventos", async ({ page }) => {
    const check = await openClean(page, "/");
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("#explorar")).toBeVisible();
    await expect(page.locator("#subscribe")).toBeAttached();

    await page.locator('#explorar a[href^="/barrio/"]').first().click();
    await expect(page).toHaveURL(/\/barrio\//);
    for (const id of ["#eventos", "#real-estate", "#negocios", "#lo-ultimo"]) {
      await expect(page.locator(id), `sección ${id}`).toBeVisible();
    }
    await page.getByRole("searchbox").first().fill("música");
    check();
  });

  test("páginas de eventos y blog cargan", async ({ page }) => {
    for (const path of ["/eventos/el-poblado", "/blog", "/suscribirse"]) {
      const check = await openClean(page, path);
      await expect(page.locator("body")).not.toContainText("Something went wrong");
      check();
    }
  });

  // Queda en la cola de moderación del sitio. @api: corre solo en desktop.
  test("envía un artículo de prueba a moderación @api", async ({ request }) => {
    test.skip(!SUBMIT, "QC_SUBMIT apagado");
    const stamp = Date.now();
    const post = await request.post(`${API}/comunidad/posts`, {
      data: { autor_nombre: `${QC_TAG} bot`, autor_email: `qc+${stamp}@medellinsocial.com`,
              titulo: `${QC_TAG} artículo ${stamp}`, cuerpo: "Prueba automática diaria del equipo de QC. No publicar." },
    });
    expect(post.status(), "artículo").toBeLessThan(300);
    expect((await post.json()).estado, "el artículo debe quedar en moderación").not.toBe("aprobado");
  });
});
