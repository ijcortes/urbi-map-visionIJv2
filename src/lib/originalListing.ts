export type OriginalListingSource = { id?: number | null; url?: string | null; fuente?: string | null; link_status?: string | null };

/** Link states for which the original link must not be shown (also nulled server-side). */
export const DEAD_LINK_STATUSES = ["gone", "pending_review", "error"];

/**
 * External URL of the original portal listing, or null when there is none to show:
 * own listings (fuente "propio") and rows whose url is missing / not http(s) / just an
 * internal id never get a link.
 */
export function originalListingUrl(l: OriginalListingSource | null | undefined): string | null {
  if (!l) return null;
  if ((l.fuente ?? "").toLowerCase() === "propio") return null;
  if (DEAD_LINK_STATUSES.includes(l.link_status ?? "")) return null;
  const raw = (l.url ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const PORTALS: Record<string, string> = {
  fincaraiz: "Fincaraíz",
  metrocuadrado: "Metrocuadrado",
  medellinliving: "MedellinLiving",
};
export function portalName(fuente: string | null | undefined): string | null {
  return PORTALS[(fuente ?? "").toLowerCase()] ?? null;
}
