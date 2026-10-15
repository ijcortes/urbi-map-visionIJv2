import { seo } from "@/lib/seo";
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { API_BASE_URL } from '@/config/api'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { useIsMobile } from '@/hooks/use-mobile'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/afiliado')({
  component: AfiliadoPage,
  head: () => seo({ title: "Programa de Afiliados · Medellín Social", description: "Vende un producto que los negocios de Medellín realmente quieren. Comisión recurrente hasta 24 meses.", path: "/afiliado" }),
})

const K = TOKENS;

const CANALES = [
  { value: 'red_negocios', label: 'Red de negocios locales' },
  { value: 'redes', label: 'Redes sociales / comunidades online' },
  { value: 'conocidos', label: 'Contactos y conocidos directos' },
  { value: 'eventos', label: 'Eventos y networking' },
  { value: 'camara', label: 'Cámara de comercio / gremio' },
  { value: 'marketing', label: 'Marketing / publicidad / ventas' },
  { value: 'otro', label: 'Otro' },
]

const WHY_ITEMS = [
  { ico: '🏆', titulo: 'Exclusividad de categoría', desc: 'Un solo negocio por barrio por categoría. No vendes el mismo producto a diez prospectos — ofreces el único cupo.' },
  { ico: '📈', titulo: 'No es publicidad', desc: 'Es SEO + AEO + autoridad en el mapa local. Los negocios pagan porque el activo se acumula, a diferencia de los anuncios que desaparecen.' },
  { ico: '💸', titulo: 'Precio de entrada amigable', desc: 'Hotspot desde $29 USD. El primer sí es barato. El camino de upgrade hace la mayor parte del trabajo.' },
  { ico: '⚙️', titulo: 'Nosotros hacemos el trabajo pesado', desc: 'Una vez que el prospecto firma, el Embajador lo incorpora y el equipo de IA maneja el contenido. Tú vendes — no das soporte.' },
  { ico: '📞', titulo: 'Inbound + outbound', desc: 'La landing page genera leads inbound. La lista de Google Places de negocios 5 estrellas más directorios de cámaras te dan un outbound pre-calificado.' },
  { ico: '🔁', titulo: 'Ingresos recurrentes', desc: 'Featured Business paga mensual. Tu cartera de negocios activos crece cada mes y te sigue pagando aunque no cierres nuevos.' },
]

const COMP_CARDS = [
  {
    tier: 'La estructura central',
    titulo: '15% + 5% en todo',
    price: 'Cada producto · Cada nivel · Siempre',
    items: [
      '15% comisión única sobre el primer pago de cualquier cuenta nueva que firmes',
      '5% comisión recurrente los primeros 24 meses, luego 2.5% mientras el cliente siga pagando',
      'Una estructura simple — sin tabla de niveles que memorizar',
    ],
  },
  {
    tier: 'Ejemplo · Recurrente mensual',
    titulo: 'Featured Business',
    price: '~$410K COP/mes* · Exclusividad de categoría',
    items: [
      '$61.5K COP único el mes que firman',
      '$20.5K COP/mes recurrente cada mes que renuevan',
      'Valor a 12 meses por cuenta: ~$287K COP',
    ],
  },
  {
    tier: 'Ejemplo · Por placement',
    titulo: 'Hotspot / Oferta especial',
    price: 'desde $29 USD ($120K COP)',
    items: [
      '$18K COP único por placement (15%)',
      'La mayoría hacen pedidos repetidos — relación recurrente',
      'La forma más rápida de abrir una cuenta nueva',
    ],
  },
  {
    tier: 'Ejemplo · Volumen',
    titulo: 'Múltiples negocios en tu barrio',
    price: 'Sin límite de referidos',
    items: [
      'Cuantos más negocios firmes, mayor tu cartera recurrente',
      'Especialízate por categoría: restaurantes, salud, servicios profesionales',
      'Al Año 1: cartera de 104 clientes te paga $2.1M COP/mes passivo',
    ],
  },
]

const MATH = {
  left: { label: '8.67 clientes nuevos/mes\n× 15% × $410K COP', value: '$535K COP' },
  right: { label: '95 clientes recurrentes\n× 5% × $410K COP', value: '$1.95M COP' },
  result: { label: 'Ingresos mensuales Mes 12', value: '~$2.5M COP' },
  foot: 'Con 2 negocios/semana, tus ingresos totales del Año 1 = ~$16M COP. Cartera recurrente al final del Año 1 = $2.1M COP/mes — eso es $25M COP/año en ingresos pasivos incluso si dejaras de firmar nuevos. Sigue firmando y el Año 2 arranca con $3M+/mes.',
}

