import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { useBarrio } from '@/components/comunidad/BarrioContext'
import { EventCardMini, EventCardFeatured, type EventoData } from '@/components/comunidad/EventCard'
import { API_BASE_URL } from '@/config/api'
import { CATEGORIAS_EVENTOS } from '@/lib/categorias_comunidad'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/eventos/$barrio_slug')({
  component: EventosRoot,
  head: ({ params }) => ({
    meta: [{ title: `Eventos en ${params.barrio_slug.replace(/-/g, ' ')} · Medellín Social` }],
  }),
})

function EventosRoot() {
  const { barrio_slug } = Route.useParams()
  return (
    <ComunidadLayout initialSlug={barrio_slug}>
      <EventosPage />
    </ComunidadLayout>
  )
}

const K = TOKENS;

interface EventosResp { total: number; eventos: EventoData[] }
const PAGE_SIZE = 12

const FILTROS_FECHA = [
  { id: 'all',    es: 'Todas',      en: 'All' },
  { id: 'hoy',   es: 'Hoy',         en: 'Today' },
  { id: 'finde', es: 'Este finde',  en: 'Weekend' },
  { id: 'semana',es: 'Esta semana', en: 'This week' },
  { id: 'mes',   es: 'Este mes',    en: 'This month' },
]
const FILTROS_AUDIENCIA = [
  { id: 'all',         es: 'Todos',       en: 'All' },
  { id: 'social',      es: 'Social',      en: 'Social' },
  { id: 'profesional', es: 'Profesional', en: 'Professional' },
  { id: 'activo',      es: 'Activo',      en: 'Active' },
]

function Pill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      border: active ? `1.5px solid ${K.teal}` : `1.5px solid ${K.line}`,
      background: active ? K.teal : '#fff',
      color: active ? '#fff' : K.muted,
      fontWeight: 600, fontSize: '.8rem', padding: '7px 14px',
      borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
      whiteSpace: 'nowrap', flexShrink: 0, transition: 'border-color .12s, background .12s, color .12s',
    }}>{label}</button>
  )
}

function GroupLabel({ children }: { children: string }) {
  return (
    <span style={{
      fontSize: '.68rem', fontWeight: 700, color: K.tealDeep,
      textTransform: 'uppercase', letterSpacing: '.07em',
      marginBottom: 8, display: 'block',
    }}>{children}</span>
  )
}

