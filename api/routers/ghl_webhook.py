"""GHL webhook receiver — skeleton only, esperando contrato de Talal.

Dirección por entidad:
  - listing, deal: bidireccional (confirmado 2026-08-27) -> este router los
    recibe, ghl_client.py los envía.
  - evento, tienda: bidireccional (decisión 2026-08-28, reemplaza el "solo
    salida" de 2026-08-27 para tienda) -> la administración de eventos y
    negocios locales (destacados por alcance barrio/comuna/ciudad, migración
    0079) pasa a vivir en GHL, que va a empujar hacia nuestra API. Handlers
    todavía sin implementar acá abajo — bloqueado por el mismo motivo que
    listing/deal: falta el contrato real de Talal (firma del webhook, payload
    de ejemplo, nombres de campo). tienda ya tiene el push saliente
    implementado y funcionando (push_tienda_to_ghl) — lo que falta acá es
    solo la dirección de entrada.

Todo lo que depende del contrato real (firma del webhook, nombres de campo
del payload) está sin implementar a propósito — mejor un 501 explícito que
adivinar un mapeo de payload y fallar en silencio contra datos reales.

Nada de esto arranca en el startup ni corre nada al importar el módulo — el
crash de la migración 0081 (listing.barrio_id, revertida) fue por tocar el
arranque de la app sin red de seguridad; este router no repite ese patrón,
las excepciones solo ocurren dentro del handler de la request.

Dedup: listing.id es uuid, deals.id es integer — por eso ghl_object_mapping
(migración 0082) guarda internal_object_id como TEXT con object_type como
discriminador, en vez de una tabla de mapeo por entidad.

Loop-prevention (two-way sync): cuando este receptor sí escriba en nuestra
DB, esa escritura NO debe re-emitir un evento hacia GHL — pendiente de
diseñar cuando el contrato de Talal confirme si GHL notifica sus propios
webhooks de "outbound" o si el loop hay que cortarlo acá con un flag interno.

Necesario de Talal antes de implementar upgrade():
  - Firma del webhook (header + algoritmo) -> ghl_client.verificar_webhook
  - Payload de ejemplo real por entidad (listing/deal), para saber los
    nombres de campo exactos del lado GHL
  - Si el mismo endpoint recibe ambas entidades (con un campo tipo/object en
    el payload) o si Talal expone una URL por entidad
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from api.limiter import limiter
from api.utils import ghl_client

router = APIRouter()


async def _upsert_listing_from_ghl(payload: dict) -> None:
    """Target: public.listing (uuid PK). Ver docs/GHL_DB_SCHEMA_FIELDS.pdf
    para la lista completa de columnas — falta el nombre de campo del lado
    GHL para cada una."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para listing")


async def _upsert_deal_from_ghl(payload: dict) -> None:
    """Target: public.deals (integer PK, FK tienda_id/barrio_id/ciudad_id)."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para deal")


async def _upsert_evento_from_ghl(payload: dict) -> None:
    """Target: public.eventos. Admin de eventos pasa a vivir en GHL (decisión
    2026-08-28) — falta el contrato real: nombres de campo del lado GHL para
    titulo/fecha_inicio/categoria/destacado_nivel/destacado_zona_codigo, y si
    GHL identifica el evento por id interno o por su propio object id."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para evento")


async def _upsert_tienda_from_ghl(payload: dict) -> None:
    """Target: public.tiendas. Admin de negocios locales pasa a vivir en GHL
    (decisión 2026-08-28, mismo día que evento) — push_tienda_to_ghl ya existe
    y funciona para la dirección de salida; esto es solo la entrada. Falta el
    contrato real: nombres de campo del lado GHL, y si destacado_nivel/
    destacado_zona_codigo (migración 0079) ya se agregaron como custom field
    en el Business object allá — hoy push_tienda_to_ghl tampoco los manda
    todavía, se escribió antes de esa migración."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para tienda")


async def _upsert_referidor_from_ghl(payload: dict) -> None:
    """Target: public.aplicacion_referidor (o el futuro public.referidor una
    vez que exista el paso de activación). Decisión 2026-09-20: comisión de
    afiliado/embajador vive en GHL — pero no está en su alcance actual
    (no aparece en customer_type de la migración 0084) y no hay contrato:
    falta confirmar si GHL notifica cambio de estado de la aplicación,
    asignación de `codigo`, o eventos de comisión (`referidos`), y los
    nombres de campo de cada uno. Ver docs/GHL_PENDIENTES_TALAL.md §4."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para referidor")


async def _upsert_agent_from_ghl(payload: dict) -> None:
    """Target: public.agent. Agent = Contact (confirmado 2026-10-03). Entrada
    GHL→nosotros: cuando el realtor se crea/edita/aprueba del lado GHL. Falta
    el contrato: nombres de campo del lado GHL (custom fields §4a) y si GHL
    identifica el agent por agent_internal_id (uuid nuestro) o por su contact
    id propio."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para agent")


async def _upsert_visita_from_ghl(payload: dict) -> None:
    """Target: public.visita_solicitud. Entrada GHL→nosotros: cuando un
    comprador reserva / reprograma / cancela en el Calendar del agente (GHL),
    se refleja acá (estado + fecha_visita). Falta TODO el contrato de
    Calendars/Appointments de Talal — ver §7 Visita del contrato."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para visita")


_HANDLERS = {
    "listing": _upsert_listing_from_ghl,
    "deal": _upsert_deal_from_ghl,
    "evento": _upsert_evento_from_ghl,
    "tienda": _upsert_tienda_from_ghl,
    "referidor": _upsert_referidor_from_ghl,
    "agent": _upsert_agent_from_ghl,
    "visita": _upsert_visita_from_ghl,
}


MAX_WEBHOOK_BYTES = 1_000_000


@router.post("/ghl")
@limiter.limit("120/minute")
async def recibir_webhook_ghl(request: Request):
    # 1) Authenticate from headers alone, BEFORE touching the body.
    try:
        ghl_client.autenticar_webhook(dict(request.headers))
    except ghl_client.WebhookNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ghl_client.WebhookAuthError:
        raise HTTPException(status_code=401, detail="firma de webhook inválida")
    # 2) Bounded read: Content-Length precheck + running byte limit while streaming.
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="payload demasiado grande")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_WEBHOOK_BYTES:
            raise HTTPException(status_code=413, detail="payload demasiado grande")
        chunks.append(chunk)
    try:
        event = ghl_client.parsear_evento(b"".join(chunks))
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    object_type = event.get("object_type")
    handler = _HANDLERS.get(object_type)
    if handler is None:
        raise HTTPException(status_code=400, detail=f"object_type desconocido: {object_type!r}")

    try:
        await handler(event)
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))

    return {"ok": True}