const WHO_TILES = [
  { ico: '🏢', titulo: 'Dueños de negocios locales', desc: 'Ya conoces a otros empresarios del barrio. Este producto es un valor agregado obvio para tu red.' },
  { ico: '🏠', titulo: 'Agentes inmobiliarios', desc: 'Ya le presentas propuestas a servicios del hogar, abogados y el ecosistema inmobiliario completo.' },
  { ico: '📊', titulo: 'Contadores y asesores', desc: 'Tienes relaciones directas con dueños de pequeños negocios en todas las categorías.' },
  { ico: '🛡️', titulo: 'Corredores de seguros', desc: 'Ya hablas con cada profesional de servicios, agente inmobiliario y dueño de negocio en la ciudad.' },
  { ico: '📣', titulo: 'Representantes de marketing', desc: 'Vendes pauta, websites, SEO o redes a PYMEs locales. Medellín Social es el producto natural.' },
  { ico: '🏘️', titulo: 'Miembros de cámara de comercio', desc: 'Ya conoces la comunidad de negocios locales. Esto es la extensión obvia de tu red.' },
  { ico: '🎯', titulo: 'Ex representantes de ventas', desc: 'Periódicos locales, radio, correo directo. El mismo comprador — mejor producto.' },
  { ico: '🌎', titulo: 'Locales conectados', desc: 'Donde sea que tengas una red profunda y quieras monetizarla en tu propio horario.' },
]

const KIT_ITEMS = [
  { ico: '📋', titulo: 'Listas de leads pre-calificadas', desc: 'Exportaciones de Google Places de cada negocio 5 estrellas en tu zona, desglosadas por categoría.' },
  { ico: '💻', titulo: 'Acceso al CRM', desc: 'Tu perfil en el CRM de la plataforma. Pipeline, ruteo de leads, contratos digitales y enlaces de pago.' },
  { ico: '📧', titulo: 'Campañas de outreach listas', desc: 'Secuencias de email + WhatsApp personalizadas con tu nombre y tu comunidad. Activa y olvídate.' },
  { ico: '📞', titulo: 'Scripts de ventas y objeciones', desc: 'Script de llamada en vivo, preguntas de descubrimiento, presentación de precios, respuestas a objeciones.' },
  { ico: '🎬', titulo: 'Video explicativo y materiales', desc: 'Video de 2–3 minutos, flyer de una página, deck de ventas completo. Úsalos tal cual.' },
  { ico: '🤝', titulo: 'Ruteo de leads inbound', desc: 'Los leads inbound de tu zona llegan a ti. Responde dentro de 1 día hábil y son tuyos.' },
]

const DEAL_STEPS = [
  { n: 1, titulo: 'Prospectar', desc: 'Saca una lista de tu categoría o comunidad. Agrégala al pipeline. O trabaja el inbound del landing.' },
  { n: 2, titulo: 'Cadencia de outreach', desc: 'Email → WhatsApp → llamada. El sistema lo corre. Tú entras cuando un prospecto se engancha.' },
  { n: 3, titulo: 'Llamada de descubrimiento', desc: '15 minutos. Confirma categoría, presenta el precio, responde objeciones. Elige el plan.' },
  { n: 4, titulo: 'Cierre', desc: 'Envía el contrato digital y enlace de pago desde el CRM. El trato se cierra. Recibes tu comisión.' },
  { n: 5, titulo: 'Entrega', desc: 'La cuenta pasa al Embajador para el onboarding. Tú mantienes la relación para upgrades futuros.' },
]

