import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config/api'

export interface NoticiaData {
  id: number
  titulo: string
  url: string
  fuente: string | null
  fecha_publicacion: string | null
}

export function useNoticias(limit = 4, barrio_id?: number | null, municipio?: string, cd_comuna?: number | null) {
  return useQuery<NoticiaData[]>({
    queryKey: ['noticias', limit, cd_comuna ?? null, barrio_id ?? null, municipio ?? null],
    queryFn: async () => {
      const sp = new URLSearchParams({ limit: String(limit) })
      if (cd_comuna) sp.set('cd_comuna', String(cd_comuna))
      else if (barrio_id) sp.set('barrio_id', String(barrio_id))
      else if (municipio) sp.set('municipio', municipio)
      const res = await fetch(`${API_BASE_URL}/comunidad/noticias?${sp}`)
      if (!res.ok) return []
      const data = await res.json()
      return data.noticias ?? []
    },
    staleTime: 10 * 60 * 1000,
  })
}
