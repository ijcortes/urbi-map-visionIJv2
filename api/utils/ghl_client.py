"""GoHighLevel integration — target replacement for stripe_client.py
(decided 2026-08-23: GHL becomes the single payment gateway, both COP and USD).

STATUS: skeleton only. crear_checkout_session() and verificar_webhook() raise
NotImplementedError — do not wire /suscripciones/iniciar or a /webhook/ghl
endpoint to this until the real contract exists. Needed from Talal before
those can be filled in:
  - GHL location ID + API key (or OAuth) for this account
  - Payments/Products configured in GHL with a price per PLANES key (ver
    api/config/planes.py) — need the GHL price/product ID per plan
  - Webhook signing scheme (header name + verification method) and a real
    sample payload for a completed payment + a cancelled/failed one
  - Confirmation GHL can actually process COP/PSE/Nequi (GHL Payments runs
    on Stripe under the hood — Stripe's Colombia/local-method support is
    thin; if it can't, this isn't a full COP gateway replacement)
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
from decimal import Decimal
from typing import Optional

import httpx

from api.db import get_pool

logger = logging.getLogger(__name__)

_GHL_PRIVATE_TOKEN = os.getenv("GHL_PRIVATE_TOKEN")
_GHL_LOCATION_ID = os.getenv("GHL_LOCATION_ID")
GHL_WEBHOOK_SECRET = os.getenv("GHL_WEBHOOK_SECRET")

_BASE_URL = "https://services.leadconnectorhq.com"
_VERSION = "2021-07-28"
_LISTING_OBJECT_KEY = "custom_objects.real_estate_listing"


def is_configured() -> bool:
    return bool(_GHL_PRIVATE_TOKEN and _GHL_LOCATION_ID)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_GHL_PRIVATE_TOKEN}",
        "Version": _VERSION,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
_MAX_ATTEMPTS = 3
_RETRY_BACKOFF = 0.5          # seconds; doubles each attempt (patched to 0 in tests)
_RETRY_AFTER_CAP = 5.0        # never sleep longer than this for a Retry-After header
_IDEMPOTENT = {"GET", "PUT", "DELETE", "HEAD"}
_ALLOWED_METHODS = {"POST", "PUT"}
_ALLOWED_PATH_PREFIXES = ("/contacts/", "/businesses/", "/objects/", "/associations/relations", "/opportunities/upsert")
_RETRY_STATUS_ALWAYS = {429, 502, 503, 504}   # request not processed (or safe to replay)
_RETRY_STATUS_IDEMPOTENT = {500}


def _should_retry(method: str, exc: Optional[Exception], resp: Optional[httpx.Response]) -> bool:
    """POST is NOT replayed after a read timeout / 500 (GHL may have created the
    record already -> duplicate). It is replayed when the request provably never
    ran: connect errors, 429, 502/503/504."""
    method = method.upper()
    if exc is not None:
        if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
            return True
        return method in _IDEMPOTENT and isinstance(exc, httpx.TransportError)
    if resp is not None:
        if resp.status_code in _RETRY_STATUS_ALWAYS:
            return True
        return method in _IDEMPOTENT and resp.status_code in _RETRY_STATUS_IDEMPOTENT
    return False


async def _request(method: str, path: str, **kwargs) -> httpx.Response:
    """HTTP call to GHL with timeout + bounded retries (see _should_retry).
    Raises httpx.HTTPStatusError / httpx.TransportError after the last attempt."""
    # Mínimo privilegio: el sitio solo ESCRIBE en GHL. Nunca lee ni borra.
    if method.upper() not in _ALLOWED_METHODS or not path.startswith(_ALLOWED_PATH_PREFIXES):
        raise PermissionError(f"GHL {method} {path} no permitido (solo escritura a rutas allowlist)")
    last_exc: Optional[Exception] = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        resp: Optional[httpx.Response] = None
        exc: Optional[Exception] = None
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.request(method, f"{_BASE_URL}{path}", headers=_headers(), **kwargs)
        except httpx.TransportError as e:
            exc = last_exc = e
        if resp is not None and resp.status_code < 400:
            return resp
        if attempt < _MAX_ATTEMPTS and _should_retry(method, exc, resp):
            delay = _RETRY_BACKOFF * (2 ** (attempt - 1))
            ra = resp.headers.get("retry-after") if resp is not None else None
            if ra and ra.isdigit():
                delay = max(delay, min(float(ra), _RETRY_AFTER_CAP))
            logger.warning("GHL %s %s attempt %d/%d failed (%s), retrying in %.1fs",
                           method, path, attempt, _MAX_ATTEMPTS,
                           exc.__class__.__name__ if exc else resp.status_code, delay)
            await asyncio.sleep(delay)
            continue
        if exc is not None:
            raise exc
        resp.raise_for_status()
        return resp
    raise last_exc  # pragma: no cover - loop always returns/raises


# One in-flight push per (type, id): two concurrent syncs of the same record would
# both see "no mapping yet" and each POST a new GHL record (duplicates).
_push_locks: dict[tuple[str, str], asyncio.Lock] = {}


def _serialized(object_type: str):
    """Decorator: serialize concurrent pushes of the same (type, id)."""
    def deco(fn):
        import functools

        @functools.wraps(fn)
        async def wrapper(internal_id, campos):
            async with _push_lock(object_type, internal_id):
                return await fn(internal_id, campos)
        return wrapper
    return deco


def _push_lock(object_type: str, internal_id) -> asyncio.Lock:
    return _push_locks.setdefault((object_type, str(internal_id)), asyncio.Lock())


def _split_nombre(nombre: str) -> tuple[str, str]:
    parts = (nombre or "").strip().split(None, 1)
    return (parts[0] if parts else ""), (parts[1] if len(parts) > 1 else "")


async def upsert_contact(
    *, email: Optional[str] = None, nombre: Optional[str] = None,
    phone: Optional[str] = None, tags: Optional[list] = None, source: str = "medellinsocial.com",
) -> str:
    """POST /contacts/upsert (API estándar GHL v2): crea o actualiza por email/
    teléfono dentro de la location -> sin duplicados. Solo campos estándar +
    tags (no custom fields: sus nombres/picklists aún no los confirma Talal).
    Devuelve el contact id. Levanta ValueError si no hay email ni teléfono."""
    if not (email or phone):
        raise ValueError("upsert_contact: se necesita email o teléfono")
    first, last = _split_nombre(nombre or "")
    body = {"locationId": _GHL_LOCATION_ID, "source": source}
    for k, v in (("email", email), ("phone", phone), ("firstName", first), ("lastName", last)):
        if v:
            body[k] = v
    if tags:
        body["tags"] = list(tags)
    resp = await _request("POST", "/contacts/upsert", json=body)
    return resp.json()["contact"]["id"]


# --- Opportunities (pipelines creados en GHL; IDs no son secretos) -------------
PIPELINES = {
    "realtors": ("iatpsNVgueTeBcwGuXP2", {
        "new": "e505bf40-50a1-40b8-9ab4-79110e886ce9",
        "paid": "96fb2746-744c-476a-984e-ebcb59838356"}),
    "negocios": ("goKSiZ3P2CUzWGKv7wKW", {
        "new": "2ec781cb-e050-4274-8f13-02059f07cd01"}),
    "visitas": ("hMInmdsj7m5oDcp3cdK6", {
        "new": "eb1022b4-7524-4196-8f8e-0afd55d99564"}),
    "embajadores": ("u84Fv0YilZEYnwQjXCdd", {
        "new": "01e2ec63-bdf3-4967-bc04-96ca6b80ad00"}),
}


async def upsert_opportunity(contact_id: str, pipeline: str, name: str, stage: str = "new") -> Optional[str]:
    """POST /opportunities/upsert: una oportunidad por (contacto, pipeline), sin
    duplicados. Best-effort: nunca levanta (el Contact ya quedó guardado)."""
    try:
        pid, stages = PIPELINES[pipeline]
        r = await _request("POST", "/opportunities/upsert", json={
            "locationId": _GHL_LOCATION_ID, "pipelineId": pid,
            "pipelineStageId": stages[stage], "contactId": contact_id,
            "name": name[:200], "status": "open",
        })
        return ((r.json() or {}).get("opportunity") or {}).get("id")
    except Exception as e:
        logger.error("upsert_opportunity(%s) falló: %s", pipeline, e)
        return None


async def add_contact_note(contact_id: str, body: str) -> None:
    await _request("POST", f"/contacts/{contact_id}/notes", json={"body": body[:5000]})


async def find_or_create_contact(usuario_id: int, email: str, nombre: str) -> Optional[str]:
    """Devuelve el GHL contact_id del usuario y lo persiste en
    usuarios.ghl_contact_id (el webhook puede buscar por ese ID en vez de email).
    None si GHL no está configurado."""
    if not is_configured():
        return None
    contact_id = await upsert_contact(email=email, nombre=nombre, tags=["usuario"])
    await get_pool().execute(
        "UPDATE public.usuarios SET ghl_contact_id = $1 WHERE id = $2", contact_id, usuario_id
    )
    return contact_id


async def crear_checkout_session(
    usuario_id: int,
    email: str,
    plan: str,
    success_url: str,
    cancel_url: str,
) -> Optional[str]:
    """Returns a GHL payment/checkout URL, or None if not configured.
    Mirrors stripe_client.crear_checkout_session's shape."""
    raise NotImplementedError(
        "ghl_client.crear_checkout_session: needs GHL price/product ID per plan + Payments API contract from Talal"
    )


