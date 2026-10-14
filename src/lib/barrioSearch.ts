import type { BarrioOption } from "@/lib/adapters";

/** Shape of GET /barrios/aliases and GET /barrios/buscar items. */
export type ApiBarrioAlias = {
  alias: string;
  alias_norm: string;
  barrio_id: number;
  barrio_nombre?: string | null;
  municipio?: string | null;
  cd_comuna?: number | null;
  comuna?: string | null;
  asumido?: boolean;
};

/** Search suggestion: a barrio option plus how it should be displayed. */
export type SearchOption = BarrioOption & { label: string; hint?: string };

export function normSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function matchAliases(aliases: ApiBarrioAlias[], q: string): ApiBarrioAlias[] {
  const nq = normSearch(q);
  if (nq.length < 2) return [];
  return aliases.filter((a) => (a.alias_norm || normSearch(a.alias)).includes(nq));
}

function title(s: string): string {
  return s.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Resolve an API alias/barrio hit to a navigable option. Coordinates come from the
 * loaded barrios list (same id); returns null when that barrio is not loaded.
 */
export function aliasToOption(a: ApiBarrioAlias, allBarrios: BarrioOption[] | undefined): SearchOption | null {
  const base = allBarrios?.find((b) => b.id === a.barrio_id);
  if (!base) return null;
  const isAlias = normSearch(a.alias) !== normSearch(base.nombre);
  return {
    ...base,
    label: isAlias ? a.alias : base.nombre,
    hint: isAlias ? `${title(base.nombre)}${a.comuna ? ` · ${title(a.comuna)}` : ""}` : undefined,
  };
}

/** Local barrio/municipio/comuna substring matches (accent-insensitive). */
export function localMatches(allBarrios: BarrioOption[] | undefined, q: string, limit = 8): SearchOption[] {
  const nq = normSearch(q);
  if (!nq || !allBarrios) return [];
  return allBarrios
    .filter((b) =>
      normSearch(b.nombre).includes(nq) ||
      normSearch(b.municipio).includes(nq) ||
      (b.comuna ? normSearch(b.comuna).includes(nq) : false))
    .slice(0, limit)
    .map((b) => ({ ...b, label: b.nombre }));
}

/** Merge alias hits first, then local, then server /buscar hits; dedupe by barrio id + label. */
export function mergeSuggestions(...lists: SearchOption[][]): SearchOption[] {
  const seen = new Set<string>();
  const out: SearchOption[] = [];
  for (const l of lists) for (const o of l) {
    const k = `${o.id}|${normSearch(o.label)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out.slice(0, 8);
}
