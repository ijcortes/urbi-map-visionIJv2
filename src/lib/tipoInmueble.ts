// Property-type labels for text built in code (aria-labels, alts, templates), where
// the DOM phrase dictionary cannot match a whole sentence and would leave Spanglish
// ("Apartment en Poblado").
const EN: Record<string, string> = {
  apartamento: "Apartment", apartaestudio: "Studio", casa: "House", casa_lote: "House with lot",
  local: "Retail space", oficina: "Office", bodega: "Warehouse", consultorio: "Medical office",
  lote: "Lot", terreno: "Land", finca: "Farm", habitacion: "Room", edificio: "Building",
};

export function tipoInmuebleLabel(tipo: string | null | undefined, lang: "es" | "en"): string {
  const key = (tipo ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!key) return lang === "en" ? "Property" : "Inmueble";
  if (lang === "en") return EN[key] ?? EN[key.split("_")[0]] ?? "Property";
  const es = (tipo ?? "").trim();
  return es.charAt(0).toUpperCase() + es.slice(1).toLowerCase().replace(/_/g, " ");
}
