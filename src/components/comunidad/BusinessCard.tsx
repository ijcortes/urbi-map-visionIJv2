export type { TiendaData } from '@/hooks/useTiendas'
import { Name } from "@/lib/i18n";
import type { TiendaData } from '@/hooks/useTiendas'
import { CATEGORIA_LABELS, CATEGORIA_COLORS, CATEGORIA_EMOJI } from '@/lib/categorias_comunidad'
import { safeHref } from '@/lib/utils'
import { K as TOKENS } from "@/design/tokens";

const K = TOKENS;

function Stars({ rating }: { rating: number | null | undefined }) {
  if (!rating) return null
  const full = Math.min(Math.round(rating), 5)
  return (
    <div style={{ color: K.amarillo, fontSize: '.88rem', letterSpacing: 1, marginTop: 4 }}>
      {'★'.repeat(full)}{'☆'.repeat(5 - full)}
      <span style={{ color: K.muted, fontSize: '.68rem', marginLeft: 5 }}>{rating.toFixed(1)}</span>
    </div>
  )
}

function PriceRange({ value }: { value: string | null | undefined }) {
  if (!value) return null
  return (
    <span style={{ fontSize: '.7rem', color: K.muted, fontWeight: 700, marginLeft: 6 }}>{value}</span>
  )
}

