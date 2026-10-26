import { defineConfig, devices } from "@playwright/test";

// Equipo de QC (Ken, 23-oct): un "agente" por tipo de usuario recorre su camino
// completo en el sitio real una vez al día y reporta si algo se rompe.
//   QC_BASE_URL   sitio a probar (default: producción)
//   QC_API_URL    API (default: la de producción en Railway)
//   QC_SUBMIT=1   también envía formularios de prueba: el artículo queda en
//                 moderación y los formularios de GHL se verifican y se borran
//                 (ver journeys/ghl.qc.ts). Apagado por defecto.
// Archivos *.qc.ts (no *.spec.ts) para que vitest no los levante.
export default defineConfig({
  testDir: "./journeys",
  testMatch: "**/*.qc.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../qc-report" }], ["json", { outputFile: "../qc-report/results.json" }]],
  use: {
    baseURL: process.env.QC_BASE_URL ?? "https://www.medellinsocial.com",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    locale: "es-CO",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
