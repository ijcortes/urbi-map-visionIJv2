import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { API_BASE_URL } from '@/config/api'
import { BARRIOS } from '@/components/comunidad/BarrioContext'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/negocios/unirse')({
  component: NegociosUnirsePage,
  head: () => seo({ title: "Lista tu negocio · Medellín Social", description: "Sé el negocio de referencia en tu barrio. Un solo negocio por categoría.", path: "/negocios/unirse" }),
})

const K = TOKENS;

const CATEGORIAS = [
  'Brunch', 'Restaurante / Cena', 'Bar', 'Café', 'Panadería', 'Comida rápida',
  'Spa & Masajes', 'Gym / Fitness', 'Yoga', 'Peluquería / Estética',
  'Médicos / Clínica', 'Dentistas', 'Abogados', 'Contadores', 'Inmuebles', 'Otro',
]

type Plan = 'hotspot' | 'featured'

const WHY_ITEMS = [
  { ico: '🏆', titulo: 'Exclusividad de categoría', desc: 'Un solo restaurante, un solo dentista, un solo gym por barrio. No compites — eres el referente.' },
  { ico: '📈', titulo: 'No es publicidad', desc: 'Es presencia orgánica: SEO, AEO, mapa local y contenido que crece contigo cada mes.' },
  { ico: '📞', titulo: 'Lleva inbound a tu negocio', desc: 'Tus vecinos te encuentran cuando buscan en Google, ChatGPT o Google Maps. Leads que vienen solos.' },
  { ico: '⚙️', titulo: 'Nosotros hacemos el trabajo pesado', desc: 'El Embajador del Barrio te incorpora y el equipo de contenido IA maneja las publicaciones.' },
]

const AUTHORITY_ITEMS = [
  {
    tag: 'SEO', titulo: 'Búsqueda en Google',
    desc: 'Apareces cuando alguien busca "mejor café en El Poblado" o "spa en Laureles". Posicionamiento orgánico real.',
    col: K.teal,
  },
  {
    tag: 'AEO', titulo: 'IA: ChatGPT & Perplexity',
    desc: 'Tu negocio aparece en las respuestas de IA cuando alguien pregunta por el mejor de tu categoría en Medellín.',
    col: K.coral,
  },
  {
    tag: 'MEO', titulo: 'Mapa local: Google & Apple',
    desc: 'Dominas Google Maps y Apple Maps en tu barrio y categoría. El mapa es donde tus vecinos deciden.',
    col: K.amarillo,
  },
]

const COMPARISON = {
  cols: ['Característica', 'Gratis', 'Hotspot', 'Featured ★'],
  colColors: ['', '', K.coral, K.teal],
  rows: [
    { feat: 'Precio', free: '$0', hot: 'desde $29 USD', featured: '$199 USD lanzamiento' },
    { feat: 'Listado básico en directorio', free: '✓', hot: '✓', featured: '✓' },
    { feat: 'Deal / Oferta flash', free: '—', hot: '✓', featured: '✓' },
    { feat: 'Newsletter semanal del barrio', free: '—', hot: '✓', featured: '✓' },
    { feat: 'Publicación en redes', free: '—', hot: '✓', featured: '✓' },
    { feat: 'Exclusividad de categoría', free: '—', hot: '—', featured: '✓' },
    { feat: 'Badge "Featured" en portada', free: '—', hot: '—', featured: '✓' },
    { feat: 'Perfil dedicado con fotos y bio', free: '—', hot: '—', featured: '✓' },
    { feat: 'Artículo IA al inicio', free: '—', hot: '—', featured: '✓' },
    { feat: 'SEO + AEO + MEO', free: '—', hot: '—', featured: '✓' },
  ],
}

const ELIGIBILITY = [
  { ico: '🍽️', cat: 'Gastronomía', desc: 'Restaurantes, bares, cafés, panaderías, comida rápida' },
  { ico: '💪', cat: 'Salud & Bienestar', desc: 'Médicos, gym, yoga, spa, nutrición' },
  { ico: '💇', cat: 'Estética & Moda', desc: 'Peluquerías, estéticas, boutiques, barbería' },
  { ico: '📋', cat: 'Servicios Profesionales', desc: 'Abogados, contadores, consultores' },
  { ico: '🏠', cat: 'Inmuebles & Hogar', desc: 'Constructoras, decoración, ferretería' },
  { ico: '🎓', cat: 'Educación & Cultura', desc: 'Colegios, academias, talleres, arte' },
]