async def cancelar_suscripcion(ghl_subscription_id: str) -> None:
    raise NotImplementedError(
        "ghl_client.cancelar_suscripcion: needs GHL subscriptions API contract from Talal"
    )


class WebhookNotConfigured(Exception):
    """GHL_WEBHOOK_SECRET missing -> the endpoint stays closed (503)."""


class WebhookAuthError(Exception):
    """Bad / missing webhook secret (401)."""


def autenticar_webhook(headers: dict) -> None:
    """Header-only authentication (no body needed, so callers can reject BEFORE
    buffering the body). Raises WebhookNotConfigured | WebhookAuthError."""
    secret = os.getenv("GHL_WEBHOOK_SECRET") or GHL_WEBHOOK_SECRET
    if not secret:
        raise WebhookNotConfigured("GHL webhook no configurado (falta GHL_WEBHOOK_SECRET)")
    h = {k.lower(): v for k, v in headers.items()}
    supplied = h.get("x-webhook-secret") or ""
    if not supplied and h.get("authorization", "").lower().startswith("bearer "):
        supplied = h["authorization"][7:].strip()
    if not supplied or not hmac.compare_digest(supplied.encode(), secret.encode()):
        raise WebhookAuthError("firma de webhook inválida")


def parsear_evento(payload: bytes) -> dict:
    try:
        event = json.loads(payload or b"")
    except (ValueError, UnicodeDecodeError):
        raise ValueError("payload no es JSON válido")
    if not isinstance(event, dict):
        raise ValueError("payload debe ser un objeto JSON")
    return event


def verificar_webhook(payload: bytes, headers: dict) -> dict:
    """Authenticate + parse an inbound GHL webhook. Returns the parsed event.

    ASSUMPTION (pending Talal's contract for GHL's native signing scheme): the GHL
    workflow "Custom Webhook" action is configured to send the shared secret in the
    `X-Webhook-Secret` header (or `Authorization: Bearer <secret>`). It is compared in
    constant time against GHL_WEBHOOK_SECRET. Closed by default: no secret in the
    environment -> WebhookNotConfigured (503), never an open endpoint.
    Raises WebhookNotConfigured | WebhookAuthError | ValueError (malformed body).
    """
    autenticar_webhook(headers)
    return parsear_evento(payload)