const FAQS = [
  { q: '¿Tengo que trabajar exclusivamente para Medellín Social?', a: 'No. Es una relación de contratista independiente. La mayoría de afiliados tienen otro trabajo o negocio y corren el programa en paralelo.' },
  { q: '¿Hay una cuota mínima?', a: 'Sin cuota mínima. El modelo recurrente premia la consistencia. La mayoría de afiliados activos cierran 1–3 tratos por mes después de los primeros 30 días.' },
  { q: '¿Qué pasa si mi cliente cancela?', a: 'La comisión recurrente continúa mientras el cliente pague. Si cancela, la línea recurrente se detiene. No hay contracargo después de los primeros 30 días.' },
  { q: '¿La comisión recurrente dura para siempre?', a: 'No — 5% los primeros 24 meses de esa cuenta, luego 2.5% mientras siga activa. El tope aplica por cuenta, no por afiliado: sigues sumando cuentas nuevas sin límite.' },
  { q: '¿Puedo especializarme por industria?', a: 'Sí — la mayoría lo hacen. Especializaciones comunes: gastronomía, ecosistema inmobiliario, salud y bienestar, servicios profesionales.' },
  { q: '¿Qué pasa si un prospecto pregunta algo que no puedo responder?', a: 'Incluye al Embajador de tu zona o al equipo de Medellín Social. Te respaldamos en tiempo real.' },
  { q: '¿Cuánto tiempo toma cerrar un trato?', a: 'Hotspot/Oferta: 7–14 días desde el primer contacto. Featured Business: 14–30 días. La cadencia automatizada acelera el ciclo.' },
]

