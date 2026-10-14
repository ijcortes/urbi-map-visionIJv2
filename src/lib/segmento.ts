// Residential / commercial segment: chosen BEFORE results are shown, default
// "residencial", persisted in localStorage (and optionally ?segmento= in the URL).
export type Segmento = "residencial" | "comercial";
export const DEFAULT_SEGMENTO: Segmento = "residencial";
export const SEGMENTO_STORAGE_KEY = "urbi.segmento";

export function isSegmento(v: unknown): v is Segmento {
  return v === "residencial" || v === "comercial";
}

/** Returns the persisted choice, or null when the user never chose (=> show the gate). */
export function getStoredSegmento(): Segmento | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URLSearchParams(window.location.search).get("segmento");
    if (isSegmento(url)) return url;
    const v = window.localStorage.getItem(SEGMENTO_STORAGE_KEY);
    return isSegmento(v) ? v : null;
  } catch {
    return null;
  }
}

export function setStoredSegmento(s: Segmento): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(SEGMENTO_STORAGE_KEY, s); } catch { /* private mode */ }
}

/** Tipo options per segment. Studio is NOT a tipo: it is apartamento with 0 bedrooms. */
export const TIPOS_POR_SEGMENTO: Record<Segmento, string[]> = {
  residencial: ["apartamento", "casa"],
  comercial: ["local", "oficina", "bodega", "lote"],
};

/** Keep only tipos that belong to the segment (used when the segment changes). */
export function pruneTiposForSegmento(tipos: string[] | null | undefined, s: Segmento): string[] | null {
  if (!tipos?.length) return null;
  const ok = tipos.filter((t) => TIPOS_POR_SEGMENTO[s].includes(t));
  return ok.length ? ok : null;
}
