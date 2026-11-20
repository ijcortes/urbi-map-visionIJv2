import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, getToken } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";

/** Favorites key for a listing: fav_key (stable id, works for own listings whose `url` is null) else url. */
export function favKey(l: { fav_key?: string | null; url?: string | null }): string | null {
  return l.fav_key || l.url || null;
}

const BASE = API_ENDPOINTS.favoritos + "/listings";
const IDS_KEY = ["fav-listings-ids"];
const FULL_KEY = ["fav-listings-full"];

export type FavListingFull = {
  url: string;
  created_at: string;
  listing_id: number;
  precio_cop: number | null;
  area_m2: number | null;
  habitaciones: number | null;
  banos: number | null;
  foto: string | null;
  tipo_operacion: string | null;
  tipo_inmueble: string | null;
  barrio_id: number | null;
  barrio_nombre: string | null;
  municipio: string | null;
};

// react-query: UNA sola query de ids alimenta TODOS los corazones (drawer, card,
// popup). Cache compartida → al marcar en un lado, todos se sincronizan sin
// remount (antes cada componente tenía su propio Set → parecía "no funciona").
export function useFavoritosListings() {
  const qc = useQueryClient();
  const { data: ids = [], isLoading } = useQuery<string[]>({
    queryKey: IDS_KEY,
    queryFn: () => apiFetch<{ ids: string[] }>(`${BASE}/ids`).then((d) => d.ids),
    enabled: !!getToken(),
    staleTime: 60_000,
  });
  const favSet = useMemo(() => new Set(ids), [ids]);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const isFav = useCallback((url: string | null | undefined) => !!url && favSet.has(url), [favSet]);
  const isPending = useCallback((url: string | null | undefined) => !!url && pending.has(url), [pending]);

  const toggle = useCallback(async (url: string | null | undefined, barrioId?: number | null) => {
    if (!url || !getToken() || pending.has(url)) return;
    const removing = favSet.has(url);
    setPending((p) => new Set(p).add(url));
    // Optimista en la cache compartida → todos los corazones cambian al instante.
    qc.setQueryData<string[]>(IDS_KEY, (old = []) => removing ? old.filter((u) => u !== url) : [...old, url]);
    try {
      if (removing) {
        await apiFetch(`${BASE}?url=${encodeURIComponent(url)}`, { method: "DELETE" });
      } else {
        await apiFetch(BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, barrio_id: barrioId ?? null }),
        });
      }
      qc.invalidateQueries({ queryKey: FULL_KEY }); // refresca la lista del perfil
    } catch {
      // Rollback del optimista si la request falló.
      qc.setQueryData<string[]>(IDS_KEY, (old = []) => removing ? [...old, url] : old.filter((u) => u !== url));
      toast.error(removing ? "No se pudo quitar de favoritos" : "No se pudo guardar en favoritos");
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(url); return n; });
    }
  }, [favSet, pending, qc]);

  return { isFav, toggle, loaded: !isLoading, isPending };
}

/** Favoritos de inmuebles ENRIQUECIDOS (foto/precio/specs/barrio) para el perfil. */
export function useFavoritosListingsFull() {
  return useQuery<FavListingFull[]>({
    queryKey: FULL_KEY,
    queryFn: () => apiFetch<FavListingFull[]>(BASE),
    enabled: !!getToken(),
    staleTime: 60_000,
  });
}
