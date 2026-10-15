// API returns enum codes in Spanish (seguridad/verde categories, visit and listing
// states). Render them through explicit {es, en} tables instead of leaving the DOM
// phrase dictionary to guess; unknown codes fall back to the raw value.
type L = { es: string; en: string };

const CATEGORIA: Record<string, L> = {
  "MUY ALTA": { es: "MUY ALTA", en: "VERY HIGH" },
  ALTA: { es: "ALTA", en: "HIGH" },
  MEDIA: { es: "MEDIA", en: "MEDIUM" },
  BAJA: { es: "BAJA", en: "LOW" },
  "MUY BAJA": { es: "MUY BAJA", en: "VERY LOW" },
  "MÍNIMA": { es: "MÍNIMA", en: "MINIMAL" },
  "MUY SEGURO": { es: "MUY SEGURO", en: "VERY SAFE" },
  SEGURO: { es: "SEGURO", en: "SAFE" },
  "SIN DATOS": { es: "SIN DATOS", en: "NO DATA" },
  "MUY SALUDABLE": { es: "MUY SALUDABLE", en: "VERY HEALTHY" },
  SALUDABLE: { es: "SALUDABLE", en: "HEALTHY" },
  "PRECAUCIÓN": { es: "PRECAUCIÓN", en: "CAUTION" },
  ALERTA: { es: "ALERTA", en: "ALERT" },
};

const TENDENCIA: Record<"mejorando" | "empeorando" | "estable", L> = {
  mejorando: { es: "↑ Mejorando", en: "↑ Improving" },
  empeorando: { es: "↓ Empeorando", en: "↓ Worsening" },
  estable: { es: "→ Estable", en: "→ Stable" },
};

const ESTADO: Record<string, L> = {
  // visita_solicitud
  pendiente: { es: "Pendiente", en: "Pending" },
  confirmada: { es: "Confirmada", en: "Confirmed" },
  realizada: { es: "Realizada", en: "Completed" },
  cancelada: { es: "Cancelada", en: "Cancelled" },
  no_asistio: { es: "No asistió", en: "No-show" },
  // listing
  publicado: { es: "Publicado", en: "Published" },
  en_revision: { es: "En revisión", en: "In review" },
  borrador: { es: "Borrador", en: "Draft" },
  pausado: { es: "Pausado", en: "Paused" },
  rechazado: { es: "Rechazado", en: "Rejected" },
  cerrado: { es: "Cerrado", en: "Closed" },
};

const pick = (l: L | undefined, raw: string, lang: string) => (l ? (lang === "en" ? l.en : l.es) : raw);

export const categoriaLabel = (cat: string, lang: string) => pick(CATEGORIA[cat.toUpperCase()], cat, lang);
export const estadoLabel = (estado: string, lang: string) => pick(ESTADO[estado], estado, lang);
export function tendenciaLabel(raw: string, lang: string): string {
  const t = raw.toLowerCase();
  const k = t.includes("mejor") ? "mejorando" : t.includes("empeor") ? "empeorando" : "estable";
  return pick(TENDENCIA[k], raw, lang);
}
