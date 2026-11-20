"""Domain logic for owner intake (captación de inmuebles).

crear_intake  → valida cuestionario, resuelve zona desde geom, arma intake 'nuevo'.
aceptar_intake → crea listing en 'borrador' con la agency/agent asignados y enlaza.
                 NO publica: eso es decisión del realtor en su dashboard.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List

from api.schemas.intake_cuestionario import (
    DECLARACIONES_KEYS, Pregunta, cuestionario_para,
)
from api.services.zona_service import resolver_zona
from api.utils import ghl_client

logger = logging.getLogger(__name__)


class IntakeError(ValueError):
    """Validation or domain error in intake flow."""


async def _enrich_listing_from_scraped(conn: Any, listing_id: str, url: str) -> None:
    """Reclamo de un listing scrapeado: copia su data rica al listing recién
    materializado para que el realtor EDITE en vez de re-digitar. Trae fotos (por
    URL, sin re-subir) + estrato + amenidades + administración. Descripción y
    parqueaderos los completa el realtor (no están en el stg). COALESCE: no pisa
    lo que el intake ya puso. El listing nace sin media → sin duplicar fotos."""
    scr = await conn.fetchrow(
        """SELECT fotos, estrato_real, amenidades, administracion
           FROM staging.stg_listings_unificado WHERE url = $1 LIMIT 1""",
        url,
    )
    if not scr:
        return
    estrato = int(scr["estrato_real"]) if scr["estrato_real"] is not None else None
    await conn.execute(
        """UPDATE listing SET
             estrato        = COALESCE($2, estrato),
             amenidades     = COALESCE($3, amenidades),
             administracion = COALESCE($4, administracion),
             updated_at     = NOW()
           WHERE id = $1""",
        listing_id, estrato, scr["amenidades"], scr["administracion"],
    )
    for i, foto_url in enumerate((scr["fotos"] or [])[:20]):
        if foto_url:
            await conn.execute(
                "INSERT INTO listing_media (listing_id, url, orden, es_portada) "
                "VALUES ($1, $2, $3, $4)",
                listing_id, foto_url, i, i == 0,
            )


def _aplica(preg: Pregunta, payload: Dict[str, Any]) -> bool:
    """True si el item aplica dado el payload (evalúa condicional_si)."""
    cond = preg.get("condicional_si")
    if not cond:
        return True
    # Aplica solo si el payload cumple TODAS las igualdades declaradas.
    return all(payload.get(k) == v for k, v in cond.items())


def _validar_payload(payload: Dict[str, Any], cuestionario: List[Pregunta]) -> None:
    """Valida el payload contra el cuestionario.

    Un campo obligatorio debe estar presente (no None). Un campo condicional
    solo se exige cuando su condición se cumple; si no aplica, se omite aunque
    sea obligatorio. Lanza IntakeError en la primera falla.
    """
    for preg in cuestionario:
        if not _aplica(preg, payload):
            continue
        if preg.get("obligatoria") and payload.get(preg["id"]) is None:
            raise IntakeError(f"Campo obligatorio faltante: {preg['id']}")


async def get_or_create_owner(user: Dict[str, Any], pool: Any) -> str:
    """Owner (UUID) del usuario autenticado; lo crea en su primer intake.

    intake.owner_id es FK a owner(id) UUID — nunca usuarios.id. Un usuario tiene
    un solo owner: se busca por usuario_id y el ON CONFLICT sobre owner.email
    (UNIQUE, mismo valor que usuarios.email) absorbe carreras y adopta owners
    pre-creados sin vínculo.
    """
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "SELECT id::text FROM owner WHERE usuario_id = $1", user["id"]
        )
        if owner_id:
            return owner_id
        nombre = (
            f"{user.get('nombre') or ''} {user.get('apellido') or ''}".strip()
            or user["email"]
        )
        # ponytail: usuarios no tiene teléfono y owner.telefono es NOT NULL →
        # '' hasta que el perfil/cuestionario lo capture.
        return await conn.fetchval(
            """
            INSERT INTO owner (usuario_id, nombre, email, telefono)
            VALUES ($1, $2, $3, '')
            ON CONFLICT (email) DO UPDATE SET usuario_id = EXCLUDED.usuario_id
            RETURNING id::text
            """,
            user["id"], nombre, user["email"],
        )


async def crear_intake(
    owner_id: str,
    geom: str,        # WKT Point, SRID 4326 — p.ej. 'POINT(-75.56 6.24)'
    operacion: str,   # 'venta' | 'arriendo'
    tipo_inmueble: str,
    payload: Dict[str, Any],
    pool: Any,
) -> Dict[str, Any]:
    """Valida, resuelve zona y arma un intake en estado 'nuevo'.

    payload lleva el resto de respuestas del cuestionario (características +
    declaraciones legales). operacion/tipo_inmueble/geom se pasan aparte y se
    inyectan a la validación para satisfacer las obligatorias del cuestionario.
    Devuelve un dict listo para INSERT (el router persiste).
    """
    cuestionario = cuestionario_para(operacion)

    # Inyecta las obligatorias que llegan como args separados.
    validado = {**payload, "operacion": operacion, "tipo_inmueble": tipo_inmueble, "geom": geom}
    _validar_payload(validado, cuestionario)

    # Zona estable desde la geometría (misma lógica que usará el asignador).
    zona = await resolver_zona(geom, pool)
    barrio_id = zona["barrio_id"]

    # Denormaliza nombre de barrio/municipio para display (no autoritativo).
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT nombre, municipio FROM raw.barrios WHERE id = $1::int",
            int(barrio_id),
        )
    barrio_nombre = row["nombre"] if row else None
    municipio_nombre = row["municipio"] if row else None

    declaraciones = {k: payload[k] for k in DECLARACIONES_KEYS if k in payload}

    return {
        "id": str(uuid.uuid4()),
        "owner_id": owner_id,
        "estado": "nuevo",
        "agent_id": None,     # lo llena el asignador (paso 5)
        "listing_id": None,   # se llena al aceptar
        "operacion": operacion,
        "tipo_inmueble": tipo_inmueble,
        "geom": geom,
        "municipio": municipio_nombre,
        "barrio": barrio_nombre,
        "zona_nivel": "barrio",
        "zona_codigo": barrio_id,
        "direccion_aprox": payload.get("direccion_aprox"),
        "precio_esperado": payload.get("precio_esperado"),
        "area_m2": payload.get("area_m2"),
        "habitaciones": payload.get("habitaciones"),
        "banos": payload.get("banos"),
        "declaraciones": declaraciones,
        "notas_owner": payload.get("notas_owner"),
    }


class _PerdioCarrera(Exception):
    """Interno: otro aceptar enlazó el intake primero; rollback del INSERT."""


async def aceptar_intake(
    intake_id: str,
    intake: Any,
    agent_id: str,
    agency_id: str,
    pool: Any,
) -> str:
    """Acepta el intake: crea un listing en 'borrador' y lo enlaza.

    Requiere que el intake ya esté 'asignado' (paso 5 puso agent_id/agency).
    El listing nace en 'borrador' — el realtor decide publicar más tarde.
    Devuelve el listing_id creado.

    Carrera: el UPDATE que enlaza es condicional (WHERE estado='asignado' +
    rowcount, mismo patrón que asignador.tomar_del_pool) dentro de una
    transacción; si otro aceptar ganó, se revierte el INSERT y se devuelve el
    listing que quedó enlazado. Nunca dos listings por intake.
    """
    if str(intake.estado) != "asignado":
        raise IntakeError(
            f"Intake {intake_id} no está listo para aceptar (estado={intake.estado})"
        )

    listing_id = str(uuid.uuid4())
    slug = f"{intake.zona_codigo}-{listing_id[:8]}".lower()

    # ponytail: listing.precio es NOT NULL (0046); en borrador el owner puede no
    # haber dado precio → placeholder 0, el realtor lo corrige antes de publicar.
    # El 0 NO puede publicarse: datos_minimos_completos rechaza precio <= 0 y
    # transition() lo exige en borrador → en_revision (listing_service.py).
    precio = intake.precio_esperado if intake.precio_esperado is not None else 0

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO listing (
                        id, slug, agency_id, agent_id, estado, geom, municipio, barrio,
                        direccion_aprox, mostrar_exacto, operacion, precio, moneda,
                        tipo_inmueble, area_m2, habitaciones, banos, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, 'borrador', ST_GeomFromText($5, 4326), $6, $7, $8,
                        FALSE, $9, $10, 'COP', $11, $12, $13, $14, NOW(), NOW()
                    )
                    """,
                    listing_id, slug, agency_id, agent_id, intake.geom,
                    intake.municipio, intake.barrio, intake.direccion_aprox,
                    intake.operacion, precio, intake.tipo_inmueble,
                    intake.area_m2, intake.habitaciones, intake.banos,
                )
                res = await conn.execute(
                    "UPDATE intake SET listing_id = $1, estado = 'aceptado' "
                    "WHERE id = $2 AND estado = 'asignado'",
                    listing_id, intake_id,
                )
                if res != "UPDATE 1":
                    raise _PerdioCarrera()
    except _PerdioCarrera:
        async with pool.acquire() as conn:
            existente = await conn.fetchval(
                "SELECT listing_id::text FROM intake WHERE id = $1", intake_id
            )
        if existente:
            return existente
        # Cambió a un estado sin listing (p.ej. descartado) entre el check y el UPDATE.
        raise IntakeError(f"Intake {intake_id} ya no está 'asignado' y no tiene listing")

    # Reclamo de scrapeado → hereda data rica (post-commit, falla-suave: si revienta
    # el listing ya quedó aceptado). Gate por declaraciones.origen == 'reclamo'.
    try:
        decl = getattr(intake, "declaraciones", None)
        if isinstance(decl, str):
            decl = json.loads(decl) if decl else {}
        if isinstance(decl, dict) and decl.get("origen") == "reclamo" and decl.get("listing_url"):
            async with pool.acquire() as conn:
                await _enrich_listing_from_scraped(conn, listing_id, decl["listing_url"])
    except Exception:
        logger.exception("aceptar_intake: enrich desde scrapeado falló (listing %s)", listing_id)

    await ghl_client.sync_listing(listing_id)
    await ghl_client.link_agency_to_listing(listing_id, agency_id)
    return listing_id
