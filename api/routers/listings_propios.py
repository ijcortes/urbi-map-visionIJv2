"""Publicación directa de listings — owner/agente publica vía tabla `listing`.

Agentes verificados → 'publicado' + verificado=true (salen al mapa de inmediato).
Propietarios (no agentes) → 'en_revision' (requieren aprobación admin antes de
aparecer en el mapa). Las declaraciones legales van en listing.declaraciones.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import uuid
from types import SimpleNamespace
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, Request
from api.limiter import limiter
from pydantic import BaseModel, Field

from api.db import get_pool
from api.dependencies import get_current_user
from api.schemas.intake_cuestionario import DECLARACIONES_KEYS, cuestionario_para
from api.services.asignador_service import asignar_intake
from api.services.intake_service import _aplica, get_or_create_owner
from api.services.listing_service import datos_minimos_completos
from api.utils import ghl_client
from api.utils.email import ADMIN_EMAIL, _wrap, esc, send_email
from api.utils.storage import read_upload_bounded, upload_file
from api.utils.pii import mask_email

logger = logging.getLogger(__name__)

router = APIRouter()

_APP_URL = os.getenv("APP_URL", "https://medellin.social")
_COP_TO_USD = 4200.0

# Enum listing_operacion solo tiene venta|arriendo.
_OPERACION_MAP = {"venta": "venta", "arriendo": "arriendo"}


def _to_bool(v: Optional[str]) -> Optional[bool]:
    """'si'/'true'→True, 'no'/'false'→False, 'consultar'/'no_se'/None→None."""
    if v in ("si", "true", "True", "1"):
        return True
    if v in ("no", "false", "False", "0"):
        return False
    return None


# Hosts permitidos para embeber tour 3D/video en iframe. Debe coincidir con la
# whitelist del front (ListingDrawer). Evita embeber URLs arbitrarias (clickjacking).
_ALLOWED_EMBED_HOSTS = (
    "matterport.com", "my.matterport.com", "kuula.co", "cloudpano.com",
    "istaging.com", "ricoh360.com", "insta360.com", "youtube.com",
    "youtu.be", "vimeo.com",
)


def _safe_embed_url(url: Optional[str]) -> Optional[str]:
    """Devuelve la URL si su host (o subdominio) está en la whitelist; si no, None.
    Sanea en el insert para no persistir URLs no embebibles."""
    if not url:
        return None
    from urllib.parse import urlparse
    try:
        host = (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        return None
    if any(host == h or host.endswith("." + h) for h in _ALLOWED_EMBED_HOSTS):
        return url.strip()
    return None


def _validar_declaraciones(operacion: str, obj: dict) -> None:
    """Exige las declaraciones legales obligatorias del cuestionario (venta/arriendo),
    honrando condicional_si. Espejo de _validar_payload sobre el subconjunto legal."""
    for preg in cuestionario_para(operacion):
        if preg["id"] not in DECLARACIONES_KEYS:
            continue
        if _aplica(preg, obj) and preg.get("obligatoria") and obj.get(preg["id"]) is None:
            raise HTTPException(400, f"Falta declaración legal: {preg['texto']}")


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_agente_id(pool, user_id: int) -> Optional[int]:
    row = await pool.fetchrow(
        "SELECT id FROM agentes WHERE usuario_id = $1 AND estado = 'aprobado'",
        user_id,
    )
    return row["id"] if row else None


async def _es_agente_activo(pool, user_id: int) -> bool:
    """True si es agente aprobado en el sistema legacy (`agentes`) o activo en
    el sistema nuevo (`agent`) — dos tablas de agente que no se sincronizan
    entre sí (ver realtor.py/admin_agentes.py para el sistema nuevo)."""
    return await pool.fetchval(
        """SELECT EXISTS(SELECT 1 FROM agentes WHERE usuario_id = $1 AND estado = 'aprobado')
                OR EXISTS(SELECT 1 FROM agent WHERE usuario_id = $1 AND estado = 'activo')""",
        user_id,
    )


# ── GET /barrios-form ──────────────────────────────────────────────────────────

@router.get("/barrios-form")
async def barrios_form():
    """Return lightweight barrios list for cascading dropdowns in the publish form."""
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT
            id,
            nombre,
            municipio,
            COALESCE(NULLIF(TRIM(comuna), ''), municipio) AS comuna
        FROM raw.barrios
        WHERE nombre IS NOT NULL
          AND municipio IS NOT NULL
          AND excluir_inversion IS NOT TRUE
        ORDER BY municipio, COALESCE(NULLIF(TRIM(comuna), ''), municipio), nombre
        """
    )
    return [dict(r) for r in rows]