# ── Outbound: nuestras tablas -> GHL ─────────────────────────────────────────
# Dirección por entidad (confirmado 2026-08-27):
#   - tienda, evento: SOLO salida, estas 2 son su único camino de sync.
#   - listing, deal: bidireccional — api/routers/ghl_webhook.py cubre la
#     entrada, estas 2 cubren la salida.
# Mismo objeto de mapeo (public.ghl_object_mapping, migración 0082) sirve
# para las 4, en ambas direcciones — sync_status ahí registra el resultado
# del push.
#
# Sin wire todavía a los puntos de creación reales (listings_propios.py,
# intake_service.py para listing; tiendas/eventos/deals no tienen insert vía
# API hoy, van por scraper/admin) — eso implica tocar 3+ routers y decidir
# push síncrono vs cola/retry, mejor esperar el contrato antes de comprometerse
# a un patrón de invocación.
#
# Necesario de Talal antes de implementar cualquiera de las 4:
#   - Endpoint(s) GHL para crear/actualizar cada objeto (¿custom object API,
#     uno por tipo?) + auth
#   - Nombres de campo del lado GHL para cada columna (ver
#     docs/GHL_DB_SCHEMA_FIELDS.pdf para las columnas del lado nuestro)
#   - Rate limits / si espera llamada síncrona o admite reintentos async

# Mapeo de dropdowns confirmado en el PDF (§5) — solo los valores que Talal
# probó contra la location real. Un valor de nuestro enum que no aparezca acá
# no se inventa (podría no existir como option key en GHL y corromper el
# picklist en silencio): _map_choice() lo trata como fallo de sync, no lo manda.
_OPERACION_TO_GHL = {"venta": "sale", "arriendo": "rent"}
_TIPO_INMUEBLE_TO_GHL = {"apartamento": "apartment", "casa": "house"}
_ESTADO_TO_GHL = {"borrador": "draft", "publicado": "approved"}
_MONEDA_TO_GHL = {"COP": "cop", "USD": "usd"}


def _map_choice(value, mapping: dict, campo: str) -> Optional[str]:
    if value is None:
        return None
    try:
        return mapping[value]
    except KeyError:
        raise ValueError(f"{campo}={value!r} sin mapeo confirmado a GHL (ver §5 del PDF)")


def _yes_no(value: Optional[bool]) -> Optional[str]:
    if value is None:
        return None
    return "yes" if value else "no"


def _listing_campos_to_properties(campos: dict, listing_id: str) -> dict:
    """campos usa los nombres de columna de public.listing. Mapeo §16 del PDF.

    Deliberadamente NO incluidos (falta contrato/dato limpio de nuestro lado):
      - property_category (Residential/Commercial): no está en §16, no lo
        derivamos de tipo_inmueble sin que Talal confirme el mapeo.
      - amenities: nuestro amenidades es texto libre en español, GHL espera
        option keys en inglés (elevator/security/...) — sin diccionario de
        traducción confirmado, mejor no mandar que mandar basura.
      - floor: no existe columna piso en public.listing.
      - due_diligence_declarations: declaraciones es jsonb, forma de texto
        esperada del lado GHL sin confirmar.
      - listing_source: dropdown, PDF no documenta el picklist completo (solo
        se vio "admin" en el test record de Talal) — probado en vivo 2026-08-31,
        "medellin_social_website" da 400 Bad Request ("isn't an allowed
        option"). Sin mandar hasta tener la lista real de opciones.
    """
    props: dict = {}

    def set_(key: str, value):
        if isinstance(value, Decimal):
            value = float(value)
        if value is not None:
            props[key] = value

    set_("property_address", campos.get("direccion_aprox"))
    set_("listing_title", campos.get("titulo"))
    set_("listing_status", _map_choice(campos.get("estado"), _ESTADO_TO_GHL, "estado"))
    set_("operation", _map_choice(campos.get("operacion"), _OPERACION_TO_GHL, "operacion"))
    set_("property_type", _map_choice(campos.get("tipo_inmueble"), _TIPO_INMUEBLE_TO_GHL, "tipo_inmueble"))
    set_("municipality", campos.get("municipio"))
    set_("barrio", campos.get("barrio"))
    set_("price", campos.get("precio"))
    set_("currency", _map_choice(campos.get("moneda"), _MONEDA_TO_GHL, "moneda"))
    set_("administration_hoa_fee", campos.get("administracion"))
    set_("area_m2", campos.get("area_m2"))
    set_("lot_area_m2", campos.get("area_lote_m2"))
    set_("bedrooms", campos.get("habitaciones"))
    set_("bathrooms", campos.get("banos"))
    set_("parking_spaces", campos.get("parqueaderos"))
    if campos.get("estrato") is not None:
        props["estrato"] = str(campos["estrato"])  # GHL lo devuelve como string
    set_("property_age_years", campos.get("antiguedad_anios"))
    set_("listing_description", campos.get("descripcion"))
    set_("video_url", campos.get("video_url"))
    set_("virtual_tour_url", campos.get("tour_url"))
    set_("furnished", _yes_no(campos.get("amoblado")))
    set_("pets_allowed", _yes_no(campos.get("mascotas")))
    set_("airbnb_allowed", _yes_no(campos.get("permite_airbnb")))
    set_("contact_name", campos.get("nombre_contacto"))
    set_("contact_phone", campos.get("telefono"))
    set_("contact_email", campos.get("email_contacto"))
    set_("preferred_contact_hours", campos.get("horario_contacto"))
    set_("featured", _yes_no(campos.get("destacado")))
    set_("verified", _yes_no(campos.get("verificado")))
    set_("exact_address_public", _yes_no(campos.get("mostrar_exacto")))
    props["website_listing_id"] = str(listing_id)
    return props


async def _record_sync_result(
    object_type: str, internal_id: str, ghl_id: str, status: str, error: Optional[str]
) -> None:
    pool = get_pool()
    if status == "synced":
        try:
            await pool.execute(
                "UPDATE public.ghl_push_failures SET resolved_at = now() "
                "WHERE object_type = $1 AND internal_object_id = $2 AND resolved_at IS NULL",
                object_type, str(internal_id),
            )
        except Exception:
            logger.exception("ghl_push_failures resolve(%s, %s)", object_type, internal_id)
    await pool.execute(
        """
        INSERT INTO public.ghl_object_mapping
            (object_type, internal_object_id, ghl_object_id, ghl_location_id, sync_status, sync_error, last_synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (object_type, internal_object_id) DO UPDATE SET
            ghl_object_id = EXCLUDED.ghl_object_id,
            sync_status = EXCLUDED.sync_status,
            sync_error = EXCLUDED.sync_error,
            last_synced_at = now()
        """,
        object_type, str(internal_id), ghl_id, _GHL_LOCATION_ID, status, error,
    )


