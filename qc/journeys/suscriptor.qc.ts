import { test, expect } from "@playwright/test";
import { openClean, dismissOverlays, SUBMIT, QC_TAG, API } from "./_helpers";

// Agente "suscriptor": entra al home, explora un barrio, busca eventos y
// (con QC_SUBMIT=1) se suscribe, publica un evento y un artículo.
test.describe("suscriptor", () => {
  test("home → barrio → eventos", async ({ page }) => {
    let check = await openClean(page, "/");
    await dismissOverlays(page);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("#explorar")).toBeVisible();
    await expect(page.locator("#subscribe")).toBeAttached();
    check();

    await page.locator('#explorar a[href^="/barrio/"]').first().click();
    await expect(page).toHaveURL(/\/barrio\//);
    check = await openClean(page, page.url().replace(/^https?:\/\/[^/]+/, ""));
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

  // La suscripción vive en GHL (ver ghl.qc.ts). Acá solo el artículo, que queda
  // en la cola de moderación del sitio.
  test("envía un artículo de prueba a moderación", async ({ request }) => {
    test.skip(!SUBMIT, "QC_SUBMIT apagado");
    const stamp = Date.now();
    const post = await request.post(`${API()}/comunidad/posts`, {
      data: { autor_nombre: `${QC_TAG} bot`, autor_email: `qc+${stamp}@medellinsocial.com`,
              titulo: `${QC_TAG} artículo ${stamp}`, cuerpo: "Prueba automática diaria del equipo de QC. No publicar." },
    });
    expect(post.status(), "artículo").toBeLessThan(300);
    expect((await post.json()).estado, "el artículo debe quedar en moderación").not.toBe("aprobado");
  });
});
