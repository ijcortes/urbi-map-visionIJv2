import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { numberLocale } from "@/lib/format";
import { useState, useCallback, useRef } from 'react'
import { MapView } from '@/components/MapView'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { useBarrio, BARRIOS, type Barrio } from '@/components/comunidad/BarrioContext'
import { useIsMobile } from '@/hooks/use-mobile'
import { useDeals } from '@/hooks/useDeals'
import { useDirectorio } from '@/hooks/useDirectorio'
import { useNoticias } from '@/hooks/useNoticias'
import { useEventosTop } from '@/hooks/useEventosTop'
import { useEventosSemana } from '@/hooks/useEventosSemana'
import { EventCardRow } from '@/components/comunidad/EventCard'
import { HomeTourModal } from '@/components/HomeTourModal'
import { API_ENDPOINTS } from '@/config/api'
import { safeHref } from '@/lib/utils'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/')({
  component: HomePage,
  head: () => seo({ title: "Medellín Social · Tu Ciudad. Tu Barrio. Tu Historia.", description: "Eventos, negocios y cultura local en Medellín y el Valle de Aburrá.", path: "/" }),
})

const K = TOKENS;

const CATEGORIA_LABELS: Record<string, string> = {
  brunch: 'Brunch',
  cena: 'Restaurante',
  gimnasios: 'Gimnasio',
  masajes_spa: 'Spa & Wellness',
  medicos: 'Salud',
  cafes: 'Café',
  bares: 'Bar',
  yoga: 'Yoga',
  dentistas: 'Dental',
  peluquerias: 'Estética',
  almuerzo: 'Almuerzo',
  estetica: 'Estética',
  panaderia: 'Panadería',
}

const CATEGORIA_LABELS_EN: Record<string, string> = {
  brunch: 'Brunch',
  cena: 'Restaurant',
  gimnasios: 'Gym',
  masajes_spa: 'Spa & Wellness',
  medicos: 'Health',
  cafes: 'Café',
  bares: 'Bar',
  yoga: 'Yoga',
  dentistas: 'Dental',
  peluquerias: 'Beauty',
  almuerzo: 'Lunch',
  estetica: 'Beauty',
  panaderia: 'Bakery',
}

const CATEGORIA_COLORS: Record<string, string> = {
  bares: '#111418',
  brunch: '#F3F0E8',
  cafes: '#c8a96e',
  cena: '#2d1b0e',
  gimnasios: '#0F8A4F',
  masajes_spa: '#d4a5c9',
  medicos: '#E6ECF7',
  dentistas: '#E6ECF7',
  peluquerias: '#FCE8EA',
  yoga: '#E7F4EC',
}

const CATEGORIA_EMOJI: Record<string, string> = {
  bares: '🍺',
  brunch: '☕',
  cafes: '☕',
  cena: '🍽️',
  gimnasios: '💪',
  masajes_spa: '🧖',
  medicos: '🏥',
  dentistas: '🦷',
  peluquerias: '✂️',
  yoga: '🧘',
}

// Resuelve la comuna/municipio clickeado en el mapa a su representante en BARRIOS
// (slug + centroide): comunas de Medellín por cd_comuna, municipios del Valle por
// nombre. Ese slug es el que ya consumen /eventos, /local-business y el filtro de
// la home — todos comuna-level, no barrio-level.
function comunaRep(cd: number | null, municipio: string | null): Barrio | undefined {
  return (cd != null ? BARRIOS.find((b) => b.cd_comuna === cd) : undefined)
    ?? (municipio ? BARRIOS.find((b) => b.municipio_nombre?.toUpperCase() === municipio.toUpperCase()) : undefined)
}

type PickedComuna = { nombre: string; slug: string; lat: number; lon: number; cd: number | null; municipio: string | null }