async def _record_push_failure(object_type: str, internal_id, error: str) -> None:
    """First-time push that failed: there is no mapping row (ghl_object_id is
    NOT NULL there), so keep it in ghl_push_failures for a later retry instead
    of only logging it. Never raises (best-effort, same as the push itself)."""
    try:
        await get_pool().execute(
            """
            INSERT INTO public.ghl_push_failures (object_type, internal_object_id, error)
            VALUES ($1, $2, $3)
            ON CONFLICT (object_type, internal_object_id) WHERE resolved_at IS NULL
            DO UPDATE SET error = EXCLUDED.error, attempts = ghl_push_failures.attempts + 1,
                          last_failed_at = now()
            """,
            object_type, str(internal_id), (error or "")[:2000],
        )
    except Exception:
        logger.exception("no se pudo registrar ghl_push_failures(%s, %s)", object_type, internal_id)


@_serialized("listing")
async def push_listing_to_ghl(listing_id: str, campos: dict) -> Optional[str]:
    """listing_id es uuid (public.listing.id). Retorna ghl_object_id o None
    si no está configurado o si el push falla (best-effort — nunca levanta
    para no romper el flujo del caller; ver guardrail #7 del blueprint)."""
    if not is_configured():
        return None

    pool = get_pool()
    existing = await pool.fetchrow(
        "SELECT ghl_object_id FROM public.ghl_object_mapping WHERE object_type = 'listing' AND internal_object_id = $1",
        str(listing_id),
    )

    try:
        properties = _listing_campos_to_properties(campos, listing_id)
    except ValueError as e:
        logger.warning("push_listing_to_ghl(%s): %s", listing_id, e)
        if existing:
            await _record_sync_result("listing", listing_id, existing["ghl_object_id"], "failed", str(e))
        else:
            await _record_push_failure("listing", listing_id, str(e))
        return None

    try:
        if existing:
            ghl_id = existing["ghl_object_id"]
            await _request(
                "PUT",
                f"/objects/{_LISTING_OBJECT_KEY}/records/{ghl_id}",
                params={"locationId": _GHL_LOCATION_ID},
                json={"properties": properties},
            )
        else:
            resp = await _request(
                "POST",
                f"/objects/{_LISTING_OBJECT_KEY}/records",
                json={"locationId": _GHL_LOCATION_ID, "properties": properties},
            )
            ghl_id = resp.json()["record"]["id"]
    except Exception as e:
        logger.error("push_listing_to_ghl(%s) falló (sin reintentos restantes): %s", listing_id, e)
        if existing:
            await _record_sync_result("listing", listing_id, existing["ghl_object_id"], "failed", str(e))
        else:
            await _record_push_failure("listing", listing_id, str(e))
        return None

    await _record_sync_result("listing", listing_id, ghl_id, "synced", None)
    return ghl_id


_LISTING_SELECT_COLS = """
    direccion_aprox, titulo, estado::text AS estado, operacion::text AS operacion,
    tipo_inmueble::text AS tipo_inmueble, municipio, barrio, precio, moneda,
    administracion, area_m2, area_lote_m2, habitaciones, banos, parqueaderos,
    estrato, antiguedad_anios, descripcion, video_url, tour_url, amoblado,
    mascotas, permite_airbnb, nombre_contacto, telefono, email_contacto,
    horario_contacto, destacado, verificado, mostrar_exacto
"""


async def sync_listing(listing_id: str) -> Optional[str]:
    """Lee el estado actual de public.listing y lo empuja a GHL. Único punto
    que arma `campos` desde la DB — los call sites (crear/editar/cambiar
    estado, 8 sitios entre routers/services) solo llaman esto después de su
    commit, no repiten el mapeo de columnas cada uno."""
    if not is_configured():
        return None
    pool = get_pool()
    row = await pool.fetchrow(
        f"SELECT {_LISTING_SELECT_COLS} FROM public.listing WHERE id = $1", listing_id
    )
    if row is None:
        return None
    return await push_listing_to_ghl(listing_id, dict(row))


# precio_rango en tiendas usa literalmente los símbolos $/$$/$$$/$$$$ (mismo
# check constraint que el picklist de la UI de GHL) — mapeo confirmado §11.
_PRECIO_RANGO_TO_GHL = {"$": "budget", "$$": "moderate", "$$$": "upscale", "$$$$": "luxury"}
_BUSINESS_OBJECT_KEY = "business"


def _tienda_campos_to_standard(campos: dict) -> dict:
    """Campos estándar de Company, van por /businesses/ (§9), no por Objects API."""
    props: dict = {}

    def set_(key: str, value):
        if value is not None:
            props[key] = value

    set_("name", campos.get("nombre"))
    set_("phone", campos.get("telefono"))
    set_("website", campos.get("website"))
    set_("address", campos.get("direccion"))
    set_("city", campos.get("ciudad_nombre"))
    set_("description", campos.get("descripcion"))
    return props


