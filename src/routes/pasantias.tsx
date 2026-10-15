import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { API_BASE_URL } from '@/config/api'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/pasantias')({
  component: PasantiasPage,
  head: () => seo({ title: "Pasantías · Medellín Social", description: "Pasantías en datos, real estate y comunidad en Medellín Social.", path: "/pasantias" }),
})

const K = TOKENS;

const STATS = [
  { n: '100%', l: 'Empresa internacional' },
  { n: 'IA', l: 'Stack de tecnología emergente' },
  { n: 'EN/ES', l: 'Entorno bilingüe' },
]

const WHY_ITEMS = [
  { ico: '🌎', titulo: 'Una empresa internacional', desc: 'Trabajas directo con EASE, empresa de Estados Unidos que opera en Medellín como Medellín Social, con los mismos estándares en los dos países.' },
  { ico: '🤖', titulo: 'IA y tecnología emergente', desc: 'Motor de contenido, automatización, CRM y video, todos con inteligencia artificial. El kit de tecnología emergente, no teoría.' },
  { ico: '📰', titulo: 'La industria de medios', desc: 'Produces contenido para una plataforma de medios local en vivo, periodismo, redes y video con tu nombre.' },
  { ico: '🎓', titulo: 'Portafolio y ventaja bilingüe', desc: 'Te gradúas con trabajo publicado, resultados medibles y experiencia en inglés que los empleadores buscan.' },
]

const TRACKS = [
  {
    value: 'media', rol: 'Medios / Comunicación / Periodismo',
    titulo: 'Creador de Medios y Contenido con IA',
    items: [
      'Escribir, grabar y publicar historias locales y un boletín semanal',
      'Usar avatares de video con IA y el motor de contenido para producir medios de calidad de estudio',
      'Hacer crecer audiencias en TikTok, Instagram, YouTube y Facebook',
    ],
    tags: ['IA', 'Video', 'Narrativa'],
  },
  {
    value: 'growth', rol: 'Mercadeo / Negocios / Ingeniería',
    titulo: 'Crecimiento y Tecnología de Marketing con IA',
    items: [
      'Construir automatizaciones y cadencias en un CRM de marca privada (GoHighLevel)',
      'Ejecutar campañas y analizar el desempeño para negocios locales',
      'Trabajar con herramientas de IA y automatización no-code (Make.com)',
    ],
    tags: ['CRM', 'Automatización', 'Analítica'],
  },
  {
    value: 'bizdev', rol: 'Negocios / Negocios Internacionales',
    titulo: 'Comunidad y Desarrollo de Negocios',
    items: [
      'Ayudar a negocios locales a ser encontrados en línea y unirse a la plataforma',
      'Hacer crecer la comunidad de suscriptores con eventos y programas',
      'Practicar comunicación bilingüe de cara al cliente con un equipo global',
    ],
    tags: ['Ventas', 'Bilingüe', 'Comunidad'],
  },
]

const TAKEAWAYS = [
  { ico: '📁', titulo: 'Portafolio publicado', desc: 'Trabajo con tu firma y resultados medibles que puedes mostrar a cualquier empleador.' },
  { ico: '⚙️', titulo: 'Habilidades en tecnología emergente', desc: 'Dominio práctico de herramientas de IA, automatización y producción de contenido moderna.' },
  { ico: '🤝', titulo: 'Referencia internacional', desc: 'Una recomendación y experiencia con una empresa de EE. UU. en tu hoja de vida.' },
]

const PASOS = [
  { n: 1, titulo: 'Aplica aquí', desc: 'Envía el formulario con tu programa de EAFIT, semestre y ruta de interés.' },
  { n: 2, titulo: 'Entrevista', desc: 'Una breve conversación bilingüe sobre tus metas y fortalezas.' },
  { n: 3, titulo: 'Incorpórate', desc: 'Certifícate en la plataforma y el kit de IA, alineado con los requisitos de tu práctica.' },
  { n: 4, titulo: 'Construye y gradúate', desc: 'Entrega proyectos, construye tu portafolio y termina con experiencia que se destaca.' },
]

