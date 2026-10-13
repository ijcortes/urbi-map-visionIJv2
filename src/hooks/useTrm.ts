import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";

// Canonical COP/USD rate (public.trm, refreshed weekly). SINGLE source for every
// USD conversion in the UI. There is deliberately NO hardcoded fallback: until the
// fetch resolves `valor` is null and callers must keep showing COP (see
// usePriceFormat) instead of silently using a made-up rate.
export function useTrm(): { valor: number | null; isReady: boolean } {
  const { data } = useQuery({
    queryKey: ["trm"],
    queryFn: () => apiFetch<{ valor: number }>(API_ENDPOINTS.trm),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const v = data?.valor;
  const ok = typeof v === "number" && Number.isFinite(v) && v > 0;
  return { valor: ok ? v : null, isReady: ok };
}
