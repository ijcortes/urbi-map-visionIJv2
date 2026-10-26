import { test, expect, type APIRequestContext } from "@playwright/test";
import { SUBMIT, QC_TAG } from "./_helpers";

// Agente "formularios GHL": las suscripciones/aplicaciones viven en GoHighLevel.
// Llena cada formulario como un usuario real, confirma por la API de GHL que el
// contacto llegó, y lo borra para no dejar basura en el CRM.
//
//   QC_SUBMIT=1
//   QC_GHL_FORMS        JSON: [{"nombre":"suscripcion","url":"https://…/widget/form/XXXX"}]
//   GHL_PRIVATE_TOKEN   token de la sub-cuenta de Medellín Social (secret)
//   GHL_LOCATION_ID     id de esa sub-cuenta (secret)
//   QC_TEST_PHONE       teléfono propio de pruebas; si un formulario exige teléfono
//                       y no está, ese formulario se salta (nunca se inventa un número:
//                       los workflows de GHL le escribirían/llamarían a un tercero).
//
// En GHL: los workflows que disparan estos formularios deberían ignorar contactos
// con email qc+…@medellinsocial.com (o el tag "qc-test") para no mandar mensajes.

const GHL = "https://services.leadconnectorhq.com";
const TOKEN = process.env.GHL_PRIVATE_TOKEN ?? "";
const LOCATION = process.env.GHL_LOCATION_ID ?? "";
const PHONE = process.env.QC_TEST_PHONE ?? "";
const FORMS: { nombre: string; url: string }[] = (() => {
  try { return JSON.parse(process.env.QC_GHL_FORMS ?? "[]"); } catch { return []; }
})();

const headers = { Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", Accept: "application/json" };

async function findContact(request: APIRequestContext, email: string) {
  const r = await request.get(`${GHL}/contacts/`, { headers, params: { locationId: LOCATION, query: email } });
  expect(r.status(), "búsqueda de contactos en GHL").toBe(200);
  const body = await r.json();
  return (body.contacts ?? []).find((c: { email?: string }) => c.email?.toLowerCase() === email.toLowerCase());
}

test.describe("formularios GHL", () => {
  test.skip(!SUBMIT, "QC_SUBMIT apagado");
  test.skip(!TOKEN || !LOCATION, "faltan GHL_PRIVATE_TOKEN / GHL_LOCATION_ID");
  test.skip(FORMS.length === 0, "QC_GHL_FORMS vacío");

  for (const form of FORMS) {
    test(`envía y llega a GHL: ${form.nombre}`, async ({ page, request }) => {
      const email = `qc+${form.nombre}-${Date.now()}@medellinsocial.com`;
      await page.goto(form.url, { waitUntil: "domcontentloaded" });

      const fill = async (sel: string, value: string) => {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) await el.fill(value);
      };
      await fill('input[name="full_name"]', `${QC_TAG} ${form.nombre}`);
      await fill('input[name="first_name"]', QC_TAG);
      await fill('input[name="last_name"]', form.nombre);
      await fill('input[name="email"], input[type="email"]', email);

      const phone = page.locator('input[name="phone"], input[type="tel"]').first();
      if (await phone.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const required = (await phone.getAttribute("required")) != null || (await phone.getAttribute("aria-required")) === "true";
        test.skip(required && !PHONE, "el formulario exige teléfono y no hay QC_TEST_PHONE");
        if (PHONE) await phone.fill(PHONE);
      }

      await page.locator('button[type="submit"], button:has-text("Enviar"), button:has-text("Submit")').first().click();

      // GHL tarda unos segundos en crear el contacto.
      let contact: { id: string } | undefined;
      for (let i = 0; i < 12 && !contact; i++) {
        await page.waitForTimeout(5_000);
        contact = await findContact(request, email);
      }
      expect(contact, `el contacto ${email} no llegó a GHL en 60s`).toBeTruthy();

      const del = await request.delete(`${GHL}/contacts/${contact!.id}`, { headers });
      expect(del.status(), "borrar contacto de prueba en GHL").toBeLessThan(300);
    });
  }
});
