import { expect, type Page } from "@playwright/test";

// La API vive en otro host (Railway), no bajo el dominio del sitio.
export const API = () => process.env.QC_API_URL ?? "https://medellinsocial-api.up.railway.app/api/v1";

export const SUBMIT = process.env.QC_SUBMIT === "1";
export const QC_TAG = "[QC-TEST]";

/** Abre una página y falla si hay errores de JS o requests 5xx a la API. */
export async function openClean(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/v1/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `HTTP de ${path}`).toBeLessThan(400);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  return () => expect(errors, `errores en ${path}`).toEqual([]);
}

/** Saca el tour/onboarding si aparece, para que no tape los clicks. */
export async function dismissOverlays(page: Page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("home_tour_seen", "true");
      localStorage.setItem("map_tour_seen", "true");
    } catch { /* storage bloqueado */ }
  });
}

/** Primera visita a /map: el sitio pregunta "¿Qué estás buscando?" — elegir Residencial. */
export async function pickSegment(page: Page) {
  const btn = page.getByRole("button", { name: /Residencial|Residential/ }).filter({ hasText: /casas|houses/i });
  if (await btn.first().isVisible({ timeout: 8_000 }).catch(() => false)) await btn.first().click();
}
