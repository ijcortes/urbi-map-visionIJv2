import { Name, useT, useLang } from "@/lib/i18n";
import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect, type ReactNode } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { useBarrio, type Barrio } from '@/components/comunidad/BarrioContext'
import { BusinessCardDirectory, BusinessCardList } from '@/components/comunidad/BusinessCard'
import { useTiendas, useGrupoCounts } from '@/hooks/useTiendas'
import { useBarriosRaw } from '@/hooks/useBarrios'
import { GRUPOS_TIENDAS } from '@/lib/categorias_comunidad'
import { MAPBOX_TOKEN } from '@/lib/mapboxToken'
import { buildNegocioPopupContent } from '@/lib/negocioPopup'
import { API_ENDPOINTS } from '@/config/api'
import { apiFetch } from '@/lib/apiClient'
import { useIsMobile } from '@/hooks/use-mobile'
import { List, Map as MapIcon } from "@/lib/icons"
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/local-business/$barrio_slug')({
  component: LocalBusinessRoot,
  head: ({ params }) => ({
    meta: [{ title: `Negocios en ${params.barrio_slug.replace(/-/g, ' ')} · Medellín Social` }],
  }),
})

function LocalBusinessRoot() {
  const { barrio_slug } = Route.useParams()
  return (
    <ComunidadLayout initialSlug={barrio_slug}>
      <LocalBusinessPage />
    </ComunidadLayout>
  )
}

const K = TOKENS;

// categoria → grupo (mismo agrupamiento que GRUPOS_TIENDAS/backend _GRUPOS_MAP)
// y grupo → color: cada categoría de negocio pinta distinto en el mapa.
const CATEGORIA_A_GRUPO: Record<string, string> = Object.fromEntries(
  GRUPOS_TIENDAS.flatMap(g => g.categorias.map(c => [c.key, g.key])),
)
const GRUPO_COLOR: Record<string, string> = {
  gastronomia:      K.coral,
  salud:            K.teal,
  fitness:          K.amarillo,
  servicios_hogar:  '#003893',
  mas_servicios:    K.muted,
}
const GRUPO_DEFAULT_COLOR = K.muted

// ── Mapa de zonas — mismo sistema visual y de niveles que MapView (/map): ──────
// comunas (relleno ámbar + burbuja de conteo) → click → barrios de esa comuna
// (mismos colores/paint que MapView) → click en un barrio → pines de sus
// negocios (mismo marker/popup que el mapa de pines anterior). Todo en el mapa,
// sin navegar de página — el selector de zona de la barra sigue siendo el <select>.
// ponytail: sin el pitch/terreno 3D del comuna-view de MapView — panel embebido
// y corto, el 3D solo restaría alto útil; drop si algún día se quiere igualar 1:1.

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

const ZONAS_GEOJSON = [
  '/data/comunas_medellin.geojson',
  '/data/comunas_bello.geojson',
  '/data/comunas_envigado.geojson',
  '/data/comunas_itagui.geojson',
  '/data/comunas_la_estrella.geojson',
  '/data/comunas_sabaneta.geojson',
]

function ringsOf(geom: GeoJSON.Geometry): GeoJSON.Position[][] {
  if (geom.type === 'Polygon') return geom.coordinates
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat()
  return []
}

function boundsOf(geom: GeoJSON.Geometry): mapboxgl.LngLatBounds {
  const bounds = new mapboxgl.LngLatBounds()
  ringsOf(geom).forEach(ring => ring.forEach(pos => bounds.extend(pos as [number, number])))
  return bounds
}

// Comunas de Medellín (cd_comuna 1-16) no traen slug en el geojson estático —
// hace falta para ubicar qué polígono corresponde al `barrio` activo de la página
// (BARRIOS en BarrioContext) y así auto-abrir esa comuna al cargar el mapa.
const CD_COMUNA_SLUG: Record<number, string> = {
  1: 'popular', 2: 'santa-cruz', 3: 'manrique', 4: 'aranjuez', 5: 'castilla',
  6: 'doce-de-octubre', 7: 'robledo', 8: 'villa-hermosa', 9: 'buenos-aires',
  10: 'la-candelaria', 11: 'laureles', 13: 'san-javier', 14: 'el-poblado',
  15: 'guayabal', 16: 'belen',
}

// Slug de BARRIOS (BarrioContext) para la comuna/municipio clickeado en el mapa —
// mismo criterio de resolución que `scope` más abajo, pero devuelve el slug de
// ruta (no barrio_id/municipio_nombre) para poder navegar.
function slugForComuna(cd: number, municipio: string, barrios: Barrio[]): string | undefined {
  if (municipio.toUpperCase() === 'MEDELLIN') return CD_COMUNA_SLUG[cd]
  return barrios.find(b => b.municipio_nombre?.toUpperCase() === municipio.toUpperCase())?.slug
}

