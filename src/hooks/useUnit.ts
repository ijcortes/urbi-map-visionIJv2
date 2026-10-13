import { useLang } from "@/lib/i18n";

export type AreaUnit = "m2" | "sqft";

// Unidad de área = derivación directa del idioma: es→m², en→ft². Antes era un
// toggle manual (localStorage) que podía desincronizarse del idioma; ahora el
// idioma manda y re-renderiza vía el contexto de useLang(). m² sigue siendo
// canónico en DB/filtros; ft² es solo presentación (conversión en el borde UI).
export function useUnit(): { unit: AreaUnit } {
  const { lang } = useLang();
  return { unit: lang === "en" ? "sqft" : "m2" };
}

// m² is canonical everywhere (DB, filters); sqft is display-only.
export function formatArea(m2: number, unit: AreaUnit): string {
  if (unit === "sqft") return `${Math.round(m2 * 10.7639)}ft²`;
  return `${m2}m²`;
}
