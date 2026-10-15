import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { API_BASE_URL } from '@/config/api'
import { BARRIOS } from '@/components/comunidad/BarrioContext'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { useIsMobile } from '@/hooks/use-mobile'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/embajador')({
  component: EmbajadorPage,
  head: () => seo({ title: "Sé Embajador de Barrio · Medellín Social", description: "Sé la voz de tu barrio en Medellín. Conecta negocios y gana comisión recurrente hasta 24 meses.", path: "/embajador" }),
})

const K = TOKENS;

const DUTIES = [
  { titulo: 'Curar y publicar contenido semanal', desc: 'Historias locales, eventos, novedades del barrio. Usas el Motor de Contenido IA para redactar — tú aportas la voz editorial y el juicio local.' },
  { titulo: 'Gestionar el newsletter semanal', desc: 'Cada viernes a las 9 AM. Resumen de contenido, eventos, deals y novedades del barrio. Casi automatizado — tú haces la revisión final.' },
  { titulo: 'Conectar negocios con la plataforma', desc: 'Incorporas nuevos Featured Businesses, revisas su contenido, apruebas antes de publicar y envías reportes. Eres el gestor de relaciones.' },
  { titulo: 'Distribuir en redes sociales', desc: 'Instagram y Facebook como principales. El planificador social hace la programación — tú escribes los captions y eliges los ángulos.' },
  { titulo: 'Crecer la base de suscriptores', desc: 'Visible en eventos locales, cámaras de comercio, grupos de Facebook. Trabajo comunitario real apoyado por herramientas digitales.' },
  { titulo: 'Ser el referente local de Medellín Social', desc: 'Tu cara, tu voz, tu barrio en el mapa digital. Conectas Colaboradores entre sí y eres el conector que tu comunidad necesitaba.' },
]

const TOOLS = [
  { nm: 'Motor de Contenido IA', ds: 'Un formulario genera artículo completo + post social. Tú editas, apruebas y publicas.' },
  { nm: 'CRM de Embajadores', ds: 'Pipeline de suscriptores, portal de negocios, planificador social, automatización de email y WhatsApp.' },
  { nm: 'Avatar IA en Vivo', ds: 'Conserje digital de tu comunidad que atiende preguntas de vecinos en tiempo real.' },
  { nm: 'EVVNT & Google Places', ds: 'Eventos del barrio se agregan automáticamente. El directorio se llena solo. Tú curas, no capturas datos.' },
  { nm: 'Newsletter automatizado', ds: 'RSS-driven semanal. Tú apruebas. Sale. Las tasas de apertura llegan a tu dashboard.' },
  { nm: 'App móvil del barrio', ds: 'Tus suscriptores participan desde su cel. Notificaciones, contenido y deals en la palma.' },
  { nm: 'Apoyo de ventas', ds: 'El equipo central más los Afiliados manejan el outbound. Tú te enfocas en contenido y comunidad.' },
  { nm: 'Soporte operativo', ds: 'Toda la configuración técnica, automatizaciones e integraciones las manejamos nosotros centralmente.' },
]

const PERKS = [
  { ico: '$', titulo: 'Comisión pagada — ~$270M COP el Año 1', desc: '50% primer mes + 15% recurrente (24 meses, luego 7.5%) sobre clientes que inscribas directo. 5% residual (24 meses, luego 2.5%) del resto de negocios en tu barrio — nunca se suman en la misma cuenta. Mes 12: ~$44M COP/mes.' },
  { ico: '★', titulo: 'Reconocimiento en tu comunidad', desc: 'Te conviertes en la voz reconocida de tu barrio. Los negocios, líderes cívicos y vecinos te conocen por nombre.' },
  { ico: '📚', titulo: 'Capacitación editorial real', desc: 'Experiencia práctica con IA, SEO, AEO, MEO, distribución social y CRM. Habilidades que se acumulan.' },
  { ico: '🤝', titulo: 'Una red que puedes usar', desc: 'Relaciones directas con negocios Featured, cámaras, organizaciones y líderes cívicos — redes que pagan por años.' },
  { ico: '📈', titulo: 'Un camino de crecimiento', desc: 'Los mejores Embajadores ascienden a roles de Líder Comunitario supervisando varios barrios.' },
  { ico: '🏡', titulo: 'Flexibilidad', desc: 'Mayormente remoto con presencia local en eventos. El newsletter del viernes y la cadencia social son los puntos fijos.' },
]

