import { createFileRoute } from '@tanstack/react-router'
import { formatMoney } from "@/lib/format";
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { API_ENDPOINTS } from '@/config/api'
import type { ApiListingsResponse, ApiListing } from '@/lib/adapters'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/real-estate')({
  component: RealEstateRoot,
  head: () => ({
    meta: [
      { title: 'Mercado Inmobiliario · Valle de Aburrá · Medellín Social' },
      { name: 'description', content: '54,000+ propiedades. Datos reales. Compra, arrienda e invierte en el Valle de Aburrá con los mejores agentes locales.' },
    ],
  }),
})

function RealEstateRoot() {
  return (
    <ComunidadLayout>
      <RealEstatePage />
    </ComunidadLayout>
  )
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const K = TOKENS;

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCOP(n: number): string {
  return formatMoney(n, "COP", undefined, { suffix: false })
}

// ── Static data ───────────────────────────────────────

const STATS = [
  { value: '+378%',        label: 'IED Medellín 2025',          note: 'Inversión extranjera directa' },
  { value: '$1.5k–$2.5k', label: 'USD precio/m² El Poblado',   note: 'Rango promedio 2025' },
  { value: '+1.27M',        label: 'Visitantes internacionales',  note: 'Llegadas aéreas 2025' },
  { value: '15–20%',       label: 'Compradores extranjeros',     note: 'Del mercado nacional' },
]

const CATEGORIAS = [
  {
    label:    'Comprar',
    sub:      'Apartamentos y casas en venta',
    href:     '/map?tipo_operacion=venta',
    bg:       `linear-gradient(145deg, ${K.tealDeep} 0%, ${K.teal} 100%)`,
    fg:       '#fff',
    emoji:    '🏡',
  },
  {
    label:    'Arrendar',
    sub:      'Arriendos en toda el área metropolitana',
    href:     '/map?tipo_operacion=arriendo',
    bg:       `linear-gradient(145deg, #00286B 0%, ${K.azul} 100%)`,
    fg:       '#fff',
    emoji:    '🔑',
  },
  {
    label:    'Vender',
    sub:      'Publica tu propiedad en minutos',
    href:     '/vender',
    bg:       `linear-gradient(145deg, #9E0D1D 0%, ${K.rojo} 100%)`,
    fg:       '#fff',
    emoji:    '📋',
  },
  {
    label:    'Invertir',
    sub:      'Analiza barrios con datos reales',
    href:     '/map',
    bg:       `linear-gradient(145deg, #F2B807 0%, ${K.amarillo} 100%)`,
    fg:       K.ink,
    emoji:    '📈',
  },
]

// ── Icons ──────────────────────────────────────────────────────────────────────

function IcoLinkedIn() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  )
}

function IcoInstagram() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
    </svg>
  )
}

function IcoWhatsApp() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>
  )
}

function IcoGlobe() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  )
}

// ── Section 1: Hero ────────────────────────────────────────────────────────────