# ── GET /me ────────────────────────────────────────────────────────────────────

@router.get("/me")
async def my_tipo(current_user: dict = Depends(get_current_user)):
    """Return whether the current user is a verified agente."""
    pool = get_pool()
    agente_id = await _get_agente_id(pool, current_user["id"])
    return {
        "es_agente": await _es_agente_activo(pool, current_user["id"]),
        "agente_id": agente_id,
        "nombre": f"{current_user.get('nombre', '')} {current_user.get('apellido', '')}".strip(),
        "email": current_user.get("email", ""),
    }


# ── Verificación de teléfono (OTP) ─────────────────────────────────────────────

class OtpEnviarRequest(BaseModel):
    telefono: str = Field(min_length=7, max_length=30)


_OTP_MAX_INTENTOS = 5


class OtpConfirmarRequest(BaseModel):
    codigo: str = Field(min_length=4, max_length=10)


@router.post("/verificar-telefono/enviar")
@limiter.limit("3/minute")
async def otp_enviar(request: Request, req: OtpEnviarRequest, current_user: dict = Depends(get_current_user)):
    """Genera y envía el código de verificación del teléfono del owner.

    ponytail: canal email (único proveedor configurado); cambiar a SMS/WhatsApp
    cuando haya proveedor, el resto del flujo no cambia.
    """
    pool = get_pool()
    owner_id = await get_or_create_owner(current_user, pool)
    codigo = f"{secrets.randbelow(1_000_000):06d}"
    await pool.execute(
        "UPDATE owner SET telefono = $1, otp_codigo = $2, otp_intentos = 0, "
        "otp_expira = NOW() + INTERVAL '10 minutes', telefono_verificado = FALSE "
        "WHERE id = $3::uuid",
        req.telefono, codigo, owner_id,
    )
    try:
        await send_email(
            current_user["email"],
            "Tu código de verificación — Medellín Social",
            _wrap(f"""
              <h3 style="color:#1D9E75">Verifica tu teléfono</h3>
              <p>Tu código para publicar en Medellín Social:</p>
              <p style="font-size:28px;font-weight:700;letter-spacing:6px">{codigo}</p>
              <p style="font-size:13px;color:#62736d">Vence en 10 minutos. Si no fuiste tú, ignora este correo.</p>
            """),
        )
    except Exception:
        logger.exception("OTP: fallo enviando email a %s", mask_email(current_user["email"]))
    return {"enviado": True, "canal": "email"}


