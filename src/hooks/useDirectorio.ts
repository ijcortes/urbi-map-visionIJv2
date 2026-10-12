import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config/api'

export interface DirectorioItem {
  id: number
  nombre: string
  categoria: string
  rating_google: number | null
  google_place_id: string | null
  foto_url: string | null
  direccion: string | null
  whatsapp: string | null
  website: string | null
  lat: number | null
  lon: number | null
  barrio_nombre: string | null
}

export function useDirectorio(ciudad_id = 1, barrio_id?: number | null, municipio?: string, cd_comuna?: number | null) {
  return useQuery<DirectorioItem[]>({
    queryKey: ['directorio', ciudad_id, cd_comuna ?? null, barrio_id ?? null, municipio ?? null],
    queryFn: async () => {
      const sp = new URLSearchParams({ ciudad_id: String(ciudad_id) })
      if (cd_comuna) sp.set('cd_comuna', String(cd_comuna))
      else if (barrio_id) sp.set('barrio_id', String(barrio_id))
      else if (municipio) sp.set('municipio', municipio)
      const res = await fetch(`${API_BASE_URL}/business/directorio?${sp}`)
      if (!res.ok) return []
      const data = await res.json()
      return data.negocios ?? []
    },
    staleTime: 60 * 60 * 1000,
  })
}