const WHO = [
  { titulo: 'Vives aquí', desc: 'O tienes vínculos profundos. Conoces los barrios, los negocios, las historias. Entras al restaurante local y alguien te saluda.' },
  { titulo: 'Sabes escribir con claridad', desc: 'La IA hace el borrador. Tú aportas la voz local, el criterio editorial, la calidez humana.' },
  { titulo: 'Te gusta la gente', desc: 'Este rol es muy relacional. Featured Businesses, líderes cívicos, organizadores de eventos. Si prefieres solo todo el día, no es para ti.' },
  { titulo: 'Eres confiable', desc: 'El newsletter sale cada viernes. La revisión del contenido se hace a tiempo. No tienes que ser rápido — tienes que ser consistente.' },
  { titulo: 'Ves la plataforma', desc: 'Esto no es un pasatiempo. Ves a Medellín Social convirtiéndose en la plaza digital de tu barrio y quieres liderar eso.' },
  { titulo: 'Bonus: experiencia relevante', desc: 'Encaje fuerte si has trabajado en cámara de comercio, medios locales, inmuebles, organizaciones sin fines de lucro o asociaciones de barrio.' },
]

const WEEK = [
  { day: 'LUN', titulo: 'Planificación editorial', desc: 'Revisa lo que llega de los negocios. Planea los artículos de la semana. Revisa el feed de eventos.' },
  { day: 'MAR', titulo: 'Contenido + alcance', desc: 'Redacta y aprueba artículos con el Motor de IA. Incorpora nuevos Featured. Haz seguimiento con uno o dos.' },
  { day: 'MIÉ', titulo: 'Redes + comunidad', desc: 'Captions para el plan social de la semana. Moderación ligera. Quizás un evento o reunión de cámara.' },
  { day: 'JUE', titulo: 'Armar el newsletter', desc: 'Revisión final del viernes. Curar las mejores historias, deals y eventos. Aprobar el envío.' },
  { day: 'VIE', titulo: 'Sale el newsletter · 9 AM', desc: 'Sale el boletín. Revisión rápida post-envío. Tarde tranquila. Bienvenido al fin de semana.' },
]

const KPIS = [
  { l: 'Crecimiento suscriptores', v: '+5–10% / mes' },
  { l: 'Apertura newsletter', v: 'meta 35%+' },
  { l: 'Cadencia de contenido', v: '3–5 / semana' },
  { l: 'Retención de negocios', v: '90%+ anual' },
  { l: 'Actividad de negocios', v: '1+ pieza / mes' },
]