@router.post("/verificar-telefono/confirmar")
@limiter.limit("10/minute")
async def otp_confirmar(request: Request, req: OtpConfirmarRequest, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    owner_id = await get_or_create_owner(current_user, pool)
    ok = await pool.fetchval(
        "UPDATE owner SET telefono_verificado = TRUE, otp_codigo = NULL, otp_expira = NULL, otp_intentos = 0 "
        "WHERE id = $1::uuid AND otp_codigo = $2 AND otp_expira > NOW() "
        "AND otp_intentos < $3 RETURNING TRUE",
        owner_id, req.codigo, _OTP_MAX_INTENTOS,
    )
    if not ok:
        # Per-account cap (the per-IP limit alone allows a distributed guess of
        # the 6 digits): after N wrong codes the code is burned, ask for a new one.
        await pool.execute(
            "UPDATE owner SET otp_intentos = otp_intentos + 1, "
            "otp_codigo = CASE WHEN otp_intentos + 1 >= $2 THEN NULL ELSE otp_codigo END "
            "WHERE id = $1::uuid AND otp_codigo IS NOT NULL",
            owner_id, _OTP_MAX_INTENTOS,
        )
        raise HTTPException(400, "Código inválido o vencido")
    return {"telefono_verificado": True}


# ── POST / ─────────────────────────────────────────────────────────────────────

@router.post("/", status_code=201)
async def crear_listing(
    # Paso 1
    tipo_operacion:    str            = Form(...),
    tipo_inmueble:     str            = Form(...),
    precio_cop:        float          = Form(...),
    administracion_cop: Optional[float] = Form(None),
    # Paso 2
    area_m2:           Optional[float] = Form(None),
    area_lote_m2:      Optional[float] = Form(None),
    habitaciones:      Optional[int]   = Form(None),
    banos:             Optional[float] = Form(None),
    parqueaderos:      Optional[int]   = Form(None),
    estrato:           Optional[int]   = Form(None),
    piso:              Optional[int]   = Form(None),
    nombre_edificio:   Optional[str]   = Form(None),
    antiguedad:        Optional[str]   = Form(None),
    amoblado:          Optional[bool]  = Form(None),
    amenidades:        Optional[str]   = Form(None),   # JSON array string
    mascotas:          Optional[str]   = Form("consultar"),
    permite_airbnb:    Optional[str]   = Form("no_se"),
    # Paso 3
    barrio_id:         Optional[int]   = Form(None),
    direccion:         Optional[str]   = Form(None),
    matricula_inmobiliaria: Optional[str] = Form(None),  # folio ORIP — llave de registro
    cedula_catastral:  Optional[str]   = Form(None),      # CBML / catastro — llave de parcela
    lat:               Optional[float] = Form(None),
    lon:               Optional[float] = Form(None),
    descripcion:       Optional[str]   = Form(None),
    tour_url:          Optional[str]   = Form(None),   # tour 3D/360 (Matterport, Kuula…)
    video_url:         Optional[str]   = Form(None),   # video (YouTube, Vimeo)
    # Paso 4
    nombre_contacto:   Optional[str]   = Form(None),
    telefono:          Optional[str]   = Form(None),
    email_contacto:    Optional[str]   = Form(None),
    horario_contacto:  Optional[str]   = Form(None),
    # Cuestionario legal (JSON: {en_propiedad_horizontal, al_dia_predial, ...})
    declaraciones:     Optional[str]   = Form(None),
    acepta_terminos:   bool            = Form(...),
    acepta_propietario: bool           = Form(...),
    acepta_comision:   Optional[bool]  = Form(None),
    # Files
    fotos: Optional[List[UploadFile]]  = File(None),
    current_user: dict = Depends(get_current_user),
):
    if not acepta_terminos or not acepta_propietario:
        raise HTTPException(400, "Debes aceptar los términos y confirmar propiedad")
    if lat is None or lon is None:
        raise HTTPException(400, "Falta la ubicación (pin en el mapa)")
    if not (direccion or "").strip():
        raise HTTPException(400, "La dirección exacta es obligatoria")

    pool = get_pool()
    operacion = _OPERACION_MAP.get(tipo_operacion)
    if operacion is None:
        raise HTTPException(400, f"Operación inválida: {tipo_operacion}")

    # Declaraciones legales obligatorias por operación (espejo del cuestionario).
    declaraciones_obj = {}
    if declaraciones:
        try:
            declaraciones_obj = json.loads(declaraciones)
        except Exception:
            raise HTTPException(400, "Declaraciones legales con formato inválido")
    _validar_declaraciones(operacion, declaraciones_obj)

    agente_id = await _get_agente_id(pool, current_user["id"])
    es_agente = await _es_agente_activo(pool, current_user["id"])
    owner_id = await get_or_create_owner(current_user, pool)

    # Anti-spam (equivalente a la llamada de verificación de Zillow FSBO):
    # un owner no publica sin teléfono verificado. Los agentes ya pasaron
    # verificación de identidad, no repiten OTP.
    if not es_agente:
        verificado = await pool.fetchval(
            "SELECT telefono_verificado FROM owner WHERE id = $1::uuid", owner_id
        )
        if not verificado:
            raise HTTPException(403, "telefono_no_verificado")

    # Barrio/municipio denormalizados desde raw.barrios (listing guarda texto).
    barrio_nom = municipio_nom = None
    if barrio_id is not None:
        brow = await pool.fetchrow(
            "SELECT nombre, municipio FROM raw.barrios WHERE id = $1", barrio_id
        )
        if brow:
            barrio_nom, municipio_nom = brow["nombre"], brow["municipio"]

    amenidades_arr = []
    if amenidades:
        try:
            amenidades_arr = json.loads(amenidades)
        except Exception:
            pass

    titulo = f"{tipo_inmueble.capitalize()} en {operacion} · {barrio_nom or municipio_nom or 'Medellín'}"

    # Guardia de datos mínimos (mismo que la máquina de estados). Ningún listing
    # incompleto se publica, aunque el request salte el front.
    fotos_validas = [f for f in (fotos or []) if f.filename and f.size and f.size > 0]
    chk = datos_minimos_completos(SimpleNamespace(
        tipo_inmueble=tipo_inmueble, operacion=operacion, precio=precio_cop,
        geom=True, barrio=barrio_nom, municipio=municipio_nom, area_m2=area_m2,
        titulo=titulo, fotos_portada=len(fotos_validas),
        habitaciones=habitaciones, banos=banos,
    ))
    if not chk["ok"]:
        raise HTTPException(400, "Faltan datos mínimos: " + ", ".join(chk["faltan"]))

    foto_urls: list[str] = []
    for f in fotos_validas:
        foto_urls.append(await upload_file(await read_upload_bounded(f), f.filename or "foto.jpg", folder="listings"))

    listing_id = str(uuid.uuid4())
    slug = f"{(municipio_nom or 'med')[:6]}-{listing_id[:8]}".lower().replace(" ", "-")

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO listing (
                    id, slug, owner_id, agent_id, agency_id, estado, verificado,
                    geom, municipio, barrio, direccion_aprox, mostrar_exacto,
                    operacion, precio, moneda, administracion,
                    tipo_inmueble, area_m2, area_lote_m2, habitaciones, banos,
                    parqueaderos, estrato, antiguedad_anios,
                    amoblado, amenidades, mascotas, permite_airbnb,
                    titulo, descripcion,
                    nombre_contacto, telefono, email_contacto, horario_contacto,
                    declaraciones, destacado, tour_url, video_url, nombre_edificio,
                    matricula_inmobiliaria, cedula_catastral,
                    published_at, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, NULL, NULL,
                    CASE WHEN $34 THEN 'publicado'::listing_estado ELSE 'en_revision'::listing_estado END,
                    $34,
                    ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, FALSE,
                    $9, $10, 'COP', $11,
                    $12, $13, $14, $15, $16,
                    $17, $18, $19,
                    $20, $21, $22, $23,
                    $24, $25,
                    $26, $27, $28, $29,
                    $30::jsonb, $31, $32, $33, $35, $36, $37, NOW(), NOW(), NOW()
                )
                """,
                listing_id, slug, owner_id,
                lon, lat, municipio_nom, barrio_nom, direccion,
                operacion, precio_cop, administracion_cop,
                tipo_inmueble, area_m2, area_lote_m2, habitaciones, banos,
                parqueaderos, estrato, antiguedad,
                amoblado, amenidades_arr,
                _to_bool(mascotas), _to_bool(permite_airbnb),
                titulo, descripcion,
                nombre_contacto, telefono, email_contacto, horario_contacto,
                json.dumps(declaraciones_obj), es_agente,
                _safe_embed_url(tour_url), _safe_embed_url(video_url),
                es_agente,  # $34: estado/verificado CASE
                nombre_edificio,  # $35
                (matricula_inmobiliaria or "").strip() or None,  # $36
                (cedula_catastral or "").strip() or None,        # $37
            )
            for i, url in enumerate(foto_urls):
                await conn.execute(
                    "INSERT INTO listing_media (listing_id, url, orden, es_portada) "
                    "VALUES ($1, $2, $3, $4)",
                    listing_id, url, i, i == 0,
                )

    await ghl_client.sync_listing(listing_id)

    # Puente al inbox del realtor: la publicación del owner crea un intake y el
    # asignador lo entrega (zona patrocinada → realtor; sin patrocinador → pool).
    if not es_agente:
        try:
            intake_id = str(uuid.uuid4())
            zona_codigo = str(barrio_id) if barrio_id is not None else None
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO intake (
                        id, owner_id, listing_id, estado, operacion, tipo_inmueble,
                        geom, municipio, barrio, zona_nivel, zona_codigo,
                        direccion_aprox, precio_esperado, area_m2, habitaciones,
                        banos, declaraciones
                    ) VALUES (
                        $1, $2, $3, 'nuevo', $4, $5,
                        ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, 'barrio', $10,
                        $11, $12, $13, $14, $15, $16::jsonb
                    )
                    """,
                    intake_id, owner_id, listing_id, operacion, tipo_inmueble,
                    lon, lat, municipio_nom, barrio_nom, zona_codigo,
                    direccion, precio_cop, area_m2, habitaciones, banos,
                    json.dumps(declaraciones_obj),
                )
            await asignar_intake(
                SimpleNamespace(
                    id=intake_id, estado="nuevo", agent_id=None,
                    zona_codigo=zona_codigo, geom=f"POINT({lon} {lat})",
                ),
                pool,
            )
        except Exception:
            # El listing ya está publicado; la asignación no puede tumbar el flujo.
            logger.exception("crear_listing: intake/asignación falló para listing %s", listing_id)

    await _notify_admin_new_listing(
        listing_id=listing_id, tipo_inmueble=tipo_inmueble,
        tipo_operacion=operacion, precio_cop=precio_cop,
        nombre_contacto=nombre_contacto, email_contacto=email_contacto,
    )

    if es_agente:
        return {
            "id": listing_id,
            "estado": "publicado",
            "verificado": True,
            "es_agente": True,
            "mensaje": "Tu propiedad ya está en el mapa.",
        }
    return {
        "id": listing_id,
        "estado": "en_revision",
        "verificado": False,
        "es_agente": False,
        "mensaje": "Tu propiedad está en revisión. La publicaremos en el mapa una vez verificada.",
    }