function HeroSection() {
  const [modo, setModo] = useState<'comprar' | 'arrendar' | 'invertir'>('comprar')

  const modoHref = {
    comprar:  '/map?tipo_operacion=venta',
    arrendar: '/map?tipo_operacion=arriendo',
    invertir: '/map',
  }

  const tabs: { key: typeof modo; label: string }[] = [
    { key: 'comprar',  label: 'Comprar'  },
    { key: 'arrendar', label: 'Arrendar' },
    { key: 'invertir', label: 'Invertir' },
  ]

  return (
    <section style={{
      background: `linear-gradient(160deg, ${K.paper} 52%, ${K.coralLight} 100%)`,
      borderBottom: `1px solid ${K.line}`,
      padding: 'clamp(64px, 12vw, 112px) 24px clamp(56px, 10vw, 88px)',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: 740, margin: '0 auto' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: K.coralLight, color: K.coral,
          fontFamily: K.manrope,
          fontSize: '.62rem', fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '1.6px',
          padding: '5px 16px', borderRadius: 999, marginBottom: 32,
        }}>
          Medellín Social · Real Estate
        </div>

        <h1 style={{
          fontFamily: K.serif,
          fontWeight: 900,
          fontSize: 'clamp(2.4rem, 7vw, 4rem)',
          color: K.ink,
          lineHeight: 1.05,
          letterSpacing: -2,
          margin: '0 0 24px',
        }}>
          El mercado inmobiliario<br />
          del Valle de Aburrá,<br />
          <span style={{ color: K.coral }}>en tus manos.</span>
        </h1>

        <p style={{
          fontFamily: K.manrope,
          fontSize: 'clamp(.92rem, 2vw, 1.05rem)',
          color: K.muted,
          lineHeight: 1.7,
          maxWidth: 460,
          margin: '0 auto 44px',
        }}>
          54,000+ propiedades. Datos reales.<br />
          Inversores locales y extranjeros.
        </p>

        {/* Filter tabs */}
        <div style={{
          display: 'inline-flex',
          gap: 0,
          background: K.surface,
          border: `1px solid ${K.line}`,
          borderRadius: 999,
          padding: 4,
          marginBottom: 28,
        }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setModo(t.key)}
              style={{
                padding: '9px 24px',
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                fontFamily: K.manrope,
                fontWeight: 700,
                fontSize: '.84rem',
                letterSpacing: '.2px',
                transition: 'background .15s, color .15s, box-shadow .15s',
                background: modo === t.key ? K.ink : 'transparent',
                color:      modo === t.key ? '#fff' : K.muted,
                boxShadow:  modo === t.key ? '0 2px 8px rgba(20,32,29,0.22)' : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <br />

        <a
          href={modoHref[modo]}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: K.coral, color: '#fff',
            fontFamily: K.manrope, fontWeight: 800, fontSize: '.92rem',
            padding: '14px 32px', borderRadius: 999,
            textDecoration: 'none', letterSpacing: '.2px',
            boxShadow: '0 4px 20px rgba(216,90,48,0.28)',
          }}
        >
          Ver propiedades →
        </a>
      </div>
    </section>
  )
}

// ── Section 2: Listings destacados ────────────────────────────────────────────