def _tienda_campos_to_custom(campos: dict) -> dict:
    """Los 16 custom fields del Business, van por /objects/business/records/ (§10).

    Deliberadamente NO incluidos (sin picklist confirmado o sin columna fuente):
      - business_category: nuestro categoria tiene 29 valores, el PDF solo dio
        un ejemplo ("cafe", que ni siquiera está en nuestra lista) — sin el
        picklist real de Talal, mejor no mandar que mandar basura.
      - business_listing_status: no hay columna equivalente en tiendas (solo
        activo/verificado bool) — derivar el estado sería inventar lógica de
        negocio no pedida.
      - membership_plan: nuestro plan es código en minúscula
        (free/hotspot/featured), el ejemplo del PDF es texto tipo "Featured
        Business" — formato distinto, sin confirmar si hay picklist.
      - email: no existe columna email en tiendas.
    """
    props: dict = {}

    def set_(key: str, value):
        if value is not None:
            props[key] = value

    set_("business_subcategory", campos.get("subcategoria"))
    set_("barrio", campos.get("barrio_nombre"))
    set_("whatsapp", campos.get("whatsapp"))
    set_("instagram", campos.get("instagram"))
    set_("google_place_id", campos.get("google_place_id"))
    set_("price_range", _map_choice(campos.get("precio_rango"), _PRECIO_RANGO_TO_GHL, "precio_rango"))
    set_("verified", _yes_no(campos.get("verificado")))
    set_("featured", _yes_no(campos.get("destacado")))
    set_("featured_badge", _yes_no(campos.get("featured_badge")))
    if campos.get("featured_desde") is not None:
        props["featured_since"] = campos["featured_desde"].isoformat()
    if campos.get("horario") is not None:
        # ponytail: serialización placeholder (jsonb → texto plano). El PDF
        # dice que operating_hours es texto libre del lado GHL y que la
        # conversión a estructura le toca al website, no a GHL — falta un
        # formateador "horario bonito"; por ahora un dump legible sirve.
        import json as _json
        props["operating_hours"] = _json.dumps(campos["horario"], ensure_ascii=False)
    rating = campos.get("rating_google")
    if isinstance(rating, Decimal):
        rating = float(rating)
    if rating is not None:
        props["google_rating"] = rating
    set_("active", _yes_no(campos.get("activo")))
    return props


@_serialized("tienda")
async def push_tienda_to_ghl(tienda_id: int, campos: dict) -> Optional[str]:
    """tienda_id es integer (public.tiendas.id). Retorna ghl_object_id o None
    si no está configurado o si el push falla (best-effort, nunca lanza)."""
    if not is_configured():
        return None

    pool = get_pool()
    existing = await pool.fetchrow(
        "SELECT ghl_object_id FROM public.ghl_object_mapping WHERE object_type = 'tienda' AND internal_object_id = $1",
        str(tienda_id),
    )

    try:
        standard = _tienda_campos_to_standard(campos)
        custom = _tienda_campos_to_custom(campos)
    except ValueError as e:
        logger.warning("push_tienda_to_ghl(%s): %s", tienda_id, e)
        if existing:
            await _record_sync_result("tienda", tienda_id, existing["ghl_object_id"], "failed", str(e))
        else:
            await _record_push_failure("tienda", tienda_id, str(e))
        return None

    try:
        if existing:
            ghl_id = existing["ghl_object_id"]
            await _request("PUT", f"/businesses/{ghl_id}", params={"locationId": _GHL_LOCATION_ID}, json=standard)
        else:
            resp = await _request(
                "POST", "/businesses/", json={**standard, "locationId": _GHL_LOCATION_ID}
            )
            ghl_id = resp.json()["business"]["id"]
        if custom:
            await _request(
                "PUT",
                f"/objects/{_BUSINESS_OBJECT_KEY}/records/{ghl_id}",
                params={"locationId": _GHL_LOCATION_ID},
                json={"properties": custom},
            )
    except Exception as e:
        logger.warning("push_tienda_to_ghl(%s) falló: %s", tienda_id, e)
        if existing:
            await _record_sync_result("tienda", tienda_id, existing["ghl_object_id"], "failed", str(e))
        else:
            await _record_push_failure("tienda", tienda_id, str(e))
        return None

    await _record_sync_result("tienda", tienda_id, ghl_id, "synced", None)
    return ghl_id


_TIENDA_SELECT = """
    SELECT t.nombre, t.descripcion, t.subcategoria, t.direccion, t.telefono,
           t.whatsapp, t.instagram, t.website, t.google_place_id,
           t.precio_rango, t.rating_google, t.activo, t.verificado, t.destacado,
           t.featured_badge, t.featured_desde, t.horario,
           b.nombre AS barrio_nombre, c.nombre AS ciudad_nombre
    FROM public.tiendas t
    LEFT JOIN raw.barrios b ON b.id = t.barrio_id
    LEFT JOIN public.ciudades c ON c.id = t.ciudad_id
    WHERE t.id = $1
"""


async def sync_tienda(tienda_id: int) -> Optional[str]:
    """Lee el estado actual de public.tiendas (+ barrio/ciudad resueltos) y
    lo empuja a GHL. Mismo patrón que sync_listing."""
    if not is_configured():
        return None
    pool = get_pool()
    row = await pool.fetchrow(_TIENDA_SELECT, tienda_id)
    if row is None:
        return None
    return await push_tienda_to_ghl(tienda_id, dict(row))


# ── Agency (Business en GHL, entidad interna distinta de tienda) ────────────

def _agency_campos_to_standard(campos: dict) -> dict:
    props: dict = {}
    if campos.get("nombre") is not None:
        props["name"] = campos["nombre"]
    return props


def _agency_campos_to_custom(campos: dict) -> dict:
    """public.agency casi no tiene columnas (nombre/nit/tipo/verificada/plan,
    sin dirección/teléfono/website) — el Business que sale en GHL nace flaco
    a propósito, no se inventan datos que no tenemos."""
    props: dict = {}
    yn = _yes_no(campos.get("verificada"))
    if yn is not None:
        props["verified"] = yn
    return props


@_serialized("agency")
async def push_agency_to_ghl(agency_id: str, campos: dict) -> Optional[str]:
    if not is_configured():
        return None

    pool = get_pool()
    existing = await pool.fetchrow(
        "SELECT ghl_object_id FROM public.ghl_object_mapping WHERE object_type = 'agency' AND internal_object_id = $1",
        str(agency_id),
    )
    standard = _agency_campos_to_standard(campos)
    custom = _agency_campos_to_custom(campos)

    try:
        if existing:
            ghl_id = existing["ghl_object_id"]
            await _request("PUT", f"/businesses/{ghl_id}", params={"locationId": _GHL_LOCATION_ID}, json=standard)
        else:
            resp = await _request(
                "POST", "/businesses/", json={**standard, "locationId": _GHL_LOCATION_ID}
            )
            ghl_id = resp.json()["business"]["id"]
        if custom:
            await _request(
                "PUT",
                f"/objects/{_BUSINESS_OBJECT_KEY}/records/{ghl_id}",
                params={"locationId": _GHL_LOCATION_ID},
                json={"properties": custom},
            )
    except Exception as e:
        logger.warning("push_agency_to_ghl(%s) falló: %s", agency_id, e)
        if existing:
            await _record_sync_result("agency", agency_id, existing["ghl_object_id"], "failed", str(e))
        else:
            await _record_push_failure("agency", agency_id, str(e))
        return None

    await _record_sync_result("agency", agency_id, ghl_id, "synced", None)
    return ghl_id


