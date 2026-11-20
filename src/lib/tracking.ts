import { API_ENDPOINTS } from "@/config/api"
import { authHeaders, authCredentials } from "@/lib/apiClient"

// Durable per-tab session so a page reload doesn't start a new "session" and
// fragment the funnel. sessionStorage survives reloads within the tab; a fresh
// tab is genuinely a new session.
export function getSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID()
  try {
    let id = sessionStorage.getItem("ms.sid")
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("ms.sid", id) }
    return id
  } catch {
    return crypto.randomUUID()
  }
}
const SESSION_ID = getSessionId()

interface TrackData {
  entity_type?: string
  entity_id?: string
  barrio_id?: number
  duration_ms?: number
  metadata?: Record<string, unknown>
}

export async function track(event_type: string, data: TrackData = {}): Promise<void> {
  try {
    // authHeaders()+authCredentials attach the session so the API resolves
    // usuario_id for logged-in users — without it every event lands anonymous.
    await fetch(API_ENDPOINTS.track, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      credentials: authCredentials,
      body: JSON.stringify({ session_id: SESSION_ID, event_type, ...data }),
    })
  } catch {
    // Silencioso — no romper la app
  }
}

export function trackWithDuration(
  event_base: string,
  data: TrackData = {},
): () => void {
  const start = Date.now()
  track(`${event_base}_open`, data)

  return () => {
    track(`${event_base}_close`, {
      ...data,
      duration_ms: Date.now() - start,
    })
  }
}
