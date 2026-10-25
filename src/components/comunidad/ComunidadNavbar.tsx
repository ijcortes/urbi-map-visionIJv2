import { Name, useT } from "@/lib/i18n";
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useBarrio } from './BarrioContext'
import { useTicker } from '../../hooks/useTicker'
import { useLang, FlagCO, FlagUS } from '../../lib/i18n'
import { Wordmark } from '../Wordmark'
import { auth } from '../../lib/auth'
import { useIsAgente } from '../LockedField'
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

const CATEGORIA_EMOJI: Record<string, string> = {
  musica:       '🎵',
  cultura:      '🎨',
  gastronomia:  '🍽️',
  bienestar:    '🧘',
  deporte:      '🏃',
  social:       '✨',
}

function getNoticiaEmoji(titulo: string): string {
  const t = titulo.toLowerCase()
  if (t.includes('música') || t.includes('concierto') || t.includes('jazz') ||
      t.includes('tango') || t.includes('festival') || t.includes('rock') ||
      t.includes('cantante') || t.includes('canción') || t.includes('álbum'))
    return '🎵'
  if (t.includes('arte') || t.includes('exposición') || t.includes('museo') ||
      t.includes('pintura') || t.includes('escultura') || t.includes('galería') ||
      t.includes('fotografía') || t.includes('diseño'))
    return '🎨'
  if (t.includes('teatro') || t.includes('danza') || t.includes('ballet') ||
      t.includes('ópera') || t.includes('cine') || t.includes('película') ||
      t.includes('serie') || t.includes('premio'))
    return '🎭'
  if (t.includes('restaurante') || t.includes('chef') || t.includes('gastronom') ||
      t.includes('cocina') || t.includes('plato') || t.includes('comida') ||
      t.includes('cerveza') || t.includes('vino'))
    return '🍽️'
  if (t.includes('deport') || t.includes('atletis') || t.includes('ciclism') ||
      t.includes('fútbol') || t.includes('maratón') || t.includes('carrera') ||
      t.includes('campeón') || t.includes('medalla'))
    return '🏆'
  if (t.includes('libro') || t.includes('literatura') || t.includes('novela') ||
      t.includes('poesía') || t.includes('escritor') || t.includes('biblioteca') ||
      t.includes('lectura'))
    return '📚'
  if (t.includes('feria') || t.includes('flores') || t.includes('silletero') ||
      t.includes('desfile') || t.includes('tradición') || t.includes('folclor') ||
      t.includes('patrimonio') || t.includes('cultura'))
    return '🌸'
  if (t.includes('turismo') || t.includes('turista') || t.includes('viaje') ||
      t.includes('destino') || t.includes('visitar'))
    return '✈️'
  if (t.includes('parque') || t.includes('naturaleza') || t.includes('ambiental') ||
      t.includes('sostenible') || t.includes('ecológ'))
    return '🌿'
  if (t.includes('innovación') || t.includes('tecnología') || t.includes('startup') ||
      t.includes('emprendim') || t.includes('digital') || t.includes('videojuego'))
    return '💡'
  if (t.includes('barrio') || t.includes('comunidad') || t.includes('vecinos'))
    return '🏘️'
  if (t.includes('medellín') || t.includes('antioquia') || t.includes('ciudad'))
    return '🌆'
  return '📰'
}

const FALLBACK_ITEMS_ES = [
  { tipo: 'noticia' as const, titulo: '🌸 Medellín Social · Tu ciudad, tu barrio, tu historia', link: '/', fecha: null },
]
const FALLBACK_ITEMS_EN = [
  { tipo: 'noticia' as const, titulo: '🌸 Medellín Social · Your city, your barrio, your story', link: '/', fecha: null },
]