async def sync_agency(agency_id: str) -> Optional[str]:
    if not is_configured():
        return None
    pool = get_pool()
    row = await pool.fetchrow("SELECT nombre, verificada FROM public.agency WHERE id = $1", agency_id)
    if row is None:
        return None
    return await push_agency_to_ghl(agency_id, dict(row))


# ── Associations (§6-7 del PDF) ──────────────────────────────────────────────
# IDs fijos de la location — hardcodeados a propósito (§18 quirk #8: el
# listado genérico GET /associations da 404, no está validado).
_ASSOC_LISTING_AGENT = "6a9030a31a03372600cf77c7"     # Contact  -> Listing
_ASSOC_PROPERTY_OWNER = "6a9030a3b1739b9f7dd6262e"    # Contact  -> Listing
_ASSOC_LISTING_AGENCY = "6a9030a3a6611a605762fc43"    # Business -> Listing


async def _create_relation(association_id: str, first_record_id: str, second_record_id: str) -> bool:
    """True si quedó creada (o ya existía — duplicado tratado como no-op,
    §7.3 del PDF: crear la misma relación 2 veces es 'expected behavior')."""
    try:
        await _request(
            "POST",
            "/associations/relations",
            json={
                "locationId": _GHL_LOCATION_ID,
                "associationId": association_id,
                "firstRecordId": first_record_id,
                "secondRecordId": second_record_id,
            },
        )
        return True
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 400 and "duplicate" in e.response.text.lower():
            return True
        logger.warning("_create_relation(%s) falló: %s", association_id, e.response.text)
        return False
    except Exception as e:
        logger.warning("_create_relation(%s) falló: %s", association_id, e)
        return False


async def link_agency_to_listing(listing_id: str, agency_id: Optional[str]) -> None:
    """Empuja/actualiza la agencia como Business y crea la relación Agency→Listing.
    No hace nada si no hay agency_id (listing de owner sin agencia) o si el
    listing todavía no tiene ghl_object_id (sync_listing debe correr antes)."""
    if not is_configured() or not agency_id:
        return
    pool = get_pool()
    listing_row = await pool.fetchrow(
        "SELECT ghl_object_id FROM public.ghl_object_mapping WHERE object_type = 'listing' AND internal_object_id = $1",
        str(listing_id),
    )
    if not listing_row:
        logger.warning("link_agency_to_listing(%s): listing sin sync a GHL todavía", listing_id)
        return
    ghl_business_id = await sync_agency(agency_id)
    if not ghl_business_id:
        return
    await _create_relation(_ASSOC_LISTING_AGENCY, ghl_business_id, listing_row["ghl_object_id"])


# ── Evento → Custom Object "event" (§1 del contrato, bidireccional) ──────────
# Custom object, como listing (no Business). Nombres de campo = §1 de
# docs/GHL_CONTRATO_PROPUESTO.md — código y doc deben coincidir.
#
# categoria/tipo_audiencia son picklists NUESTROS (enums que definimos), por eso
# se mandan en crudo sin _map_choice: a diferencia de los dropdowns de listing
# (definidos por GHL), acá el contrato de valores lo ponemos nosotros y Talal
# crea el picklist con esos keys. Ver §1 para la lista de valores.
#
# eventos NO tiene columna moneda → currency se manda constante "cop".
# website_event_id / website_barrio_id: ids internos ocultos para que el inbound
# (nombres→ids es lossy) pueda resolver barrio_id y el evento sin adivinar.
_EVENTO_OBJECT_KEY = "custom_objects.event"  # propuesto; Talal confirma el key real


def _evento_campos_to_properties(campos: dict, evento_id: int) -> dict:
    props: dict = {}

    def set_(key: str, value):
        if isinstance(value, Decimal):
            value = float(value)
        if value is not None:
            props[key] = value

    set_("event_title", campos.get("titulo"))
    set_("event_description", campos.get("descripcion"))
    set_("category", campos.get("categoria"))
    set_("audience_type", campos.get("tipo_audiencia"))
    set_("municipality", campos.get("municipio"))
    set_("neighborhood", campos.get("barrio_nombre"))
    if campos.get("fecha_inicio") is not None:
        fi = campos["fecha_inicio"]
        props["start_date"] = fi.isoformat() if hasattr(fi, "isoformat") else fi
    if campos.get("fecha_fin") is not None:
        ff = campos["fecha_fin"]
        props["end_date"] = ff.isoformat() if hasattr(ff, "isoformat") else ff
    set_("price", campos.get("precio"))
    props["currency"] = "cop"  # eventos no tiene columna moneda — siempre COP
    set_("is_free", _yes_no(campos.get("gratuito")))
    set_("external_url", campos.get("url_externo"))
    set_("photo_url", campos.get("foto_url"))
    set_("organizer", campos.get("organizador"))
    set_("max_attendees", campos.get("max_asistentes"))
    set_("is_active", _yes_no(campos.get("activo")))
    set_("is_featured", _yes_no(campos.get("destacado")))
    set_("featured_scope", campos.get("destacado_nivel"))
    set_("featured_zone_code", campos.get("destacado_zona_codigo"))
    set_("source", campos.get("fuente"))
    props["website_event_id"] = str(evento_id)
    if campos.get("barrio_id") is not None:
        props["website_barrio_id"] = str(campos["barrio_id"])
    return props


