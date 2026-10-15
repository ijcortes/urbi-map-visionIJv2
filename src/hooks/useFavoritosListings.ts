import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { apiFetch, getToken } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";

/** Favorites key for a listing: fav_key (stable id, works for own listings whose `url` is null) else url. */
export function favKey(l: { fav_key?: string | null; url?: string | null }): string | null {
  return l.fav_key || l.url || null;
}

const BASE = API_ENDPOINTS.favoritos + "/listings";

export function useFavoritosListings() {
  const [favUrls, setFavUrls] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!getToken()) return;
    apiFetch<{ ids: string[] }>(`${BASE}/ids`)
      .then((data) => {
        setFavUrls(new Set(data.ids));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const isFav = useCallback((url: string | null | undefined): boolean => {
    return !!url && favUrls.has(url);
  }, [favUrls]);

  const isPending = useCallback((url: string | null | undefined): boolean => {
    return !!url && pending.has(url);
  }, [pending]);

  const toggle = useCallback(async (url: string | null | undefined, barrioId?: number | null) => {
    if (!url || !getToken() || pending.has(url)) return;
    const removing = favUrls.has(url);
    setPending((prev) => new Set(prev).add(url));
    try {
      if (removing) {
        await apiFetch(`${BASE}?url=${encodeURIComponent(url)}`, { method: "DELETE" });
        setFavUrls((prev) => { const n = new Set(prev); n.delete(url); return n; });
      } else {
        await apiFetch(BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, barrio_id: barrioId ?? null }),
        });
        setFavUrls((prev) => new Set(prev).add(url));
      }
    } catch {
      // Estado local NO se toca — si la request falló, el corazón se queda como estaba.
      toast.error(removing ? "No se pudo quitar de favoritos" : "No se pudo guardar en favoritos");
    } finally {
      setPending((prev) => { const n = new Set(prev); n.delete(url); return n; });
    }
  }, [favUrls, pending]);

  return { isFav, toggle, loaded, isPending };
}