function NegociosMap({ barrio, barrios, visible = true, isMobile }: { barrio: Barrio; barrios: Barrio[]; visible?: boolean; isMobile?: boolean }) {
  const containerRef      = useRef<HTMLDivElement>(null)
  const mapRef            = useRef<mapboxgl.Map | null>(null)
  const staticFeaturesRef = useRef<GeoJSON.Feature[]>([])
  const hoverComunaRef    = useRef<number | string | undefined>(undefined)
  const hoverBarrioRef    = useRef<number | string | undefined>(undefined)
  const selectedBarrioRef = useRef<number | string | undefined>(undefined)

  const [mapReady, setMapReady]         = useState(false)
  const [level, setLevel]               = useState<'comunas' | 'barrios'>('comunas')
  const [activeComuna, setActiveComuna] = useState<{ cd: number; nombre: string; municipio: string } | null>(null)

  const { data: barriosRaw } = useBarriosRaw()

  // Alcance de negocios a pinear: la comuna/municipio actualmente abierto en el
  // mapa — no un barrio catastral suelto. Resuelve a barrio_id (Medellín, vía el
  // representante de BARRIOS) o municipio_nombre (Valle de Aburrá), igual que ya
  // usa la lista de la izquierda — mismos negocios, ubicación exacta (lat/lon).
  const scope: { barrio_id?: number; municipio_nombre?: string } = (() => {
    if (!activeComuna) return {}
    if (activeComuna.municipio.toUpperCase() === 'MEDELLIN') {
      const slug = CD_COMUNA_SLUG[activeComuna.cd]
      const rep = slug ? barrios.find(b => b.slug === slug) : undefined
      return rep?.barrio_id != null ? { barrio_id: rep.barrio_id } : {}
    }
    const rep = barrios.find(b => b.municipio_nombre?.toUpperCase() === activeComuna.municipio.toUpperCase())
    return rep?.municipio_nombre ? { municipio_nombre: rep.municipio_nombre } : {}
  })()
  const { data: zonaTiendas } = useTiendas({ ...scope, limit: 500, offset: 0 })

  function goToComunas() {
    const map = mapRef.current
    if (!map) return
    const setVis = (id: string, v: 'visible' | 'none') => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v) }
    setVis('comunas-fill', 'visible'); setVis('comunas-line', 'visible'); setVis('comunas-label', 'visible')
    setVis('comunas-bubble-circle', 'visible'); setVis('comunas-bubble-count', 'visible')
    setVis('barrios-fill', 'none'); setVis('barrios-line', 'none'); setVis('barrios-label', 'none')
    const bounds = new mapboxgl.LngLatBounds()
    staticFeaturesRef.current.forEach(f => { const b = boundsOf(f.geometry); if (!b.isEmpty()) { bounds.extend(b.getSouthWest()); bounds.extend(b.getNorthEast()) } })
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 16, duration: 400 })
    setLevel('comunas')
    setActiveComuna(null)
  }

  // Abre comuna/municipio en el mapa: pinta sus barrios y encuadra. Mismo código
  // para el click manual y para el auto-drill inicial al barrio de la página.
  function openComuna(map: mapboxgl.Map, cd: number, nombre: string, municipio: string, geom: GeoJSON.Geometry) {
    const setVis = (id: string, v: 'visible' | 'none') => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v) }
    setVis('comunas-fill', 'none'); setVis('comunas-line', 'none'); setVis('comunas-label', 'none')
    setVis('comunas-bubble-circle', 'none'); setVis('comunas-bubble-count', 'none')
    setVis('barrios-fill', 'visible'); setVis('barrios-line', 'visible'); setVis('barrios-label', 'visible')
    map.fitBounds(boundsOf(geom), { padding: 40, duration: 450 })
    setLevel('barrios')
    setActiveComuna({ cd, nombre, municipio })
  }

  // ── Init del mapa (una sola vez) ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-75.5812, 6.2442],
      zoom: 10.4,
      minZoom: 9.3,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', async () => {
      // Base limpia — igual a MapView.tsx: POIs/carreteras ocultos, agua/edificios apagados.
      map.getStyle().layers.forEach((layer) => {
        const srcLayer = (layer as Record<string, unknown>)['source-layer'] as string | undefined
        if (layer.type === 'symbol') {
          const layout = (layer as mapboxgl.SymbolLayer).layout
          const lid = layer.id.toLowerCase()
          const hide = (layout && 'icon-image' in layout) ||
            ['road', 'street', 'transit', 'poi', 'airport', 'ferry', 'neighborhood', 'suburb', 'district', 'quarter']
              .some(k => lid.includes(k))
          if (hide) map.setLayoutProperty(layer.id, 'visibility', 'none')
        } else if (layer.type === 'fill' && srcLayer === 'water') {
          map.setPaintProperty(layer.id, 'fill-color', '#C9D6EE')
        } else if (layer.type === 'line' && srcLayer === 'waterway') {
          map.setPaintProperty(layer.id, 'line-color', '#C9D6EE')
        } else if (layer.type === 'fill' && srcLayer === 'building') {
          map.setPaintProperty(layer.id, 'fill-color', '#F3F0E8')
          map.setPaintProperty(layer.id, 'fill-opacity', 0.45)
        } else if (layer.type === 'background') {
          map.setPaintProperty(layer.id, 'background-color', '#FAF8F3')
        }
      })

      try {
        const [fcs, counts] = await Promise.all([
          Promise.all(ZONAS_GEOJSON.map(f => fetch(f).then(r => r.json()).catch(() => EMPTY_FC))) as Promise<GeoJSON.FeatureCollection[]>,
          apiFetch<{ counts: Record<string, number> }>(API_ENDPOINTS.comunasTiendasCounts).then(r => r.counts).catch(() => ({} as Record<string, number>)),
        ])
        const features = fcs.flatMap(fc => fc.features ?? [])
        staticFeaturesRef.current = features

        // ── Comunas — mismo paint que MapView.tsx (comunas-fill/line/label) ──
        map.addSource('comunas', { type: 'geojson', data: { type: 'FeatureCollection', features }, generateId: true })
        map.addLayer({
          id: 'comunas-fill', type: 'fill', source: 'comunas',
          paint: { 'fill-color': '#DAB33C', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.45, 0.25] },
        })
        map.addLayer({
          id: 'comunas-line', type: 'line', source: 'comunas',
          paint: { 'line-color': '#003893', 'line-opacity': 0.6, 'line-width': 2 },
        })
        map.addLayer({
          id: 'comunas-label', type: 'symbol', source: 'comunas',
          layout: { 'text-field': ['get', 'nombre'], 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.06 },
          paint: { 'text-color': '#111418', 'text-halo-color': '#FAF8F3', 'text-halo-width': 2 },
        })

        // Burbuja de conteo por comuna — mismo esquema que listings-mls-clusters.
        const bubbles: GeoJSON.Feature[] = features
          .map(f => {
            const cd = f.properties?.cd_comuna as number | undefined
            const count = cd != null ? counts[String(cd)] ?? 0 : 0
            const c = boundsOf(f.geometry).getCenter()
            return { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] }, properties: { count } }
          })
          .filter(f => f.properties.count > 0)
        map.addSource('comunas-bubble', { type: 'geojson', data: { type: 'FeatureCollection', features: bubbles } })
        map.addLayer({
          id: 'comunas-bubble-circle', type: 'circle', source: 'comunas-bubble',
          paint: {
            'circle-color': ['step', ['get', 'count'], '#0F8A4F', 500, '#0A5C36', 2000, '#111418'],
            'circle-radius': ['step', ['get', 'count'], 13, 500, 18, 2000, 24],
            'circle-opacity': 0.88, 'circle-stroke-width': 2, 'circle-stroke-color': 'rgba(29,158,117,0.3)',
          },
        })
        map.addLayer({
          id: 'comunas-bubble-count', type: 'symbol', source: 'comunas-bubble',
          layout: { 'text-field': ['get', 'count'], 'text-size': 11, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
          paint: { 'text-color': '#ffffff' },
        })

        // ── Barrios — mismo paint que MapView.tsx (barrios-mls-fill/line/label) ──
        map.addSource('barrios', { type: 'geojson', data: EMPTY_FC })
        map.addLayer({
          id: 'barrios-fill', type: 'fill', source: 'barrios', layout: { visibility: 'none' },
          paint: { 'fill-color': '#003893', 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.10, 0] },
        })
        map.addLayer({
          id: 'barrios-line', type: 'line', source: 'barrios', layout: { visibility: 'none' },
          paint: {
            'line-color': '#003893',
            'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.7, 0.4],
            'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1],
          },
        })
        map.addLayer({
          id: 'barrios-label', type: 'symbol', source: 'barrios', layout: {
            visibility: 'none', 'text-field': ['get', 'nombre'], 'text-size': 10,
            'text-transform': 'uppercase', 'text-letter-spacing': 0.05,
          },
          paint: { 'text-color': '#111418', 'text-halo-color': '#FAF8F3', 'text-halo-width': 1.5 },
        })

        // ── Pines de negocios — color por categoría (grupo), no un naranja plano.
        // Un solo layer que persiste toda la vida del mapa: entrar/salir de una
        // comuna solo llama .setData() (barato) en vez de crear/destruir 500
        // mapboxgl.Marker (DOM) cada vez — eso era lo que se sentía como "recarga".
        map.addSource('negocios-pines', { type: 'geojson', data: EMPTY_FC })
        map.addLayer({
          id: 'negocios-pines-circle', type: 'circle', source: 'negocios-pines',
          paint: {
            'circle-color': [
              'match', ['get', 'grupo'],
              'gastronomia',     GRUPO_COLOR.gastronomia,
              'salud',           GRUPO_COLOR.salud,
              'fitness',         GRUPO_COLOR.fitness,
              'servicios_hogar', GRUPO_COLOR.servicios_hogar,
              'mas_servicios',   GRUPO_COLOR.mas_servicios,
              GRUPO_DEFAULT_COLOR,
            ],
            'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 9, 6.5],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.92,
          },
        })

        let hoverPinId: number | string | undefined
        map.on('mousemove', 'negocios-pines-circle', (e) => {
          if (!e.features?.length) return
          if (hoverPinId !== undefined) map.setFeatureState({ source: 'negocios-pines', id: hoverPinId }, { hover: false })
          hoverPinId = e.features[0].id as number | string
          map.setFeatureState({ source: 'negocios-pines', id: hoverPinId }, { hover: true })
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'negocios-pines-circle', () => {
          if (hoverPinId !== undefined) map.setFeatureState({ source: 'negocios-pines', id: hoverPinId }, { hover: false })
          hoverPinId = undefined
          map.getCanvas().style.cursor = ''
        })
        map.on('click', 'negocios-pines-circle', (e) => {
          const p = e.features?.[0]?.properties
          if (!p) return
          // DOM-built popup: nombre/direccion/website/foto_url are user-editable
          // (POST /mi-negocio), so never interpolate them into an HTML string.
          new mapboxgl.Popup({ offset: 12, closeButton: true, maxWidth: 'min(220px, 78vw)' })
            .setLngLat(e.lngLat)
            .setDOMContent(buildNegocioPopupContent(p, K))
            .addTo(map)
        })

        const bounds = new mapboxgl.LngLatBounds()
        features.forEach(f => { const b = boundsOf(f.geometry); if (!b.isEmpty()) { bounds.extend(b.getSouthWest()); bounds.extend(b.getNorthEast()) } })
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 16, duration: 0 })

        // Auto-drill al cargar: abre de una vez la comuna/municipio del `barrio`
        // activo de la página — mismo alcance que la lista, para no depender de
        // un click extra para ver negocios con ubicación exacta ("todos" queda
        // en la vista de comunas, no hay un único polígono al que encuadrar).
        if (barrio.slug !== 'todos') {
          const target = barrio.municipio_nombre
            ? features.find(f => (f.properties?.municipio ?? '').toUpperCase() === barrio.municipio_nombre?.toUpperCase())
            : features.find(f => CD_COMUNA_SLUG[f.properties?.cd_comuna as number] === barrio.slug)
          if (target) {
            openComuna(
              map,
              target.properties?.cd_comuna as number,
              (target.properties?.nombre ?? '') as string,
              (target.properties?.municipio ?? '') as string,
              target.geometry,
            )
          }
        }
        setMapReady(true)
      } catch (err) {
        console.error('[NegociosMap] failed to load zonas', err)
      }
    })

    // Hover comuna
    map.on('mousemove', 'comunas-fill', (e) => {
      if (!e.features?.length) return
      if (hoverComunaRef.current !== undefined) map.setFeatureState({ source: 'comunas', id: hoverComunaRef.current }, { hover: false })
      hoverComunaRef.current = e.features[0].id as number | string
      map.setFeatureState({ source: 'comunas', id: hoverComunaRef.current }, { hover: true })
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'comunas-fill', () => {
      if (hoverComunaRef.current !== undefined) map.setFeatureState({ source: 'comunas', id: hoverComunaRef.current }, { hover: false })
      hoverComunaRef.current = undefined
      map.getCanvas().style.cursor = ''
    })
    map.on('click', 'comunas-fill', (e) => {
      const f = e.features?.[0]
      if (!f) return
      const cd = f.properties?.cd_comuna as number
      const nombre = (f.properties?.nombre ?? '') as string
      const municipio = (f.properties?.municipio ?? '') as string
      // Comuna distinta a la actual → navega (mismo mecanismo que el <select> de la
      // barra): actualiza header, lista y filtros de la página, no solo el mapa.
      const slug = slugForComuna(cd, municipio, barrios)
      if (slug && slug !== barrio.slug) {
        window.location.href = `/local-business/${slug}`
        return
      }
      const full = staticFeaturesRef.current.find(sf => sf.properties?.nombre === nombre) ?? f
      openComuna(map, cd, nombre, municipio, full.geometry)
    })

    // Hover + click barrio
    map.on('mousemove', 'barrios-fill', (e) => {
      if (!e.features?.length) return
      map.getCanvas().style.cursor = 'pointer'
      const id = e.features[0].id as number
      if (hoverBarrioRef.current !== undefined && hoverBarrioRef.current !== id) {
        map.setFeatureState({ source: 'barrios', id: hoverBarrioRef.current }, { hover: false })
      }
      hoverBarrioRef.current = id
      map.setFeatureState({ source: 'barrios', id }, { hover: true })
    })
    map.on('mouseleave', 'barrios-fill', () => {
      map.getCanvas().style.cursor = ''
      if (hoverBarrioRef.current !== undefined) map.setFeatureState({ source: 'barrios', id: hoverBarrioRef.current }, { hover: false })
      hoverBarrioRef.current = undefined
    })
    map.on('click', 'barrios-fill', (e) => {
      const f = e.features?.[0]
      if (!f) return
      if (selectedBarrioRef.current !== undefined) map.setFeatureState({ source: 'barrios', id: selectedBarrioRef.current }, { selected: false })
      selectedBarrioRef.current = f.id as number
      map.setFeatureState({ source: 'barrios', id: selectedBarrioRef.current }, { selected: true })
      map.fitBounds(boundsOf(f.geometry), { padding: 60, maxZoom: 15, duration: 400 })
    })

    return () => { map.remove(); mapRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poblar polígonos de barrio de la comuna/municipio activo (mismo criterio que
  // useBarriosRaw: Medellín filtra por cd_comuna, municipios por nombre).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeComuna || !barriosRaw) return
    const src = map.getSource('barrios') as mapboxgl.GeoJSONSource | undefined
    if (!src) return
    const isMedellin = activeComuna.municipio.toUpperCase() === 'MEDELLIN'
    const feats = barriosRaw
      .filter(b => b.geometry && (b.municipio ?? '').toUpperCase() === activeComuna.municipio.toUpperCase()
        && (!isMedellin || b.cd_comuna === activeComuna.cd))
      .map(b => ({
        type: 'Feature' as const, id: b.barrio_id, geometry: b.geometry as GeoJSON.Geometry,
        properties: { barrio_id: b.barrio_id, nombre: b.nombre ?? '' },
      }))
    src.setData({ type: 'FeatureCollection', features: feats })
  }, [activeComuna, barriosRaw])

  // Pines de negocios de la comuna/municipio activo — ubicación exacta (lat/lon),
  // color por categoría. Un solo setData() sobre el layer persistente (creado en
  // 'load'): nada de crear/destruir DOM markers, por eso no hay flash de "recarga"
  // al entrar/salir de una comuna.
  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource('negocios-pines') as mapboxgl.GeoJSONSource | undefined
    if (!src) return
    const feats: GeoJSON.Feature[] = (zonaTiendas?.tiendas ?? [])
      .filter(t => t.lat && t.lon)
      .map(t => ({
        type: 'Feature', id: t.id,
        geometry: { type: 'Point', coordinates: [t.lon!, t.lat!] },
        properties: {
          nombre: t.nombre, categoria: t.categoria ?? null,
          grupo: (t.categoria && CATEGORIA_A_GRUPO[t.categoria]) || 'mas_servicios',
          foto_url: t.foto_url ?? null, rating_google: t.rating_google ?? null,
          direccion: t.direccion ?? null, whatsapp: t.whatsapp ?? null,
          telefono: t.telefono ?? null, website: t.website ?? null,
          google_place_id: t.google_place_id ?? null, lat: t.lat, lon: t.lon,
        },
      }))
    src.setData({ type: 'FeatureCollection', features: feats })
  }, [zonaTiendas, mapReady])

  // El contenedor puede estar en display:none (toggle Lista/Mapa en móvil) cuando
  // Mapbox mide el tamaño inicial → canvas queda a 0×0 y el mapa se ve roto/gris
  // hasta que se le avisa explícitamente. resize() al volverse visible lo arregla.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => mapRef.current?.resize())
    return () => cancelAnimationFrame(raf)
    // isMobile pasa de undefined → true/false en el primer tick (useIsMobile mide
    // window en un efecto), lo que cambia el layout del contenedor (flex desktop
    // 480px+1fr, que en una pantalla angosta mide 0, → bloque mobile 100%) sin que
    // `visible` cambie de valor — hay que re-medir aunque `visible` se mantenga igual.
  }, [visible, isMobile])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden', border: `1px solid ${K.line}` }} />
      {level === 'barrios' && (
        <button onClick={goToComunas} style={{
          position: 'absolute', top: 10, left: 10, zIndex: 5,
          background: '#fff', border: `1px solid ${K.line}`, borderRadius: 8,
          padding: '7px 12px', fontSize: 12, fontWeight: 700, color: K.ink,
          cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.15)',
        }}>
          ← {activeComuna?.nombre ?? 'Comunas'}
        </button>
      )}
    </div>
  )
}