function ActionButtons({ tienda, compact }: { tienda: TiendaData; compact?: boolean }) {
  const btnBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontWeight: 700, fontSize: '.72rem',
    padding: compact ? '4px 10px' : '6px 13px',
    borderRadius: 999, textDecoration: 'none', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  }
  const wa = tienda.whatsapp
    ? `https://wa.me/${tienda.whatsapp.replace(/\D/g, '')}`
    : tienda.telefono
      ? `https://wa.me/57${tienda.telefono.replace(/\D/g, '')}`
      : null
  const mapsUrl = tienda.google_place_id
    ? `https://www.google.com/maps/place/?q=place_id:${tienda.google_place_id}`
    : tienda.lat && tienda.lon
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tienda.nombre + ' ' + (tienda.barrio_nombre ?? 'Medellín'))}`
      : null
  const webHref = safeHref(tienda.website)

  if (!wa && !mapsUrl && !webHref) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer"
          style={{ ...btnBase, background: K.green, color: '#fff' }}>
          💬 WA
        </a>
      )}
      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          style={{ ...btnBase, background: '#4285F4', color: '#fff' }}>
          📍 Maps
        </a>
      )}
      {webHref && (
        <a href={webHref} target="_blank" rel="noopener noreferrer"
          style={{ ...btnBase, background: K.coralLight, color: K.coral }}>
          🌐 Web
        </a>
      )}
    </div>
  )
}

export function BusinessCardDirectory({ tienda }: { tienda: TiendaData }) {
  const catLabel = tienda.categoria ? (CATEGORIA_LABELS[tienda.categoria] ?? tienda.categoria) : null
  const catColor = tienda.categoria ? (CATEGORIA_COLORS[tienda.categoria] ?? '#F3F0E8') : '#F3F0E8'
  const catEmoji = tienda.categoria ? (CATEGORIA_EMOJI[tienda.categoria] ?? '⭐') : '⭐'

  const wa = tienda.whatsapp
    ? `https://wa.me/${tienda.whatsapp.replace(/\D/g, '')}`
    : tienda.telefono ? `https://wa.me/57${tienda.telefono.replace(/\D/g, '')}` : null
  const mapsUrl = tienda.google_place_id
    ? `https://www.google.com/maps/place/?q=place_id:${tienda.google_place_id}`
    : (tienda.lat && tienda.lon)
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tienda.nombre + ' ' + (tienda.barrio_nombre ?? 'Medellín'))}`
      : null

  const primaryBtn = wa || mapsUrl
  const secondaryBtn = wa ? mapsUrl : null

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #E5E0D5',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxShadow: '0 2px 8px rgba(20,32,29,.06)',
    }}>
      {/* Foto */}
      <div style={{
        height: 120, flexShrink: 0, position: 'relative',
        background: catColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {tienda.foto_url ? (
          <img
            src={tienda.foto_url} alt={tienda.nombre}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <span style={{ fontSize: 36 }}>{catEmoji}</span>
        )}
        {catLabel && (
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: '#FCD116', color: '#111418',
            fontWeight: 800, fontSize: 10, padding: '3px 7px',
            borderRadius: 4, letterSpacing: '0.4px', whiteSpace: 'nowrap',
            maxWidth: 'calc(100% - 16px)', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            ★ {catLabel}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
        {/* Barrio */}
        {tienda.barrio_nombre && (
          <p style={{
            fontSize: 10, color: '#5B5F5C', margin: 0,
            textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            <Name>{tienda.barrio_nombre}</Name>
          </p>
        )}

        {/* Nombre */}
        <p style={{
          fontWeight: 700, fontSize: 14, color: '#111418',
          margin: 0, lineHeight: 1.25,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          <Name>{tienda.nombre}</Name>
        </p>

        {/* Rating + precio */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
          {tienda.rating_google ? (
            <>
              <span style={{ color: '#FCD116', fontSize: 12, letterSpacing: 1 }}>
                {'★'.repeat(Math.min(Math.round(tienda.rating_google), 5))}
              </span>
              <span style={{ fontSize: 11, color: '#5B5F5C', fontWeight: 600 }}>
                {tienda.rating_google.toFixed(1)}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: '#6E726E' }}>Sin calificación</span>
          )}
        </div>

        {/* Dirección */}
        {tienda.direccion && (
          <p style={{
            fontSize: 11, color: '#6E726E', margin: 0, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {tienda.direccion}
          </p>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Botones */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {primaryBtn && (
            <a href={primaryBtn} target="_blank" rel="noopener noreferrer" style={{
              flex: 1, textAlign: 'center', padding: '7px 0',
              background: wa ? '#25D366' : '#4285F4',
              borderRadius: 7, fontSize: 11, color: '#fff',
              textDecoration: 'none', fontWeight: 700,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {wa ? '💬 WhatsApp' : '📍 Maps'}
            </a>
          )}
          {secondaryBtn && (
            <a href={secondaryBtn} target="_blank" rel="noopener noreferrer" style={{
              flex: '0 0 auto', padding: '7px 10px',
              background: '#F3F0E8', border: '1px solid #E5E0D5',
              borderRadius: 7, fontSize: 11, color: '#111418',
              textDecoration: 'none', fontWeight: 600,
              whiteSpace: 'nowrap',
            }}>
              📍
            </a>
          )}
          {!primaryBtn && !secondaryBtn && safeHref(tienda.website) && (
            <a href={safeHref(tienda.website)} target="_blank" rel="noopener noreferrer" style={{
              flex: 1, textAlign: 'center', padding: '7px 0',
              background: '#F3F0E8', border: '1px solid #E5E0D5',
              borderRadius: 7, fontSize: 11, color: '#111418',
              textDecoration: 'none', fontWeight: 600,
            }}>
              🌐 Web
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export function BusinessCardList({ tienda }: { tienda: TiendaData }) {
  const catLabel = tienda.categoria ? (CATEGORIA_LABELS[tienda.categoria] ?? tienda.categoria) : null
  const catColor = tienda.categoria ? (CATEGORIA_COLORS[tienda.categoria] ?? K.line) : K.line
  const catEmoji = tienda.categoria ? (CATEGORIA_EMOJI[tienda.categoria] ?? '⭐') : '⭐'

  return (
    <div style={{
      display: 'flex', gap: 14, padding: 14,
      background: '#fff', border: `1px solid ${K.line}`, borderRadius: 12,
      boxShadow: '0 1px 3px rgba(20,32,29,.05)',
      transition: 'box-shadow .15s, border-color .15s',
    }}>
      {/* Foto */}
      <div style={{
        width: 108, height: 108, borderRadius: 10, flexShrink: 0, position: 'relative',
        background: catColor, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {tienda.foto_url ? (
          <img
            src={tienda.foto_url} alt={tienda.nombre} loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <span style={{ fontSize: 32 }}>{catEmoji}</span>
        )}
        {tienda.verificado && (
          <span title="Negocio verificado" style={{
            position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%',
            background: K.teal, color: '#fff', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,.25)',
          }}>
            ✓
          </span>
        )}
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <h4 style={{
          fontFamily: K.serif, fontWeight: 700, fontSize: 15, margin: 0, color: K.ink, lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          <Name>{tienda.nombre}</Name>
        </h4>

        {catLabel && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: K.tealDeep, textTransform: 'uppercase',
            letterSpacing: '.5px', marginTop: 4,
          }}>
            {catEmoji} {catLabel}
          </span>
        )}

        <Stars rating={tienda.rating_google} />

        {tienda.direccion && (
          <p style={{
            fontSize: 12, color: K.muted, margin: '4px 0 0', lineHeight: 1.35,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            📍 {tienda.direccion}
          </p>
        )}

        <div style={{ flex: 1, minHeight: 6 }} />
        <ActionButtons tienda={tienda} compact />
      </div>
    </div>
  )
}
