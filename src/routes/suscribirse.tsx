import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { API_BASE_URL } from '@/config/api'
import { BARRIOS } from '@/components/comunidad/BarrioContext'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { useIsMobile } from '@/hooks/use-mobile'
import { K as TOKENS } from "@/design/tokens";
import { Wordmark } from "@/components/Wordmark";

export const Route = createFileRoute('/suscribirse')({
  component: SuscribirsePage,
  head: () => seo({ title: "Suscríbete · Medellín Social", description: "Recibe el boletín de tu barrio: nuevos inmuebles, eventos y noticias.", path: "/suscribirse" }),
})

const K = TOKENS;

const INTERESES = [
  { value: 'deals', label: 'Deals y ofertas locales' },
  { value: 'eventos', label: 'Eventos y planes' },
  { value: 'inmuebles', label: 'Inmuebles / inversión' },
  { value: 'negocios', label: 'Negocios y servicios' },
  { value: 'historias', label: 'Publicar mis historias' },
]

const BENEFICIOS = [
  { ico: '🎟️', titulo: 'Deals exclusivos', desc: 'Ofertas flash de los mejores negocios de tu barrio — solo para suscriptores' },
  { ico: '📅', titulo: 'Eventos curados', desc: 'Los mejores planes de Medellín filtrados por tu barrio e intereses' },
  { ico: '📰', titulo: 'Newsletter semanal', desc: 'Cada viernes: lo que pasó, lo que viene y lo que no te puedes perder' },
  { ico: '🏘️', titulo: 'Historia de barrio', desc: 'Las historias que nadie más cuenta — desde adentro del barrio' },
  { ico: '🏠', titulo: 'Inmuebles & FSBO', desc: 'Propiedades en venta y arriendo directas, sin intermediarios' },
  { ico: '🍽️', titulo: 'Restaurantes locales', desc: 'Los mejores lugares para comer, con reseñas reales de vecinos' },
  { ico: '📸', titulo: 'Redes sociales', desc: 'Contenido del barrio en Instagram, Facebook y TikTok' },
  { ico: '✍️', titulo: 'Publica tu historia', desc: '¿Tienes algo que contar? Aplica para publicar en el blog de tu barrio' },
]

const PASOS = [
  { n: 1, titulo: 'Crea tu cuenta gratis', desc: 'Nombre, email y el barrio que más te importa. 30 segundos.' },
  { n: 2, titulo: 'Elige tus intereses', desc: 'Deals, eventos, inmuebles, negocios. Personalizamos tu feed.' },
  { n: 3, titulo: 'Recibe el newsletter', desc: 'Cada viernes a las 9 AM: lo mejor de tu barrio en tu bandeja.' },
  { n: 4, titulo: 'Conéctate con la comunidad', desc: 'Accede a deals exclusivos, publica tu historia y mucho más.' },
]

const PUBLISH_CATS = [
  'Restaurantes y cafés', 'Bares y vida nocturna', 'Spas y bienestar',
  'Negocios locales', 'Eventos y planes', 'Inmuebles',
]

const NEWSLETTER_ROWS = [
  { ico: '📅', text: 'Rumba en Parque Lleras · Este sábado' },
  { ico: '🏠', text: 'Apto en El Poblado — directo, sin comisión' },
  { ico: '🍕', text: 'Pizza Night especial · El Barril' },
  { ico: '💼', text: 'Vacante: Community Manager · Envigado' },
]