// ── Filtros — pills reutilizables (mismo lenguaje visual que /eventos) ─────────

function Pill({ active, onClick, label, activeBg, activeColor }: { active: boolean; onClick: () => void; label: ReactNode; activeBg?: string; activeColor?: string }) {
  const bg = activeBg ?? K.teal
  return (
    <button onClick={onClick} style={{
      border: active ? `1.5px solid ${bg}` : `1.5px solid ${K.line}`,
      background: active ? bg : '#fff',
      color: active ? (activeColor ?? '#fff') : K.muted,
      fontWeight: 600, fontSize: 13, padding: '7px 14px',
      borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
      whiteSpace: 'nowrap', flexShrink: 0, transition: 'border-color .12s, background .12s, color .12s',
    }}>{label}</button>
  )
}

function GroupLabel({ children }: { children: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: K.tealDeep,
      textTransform: 'uppercase', letterSpacing: '.07em',
      marginBottom: 8, display: 'block',
    }}>{children}</span>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

const PANEL_H = 'calc(100vh - 210px)'

function LocalBusinessPage() {
  const { barrio, barrios } = useBarrio()
  const { lang } = useLang()
  const t = useT()
  const isMobile = useIsMobile()
  const [mobileView, setMobileView] = useState<'list' | 'map'>('map')

  const [grupo,       setGrupo]       = useState<string | null>(null)
  const [categoria,   setCategoria]   = useState<string | undefined>(undefined)
  const [soloTop,     setSoloTop]     = useState(false)
  const [conWhatsapp, setConWhatsapp] = useState(false)
  const [page,        setPage]        = useState(0)

  const reset = () => setPage(0)
  const anyFilterActive = !!grupo || soloTop || conWhatsapp
  const clearAllFilters = () => {
    setGrupo(null); setCategoria(undefined); setSoloTop(false); setConWhatsapp(false); reset()
  }

  const PAGE_SIZE   = 20
  const grupoActual = grupo ? (GRUPOS_TIENDAS.find(g => g.key === grupo) ?? null) : null
  const barrioParms = { barrio_id: barrio.barrio_id ?? undefined, municipio_nombre: barrio.municipio_nombre }

  const { data: counts } = useGrupoCounts(barrioParms)

  // Destacados — un solo negocio por categoría
  const { data: featuredData } = useTiendas({ ...barrioParms, destacado: true, limit: 20, offset: 0 })
  const featured = (() => {
    const all = featuredData?.tiendas ?? []
    const seen = new Set<string>()
    return all.filter(t => {
      const key = t.categoria ?? '__none'
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })()

  const filterParms = {
    ...barrioParms,
    grupo:        grupo ?? undefined,
    categoria,
    rating_min:   soloTop ? 4.8 : undefined,
    con_whatsapp: conWhatsapp || undefined,
  }

  // Lista paginada
  const { data, isLoading } = useTiendas({ ...filterParms, limit: PAGE_SIZE, offset: page * PAGE_SIZE })

  const tiendas    = data?.tiendas ?? []
  const total      = data?.total ?? 0
  const pages      = Math.ceil(total / PAGE_SIZE)
  const hasArea    = !!(barrio.barrio_id || barrio.municipio_nombre)

  return (
    <>
      {/* ── Header ── */}
      <div style={{ padding: isMobile ? '1.25rem 1rem 1rem' : '2rem 2rem 1.5rem', background: '#FAF8F3', borderBottom: '0.5px solid #E5E0D5' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6E726E', margin: '0 0 4px' }}>
            <Name>{barrio.nombre}</Name> · Medellín
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontFamily: K.serif, fontSize: 28, fontWeight: 700, color: '#111418', margin: '0 0 4px' }}>
                {t('Negocios locales', 'Local Businesses')}
              </h1>
              <p style={{ fontSize: 13, color: '#5B5F5C', margin: 0 }}>
                {isLoading ? '…' : `${total} ${t('negocios en', 'businesses in')} ${barrio.nombre}`}
              </p>
            </div>
            <a
              href="/negocios/unirse"
              style={{
                background: K.teal, color: '#fff', fontWeight: 700,
                fontSize: 13, padding: '9px 18px', borderRadius: 8,
                textDecoration: 'none', letterSpacing: '.3px', flexShrink: 0,
                boxShadow: '0 2px 8px rgba(29,158,117,.25)',
              }}
            >
              {t('Ingresar mi negocio →', 'List my business →')}
            </a>
          </div>
        </div>
      </div>

      {/* ── Destacados — negocios patrocinados, misma tarjeta que los filtros ── */}
      {featured.length > 0 && (
        <div style={{ padding: isMobile ? '1rem 1rem 0' : '1.5rem 2rem 0', background: '#FAF8F3' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div style={{
              background: '#fff', border: `1px solid ${K.line}`, borderTop: `3px solid ${K.amarillo}`,
              borderRadius: 14, padding: '18px 20px 20px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <h2 style={{ fontFamily: K.serif, fontSize: 18, fontWeight: 700, color: K.ink, margin: 0 }}>
                  ⭐ {t('Negocios Destacados', 'Featured Businesses')}
                </h2>
                <span style={{
                  fontSize: 10, color: '#8A6D1D', fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', background: '#FFF6DC', border: '1px solid #F0DFA0',
                  borderRadius: 999, padding: '3px 10px',
                }}>
                  {t('Patrocinado', 'Sponsored')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
                {featured.map(neg => (
                  <div key={neg.id} style={{ minWidth: 240, maxWidth: 240, flexShrink: 0 }}>
                    <BusinessCardDirectory tienda={neg} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Filtros ── */}
      <div style={{ padding: isMobile ? '0.75rem 1rem' : '1rem 2rem', borderBottom: '0.5px solid #E5E0D5', background: '#FAF8F3' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={isMobile
            ? { display: 'flex', flexDirection: 'column', gap: 12 }
            : { background: '#fff', border: `1px solid ${K.line}`, borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }
          }>
            {/* Categoría — grupos + subcategorías */}
            <div>
              <GroupLabel>{t('Categoría', 'Category')}</GroupLabel>
              <div className="filtros-tabs" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                <Pill active={!grupo} onClick={() => { setGrupo(null); setCategoria(undefined); reset() }} label={<>
                  {t('Todos', 'All')}
                  {counts && <span style={{ marginLeft: 5, opacity: .75 }}>{Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString()}</span>}
                </>} />
                {GRUPOS_TIENDAS.map(g => (
                  <Pill key={g.key} active={grupo === g.key} onClick={() => { setGrupo(g.key); setCategoria(undefined); reset() }} label={<>
                    {g.emoji} {lang === 'es' ? g.label : g.labelEn}
                    {counts?.[g.key] != null && <span style={{ marginLeft: 5, opacity: .75 }}>{counts[g.key].toLocaleString()}</span>}
                  </>} />
                ))}
              </div>

              {grupoActual && (
                <div className="filtros-tabs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {[{ key: undefined as string | undefined, label: t('Todos', 'All') },
                    ...grupoActual.categorias.map(c => ({ key: c.key, label: `${c.emoji} ${lang === 'es' ? c.label : c.labelEn}` }))
                  ].map(({ key, label }) => (
                    <Pill key={key ?? '__all'} active={categoria === key} onClick={() => { setCategoria(key); reset() }} label={label} activeBg={K.tealDeep} />
                  ))}
                </div>
              )}
            </div>

            {/* Extra + limpiar */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
              paddingTop: 14, borderTop: `1px solid ${K.line}`,
            }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Pill active={soloTop} onClick={() => { setSoloTop(v => !v); reset() }}
                  label={`⭐ ${t('Solo 5 estrellas', '5-star only')}`} activeBg={K.amarillo} activeColor="#111418" />
                <Pill active={conWhatsapp} onClick={() => { setConWhatsapp(v => !v); reset() }}
                  label={`💬 ${t('Con WhatsApp', 'Has WhatsApp')}`} activeBg="#25D366" activeColor="#fff" />
              </div>
              {anyFilterActive && (
                <button onClick={clearAllFilters} style={{
                  border: 'none', background: 'none', color: K.coral,
                  fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 2px',
                }}>
                  {t('Limpiar filtros ✕', 'Clear filters ✕')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Lista + Mapa ── */}
      <div className="negocios-panel" style={{ display: 'flex', justifyContent: 'center', height: PANEL_H, overflow: 'hidden' }}>
       <div style={{ display: 'flex', width: '100%', maxWidth: 1440 }}>

        {/* Lista — izquierda, scrollable (móvil: pantalla completa, toggle con el mapa) */}
        <div className="negocios-lista" style={isMobile ? {
          display: mobileView === 'list' ? 'block' : 'none', width: '100%', overflowY: 'auto', background: K.surface,
        } : {
          flex: '0 0 480px', overflowY: 'auto', borderRight: `0.5px solid ${K.line}`, background: K.surface,
        }}>
          {isLoading && (
            <p style={{ color: K.muted, padding: '2rem' }}>{t('Cargando…', 'Loading…')}</p>
          )}

          {!isLoading && !hasArea && (
            <div style={{ textAlign: 'center', padding: '60px 2rem' }}>
              <p style={{ fontFamily: K.serif, fontSize: '1.2rem', color: K.muted }}>
                {t(`Próximamente en ${barrio.nombre}.`, `Coming soon to ${barrio.nombre}.`)}
              </p>
            </div>
          )}

          {!isLoading && hasArea && tiendas.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 2rem' }}>
              <p style={{ color: K.muted, marginBottom: 12 }}>{t('Sin resultados.', 'No results.')}</p>
              <a href="/planes" style={{ color: K.coral, fontWeight: 700, textDecoration: 'none' }}>
                {t('Publicar mi negocio →', 'List my business →')}
              </a>
            </div>
          )}

          {!isLoading && hasArea && tiendas.length > 0 && (
            <>
              <div style={{ padding: '12px 16px', fontSize: 12, color: K.muted, fontWeight: 600 }}>
                {tiendas.length} {t('de', 'of')} {total} {t('negocios', 'businesses')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 14px 14px' }}>
                {tiendas.map(neg => (
                  <BusinessCardList key={neg.id} tienda={neg} />
                ))}
              </div>
              {pages > 1 && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '1.25rem' }}>
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{
                    padding: '7px 16px', background: page === 0 ? '#F3F0E8' : K.ink,
                    color: page === 0 ? '#6E726E' : '#FAF8F3',
                    border: 'none', borderRadius: 6, cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  }}>
                    ← {t('Anterior', 'Prev')}
                  </button>
                  <span style={{ padding: '7px 12px', fontSize: 12, color: K.muted }}>{page + 1} / {pages}</span>
                  <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} style={{
                    padding: '7px 16px', background: page >= pages - 1 ? '#F3F0E8' : K.ink,
                    color: page >= pages - 1 ? '#6E726E' : '#FAF8F3',
                    border: 'none', borderRadius: 6, cursor: page >= pages - 1 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  }}>
                    {t('Siguiente', 'Next')} →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Mapa — derecha, llena el resto del ancho compartido (mismo borde de 1440 que el resto de la página, sin hueco muerto). Móvil: pantalla completa, toggle con la lista. */}
        <div className="negocios-mapa" style={isMobile ? {
          display: mobileView === 'map' ? 'block' : 'none', width: '100%', padding: 8, background: K.surface,
        } : {
          flex: 1, padding: 12, background: K.surface,
        }}>
          <NegociosMap barrio={barrio} barrios={barrios} visible={!isMobile || mobileView === 'map'} isMobile={isMobile} />
        </div>

       </div>

       {/* Toggle Lista ⟷ Mapa — solo móvil, estilo Zillow igual a /map */}
       {isMobile && (
         <button
           onClick={() => setMobileView(v => (v === 'list' ? 'map' : 'list'))}
           style={{
             position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
             display: 'flex', alignItems: 'center', gap: 8,
             background: K.ink, color: '#fff', fontWeight: 700, fontSize: 14,
             padding: '10px 20px', borderRadius: 999, border: 'none', cursor: 'pointer',
             boxShadow: '0 4px 16px rgba(0,0,0,.3)',
           }}
         >
           {mobileView === 'list'
             ? (<><MapIcon size={16} /> {t('Mapa', 'Map')}</>)
             : (<><List size={16} /> {t('Lista', 'List')}</>)}
         </button>
       )}
      </div>
    </>
  )
}