@_serialized("evento")
async def push_evento_to_ghl(evento_id: int, campos: dict) -> Optional[str]:
    """evento_id = public.eventos.id (integer). Custom object custom_objects.event.
    Best-effort, nunca lanza (mismo patrón que push_tienda/push_listing).

    ⚠️ NO wireado a ningún call site todavía (submit/aprobar/editar): custom_objects.event
    aún no existe del lado GHL — conectarlo ahora dispararía POSTs 400 contra la
    location real (hay creds en .env → is_configured()=True). Wire cuando Talal
    confirme el objeto creado (ver §1 del contrato y nota en ghl_client.py:216)."""
    if not is_configured():
        return None

    pool = get_pool()
    existing = await pool.fetchrow(
        "SELECT ghl_object_id FROM public.ghl_object_mapping WHERE object_type = 'evento' AND internal_object_id = $1",
        str(evento_id),
    )
    properties = _evento_campos_to_properties(campos, evento_id)

    try:
        if existing:
            ghl_id = existing["ghl_object_id"]
            await _request(
                "PUT",
                f"/objects/{_EVENTO_OBJECT_KEY}/records/{ghl_id}",
                params={"locationId": _GHL_LOCATION_ID},
                json={"properties": properties},
            )
        else:
            resp = await _request(
                "POST",
                f"/objects/{_EVENTO_OBJECT_KEY}/records",
                json={"locationId": _GHL_LOCATION_ID, "properties": properties},
            )
            ghl_id = resp.json()["record"]["id"]
    except Exception as e:
        logger.warning("push_evento_to_ghl(%s) falló: %s", evento_id, e)
        if existing:
            await _record_sync_result("evento", evento_id, existing["ghl_object_id"], "failed", str(e))
        else:
            await _record_push_failure("evento", evento_id, str(e))
        return None

    await _record_sync_result("evento", evento_id, ghl_id, "synced", None)
    return ghl_id


_EVENTO_SELECT = """
    SELECT e.titulo, e.descripcion, e.categoria, e.tipo_audiencia, e.barrio_id,
           e.fecha_inicio, e.fecha_fin, e.precio, e.gratuito, e.url_externo,
           e.foto_url, e.organizador, e.max_asistentes, e.activo, e.destacado,
           e.destacado_nivel, e.destacado_zona_codigo, e.fuente,
           b.nombre AS barrio_nombre, b.municipio AS municipio
    FROM public.eventos e
    LEFT JOIN raw.barrios b ON b.id = e.barrio_id
    WHERE e.id = $1
"""


async def sync_evento(evento_id: int) -> Optional[str]:
    """Lee public.eventos (+ barrio/municipio) y lo empuja a GHL. Mismo patrón que
    sync_tienda. NO wireado todavía (ver push_evento_to_ghl)."""
    if not is_configured():
        return None
    pool = get_pool()
    row = await pool.fetchrow(_EVENTO_SELECT, evento_id)
    if row is None:
        return None
    return await push_evento_to_ghl(evento_id, dict(row))


async def push_deal_to_ghl(deal_id: int, campos: dict) -> Optional[str]:
    raise NotImplementedError("ghl_client.push_deal_to_ghl: falta contrato GHL para deal")


# ── Referidor (afiliado/embajador) — comisión por negocio referido ──────────
# Decisión 2026-09-20: todo pago vive en GHL, referidor incluido — pero, a
# diferencia de tienda/listing, acá no hay NADA confirmado con Talal todavía:
# ni credenciales, ni Contacts API (find_or_create_contact arriba también es
# stub — no hay un push de Contact funcionando del cual copiar el shape real),
# ni nombres de custom field. `contact_type`/`referidor_codigo`/
# `referidor_tipo`/`referidor_zona`/`comision_pct` en
# docs/GHL_PENDIENTES_TALAL.md §4 son PROPUESTA nuestra, no contrato — no se
# mandan hasta que Talal los confirme (mismo criterio que _map_choice arriba:
# mejor 501 explícito que adivinar un campo y corromper algo en silencio).
#
# Necesario de Talal antes de implementar:
#   - Credenciales (GHL_PRIVATE_TOKEN/LOCATION_ID) + confirmar que Contacts
#     API es el objeto correcto (no un custom object aparte, como listing)
#   - Nombres reales de los custom fields propuestos en el PDF/doc
#   - Si el `codigo` de referido se genera acá o lo asigna GHL

async def push_referidor_to_ghl(referidor_id: int, campos: dict) -> Optional[str]:
    """aplicacion_referidor -> Contact en GHL (lead del programa), con tag por
    tipo y una nota con la aplicación. La comisión/Referral object queda para
    Affiliate Manager (contrato de Talal pendiente). Best-effort: no levanta."""
    try:
        tipo = campos.get("tipo") or "afiliado"
        contact_id = await upsert_contact(
            email=campos.get("email"), nombre=campos.get("nombre"),
            phone=campos.get("telefono"), tags=["referidor", f"referidor-{tipo}"],
        )
        await add_contact_note(contact_id, (
            f"Aplicación {tipo} #{referidor_id}\nCanal: {campos.get('canal')}\n"
            f"Experiencia: {campos.get('experiencia')}\nMotivación: {campos.get('motivacion')}"
        ))
        await upsert_opportunity(contact_id, "embajadores", f"{tipo.capitalize()}: {campos.get('nombre') or referidor_id}")
        return contact_id
    except Exception as e:
        logger.error("push_referidor_to_ghl(%s) falló: %s", referidor_id, e)
        await _record_push_failure("referidor", referidor_id, str(e))
        return None


_REFERIDOR_SELECT = """
    SELECT tipo, nombre, email, telefono, canal, barrio_id, experiencia, motivacion
    FROM public.aplicacion_referidor WHERE id = $1
"""


async def sync_referidor(referidor_id: int) -> Optional[str]:
    """Lee aplicacion_referidor y empuja a GHL. Mismo patrón que sync_tienda/
    sync_listing: no-op si no hay credenciales configuradas (siempre el caso
    hoy — is_configured() corta antes de llegar al stub de arriba)."""
    if not is_configured():
        return None
    pool = get_pool()
    row = await pool.fetchrow(_REFERIDOR_SELECT, referidor_id)
    if row is None:
        return None
    return await push_referidor_to_ghl(referidor_id, dict(row))


