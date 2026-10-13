import { createFileRoute } from '@tanstack/react-router'
import { numberLocale } from "@/lib/format";
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { API_BASE_URL } from '@/config/api'
import { BARRIOS } from '@/components/comunidad/BarrioContext'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { useNoticias } from '@/hooks/useNoticias'
import { useIsMobile } from '@/hooks/use-mobile'
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute('/blog')({
  component: BlogPage,
  head: () => ({
    meta: [
      { title: 'Blog del Barrio · Medellín Social' },
      { name: 'description', content: 'Historias, noticias y voces de tu comunidad. Contenido de embajadores y vecinos de Medellín.' },
    ],
  }),
})

const K = TOKENS;

interface Post {
  id: number
  autor_nombre: string
  autor_handle: string | null
  titulo: string
  cuerpo: string
  imagen_url: string | null
  enlace_url: string | null
  categoria: string | null
  created_at: string | null
}

function usePosts() {
  return useQuery<Post[]>({
    queryKey: ['comunidad-posts'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/comunidad/posts?limit=30`)
      if (!res.ok) return []
      const data = await res.json()
      return data.posts ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

function BlogPage() {
  const isMobile = useIsMobile()
  const { data: noticias = [], isLoading: noticiasLoading } = useNoticias(12)
  const { data: posts = [] } = usePosts()

  // Form
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [barrioId, setBarrioId] = useState<number | null>(null)
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [enlace, setEnlace] = useState('')
  const [imagen, setImagen] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE_URL}/comunidad/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autor_nombre: nombre,
          autor_email: email,
          autor_handle: handle || null,
          titulo,
          cuerpo,
          barrio_id: barrioId,
          enlace_url: enlace || null,
          imagen_url: imagen || null,
        }),
      })
      if (!res.ok) throw new Error()
      setSuccess(true)
    } catch {
      setError('Error al enviar. Revisa los enlaces (deben empezar con http/https) e intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    border: `1px solid ${K.line}`, borderRadius: 8,
    fontSize: '.96rem', fontFamily: 'inherit',
    background: '#fff', color: K.ink, outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '.75rem', fontWeight: 700,
    color: K.ink, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px',
  }

  const subNav = (
    <div style={{ background: K.paper, borderBottom: `1px solid ${K.line}`, padding: '0 26px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 24, alignItems: 'center', height: 44 }}>
        <a href="#noticias" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>Noticias</a>
        <a href="#comunidad" style={{ color: K.muted, fontSize: '.85rem', textDecoration: 'none', fontWeight: 500 }}>De la comunidad</a>
        <a href="#publicar" style={{
          marginLeft: 'auto', background: K.coral, color: '#fff', fontWeight: 700,
          padding: '6px 16px', borderRadius: 8, fontSize: '.85rem', textDecoration: 'none',
        }}>Publica tu historia →</a>
      </div>
    </div>
  )

  return (
    <ComunidadLayout subNav={subNav}>

      {/* HERO */}
      <section style={{
        background: `radial-gradient(circle at 15% 20%, rgba(29,158,117,.10), transparent 55%),
          linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
        padding: isMobile ? '48px 20px 36px' : '72px 26px 48px', borderBottom: `1px solid ${K.line}`,
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', background: 'rgba(29,158,117,.12)', color: K.tealDeep,
            padding: '6px 14px', borderRadius: 999, fontWeight: 700, fontSize: '.75rem',
            letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 18,
          }}>
            Blog del Barrio
          </span>
          <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(2rem,5vw,3.2rem)', color: K.ink, margin: '0 0 16px', lineHeight: 1.05, letterSpacing: '-1px' }}>
            La voz de tu <span style={{ color: K.teal }}>comunidad</span>
          </h1>
          <p style={{ fontSize: '1.05rem', color: K.muted, margin: '0 auto', lineHeight: 1.6, maxWidth: 560 }}>
            Noticias, historias y contenido de embajadores y vecinos de Medellín. ¿Tienes algo que contar? Publícalo abajo.
          </p>
        </div>
      </section>

      {/* NOTICIAS */}
      <section id="noticias" className="section-padding" style={{ padding: isMobile ? '32px 16px' : '56px 26px', borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.5rem,3vw,2rem)', color: K.ink, margin: '0 0 24px' }}>
            Lo último del barrio
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: isMobile ? 10 : 16 }}>
            {noticias.length === 0 ? (
              <p style={{ color: K.muted, gridColumn: '1/-1' }}>{noticiasLoading ? 'Cargando noticias…' : 'Aún no hay noticias. Vuelve pronto.'}</p>
            ) : noticias.map((n, i) => (
              <a key={n.id ?? i} href={n.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'block', padding: isMobile ? '12px 12px 10px' : '18px 18px 16px',
                background: K.paper, borderRadius: isMobile ? 10 : 14,
                boxShadow: '0 1px 6px rgba(20,32,29,.07), 0 4px 18px rgba(20,32,29,.04)', textDecoration: 'none',
              }}>
                <span style={{
                  display: 'inline-block', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.07em', color: K.coral, background: K.coralLight,
                  padding: '2px 7px', borderRadius: 999, marginBottom: 7,
                }}>
                  {n.fuente === 'el_colombiano' ? 'El Colombiano' : (n.fuente ?? 'Medellín')}
                </span>
                <h3 style={{
                  fontFamily: K.serif, fontSize: isMobile ? 13 : 16, fontWeight: 600, color: K.ink,
                  lineHeight: 1.3, margin: '0 0 6px',
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {n.titulo}
                </h3>
                {n.fecha_publicacion && (
                  <span style={{ fontSize: 11, color: K.muted }}>
                    {new Date(n.fecha_publicacion).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* DE LA COMUNIDAD */}
      <section id="comunidad" style={{ padding: isMobile ? '32px 16px' : '56px 26px', background: '#fff', borderBottom: `1px solid ${K.line}` }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.5rem,3vw,2rem)', color: K.ink, margin: '0 0 6px' }}>
            De la comunidad
          </h2>
          <p style={{ color: K.muted, fontSize: '.96rem', margin: '0 0 24px' }}>
            Historias escritas por embajadores y vecinos del barrio.
          </p>
          {posts.length === 0 ? (
            <p style={{ color: K.muted }}>Aún no hay historias publicadas. Sé el primero abajo 👇</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
              {posts.map(p => (
                <article key={p.id} style={{
                  background: K.paper, borderRadius: 14, overflow: 'hidden',
                  border: `1px solid ${K.line}`, boxShadow: '0 4px 16px rgba(20,32,29,.06)',
                }}>
                  {p.imagen_url && (
                    <img src={p.imagen_url} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
                  )}
                  <div style={{ padding: '20px 22px' }}>
                    <h3 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.15rem', color: K.ink, margin: '0 0 10px', lineHeight: 1.25 }}>
                      {p.titulo}
                    </h3>
                    <p style={{
                      fontSize: '.9rem', color: K.muted, lineHeight: 1.55, margin: '0 0 14px',
                      display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {p.cuerpo}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: '.8rem', fontWeight: 700, color: K.tealDeep }}>
                        {p.autor_nombre}{p.autor_handle ? ` · ${p.autor_handle}` : ''}
                      </span>
                      {p.enlace_url && (
                        <a href={p.enlace_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.8rem', fontWeight: 700, color: K.coral, textDecoration: 'none' }}>
                          Ver más →
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* PUBLICAR */}
      <section id="publicar" style={{ padding: isMobile ? '36px 16px 56px' : '56px 26px 80px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            background: `linear-gradient(180deg, #fff 0%, ${K.paper} 100%)`,
            borderRadius: 16, padding: isMobile ? '32px 22px' : '44px 40px',
            border: `1px solid ${K.line}`, boxShadow: '0 8px 32px rgba(20,32,29,.07)',
          }}>
            {success ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✍️</div>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.6rem', color: K.ink, margin: '0 0 12px' }}>
                  ¡Recibimos tu historia!
                </h2>
                <p style={{ color: K.muted, lineHeight: 1.6 }}>
                  La revisamos antes de publicarla. Aparecerá en el blog cuando la aprobemos.
                </p>
              </div>
            ) : (
              <>
                <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.6rem', color: K.ink, margin: '0 0 8px', textAlign: 'center' }}>
                  Publica tu historia
                </h2>
                <p style={{ color: K.muted, fontSize: '.95rem', textAlign: 'center', marginBottom: 28 }}>
                  Cuéntale al barrio lo que pasa. Revisamos cada historia antes de publicarla.
                </p>
                <form onSubmit={handleSubmit}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={labelStyle}>Tu nombre</label>
                      <input required value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Tu red social (opcional)</label>
                      <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@tu_instagram" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Barrio</label>
                      <select value={barrioId ?? ''} onChange={e => setBarrioId(e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">Selecciona tu barrio…</option>
                        {BARRIOS.filter(b => b.barrio_id !== null).map(b => (
                          <option key={b.slug} value={b.barrio_id!}>{b.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Título</label>
                      <input required value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Un titular que enganche" style={inputStyle} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Tu historia</label>
                      <textarea required value={cuerpo} onChange={e => setCuerpo(e.target.value)} rows={6} placeholder="Escribe lo que quieres contarle al barrio…" style={{ ...inputStyle, resize: 'vertical' }} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Link a tu post en redes (opcional)</label>
                      <input value={enlace} onChange={e => setEnlace(e.target.value)} placeholder="https://instagram.com/p/…" style={inputStyle} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={labelStyle}>Link de una imagen (opcional)</label>
                      <input value={imagen} onChange={e => setImagen(e.target.value)} placeholder="https://…/foto.jpg" style={inputStyle} />
                    </div>
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', marginTop: 8 }}>
                      {error && <p style={{ color: K.coral, fontSize: '.88rem', marginBottom: 12 }}>{error}</p>}
                      <button type="submit" disabled={loading} style={{
                        background: loading ? K.muted : K.coral, color: '#fff', border: 'none',
                        fontWeight: 800, padding: '16px 44px', borderRadius: 10,
                        cursor: loading ? 'not-allowed' : 'pointer', fontSize: '1.02rem', fontFamily: 'inherit',
                        boxShadow: loading ? 'none' : '0 8px 24px rgba(216,90,48,.28)',
                      }}>
                        {loading ? 'Enviando…' : 'Enviar historia →'}
                      </button>
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