function EventosPage() {
  const { barrio, lang } = useBarrio()
  const t = (es: string, en: string) => lang === 'es' ? es : en

  const [categoria, setCategoria] = useState('all')
  const [fecha, setFecha]         = useState('all')
  const [audiencia, setAudiencia] = useState('all')
  const [gratuito, setGratuito]   = useState(false)
  const [page, setPage]           = useState(0)

  function buildParams() {
    const p = new URLSearchParams()
    if (categoria !== 'all') p.set('categoria', categoria)
    if (audiencia !== 'all') p.set('tipo_audiencia', audiencia)
    if (gratuito) p.set('gratuito', 'true')
    const now = new Date()
    if (fecha === 'hoy') {
      const d = now.toISOString().split('T')[0]; p.set('fecha_desde', d); p.set('fecha_hasta', d)
    } else if (fecha === 'finde') {
      const sat = new Date(now); sat.setDate(now.getDate() + (6 - now.getDay()))
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1)
      p.set('fecha_desde', sat.toISOString().split('T')[0])
      p.set('fecha_hasta', sun.toISOString().split('T')[0])
    } else if (fecha === 'semana') {
      const n = new Date(now); n.setDate(now.getDate() + 7)
      p.set('fecha_hasta', n.toISOString().split('T')[0])
    } else if (fecha === 'mes') {
      const n = new Date(now); n.setDate(now.getDate() + 30)
      p.set('fecha_hasta', n.toISOString().split('T')[0])
    }
    p.set('limit', String(PAGE_SIZE))
    p.set('offset', String(page * PAGE_SIZE))
    return p.toString()
  }

  const hasData = !!(barrio.barrio_id || barrio.municipio_nombre)

  const { data, isLoading } = useQuery<EventosResp | null>({
    queryKey: ['eventos', barrio.barrio_id, barrio.municipio_nombre, categoria, fecha, audiencia, gratuito, page],
    queryFn: async () => {
      if (!hasData) return null
      const url = barrio.municipio_nombre
        ? `${API_BASE_URL}/comunidad/municipio/${encodeURIComponent(barrio.municipio_nombre)}/eventos?${buildParams()}`
        : `${API_BASE_URL}/comunidad/${barrio.barrio_id}/eventos?${buildParams()}`
      const r = await fetch(url)
      return r.ok ? r.json() as Promise<EventosResp> : null
    },
    enabled: hasData,
  })

  const eventos  = data?.eventos ?? []
  const total    = data?.total ?? 0
  const pages    = Math.ceil(total / PAGE_SIZE)
  const featured = eventos.filter(e => e.destacado)
  const regular  = eventos.filter(e => !e.destacado)
  const reset    = () => setPage(0)
  const anyFilterActive = categoria !== 'all' || fecha !== 'all' || audiencia !== 'all' || gratuito
  const clearAllFilters = () => {
    setCategoria('all'); setFecha('all'); setAudiencia('all'); setGratuito(false); reset()
  }

  return (
    <>
      {/* ── Header ── */}
      <div style={{ background: K.surface, borderBottom: `1px solid ${K.line}`, padding: '36px 26px 28px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ color: K.teal, fontWeight: 700, fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '1.5px', margin: '0 0 8px' }}>
              {t('Eventos', 'Events')}
            </p>
            <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.8rem,4vw,2.8rem)', letterSpacing: '-.5px', color: K.ink, margin: '0 0 6px' }}>
              {t(`En ${barrio.nombre}`, `In ${barrio.nombre}`)}
            </h1>
            <p style={{ color: K.muted, fontSize: '1rem', margin: 0 }}>
              {t('Todos los eventos, en un solo lugar.', 'Every event, in one place.')}
              {total > 0 && <span style={{ marginLeft: 8, fontWeight: 700, color: K.coral }}>{total} {total === 1 ? t('evento', 'event') : t('eventos', 'events')}</span>}
            </p>
          </div>
          <a
            href="/negocios/unirse"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: K.coral, color: '#fff',
              fontWeight: 700, fontSize: '.88rem',
              padding: '10px 20px', borderRadius: 8,
              textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            + {t('Ingresa tu evento', 'Submit your event')}
          </a>
        </div>
      </div>

      {/* ── Destacados — row above filters ── */}
      {!isLoading && hasData && featured.length > 0 && (
        <section style={{ background: '#FAF8F3', borderBottom: `0.5px solid #E5E0D5`, padding: '28px 26px' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1.25rem' }}>
              <h2 style={{ fontFamily: K.serif, fontSize: '20px', fontWeight: 700, color: '#111418', margin: 0 }}>
                {t('Eventos destacados', 'Featured Events')}
              </h2>
              <span style={{ fontSize: '11px', color: '#6E726E', fontWeight: 500, letterSpacing: '0.05em' }}>
                {t('PATROCINADO', 'SPONSORED')}
              </span>
            </div>
            <div className="eventos-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {featured.map(e => <EventCardFeatured key={e.id} evento={e} />)}
            </div>
          </div>
        </section>
      )}

      {/* ── Todos los eventos + filtros ── */}
      <div style={{ maxWidth: 1252, margin: '0 auto', padding: '32px 26px' }}>
        {/* Título sección */}
        <h2 style={{ fontFamily: K.serif, fontWeight: 700, fontSize: '1.1rem', color: K.ink, margin: '0 0 20px' }}>
          {t('Todos los eventos', 'All events')}
        </h2>

        {/* Filtros */}
        <div style={{
          background: '#fff', border: `1px solid ${K.line}`, borderRadius: 14,
          padding: '18px 20px', marginBottom: 32,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {/* Categoría — fila scrolleable, sin wrap feo */}
          <div>
            <GroupLabel>{t('Categoría', 'Category')}</GroupLabel>
            <div className="filtros-tabs" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              <Pill active={categoria === 'all'} onClick={() => { setCategoria('all'); reset() }} label={t('Todas', 'All')} />
              {CATEGORIAS_EVENTOS.map(c => (
                <Pill key={c.key} active={categoria === c.key} onClick={() => { setCategoria(c.key); reset() }} label={`${c.emoji} ${lang === 'es' ? c.label : c.labelEn}`} />
              ))}
            </div>
          </div>

          {/* Cuándo — fila propia, ancho completo */}
          <div>
            <GroupLabel>{t('Cuándo', 'When')}</GroupLabel>
            <div className="filtros-tabs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {FILTROS_FECHA.map(f => (
                <Pill key={f.id} active={fecha === f.id} onClick={() => { setFecha(f.id); reset() }} label={lang === 'es' ? f.es : f.en} />
              ))}
            </div>
          </div>

          {/* Para quién — fila propia, ancho completo */}
          <div>
            <GroupLabel>{t('Para quién', 'For who')}</GroupLabel>
            <div className="filtros-tabs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {FILTROS_AUDIENCIA.map(a => (
                <Pill key={a.id} active={audiencia === a.id} onClick={() => { setAudiencia(a.id); reset() }} label={lang === 'es' ? a.es : a.en} />
              ))}
            </div>
          </div>

          {/* Solo gratis + limpiar — separados del resto por su naturaleza (toggle vs. selección) */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
            paddingTop: 14, borderTop: `1px solid ${K.line}`,
          }}>
            <Pill active={gratuito} onClick={() => { setGratuito(g => !g); reset() }} label={`🎟️ ${t('Solo gratis', 'Free only')}`} />
            {anyFilterActive && (
              <button onClick={clearAllFilters} style={{
                border: 'none', background: 'none', color: K.coral,
                fontWeight: 700, fontSize: '.8rem', cursor: 'pointer', fontFamily: 'inherit',
                padding: '4px 2px',
              }}>
                {t('Limpiar filtros ✕', 'Clear filters ✕')}
              </button>
            )}
          </div>
        </div>

        {isLoading && <p style={{ color: K.muted }}>{t('Cargando eventos…', 'Loading events…')}</p>}

        {!isLoading && !hasData && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <p style={{ fontFamily: K.serif, fontSize: '1.3rem', color: K.muted }}>
              {t(`Próximamente en ${barrio.nombre}.`, `Coming soon to ${barrio.nombre}.`)}
            </p>
          </div>
        )}

        {!isLoading && hasData && (
          regular.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <p style={{ color: K.muted, fontSize: '1.05rem', marginBottom: 12 }}>
                {t('Aún no hay eventos aquí.', 'No events here yet.')}
              </p>
              <a href="/publicar" style={{ color: K.coral, fontWeight: 700, textDecoration: 'none' }}>
                {t('¿Tienes uno? Publícalo →', 'Have one? Publish it →')}
              </a>
            </div>
          ) : (
            <div className="eventos-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              {regular.map(e => <EventCardMini key={e.id} evento={e} />)}
            </div>
          )
        )}

        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 40 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ border: `2px solid ${K.line}`, background: 'transparent', color: K.muted, padding: '8px 18px', borderRadius: 999, cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'inherit', opacity: page === 0 ? .4 : 1 }}>
              ← {t('Anterior', 'Previous')}
            </button>
            <span style={{ padding: '8px 14px', color: K.muted, fontSize: '.9rem' }}>{page + 1} / {pages}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} style={{ border: `2px solid ${K.line}`, background: 'transparent', color: K.muted, padding: '8px 18px', borderRadius: 999, cursor: page >= pages - 1 ? 'default' : 'pointer', fontFamily: 'inherit', opacity: page >= pages - 1 ? .4 : 1 }}>
              {t('Siguiente', 'Next')} →
            </button>
          </div>
        )}
      </div>
    </>
  )
}