# ── GET /mis-listings ──────────────────────────────────────────────────────────

@router.get("/mis-listings")
async def mis_listings(current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    owner_id = await pool.fetchval(
        "SELECT id::text FROM owner WHERE usuario_id = $1", current_user["id"]
    )
    if not owner_id:
        return []
    rows = await pool.fetch(
        """
        SELECT l.id::text AS id, l.operacion AS tipo_operacion, l.tipo_inmueble,
               l.precio AS precio_cop, l.area_m2, l.habitaciones, l.estado,
               l.verificado, l.destacado, l.created_at, l.descripcion,
               l.direccion_aprox AS direccion, l.barrio, l.municipio,
               ST_Y(l.geom) AS lat, ST_X(l.geom) AS lon,
               COALESCE(
                   (SELECT array_agg(m.url ORDER BY m.orden) FROM listing_media m
                    WHERE m.listing_id = l.id), '{}'
               ) AS fotos,
               (SELECT i.estado::text FROM intake i WHERE i.listing_id = l.id
                ORDER BY i.created_at DESC LIMIT 1) AS verificacion_estado,
               -- Métricas de desempeño del listing (dashboard owner). Clave de join:
               -- l.id::text / l.slug (igual que mapa, favoritos y visitas).
               (SELECT COUNT(*) FROM public.user_events e
                 WHERE e.event_type = 'listing_view'
                   AND e.entity_id IN (l.id::text, l.slug)) AS vistas_total,
               (SELECT COUNT(*) FROM public.user_events e
                 WHERE e.event_type = 'listing_view'
                   AND e.entity_id IN (l.id::text, l.slug)
                   AND e.created_at > NOW() - INTERVAL '30 days') AS vistas_30d,
               (SELECT COUNT(*) FROM public.favoritos f
                 WHERE f.listing_uid IN (l.id::text, l.slug)) AS favoritos,
               (SELECT COUNT(*) FROM visita_solicitud v
                 WHERE v.listing_url IN (l.id::text, l.slug)) AS visitas_total,
               (SELECT COUNT(*) FROM visita_solicitud v
                 WHERE v.listing_url IN (l.id::text, l.slug)
                   AND v.estado = 'pendiente') AS visitas_pendientes
        FROM listing l
        WHERE l.owner_id = $1
        ORDER BY l.created_at DESC
        """,
        owner_id,
    )
    # SLA visible: el owner ve en qué va la verificación de su publicación
    _SLA_LABEL = {
        "nuevo": "En cola de asignación",
        "asignado": "Un agente de tu zona la está revisando",
        "en_pool": "Buscando agente disponible",
        "en_verificacion": "Agente verificando documentos",
        "aceptado": "Agente verificando documentos",
        "descartado": "Verificación descartada",
    }
    out = []
    for r in rows:
        d = dict(r)
        d["verificacion_label"] = (
            "Verificada" if d.get("verificado")
            else _SLA_LABEL.get(d.get("verificacion_estado") or "", "En proceso de verificación (máx. 72 h)")
        )
        out.append(d)
    return out


async def _owner_de_listing(pool, listing_id: str, user_id: int) -> None:
    """Verifica que el listing pertenezca al owner del usuario, o 404/403."""
    row = await pool.fetchrow(
        "SELECT o.usuario_id FROM listing l JOIN owner o ON o.id = l.owner_id "
        "WHERE l.id = $1", listing_id,
    )
    if not row:
        raise HTTPException(404, "Listing no encontrado")
    if row["usuario_id"] != user_id:
        raise HTTPException(403, "No autorizado")


# ── PATCH /{listing_id} ────────────────────────────────────────────────────────

@router.patch("/{listing_id}")
async def actualizar_listing(
    listing_id: str,
    precio_cop:   Optional[float] = Form(None),
    descripcion:  Optional[str]   = Form(None),
    estado:       Optional[str]   = Form(None),
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    await _owner_de_listing(pool, listing_id, current_user["id"])

    updates: list[str] = []
    params: list = []
    idx = 1

    if precio_cop is not None:
        updates.append(f"precio = ${idx}"); params.append(precio_cop); idx += 1
    if descripcion is not None:
        updates.append(f"descripcion = ${idx}"); params.append(descripcion); idx += 1
    if estado is not None and estado in ("publicado", "pausado"):
        updates.append(f"estado = ${idx}::listing_estado"); params.append(estado); idx += 1

    if not updates:
        raise HTTPException(400, "Nada que actualizar")

    updates.append("updated_at = NOW()")
    params.append(listing_id)
    await pool.execute(
        f"UPDATE listing SET {', '.join(updates)} WHERE id = ${idx}",
        *params,
    )
    await ghl_client.sync_listing(listing_id)
    return {"ok": True}


# ── DELETE /{listing_id} ───────────────────────────────────────────────────────

@router.delete("/{listing_id}", status_code=204)
async def desactivar_listing(
    listing_id: str,
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    await _owner_de_listing(pool, listing_id, current_user["id"])
    await pool.execute(
        "UPDATE listing SET estado = 'cerrado', updated_at = NOW() WHERE id = $1",
        listing_id,
    )
    await ghl_client.sync_listing(listing_id)


# ── Email ──────────────────────────────────────────────────────────────────────

async def _notify_admin_new_listing(
    listing_id: int,
    tipo_inmueble: str,
    tipo_operacion: str,
    precio_cop: float,
    nombre_contacto: Optional[str],
    email_contacto: Optional[str],
) -> None:
    precio_fmt = f"${precio_cop:,.0f} COP"
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Nueva propiedad pendiente de revisión</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px;color:#62736d;width:140px">ID</td><td style="padding:6px;font-weight:600">#{listing_id}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Tipo</td><td style="padding:6px">{esc(tipo_inmueble)} · {esc(tipo_operacion)}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Precio</td><td style="padding:6px">{precio_fmt}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Contacto</td><td style="padding:6px">{esc(nombre_contacto) or '—'}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Email</td><td style="padding:6px">{esc(email_contacto) or '—'}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:13px;color:#62736d">
        Este listing está en estado <strong>pendiente</strong> hasta que lo apruebes.
      </p>
    """)
    await send_email(
        ADMIN_EMAIL,
        f"Nueva propiedad pendiente de revisión — #{listing_id}",
        html,
    )


# ── GET /agentes-para-contactar ────────────────────────────────────────────────

@router.get("/agentes-para-contactar")
async def agentes_para_contactar():
    """Public list of verified active agents."""
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT id, nombre_completo, foto_perfil, whatsapp,
               zonas_opera, email, telefono
        FROM public.agentes
        WHERE estado = 'aprobado'
        ORDER BY nombre_completo
        """
    )
    return [dict(r) for r in rows]


# ── POST /solicitudes ──────────────────────────────────────────────────────────

@router.post("/solicitudes", status_code=201)
async def crear_solicitud(
    listing_id: int             = Form(...),
    agente_id:  int             = Form(...),
    mensaje:    Optional[str]   = Form(None),
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    listing = await pool.fetchrow(
        """SELECT id, tipo_inmueble, tipo_operacion, precio_cop
           FROM public.listings_propios
           WHERE id = $1 AND user_id = $2""",
        listing_id, current_user["id"],
    )
    if not listing:
        raise HTTPException(404, "Listing no encontrado o no es tuyo")

    agente = await pool.fetchrow(
        """SELECT id, nombre_completo, email, whatsapp
           FROM public.agentes WHERE id = $1 AND estado = 'aprobado'""",
        agente_id,
    )
    if not agente:
        raise HTTPException(404, "Agente no encontrado")

    try:
        sol = await pool.fetchrow(
            """INSERT INTO public.agente_solicitudes (listing_id, agente_id, user_id, mensaje)
               VALUES ($1, $2, $3, $4) RETURNING id""",
            listing_id, agente_id, current_user["id"], mensaje,
        )
    except Exception:
        raise HTTPException(409, "Ya enviaste una solicitud a este agente para esta propiedad")

    await _notify_agente_nueva_solicitud(sol["id"], dict(agente), dict(listing), current_user)
    return {"id": sol["id"], "ok": True}


# ── GET /solicitudes/pendientes ────────────────────────────────────────────────

@router.get("/solicitudes/pendientes")
async def solicitudes_pendientes(current_user: dict = Depends(get_current_user)):
    """Verified agent sees their pending solicitudes."""
    pool = get_pool()
    agente_id = await _get_agente_id(pool, current_user["id"])
    if not agente_id:
        raise HTTPException(403, "Solo agentes verificados pueden ver solicitudes")

    rows = await pool.fetch(
        """
        SELECT
            s.id, s.estado, s.mensaje, s.created_at,
            l.id AS listing_id, l.tipo_operacion, l.tipo_inmueble,
            l.precio_cop, l.area_m2, l.habitaciones, l.barrio_id, l.direccion, l.fotos,
            u.nombre AS propietario_nombre, u.apellido AS propietario_apellido,
            u.email AS propietario_email
        FROM public.agente_solicitudes s
        JOIN public.listings_propios l ON l.id = s.listing_id
        JOIN public.usuarios u ON u.id = s.user_id
        WHERE s.agente_id = $1
        ORDER BY s.created_at DESC
        """,
        agente_id,
    )
    return [dict(r) for r in rows]


# ── PATCH /solicitudes/{sol_id} ────────────────────────────────────────────────

@router.patch("/solicitudes/{sol_id}")
async def actualizar_solicitud(
    sol_id: int,
    accion: str = Form(...),   # 'aceptar' | 'rechazar'
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    agente_id = await _get_agente_id(pool, current_user["id"])
    if not agente_id:
        raise HTTPException(403, "Solo agentes verificados")

    sol = await pool.fetchrow(
        """
        SELECT s.id, s.listing_id, s.user_id, s.estado,
               u.email AS propietario_email, u.nombre AS propietario_nombre
        FROM public.agente_solicitudes s
        JOIN public.usuarios u ON u.id = s.user_id
        WHERE s.id = $1 AND s.agente_id = $2
        """,
        sol_id, agente_id,
    )
    if not sol:
        raise HTTPException(404, "Solicitud no encontrada")
    if sol["estado"] != "pendiente":
        raise HTTPException(400, "Solicitud ya procesada")

    if accion == "aceptar":
        nuevo_estado = "aceptada"
        await pool.execute(
            """UPDATE public.listings_propios
               SET agente_id = $1, estado = 'activo', destacado = true, updated_at = NOW()
               WHERE id = $2""",
            agente_id, sol["listing_id"],
        )
        await pool.execute(
            """UPDATE public.agente_solicitudes
               SET estado = 'rechazada', updated_at = NOW()
               WHERE listing_id = $1 AND id != $2 AND estado = 'pendiente'""",
            sol["listing_id"], sol_id,
        )
    elif accion == "rechazar":
        nuevo_estado = "rechazada"
    else:
        raise HTTPException(400, "Accion debe ser 'aceptar' o 'rechazar'")

    await pool.execute(
        "UPDATE public.agente_solicitudes SET estado = $1, updated_at = NOW() WHERE id = $2",
        nuevo_estado, sol_id,
    )

    agente_info = await pool.fetchrow(
        "SELECT nombre_completo FROM public.agentes WHERE id = $1", agente_id
    )
    await _notify_propietario_respuesta(
        accion=accion,
        propietario_email=sol["propietario_email"],
        propietario_nombre=sol["propietario_nombre"],
        agente_nombre=agente_info["nombre_completo"],
        listing_id=sol["listing_id"],
    )
    return {"ok": True, "estado": nuevo_estado}


# ── Solicitud email helpers ─────────────────────────────────────────────────────

async def _notify_agente_nueva_solicitud(
    sol_id: int,
    agente: dict,
    listing: dict,
    propietario: dict,
) -> None:
    agente_email = agente.get("email") or ""
    if not agente_email:
        return
    precio_fmt = f"${listing['precio_cop']:,.0f} COP"
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Nueva solicitud de gestión — #{sol_id}</h3>
      <p style="font-size:14px;color:#1A1208">
        Hola <strong>{esc(agente.get('nombre',''))}</strong>, un propietario quiere que gestiones su propiedad.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:6px;color:#62736d;width:150px">Tipo</td><td style="padding:6px">{esc(listing['tipo_inmueble'])} · {esc(listing['tipo_operacion'])}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Precio</td><td style="padding:6px">{precio_fmt}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Propietario</td><td style="padding:6px">{esc(propietario.get('nombre',''))} {esc(propietario.get('apellido',''))}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Email contacto</td><td style="padding:6px">{esc(propietario.get('email','—'))}</td></tr>
      </table>
      <a href="{_APP_URL}/solicitudes"
         style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;font-weight:700;text-decoration:none;font-size:13px">
        Ver solicitudes →
      </a>
    """)
    await send_email(agente_email, f"Nueva solicitud de gestión — #{sol_id}", html)


async def _notify_propietario_respuesta(
    accion: str,
    propietario_email: str,
    propietario_nombre: str,
    agente_nombre: str,
    listing_id: int,
) -> None:
    if not propietario_email:
        return
    if accion == "aceptar":
        titulo = "¡Tu propiedad ya está activa!"
        detalle = f"""
          <p style="font-size:14px;color:#1A1208;margin-bottom:12px">
            El agente <strong>{esc(agente_nombre)}</strong> aceptó gestionar tu propiedad.
            Tu listing está ahora <strong>activo</strong> en el MLS de Medellín Social.
          </p>
          <a href="{_APP_URL}/mis-listings"
             style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;font-weight:700;text-decoration:none;font-size:13px">
            Ver mi propiedad →
          </a>
        """
    else:
        titulo = "Actualización sobre tu solicitud"
        detalle = f"""
          <p style="font-size:14px;color:#1A1208">
            El agente <strong>{esc(agente_nombre)}</strong> no pudo aceptar tu solicitud en este momento.
            Puedes conectar con otro agente desde tu panel.
          </p>
          <a href="{_APP_URL}/conectar-agente?listing_id={listing_id}"
             style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;font-weight:700;text-decoration:none;font-size:13px">
            Ver otros agentes →
          </a>
        """
    html = _wrap(f"""
      <h3 style="color:#1D9E75">{titulo}</h3>
      <p style="font-size:14px;color:#1A1208;margin-bottom:8px">Hola <strong>{esc(propietario_nombre)}</strong>,</p>
      {detalle}
    """)
    await send_email(propietario_email, titulo, html)