function HeroOverlay({ comuna, onClose, t }: {
  comuna: PickedComuna
  onClose: () => void
  t: (es: string, en: string) => string
}) {
  // "Listings" entra a los listings de ESTA comuna (cd_comuna / municipio), no a un
  // barrio. zoom=12 = tier comuna en /map (>=13 re-scopea a un solo barrio).
  const geo = comuna.municipio
    ? `municipio=${encodeURIComponent(comuna.municipio)}`
    : `cd_comuna=${comuna.cd}`
  const listingsHref = `/map?${geo}&nombre=${encodeURIComponent(comuna.nombre)}&lat=${comuna.lat.toFixed(5)}&lng=${comuna.lon.toFixed(5)}&zoom=12`

  const actions = [
    { href: listingsHref,                       icon: '🏠', bg: K.azulLight,  label: t('Listings', 'Listings'),   sub: t('Propiedades en venta y arriendo', 'Homes for sale and rent') },
    { href: `/local-business/${comuna.slug}`,   icon: '🏪', bg: K.tealLight,  label: t('Negocios', 'Businesses'), sub: t('Comercios y servicios locales', 'Local shops and services') },
    { href: `/eventos/${comuna.slug}`,          icon: '📅', bg: K.coralLight, label: t('Eventos', 'Events'),      sub: t('Qué hacer esta semana', 'What to do this week') },
  ]

  return (
    <div style={{
      position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      width: 'min(340px, calc(100% - 32px))',
      background: K.paper, borderRadius: 16, overflow: 'hidden', zIndex: 10,
      border: `1px solid ${K.line}`,
      boxShadow: '0 18px 48px rgba(17,20,24,.28), 0 2px 8px rgba(17,20,24,.10)',
    }}>
      {/* Firma: franja tricolor Colombia (misma identidad que logo/favicon). */}
      <div style={{ display: 'flex', height: 4 }} aria-hidden>
        <div style={{ flex: 1, background: K.amarillo }} />
        <div style={{ flex: 1, background: K.azul }} />
        <div style={{ flex: 1, background: K.rojo }} />
      </div>

      <div style={{ padding: '13px 15px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 11 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: K.teal, marginBottom: 3 }}>
              {t('Explora la comuna', 'Explore the comuna')}
            </div>
            <div style={{ fontFamily: K.serif, fontWeight: 800, fontSize: 21, lineHeight: 1.08, color: K.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {comuna.nombre}
            </div>
          </div>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')} style={{
            background: K.surface, border: 'none', color: K.muted, cursor: 'pointer',
            fontSize: 17, lineHeight: 1, width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {actions.map((a) => (
            <a key={a.label} href={a.href} className="comuna-action-row" style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 11,
              textDecoration: 'none', color: K.ink,
            }}>
              <span style={{
                width: 34, height: 34, borderRadius: 9, background: a.bg, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              }}>{a.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: K.ink }}>{a.label}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: K.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.sub}</span>
              </span>
              <span className="comuna-action-chev" style={{ color: K.tertiary, fontSize: 18, flexShrink: 0, transition: 'transform .14s ease' }}>›</span>
            </a>
          ))}
        </div>
      </div>

      <style>{`
        .comuna-action-row { transition: background .14s ease; }
        .comuna-action-row:hover { background: ${K.surface}; }
        .comuna-action-row:hover .comuna-action-chev { transform: translateX(2px); color: ${K.ink}; }
      `}</style>
    </div>
  )
}

function SecTitle({ children, link, linkLabel }: { children: string; link?: string; linkLabel?: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', rowGap: 6 }}>
        <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.25rem, 4.5vw, 1.7rem)', letterSpacing: '-.5px', color: K.ink, margin: 0, flexShrink: 0 }}>
          {children}
        </h2>
        <div style={{ height: 2, background: K.ink, flex: '1 1 20px', minWidth: 20, opacity: .1, alignSelf: 'center' }} />
        {link && (
          <a href={link} style={{ fontSize: '.76rem', fontWeight: 800, textTransform: 'uppercase', color: K.tealDeep, whiteSpace: 'nowrap', letterSpacing: '.5px', textDecoration: 'none', flexShrink: 0 }}>
            {linkLabel ?? 'Ver todo →'}
          </a>
        )}
      </div>
    </div>
  )
}

function SideHead({ children }: { children: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: '.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em',
      color: K.tealDeep, borderBottom: `2px solid ${K.teal}`, paddingBottom: 8, margin: '0 0 12px',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: K.coral, flexShrink: 0 }} />
      {children}
    </div>
  )
}

