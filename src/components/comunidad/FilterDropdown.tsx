import { useState, useRef, useEffect } from 'react'
import { K as TOKENS } from '@/design/tokens'

const K = TOKENS

export interface DropdownOption { value: string; label: string }

// Toggle on/off de la barra de control (Gratis, 5 estrellas, WhatsApp…). Mismo
// radio/alto que FilterDropdown para que la barra lea pareja — NO la pastilla
// redonda del riel de categorías.
export function FilterToggle({ on, onClick, label, onBg = K.teal, onColor = '#fff' }: {
  on: boolean; onClick: () => void; label: string; onBg?: string; onColor?: string
}) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      border: `1.5px solid ${on ? onBg : K.line}`,
      background: on ? onBg : '#fff',
      color: on ? onColor : K.muted,
      fontWeight: 600, fontSize: 13, padding: '8px 13px', borderRadius: 10,
      cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
      transition: 'border-color .12s, background .12s, color .12s',
    }}>{label}</button>
  )
}

// Botón-menú compacto para facetas secundarias (Cuándo, Para quién, Subcategoría…).
// Reemplaza las filas de pastillas que se desbordaban: una faceta de N opciones
// cabe en un solo botón. La PRIMERA opción es el "todas/reset" — con ella elegida
// el botón se ve neutro; cualquier otra lo tiñe de teal y muestra el valor.
export function FilterDropdown({
  icon, placeholder, value, options, onChange,
}: {
  icon?: string
  placeholder: string
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const allValue = options[0]?.value
  const isSet = value !== allValue
  const current = options.find(o => o.value === value) ?? options[0]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        border: `1.5px solid ${isSet ? K.teal : K.line}`,
        background: isSet ? K.tealLight : '#fff',
        color: isSet ? K.tealDeep : K.ink,
        fontWeight: 600, fontSize: 13, padding: '8px 13px', borderRadius: 10,
        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        transition: 'border-color .12s, background .12s, color .12s',
      }}>
        {icon && <span>{icon}</span>}
        <span>{isSet ? current.label : placeholder}</span>
        <span style={{
          fontSize: 10, color: isSet ? K.tealDeep : K.tertiary,
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s',
        }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30, minWidth: 190,
          background: '#fff', border: `1px solid ${K.line}`, borderRadius: 12, padding: 6,
          boxShadow: '0 10px 30px rgba(17,20,24,.14)',
        }}>
          {options.map(o => {
            const sel = o.value === value
            return (
              <button key={o.value} type="button" className="flt-opt"
                onClick={() => { onChange(o.value); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%',
                  border: 'none', background: sel ? K.surface : 'transparent', textAlign: 'left',
                  fontFamily: 'inherit', fontSize: 14, color: sel ? K.tealDeep : K.ink,
                  fontWeight: sel ? 700 : 500, padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                }}>
                <span>{o.label}</span>
                {sel && <span style={{ color: K.teal, fontWeight: 700 }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
