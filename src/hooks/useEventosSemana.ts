import { useQuery } from '@tanstack/react-query'
import { eventosUrl } from '@/hooks/useEventosZona'
import type { EventoData } from '@/components/comunidad/EventCard'

// Todo lo que pasa esta semana (no solo destacados), orden cronológico —
// mismo endpoint que useEventosZona, con fecha_hasta=+7d.
export function useEventosSemana(barrioId: number | null, municipioNombre: string | undefined, limit = 4) {
  return useQuery<EventoData[]>({
    queryKey: ['eventos-semana', barrioId, municipioNombre ?? null],
    queryFn: async () => {
      const hasta = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
      const res = await fetch(`${eventosUrl(barrioId, municipioNombre)}?limit=12&fecha_hasta=${hasta}`)
      if (!res.ok) return []
      const data = await res.json()
      const eventos: EventoData[] = data.eventos ?? []
      return eventos
        .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))
        .slice(0, limit)
    },
    staleTime: 10 * 60 * 1000,
  })
}
