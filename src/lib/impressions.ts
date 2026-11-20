/**
 * ALCANCE (capa 1 del funnel de demanda) — impresiones "vistas de verdad".
 *
 * Una entidad (negocio/evento/deal/listing) cuenta como ALCANCE cuando entró al
 * viewport ≥50% durante ≥1s continuo (impresión viewable, estilo IAB — no cuenta
 * el scroll de paso). Se deduplica 1 vez por entidad por sesión y se manda en
 * BATCH (no un request por tarjeta) para no martillar el API.
 *
 * Se guarda en user_events con event_type='impression' (mismo stream que views y
 * acciones → el funnel se computa con un solo JOIN por entidad/sesión).
 *
 * ponytail: una fila por impresión (deduped/sesión) en user_events. Si el volumen
 * domina, mover a tabla dedicada particionada + rollup diario (ver docs/FUNNEL_B2B.md).
 */
import { useCallback } from "react"
import { API_ENDPOINTS } from "@/config/api"
import { authHeaders, authCredentials } from "@/lib/apiClient"
import { getSessionId } from "@/lib/tracking"

export interface ImpressionPayload {
  entity_type: string
  entity_id: string
  barrio_id?: number
  categoria?: string | null
}

const DWELL_MS = 1000       // tiempo mínimo visible para contar
const RATIO = 0.5           // fracción visible mínima
const FLUSH_MS = 4000       // agrupa impresiones y manda cada 4s
const MAX_BATCH = 100       // tope por request (coincide con el backend)

const seen = new Set<string>()                 // dedupe por sesión (vida de la pestaña)
const buffer: ImpressionPayload[] = []
const payloads = new WeakMap<Element, ImpressionPayload>()
const dwellTimers = new WeakMap<Element, number>()
let observer: IntersectionObserver | null = null
let flushTimer: number | null = null

function ensureObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === "undefined") return observer
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target
        if (e.isIntersecting && e.intersectionRatio >= RATIO) {
          if (!dwellTimers.has(el)) {
            dwellTimers.set(el, window.setTimeout(() => record(el), DWELL_MS))
          }
        } else {
          const t = dwellTimers.get(el)
          if (t !== undefined) { clearTimeout(t); dwellTimers.delete(el) }
        }
      }
    },
    { threshold: [0, RATIO, 1] },
  )
  return observer
}

function record(el: Element) {
  dwellTimers.delete(el)
  const p = payloads.get(el)
  if (!p) return
  const key = `${p.entity_type}:${p.entity_id}`
  if (seen.has(key)) { observer?.unobserve(el); return }
  seen.add(key)
  buffer.push(p)
  observer?.unobserve(el)   // contada una vez, dejar de observar
  scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(flush, FLUSH_MS)
}

function flush() {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }
  if (buffer.length === 0) return
  const events = buffer.splice(0, MAX_BATCH)
  try {
    fetch(API_ENDPOINTS.trackImpressions, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: authCredentials,
      keepalive: true,          // sobrevive al cierre/navegación de la página
      body: JSON.stringify({ session_id: getSessionId(), events }),
    }).catch(() => {})
  } catch { /* nunca romper la UI por tracking */ }
  if (buffer.length) scheduleFlush()   // quedó cola > MAX_BATCH
}

if (typeof document !== "undefined") {
  // Al ocultar/cerrar la pestaña, mandar lo pendiente (keepalive lo entrega).
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush() })
  window.addEventListener("pagehide", flush)
}

/** Registra un elemento del DOM como candidato a impresión. */
export function observeImpression(el: Element | null, payload: ImpressionPayload) {
  if (!el) return
  if (seen.has(`${payload.entity_type}:${payload.entity_id}`)) return
  payloads.set(el, payload)
  ensureObserver()?.observe(el)
}

/**
 * Ref callback para tarjetas: `<div ref={useImpression({...})}>`.
 * Cuenta alcance cuando la tarjeta se ve ≥50% por ≥1s, 1 vez por sesión.
 */
export function useImpression(payload: ImpressionPayload) {
  return useCallback(
    (el: HTMLElement | null) => observeImpression(el, payload),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identidad por entidad
    [payload.entity_type, payload.entity_id, payload.barrio_id, payload.categoria],
  )
}