function PasantiasPage() {
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [programaSemestre, setProgramaSemestre] = useState('')
  const [rutaInteres, setRutaInteres] = useState('media')
  const [mensaje, setMensaje] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/pasantias/aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: `${nombre} ${apellido}`.trim(),
          email,
          telefono,
          programa_semestre: programaSemestre,
          ruta_interes: rutaInteres,
          mensaje,
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
        <a href="#por-que" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Por qué esta práctica</a>
        <a href="#rutas" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Rutas</a>
        <a href="#como-aplicar" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Cómo aplicar</a>
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
        background: `radial-gradient(circle at 12% 20%, rgba(255,201,40,.10), transparent 55%),
          radial-gradient(circle at 88% 80%, rgba(29,158,117,.10), transparent 55%),
          linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
        padding: '72px 26px 56px', textAlign: 'center', borderBottom: `1px solid ${K.line}`,
      }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <span style={{
            display: 'inline-block', background: `rgba(29,158,117,.12)`, color: K.tealDeep,
            padding: '6px 14px', borderRadius: 999, fontWeight: 700, fontSize: '.75rem',
            letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 18,
          }}>
            Práctica EAFIT · IA y tecnología emergente · Medios
          </span>
          <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2.2rem,5vw,3.4rem)', color: K.ink, margin: '0 0 18px', lineHeight: 1.05, letterSpacing: '-1px' }}>
            Haz tu práctica en una <span style={{ color: K.teal }}>empresa internacional</span>, sin salir de Medellín.
          </h1>
          <p style={{ fontSize: '1.05rem', color: K.muted, margin: '0 auto 30px', lineHeight: 1.6, maxWidth: 640 }}>
            Medellín Social es la marca local de EASE, una empresa de Estados Unidos que construye plataformas de medios locales con inteligencia artificial. Abrimos prácticas para estudiantes de EAFIT que quieren experiencia práctica en inteligencia artificial, tecnología emergente y la industria de medios.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 34 }}>
            <a href="#aplicar" style={{
              background: K.teal, color: '#fff', fontWeight: 700, fontSize: '1rem',
              padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
              boxShadow: '0 8px 24px rgba(29,158,117,.28)',
            }}>
              Aplica a una práctica →
            </a>
            <a href="#por-que" style={{
              background: '#fff', color: K.ink, fontWeight: 700, fontSize: '1rem',
              padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
              border: `2px solid ${K.ink}`,
            }}>
              Ver el programa
            </a>
          </div>
          <div style={{ display: 'flex', gap: 30, justifyContent: 'center', flexWrap: 'wrap' }}>
            {STATS.map(s => (
              <div key={s.l} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.teal }}>{s.n}</div>
                <div style={{ fontSize: '.78rem', color: K.muted }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* POR QUÉ */}
      <section id="por-que" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Por qué esta práctica
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 660, margin: '0 0 40px' }}>
            Una práctica oficial diseñada para encajar en las prácticas de EAFIT, construida alrededor de las habilidades que el futuro del trabajo recompensa.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {WHY_ITEMS.map(w => (
              <div key={w.titulo} style={{
                background: '#fff', borderRadius: 12, padding: '26px 22px',
                borderTop: `4px solid ${K.teal}`, boxShadow: '0 4px 16px rgba(20,32,29,.06)',
              }}>
                <div style={{ fontSize: 26, marginBottom: 14 }}>{w.ico}</div>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.05rem', color: K.ink, margin: '0 0 10px' }}>{w.titulo}</h3>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RUTAS: banda oscura */}
      <section id="rutas" style={{ background: `linear-gradient(135deg, ${K.ink} 0%, #2A302C 100%)`, padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: '#fff', margin: '0 0 14px' }}>
            Rutas de práctica
          </h2>
          <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '1.05rem', maxWidth: 640, margin: '0 0 40px' }}>
            Elige la ruta que encaje con tu programa. Cada una es mentorizada, basada en proyectos y cuenta como práctica académica válida.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {TRACKS.map(t => (
              <div key={t.titulo} style={{
                background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 12, padding: '26px 22px', borderTop: `4px solid ${K.amarillo}`,
              }}>
                <div style={{ fontSize: '.7rem', fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: K.amarillo, marginBottom: 10 }}>
                  {t.rol}
                </div>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, color: '#fff', fontSize: '1.15rem', margin: '0 0 14px' }}>{t.titulo}</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
                  {t.items.map(item => (
                    <li key={item} style={{ padding: '5px 0 5px 22px', position: 'relative', color: 'rgba(255,255,255,.82)', fontSize: '.85rem' }}>
                      <span style={{ position: 'absolute', left: 0, color: K.teal, fontWeight: 800 }}>→</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {t.tags.map(tag => (
                    <span key={tag} style={{
                      background: 'rgba(255,255,255,.1)', color: '#fff', fontSize: '.72rem',
                      fontWeight: 700, padding: '4px 12px', borderRadius: 999,
                    }}>{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QUÉ TE LLEVAS */}
      <section style={{ padding: '72px 26px', background: '#fff', borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Lo que te llevarás
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
            {TAKEAWAYS.map(t => (
              <div key={t.titulo} style={{ background: K.surface, borderRadius: 12, padding: '24px 20px', border: `1px solid ${K.line}` }}>
                <div style={{ fontSize: 26, marginBottom: 12 }}>{t.ico}</div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1rem', color: K.ink, margin: '0 0 8px' }}>{t.titulo}</h4>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CÓMO APLICAR */}
      <section id="como-aplicar" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Cómo aplicar
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            {PASOS.map(s => (
              <div key={s.n} style={{
                background: '#fff', borderRadius: 12, padding: '24px 20px', position: 'relative',
                borderLeft: `4px solid ${K.teal}`, boxShadow: '0 4px 16px rgba(20,32,29,.06)',
              }}>
                <div style={{
                  position: 'absolute', top: -14, left: 18,
                  background: K.ink, color: '#fff', width: 28, height: 28,
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '.82rem',
                }}>
                  {s.n}
                </div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1rem', color: K.ink, margin: '6px 0 8px' }}>{s.titulo}</h4>
                <p style={{ fontSize: '.85rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FORMULARIO */}
      <section id="aplicar" style={{ padding: '0 26px 80px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{
            background: `linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
            borderRadius: 16, padding: '48px 40px',
            border: `1px solid ${K.line}`, boxShadow: '0 8px 32px rgba(20,32,29,.07)',
          }}>
            {success ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎓</div>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 12px' }}>
                  ¡Recibimos tu aplicación!
                </h2>
                <p style={{ color: K.muted, lineHeight: 1.6 }}>
                  Revisamos cada aplicación personalmente. Te contactamos en menos de 48 horas.
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 8px', textAlign: 'center' }}>
                  Aplica a una Práctica EAFIT
                </h2>
                <p style={{ color: K.muted, fontSize: '.96rem', textAlign: 'center', marginBottom: 32 }}>
                  Abierto a estudiantes de EAFIT listos para una experiencia internacional en inteligencia artificial y medios.
                </p>

                <form onSubmit={handleSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={labelStyle}>Nombre</label>
                      <input required value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Apellido</label>
                      <input required value={apellido} onChange={e => setApellido(e.target.value)} placeholder="Tu apellido" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>WhatsApp</label>
                      <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+57 310…" style={inputStyle} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Programa EAFIT y semestre</label>
                      <input
                        required value={programaSemestre} onChange={e => setProgramaSemestre(e.target.value)}
                        placeholder="ej., Comunicación, 8º semestre" style={inputStyle}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Ruta de interés</label>
                      <select required value={rutaInteres} onChange={e => setRutaInteres(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        {TRACKS.map(t => <option key={t.value} value={t.value}>{t.titulo}</option>)}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>¿Por qué tú? (nivel de inglés, portafolio, intereses)</label>
                      <textarea
                        value={mensaje} onChange={e => setMensaje(e.target.value)}
                        placeholder="Cuéntanos sobre tus habilidades, nivel de inglés y qué te emociona"
                        rows={4} style={{ ...inputStyle, resize: 'vertical' }}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', marginTop: 8 }}>
                      {error && <p style={{ color: K.coral, fontSize: '.88rem', marginBottom: 12 }}>{error}</p>}
                      <button
                        type="submit" disabled={loading}
                        style={{
                          background: loading ? K.muted : K.teal, color: '#fff',
                          border: 'none', fontWeight: 800, padding: '18px 48px',
                          borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
                          fontSize: '1.05rem', fontFamily: 'inherit',
                          boxShadow: loading ? 'none' : '0 8px 24px rgba(29,158,117,.28)',
                        }}
                      >
                        {loading ? 'Enviando…' : 'Enviar solicitud →'}
                      </button>
                      <p style={{ fontSize: '.78rem', color: K.muted, margin: '12px 0 0' }}>
                        Medellín Social es operada por EASE Association (EE. UU.). Las oportunidades siguen las directrices de práctica de cada programa.
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
