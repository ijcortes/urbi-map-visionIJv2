import { seo } from '@/lib/seo'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { API_ENDPOINTS } from '@/config/api'
import { apiFetch } from '@/lib/apiClient'
import { getToken } from '@/lib/apiClient'
import { BARRIOS } from '@/components/comunidad/BarrioContext'
import { ComunidadLayout } from '@/components/comunidad/ComunidadLayout'
import { CATEGORIAS_EVENTOS } from '@/lib/categorias_comunidad'
import { K as TOKENS } from '@/design/tokens'

export const Route = createFileRoute('/eventos/crear')({
  component: CrearEventoPage,
  head: () => seo({ title: 'Publica tu evento · Medellín Social', description: 'Comparte tu evento con tu barrio. Pega el link si ya lo publicaste en Luma u otra parte y traemos los datos.', path: '/eventos/crear' }),
})

const K = TOKENS

interface Prefill {
  titulo?: string | null
  descripcion?: string | null
  foto_url?: string | null
  fecha_inicio?: string | null
  fecha_fin?: string | null
  gratuito?: boolean
  precio?: number
  organizador?: string | null
  url_externo?: string | null
}

// ISO (2026-11-11T17:30:00-05:00) → datetime-local value (2026-11-11T17:30)
const toLocalInput = (iso?: string | null) => (iso ? iso.slice(0, 16) : '')

function CrearEventoPage() {
  const loggedIn = !!getToken()

  const [titulo, setTitulo] = useState('')
  const [urlExterno, setUrlExterno] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [categoria, setCategoria] = useState('')
  const [barrioId, setBarrioId] = useState<number | null>(null)
  const [organizador, setOrganizador] = useState('')
  const [gratuito, setGratuito] = useState(true)
  const [precio, setPrecio] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fotoUrl, setFotoUrl] = useState('')

  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
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

  async function handleImport() {
    if (!urlExterno.trim()) return
    setImporting(true); setImportMsg('')
    try {
      const d = await apiFetch<Prefill>(API_ENDPOINTS.importarEvento, {
        method: 'POST', body: JSON.stringify({ url: urlExterno.trim() }),
      })
      if (d.titulo) setTitulo(d.titulo)
      if (d.descripcion) setDescripcion(d.descripcion)
      if (d.foto_url) setFotoUrl(d.foto_url)
      if (d.fecha_inicio) setFechaInicio(toLocalInput(d.fecha_inicio))
      if (d.fecha_fin) setFechaFin(toLocalInput(d.fecha_fin))
      if (d.organizador) setOrganizador(d.organizador)
      if (typeof d.gratuito === 'boolean') setGratuito(d.gratuito)
      if (d.precio) setPrecio(String(Math.round(d.precio)))
      if (d.url_externo) setUrlExterno(d.url_externo)
      setImportMsg('ok')
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'No pudimos leer ese link')
    } finally {
      setImporting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await apiFetch(API_ENDPOINTS.crearEvento, {
        method: 'POST',
        body: JSON.stringify({
          titulo,
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin || null,
          descripcion: descripcion || null,
          categoria: categoria || null,
          barrio_id: barrioId,
          organizador: organizador || null,
          gratuito,
          precio: gratuito ? 0 : Number(precio || 0),
          url_externo: urlExterno || null,
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
            Eventos
          </p>
          <h1 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: 'clamp(1.8rem,4vw,2.6rem)', color: K.ink, margin: '0 0 10px' }}>
            Publica tu evento
          </h1>
          <p style={{ color: K.muted, fontSize: '1.02rem', margin: '0 0 28px', lineHeight: 1.5 }}>
            Compártelo con tu barrio. Lo revisamos y aparece en el mapa en menos de 24 horas.
          </p>

          {!loggedIn ? (
            <div style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 42, marginBottom: 14 }}>🔒</div>
              <h2 style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.4rem', color: K.ink, margin: '0 0 10px' }}>
                Inicia sesión para publicar
              </h2>
              <p style={{ color: K.muted, marginBottom: 20 }}>Necesitas una cuenta para subir un evento.</p>
              <a href="/login?redirect=/eventos/crear" style={{
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
                ¡Recibimos tu evento!
              </h2>
              <p style={{ color: K.muted, lineHeight: 1.6 }}>
                Queda pendiente de aprobación. Aparecerá en el mapa de tu barrio en menos de 24 horas.
              </p>
            </div>
          ) : (
            <div style={card}>
              {/* Importar desde link */}
              <div style={{ background: K.paper, border: `1px solid ${K.line}`, borderRadius: 12, padding: '18px 18px', marginBottom: 28 }}>
                <label style={labelStyle}>¿Ya lo publicaste? Pega el link (Luma, Eventbrite…)</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    value={urlExterno} onChange={e => setUrlExterno(e.target.value)}
                    placeholder="https://lu.ma/tu-evento" style={{ ...inputStyle, flex: '1 1 240px' }}
                  />
                  <button type="button" onClick={handleImport} disabled={importing || !urlExterno.trim()}
                    style={{
                      background: importing ? K.muted : K.teal, color: '#fff', border: 'none',
                      fontWeight: 800, padding: '12px 20px', borderRadius: 8,
                      cursor: importing || !urlExterno.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    }}>
                    {importing ? 'Leyendo…' : 'Traer datos'}
                  </button>
                </div>
                {importMsg === 'ok' && <p style={{ color: K.teal, fontSize: '.84rem', margin: '8px 0 0' }}>✓ Datos traídos — revísalos abajo.</p>}
                {importMsg && importMsg !== 'ok' && <p style={{ color: K.coral, fontSize: '.84rem', margin: '8px 0 0' }}>{importMsg}</p>}
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Nombre del evento *</label>
                    <input required value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="ej. Noche de jazz en Provenza" style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Empieza *</label>
                    <input required type="datetime-local" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Termina (opcional)</label>
                    <input type="datetime-local" value={fechaFin} onChange={e => setFechaFin(e.target.value)} style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Categoría</label>
                    <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      <option value="">Categoría…</option>
                      {CATEGORIAS_EVENTOS.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
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

                  <div>
                    <label style={labelStyle}>Organiza</label>
                    <input value={organizador} onChange={e => setOrganizador(e.target.value)} placeholder="Tú o tu negocio" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Precio</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '.9rem', color: K.ink, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        <input type="checkbox" checked={gratuito} onChange={e => setGratuito(e.target.checked)} /> Gratis
                      </label>
                      {!gratuito && (
                        <input type="number" min={0} value={precio} onChange={e => setPrecio(e.target.value)} placeholder="COP" style={{ ...inputStyle, flex: 1 }} />
                      )}
                    </div>
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Descripción — ¿qué es, qué verán?</label>
                    <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={4}
                      placeholder="Cuéntales de qué trata, qué va a pasar, por qué venir." style={{ ...inputStyle, resize: 'vertical' }} />
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
                      {loading ? 'Enviando…' : 'Publicar evento →'}
                    </button>
                    <p style={{ fontSize: '.78rem', color: K.muted, margin: '12px 0 0' }}>
                      Revisamos cada evento antes de publicarlo.
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
