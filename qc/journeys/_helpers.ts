import { expect, type Page } from "@playwright/test";

// La API vive en otro host (Railway), no bajo el dominio del sitio.
export const API = process.env.QC_API_URL ?? "https://medellinsocial-api.up.railway.app/api/v1";
export const SUBMIT = process.env.QC_SUBMIT === "1";
export const QC_TAG = "[QC-TEST]";

/** Vigila errores de JS y 5xx de la API durante todo el test; devuelve el chequeo. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/v1/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return () => expect(errors, "errores de JS o 5xx de la API").toEqual([]);
}

/** Abre una página (sin tours encima) y devuelve el chequeo de errores. */
export async function openClean(page: Page, path: string) {
  // Los tours de bienvenida taparían los clicks.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("home_tour_seen", "true");
      localStorage.setItem("map_tour_seen", "true");
    } catch { /* storage bloqueado */ }
  });
  const check = watchErrors(page);
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `HTTP de ${path}`).toBeLessThan(400);
  return check;
}

/** /map de una comuna; la primera visita pregunta "¿Qué estás buscando?" → Residencial. */
export async function openMap(page: Page, cdComuna = 14, nombre = "El Poblado") {
  const check = await openClean(page, `/map?cd_comuna=${cdComuna}&nombre=${encodeURIComponent(nombre)}&zoom=12`);
  const btn = page.getByRole("button", { name: /Residencial|Residential/ }).filter({ hasText: /casas|houses/i }).first();
  // isVisible() no espera: el diálogo aparece cuando termina de cargar el mapa.
  if (await btn.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false)) await btn.click();
  return check;
}