function EmbajadorPage() {
  const isMobile = useIsMobile()
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [barrioId, setBarrioId] = useState<number | null>(null)
  const [experiencia, setExperiencia] = useState('')
  const [motivacion, setMotivacion] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/embajadores/aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: `${nombre} ${apellido}`.trim(),
          email,
          telefono,
          barrio_id: barrioId,
          experiencia,
          motivacion,
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
        <a href="#que-haras" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Qué harás</a>
        <a href="#que-obtienes" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Qué obtienes</a>
        <a href="#herramientas" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Herramientas</a>
        <a href="#aplicar" style={{
          marginLeft: 'auto', background: K.coral, color: '#fff', fontWeight: 700,
          padding: '6px 16px', borderRadius: 8, fontSize: '.85rem', textDecoration: 'none',
        }}>Aplica →</a>
      </div>
    </div>
  )

  return (
    <ComunidadLayout subNav={subNav}>

      {/* HERO */}
      <section style={{
        background: `radial-gradient(circle at 15% 20%, rgba(29,158,117,.10), transparent 55%),
          radial-gradient(circle at 85% 80%, rgba(255,201,40,.08), transparent 55%),
          linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
        padding: '72px 26px 56px', borderBottom: `1px solid ${K.line}`,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: isMobile ? 32 : 56, alignItems: 'center' }}>
          <div>
            <span style={{
              display: 'inline-block', background: `rgba(29,158,117,.12)`, color: K.tealDeep,
              padding: '6px 14px', borderRadius: 999, fontWeight: 700, fontSize: '.75rem',
              letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 18,
            }}>
              Contratando ahora · 100% comisión · ~$270M COP Año 1
            </span>
            <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2.2rem,5vw,3.4rem)', color: K.ink, margin: '0 0 18px', lineHeight: 1.05, letterSpacing: '-1px' }}>
              Sé la <span style={{ color: K.teal }}>voz</span> de tu barrio<br />
              y construye una cartera que te paga por años.
            </h1>
            <p style={{ fontSize: '1.05rem', color: K.muted, margin: '0 0 30px', lineHeight: 1.6, maxWidth: 560 }}>
              Los Embajadores de Medellín Social son los líderes editoriales y el motor de ventas local de su barrio. Tú inscribes negocios, cuidas las relaciones, envías el newsletter semanal y conviertes un sitio web en la plaza digital que tus vecinos realmente usan.
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <a href="#aplicar" style={{
                background: K.coral, color: '#fff', fontWeight: 700, fontSize: '1rem',
                padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
                boxShadow: '0 8px 24px rgba(216,90,48,.28)',
              }}>
                Aplica ahora →
              </a>
              <a href="#que-haras" style={{
                background: '#fff', color: K.ink, fontWeight: 700, fontSize: '1rem',
                padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
                border: `2px solid ${K.ink}`,
              }}>
                Ver el rol
              </a>
            </div>
            <p style={{ fontSize: '.85rem', color: K.muted, margin: 0 }}>
              <strong style={{ color: K.ink }}>100% comisión</strong> · <strong style={{ color: K.ink }}>50% + 15% recurrente</strong> (24 meses) sobre clientes directos · <strong style={{ color: K.ink }}>5% residual</strong> del resto de tu barrio — nunca ambos en la misma cuenta
            </p>
          </div>

          {/* Earnings profile card */}
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28,
            border: `1px solid ${K.line}`, boxShadow: '0 8px 30px rgba(20,32,29,.08)',
          }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${K.line}` }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: `linear-gradient(135deg, ${K.teal}, ${K.tealDeep})`,
                color: '#fff', fontWeight: 900, fontSize: '1.6rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>$</div>
              <div>
                <div style={{ fontFamily: K.serif, fontWeight: 900, color: K.ink, fontSize: '1.05rem' }}>
                  Tu curva de ingresos Año 1
                </div>
                <div style={{ fontSize: '.78rem', color: K.muted, marginTop: 2 }}>
                  Basado en 2 negocios/semana + 1 afiliado/semana
                </div>
                <span style={{
                  display: 'inline-block', background: K.teal, color: '#fff',
                  fontSize: '.65rem', fontWeight: 800, padding: '3px 8px',
                  borderRadius: 4, letterSpacing: '.5px', marginTop: 6,
                }}>PROYECTADO</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { n: '~$5M', l: 'Mes 1' },
                { n: '~$19M', l: 'Mes 6' },
                { n: '~$44M', l: 'Mes 12' },
              ].map(s => (
                <div key={s.l} style={{ background: K.surface, padding: '10px', borderRadius: 8, textAlign: 'center' }}>
                  <span style={{ display: 'block', fontWeight: 800, color: K.teal, fontSize: '1.1rem' }}>{s.n}</span>
                  <span style={{ fontSize: '.7rem', color: K.muted, textTransform: 'uppercase', letterSpacing: '.4px' }}>{s.l} COP</span>
                </div>
              ))}
            </div>
            {[
              { t: '💰 Total Año 1: ~$270M COP', m: 'Comisión pura · Sin base fija · Crece con tu cartera' },
              { t: '📈 Año 2: $44M+ COP/mes al madurar', m: 'Cartera recurrente de 100+ clientes directos × 15%' },
              { t: '🎯 Los mejores duplican la cadencia, duplican los ingresos', m: '2 negocios/semana es la meta base, no el techo' },
            ].map(row => (
              <div key={row.t} style={{ padding: '11px 14px', background: K.surface, borderRadius: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: K.ink, fontSize: '.88rem' }}>{row.t}</div>
                <div style={{ color: K.muted, fontSize: '.75rem', marginTop: 3 }}>{row.m}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QUÉ HARÁS */}
      <section id="que-haras" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Lo que realmente harás
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 700, margin: '0 0 40px' }}>
            El Embajador es el enlace humano que convierte un sitio web en una comunidad real. Eres el editor, el conector y la cara de Medellín Social en el barrio.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {DUTIES.map(d => (
              <div key={d.titulo} style={{
                background: '#fff', borderLeft: `4px solid ${K.teal}`, borderRadius: 12,
                padding: '26px 22px', boxShadow: '0 4px 16px rgba(20,32,29,.06)',
              }}>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.05rem', color: K.ink, margin: '0 0 10px' }}>
                  {d.titulo}
                </h3>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{d.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HERRAMIENTAS — dark band */}
      <section id="herramientas" style={{ padding: '72px 26px', background: '#fff', borderTop: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{
            background: `linear-gradient(135deg, ${K.ink} 0%, #2A302C 100%)`,
            borderRadius: 16, padding: '48px 40px',
          }}>
            <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: '#fff', margin: '0 0 14px' }}>
              Diseñado para hacerte lucir bien
            </h2>
            <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '1.05rem', maxWidth: 600, margin: '0 0 36px' }}>
              No te entregamos una página en blanco. Medellín Social te da el toolkit completo y el respaldo operativo.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {TOOLS.map(tool => (
                <div key={tool.nm} style={{
                  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
                  borderRadius: 10, padding: '18px 16px',
                }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: '.92rem', marginBottom: 6 }}>{tool.nm}</div>
                  <div style={{ color: 'rgba(255,255,255,.7)', fontSize: '.82rem', lineHeight: 1.4 }}>{tool.ds}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* QUÉ OBTIENES */}
      <section id="que-obtienes" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Lo que obtienes
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 600, margin: '0 0 40px' }}>
            Un rol pagado real con verdadero potencial — no una caminadora de contenido.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
            {PERKS.map(p => (
              <div key={p.titulo} style={{ background: '#fff', border: `1px solid ${K.line}`, borderRadius: 12, padding: '26px 22px' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10, marginBottom: 16,
                  background: `linear-gradient(135deg, ${K.amarillo}, #e8a800)`,
                  color: K.ink, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '1.2rem',
                }}>
                  {p.ico}
                </div>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1rem', color: K.ink, margin: '0 0 10px' }}>
                  {p.titulo}
                </h3>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* A QUIÉN BUSCAMOS */}
      <section style={{ padding: '72px 26px', background: '#fff', borderTop: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            A quién buscamos
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 640, margin: '0 0 40px' }}>
            No necesitas ser periodista ni tener título en marketing. Necesitas conocer tu comunidad, escribir con claridad y disfrutar hablar con la gente.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            {WHO.map(w => (
              <div key={w.titulo} style={{
                background: K.surface, borderRadius: 12, padding: '24px 20px',
                borderTop: `4px solid ${K.teal}`,
              }}>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1rem', color: K.ink, margin: '0 0 8px' }}>{w.titulo}</h4>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SEMANA TÍPICA */}
      <section style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Cómo se ve una semana típica
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 600, margin: '0 0 36px' }}>
            Cadencia real, dueño real. Aproximadamente 15–25 horas/semana para una comunidad establecida.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            {WEEK.map(w => (
              <div key={w.day} style={{ background: '#fff', borderRadius: 10, padding: '20px 18px', border: `1px solid ${K.line}` }}>
                <div style={{ fontSize: '.72rem', fontWeight: 800, color: K.teal, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
                  {w.day}
                </div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '.96rem', color: K.ink, margin: '0 0 8px' }}>{w.titulo}</h4>
                <p style={{ fontSize: '.82rem', color: K.muted, lineHeight: 1.4, margin: 0 }}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section style={{ padding: '0 26px 72px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.5rem,3vw,2rem)', color: K.ink, margin: '0 0 28px' }}>
            Cómo medimos el éxito
          </h2>
          <div style={{
            background: K.surface, borderRadius: 12, padding: '28px 24px',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20,
          }}>
            {KPIS.map(k => (
              <div key={k.l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '.72rem', color: K.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
                  {k.l}
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: K.ink }}>{k.v}</div>
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
                <div style={{ fontSize: 48, marginBottom: 16 }}>🏘️</div>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 12px' }}>
                  ¡Recibimos tu aplicación!
                </h2>
                <p style={{ color: K.muted, lineHeight: 1.6 }}>
                  Revisamos cada aplicación personalmente. Te contactamos en 2 días hábiles.
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 8px', textAlign: 'center' }}>
                  Aplica como Embajador de Barrio
                </h2>
                <p style={{ color: K.muted, fontSize: '.96rem', textAlign: 'center', marginBottom: 32 }}>
                  Un embajador por barrio. Cupos limitados. Respondemos en 2 días hábiles.
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
                      <label style={labelStyle}>Barrio que quieres representar</label>
                      <select required value={barrioId ?? ''} onChange={e => setBarrioId(e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">Selecciona tu barrio…</option>
                        {BARRIOS.filter(b => b.barrio_id !== null).map(b => (
                          <option data-i18n-skip key={b.slug} value={b.barrio_id!}>{b.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Cuéntanos sobre tu comunidad en 2–3 oraciones</label>
                      <textarea
                        value={experiencia} onChange={e => setExperiencia(e.target.value)}
                        placeholder="¿Qué hace especial tu barrio? ¿Quién vive allí? ¿Cuál es la historia local con la que arrancarías el día uno?"
                        rows={3} style={{ ...inputStyle, resize: 'vertical' }}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Experiencia relevante (opcional)</label>
                      <textarea
                        required value={motivacion} onChange={e => setMotivacion(e.target.value)}
                        placeholder="Escritura, medios, marketing, inmuebles, cívico, organizaciones, ventas, cámara de comercio — cualquier cosa relevante. URL de LinkedIn está bien."
                        rows={3} style={{ ...inputStyle, resize: 'vertical' }}
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
                          boxShadow: loading ? 'none' : '0 8px 24px rgba(216,90,48,.28)',
                        }}
                      >
                        {loading ? 'Enviando…' : 'Enviar solicitud →'}
                      </button>
                      <p style={{ fontSize: '.78rem', color: K.muted, margin: '12px 0 0' }}>
                        Revisamos cada aplicación personalmente. Sabrás de nosotros en 2 días hábiles.
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