// Fuente sin foto propia → chip de color por fuente en vez de link plano,
// misma fila (thumb 56x56 + texto) que EventCardRow para que ambas listas
// del panel "Trading" luzcan como una sola arquitectura.
function NoticiaRow({ noticia, last = false }: { noticia: { id: number; titulo: string; url: string; fuente: string | null; fecha_publicacion: string | null }; last?: boolean }) {
  const fecha = noticia.fecha_publicacion
    ? new Date(noticia.fecha_publicacion).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'short' })
    : null
  return (
    <a href={noticia.url} target="_blank" rel="noopener noreferrer" style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      paddingBottom: 12, marginBottom: 12,
      borderBottom: last ? 'none' : `1px solid ${K.line}`,
      textDecoration: 'none',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 10, flexShrink: 0,
        background: `linear-gradient(135deg, ${K.tealDeep}, ${K.teal})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem',
      }}>
        📰
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 style={{
          fontFamily: K.serif, fontWeight: 600, fontSize: 13.5, color: K.ink, lineHeight: 1.3, margin: '0 0 4px',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        }}>
          {noticia.titulo}
        </h4>
        <p style={{ fontSize: 11, color: K.muted, margin: 0, textTransform: 'uppercase', letterSpacing: '.02em', fontWeight: 600 }}>
          {noticia.fuente === 'el_colombiano' ? 'El Colombiano' : (noticia.fuente ?? 'Medellín')}{fecha ? ` · ${fecha}` : ''}
        </p>
      </div>
    </a>
  )
}

function HomeContent() {
  const { barrio, lang, setBarrioSlug } = useBarrio()
  const isMobile = useIsMobile()
  const t = (es: string, en: string) => lang === 'es' ? es : en
  const catLabel = (cat: string) => (lang === 'es' ? CATEGORIA_LABELS : CATEGORIA_LABELS_EN)[cat] ?? cat

  const [nombre, setNombre] = useState('')
  const [email,  setEmail]  = useState('')
  const [suscrito, setSuscrito] = useState(false)
  const [suscribiendo, setSuscribiendo] = useState(false)
  const [suscribeError, setSuscribeError] = useState(false)

  const handleSuscribirse = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setSuscribiendo(true)
    setSuscribeError(false)
    try {
      const res = await fetch(API_ENDPOINTS.suscribirse, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, barrio_id: barrio.barrio_id ?? null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSuscrito(true)
    } catch {
      setSuscribeError(true)
    } finally {
      setSuscribiendo(false)
    }
  }, [nombre, email, barrio.barrio_id])

  const [pickedComuna, setPickedComuna] = useState<PickedComuna | null>(null)
  const returnToComunasRef = useRef<((speed?: number) => void) | null>(null)

  // Click en comuna/municipio del mapa → tarjeta con sus 3 accesos (listings /
  // negocios / eventos de ESA comuna). Sin paso intermedio de elegir barrio: no
  // tenemos datos lo bastante segmentados para filtrar por barrio todavía.
  const handleComunaSelect = useCallback((level: 'comunas' | 'barrios', _nombre: string | null, municipio?: string | null, cd?: number | null) => {
    if (level !== 'barrios') return // "comunas" = volver al valle; ignorar
    const rep = comunaRep(cd ?? null, municipio ?? null)
    if (!rep || rep.lat == null || rep.lon == null) return // comuna sin representante (sin datos) → no-op
    setPickedComuna({
      nombre: rep.nombre, slug: rep.slug, lat: rep.lat, lon: rep.lon,
      cd: rep.cd_comuna ?? null, municipio: rep.municipio_nombre ?? null,
    })
    setBarrioSlug(rep.slug) // filtra deals/directorio/eventos de toda la página en vivo
  }, [setBarrioSlug])

  const handleOverlayClose = useCallback(() => {
    setPickedComuna(null)
    returnToComunasRef.current?.() // zoom-out de vuelta al valle
  }, [])

  const isTodos  = barrio.slug === 'todos'
  const noBarrio = !barrio.barrio_id && !isTodos

  // Comuna de Medellín: filtra deals/directorio/noticias por TODA la comuna
  // (cd_comuna), no por el barrio representante. Valle (sin cd_comuna) → municipio.
  const comunaFilter = isTodos ? null : (barrio.cd_comuna ?? null)
  const barrioFilter = isTodos ? null : (barrio.barrio_id ?? null)
  const municipioFilter = isTodos ? undefined : barrio.municipio_nombre

  const { data: noticias   = [], isLoading: noticiasLoading } = useNoticias(4, barrioFilter, municipioFilter, comunaFilter)
  const { data: deals      = [], isLoading: dealsLoading }  = useDeals(1, barrioFilter, municipioFilter, comunaFilter)
  const { data: directorio = [], isLoading: dirLoading }    = useDirectorio(1, barrioFilter, municipioFilter, comunaFilter)
  // Eventos ya expanden a la comuna del barrio_id vía raw.barrios.comuna — sin cambio.
  const { data: eventosTop = [] }                           = useEventosTop(barrioFilter, municipioFilter, 3)
  const { data: eventosSemana = [] }                        = useEventosSemana(barrioFilter, municipioFilter, 4)

  return (
    <>
      <HomeTourModal isMobile={isMobile} />

      {/* ── HERO — mapa /map (comunas → barrios, sin listings) + Trading en tu barrio ── */}
      <section style={{ padding: isMobile ? '20px 16px' : '32px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'center', gap: 24 }}>
          <div
            data-tour="home-hero-map"
            style={{
              position: 'relative', overflow: 'hidden', borderRadius: 16,
              width: isMobile ? '100%' : '60%', height: isMobile ? '42vh' : '58vh', minHeight: isMobile ? 280 : 380,
              boxShadow: '0 8px 30px rgba(20,32,29,.12)',
            }}
          >
            <MapView
              mapView="zonas"
              selectedId={null}
              onSelect={() => {}}
              onViewLevelChange={handleComunaSelect}
              returnToComunasRef={returnToComunasRef}
              cooperativeGestures={isMobile}
              // ponytail: constante por breakpoint, no medida en vivo — alcanza pa
              // que la tarjeta de barrio_action (la más alta) no tape la zona
              // recién centrada. Si el overlay crece mucho, medir con ResizeObserver.
              bottomInset={isMobile ? 180 : 140}
              // fitBounds Bello↔La Estrella (simétrico) + mapa PLANO: pitch/bearing 0
              // → los polígonos extremos quedan equidistantes del borde y el valle
              // siempre centrado, sin distorsión del tilt.
              fitValle
              pitch={0}
              bearing={0}
            />
            {pickedComuna && (
              <HeroOverlay comuna={pickedComuna} onClose={handleOverlayClose} t={t} />
            )}
          </div>

          <div data-tour="home-trending" style={{
            width: isMobile ? '100%' : '40%', minWidth: 0, height: isMobile ? 'auto' : '58vh', minHeight: isMobile ? 200 : 380,
            border: `1px solid ${K.line}`, borderRadius: 16, padding: '20px 22px',
            background: K.paper, display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>
            <h2 style={{ fontFamily: K.serif, fontWeight: 800, fontSize: '1.15rem', color: K.ink, margin: '0 0 4px' }}>
              {t('Trending en tu barrio', 'Trending in your barrio')}
            </h2>
            <p style={{ color: K.muted, fontSize: '.88rem', margin: '0 0 16px' }}>
              {t(`Lo más importante en ${barrio.nombre} ahora mismo.`, `The most important thing in ${barrio.nombre} right now.`)}
            </p>

            {/* Noticias — últimas, ya cargadas arriba en la página */}
            <SideHead>{t('Noticias', 'News')}</SideHead>
            <div style={{ marginBottom: 20 }}>
              {noticias.length === 0 ? (
                <p style={{ color: K.muted, fontSize: '.82rem' }}>{t('Sin noticias por ahora.', 'No news right now.')}</p>
              ) : noticias.slice(0, 3).map((n, i, arr) => (
                <NoticiaRow key={n.id ?? i} noticia={n} last={i === arr.length - 1} />
              ))}
            </div>

            {/* Eventos destacados — solo los patrocinados/featured */}
            <SideHead>{t('Eventos destacados', 'Featured events')}</SideHead>
            <div>
              {eventosTop.length === 0 ? (
                <p style={{ color: K.muted, fontSize: '.82rem' }}>{t('Sin eventos destacados por ahora.', 'No featured events right now.')}</p>
              ) : eventosTop.map((evt, i, arr) => (
                <EventCardRow key={evt.id} evento={evt} last={i === arr.length - 1} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── NO BARRIO ─────────────────────────────────── */}
      {noBarrio && (
        <div style={{ maxWidth: 1200, margin: '48px auto', padding: '0 26px', textAlign: 'center' }}>
          <p style={{ fontFamily: K.serif, fontSize: '1.4rem', color: K.muted }}>
            {t(`Próximamente en ${barrio.nombre}.`, `Coming soon to ${barrio.nombre}.`)}
          </p>
        </div>
      )}

      {/* ── SECCIÓN 1 — LO ÚLTIMO DEL BARRIO ─────────── */}
      <section data-tour="home-noticias" className="section-padding" style={{ padding: isMobile ? '28px 16px 20px' : '72px 26px 56px', borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <SecTitle link="/blog" linkLabel={t('Todas las noticias →', 'All news →')}>
            {t('Lo último del barrio', 'Latest from the Barrio')}
          </SecTitle>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: isMobile ? 10 : 16 }} className="noticias-grid">
            {noticias.length === 0 ? (
              <p style={{ color: K.muted, gridColumn: '1/-1' }}>
                {noticiasLoading
                  ? t('Cargando noticias...', 'Loading news...')
                  : t('Aún no hay noticias de este barrio. Vuelve pronto.', 'No news for this barrio yet. Check back soon.')}
              </p>
            ) : (isMobile ? noticias.slice(0, 2) : noticias).map((n, i) => (
              <a key={n.id ?? i} href={n.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'block', padding: isMobile ? '12px 12px 10px' : '18px 18px 16px',
                background: K.paper,
                borderRadius: isMobile ? 10 : 14,
                boxShadow: '0 1px 6px rgba(20,32,29,.07), 0 4px 18px rgba(20,32,29,.04)',
                textDecoration: 'none',
              }}>
                <span style={{
                  display: 'inline-block',
                  fontFamily: K.manrope,
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.07em', color: K.coral,
                  background: K.coralLight,
                  padding: '2px 7px', borderRadius: 999,
                  marginBottom: 7,
                }}>
                  {n.fuente === 'el_colombiano' ? 'El Colombiano' : (n.fuente ?? 'Medellín')}
                </span>
                <h3 style={{
                  fontFamily: K.serif, fontSize: isMobile ? 13 : 16, fontWeight: 600,
                  color: K.ink, lineHeight: 1.3, margin: '0 0 6px',
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {n.titulo}
                </h3>
                {!isMobile && n.fecha_publicacion && (
                  <span style={{ fontFamily: K.manrope, fontSize: 11, color: K.muted, letterSpacing: '.2px' }}>
                    {new Date(n.fecha_publicacion).toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── QUÉ HACER ESTA SEMANA ─────────────────────── */}
      <section data-tour="home-eventos-semana" style={{ padding: isMobile ? '24px 16px' : '48px 26px' }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          background: `linear-gradient(125deg, ${K.tealDeep}, ${K.teal})`, color: '#fff',
          borderRadius: 18, padding: isMobile ? '24px 18px' : '36px',
          boxShadow: '0 18px 44px rgba(8,80,65,.25)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
            <div>
              <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: isMobile ? '1.3rem' : '1.7rem', margin: 0 }}>
                {t('Qué hacer esta semana', "What's On This Week")}
              </h2>
              <p style={{ opacity: .9, fontSize: '.95rem', margin: '4px 0 0' }}>
                {t('Cada evento de tu barrio, en un solo lugar.', 'Every event in your barrio, in one place.')}
              </p>
            </div>
            <a href={`/eventos/${barrio.slug}`} style={{
              background: '#fff', color: K.ink, padding: '11px 22px', borderRadius: 999,
              fontWeight: 800, fontSize: '.86rem', textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
              {t('Ver calendario →', 'Full Calendar →')}
            </a>
          </div>

          {eventosSemana.length === 0 ? (
            <p style={{ opacity: .9 }}>{t('Sin eventos programados esta semana.', 'No events scheduled this week.')}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(210px, 1fr))', gap: 16 }}>
              {eventosSemana.map(evt => {
                const d = new Date(evt.fecha_inicio.replace(' ', 'T'))
                const valid = !isNaN(d.getTime())
                const day = valid ? d.toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', { day: 'numeric' }) : '?'
                const month = valid ? d.toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', { month: 'short' }).replace('.', '').toUpperCase() : ''
                return (
                  <a key={evt.id} href={safeHref(evt.url_externo) ?? `/eventos/${barrio.slug}`} target="_blank" rel="noopener noreferrer" style={{
                    display: 'block', minWidth: 0, background: 'rgba(255,255,255,.13)', border: '1px solid rgba(255,255,255,.22)',
                    borderRadius: 14, padding: 18, backdropFilter: 'blur(8px)', textDecoration: 'none', color: '#fff',
                  }}>
                    <div style={{ fontFamily: K.serif, fontSize: '2.1rem', fontWeight: 900, lineHeight: 1, color: K.amarillo }}>{day}</div>
                    <div style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '1.2px', opacity: .88, marginTop: 3 }}>{month}</div>
                    <h4 style={{
                      fontSize: '1.02rem', margin: '11px 0 5px', fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere',
                      overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                    }}>
                      {evt.titulo}
                    </h4>
                    <div style={{ fontSize: '.82rem', opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.barrio_nombre || evt.organizador || 'Medellín'}</div>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── SECCIÓN 2 — HOTSPOTS & DEALS ─────────────── */}
      <section data-tour="home-deals" className="section-padding" style={{ padding: '72px 26px 56px', background: K.surface, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <SecTitle link={`/local-business/${barrio.slug}`} linkLabel={t('Ver todos →', 'See all →')}>
            {t('Hotspots & Deals exclusivos', 'Hotspots & Exclusive Deals')}
          </SecTitle>

          <div className="deals-grid" style={isMobile
            ? { display: 'flex', overflowX: 'auto', gap: 12, paddingBottom: 6, WebkitOverflowScrolling: 'touch' }
            : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }
          }>
            {dealsLoading ? (
              <p style={{ color: K.muted, gridColumn: '1/-1', fontSize: 14 }}>
                {t('Cargando deals...', 'Loading deals...')}
              </p>
            ) : deals.length === 0 ? (
              <div style={{ gridColumn: '1/-1', padding: '2rem', textAlign: 'center', background: K.paper, borderRadius: 10, border: `0.5px solid ${K.line}` }}>
                <p style={{ color: K.muted, marginBottom: 8, margin: '0 0 8px' }}>
                  {t(`Aún no hay deals en ${barrio.nombre}.`, `No deals in ${barrio.nombre} yet.`)}
                </p>
                <a href="/negocios/unirse" style={{ color: K.coral, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
                  {t('¿Tienes un negocio? Publícalo aquí →', 'Have a business? List it here →')}
                </a>
              </div>
            ) : deals.map((deal, i) => (
              <div key={deal.id ?? i} style={{
                background: K.paper,
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: '0 2px 10px rgba(20,32,29,.08)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
                padding: '18px 14px 16px',
                ...(isMobile ? { flex: '0 0 200px' } : {}),
              }}>
                {/* Foto circular */}
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', position: 'relative',
                  background: CATEGORIA_COLORS[deal.categoria ?? ''] ?? K.surface,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 12, flexShrink: 0,
                }}>
                  <span style={{ fontSize: 28, zIndex: 1 }}>
                    {deal.categoria === 'bares' ? '🍸' : deal.categoria === 'masajes_spa' ? '💆' : deal.categoria === 'brunch' ? '🥞' : '🍽️'}
                  </span>
                  {deal.foto_url && (
                    <img
                      src={deal.foto_url}
                      alt={deal.tienda_nombre}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 2 }}
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontFamily: K.manrope, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: K.muted, background: K.surface, padding: '3px 8px', borderRadius: 999 }}>
                    {catLabel(deal.categoria ?? '')}
                  </span>
                  <span style={{ fontFamily: K.manrope, fontSize: 10, fontWeight: 800, color: '#fff', background: K.coral, padding: '3px 9px', borderRadius: 999 }}>
                    {deal.tipo_deal}
                  </span>
                </div>
                <p style={{ fontFamily: K.manrope, fontWeight: 600, fontSize: 14, color: K.ink, margin: '0 0 3px' }}>
                  {deal.descripcion}
                </p>
                <p style={{ fontFamily: K.manrope, fontSize: 12, color: K.muted, margin: 0 }}>
                  {deal.tienda_nombre}{deal.barrio_nombre ? ` · ${deal.barrio_nombre}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECCIÓN 3 — DIRECTORIO 5 ESTRELLAS ───────── */}
      <section data-tour="home-directorio" className="section-padding" style={{ padding: '72px 26px', borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <SecTitle link={`/local-business/${barrio.slug}`} linkLabel={t('Ver todo →', 'Browse all →')}>
            {t('Directorio 5 Estrellas', '5-Star Directory')}
          </SecTitle>
          <p style={{ color: K.muted, marginBottom: 22, maxWidth: 700, fontSize: '1rem', marginTop: 0 }}>
            {t(
              'Un nombre de confianza por categoría — los negocios que tus vecinos ya aman.',
              'One trusted name per category — the businesses your neighbors already love.',
            )}
          </p>

          <div className="directorio-grid" style={isMobile
            ? { display: 'flex', overflowX: 'auto', gap: 12, paddingBottom: 6, WebkitOverflowScrolling: 'touch' }
            : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }
          }>
            {dirLoading ? (
              <p style={{ color: K.muted, gridColumn: '1/-1', fontSize: 14 }}>
                {t('Cargando directorio...', 'Loading directory...')}
              </p>
            ) : directorio.length === 0 ? (
              <div style={{ gridColumn: '1/-1', padding: '2rem', textAlign: 'center', background: K.paper, borderRadius: 10, border: `0.5px solid ${K.line}` }}>
                <p style={{ color: K.muted, marginBottom: 8, margin: '0 0 8px' }}>
                  {t(`Sin negocios destacados en ${barrio.nombre} aún.`, `No featured businesses in ${barrio.nombre} yet.`)}
                </p>
                <a href={`/local-business/${barrio.slug}`} style={{ color: K.coral, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
                  {t('Explorar directorio completo →', 'Explore full directory →')}
                </a>
              </div>
            ) : directorio.slice(0, 4).map((negocio, i) => (
              <div key={negocio.id ?? i} style={{
                background: K.paper,
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: '0 2px 10px rgba(20,32,29,.08)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
                padding: '18px 14px 16px',
                ...(isMobile ? { flex: '0 0 200px' } : {}),
              }}>
                {/* Foto circular */}
                <div style={{
                  width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', position: 'relative',
                  background: CATEGORIA_COLORS[negocio.categoria] ?? K.surface,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 12, flexShrink: 0,
                }}>
                  <span style={{ fontSize: 32, zIndex: 1 }}>
                    {CATEGORIA_EMOJI[negocio.categoria] ?? '⭐'}
                  </span>
                  {negocio.foto_url && (
                    <img
                      src={negocio.foto_url}
                      alt={negocio.nombre}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 2 }}
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontFamily: K.manrope, fontSize: 10, fontWeight: 800, color: K.ink, background: K.amarillo, padding: '3px 9px', borderRadius: 999, letterSpacing: '.4px' }}>
                    ★ {catLabel(negocio.categoria)}
                  </span>
                  {negocio.barrio_nombre && (
                    <span style={{ fontFamily: K.manrope, fontSize: 10, fontWeight: 600, color: K.muted, background: K.surface, padding: '3px 8px', borderRadius: 999, letterSpacing: '.3px' }}>
                      {negocio.barrio_nombre}
                    </span>
                  )}
                </div>

                <p style={{ fontFamily: K.manrope, fontWeight: 700, fontSize: 15, color: K.ink, margin: '0 0 5px', lineHeight: 1.2 }}>
                  {negocio.nombre}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 11 }}>
                  {negocio.rating_google != null ? (
                    <>
                      <span style={{ color: '#FCD116', fontSize: 13, letterSpacing: 1 }}>
                        {'★'.repeat(Math.round(negocio.rating_google))}
                        {'☆'.repeat(5 - Math.round(negocio.rating_google))}
                      </span>
                      <span style={{ fontFamily: K.manrope, fontSize: 12, color: K.muted }}>{negocio.rating_google.toFixed(1)}</span>
                    </>
                  ) : (
                    <span style={{ fontFamily: K.manrope, fontSize: 12, color: K.muted }}>
                      {t('Sin reseñas aún', 'No reviews yet')}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  {(negocio.google_place_id || negocio.lat) && (
                    <a
                      href={negocio.google_place_id
                        ? `https://www.google.com/maps/place/?q=place_id:${negocio.google_place_id}`
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(negocio.nombre + ' ' + (negocio.barrio_nombre ?? 'Medellín'))}`
                      }
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        flex: 1, textAlign: 'center', padding: '7px 0',
                        background: K.surface,
                        borderRadius: 8, fontFamily: K.manrope, fontSize: 12, color: K.ink,
                        textDecoration: 'none', fontWeight: 600,
                      }}
                    >
                      📍 {t('Ver en Maps', 'View on Maps')}
                    </a>
                  )}
                  {negocio.whatsapp && (
                    <a
                      href={`https://wa.me/${negocio.whatsapp.replace(/\D/g, '')}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        flex: 1, textAlign: 'center', padding: '7px 0',
                        background: '#25D366', borderRadius: 8,
                        fontFamily: K.manrope, fontSize: 12, color: '#fff',
                        textDecoration: 'none', fontWeight: 600,
                      }}
                    >
                      💬 WhatsApp
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── REAL ESTATE ───────────────────────────────── */}
      <section className="section-padding" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div data-tour="home-realestate" className="real-estate-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', background: K.paper, borderRadius: 20, overflow: 'hidden', boxShadow: '0 8px 40px rgba(20,32,29,.12)' }}>
            <div style={{ minHeight: 340, backgroundImage: `url('https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=900&q=80'), linear-gradient(145deg, #0D1F1A 0%, #1A2B22 100%)`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            <div style={{ padding: 'clamp(24px, 5vw, 48px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: K.paper }}>
              <span style={{ display: 'inline-block', fontFamily: K.manrope, background: K.coralLight, color: K.coral, fontWeight: 800, fontSize: '.68rem', letterSpacing: '1.4px', textTransform: 'uppercase', padding: '6px 13px', borderRadius: 999, alignSelf: 'flex-start', marginBottom: 16 }}>
                {t('Inversión Inmobiliaria', 'Real Estate Investment')}
              </span>
              <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.55rem,3.5vw,2rem)', margin: '0 0 10px', letterSpacing: '-.5px', color: K.ink }}>
                {t('Invierte en Medellín con datos reales.', 'Invest in Medellín with real data.')}
              </h2>
              <p style={{ fontFamily: K.manrope, color: K.muted, marginBottom: 28, lineHeight: 1.6, fontSize: '.98rem' }}>
                {t(
                  'Yields, precios justos y oportunidades por barrio. El primer motor de decisión inmobiliaria del Valle de Aburrá.',
                  'Yields, fair prices and opportunities by neighborhood. The first real estate decision engine in the Aburrá Valley.',
                )}
              </p>

              {/* Financial metrics — Stripe-style */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderTop: `1.5px solid ${K.line}`, borderBottom: `1.5px solid ${K.line}`, padding: '20px 0' }}>
                <div style={{ flex: 1, paddingRight: 22, borderRight: `1.5px solid ${K.line}` }}>
                  <div style={{ fontFamily: K.manrope, fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: K.muted, marginBottom: 8 }}>
                    {t('Arriendos desde', 'Rentals from')}
                  </div>
                  <div style={{ fontFamily: K.serif, fontSize: 'clamp(2rem, 4.5vw, 2.8rem)', fontWeight: 900, color: K.tealDeep, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    $1.4M<span style={{ fontSize: '1rem', fontWeight: 500, color: K.muted, letterSpacing: 0 }}>/mes</span>
                  </div>
                </div>
                <div style={{ flex: 1, paddingLeft: 22 }}>
                  <div style={{ fontFamily: K.manrope, fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: K.muted, marginBottom: 8 }}>
                    {t('Yield promedio', 'Avg. yield')}
                  </div>
                  <div style={{ fontFamily: K.serif, fontSize: 'clamp(2rem, 4.5vw, 2.8rem)', fontWeight: 900, color: K.coral, letterSpacing: '-1.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    7.2%<span style={{ fontSize: '1rem', fontWeight: 500, color: K.muted, letterSpacing: 0 }}> EA</span>
                  </div>
                </div>
              </div>

              <a href="/map" style={{ fontFamily: K.manrope, display: 'inline-block', background: K.ink, color: '#fff', fontWeight: 800, padding: '13px 26px', borderRadius: 999, textDecoration: 'none', fontSize: '.92rem', alignSelf: 'flex-start', letterSpacing: '.2px' }}>
                {t('Ver el mapa de inversión', 'Explore investment map')}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── EMPRESAS QUE CONFÍAN EN NOSOTROS — tira de logos aliados ─── */}
      <section className="section-padding" style={{ padding: '56px 26px', background: K.surface, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', textAlign: 'center' }}>
          <p style={{
            fontFamily: K.manrope, fontSize: '.78rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '.1em', color: K.muted, margin: '0 0 20px',
          }}>
            {t('Empresas que confían en nosotros', 'Companies that trust us')}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 16 }}>
            <a href="https://casadolcecasa.com.co" target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: K.paper, padding: '14px 28px', borderRadius: 10,
              boxShadow: '0 2px 10px rgba(20,32,29,.08)',
            }}>
              <img src="/partners/casa-dolce-casa.png" alt="Casa Dolce Casa" style={{ height: 40, width: 'auto' }} />
            </a>
          </div>
        </div>
      </section>

      {/* ── SUSCRIPCIÓN ───────────────────────────────── */}
      <section id="subscribe" className="section-padding" style={{ padding: '0 16px 72px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', background: 'linear-gradient(145deg, #161A17 0%, #111418 55%, #2A1A10 100%)', borderRadius: 22, padding: 'clamp(32px, 5vw, 60px) clamp(20px, 5vw, 52px)', textAlign: 'center', color: '#fff', boxShadow: '0 16px 48px rgba(20,32,29,.28)' }}>
          <span style={{ fontFamily: K.manrope, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', fontSize: '.72rem', background: 'rgba(216,90,48,.22)', border: '1px solid rgba(216,90,48,.4)', color: K.coral, display: 'inline-block', padding: '7px 18px', borderRadius: 999, marginBottom: 20 }}>
            🎉 {t('Miembros Fundadores · Invitación a la Fiesta', 'Founding Members · Launch Party Invite')}
          </span>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.9rem,4.5vw,2.9rem)', margin: '0 0 14px', letterSpacing: '-.5px' }}>
            {t('Sé Parte del Comienzo', 'Be Part of the Beginning')}
          </h2>
          <p style={{ fontFamily: K.manrope, maxWidth: 600, margin: '0 auto 30px', fontSize: '1.02rem', lineHeight: 1.6, color: 'rgba(255,255,255,.76)' }}>
            {t(
              'Medellín Social llega barrio por barrio. Suscríbete gratis y recibe lo mejor de tu barrio antes que nadie.',
              'Medellín Social rolls out barrio by barrio. Subscribe free and get the best of your barrio first.',
            )}
          </p>
          {suscrito ? (
            <p style={{ fontFamily: K.manrope, fontWeight: 800, fontSize: '1.18rem', color: K.teal }}>
              🎉 {t('¡Estás en la lista fundadora!', "You're on the founding list!")}
            </p>
          ) : (
            <form onSubmit={handleSuscribirse} style={{ display: 'flex', gap: 10, maxWidth: 560, margin: '0 auto', flexWrap: 'wrap', justifyContent: 'center' }}>
              <input type="text" required value={nombre} onChange={e => setNombre(e.target.value)} placeholder={t('Tu nombre', 'Your name')} style={{ flex: '1 1 160px', padding: '14px 18px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 11, fontSize: '.96rem', fontFamily: K.manrope, background: 'rgba(255,255,255,.07)', color: '#fff', outline: 'none' }} />
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder={t('Tu correo', 'Your email')} style={{ flex: '1 1 180px', padding: '14px 18px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 11, fontSize: '.96rem', fontFamily: K.manrope, background: 'rgba(255,255,255,.07)', color: '#fff', outline: 'none' }} />
              <button type="submit" disabled={suscribiendo} style={{ width: '100%', background: K.coral, color: '#fff', border: 'none', fontFamily: K.manrope, fontWeight: 800, padding: '14px 26px', borderRadius: 999, cursor: suscribiendo ? 'default' : 'pointer', fontSize: '.94rem', letterSpacing: '.3px', opacity: suscribiendo ? .7 : 1 }}>
                {suscribiendo ? t('Enviando...', 'Sending...') : t('Quiero mi Invitación 🎟️', 'Get My Invite 🎟️')}
              </button>
              {suscribeError && (
                <p style={{ width: '100%', margin: 0, fontFamily: K.manrope, fontSize: '.85rem', color: '#ffb4a3' }}>
                  {t('Algo salió mal. Intenta de nuevo.', 'Something went wrong. Please try again.')}
                </p>
              )}
            </form>
          )}
          <p style={{ fontFamily: K.manrope, fontSize: '.8rem', opacity: .55, marginTop: 18 }}>
            {t('Gratis para siempre. Sin spam.', 'Free forever. No spam.')}
          </p>
        </div>
      </section>
    </>
  )
}

function HomePage() {
  return (
    <ComunidadLayout initialSlug="todos">
      <HomeContent />
    </ComunidadLayout>
  )
}