function SuscribirsePage() {
  const isMobile = useIsMobile()
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [barrioId, setBarrioId] = useState<number | null>(null)
  const [interes, setInteres] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/usuario/suscribirse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          apellido,
          email,
          barrio_id: barrioId,
          intereses: interes || null,
          newsletter_activo: true,
        }),
      })
      if (!res.ok) throw new Error('Error al suscribirte')
      setSuccess(true)
    } catch {
      setError('Algo salió mal. Intenta de nuevo.')
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
        <a href="#beneficios" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Beneficios</a>
        <a href="#como-funciona" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Cómo funciona</a>
        <a href="#form" style={{
          marginLeft: 'auto', background: K.coral, color: '#fff', fontWeight: 700,
          padding: '6px 16px', borderRadius: 8, fontSize: '.85rem', textDecoration: 'none',
        }}>Suscribirme →</a>
      </div>
    </div>
  )

  return (
    <ComunidadLayout subNav={subNav}>

      {/* HERO */}
      <section style={{
        background: `radial-gradient(circle at 15% 20%, rgba(29,158,117,0.08), transparent 55%),
          radial-gradient(circle at 85% 80%, rgba(216,90,48,0.07), transparent 55%),
          linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
        padding: '72px 26px 56px', borderBottom: `1px solid ${K.line}`,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.15fr 1fr', gap: isMobile ? 32 : 56, alignItems: 'center' }}>
          <div>
            <span style={{
              display: 'inline-block', background: `rgba(216,90,48,0.12)`, color: K.coral,
              padding: '6px 14px', borderRadius: 999, fontWeight: 700, fontSize: '.75rem',
              letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 18,
            }}>
              Gratis para siempre · Sin spam
            </span>
            <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2.2rem,5vw,3.4rem)', color: K.ink, margin: '0 0 18px', lineHeight: 1.05, letterSpacing: '-1px' }}>
              Tu ciudad. Tu barrio.<br />
              <span style={{ color: K.coral }}>Todo en un lugar.</span>
            </h1>
            <p style={{ fontSize: '1.1rem', color: K.muted, margin: '0 0 30px', lineHeight: 1.6, maxWidth: 560 }}>
              Únete gratis a Medellín Social. Deals exclusivos, eventos curados, negocios verificados y las historias de tu barrio — directo a tu bandeja, cada viernes.
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <a href="#form" style={{
                background: K.coral, color: '#fff', fontWeight: 700, fontSize: '1rem',
                padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
                boxShadow: '0 8px 24px rgba(216,90,48,.28)',
              }}>
                Suscribirme gratis →
              </a>
              <a href="#beneficios" style={{
                background: '#fff', color: K.ink, fontWeight: 700, fontSize: '1rem',
                padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
                border: `2px solid ${K.ink}`,
              }}>
                Ver beneficios
              </a>
            </div>
            <p style={{ fontSize: '.85rem', color: K.muted, margin: 0 }}>
              <strong style={{ color: K.ink }}>+1,200 vecinos</strong> ya reciben el newsletter · Sin tarjeta de crédito · Cancela cuando quieras
            </p>
          </div>

          {/* Newsletter preview card */}
          <div style={{
            background: '#fff', borderRadius: 16, padding: 24,
            border: `1px solid ${K.line}`, boxShadow: '0 8px 30px rgba(20,32,29,.08)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${K.line}`,
            }}>
              <div>
                <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1rem', color: K.ink }}>
                  <Wordmark />
                </div>
                <div style={{ fontSize: '.75rem', color: K.muted, marginTop: 2 }}>Newsletter del Barrio · Viernes 9 AM</div>
              </div>
              <span style={{ background: K.amarillo, color: K.ink, fontWeight: 800, fontSize: '.65rem', padding: '4px 8px', borderRadius: 4, letterSpacing: '.5px' }}>
                SEMANAL
              </span>
            </div>

            {/* Deal Flash */}
            <div style={{ background: K.coralLight, borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: '.7rem', fontWeight: 800, color: K.coral, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
                🔥 Deal Flash · Solo hoy
              </div>
              <div style={{ fontWeight: 700, color: K.ink, fontSize: '.95rem' }}>Café Pergamino — 2×1 en lattes</div>
              <div style={{ fontSize: '.8rem', color: K.muted, marginTop: 2 }}>El Poblado · Válido hasta las 6 PM</div>
            </div>

            {/* Rows */}
            {NEWSLETTER_ROWS.map(row => (
              <div key={row.text} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', background: K.surface, borderRadius: 8, marginBottom: 8,
              }}>
                <span style={{ fontSize: 18 }}>{row.ico}</span>
                <span style={{ fontSize: '.85rem', color: K.ink }}>{row.text}</span>
              </div>
            ))}

            <div style={{ marginTop: 16, textAlign: 'center', fontSize: '.75rem', color: K.muted }}>
              Y mucho más en tu próxima edición →
            </div>
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section id="beneficios" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Todo lo que obtienes, gratis
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 700, margin: '0 0 40px' }}>
            Medellín Social es la plaza digital de tu barrio. Aquí vive todo lo que importa — en un solo lugar.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
            {BENEFICIOS.map(b => (
              <div key={b.titulo} style={{ background: '#fff', border: `1px solid ${K.line}`, borderRadius: 12, padding: '26px 22px' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10, marginBottom: 14,
                  background: `linear-gradient(135deg, ${K.teal}, ${K.tealDeep})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  {b.ico}
                </div>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.05rem', color: K.ink, margin: '0 0 8px' }}>
                  {b.titulo}
                </h3>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PUBLICA TU NEGOCIO — dark CTA band */}
      <section style={{ background: K.ink, padding: '64px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 32 : 56, alignItems: 'center' }}>
          <div>
            <span style={{
              display: 'inline-block', background: K.amarillo, color: K.ink,
              fontWeight: 800, fontSize: '.72rem', letterSpacing: '1.2px',
              textTransform: 'uppercase', padding: '5px 12px', borderRadius: 999, marginBottom: 20,
            }}>
              Para negocios locales
            </span>
            <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3vw,2.1rem)', color: '#fff', margin: '0 0 16px', lineHeight: 1.1 }}>
              ¿Tienes un negocio en Medellín?
            </h2>
            <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '1rem', lineHeight: 1.6, margin: '0 0 28px', maxWidth: 440 }}>
              Llega a miles de vecinos de tu barrio. Un solo negocio por categoría — cuando tus vecinos buscan el mejor restaurante, spa o servicio, <strong style={{ color: '#fff' }}>tú eres la respuesta.</strong>
            </p>
            <a href="/negocios/unirse" style={{
              display: 'inline-block', background: K.coral, color: '#fff',
              fontWeight: 700, fontSize: '.96rem', padding: '14px 26px',
              borderRadius: 10, textDecoration: 'none',
            }}>
              Lista tu negocio →
            </a>
          </div>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {PUBLISH_CATS.map(cat => (
                <div key={cat} style={{
                  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
                  borderRadius: 8, padding: '14px 16px',
                }}>
                  <span style={{ fontSize: '.88rem', color: 'rgba(255,255,255,.85)', fontWeight: 600 }}>{cat}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section id="como-funciona" style={{ padding: '72px 26px', background: '#fff', borderTop: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Cómo funciona
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 600, margin: '0 0 40px' }}>
            Cuatro pasos y ya estás dentro de la comunidad digital de tu barrio.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 22 }}>
            {PASOS.map(p => (
              <div key={p.n} style={{ background: K.paper, borderRadius: 12, padding: '24px 20px', position: 'relative', border: `1px solid ${K.line}` }}>
                <div style={{
                  position: 'absolute', top: -16, left: 20,
                  background: K.ink, color: '#fff', width: 32, height: 32,
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '.88rem',
                }}>
                  {p.n}
                </div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.05rem', color: K.ink, margin: '6px 0 8px' }}>{p.titulo}</h4>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FORM */}
      <section id="form" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '48px 40px',
            border: `1px solid ${K.line}`, boxShadow: '0 8px 32px rgba(20,32,29,.07)',
          }}>
            {success ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 12px' }}>
                  ¡Estás dentro!
                </h2>
                <p style={{ color: K.muted, lineHeight: 1.6, marginBottom: 24 }}>
                  Bienvenido a Medellín Social. Revisa tu correo — cada viernes recibirás lo mejor de tu barrio.
                </p>
                <a href="/" style={{
                  display: 'inline-block', background: K.coral, color: '#fff',
                  fontWeight: 800, padding: '13px 28px', borderRadius: 10,
                  textDecoration: 'none', fontSize: '.96rem',
                }}>
                  Ir al inicio →
                </a>
              </div>
            ) : (
              <>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 8px', textAlign: 'center' }}>
                  Suscribirme gratis
                </h2>
                <p style={{ color: K.muted, fontSize: '.96rem', textAlign: 'center', marginBottom: 32 }}>
                  30 segundos · Sin tarjeta · Sin spam
                </p>
                <form onSubmit={handleSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    <div>
                      <label style={labelStyle}>Nombre</label>
                      <input required value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Apellido</label>
                      <input value={apellido} onChange={e => setApellido(e.target.value)} placeholder="Tu apellido" style={inputStyle} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Correo electrónico</label>
                      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Tu barrio</label>
                      <select value={barrioId ?? ''} onChange={e => setBarrioId(e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">Selecciona tu barrio…</option>
                        {BARRIOS.filter(b => b.barrio_id !== null).map(b => (
                          <option key={b.slug} value={b.barrio_id!}>{b.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>¿Qué te interesa más?</label>
                      <select value={interes} onChange={e => setInteres(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">Elige una opción…</option>
                        {INTERESES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                      </select>
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
                          boxShadow: loading ? 'none' : '0 8px 24px rgba(216,90,48,.28)',
                        }}
                      >
                        {loading ? 'Registrando…' : 'Suscribirme gratis →'}
                      </button>
                      <p style={{ fontSize: '.78rem', color: K.muted, textAlign: 'center', margin: '12px 0 0' }}>
                        Gratis para siempre · Sin spam · Cancela cuando quieras
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
