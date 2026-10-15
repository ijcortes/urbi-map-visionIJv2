import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_ENDPOINTS } from "@/config/api";
import { apiFetch } from "@/lib/apiClient";
import type { BarrioOption } from "@/lib/adapters";
import {
  aliasToOption, localMatches, matchAliases, mergeSuggestions, normSearch,
  type ApiBarrioAlias, type SearchOption,
} from "@/lib/barrioSearch";

/** Barrio search: aliases ("Ciudad del Río", "Provenza") + local names + server /buscar fallback. */
export function useBarrioSearch(q: string, allBarrios: BarrioOption[] | undefined): SearchOption[] {
  const { data: aliases } = useQuery({
    queryKey: ["barrio-aliases"],
    queryFn: () => apiFetch<ApiBarrioAlias[]>(API_ENDPOINTS.barrioAliases, { skipAuth: true }),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const nq = normSearch(q);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(nq), 250);
    return () => clearTimeout(t);
  }, [nq]);

  const aliasHits = useMemo(
    () => matchAliases(aliases ?? [], q).map((a) => aliasToOption(a, allBarrios)).filter((o): o is SearchOption => !!o),
    [aliases, q, allBarrios],
  );
  const local = useMemo(() => localMatches(allBarrios, q), [allBarrios, q]);

  // Server fallback only when the cheap sources found little.
  const needServer = debounced.length >= 2 && debounced === nq && aliasHits.length + local.length < 3;
  const { data: server } = useQuery({
    queryKey: ["barrio-buscar", debounced],
    queryFn: () => apiFetch<ApiBarrioAlias[]>(API_ENDPOINTS.barrioBuscar(debounced), { skipAuth: true }),
    enabled: needServer,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const serverHits = useMemo(
    () => (needServer ? (server ?? []).map((a) => aliasToOption(a, allBarrios)).filter((o): o is SearchOption => !!o) : []),
    [server, needServer, allBarrios],
  );

  return useMemo(() => mergeSuggestions(aliasHits, local, serverHits), [aliasHits, local, serverHits]);
}