export function ComunidadNavbar({ compact = false, hideTicker = false }: { compact?: boolean; hideTicker?: boolean }) {
  const { barrio, barrios, lang, setLang: setBarrioLang, setBarrioSlug } = useBarrio()
  const { setLang: setGlobalLang } = useLang()
  const [today,       setToday]       = useState('')
  const [path,        setPath]        = useState('')
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [reOpen,      setReOpen]      = useState(false)
  const isAgente = useIsAgente()
  const logged = !!auth.get()

  function setLang(l: 'es' | 'en') {
    setBarrioLang(l)
    setGlobalLang(l)
  }

  const t = useT()

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const el = e.target as Element
      if (menuAbierto && !el.closest('nav')) setMenuAbierto(false)
      if (reOpen && !el.closest('[data-re-dropdown]')) setReOpen(false)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [menuAbierto, reOpen])

  const { data: apiItems = [] } = useTicker(1)

  useEffect(() => {
    setPath(window.location.pathname)
  }, [])

  useEffect(() => {
    const d = new Date()
    const locale = lang === 'es' ? 'es-CO' : 'en-US'
    setToday(d.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
  }, [lang])

  const tickerItems = apiItems.length > 0 ? apiItems : (lang === 'es' ? FALLBACK_ITEMS_ES : FALLBACK_ITEMS_EN)

  const hasEventos = tickerItems.some(i => i.tipo === 'evento')

  const formattedItems = useMemo(() => tickerItems.map(item => {
    if (item.tipo === 'evento') {
      const emoji = CATEGORIA_EMOJI[item.categoria ?? ''] ?? getNoticiaEmoji(item.titulo)
      const fechaStr = item.fecha
        ? new Date(item.fecha.replace(' ', 'T')).toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', { day: 'numeric', month: 'short' })
        : ''
      return { ...item, texto: `${emoji} ${item.titulo}${fechaStr ? ` · ${fechaStr}` : ''}` }
    }
    const emoji = getNoticiaEmoji(item.titulo)
    return { ...item, texto: `${emoji} ${item.titulo}` }
  }), [tickerItems, lang])

  const scrollItems = [...formattedItems, ...formattedItems]
  const duracion = Math.max(60, formattedItems.length * 8)

  function isActive(href: string) {
    if (href === '/') return path === '/'
    // Compara por primer segmento: '/blog' activo solo en /blog, '/eventos/x'
    // activo en cualquier /eventos/*. El regex viejo colapsaba hrefs de un solo
    // segmento a '/' (startsWith('/') = siempre true → siempre amarillo).
    return path.split('/')[1] === href.split('/')[1]
  }

  function handleBarrioChange(newSlug: string) {
    const parts    = window.location.pathname.split('/').filter(Boolean)
    const sections = ['eventos', 'local-business']
    if (sections.includes(parts[0])) {
      window.location.href = `/${parts[0]}/${newSlug}`
    } else if (parts.length === 0 || parts[0] === 'barrio') {
      // Home no cambia según el barrio (Ken, 23-oct): elegir uno lleva a su página.
      window.location.href = newSlug === 'todos' ? '/' : `/barrio/${newSlug}`
    } else {
      setBarrioSlug(newSlug)
    }
  }

  const medellin   = barrios.filter(b => b.grupo === 'Medellín')
  const valleAbura = barrios.filter(b => b.grupo === 'Valle de Aburrá')

  const links: { href: string; label: string; re?: boolean }[] = [
    { href: '/',                              label: t('HOME', 'HOME') },
    { href: `/eventos/${barrio.slug}`,         label: t('EVENTOS', 'EVENTS') },
    { href: `/local-business/${barrio.slug}`,  label: t('NEGOCIOS', 'BUSINESSES') },
    { href: '/real-estate',                    label: 'REAL ESTATE', re: true },
    { href: '/blog',                           label: 'BLOG' },
  ]

  // "REAL ESTATE ▾" hub — destinos que navegan FUERA del mapa (no filtros).
  // Herramientas solo para agentes (gating heredado del MapNavbar viejo).
  const reItems = [
    { href: '/map',         label: t('Mapa', 'Map') },
    { href: '/vender',      label: t('Vender o arrendar tu inmueble', 'Sell or rent your property') },
    { href: '/agentes',     label: t('Encuentra un agente', 'Find an agent') },
  ]
  const reTools = [
    { href: '/simulador',  label: t('Simulador', 'Simulator') },
    { href: '/comparador', label: t('Comparador', 'Comparison') },
    { href: '/calculadora', label: t('Calculadora', 'Calculator') },
  ]
  const reActive = ['/map', '/real-estate', '/vender', '/publicar', '/agentes', '/simulador', '/comparador', '/calculadora']
    .some(h => path === h || path.startsWith(h + '/'))
  const reItemStyle: CSSProperties = {
    display: 'block', padding: '9px 12px', borderRadius: 7,
    fontSize: 14, color: K.ink, textDecoration: 'none', fontWeight: 500,
  }

  return (
    <>
      <style>{`
        @keyframes kTick {
          0%   { transform: translateX(0) }
          100% { transform: translateX(-50%) }
        }
        .k-ticker-inner {
          display: inline-block;
          animation: kTick 36s linear infinite;
          white-space: nowrap;
          font-weight: 600;
        }
        .k-nav-link {
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          padding: 8px 14px;
          border-radius: 6px;
          text-decoration: none;
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
        }
        .k-nav-link { position: relative; }
        .k-nav-link::after {
          content: ''; position: absolute; left: 14px; right: 14px; bottom: 3px; height: 2px;
          background: ${K.amarillo}; border-radius: 2px;
          transform: scaleX(0); transform-origin: left; transition: transform .25s ease;
        }
        .k-nav-link:hover::after, .k-nav-link[aria-current="page"]::after { transform: scaleX(1); }
        .k-nav-link:hover { background: rgba(255,255,255,0.06); }
        .k-subscribe { transition: background .15s, transform .15s; }
        .k-subscribe:hover { background: ${K.tealMid}; transform: translateY(-1px); }
        .re-item:hover { background: ${K.tealLight}; }
        .k-ticker:hover .k-ticker-inner { animation-play-state: paused; }
        .k-tricolor { display: flex; height: 3px; }
        .k-tricolor > i { display: block; transform-origin: left; animation: kStripe .7s cubic-bezier(.2,.7,.2,1) both; }
        .k-tricolor > i:nth-child(1) { flex: 2; background: ${K.amarillo}; }
        .k-tricolor > i:nth-child(2) { flex: 1; background: ${K.azul}; animation-delay: .12s; }
        .k-tricolor > i:nth-child(3) { flex: 1; background: ${K.rojo}; animation-delay: .24s; }
        @keyframes kStripe { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        @keyframes kRise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .masthead-logo { animation: kRise .6s cubic-bezier(.2,.7,.2,1) both; }
        .masthead-tag { animation: kRise .6s .15s cubic-bezier(.2,.7,.2,1) both; letter-spacing: 4px; }
        @media (max-width: 480px) { .masthead-tag { letter-spacing: 1.5px; font-size: 11px !important; } }
        /* Ticker en móvil: encoge el badge "Lo Próximo" y el padding para que las
           noticias tengan espacio de lectura (el badge es flexShrink:0, no cede solo). */
        @media (max-width: 600px) {
          .k-ticker > div { padding-left: 14px !important; gap: 9px !important; }
          .k-ticker > div > span { font-size: .6rem !important; padding: 2px 7px !important; letter-spacing: .3px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .k-ticker-inner, .k-tricolor > i, .masthead-logo, .masthead-tag { animation: none !important; }
        }
        @media (max-width: 767px) {
          .mobile-menu-btn { display: flex !important; align-items: center; justify-content: center; }
          .desktop-nav-links { display: none !important; }
          .desktop-only { display: none !important; }
          .desktop-nav-right { display: none !important; }
        }
        @media (min-width: 769px) {
          .mobile-menu-btn { display: none !important; }
          .mobile-only { display: none !important; }
        }
      `}</style>

      {/* ── Masthead (hidden in compact mode) ───────── */}
      {!compact && (
        <header style={{ borderBottom: `1px solid ${K.line}`, background: K.paper, textAlign: 'center', padding: '24px 26px 16px' }}>
          <a href="/" style={{ textDecoration: 'none', color: K.ink }}>
            <div data-i18n-skip className="masthead-logo" style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2.6rem,7.5vw,4.5rem)', letterSpacing: -2, lineHeight: .92 }}>
              <Wordmark coral={K.coral} />
            </div>
          </a>
          <div className="masthead-tag" style={{ marginTop: 10, fontSize: 12, textTransform: 'uppercase', color: K.muted, fontWeight: 600 }}>
            {t('TU CIUDAD · TU BARRIO · TU HISTORIA', 'YOUR CITY · YOUR BARRIO · YOUR STORY')}
          </div>
        </header>
      )}

      {/* ── Single sticky navbar ──────────────────────── */}
      <nav style={{
        background: K.ink,
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}>
        <div style={{
          maxWidth: 1232, margin: '0 auto', padding: '0 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 52, gap: 8,
        }}>

          {/* LEFT: logo (compact always) or date+barrio (desktop only — masthead has logo on mobile) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            {compact ? (
              <a data-i18n-skip href="/" style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.25rem', color: '#fff', textDecoration: 'none', letterSpacing: -0.5, lineHeight: 1 }}>
                <Wordmark coral={K.coral} />
              </a>
            ) : (
              <>
                <span className="desktop-only" style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontVariantCaps: 'all-small-caps', letterSpacing: '.5px' }}>
                  {today}
                </span>
                <select
                  data-tour="barrio-select"
                  value={barrio.slug}
                  onChange={e => handleBarrioChange(e.target.value)}
                  style={{
                    background: 'transparent', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.25)',
                    borderRadius: 6, padding: '4px 8px',
                    fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                    flex: 1, minWidth: 0, maxWidth: 220,
                    WebkitAppearance: 'none', appearance: 'none',
                  }}
                >
                  <optgroup label="── Medellín ──" style={{ color: K.ink, background: '#fff' }}>
                    {medellin.map(b => (
                      <option key={b.slug} value={b.slug} data-i18n-skip style={{ color: K.ink, background: '#fff' }}>
                        {b.nombre}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="── Valle de Aburrá ──" style={{ color: K.ink, background: '#fff' }}>
                    {valleAbura.map(b => (
                      <option key={b.slug} value={b.slug} data-i18n-skip style={{ color: K.ink, background: '#fff' }}>
                        {b.nombre}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </>
            )}
          </div>

          {/* CENTER: nav links — desktop only */}
          <div className="desktop-nav-links" data-tour="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {links.map((lnk) => lnk.re ? (
              <div key="re" data-re-dropdown style={{ position: 'relative' }}>
                <button
                  className="k-nav-link"
                  aria-expanded={reOpen}
                  aria-haspopup="menu"
                  onClick={() => setReOpen(o => !o)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, border: 'none', cursor: 'pointer',
                    background: reOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
                    color: (reOpen || reActive) ? K.amarillo : 'rgba(255,255,255,0.85)',
                    font: 'inherit', fontWeight: 700, fontSize: 13, letterSpacing: '0.6px', textTransform: 'uppercase',
                  }}
                >
                  {lnk.label}
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" style={{ transform: reOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                    <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {reOpen && (
                  <div role="menu" style={{
                    position: 'absolute', top: 'calc(100% + 10px)', left: 0,
                    background: K.paper, border: `1px solid ${K.line}`, borderRadius: 10,
                    boxShadow: '0 14px 34px rgba(20,32,29,.20)', minWidth: 236, overflow: 'hidden', zIndex: 60, padding: 6,
                  }}>
                    {reItems.map(it => (
                      <a key={it.href} href={it.href} className="re-item" style={reItemStyle}>{it.label}</a>
                    ))}
                    {isAgente && (
                      <>
                        <div style={{ height: 1, background: K.line, margin: '6px 8px' }} />
                        <div style={{ padding: '3px 12px 4px', fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', color: K.muted, fontWeight: 700 }}>
                          {t('Herramientas', 'Tools')}
                        </div>
                        {reTools.map(it => (
                          <a key={it.href} href={it.href} className="re-item" style={reItemStyle}>{it.label}</a>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <a
                key={lnk.label}
                href={lnk.href}
                className="k-nav-link"
                aria-current={isActive(lnk.href) ? 'page' : undefined}
                style={{ color: isActive(lnk.href) ? K.amarillo : 'rgba(255,255,255,0.85)' }}
              >
                {lnk.label}
              </a>
            ))}
          </div>

          {/* RIGHT: login/account + subscribe + ES/EN — desktop only */}
          <div className="desktop-nav-right" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <a
              href={logged ? '/perfil' : '/login'}
              style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600, textDecoration: 'none', letterSpacing: '.3px' }}
            >
              {logged ? t('Mi cuenta', 'My account') : t('Iniciar sesión', 'Log in')}
            </a>
            {!logged && (
              <a
                href="/suscribirse"
                className="k-subscribe"
                style={{
                  background: K.teal, color: '#fff', fontSize: 13, fontWeight: 700,
                  textDecoration: 'none', letterSpacing: '.3px',
                  padding: '6px 14px', borderRadius: 999, whiteSpace: 'nowrap',
                  transition: 'background 0.15s',
                }}
              >
                {t('Suscríbete', 'Subscribe')}
              </a>
            )}
            <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden' }}>
              {(['es', 'en'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-label={l === 'es' ? 'Español' : 'English'}
                  aria-pressed={lang === l}
                  data-testid={`lang-${l}`}
                  style={{
                    border: 'none',
                    background: lang === l ? K.amarillo : 'transparent',
                    color: lang === l ? K.ink : '#fff',
                    padding: '4px 10px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  {l === 'es' ? <FlagCO /> : <FlagUS />}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile: ES/EN siempre visible (fuera del menú) + hamburger */}
          <div className="mobile-only" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden' }}>
              {(['es', 'en'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-label={l === 'es' ? 'Español' : 'English'}
                  aria-pressed={lang === l}
                  style={{
                    border: 'none',
                    background: lang === l ? K.amarillo : 'transparent',
                    color: lang === l ? K.ink : '#fff',
                    padding: '4px 10px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  {l === 'es' ? <FlagCO /> : <FlagUS />}
                </button>
              ))}
            </div>
            <button
              onClick={() => setMenuAbierto(prev => !prev)}
              className="mobile-menu-btn"
              data-tour="nav-hamburger"
              aria-label="Menú"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 22,
                cursor: 'pointer',
                padding: 4,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {menuAbierto ? '✕' : '☰'}
            </button>
          </div>

        </div>

        {/* Mobile dropdown */}
        {menuAbierto && (
          <div style={{
            background: '#111418',
            padding: '12px 16px 16px',
            borderTop: '0.5px solid rgba(255,255,255,0.1)',
          }}>
            {!compact && (
              <select
                value={barrio.slug}
                onChange={e => { handleBarrioChange(e.target.value); setMenuAbierto(false) }}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: '0.5px solid rgba(255,255,255,0.2)',
                  borderRadius: 6,
                  padding: 8,
                  marginBottom: 12,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  WebkitAppearance: 'none', appearance: 'none',
                }}
              >
                <optgroup label="── Medellín ──" style={{ color: K.ink, background: '#fff' }}>
                  {medellin.map(b => (
                    <option key={b.slug} value={b.slug} data-i18n-skip style={{ color: K.ink, background: '#fff' }}>
                      {b.nombre}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="── Valle de Aburrá ──" style={{ color: K.ink, background: '#fff' }}>
                  {valleAbura.map(b => (
                    <option key={b.slug} value={b.slug} data-i18n-skip style={{ color: K.ink, background: '#fff' }}>
                      {b.nombre}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}

            {links.map(link => link.re ? (
              <div key="re-m">
                <div style={{ color: 'rgba(255,255,255,0.85)', padding: '10px 0 4px', fontSize: 15, fontWeight: 700, borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
                  {link.label}
                </div>
                {[...reItems, ...(isAgente ? reTools : [])].map(it => (
                  <a
                    key={it.href}
                    href={it.href}
                    onClick={() => setMenuAbierto(false)}
                    style={it.href === '/map'
                      ? { display: 'block', background: K.teal, color: '#fff', padding: '10px 14px', margin: '4px 0', fontSize: 14, fontWeight: 800, textDecoration: 'none', borderRadius: 8 }
                      : { display: 'block', color: 'rgba(255,255,255,0.72)', padding: '9px 0 9px 14px', fontSize: 14, fontWeight: 500, textDecoration: 'none', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}
                  >
                    {it.label}
                  </a>
                ))}
              </div>
            ) : (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuAbierto(false)}
                style={{
                  display: 'block',
                  color: isActive(link.href) ? K.amarillo : 'rgba(255,255,255,0.85)',
                  padding: '10px 0',
                  fontSize: 15,
                  fontWeight: isActive(link.href) ? 700 : 500,
                  textDecoration: 'none',
                  borderBottom: '0.5px solid rgba(255,255,255,0.08)',
                }}
              >
                {link.label}
              </a>
            ))}

            <a
              href={logged ? '/perfil' : '/login'}
              onClick={() => setMenuAbierto(false)}
              style={{
                display: 'block', color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: 500,
                textDecoration: 'none', padding: '10px 0', borderBottom: '0.5px solid rgba(255,255,255,0.08)',
              }}
            >
              {logged ? t('Mi cuenta', 'My account') : t('Iniciar sesión', 'Log in')}
            </a>

            {!logged && (
              <a
                href="/suscribirse"
                onClick={() => setMenuAbierto(false)}
                style={{ display: 'block', marginTop: 12, color: K.amarillo, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
              >
                {t('Suscríbete →', 'Subscribe →')}
              </a>
            )}
          </div>
        )}

        {/* Franja tricolor (amarillo · azul · rojo) — firma visual en todas las páginas */}
        <div className="k-tricolor" aria-hidden="true"><i /><i /><i /></div>
      </nav>

      {/* ── Ticker ───────────────────────────────────── */}
      {!hideTicker && (
      <div className="k-ticker" style={{ background: K.azul, color: '#fff', overflow: 'hidden', fontSize: '.82rem' }}>
        <div style={{ maxWidth: 1226, margin: '0 auto', padding: '0 0 0 26px', display: 'flex', alignItems: 'center', gap: 14, height: 38 }}>
          <span style={{
            background: K.amarillo, color: K.ink, fontWeight: 900,
            padding: '3px 11px', borderRadius: 5,
            textTransform: 'uppercase', fontSize: '.7rem',
            flexShrink: 0, letterSpacing: '.8px',
          }}>
            {hasEventos
              ? (lang === 'es' ? 'Lo Próximo' : 'Coming Up')
              : (lang === 'es' ? 'Lo Último'  : 'Buzz')}
          </span>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div
              className="k-ticker-inner"
              style={{ animationDuration: `${duracion}s` }}
            >
              {scrollItems.map((item, i) => (
                <a
                  key={i}
                  href={item.link ?? '#'}
                  target={item.link?.startsWith('http') ? '_blank' : '_self'}
                  rel="noopener noreferrer"
                  style={{
                    marginRight: 46,
                    fontWeight: 600,
                    color: '#fff',
                    textDecoration: 'none',
                    cursor: item.link ? 'pointer' : 'default',
                  }}
                >
                  {item.texto}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </>
  )
}