# ── Agent (Realtor) → Contact ───────────────────────────────────────────────
# Tipo de objeto confirmado por Talal 2026-10-03 (Agent = Contact). El push
# real sigue bloqueado: depende de find_or_create_contact() (arriba, stub),
# que necesita el JSON exacto de POST /contacts (Talal ya lo probó → 201,
# falta recibir el payload de Postman). Mapeo propuesto en §4a del contrato
# (docs/GHL_CONTRATO_PROPUESTO.md): firstName/lastName (split de nombre),
# email, phone=telefono, contact_type="agent", agent_internal_id=id,
# agent_status=estado, agent_status_reason=motivo_estado, profile_photo_url=
# foto_url. NO se arma el payload acá todavía: sin el JSON real sería adivinar
# la forma de los custom fields (mismo criterio que _map_choice).

async def push_agent_to_ghl(agent_id: str, campos: dict) -> Optional[str]:
    """public.agent -> Contact en GHL (confirmado por Talal). Solo campos
    estándar + tags (agent, agent-<estado>); los custom fields agent_* se suman
    cuando Talal confirme nombres/picklists. Best-effort: no levanta."""
    try:
        contact_id = await upsert_contact(
            email=campos.get("email"), nombre=campos.get("nombre"),
            phone=campos.get("telefono"),
            tags=["agent", f"agent-{campos.get('estado') or 'pending'}"],
        )
    except Exception as e:
        logger.error("push_agent_to_ghl(%s) falló: %s", agent_id, e)
        await _record_push_failure("agent", agent_id, str(e))
        return None
    await upsert_opportunity(
        contact_id, "realtors", f"Realtor: {campos.get('nombre') or agent_id}",
        stage="paid" if campos.get("estado") == "activo" else "new",
    )
    await _record_sync_result("agent", agent_id, contact_id, "synced", None)
    return contact_id


_AGENT_SELECT = """
    SELECT nombre, email, telefono, estado::text AS estado, motivo_estado, foto_url
    FROM public.agent WHERE id = $1
"""


async def sync_agent(agent_id: str) -> Optional[str]:
    """Lee public.agent y lo empuja a GHL como Contact. Mismo patrón que
    sync_referidor: no-op sin credenciales (caso de prod hoy). En local SÍ hay
    creds → llega al stub y levanta, por eso los call sites envuelven en
    try/except (como afiliados/embajadores)."""
    if not is_configured():
        return None
    pool = get_pool()
    row = await pool.fetchrow(_AGENT_SELECT, agent_id)
    if row is None:
        return None
    return await push_agent_to_ghl(agent_id, dict(row))


# ── Visita (solicitud de cita a un listing) → Appointment / Calendar ────────
# NO está en el contrato de Talal todavía — ningún §lo cubre. Flujo pedido por
# negocio: el botón "Agendar visita" lleva al comprador a la página de
# disponibilidad del agente (GHL Calendar booking). Eso implica que cada agent
# tenga un Calendar en GHL + booking URL — nada de eso existe ni se ha hablado
# con Talal. Sin contrato NO se arma mapeo de campos (a diferencia de evento/
# deal/referidor, que sí tenían mapeo propuesto). Ver §7 Visita del contrato.

async def push_negocio_lead_to_ghl(lead_id, campos: dict) -> Optional[str]:
    """leads_negocio -> Contact (tag negocio-local) + nota + oportunidad en
    pipeline "Local Businesses". Best-effort: no levanta."""
    if not is_configured():
        return None
    try:
        contact_id = await upsert_contact(
            email=campos.get("email"), nombre=campos.get("nombre_negocio"),
            phone=campos.get("telefono"), tags=["negocio-local"],
        )
        await add_contact_note(contact_id, (
            f"Aplicación negocio #{lead_id}\nNegocio: {campos.get('nombre_negocio')}\n"
            f"Categoría: {campos.get('categoria')}\nBarrio: {campos.get('barrio_id')}\n"
            f"Plan: {campos.get('plan_tipo')}\nMensaje: {campos.get('mensaje')}"
        ))
        await upsert_opportunity(contact_id, "negocios", f"Negocio: {campos.get('nombre_negocio')}")
        return contact_id
    except Exception as e:
        logger.error("push_negocio_lead_to_ghl(%s) falló: %s", lead_id, e)
        await _record_push_failure("negocio", lead_id, str(e))
        return None


async def push_visita_to_ghl(visita_id: str, campos: dict) -> Optional[str]:
    """visita_solicitud -> Contact (el comprador) con tag y nota de la visita
    pedida. El Calendar/Appointment por agente sigue pendiente de Talal. Si la
    solicitud no trae teléfono ni email no hay con qué crear el Contact. Best-effort."""
    try:
        contact_id = await upsert_contact(
            email=campos.get("email"), nombre=campos.get("nombre"),
            phone=campos.get("telefono"), tags=["visita-solicitada"],
        )
        await add_contact_note(contact_id, (
            f"Solicitud de visita #{visita_id}\nListing: {campos.get('listing_url')}\n"
            f"Fecha pedida: {campos.get('fecha_visita')}\nMensaje: {campos.get('mensaje')}\n"
            f"Agente: {campos.get('agent_id')}"
        ))
        await upsert_opportunity(contact_id, "visitas", f"Visita: {campos.get('listing_url') or visita_id}")
        return contact_id
    except Exception as e:
        logger.error("push_visita_to_ghl(%s) falló: %s", visita_id, e)
        await _record_push_failure("visita", visita_id, str(e))
        return None


_VISITA_SELECT = """
    SELECT listing_url, nombre, telefono, fecha_visita, mensaje, agent_id
    FROM public.visita_solicitud WHERE id = $1
"""


async def sync_visita(visita_id: str) -> Optional[str]:
    """Lee public.visita_solicitud y la empuja a GHL. Mismo patrón que
    sync_agent/sync_referidor."""
    if not is_configured():
        return None
    pool = get_pool()
    row = await pool.fetchrow(_VISITA_SELECT, visita_id)
    if row is None:
        return None
    return await push_visita_to_ghl(visita_id, dict(row))