const ONBOARDING = [
  { n: 1, titulo: 'Aplica aquí', desc: 'Completa el formulario en 3 minutos con los datos de tu negocio.' },
  { n: 2, titulo: 'Llamada de 15 min', desc: 'El Embajador del Barrio te llama para confirmar categoría y detalles del plan.' },
  { n: 3, titulo: 'Perfil activo en 48 h', desc: 'Publicamos tu perfil, deal de bienvenida y artículo IA en el barrio.' },
  { n: 4, titulo: 'Crecemos juntos', desc: 'Reportes mensuales de vistas, contactos y posicionamiento.' },
]

function NegociosUnirsePage() {
  const [plan, setPlan] = useState<Plan>('featured')
  const [nombreNegocio, setNombreNegocio] = useState('')
  const [tuNombre, setTuNombre] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [categoria, setCategoria] = useState('')
  const [barrioId, setBarrioId] = useState<number | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/business/aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre_negocio: nombreNegocio,
          email,
          telefono,
          categoria,
          barrio_id: barrioId,
          plan_tipo: plan,
          mensaje: `Contacto: ${tuNombre}. ${mensaje}`,
        }),
      })
      if (!res.ok) throw new Error()
      setSuccess(true)
    } catch {
      setError('Error al enviar. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    border: `1px solid ${K.line}`, borderRadius: 8,
    fontSize: '.96rem', fontFamily: 'inherit',
    background: '#fff', color: K.ink, outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '.75rem', fontWeight: 700,
    color: K.ink, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: '.4px',
  }

  const subNav = (
    <div style={{ background: K.paper, borderBottom: `1px solid ${K.line}`, padding: '0 26px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 24, alignItems: 'center', height: 44 }}>
        <a href="#planes" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Planes</a>
        <a href="#porque" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>¿Por qué?</a>
        <a href="#form" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Categorías</a>
        <a href="#aplicar" style={{
          marginLeft: 'auto', background: K.coral, color: '#fff', fontWeight: 700,
          padding: '6px 16px', borderRadius: 8, fontSize: '.85rem', textDecoration: 'none',
        }}>Aplicar →</a>
      </div>
    </div>
  )

  return (
    <ComunidadLayout subNav={subNav}>

      {/* HERO */}
      <section style={{
        background: `radial-gradient(circle at 20% 20%, rgba(29,158,117,.08), transparent 55%),
          linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
        padding: '72px 26px 56px', textAlign: 'center', borderBottom: `1px solid ${K.line}`,
      }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <span style={{
            display: 'inline-block', background: `rgba(29,158,117,.12)`, color: K.tealDeep,
            padding: '6px 14px', borderRadius: 999, fontWeight: 700, fontSize: '.75rem',
            letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 18,
          }}>
            Plataforma para negocios locales de Medellín
          </span>
          <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2.2rem,5vw,3.4rem)', color: K.ink, margin: '0 0 18px', lineHeight: 1.05, letterSpacing: '-1px' }}>
            Sé el negocio de referencia<br />
            <span style={{ color: K.coral }}>en tu barrio</span>
          </h1>
          <p style={{ fontSize: '1.1rem', color: K.muted, margin: '0 auto 30px', lineHeight: 1.6, maxWidth: 640 }}>
            Un solo negocio por categoría en cada barrio. Cuando tus vecinos buscan el mejor restaurante, spa o servicio en Google, ChatGPT o el mapa —
            <strong style={{ color: K.ink }}> tú eres la respuesta.</strong>
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#planes" style={{
              background: K.coral, color: '#fff', fontWeight: 700, fontSize: '1rem',
              padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
              boxShadow: '0 8px 24px rgba(216,90,48,.28)',
            }}>
              Ver planes →
            </a>
            <a href="#aplicar" style={{
              background: '#fff', color: K.ink, fontWeight: 700, fontSize: '1rem',
              padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
              border: `2px solid ${K.ink}`,
            }}>
              Aplicar ahora
            </a>
          </div>
        </div>
      </section>

      {/* DOS PLANES */}
      <section id="planes" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Elige tu camino
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 600, margin: '0 0 40px' }}>
            Dos formas de llegar a tus vecinos. Empieza con una oferta o reserva tu categoría exclusiva.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 22 }}>

            {/* PATH A — HOTSPOT */}
            <div
              onClick={() => setPlan('hotspot')}
              style={{
                border: `2px solid ${plan === 'hotspot' ? K.coral : K.line}`,
                borderRadius: 16, padding: '30px 26px', cursor: 'pointer',
                background: plan === 'hotspot' ? K.coralLight : '#fff',
                transition: 'all .2s', position: 'relative',
              }}
            >
              <div style={{
                position: 'absolute', top: -12, left: 20,
                background: K.amarillo, color: K.ink, fontWeight: 800,
                fontSize: '.65rem', letterSpacing: '1px', textTransform: 'uppercase',
                padding: '4px 12px', borderRadius: 4,
              }}>
                Empieza aquí
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, marginTop: 8 }}>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.5rem', color: K.ink, margin: 0 }}>
                  Hotspot / Oferta especial
                </h2>
                <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${plan === 'hotspot' ? K.coral : K.line}`, background: plan === 'hotspot' ? K.coral : 'transparent', flexShrink: 0 }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <span style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '2rem', color: K.coral }}>desde $29</span>
                <span style={{ color: K.muted, fontSize: '.88rem' }}> USD por placement</span>
              </div>
              {[
                'Aparece en Hotspots & Deals del home',
                'Incluido en newsletter semanal del barrio',
                'Publicado en redes de Medellín Social',
                'Sin compromiso mensual',
                'Ideal para restaurantes, bares, spas',
              ].map(f => (
                <div key={f} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <span style={{ color: K.teal, fontWeight: 900, lineHeight: 1.4 }}>✓</span>
                  <span style={{ fontSize: '.9rem', color: K.ink, lineHeight: 1.4 }}>{f}</span>
                </div>
              ))}
              <button
                onClick={e => { e.stopPropagation(); setPlan('hotspot') }}
                style={{
                  marginTop: 22, width: '100%', padding: '13px', borderRadius: 8,
                  background: plan === 'hotspot' ? K.coral : 'transparent',
                  color: plan === 'hotspot' ? '#fff' : K.coral,
                  border: `2px solid ${K.coral}`, fontWeight: 800, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '.96rem',
                }}
              >
                Publicar una oferta →
              </button>
            </div>

            {/* PATH B — FEATURED */}
            <div
              onClick={() => setPlan('featured')}
              style={{
                border: `2px solid ${plan === 'featured' ? K.teal : K.line}`,
                borderRadius: 16, padding: '30px 26px', cursor: 'pointer',
                background: plan === 'featured' ? K.ink : '#fff',
                transition: 'all .2s', position: 'relative',
              }}
            >
              <div style={{
                position: 'absolute', top: -12, left: 20,
                background: K.teal, color: '#fff', fontWeight: 800,
                fontSize: '.65rem', letterSpacing: '1px', textTransform: 'uppercase',
                padding: '4px 12px', borderRadius: 4,
              }}>
                ★ Mejor valor · Exclusivo
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, marginTop: 8 }}>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.5rem', color: plan === 'featured' ? '#fff' : K.ink, margin: 0 }}>
                  Featured Business
                </h2>
                <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${plan === 'featured' ? K.teal : K.line}`, background: plan === 'featured' ? K.teal : 'transparent', flexShrink: 0 }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <span style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '2rem', color: K.amarillo }}>$199 USD</span>
                <span style={{ color: plan === 'featured' ? 'rgba(255,255,255,.7)' : K.muted, fontSize: '.88rem' }}> lanzamiento</span>
                <div style={{ fontSize: '.82rem', color: plan === 'featured' ? 'rgba(255,255,255,.6)' : K.muted, marginTop: 4 }}>
                  + $200 USD/mes Featured · cancelable
                </div>
              </div>
              {[
                'Exclusividad de categoría en tu barrio',
                'Badge "Featured" permanente en el home',
                'Perfil dedicado con bio, fotos y horarios',
                'Artículo IA publicado al inicio',
                'Newsletter + redes + blog + RSS',
                'SEO + AEO + MEO del mapa local',
              ].map(f => (
                <div key={f} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <span style={{ color: K.teal, fontWeight: 900, lineHeight: 1.4 }}>✓</span>
                  <span style={{ fontSize: '.9rem', color: plan === 'featured' ? '#e5eeea' : K.ink, lineHeight: 1.4 }}>{f}</span>
                </div>
              ))}
              <button
                onClick={e => { e.stopPropagation(); setPlan('featured') }}
                style={{
                  marginTop: 22, width: '100%', padding: '13px', borderRadius: 8,
                  background: K.coral, color: '#fff',
                  border: 'none', fontWeight: 800, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '.96rem',
                }}
              >
                Reservar mi categoría →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* POR QUÉ — dark band */}
      <section id="porque" style={{ background: K.ink, padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: '#fff', margin: '0 0 14px' }}>
            Por qué funciona
          </h2>
          <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '1.05rem', maxWidth: 600, margin: '0 0 40px' }}>
            Si has invertido en publicidad local antes, sabes las objeciones. Medellín Social las elimina.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            {WHY_ITEMS.map(w => (
              <div key={w.titulo} style={{
                background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 12, padding: '26px 22px', borderTop: `4px solid ${K.amarillo}`,
              }}>
                <div style={{ fontSize: 24, marginBottom: 14 }}>{w.ico}</div>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.05rem', color: '#fff', margin: '0 0 10px' }}>
                  {w.titulo}
                </h3>
                <p style={{ fontSize: '.88rem', color: 'rgba(255,255,255,.75)', lineHeight: 1.5, margin: 0 }}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SEO / AEO / MEO */}
      <section style={{ padding: '72px 26px', background: '#fff', borderTop: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Autoridad local real
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 640, margin: '0 0 40px' }}>
            No es pauta — es posicionamiento orgánico que se acumula. Tu presencia digital crece cada mes sin que gastes más.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22 }}>
            {AUTHORITY_ITEMS.map(a => (
              <div key={a.tag} style={{ background: K.paper, borderRadius: 14, padding: '30px 26px', border: `1px solid ${K.line}` }}>
                <span style={{
                  display: 'inline-block', background: a.col, color: '#fff',
                  fontWeight: 800, fontSize: '.72rem', letterSpacing: '1.2px',
                  textTransform: 'uppercase', padding: '5px 12px', borderRadius: 6, marginBottom: 16,
                }}>
                  {a.tag}
                </span>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.1rem', color: K.ink, margin: '0 0 10px' }}>{a.titulo}</h3>
                <p style={{ fontSize: '.9rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TABLA COMPARATIVA */}
      <section id="form" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', overflowX: 'auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 32px' }}>
            ¿Qué incluye cada plan?
          </h2>
          <div style={{ minWidth: 560 }}>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 0, marginBottom: 8 }}>
              {COMPARISON.cols.map((col, i) => (
                <div key={col} style={{
                  padding: '10px 14px', fontWeight: 800, fontSize: '.82rem',
                  textTransform: 'uppercase', letterSpacing: '.6px',
                  color: i === 0 ? K.muted : (i === 3 ? K.teal : i === 2 ? K.coral : K.ink),
                  textAlign: i > 0 ? 'center' : 'left',
                }}>
                  {col}
                </div>
              ))}
            </div>
            {COMPARISON.rows.map((row, idx) => (
              <div key={row.feat} style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 0,
                background: idx % 2 === 0 ? K.paper : '#fff',
                borderRadius: 6, marginBottom: 2,
              }}>
                <div style={{ padding: '11px 14px', fontSize: '.9rem', color: K.ink, fontWeight: row.feat === 'Precio' ? 700 : 400 }}>{row.feat}</div>
                <div style={{ padding: '11px 14px', textAlign: 'center', fontSize: '.9rem', color: row.free === '✓' ? K.teal : K.muted, fontWeight: row.free === '✓' ? 800 : 400 }}>{row.free}</div>
                <div style={{ padding: '11px 14px', textAlign: 'center', fontSize: '.9rem', color: row.hot === '✓' ? K.teal : row.hot === '—' ? K.muted : K.coral, fontWeight: row.hot === '—' ? 400 : 700 }}>{row.hot}</div>
                <div style={{ padding: '11px 14px', textAlign: 'center', fontSize: '.9rem', color: row.featured === '✓' ? K.teal : row.featured === '—' ? K.muted : K.teal, fontWeight: row.featured === '—' ? 400 : 700 }}>{row.featured}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CATEGORÍAS ELEGIBLES */}
      <section style={{ padding: '0 26px 72px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.5rem,3vw,2rem)', color: K.ink, margin: '0 0 14px' }}>
            Categorías disponibles
          </h2>
          <p style={{ color: K.muted, fontSize: '1rem', maxWidth: 600, margin: '0 0 32px' }}>
            Un solo cupo por categoría en cada barrio. Cuando el cupo de tu categoría se llena, cierra.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {ELIGIBILITY.map(e => (
              <div key={e.cat} style={{ background: '#fff', borderRadius: 12, padding: '22px 20px', border: `1px solid ${K.line}` }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{e.ico}</div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1rem', color: K.ink, margin: '0 0 6px' }}>{e.cat}</h4>
                <p style={{ fontSize: '.85rem', color: K.muted, lineHeight: 1.4, margin: 0 }}>{e.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CÓMO FUNCIONA ONBOARDING */}
      <section style={{ padding: '0 26px 72px', background: '#fff', borderTop: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}`, paddingTop: 72 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Cómo funciona el proceso
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 600, margin: '0 0 40px' }}>
            Del formulario a publicado en 48 horas. Sin burocracia.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 22 }}>
            {ONBOARDING.map(step => (
              <div key={step.n} style={{
                background: K.paper, borderRadius: 12, padding: '24px 20px',
                position: 'relative', borderLeft: `4px solid ${K.teal}`,
              }}>
                <div style={{
                  position: 'absolute', top: -14, left: 20,
                  background: K.ink, color: '#fff', width: 28, height: 28,
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '.82rem',
                }}>
                  {step.n}
                </div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1rem', color: K.ink, margin: '6px 0 8px' }}>{step.titulo}</h4>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FORMULARIO */}
      <section id="aplicar" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '48px 40px',
            border: `1px solid ${K.line}`, boxShadow: '0 8px 32px rgba(20,32,29,.07)',
          }}>
            {success ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 12px' }}>
                  ¡Recibimos tu aplicación!
                </h2>
                <p style={{ color: K.muted, lineHeight: 1.6 }}>
                  Te contactamos en menos de 24 horas para coordinar los detalles de tu presencia en Medellín Social.
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 8px', textAlign: 'center' }}>
                  {plan === 'featured' ? 'Reservar mi categoría' : 'Publicar una oferta'}
                </h2>
                <p style={{ color: K.muted, fontSize: '.96rem', textAlign: 'center', marginBottom: 32 }}>
                  Plan seleccionado: <strong style={{ color: plan === 'featured' ? K.teal : K.coral }}>{plan === 'featured' ? 'Featured Business' : 'Hotspot / Oferta especial'}</strong>
                </p>

                <form onSubmit={handleSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Nombre del negocio</label>
                      <input required value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)} placeholder="ej. Café Pergamino" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Tu nombre</label>
                      <input required value={tuNombre} onChange={e => setTuNombre(e.target.value)} placeholder="Nombre y apellido" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>WhatsApp</label>
                      <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+57 310…" style={inputStyle} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Email</label>
                      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Categoría</label>
                      <select required value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">Categoría…</option>
                        {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Barrio</label>
                      <select value={barrioId ?? ''} onChange={e => setBarrioId(e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">Selecciona…</option>
                        {BARRIOS.filter(b => b.barrio_id !== null).map(b => (
                          <option key={b.slug} value={b.barrio_id!}>{b.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Plan que te interesa</label>
                      <select value={plan} onChange={e => setPlan(e.target.value as Plan)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="featured">Featured Business — $199 USD lanzamiento (recomendado)</option>
                        <option value="hotspot">Hotspot / Oferta especial — desde $29 USD</option>
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Cuéntanos sobre tu negocio (opcional)</label>
                      <textarea
                        value={mensaje} onChange={e => setMensaje(e.target.value)}
                        placeholder="¿Qué ofreces? ¿Qué hace especial a tu negocio? ¿Alguna pregunta?"
                        rows={3}
                        style={{ ...inputStyle, resize: 'vertical' }}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', marginTop: 8 }}>
                      {error && <p style={{ color: K.coral, fontSize: '.88rem', marginBottom: 12 }}>{error}</p>}
                      <button
                        type="submit" disabled={loading}
                        style={{
                          background: loading ? K.muted : K.coral, color: '#fff',
                          border: 'none', fontWeight: 800, padding: '18px 48px',
                          borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
                          fontSize: '1.05rem', fontFamily: 'inherit',
                        }}
                      >
                        {loading ? 'Enviando…' : 'Enviar aplicación →'}
                      </button>
                      <p style={{ fontSize: '.78rem', color: K.muted, margin: '12px 0 0' }}>
                        Revisamos cada aplicación personalmente y respondemos en menos de 24 horas.
                      </p>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </section>

    </ComunidadLayout>
  )
}
