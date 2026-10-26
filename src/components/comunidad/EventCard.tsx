import { safeHref } from "@/lib/utils"
import { numberLocale } from "@/lib/format";
import { K as TOKENS } from "@/design/tokens";

export interface EventoData {
  id: number
  fuente: string
  titulo: string
  descripcion?: string | null
  foto_url?: string | null
  url_externo?: string | null
  fecha_inicio: string
  fecha_fin?: string | null
  gratuito: boolean
  precio: number
  moneda?: string | null
  organizador?: string | null
  categoria?: string | null
  tipo_audiencia?: string | null
  lat?: number | null
  lon?: number | null
  barrio_id?: number | null
  barrio_nombre?: string | null
  destacado: boolean
}

const K = TOKENS;

function parseFecha(str: string) {
  const normalized = str.replace(' ', 'T')
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return { day: '??', month: '???', full: str, hora: '' }
  return {
    day: d.toLocaleDateString(numberLocale(), { day: 'numeric' }),
    month: d.toLocaleDateString(numberLocale(), { month: 'short' }).replace('.', '').toUpperCase(),
    full: d.toLocaleDateString(numberLocale(), { weekday: 'long', day: 'numeric', month: 'long' }),
    hora: d.toLocaleTimeString(numberLocale(), { hour: '2-digit', minute: '2-digit' }),
  }
}

const CATEGORIA_META: Record<string, { label: string; emoji: string; color: string }> = {
  musica:      { label: 'Música',      emoji: '🎵', color: '#CE1126' },
  networking:  { label: 'Networking',  emoji: '🤝', color: '#0F8A4F' },
  gastronomia: { label: 'Gastronomía', emoji: '🍽️', color: '#b8960a' },
  cultura:     { label: 'Cultura',     emoji: '🎭', color: '#d6217e' },
  deporte:     { label: 'Deporte',     emoji: '🏃', color: '#639922' },
  bienestar:   { label: 'Bienestar',   emoji: '🧘', color: '#6E726E' },
  tech:        { label: 'Tech',        emoji: '💻', color: '#143cc4' },
  social:      { label: 'Social',      emoji: '🎉', color: '#CE1126' },
  happy_hour:  { label: 'Happy Hour',  emoji: '🍹', color: '#b8960a' },
}

function catMeta(cat?: string | null) {
  if (!cat) return null
  return CATEGORIA_META[cat] ?? { label: cat, emoji: '📅', color: K.coral }
}