function ListingCard({ listing }: { listing: ApiListing }) {
  const precio = listing.precio_cop
  const barrio = listing.barrio_nombre ?? '—'
  const area   = listing.area_m2
  const hab    = listing.habitaciones
  const op     = listing.tipo_operacion === 'arriendo' ? 'Arriendo' : 'Venta'
  const opColor = listing.tipo_operacion === 'arriendo' ? K.teal : K.coral

  return (
    <a
      href={listing.id ? `/listing/${listing.id}` : '#'}
      style={{
        background: K.paper,
        borderRadius: 14,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: '0 2px 10px rgba(20,32,29,.07)',
        transition: 'box-shadow .15s, transform .15s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLAnchorElement
        el.style.boxShadow = '0 8px 32px rgba(20,32,29,0.13)'
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLAnchorElement
        el.style.boxShadow = '0 2px 10px rgba(20,32,29,.07)'
        el.style.transform = 'none'
      }}
    >
      {/* Photo */}
      <div style={{
        height: 178,
        background: `linear-gradient(135deg, ${K.surface} 0%, ${K.line} 100%)`,
        position: 'relative',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        {listing.foto_principal ? (
          <img
            src={listing.foto_principal}
            alt={barrio}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '2.4rem', opacity: .28,
          }}>
            🏢
          </div>
        )}
        {/* gradient overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(20,32,29,.65) 0%, rgba(20,32,29,.05) 50%, transparent 100%)' }} />
        {/* pills */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
          <span style={{
            fontFamily: K.manrope,
            background: opColor, color: '#fff',
            fontSize: '.58rem', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '.8px',
            padding: '3px 9px', borderRadius: 999,
          }}>
            {op}
          </span>
          {listing.buena_oferta && (
            <span style={{
              fontFamily: K.manrope,
              background: K.amarillo, color: K.ink,
              fontSize: '.58rem', fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: '.8px',
              padding: '3px 9px', borderRadius: 999,
            }}>
              Buena oferta
            </span>
          )}
        </div>
        {/* price over gradient */}
        {precio && (
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <div style={{
              fontFamily: K.serif, fontWeight: 900,
              fontSize: '1.2rem', color: '#fff', lineHeight: 1,
              textShadow: '0 1px 4px rgba(0,0,0,.3)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtCOP(precio)}
              {listing.tipo_operacion === 'arriendo' && (
                <span style={{ fontSize: '.7rem', fontWeight: 500, opacity: .8 }}> /mes</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontFamily: K.manrope, fontSize: '.77rem', color: K.muted, fontWeight: 600 }}>
          📍 {barrio}
        </div>
        <div style={{
          display: 'flex', gap: 10,
          fontFamily: K.manrope, fontSize: '.72rem', color: K.muted,
        }}>
          {area && <span>{area} m²</span>}
          {hab  && <span>{hab} hab</span>}
        </div>
      </div>
    </a>
  )
}

function ListingCardSkeleton() {
  return (
    <div style={{
      background: K.paper,
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 2px 10px rgba(20,32,29,.07)',
    }}>
      <div style={{ height: 178, background: K.surface }} />
      <div style={{ padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 20, width: '55%', background: K.line, borderRadius: 6 }} />
        <div style={{ height: 13, width: '70%', background: K.surface, borderRadius: 6 }} />
        <div style={{ height: 11, width: '40%', background: K.surface, borderRadius: 6 }} />
      </div>
    </div>
  )
}

function ListingsDestacadosSection() {
  const { data, isLoading } = useQuery<ApiListingsResponse>({
    queryKey: ['featured-listings'],
    queryFn: () => apiFetch(`${API_ENDPOINTS.allListings}?limit=24`),
    staleTime: 10 * 60_000,
  })

  const featured = useMemo(() => {
    const all = data?.listings ?? []
    const withPhoto   = all.filter(l => l.foto_principal)
    const candidates  = withPhoto.length >= 4 ? withPhoto : all
    return [...candidates]
      .sort((a, b) => (b.buena_oferta ? 1 : 0) - (a.buena_oferta ? 1 : 0))
      .slice(0, 6)
  }, [data])

  return (
    <section style={{
      background: K.paper,
      borderBottom: `1px solid ${K.line}`,
      padding: 'clamp(48px, 8vw, 80px) 24px',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 16, marginBottom: 36,
        }}>
          <div>
            <h2 style={{
              fontFamily: K.serif, fontWeight: 800,
              fontSize: 'clamp(1.5rem, 3.5vw, 2.1rem)',
              color: K.ink, margin: '0 0 6px', letterSpacing: -.5,
            }}>
              Propiedades destacadas
            </h2>
            <p style={{ color: K.muted, fontSize: '.88rem', margin: 0 }}>
              Las mejores ofertas del mercado, actualizadas diariamente.
            </p>
          </div>
          <a
            href="/map"
            style={{
              color: K.teal, fontWeight: 700, fontSize: '.85rem',
              textDecoration: 'none', flexShrink: 0,
            }}
          >
            Ver todas →
          </a>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
          gap: 20,
        }}>
          {isLoading
            ? [0,1,2,3,4,5].map(i => <ListingCardSkeleton key={i} />)
            : featured.map(l => <ListingCard key={l.id} listing={l} />)
          }
        </div>
      </div>
    </section>
  )
}

// ── Section 3: La historia ─────────────────────────────────────────────────────

function HistoriaSection() {
  const metrics = [
    { val: '54K+',  lbl: 'listings activos' },
    { val: '606',   lbl: 'barrios mapeados'  },
    { val: '12K+',  lbl: 'negocios locales'  },
    { val: 'reales', lbl: 'datos verificados' },
  ]

  return (
    <section style={{
      background: K.surface,
      borderBottom: `1px solid ${K.line}`,
      padding: 'clamp(56px, 9vw, 96px) 24px',
    }}>
      <div style={{
        maxWidth: 1200, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 'clamp(36px, 6vw, 72px)',
        alignItems: 'center',
      }}>
        {/* Left: editorial photo */}
        <div style={{
          borderRadius: 18,
          overflow: 'hidden',
          aspectRatio: '4/3',
          minHeight: 260,
          position: 'relative',
          background: `linear-gradient(145deg, ${K.tealDeep} 0%, #1a6b50 100%)`,
        }}>
          <img
            src="https://images.unsplash.com/photo-1697082390861-9f5186b44431?auto=format&fit=crop&w=900&q=80"
            alt="Medellín" loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(20,32,29,.55) 0%, transparent 50%)' }} />
          <div style={{ position: 'absolute', bottom: 18, left: 18 }}>
            <span style={{ fontFamily: K.manrope, fontSize: '.68rem', fontWeight: 700, color: 'rgba(255,255,255,.72)', textTransform: 'uppercase', letterSpacing: '1.4px', background: 'rgba(20,32,29,.4)', padding: '4px 10px', borderRadius: 999 }}>
              Valle de Aburrá
            </span>
          </div>
        </div>

        {/* Right: copy */}
        <div>
          <div style={{
            fontFamily: K.manrope, fontSize: '.62rem', fontWeight: 800,
            color: K.coral, textTransform: 'uppercase',
            letterSpacing: '1.6px', marginBottom: 18,
          }}>
            Nuestra historia
          </div>

          <h2 style={{
            fontFamily: K.serif, fontWeight: 800,
            fontSize: 'clamp(1.5rem, 3.5vw, 2rem)',
            color: K.ink, margin: '0 0 20px', letterSpacing: -.5,
            lineHeight: 1.2,
          }}>
            Nacimos para hacer transparente el mercado más opaco de Colombia
          </h2>

          <p style={{
            fontFamily: K.manrope, color: K.muted, fontSize: '.94rem',
            lineHeight: 1.75, margin: '0 0 32px',
          }}>
            El mercado inmobiliario colombiano es fragmentado, costoso y difícil de navegar — especialmente para compradores extranjeros. Medellín Social centraliza datos reales de 54,000+ propiedades en 10 municipios del Valle de Aburrá, con precios verificados, análisis de barrios y agentes locales de confianza.
          </p>

          {/* Metrics row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
          }}>
            {metrics.map(m => (
              <div key={m.lbl} style={{
                background: K.paper,
                borderRadius: 12,
                padding: '16px 18px',
                boxShadow: '0 1px 6px rgba(20,32,29,.07)',
              }}>
                <div style={{
                  fontFamily: K.serif, fontWeight: 900,
                  fontSize: '1.5rem', color: K.tealDeep,
                  lineHeight: 1, marginBottom: 5,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {m.val}
                </div>
                <div style={{ fontFamily: K.manrope, fontSize: '.72rem', color: K.muted, fontWeight: 600 }}>
                  {m.lbl}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Section 4: Categorías visuales ────────────────────────────────────────────

function CategoriasSection() {
  return (
    <section style={{
      background: K.paper,
      borderBottom: `1px solid ${K.line}`,
      padding: 'clamp(48px, 8vw, 80px) 24px',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: K.serif, fontWeight: 800,
          fontSize: 'clamp(1.5rem, 3.5vw, 2.1rem)',
          color: K.ink, margin: '0 0 32px', letterSpacing: -.5,
          textAlign: 'center',
        }}>
          ¿Qué estás buscando?
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}>
          {CATEGORIAS.map(cat => (
            <a
              key={cat.label}
              href={cat.href}
              style={{
                background: cat.bg,
                borderRadius: 16,
                padding: '36px 24px 28px',
                display: 'flex', flexDirection: 'column',
                textDecoration: 'none',
                color: cat.fg,
                transition: 'transform .15s, box-shadow .15s',
                minHeight: 180,
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLAnchorElement
                el.style.transform = 'translateY(-3px)'
                el.style.boxShadow = '0 12px 40px rgba(0,0,0,0.2)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLAnchorElement
                el.style.transform = 'none'
                el.style.boxShadow = 'none'
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>{cat.emoji}</div>
              <div style={{
                fontFamily: K.serif, fontWeight: 800,
                fontSize: '1.3rem', marginBottom: 6,
              }}>
                {cat.label}
              </div>
              <div style={{
                fontFamily: K.manrope,
                fontSize: '.85rem', color: cat.fg, opacity: .78,
                lineHeight: 1.5, flex: 1,
              }}>
                {cat.sub}
              </div>
              <div style={{
                fontFamily: K.manrope,
                marginTop: 20, fontSize: '.78rem',
                fontWeight: 700, color: cat.fg, opacity: .9,
                letterSpacing: '.2px',
              }}>
                Explorar →
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Section 5: Métricas del mercado ───────────────────────────────────────────

function StatsSection() {
  return (
    <section style={{
      background: K.ink,
      padding: 'clamp(40px, 6vw, 64px) 24px',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 0,
          borderRadius: 16,
          overflow: 'hidden',
          border: `1px solid rgba(255,255,255,0.08)`,
        }}>
          {STATS.map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: 'clamp(24px, 4vw, 36px) 28px',
                borderRight: i < STATS.length - 1 ? `1px solid rgba(255,255,255,0.08)` : 'none',
                textAlign: 'center',
              }}
            >
              <div style={{
                fontFamily: K.serif, fontWeight: 900,
                fontSize: 'clamp(1.7rem, 3vw, 2.4rem)',
                color: K.amarillo, lineHeight: 1, marginBottom: 8,
                fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px',
              }}>
                {s.value}
              </div>
              <div style={{
                fontFamily: K.manrope,
                fontSize: '.68rem', fontWeight: 700,
                color: '#fff', textTransform: 'uppercase',
                letterSpacing: '.9px', marginBottom: 5,
              }}>
                {s.label}
              </div>
              <div style={{ fontFamily: K.manrope, fontSize: '.68rem', color: 'rgba(255,255,255,0.38)' }}>
                {s.note}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Section 7: CTA final ───────────────────────────────────────────────────────

function FinalCTASection() {
  return (
    <section style={{
      background: 'linear-gradient(145deg, #161A17 0%, #111418 55%, #2A1A10 100%)',
      padding: 'clamp(56px, 9vw, 88px) 24px',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: K.serif, fontWeight: 900,
          fontSize: 'clamp(1.8rem, 4.5vw, 2.6rem)',
          color: '#fff', margin: '0 0 16px',
          lineHeight: 1.1, letterSpacing: -1,
        }}>
          ¿Listo para encontrar<br />tu propiedad?
        </h2>
        <p style={{
          fontFamily: K.manrope,
          color: 'rgba(255,255,255,0.58)',
          fontSize: '.94rem', lineHeight: 1.7, margin: '0 0 36px',
        }}>
          Explora 54,000+ propiedades con precios reales, análisis de barrios y agentes verificados.
        </p>
        <a
          href="/map"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: K.coral, color: '#fff',
            fontFamily: K.manrope, fontWeight: 800, fontSize: '.92rem',
            padding: '15px 34px', borderRadius: 999,
            textDecoration: 'none', letterSpacing: '.2px',
            boxShadow: '0 4px 24px rgba(216,90,48,0.35)',
          }}
        >
          🗺️ Ver mapa de propiedades →
        </a>
      </div>
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

function RealEstatePage() {
  return (
    <>
      <HeroSection />
      <ListingsDestacadosSection />
      <HistoriaSection />
      <CategoriasSection />
      <StatsSection />
      <FinalCTASection />
    </>
  )
}
