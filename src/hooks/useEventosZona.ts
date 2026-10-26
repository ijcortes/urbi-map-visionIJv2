import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config/api'
import type { EventoData } from '@/components/comunidad/EventCard'

/** Endpoint de eventos de un barrio, de un municipio del Valle, o de todo el valle. */
export function eventosUrl(barrioId: number | null, municipioNombre?: string | null): string {
  if (barrioId) return `${API_BASE_URL}/comunidad/${barrioId}/eventos`
  if (municipioNombre) return `${API_BASE_URL}/comunidad/municipio/${encodeURIComponent(municipioNombre)}/eventos`
  return `${API_BASE_URL}/comunidad/todos/eventos`
}

/** Próximos eventos de una zona (página de barrio). `desde` filtra en el servidor. */
export function useEventosZona(barrioId: number | null, municipioNombre: string | null | undefined, opts: { limit?: number; desde?: string } = {}) {
  const { limit = 30, desde = '' } = opts
  return useQuery<EventoData[]>({
    queryKey: ['eventos-zona', barrioId, municipioNombre ?? null, limit, desde],
    queryFn: async () => {
      const sp = new URLSearchParams({ limit: String(limit) })
      if (desde) sp.set('fecha_desde', desde)
      const res = await fetch(`${eventosUrl(barrioId, municipioNombre)}?${sp}`)
      if (!res.ok) return []
      return (await res.json()).eventos ?? []
    },
    staleTime: 10 * 60 * 1000,
  })
}