function ImgPlaceholder({ categoria }: { categoria?: string | null }) {
  const meta = catMeta(categoria)
  return (
    <div style={{
      width: '100%', height: '100%',
      background: meta ? `linear-gradient(135deg, ${meta.color}dd, ${meta.color}88)` : `linear-gradient(135deg, ${K.teal}, ${K.tealDeep})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '2.2rem',
    }}>
      {meta?.emoji ?? '📅'}
    </div>
  )
}

function ImgWithFallback({ src, alt, categoria }: { src: string; alt: string; categoria?: string | null }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <img
        src={src} alt={alt}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={e => {
          const img = e.currentTarget
          img.style.display = 'none'
          const ph = img.nextElementSibling as HTMLElement | null
          if (ph) ph.style.removeProperty('display')
        }}
      />
      <div style={{ display: 'none', width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
        <ImgPlaceholder categoria={categoria} />
      </div>
    </div>
  )
}

function formatPrecio(precio: number, moneda?: string | null): string {
  const m = (moneda || 'COP').toUpperCase()
  if (m === 'USD') return `$${precio % 1 === 0 ? precio.toFixed(0) : precio.toFixed(2)} USD`
  return `$${(precio / 1000).toFixed(0)}k COP`
}

function PrecioLabel({ gratuito, precio, moneda }: { gratuito: boolean; precio: number; moneda?: string | null }) {
  const label = gratuito ? 'Gratis' : precio > 0 ? formatPrecio(precio, moneda) : null
  if (!label) return null
  return (
    <span style={{
      display: 'inline-block',
      background: gratuito ? K.teal + '22' : K.amarillo + '44',
      color: gratuito ? K.tealDeep : '#6b5200',
      fontWeight: 700, fontSize: '.66rem', padding: '2px 8px', borderRadius: 6,
    }}>
      {gratuito ? '🎟️ ' : '💵 '}{label}
    </span>
  )
}

export function EventCardFeatured({ evento }: { evento: EventoData }) {
  const f = parseFecha(evento.fecha_inicio)
  const cat = catMeta(evento.categoria)
  const priceLabel = evento.gratuito ? 'Gratis' : evento.precio > 0 ? formatPrecio(evento.precio, evento.moneda) : null

  return (
    <a
      href={safeHref(evento.url_externo) ?? '#'}
      target="_blank" rel="noopener noreferrer"
      style={{
        display: 'block', background: '#FAF8F3',
        border: '0.5px solid #E5E0D5', borderRadius: 12,
        overflow: 'hidden', textDecoration: 'none', position: 'relative',
      }}
    >
      {/* Badge */}
      <div style={{
        position: 'absolute', top: 10, left: 10, zIndex: 1,
        background: K.coral, color: K.coralLight,
        fontSize: 10, fontWeight: 700,
        padding: '3px 8px', borderRadius: 4,
        letterSpacing: '0.5px', textTransform: 'uppercase',
      }}>
        Destacado
      </div>

      {/* Foto — cuadrada, no se deforma según ancho de columna */}
      <div style={{ width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', flexShrink: 0 }}>
        {evento.foto_url
          ? <ImgWithFallback src={evento.foto_url} alt={evento.titulo} categoria={evento.categoria} />
          : <ImgPlaceholder categoria={evento.categoria} />
        }
      </div>

      {/* Info — centrada */}
      <div style={{ padding: '14px 16px', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', justifyContent: 'center' }}>
          {cat && (
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: K.coral }}>
              {cat.emoji} {cat.label}
            </span>
          )}
          {priceLabel && <span style={{ fontSize: 10, color: '#6E726E' }}>· {priceLabel}</span>}
        </div>
        <h3 style={{ fontFamily: K.serif, fontSize: 15, fontWeight: 600, color: '#111418', lineHeight: 1.3, margin: '0 0 6px' }}>
          {evento.titulo}
        </h3>
        <p style={{ fontSize: 12, color: '#6E726E', margin: 0 }}>
          {evento.organizador ? `${evento.organizador} · ` : ''}{f.day} {f.month}
        </p>
      </div>
    </a>
  )
}

export function EventCardMini({ evento }: { evento: EventoData }) {
  const f = parseFecha(evento.fecha_inicio)
  const cat = catMeta(evento.categoria)
  const priceLabel = evento.gratuito ? ' · Gratis' : evento.precio > 0 ? ` · ${formatPrecio(evento.precio, evento.moneda)}` : ''

  return (
    <a
      href={safeHref(evento.url_externo) ?? '#'}
      target="_blank" rel="noopener noreferrer"
      style={{
        display: 'flex', flexDirection: 'column',
        background: '#FFFFFF', border: '0.5px solid #E5E0D5',
        borderRadius: 12, overflow: 'hidden', textDecoration: 'none',
      }}
    >
      {/* Foto — cuadrada, no se deforma según ancho de columna */}
      <div style={{ width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
        {evento.foto_url
          ? <ImgWithFallback src={evento.foto_url} alt={evento.titulo} categoria={evento.categoria} />
          : <ImgPlaceholder categoria={evento.categoria} />
        }
        {/* Fecha — superpuesta sobre la foto, centrada */}
        <div style={{
          position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
          background: '#FFFFFF', borderRadius: 6,
          padding: '4px 10px', textAlign: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        }}>
          <div style={{ fontFamily: K.serif, fontSize: 14, fontWeight: 700, color: '#111418', lineHeight: 1 }}>
            {f.day}
          </div>
          <div style={{ fontSize: 7.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6E726E', marginTop: 1 }}>
            {f.month}
          </div>
        </div>
      </div>

      {/* Contenido — centrado */}
      <div style={{ padding: '8px 10px', textAlign: 'center' }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: K.coral, marginBottom: 3 }}>
          {cat ? `${cat.emoji} ${cat.label}` : '📅'}{priceLabel}
        </div>
        <h3 style={{
          fontSize: 12.5, fontWeight: 600, color: '#111418', lineHeight: 1.25, margin: '0 0 3px',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        }}>
          {evento.titulo}
        </h3>
        <p style={{ fontSize: 10, color: '#6E726E', margin: 0 }}>
          📍 {evento.barrio_nombre || evento.organizador || 'Medellín'}
        </p>
      </div>
    </a>
  )
}
