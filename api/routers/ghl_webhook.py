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

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from api.db import get_pool
from api.limiter import limiter
from api.utils import ghl_client

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


async def _upsert_listing_from_ghl(payload: dict) -> None:
    """Target: public.listing (uuid PK). Ver docs/GHL_DB_SCHEMA_FIELDS.pdf
    para la lista completa de columnas — falta el nombre de campo del lado
    GHL para cada una."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para listing")


async def _upsert_deal_from_ghl(payload: dict) -> None:
    """Target: public.deals (integer PK, FK tienda_id/barrio_id/ciudad_id)."""
    raise NotImplementedError("ghl_webhook: falta contrato de payload para deal")


def _parse_dt(v):
    """ISO string → naive datetime (eventos.fecha_* son TIMESTAMP sin tz)."""
    if not v:
        return None
    return datetime.fromisoformat(str(v).replace("Z", "+00:00")).replace(tzinfo=None)


def _as_bool(v):
    if isinstance(v, bool):
        return v
    if v is None:
        return None
    return str(v).strip().lower() in ("yes", "true", "1")


# Reverse de ghl_client._evento_campos_to_properties — mismos nombres de campo
# (§1 del contrato). Solo mapea lo que GHL manda; None se descarta para que el
# UPDATE sea parcial (no pisa columnas que el payload no trae).
def _evento_payload_to_row(props: dict) -> dict:
    row = {
        "titulo": props.get("event_title"),
        "descripcion": props.get("event_description"),
        "categoria": props.get("category"),
        "tipo_audiencia": props.get("audience_type"),
        "fecha_inicio": _parse_dt(props.get("start_date")),
        "fecha_fin": _parse_dt(props.get("end_date")),
        "precio": props.get("price"),
        "gratuito": _as_bool(props.get("is_free")),
        "url_externo": props.get("external_url"),
        "foto_url": props.get("photo_url"),
        "organizador": props.get("organizer"),
        "max_asistentes": props.get("max_attendees"),
        "activo": _as_bool(props.get("is_active")),
        "destacado": _as_bool(props.get("is_featured")),
        "destacado_nivel": props.get("featured_scope"),
        "destacado_zona_codigo": props.get("featured_zone_code"),
        "barrio_id": int(props["website_barrio_id"]) if str(props.get("website_barrio_id") or "").isdigit() else None,
    }
    return {k: v for k, v in row.items() if v is not None}


async def _link_mapping(pool, object_type: str, internal_id, ghl_object_id) -> None:
    """Registra/actualiza la identidad internal↔GHL en ghl_object_mapping, para que
    el próximo webcall (entrada o salida) resuelva el record sin adivinar."""
    if not ghl_object_id:
        return
    await pool.execute(
        """
        INSERT INTO public.ghl_object_mapping
            (object_type, internal_object_id, ghl_object_id, ghl_location_id, sync_status, last_synced_at)
        VALUES ($1, $2, $3, $4, 'synced', now())
        ON CONFLICT (object_type, internal_object_id) DO UPDATE SET
            ghl_object_id = EXCLUDED.ghl_object_id, sync_status = 'synced', last_synced_at = now()
        """,
        object_type, str(internal_id), str(ghl_object_id), ghl_client._GHL_LOCATION_ID,
    )


async def _upsert_evento_from_ghl(payload: dict) -> None:
    """Target: public.eventos (GHL es la fuente: crea/edita/aprueba/rechaza).

    Identidad: `website_event_id` (nuestro id, que mandamos en el outbound) si GHL
    lo trae; si no, el `ghl_object_id` resuelto vía public.ghl_object_mapping; si
    tampoco, es un evento nacido en GHL → INSERT nuevo con fuente='interno'
    (bucket admin, evita migrar el CHECK de fuente) y fuente_id NULL (no tocar el
    índice UNIQUE(fuente,fuente_id) — la identidad vive en ghl_object_mapping).

    Loop-prevention: NO llama sync_evento — una escritura de entrada no debe
    re-emitir el evento hacia GHL."""
    props = payload.get("properties") or payload
    ghl_object_id = payload.get("ghl_object_id") or props.get("ghl_object_id") or payload.get("id")
    website_event_id = props.get("website_event_id") or payload.get("website_event_id")

    pool = get_pool()
    internal_id = None
    if str(website_event_id or "").isdigit():
        internal_id = int(website_event_id)
    elif ghl_object_id:
        internal_id = await pool.fetchval(
            "SELECT internal_object_id::int FROM public.ghl_object_mapping "
            "WHERE object_type = 'evento' AND ghl_object_id = $1",
            str(ghl_object_id),
        )

    row = _evento_payload_to_row(props)

    if internal_id:
        if row:
            sets = [f"{col} = ${i + 1}" for i, col in enumerate(row)]
            params = list(row.values()) + [internal_id]
            updated = await pool.fetchval(
                f"UPDATE public.eventos SET {', '.join(sets)}, updated_at = NOW() "
                f"WHERE id = ${len(params)} RETURNING id",
                *params,
            )
            if updated is None:
                raise ValueError(f"evento {internal_id} no existe")
        await _link_mapping(pool, "evento", internal_id, ghl_object_id)
        return

    # INSERT — evento nacido en GHL
    if not row.get("titulo") or not row.get("fecha_inicio"):
        raise ValueError("evento nuevo requiere event_title y start_date")
    row.setdefault("activo", False)   # nace pendiente hasta que GHL lo marque activo
    row["fuente"] = "interno"
    cols = list(row)
    placeholders = [f"${i + 1}" for i in range(len(cols))]
    new_id = await pool.fetchval(
        f"INSERT INTO public.eventos ({', '.join(cols)}) VALUES ({', '.join(placeholders)}) RETURNING id",
        *row.values(),
    )
    await _link_mapping(pool, "evento", new_id, ghl_object_id)


# Reverse de los mapeos de salida de ghl_client (_tienda_campos_to_standard +
# _tienda_campos_to_custom). §2 del contrato.
_PRICE_RANGE_FROM_GHL = {"budget": "$", "moderate": "$$", "upscale": "$$$", "luxury": "$$$$"}
# business_listing_status (Pending/Approved/Published/Rejected) → activo (§2)
_LISTING_STATUS_ACTIVE = {"approved": True, "published": True, "pending": False, "rejected": False}


def _tienda_payload_to_row(props: dict) -> dict:
    # activo: business_listing_status manda; si no viene, cae a `active`
    activo = None
    status = props.get("business_listing_status")
    if status is not None:
        activo = _LISTING_STATUS_ACTIVE.get(str(status).strip().lower())
    elif props.get("active") is not None:
        activo = _as_bool(props.get("active"))
    row = {
        "nombre": props.get("name"),
        "telefono": props.get("phone"),
        "website": props.get("website"),
        "direccion": props.get("address"),
        "descripcion": props.get("description"),
        "subcategoria": props.get("business_subcategory"),
        "whatsapp": props.get("whatsapp"),
        "instagram": props.get("instagram"),
        "google_place_id": props.get("google_place_id"),
        "precio_rango": _PRICE_RANGE_FROM_GHL.get(str(props.get("price_range") or "").lower()),
        "verificado": _as_bool(props.get("verified")),
        "destacado": _as_bool(props.get("featured")),
        "featured_badge": _as_bool(props.get("featured_badge")),
        "featured_desde": _parse_dt(props.get("featured_since")),
        "rating_google": props.get("google_rating"),
        "activo": activo,
        "destacado_nivel": props.get("featured_scope"),
        "destacado_zona_codigo": props.get("featured_zone_code"),
        "categoria": props.get("business_category"),
        "barrio_id": int(props["website_barrio_id"]) if str(props.get("website_barrio_id") or "").isdigit() else None,
    }
    # ponytail: `operating_hours` (jsonb horario) se omite — encoding dict→jsonb en
    # asyncpg es fiddly y es bajo valor; agregar con codec si GHL edita horarios.
    return {k: v for k, v in row.items() if v is not None}


async def _upsert_tienda_from_ghl(payload: dict) -> None:
    """Target: public.tiendas (GHL es la fuente del admin de negocios locales).

    Salida (push_tienda_to_ghl) ya existe y está wired (admin aprobar/editar →
    sync_tienda); esto es la ENTRADA. Identidad: `website_business_id` (nuestro id)
    si GHL lo trae; si no, `ghl_object_id` vía ghl_object_mapping (ese mapeo ya lo
    mantiene el push de salida); si tampoco, INSERT nuevo (negocio nacido en GHL).

    Loop-prevention: NO llama sync_tienda — entrada no re-emite salida."""
    props = payload.get("properties") or payload
    ghl_object_id = payload.get("ghl_object_id") or props.get("ghl_object_id") or payload.get("id")
    website_business_id = props.get("website_business_id") or payload.get("website_business_id")

    pool = get_pool()
    internal_id = None
    if str(website_business_id or "").isdigit():
        internal_id = int(website_business_id)
    elif ghl_object_id:
        internal_id = await pool.fetchval(
            "SELECT internal_object_id::int FROM public.ghl_object_mapping "
            "WHERE object_type = 'tienda' AND ghl_object_id = $1",
            str(ghl_object_id),
        )

    row = _tienda_payload_to_row(props)

    if internal_id:
        if row:
            sets = [f"{col} = ${i + 1}" for i, col in enumerate(row)]
            params = list(row.values()) + [internal_id]
            updated = await pool.fetchval(
                f"UPDATE public.tiendas SET {', '.join(sets)}, updated_at = NOW() "
                f"WHERE id = ${len(params)} RETURNING id",
                *params,
            )
            if updated is None:
                raise ValueError(f"tienda {internal_id} no existe")
        await _link_mapping(pool, "tienda", internal_id, ghl_object_id)
        return

    # INSERT — negocio nacido en GHL
    if not row.get("nombre"):
        raise ValueError("negocio nuevo requiere name")
    row.setdefault("activo", False)   # nace pendiente hasta aprobación
    cols = list(row)
    placeholders = [f"${i + 1}" for i in range(len(cols))]
    new_id = await pool.fetchval(
        f"INSERT INTO public.tiendas ({', '.join(cols)}) VALUES ({', '.join(placeholders)}) RETURNING id",
        *row.values(),
    )
    await _link_mapping(pool, "tienda", new_id, ghl_object_id)


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


async def _activar_slot_realtor_preferido(payload: dict) -> None:
    """Pago aprobado en Stripe (vía GHL) -> activa/renueva el slot de Realtor Preferido.

    Payload (workflow GHL "Pago aprobado"): {object_type:"realtor_slot", agent_email | agent_id,
    zona_nivel:"barrio"|"comuna", zona_codigo, meses (def. 1), pago_ref (id de la orden)}.
    Idempotente por pago_ref: reenviar el mismo pago no extiende dos veces."""
    from api.services.realtor_preferido_service import SlotError, procesar_pago_slot

    props = payload.get("properties") or payload
    pool = get_pool()
    agent_id = props.get("agent_id")
    email = (props.get("agent_email") or "").strip().lower()
    zona_nivel, zona_codigo = props.get("zona_nivel"), str(props.get("zona_codigo") or "")
    pago_ref = props.get("pago_ref")
    if not zona_codigo or (not agent_id and not email):
        raise HTTPException(status_code=400, detail="falta agent_id/agent_email o zona_codigo")
    try:
        meses = max(1, min(12, int(props.get("meses") or 1)))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="meses inválido")
    async with pool.acquire() as conn:
        if not agent_id:
            agent_id = await conn.fetchval(
                "SELECT id::text FROM agent WHERE lower(email) = $1 AND estado::text = 'activo'", email)
        if not agent_id:
            raise HTTPException(status_code=404, detail="agente activo no encontrado")
    try:
        await procesar_pago_slot(pool, str(agent_id), zona_nivel, zona_codigo, meses, pago_ref)
    except SlotError as e:
        # Dinero cobrado pero sin slot: requiere acción humana (reasignar o reembolsar).
        logger.error("realtor_slot PAGO SIN SLOT pago_ref=%s agent=%s zona=%s/%s: %s",
                     pago_ref, agent_id, zona_nivel, zona_codigo, e)
        raise HTTPException(status_code=409, detail=str(e))


_HANDLERS = {
    "listing": _upsert_listing_from_ghl,
    "deal": _upsert_deal_from_ghl,
    "evento": _upsert_evento_from_ghl,
    "tienda": _upsert_tienda_from_ghl,
    "referidor": _upsert_referidor_from_ghl,
    "agent": _upsert_agent_from_ghl,
    "visita": _upsert_visita_from_ghl,
    "realtor_slot": _activar_slot_realtor_preferido,
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
