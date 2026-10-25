// Convierte qc-report/results.json en un resumen markdown para el issue diario.
import { readFileSync } from "node:fs";

const r = JSON.parse(readFileSync(process.argv[2] ?? "qc-report/results.json", "utf8"));
const fallas = [];
const walk = (suite, path = []) => {
  for (const s of suite.suites ?? []) walk(s, [...path, s.title].filter(Boolean));
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.at(-1);
      if (t.status === "unexpected" || last?.status === "failed" || last?.status === "timedOut") {
        const msg = (last?.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 4).join(" ");
        fallas.push(`- **${[...path, spec.title].join(" › ")}** (${t.projectName}): ${msg}`);
      }
    }
  }
};
walk(r);
const s = r.stats ?? {};
console.log(`QC diario de Medellín Social: ${s.expected ?? 0} OK, ${s.unexpected ?? 0} fallas, ${s.flaky ?? 0} intermitentes.\n`);
console.log(fallas.length ? fallas.join("\n") : "Todo funcionando.");