function AfiliadoPage() {
  const isMobile = useIsMobile()
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [canal, setCanal] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/afiliados/aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: `${nombre} ${apellido}`.trim(),
          email,
          telefono,
          canal,
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
        <a href="#por-que" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Por qué funciona</a>
        <a href="#compensacion" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Compensación</a>
        <a href="#kit" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Lo que recibes</a>
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
        padding: '72px 26px 56px', borderBottom: `1px solid ${K.line}`,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.15fr 1fr', gap: isMobile ? 32 : 56, alignItems: 'center' }}>
          <div>
            <span style={{
              display: 'inline-block', background: `rgba(255,201,40,.2)`, color: '#7a5800',
              padding: '6px 14px', borderRadius: 999, fontWeight: 700, fontSize: '.75rem',
              letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 18,
            }}>
              Programa de ventas externo · Medellín Social
            </span>
            <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2.2rem,5vw,3.4rem)', color: K.ink, margin: '0 0 18px', lineHeight: 1.05, letterSpacing: '-1px' }}>
              Vende un producto que los negocios de Medellín
              <span style={{ color: K.teal }}> realmente quieren.</span>
            </h1>
            <p style={{ fontSize: '1.05rem', color: K.muted, margin: '0 0 30px', lineHeight: 1.6, maxWidth: 580 }}>
              Los Afiliados de Medellín Social son socios independientes — representantes de ventas externos — que presentan negocios locales a una plataforma que les da exclusividad de categoría, autoridad real y leads inbound. Tú aportas las relaciones. Nosotros aportamos el producto, los leads, el CRM y los scripts.
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <a href="#aplicar" style={{
                background: K.teal, color: '#fff', fontWeight: 700, fontSize: '1rem',
                padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
                boxShadow: '0 8px 24px rgba(29,158,117,.28)',
              }}>
                Aplicar como Afiliado →
              </a>
              <a href="#por-que" style={{
                background: '#fff', color: K.ink, fontWeight: 700, fontSize: '1rem',
                padding: '15px 28px', borderRadius: 10, textDecoration: 'none',
                border: `2px solid ${K.ink}`,
              }}>
                Ver la propuesta
              </a>
            </div>
            <p style={{ fontSize: '.85rem', color: K.muted, margin: 0 }}>
              <strong style={{ color: K.ink }}>15% primer mes + 5% recurrente (24 meses, luego 2.5%)</strong> · Sin cuota mínima · Especialízate donde está tu red
            </p>
          </div>

          {/* Earnings card */}
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28,
            border: `1px solid ${K.line}`, boxShadow: '0 8px 30px rgba(20,32,29,.08)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottom: `1px solid ${K.line}`, marginBottom: 16 }}>
              <span style={{ fontSize: '.75rem', color: K.muted, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700 }}>
                Tu potencial de ingresos Año 1
              </span>
              <span style={{ background: K.teal, color: '#fff', fontSize: '.65rem', fontWeight: 800, padding: '4px 10px', borderRadius: 4, letterSpacing: '.6px' }}>
                2 / SEMANA
              </span>
            </div>
            <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '2.4rem', color: K.teal, letterSpacing: '-1px', marginBottom: 4 }}>
              ~$2.5M COP / mes
            </div>
            <div style={{ fontSize: '.8rem', color: K.muted, marginBottom: 20 }}>
              Mes 12 con 2 cuentas/semana · $16M COP acumulados Año 1 · $2.1M COP/mes de cartera recurrente pura al final del Año 1
            </div>
            <div style={{ fontSize: '.7rem', color: K.coral, marginBottom: 4, fontWeight: 600 }}>
              *Cifras ilustrativas — precio de Featured Business aún por confirmar.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Mes 1 — 8.67 clientes nuevos', sub: '15% × 8.67 × $410K COP', am: '~$535K' },
                { label: 'Mes 3 — 8.67 nuevas + 17 recurrentes', sub: '$535K primer mes + $350K recurrente', am: '~$885K' },
                { label: 'Mes 6 — 8.67 nuevas + 43 recurrentes', sub: '$535K primer mes + $885K recurrente', am: '~$1.4M' },
                { label: 'Mes 9 — 8.67 nuevas + 69 recurrentes', sub: '$535K primer mes + $1.4M recurrente', am: '~$1.9M' },
                { label: 'Mes 12 — 8.67 nuevas + 95 recurrentes', sub: '$535K primer mes + $1.95M recurrente', am: '~$2.5M' },
              ].map(row => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', background: K.surface, borderRadius: 8,
                }}>
                  <div>
                    <div style={{ color: K.ink, fontWeight: 700, fontSize: '.82rem' }}>{row.label}</div>
                    <div style={{ color: K.muted, fontSize: '.72rem', marginTop: 2 }}>{row.sub}</div>
                  </div>
                  <div style={{ color: K.teal, fontWeight: 800, fontSize: '.96rem', flexShrink: 0, marginLeft: 12 }}>{row.am} COP</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '.72rem', color: K.muted, marginTop: 14, lineHeight: 1.4 }}>
              Basado en Featured Business <strong>$410K COP/mes</strong> · <strong>15% primer mes + 5% recurrente</strong> (24 meses, luego 2.5%) · 2 nuevas cuentas/semana.
            </p>
          </div>
        </div>
      </section>

      {/* POR QUÉ */}
      <section id="por-que" style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Por qué este producto se vende
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 660, margin: '0 0 40px' }}>
            Si has vendido publicidad local antes, conoces las objeciones. Medellín Social elimina la mayoría.
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

      {/* COMPENSACIÓN — dark band */}
      <section id="compensacion" style={{ background: `linear-gradient(135deg, ${K.ink} 0%, #2A302C 100%)`, padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: '#fff', margin: '0 0 14px' }}>
            Cómo te pagamos
          </h2>
          <p style={{ color: 'rgba(255,255,255,.8)', fontSize: '1.05rem', maxWidth: 640, margin: '0 0 40px' }}>
            Transparente, recurrente, sin contracargos si el cliente sigue activo.
            <span style={{ display: 'block', fontSize: '.8rem', color: K.amarillo, marginTop: 8, fontWeight: 600 }}>
              *Precio de Featured Business ilustrativo, aún por confirmar — el % de comisión sí está definido.
            </span>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
            {COMP_CARDS.map(c => (
              <div key={c.titulo} style={{
                background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 12, padding: '26px 22px',
              }}>
                <div style={{ fontSize: '.7rem', fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: K.amarillo, marginBottom: 10 }}>
                  {c.tier}
                </div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, color: '#fff', fontSize: '1.2rem', margin: '0 0 8px' }}>{c.titulo}</h4>
                <div style={{ color: K.teal, fontWeight: 700, marginBottom: 16, fontSize: '.88rem' }}>{c.price}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {c.items.map(item => (
                    <li key={item} style={{ padding: '5px 0 5px 22px', position: 'relative', color: 'rgba(255,255,255,.82)', fontSize: '.85rem' }}>
                      <span style={{ position: 'absolute', left: 0, color: K.amarillo, fontWeight: 800 }}>→</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MATH */}
      <section style={{ padding: '72px 26px', background: '#fff', borderTop: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            La cuenta, simplificada
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 600, margin: '0 0 36px' }}>
            Cómo se ve tu mes 12 en estado estable con 2 cuentas nuevas/semana. *Con precio de Featured Business ilustrativo, por confirmar.
          </p>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '36px 32px',
            border: `2px solid ${K.teal}`, boxShadow: '0 4px 24px rgba(29,158,117,.12)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 20, alignItems: 'center', marginBottom: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '.75rem', color: K.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, whiteSpace: 'pre-line' }}>
                  {MATH.left.label}
                </div>
                <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.6rem', color: K.ink }}>{MATH.left.value}</div>
              </div>
              <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.5rem', color: K.muted }}>+</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '.75rem', color: K.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, whiteSpace: 'pre-line' }}>
                  {MATH.right.label}
                </div>
                <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.6rem', color: K.ink }}>{MATH.right.value}</div>
              </div>
              <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.5rem', color: K.muted }}>=</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '.75rem', color: K.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                  {MATH.result.label}
                </div>
                <div style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '2rem', color: K.teal }}>{MATH.result.value}</div>
              </div>
            </div>
            <p style={{ fontSize: '.85rem', color: K.muted, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
              {MATH.foot}
            </p>
          </div>
        </div>
      </section>

      {/* PARA QUIÉN */}
      <section style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Para quién está hecho esto
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 640, margin: '0 0 40px' }}>
            Si ya tienes redes de dueños de negocios locales, ya estás calificado.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
            {WHO_TILES.map(w => (
              <div key={w.titulo} style={{ background: K.surface, borderRadius: 12, padding: '22px 18px', border: `1px solid ${K.line}` }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: K.ink,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, marginBottom: 12,
                }}>
                  {w.ico}
                </div>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '.96rem', color: K.ink, margin: '0 0 6px' }}>{w.titulo}</h4>
                <p style={{ fontSize: '.82rem', color: K.muted, lineHeight: 1.4, margin: 0 }}>{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* KIT */}
      <section id="kit" style={{ padding: '72px 26px', background: '#fff', borderTop: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Lo que te entregamos el primer día
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 600, margin: '0 0 40px' }}>
            Un kit de ventas completo. No tienes que descifrar cómo posicionar el producto ni construir el embudo.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
            {KIT_ITEMS.map(k => (
              <div key={k.titulo} style={{ background: K.paper, border: `1px solid ${K.line}`, borderRadius: 12, padding: '24px 20px' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, marginBottom: 14,
                  background: `linear-gradient(135deg, ${K.teal}, ${K.tealDeep})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                }}>
                  {k.ico}
                </div>
                <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '.96rem', color: K.ink, margin: '0 0 8px' }}>{k.titulo}</h3>
                <p style={{ fontSize: '.85rem', color: K.muted, lineHeight: 1.4, margin: 0 }}>{k.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CÓMO AVANZA UN TRATO */}
      <section style={{ padding: '72px 26px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Cómo avanza un trato
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', maxWidth: 660, margin: '0 0 40px' }}>
            Del primer contacto al cierre: Hotspot en 7–14 días, Featured Business en 14–30 días.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            {DEAL_STEPS.map(s => (
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

      {/* FAQ */}
      <section style={{ padding: '0 26px 72px', background: '#fff', borderTop: `1px solid ${K.line}`, paddingTop: 72 }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.6rem,3.4vw,2.2rem)', color: K.ink, margin: '0 0 14px' }}>
            Preguntas comunes
          </h2>
          <p style={{ color: K.muted, fontSize: '1.05rem', margin: '0 0 36px' }}>
            Las que más escuchamos cuando los Afiliados se suman.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FAQS.map(f => (
              <div key={f.q} style={{ background: K.paper, border: `1px solid ${K.line}`, borderRadius: 10, padding: '22px 24px' }}>
                <h4 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '.96rem', color: K.ink, margin: '0 0 8px' }}>{f.q}</h4>
                <p style={{ fontSize: '.88rem', color: K.muted, lineHeight: 1.5, margin: 0 }}>{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FORMULARIO */}
      <section id="aplicar" style={{ padding: '72px 26px 80px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{
            background: `linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
            borderRadius: 16, padding: '48px 40px',
            border: `1px solid ${K.line}`, boxShadow: '0 8px 32px rgba(20,32,29,.07)',
          }}>
            {success ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>💰</div>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 12px' }}>
                  ¡Solicitud recibida!
                </h2>
                <p style={{ color: K.muted, lineHeight: 1.6 }}>
                  Revisamos cada aplicación personalmente. Los Afiliados aprobados se incorporan la misma semana.
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.8rem', color: K.ink, margin: '0 0 8px', textAlign: 'center' }}>
                  Aplica como Afiliado Comunitario
                </h2>
                <p style={{ color: K.muted, fontSize: '.96rem', textAlign: 'center', marginBottom: 32 }}>
                  Cuéntanos sobre tu red y tu experiencia. Respondemos en 2 días hábiles.
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
                      <label style={labelStyle}>¿Cómo piensas referir negocios? / Red o canal principal</label>
                      <select required value={canal} onChange={e => setCanal(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">Selecciona…</option>
                        {CANALES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
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
                        Revisamos cada aplicación personalmente. Los Afiliados aprobados se incorporan la misma semana.
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
