import { AutoTranslate, Name, useT, useLang } from "@/lib/i18n";
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { MapView } from '@/components/MapView'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { BARRIOS, comunaRep, type Barrio } from '@/components/comunidad/BarrioContext'
import { EventCardFeatured, EventCardMini } from '@/components/comunidad/EventCard'
import { Carousel as UiCarousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { useIsMobile } from '@/hooks/use-mobile'
import { useDeals } from '@/hooks/useDeals'
import { useDirectorio } from '@/hooks/useDirectorio'
import { useNoticias } from '@/hooks/useNoticias'
import { useEventosZona } from '@/hooks/useEventosZona'
import { useListings } from '@/hooks/useBarrios'
import { usePriceFormat } from '@/hooks/usePriceFormat'
import { API_BASE_URL } from '@/config/api'
import { formatDate } from '@/lib/format'
import { seo } from '@/lib/seo'
import { safeHref } from '@/lib/utils'
import { K } from "@/design/tokens";
import { categoriaNegocioLabel } from "@/lib/categorias_comunidad";

// Página de barrio (Ken, call 23-oct). Una sola página que se llena según la
// comuna elegida. Orden: embajador + historia clave + historias → eventos →
// 2 realtors destacados + listings → negocios 5★ con oferta → lo último.

export const Route = createFileRoute('/barrio/$slug')({
  component: BarrioRoot,
  head: ({ params }) => {
    const b = BARRIOS.find((x) => x.slug === params.slug)
    const nombre = b?.nombre ?? params.slug.replace(/-/g, ' ')
    return seo({
      title: `${nombre} · Medellín Social`,
      description: `Eventos, propiedades, negocios y la gente de ${nombre}.`,
      path: `/barrio/${params.slug}`,
    })
  },
})

function BarrioRoot() {
  const { slug } = Route.useParams()
  return (
    <ComunidadLayout initialSlug={slug}>
      <BarrioPage slug={slug} />
    </ComunidadLayout>
  )
}

// ── Datos propios de la página (embajador, historias destacadas, realtors) ──

interface Embajador { nombre: string; foto_url: string | null; bio: string | null; video_url: string | null; post_id: number | null }
interface Historia { id: number; titulo: string; cuerpo: string; imagen_url: string | null; enlace_url: string | null; autor_nombre: string; created_at: string | null; destacado: boolean }
interface RealtorCard { id: string; nombre: string; foto_url: string | null; bio: string | null; agencia_nombre: string | null; rating_promedio: number | null; n_resenas: number }
interface BarrioPageData { embajador: Embajador | null; historias: Historia[]; realtors: RealtorCard[] }

/** cd_comuna (Medellín) o municipio (resto del Valle): la zona que usan la API y /map. */
function zonaQS(b: Barrio): string {
  return b.cd_comuna != null ? `cd_comuna=${b.cd_comuna}` : `municipio=${encodeURIComponent(b.municipio_nombre ?? '')}`
}

function useBarrioPage(b: Barrio | undefined) {
  return useQuery<BarrioPageData>({
    queryKey: ['barrio-page', b?.slug],
    enabled: !!b,
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/comunidad/barrio-page?${zonaQS(b!)}`)
      if (!res.ok) return { embajador: null, historias: [], realtors: [] }
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })
}

// ── Piezas de layout ────────────────────────────────────────────────────────

/** Carrusel horizontal (Embla, components/ui/carousel); flechas solo en desktop. */
function Carousel({ children, label }: { children: ReactNode; label: string }) {
  const isMobile = useIsMobile()
  return (
    <UiCarousel opts={{ align: 'start', dragFree: true }} aria-label={label}>
      <CarouselContent className="-ml-4">{children}</CarouselContent>
      {!isMobile && (<><CarouselPrevious className="-left-4" /><CarouselNext className="-right-4" /></>)}
    </UiCarousel>
  )
}

function Slide({ children, width = 260 }: { children: ReactNode; width?: number }) {
  return <CarouselItem className="pl-4" style={{ flexBasis: width + 16 }}>{children}</CarouselItem>
}

/** Rótulo chico en mayúsculas sobre títulos y tarjetas. */
const cardBody = { padding: '10px 12px 12px' }

const kicker = (color: string, size = 11) => ({
  fontSize: size, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase' as const, color,
})

function Section({ id, kicker: kickerText, title, children, tone = 'paper', action }: {
  id: string; kicker: string; title: string; children: ReactNode; tone?: 'paper' | 'surface'; action?: ReactNode
}) {
  const isMobile = useIsMobile()
  return (
    <section id={id} style={{ background: tone === 'surface' ? K.surface : 'transparent', borderTop: `1px solid ${K.line}`, padding: isMobile ? '32px 16px' : '56px 26px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div style={{ ...kicker(K.rojo), marginBottom: 6 }}>{kickerText}</div>
            <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', letterSpacing: '-.5px', color: K.ink, margin: 0, lineHeight: 1.05 }}>{title}</h2>
          </div>
          {action}
        </div>
        {children}
      </div>
    </section>
  )
}

const pill = (bg: string, fg: string) => ({
  display: 'inline-block', background: bg, color: fg, fontWeight: 800, fontSize: '.85rem',
  padding: '11px 20px', borderRadius: 999, textDecoration: 'none', whiteSpace: 'nowrap' as const, border: 'none', cursor: 'pointer',
})

function Empty({ children }: { children: ReactNode }) {
  return <p style={{ color: K.muted, fontSize: '.92rem', margin: 0, padding: '18px 0' }}>{children}</p>
}

function ImgBox({ src, alt, height, fallback, round = false, bg = `linear-gradient(135deg, ${K.azul}, ${K.tealDeep})` }: {
  src: string | null | undefined; alt: string; height: number; fallback: string; round?: boolean; bg?: string
}) {
  const [broken, setBroken] = useState(false)
  return (
    <div style={{
      height, flexShrink: 0, overflow: 'hidden', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...(round ? { width: height, borderRadius: '50%', fontSize: height * 0.4 } : { borderRadius: 12, fontSize: 34 }),
    }}>
      {src && !broken
        ? <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span aria-hidden>{fallback}</span>}
    </div>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

function BarrioPage({ slug }: { slug: string }) {
  const t = useT()
  const { lang } = useLang()
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { formatPrice } = usePriceFormat()
  const b = BARRIOS.find((x) => x.slug === slug && x.slug !== 'todos')

  const cd = b?.cd_comuna ?? null
  const muni = b?.cd_comuna == null ? b?.municipio_nombre : undefined

  // Buscador de eventos: la fecha filtra en el servidor, el texto en vivo.
  const [q, setQ] = useState('')
  const [desde, setDesde] = useState('')

  const { data: page } = useBarrioPage(b)
  const { data: eventos = [] } = useEventosZona(b?.barrio_id ?? null, muni, { desde })
  const { data: deals = [] } = useDeals(1, null, muni, cd)
  const { data: negocios = [] } = useDirectorio(1, null, muni, cd)
  const { data: noticias = [] } = useNoticias(8, null, muni, cd)
  const { data: listingsResp } = useListings(null, 12, 0, undefined, false, undefined, cd ?? undefined, muni)
  const listings = listingsResp?.listings ?? []

  const eventosOrden = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return ql ? eventos.filter((e) => e.titulo.toLowerCase().includes(ql) || (e.organizador ?? '').toLowerCase().includes(ql)) : eventos
  }, [eventos, q])
  const eventoDestacado = eventosOrden.find((e) => e.destacado) ?? eventosOrden[0]
  const otrosEventos = eventosOrden.filter((e) => e !== eventoDestacado)

  const historias = page?.historias ?? []
  const emb = page?.embajador ?? null
  const historiaClave = (emb?.post_id && historias.find((h) => h.id === emb.post_id)) || historias.find((h) => h.destacado) || historias[0]
  const otrasHistorias = historias.filter((h) => h !== historiaClave)
  const realtors = page?.realtors ?? []

  // Categorías de negocios presentes, para el filtro "por categoría".
  const [cat, setCat] = useState<string | null>(null)
  const categorias = useMemo(() => [...new Set(negocios.map((n) => n.categoria))], [negocios])
  const negociosFiltrados = cat ? negocios.filter((n) => n.categoria === cat) : negocios

  if (!b) {
    return (
      <div style={{ maxWidth: 800, margin: '80px auto', padding: '0 16px', textAlign: 'center' }}>
        <h1 style={{ fontFamily: K.serif }}>{t('Barrio no encontrado', 'Neighborhood not found')}</h1>
        <a href="/" style={{ color: K.rojo, fontWeight: 700 }}>{t('Volver al inicio', 'Back home')}</a>
      </div>
    )
  }

  // Click en otra comuna del mapa → su propia página (sin drill dentro del mapa).
  const goToComuna = (cdClick: number | null, nombre: string) => {
    const next = comunaRep(cdClick, cdClick == null ? nombre : null)
    if (next && next.slug !== slug) navigate({ to: '/barrio/$slug', params: { slug: next.slug } })
  }

  const listingsHref = `/map?${zonaQS(b)}&nombre=${encodeURIComponent(b.nombre)}&zoom=12`

  return (
    <>
      {/* ── 1. Embajador + historia clave (hero) ── */}
      <section style={{ padding: isMobile ? '20px 16px 32px' : '36px 26px 56px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ ...kicker(K.muted), marginBottom: 8 }}>
            {t('Tu barrio', 'Your neighborhood')}
          </div>
          <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2.4rem, 8vw, 4.6rem)', letterSpacing: '-2px', lineHeight: .95, margin: '0 0 24px', color: K.ink }}>
            <Name>{b.nombre}</Name>
          </h1>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.5fr 1fr', gap: isMobile ? 20 : 28, alignItems: 'stretch' }}>
            {/* Historia clave */}
            <article style={{ background: K.paper, borderRadius: 18, overflow: 'hidden', boxShadow: '0 10px 36px rgba(17,20,24,.10)', display: 'flex', flexDirection: 'column' }}>
              <ImgBox src={historiaClave?.imagen_url} alt={historiaClave?.titulo ?? b.nombre} height={isMobile ? 210 : 320} fallback="📰" />
              <div style={{ padding: isMobile ? '18px 18px 22px' : '24px 28px 28px' }}>
                <div style={{ ...kicker(K.rojo), marginBottom: 8 }}>
                  {t('Historia destacada', 'Featured story')}
                </div>
                {historiaClave ? (
                  <>
                    <h2 style={{ fontFamily: K.serif, fontWeight: 800, fontSize: isMobile ? '1.4rem' : '1.9rem', lineHeight: 1.12, margin: '0 0 10px', color: K.ink }}>
                      <AutoTranslate text={historiaClave.titulo} />
                    </h2>
                    <p style={{ color: K.muted, lineHeight: 1.6, margin: '0 0 14px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      <AutoTranslate text={historiaClave.cuerpo} />
                    </p>
                    {safeHref(historiaClave.enlace_url) && (
                      <a href={safeHref(historiaClave.enlace_url)!} target="_blank" rel="noopener noreferrer" style={{ color: K.azul, fontWeight: 800, textDecoration: 'none' }}>
                        {t('Leer la historia →', 'Read the story →')}
                      </a>
                    )}
                  </>
                ) : (
                  <p style={{ fontFamily: K.serif, fontSize: '1.3rem', color: K.ink, margin: 0 }}>
                    {t(`Las historias de ${b.nombre} llegan pronto.`, `Stories from ${b.nombre} are coming soon.`)}{' '}
                    <a href="/publicar" style={{ color: K.rojo, fontWeight: 700 }}>{t('Cuenta la tuya →', 'Tell yours →')}</a>
                  </p>
                )}
              </div>
            </article>

            {/* Embajador + mapa estático */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <aside style={{ background: K.ink, color: '#fff', borderRadius: 18, padding: '20px 20px 22px', display: 'flex', gap: 16, alignItems: 'center' }}>
                <ImgBox round src={emb?.foto_url} alt={emb?.nombre ?? ''} height={84} fallback="🙋" bg={K.amarillo} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...kicker(K.amarillo, 10.5), marginBottom: 4 }}>
                    {t('Embajador del barrio', 'Neighborhood ambassador')}
                  </div>
                  {emb ? (
                    <>
                      <div style={{ fontFamily: K.serif, fontWeight: 800, fontSize: '1.25rem', marginBottom: 6 }}><Name>{emb.nombre}</Name></div>
                      {safeHref(emb.video_url) && (
                        <a href={safeHref(emb.video_url)!} target="_blank" rel="noopener noreferrer" style={{ color: '#fff', fontWeight: 700, fontSize: '.86rem' }}>
                          ▶ {t(`Mira mi último video desde ${b.nombre}`, `Check out my latest video from inside ${b.nombre}`)}
                        </a>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily: K.serif, fontWeight: 800, fontSize: '1.1rem', marginBottom: 6 }}>{t('¿Conoces este barrio como nadie?', 'Know this neighborhood like no one else?')}</div>
                      <a href="/embajador" style={{ color: K.amarillo, fontWeight: 800, fontSize: '.86rem' }}>{t('Sé el embajador →', 'Become the ambassador →')}</a>
                    </>
                  )}
                </div>
              </aside>

              <div style={{ position: 'relative', flex: 1, minHeight: isMobile ? 240 : 260, borderRadius: 18, overflow: 'hidden', boxShadow: '0 6px 24px rgba(17,20,24,.10)' }}>
                <MapView
                  mapView="zonas"
                  selectedId={null}
                  onSelect={() => {}}
                  focusComuna={{ cd, municipio: muni }}
                  onComunaClick={(c, nombre) => goToComuna(c, nombre)}
                  cooperativeGestures
                  pitch={0}
                  bearing={0}
                />
              </div>
            </div>
          </div>

          {/* Otras historias del embajador / barrio */}
          {otrasHistorias.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <Carousel label={t('Más historias', 'More stories')}>
                {otrasHistorias.map((h) => (
                  <Slide key={h.id} width={240}>
                    <a href={safeHref(h.enlace_url) ?? '#'} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: K.ink, display: 'block' }}>
                      <ImgBox src={h.imagen_url} alt={h.titulo} height={140} fallback="📰" />
                      <h3 style={{ fontFamily: K.serif, fontWeight: 700, fontSize: '1rem', lineHeight: 1.25, margin: '10px 0 0' }}>
                        <AutoTranslate text={h.titulo} />
                      </h3>
                    </a>
                  </Slide>
                ))}
              </Carousel>
            </div>
          )}
        </div>
      </section>

      {/* ── 2. Eventos ── */}
      <Section id="eventos" tone="surface" kicker={t('Qué pasa aquí', "What's on")} title={t(`Eventos en ${b.nombre}`, `Events in ${b.nombre}`)}
        action={<a href="/publicar" style={pill(K.rojo, '#fff')}>{t('+ Publica tu evento', '+ List your event')}</a>}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Buscar eventos…', 'Search events…')}
            aria-label={t('Buscar eventos', 'Search events')}
            style={{ flex: '1 1 220px', padding: '11px 14px', borderRadius: 10, border: `1px solid ${K.line}`, background: '#fff', fontSize: '.95rem' }} />
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label={t('Desde la fecha', 'From date')}
            style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${K.line}`, background: '#fff', fontSize: '.95rem' }} />
          <a href={`/eventos/${b.slug}`} style={{ ...pill('#fff', K.ink), border: `1px solid ${K.line}` }}>{t('Calendario completo', 'Full calendar')}</a>
        </div>
        {eventoDestacado ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) minmax(0,1.6fr)', gap: 20, alignItems: 'start' }}>
            <EventCardFeatured evento={eventoDestacado} />
            {otrosEventos.length > 0 ? (
              <Carousel label={t('Más eventos', 'More events')}>
                {otrosEventos.map((e) => <Slide key={e.id} width={220}><EventCardMini evento={e} /></Slide>)}
              </Carousel>
            ) : <Empty>{t('No hay más eventos con esos filtros.', 'No more events match those filters.')}</Empty>}
          </div>
        ) : <Empty>{t('Sin eventos próximos en este barrio todavía.', 'No upcoming events in this neighborhood yet.')}</Empty>}
      </Section>

      {/* ── 3. Real estate: 2 realtors destacados + listings ── */}
      <Section id="real-estate" kicker={t('Vivir aquí', 'Live here')} title={t('Propiedades destacadas', 'Featured listings')}
        action={<a href={listingsHref} style={pill(K.ink, '#fff')}>{t('Ver todas en el mapa →', 'See all on the map →')}</a>}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {[0, 1].map((i) => {
            const r = realtors[i]
            return r ? (
              <a key={r.id} href={`/agentes?agente=${r.id}`} style={{ display: 'flex', gap: 16, alignItems: 'center', background: K.paper, border: `1px solid ${K.line}`, borderRadius: 16, padding: 16, textDecoration: 'none', color: K.ink }}>
                <ImgBox round src={r.foto_url} alt={r.nombre} height={76} fallback="🏠" bg={K.azulLight} />
                <div style={{ minWidth: 0 }}>
                  <div style={kicker(K.azul, 10.5)}>{t('Realtor destacado', 'Featured realtor')}</div>
                  <div style={{ fontFamily: K.serif, fontWeight: 800, fontSize: '1.15rem' }}><Name>{r.nombre}</Name></div>
                  <div style={{ fontSize: '.85rem', color: K.muted }}>
                    {r.agencia_nombre ? <Name>{r.agencia_nombre}</Name> : null}
                    {r.rating_promedio != null ? ` · ★ ${r.rating_promedio.toFixed(1)} (${r.n_resenas})` : ''}
                  </div>
                  <div style={{ fontSize: '.85rem', fontWeight: 700, color: K.rojo, marginTop: 4 }}>{t(`Conecta con ${r.nombre.split(' ')[0]} →`, `Connect with ${r.nombre.split(' ')[0]} →`)}</div>
                </div>
              </a>
            ) : (
              <a key={`slot-${i}`} href="/planes/featured-realtor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 108, border: `2px dashed ${K.line}`, borderRadius: 16, padding: 16, color: K.muted, textDecoration: 'none', fontWeight: 700 }}>
                {t(`¿Eres realtor en ${b.nombre}? Este espacio es tuyo →`, `Realtor in ${b.nombre}? This spot is yours →`)}
              </a>
            )
          })}
        </div>
        {listings.length > 0 ? (
          <Carousel label={t('Listings', 'Listings')}>
            {listings.map((l) => (
              <Slide key={l.id} width={250}>
                <a href={`/listing/${l.id}`} style={{ display: 'block', textDecoration: 'none', color: K.ink, background: K.paper, borderRadius: 14, overflow: 'hidden', border: `1px solid ${K.line}` }}>
                  <ImgBox src={l.foto_principal} alt={l.barrio_nombre ?? b.nombre} height={150} fallback="🏢" />
                  <div style={cardBody}>
                    <div style={{ fontFamily: K.serif, fontWeight: 800, fontSize: '1.1rem' }}>{formatPrice(l.precio_cop)}</div>
                    <div style={{ fontSize: '.82rem', color: K.muted }}>
                      {l.habitaciones != null ? `${l.habitaciones} ${t('hab', 'bd')} · ` : ''}<Name>{l.barrio_display ?? l.barrio_nombre ?? b.nombre}</Name>
                    </div>
                  </div>
                </a>
              </Slide>
            ))}
          </Carousel>
        ) : <Empty>{t('Sin propiedades publicadas aquí todavía.', 'No listings here yet.')}</Empty>}
      </Section>

      {/* ── 4. Negocios 5★ con oferta para quienes viven aquí ── */}
      <Section id="negocios" tone="surface" kicker={t('Para los que viven aquí', 'For the people who live here')}
        title={t('Negocios 5 estrellas con descuento', '5-star businesses with special offers')}
        action={<a href={`/local-business/${b.slug}`} style={pill(K.teal, '#fff')}>{t('Ver ofertas especiales →', 'See special offers →')}</a>}>
        <a href="/suscribirse" style={{ display: 'block', background: K.amarillo, color: K.ink, borderRadius: 14, padding: '14px 18px', fontWeight: 800, textDecoration: 'none', marginBottom: 18 }}>
          {t('¿Eres suscriptor de Medellín Social? Haz clic aquí para ver las ofertas de negocios 5 estrellas →',
             "If you're a subscriber to Medellín Social, click here to find special offers from five-star rated businesses →")}
        </a>
        {categorias.length > 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {[null, ...categorias].map((c) => (
              <button key={c ?? 'all'} type="button" onClick={() => setCat(c)} style={{
                padding: '7px 14px', borderRadius: 999, border: `1px solid ${cat === c ? K.ink : K.line}`,
                background: cat === c ? K.ink : '#fff', color: cat === c ? '#fff' : K.ink, fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
              }} data-i18n-skip>{c ? categoriaNegocioLabel(c, lang) : t('Todos', 'All')}</button>
            ))}
          </div>
        )}
        {negociosFiltrados.length > 0 || deals.length > 0 ? (
          <Carousel label={t('Negocios', 'Businesses')}>
            {deals.map((d) => (
              <Slide key={`d-${d.id}`} width={230}>
                <div style={{ background: K.paper, borderRadius: 14, border: `2px solid ${K.rojo}`, overflow: 'hidden' }}>
                  <ImgBox src={d.foto_url} alt={d.tienda_nombre} height={120} fallback="🏷️" />
                  <div style={cardBody}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: K.rojo, padding: '3px 8px', borderRadius: 999 }}>{d.tipo_deal}</span>
                    <div style={{ fontWeight: 800, margin: '6px 0 2px' }}><Name>{d.tienda_nombre}</Name></div>
                    <div style={{ fontSize: '.84rem', color: K.muted }}>{d.descripcion}</div>
                  </div>
                </div>
              </Slide>
            ))}
            {negociosFiltrados.map((n) => (
              <Slide key={`n-${n.id}`} width={230}>
                <div style={{ background: K.paper, borderRadius: 14, border: `1px solid ${K.line}`, overflow: 'hidden' }}>
                  <ImgBox src={n.foto_url} alt={n.nombre} height={120} fallback="⭐" />
                  <div style={cardBody}>
                    <div style={{ fontWeight: 800 }}><Name>{n.nombre}</Name></div>
                    <div style={{ fontSize: '.84rem', color: K.muted }}>
                      {n.rating_google != null ? `★ ${n.rating_google.toFixed(1)} · ` : ''}{categoriaNegocioLabel(n.categoria, lang)}
                    </div>
                  </div>
                </div>
              </Slide>
            ))}
          </Carousel>
        ) : <Empty>{t('Aún no hay negocios destacados aquí.', 'No featured businesses here yet.')} <a href="/negocios/unirse" style={{ color: K.rojo, fontWeight: 700 }}>{t('¿Tienes un negocio? →', 'Have a business? →')}</a></Empty>}
      </Section>

      {/* ── 5. Lo último del barrio ── */}
      <Section id="lo-ultimo" kicker={t('Noticias', 'News')} title={t('Lo último del barrio', 'Latest from the neighborhood')}>
        {noticias.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {noticias.map((n) => (
              <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', background: K.paper, border: `1px solid ${K.line}`, borderRadius: 14, padding: '16px 16px 14px', textDecoration: 'none', color: K.ink }}>
                <div style={{ ...kicker(K.rojo, 10), marginBottom: 6 }}>
                  {n.fuente === 'el_colombiano' ? 'El Colombiano' : (n.fuente ?? 'Medellín')}
                  {n.fecha_publicacion ? ` · ${formatDate(n.fecha_publicacion, lang, { day: 'numeric', month: 'short' })}` : ''}
                </div>
                <h3 style={{ fontFamily: K.serif, fontWeight: 700, fontSize: '1.02rem', lineHeight: 1.3, margin: 0 }}>
                  <AutoTranslate text={n.titulo} />
                </h3>
              </a>
            ))}
          </div>
        ) : <Empty>{t('Sin noticias de este barrio por ahora.', 'No news from this neighborhood right now.')}</Empty>}
      </Section>

    </>
  )
}
