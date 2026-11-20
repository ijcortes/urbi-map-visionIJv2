import { seo } from '@/lib/seo'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { API_ENDPOINTS } from '@/config/api'
import { apiFetch, getToken } from '@/lib/apiClient'
import { BARRIOS } from '@/components/comunidad/BarrioContext'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { GRUPOS_TIENDAS } from '@/lib/categorias_comunidad'
import { K as TOKENS } from '@/design/tokens'

export const Route = createFileRoute('/negocios/crear')({
  component: CrearNegocioPage,
  head: () => seo({ title: 'Lista tu negocio · Medellín Social', description: 'Agrega tu negocio al directorio de tu barrio. Gratis — lo revisamos y aparece en el mapa.', path: '/negocios/crear' }),
})

const K = TOKENS

function CrearNegocioPage() {
  const loggedIn = !!getToken()

  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('')
  const [barrioId, setBarrioId] = useState<number | null>(null)
  const [descripcion, setDescripcion] = useState('')
  const [direccion, setDireccion] = useState('')
  const [telefono, setTelefono] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [instagram, setInstagram] = useState('')
  const [website, setWebsite] = useState('')
  const [fotoUrl, setFotoUrl] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', border: `1px solid ${K.line}`, borderRadius: 8,
    fontSize: '.96rem', fontFamily: 'inherit', background: '#fff', color: K.ink,
    outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '.75rem', fontWeight: 700, color: K.ink,
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await apiFetch(API_ENDPOINTS.crearNegocio, {
        method: 'POST',
        body: JSON.stringify({
          nombre,
          categoria,
          barrio_id: barrioId,
          descripcion: descripcion || null,
          direccion: direccion || null,
          telefono: telefono || null,
          whatsapp: whatsapp || null,
          instagram: instagram || null,
          website: website || null,
          foto_url: fotoUrl || null,
        }),
      })
      setSuccess(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 16, padding: '40px 36px',
    border: `1px solid ${K.line}`, boxShadow: '0 8px 32px rgba(20,32,29,.07)',
  }

  return (
    <ComunidadLayout>
      <section style={{ padding: '56px 26px 72px', background: K.paper, minHeight: '70vh' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ color: K.teal, fontWeight: 700, fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '1.5px', margin: '0 0 8px' }}>
            Negocios
          </p>
          <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.8rem,4vw,2.6rem)', color: K.ink, margin: '0 0 10px' }}>
            Lista tu negocio
          </h1>
          <p style={{ color: K.muted, fontSize: '1.02rem', margin: '0 0 28px', lineHeight: 1.5 }}>
            Agrégalo al directorio de tu barrio. Gratis — lo revisamos y aparece en el mapa en menos de 24 horas.
            {' '}<a href="/negocios/unirse" style={{ color: K.coral, fontWeight: 700, textDecoration: 'none' }}>¿Quieres destacar? Ver planes →</a>
          </p>

          {!loggedIn ? (
            <div style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 42, marginBottom: 14 }}>🔒</div>
              <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.4rem', color: K.ink, margin: '0 0 10px' }}>
                Inicia sesión para publicar
              </h2>
              <p style={{ color: K.muted, marginBottom: 20 }}>Necesitas una cuenta para listar un negocio.</p>
              <a href="/login?redirect=/negocios/crear" style={{
                display: 'inline-block', background: K.coral, color: '#fff', fontWeight: 800,
                padding: '13px 32px', borderRadius: 10, textDecoration: 'none',
              }}>
                Iniciar sesión →
              </a>
            </div>
          ) : success ? (
            <div style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.7rem', color: K.ink, margin: '0 0 12px' }}>
                ¡Recibimos tu negocio!
              </h2>
              <p style={{ color: K.muted, lineHeight: 1.6 }}>
                Queda pendiente de aprobación. Aparecerá en el directorio de tu barrio en menos de 24 horas.
              </p>
            </div>
          ) : (
            <div style={card}>
              <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Nombre del negocio *</label>
                    <input required value={nombre} onChange={e => setNombre(e.target.value)} placeholder="ej. Café Pergamino" style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Categoría *</label>
                    <select required value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      <option value="">Categoría…</option>
                      {GRUPOS_TIENDAS.map(g => (
                        <optgroup key={g.key} label={`${g.emoji} ${g.label}`}>
                          {g.categorias.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Barrio</label>
                    <select value={barrioId ?? ''} onChange={e => setBarrioId(e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      <option value="">Selecciona…</option>
                      {BARRIOS.filter(b => b.barrio_id !== null).map(b => (
                        <option data-i18n-skip key={b.slug} value={b.barrio_id!}>{b.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Descripción — ¿qué ofreces?</label>
                    <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={3}
                      placeholder="Cuéntales qué haces, qué te hace especial." style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Dirección</label>
                    <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Calle 10 # 40-20" style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Teléfono</label>
                    <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+57 604…" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>WhatsApp</label>
                    <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+57 310…" style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Instagram</label>
                    <input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@tunegocio" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Sitio web</label>
                    <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" style={inputStyle} />
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Foto (pega la URL de una imagen)</label>
                    <input value={fotoUrl} onChange={e => setFotoUrl(e.target.value)} placeholder="https://…/foto.jpg" style={inputStyle} />
                    {fotoUrl && <img src={fotoUrl} alt="" style={{ marginTop: 10, maxHeight: 160, borderRadius: 10, border: `1px solid ${K.line}` }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                  </div>

                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', marginTop: 8 }}>
                    {error && <p style={{ color: K.coral, fontSize: '.88rem', marginBottom: 12 }}>{error}</p>}
                    <button type="submit" disabled={loading} style={{
                      background: loading ? K.muted : K.coral, color: '#fff', border: 'none',
                      fontWeight: 800, padding: '16px 44px', borderRadius: 10,
                      cursor: loading ? 'not-allowed' : 'pointer', fontSize: '1.02rem', fontFamily: 'inherit',
                    }}>
                      {loading ? 'Enviando…' : 'Listar negocio →'}
                    </button>
                    <p style={{ fontSize: '.78rem', color: K.muted, margin: '12px 0 0' }}>
                      Revisamos cada negocio antes de publicarlo.
                    </p>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </section>
    </ComunidadLayout>
  )
}
