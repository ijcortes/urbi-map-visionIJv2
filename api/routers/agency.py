"""Agency owner dashboard — gestión de equipo, inbox con delegación, listings.

Solo accesible para agents con agency_member.rol = 'owner'.
Agentes miembros (rol='agente') usan el realtor dashboard normal.
"""
from __future__ import annotations

import logging
import os
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from api.db import get_pool
from api.dependencies import get_current_user, get_optional_user
from api.utils import ghl_client

log = logging.getLogger(__name__)

_APP_URL = os.getenv("APP_URL", "https://medellinsocial.com")

router = APIRouter()


async def _agency_owner(user: dict, pool) -> tuple[SimpleNamespace, SimpleNamespace]:
    """Returns (agent, agency) if user is owner of any agency, else 403."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT a.id AS agent_id, a.estado,
                   ag.id AS agency_id, ag.nombre AS agency_nombre, ag.tipo::text AS agency_tipo
            FROM agent a
            JOIN agency_member am ON am.agent_id = a.id AND am.rol = 'owner'
            JOIN agency ag ON ag.id = am.agency_id
            WHERE a.usuario_id = $1
            LIMIT 1
            """,
            user.get("id"),
        )
    if not row:
        raise HTTPException(status_code=403, detail="El usuario no es owner de ninguna agencia")
    if row["estado"] != "activo":
        raise HTTPException(status_code=403, detail="agente_no_activo")
    return (
        SimpleNamespace(id=row["agent_id"], estado=row["estado"]),
        SimpleNamespace(id=row["agency_id"], nombre=row["agency_nombre"], tipo=row["agency_tipo"]),
    )


@router.get("/me")
async def agency_me(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Perfil de agencia + lista de miembros."""
    agent, agency = await _agency_owner(user, pool)
    async with pool.acquire() as conn:
        miembros = await conn.fetch(
            """
            SELECT ag2.id::text AS id, ag2.nombre, ag2.email, ag2.telefono,
                   ag2.foto_url, ag2.estado::text AS estado, am2.rol::text AS rol,
                   COUNT(DISTINCT l.id) AS listings_count,
                   COUNT(DISTINCT v.id) FILTER (WHERE v.estado = 'pendiente') AS visitas_pendientes
            FROM agency_member am2
            JOIN agent ag2 ON ag2.id = am2.agent_id
            LEFT JOIN listing l ON l.agent_id = ag2.id
            LEFT JOIN visita_solicitud v ON v.agent_id = ag2.id
            WHERE am2.agency_id = $1
            GROUP BY ag2.id, ag2.nombre, ag2.email, ag2.telefono, ag2.foto_url, ag2.estado, am2.rol
            ORDER BY am2.rol DESC, ag2.nombre
            """,
            agency.id,
        )
    return {
        "agency_id": str(agency.id),
        "agency_nombre": agency.nombre,
        "agency_tipo": agency.tipo,
        "agent_id": str(agent.id),
        "agentes": [dict(m) for m in miembros],
    }


@router.get("/inbox")
async def agency_inbox(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Todas las visitas de la agencia — asignadas a miembro o sin asignar (pool)."""
    agent, agency = await _agency_owner(user, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT v.id::text AS id, v.listing_url,
                   COALESCE(l.titulo, v.listing_url) AS listing_titulo,
                   v.nombre, v.telefono, v.mensaje,
                   v.fecha_visita, v.estado::text AS estado, v.created_at,
                   v.agent_id::text AS agent_id,
                   ag.nombre AS agent_nombre,
                   CASE WHEN v.estado = 'pendiente'
                        THEN ROUND(EXTRACT(EPOCH FROM (NOW() - v.created_at))/3600.0)::int
                        ELSE NULL END AS horas_pendiente
            FROM visita_solicitud v
            JOIN listing l ON l.id::text = v.listing_url AND l.agency_id = $1
            LEFT JOIN agent ag ON ag.id = v.agent_id
            ORDER BY
                CASE v.estado WHEN 'pendiente' THEN 0 WHEN 'confirmada' THEN 1 ELSE 2 END,
                v.created_at DESC
            LIMIT 300
            """,
            agency.id,
        )
    return {
        "visitas": [
            {
                **dict(r),
                "fecha_visita": r["fecha_visita"].isoformat() if r["fecha_visita"] else None,
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


class DelegarRequest(BaseModel):
    agent_id: str


@router.post("/inbox/{visita_id}/delegar")
async def delegar_visita(
    visita_id: str,
    req: DelegarRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Asigna una visita a un agente miembro de la agencia."""
    agent, agency = await _agency_owner(user, pool)
    async with pool.acquire() as conn:
        is_member = await conn.fetchval(
            "SELECT 1 FROM agency_member WHERE agency_id = $1 AND agent_id = $2::uuid",
            agency.id,
            req.agent_id,
        )
        if not is_member:
            raise HTTPException(status_code=400, detail="El agente no pertenece a esta agencia")
        updated = await conn.fetchval(
            """
            UPDATE visita_solicitud SET agent_id = $1::uuid, updated_at = NOW()
            WHERE id = $2::uuid
              AND listing_url IN (SELECT id::text FROM listing WHERE agency_id = $3)
            RETURNING id
            """,
            req.agent_id,
            visita_id,
            agency.id,
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Visita no encontrada")
    return {"ok": True}


@router.get("/agentes")
async def agency_agentes(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Miembros del equipo con contadores de listings y visitas pendientes."""
    agent, agency = await _agency_owner(user, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ag.id::text AS id, ag.nombre, ag.email, ag.telefono,
                   ag.foto_url, ag.estado::text AS estado, am.rol::text AS rol,
                   COUNT(DISTINCT l.id) AS listings_count,
                   COUNT(DISTINCT v.id) FILTER (WHERE v.estado = 'pendiente') AS visitas_pendientes,
                   COUNT(DISTINCT v.id) FILTER (WHERE v.estado = 'confirmada') AS visitas_confirmadas
            FROM agency_member am
            JOIN agent ag ON ag.id = am.agent_id
            LEFT JOIN listing l ON l.agent_id = ag.id
            LEFT JOIN visita_solicitud v ON v.agent_id = ag.id
            WHERE am.agency_id = $1
            GROUP BY ag.id, ag.nombre, ag.email, ag.telefono, ag.foto_url, ag.estado, am.rol
            ORDER BY am.rol DESC, ag.nombre
            """,
            agency.id,
        )
    return [dict(r) for r in rows]


@router.get("/listings")
async def agency_listings(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Todos los listings de la agencia con agente asignado."""
    agent, agency = await _agency_owner(user, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT l.id::text AS id, l.slug, l.titulo, l.estado::text AS estado,
                   l.tipo_inmueble::text AS tipo_inmueble, l.operacion::text AS operacion,
                   l.precio, l.barrio, l.municipio, l.updated_at,
                   l.agent_id::text AS agent_id, ag.nombre AS agent_nombre
            FROM listing l
            LEFT JOIN agent ag ON ag.id = l.agent_id
            WHERE l.agency_id = $1
            ORDER BY l.updated_at DESC
            LIMIT 300
            """,
            agency.id,
        )
    return [
        {**dict(r), "updated_at": r["updated_at"].isoformat()}
        for r in rows
    ]


class AsignarListingRequest(BaseModel):
    agent_id: str


@router.patch("/listings/{listing_id}/asignar")
async def asignar_listing(
    listing_id: str,
    req: AsignarListingRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Reasigna un listing a otro agente miembro."""
    agent, agency = await _agency_owner(user, pool)
    async with pool.acquire() as conn:
        is_member = await conn.fetchval(
            "SELECT 1 FROM agency_member WHERE agency_id = $1 AND agent_id = $2::uuid",
            agency.id,
            req.agent_id,
        )
        if not is_member:
            raise HTTPException(status_code=400, detail="El agente no pertenece a esta agencia")
        updated = await conn.fetchval(
            """
            UPDATE listing SET agent_id = $1::uuid, updated_at = NOW()
            WHERE id = $2::uuid AND agency_id = $3
            RETURNING id
            """,
            req.agent_id,
            listing_id,
            agency.id,
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Listing no encontrado")
    return {"ok": True}


# ── Invitaciones ───────────────────────────────────────────────────────────────

class InvitarRequest(BaseModel):
    email: EmailStr


@router.post("/agentes/invitar", status_code=201)
async def invitar_agente(
    req: InvitarRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Owner invita a un agente por email. Genera token y envía link."""
    from api.utils.email import send_invite_agencia  # import tardío: evita ciclo

    owner_agent, agency = await _agency_owner(user, pool)

    async with pool.acquire() as conn:
        # Revocar invitaciones pendientes anteriores para el mismo email+agencia
        await conn.execute(
            """UPDATE agency_invite SET estado = 'vencida'
               WHERE agency_id = $1 AND email = $2 AND estado = 'pendiente'""",
            agency.id, req.email,
        )
        row = await conn.fetchrow(
            """INSERT INTO agency_invite (agency_id, email)
               VALUES ($1, $2)
               RETURNING token::text AS token""",
            agency.id, req.email,
        )

    token = row["token"]
    invite_url = f"{_APP_URL}/realtor/accept-invite?token={token}"

    try:
        await send_invite_agencia(
            to=req.email,
            agency_nombre=agency.nombre,
            invitado_por=owner_agent,
            invite_url=invite_url,
        )
    except Exception:
        log.exception("Falló email de invitación a %s para agencia %s", req.email, agency.id)
        # La fila ya está en DB — no lanzar; el owner puede reenviar
    return {"ok": True, "invite_url": invite_url}


@router.get("/invite/{token}")
async def get_invite_info(token: str, pool=Depends(get_pool)):
    """Info pública de una invitación (sin auth). Usado por la página accept-invite."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT ai.id::text AS id, ai.email, ai.estado,
                      ai.expires_at, ag.nombre AS agency_nombre
               FROM agency_invite ai
               JOIN agency ag ON ag.id = ai.agency_id
               WHERE ai.token = $1::uuid""",
            token,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Invitación no encontrada")
    if row["estado"] != "pendiente":
        raise HTTPException(status_code=410, detail=f"Invitación {row['estado']}")
    import datetime
    if row["expires_at"] < datetime.datetime.now(datetime.timezone.utc):
        raise HTTPException(status_code=410, detail="Invitación vencida")
    return {
        "agency_nombre": row["agency_nombre"],
        "email": row["email"],
        "estado": row["estado"],
    }


@router.post("/invite/{token}/aceptar")
async def aceptar_invite(
    token: str,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Agente autenticado acepta la invitación y queda vinculado a la agencia."""
    import datetime

    async with pool.acquire() as conn:
        invite = await conn.fetchrow(
            """SELECT ai.id, ai.agency_id, ai.email, ai.estado, ai.expires_at
               FROM agency_invite ai
               WHERE ai.token = $1::uuid""",
            token,
        )
        if not invite:
            raise HTTPException(status_code=404, detail="Invitación no encontrada")
        if invite["estado"] != "pendiente":
            raise HTTPException(status_code=410, detail=f"Invitación {invite['estado']}")
        if invite["expires_at"] < datetime.datetime.now(datetime.timezone.utc):
            raise HTTPException(status_code=410, detail="Invitación vencida")
        if invite["email"].strip().lower() != user["email"].strip().lower():
            raise HTTPException(status_code=403, detail="Esta invitación es para otro correo")

        # Buscar o crear el agent del usuario autenticado
        agent_row = await conn.fetchrow(
            "SELECT id FROM agent WHERE usuario_id = $1", user["id"]
        )
        agent_nuevo = agent_row is None
        if not agent_row:
            # Crear agent básico si no existe (pendiente de aprobación)
            agent_row = await conn.fetchrow(
                """INSERT INTO agent (usuario_id, email, nombre, telefono)
                   VALUES ($1, $2, $3, '')
                   ON CONFLICT (email) DO UPDATE SET usuario_id = EXCLUDED.usuario_id
                   RETURNING id""",
                user["id"], user["email"], user.get("nombre") or user["email"],
            )
        agent_id = agent_row["id"]

        # Verificar que no sea ya miembro
        already = await conn.fetchval(
            "SELECT 1 FROM agency_member WHERE agency_id = $1 AND agent_id = $2",
            invite["agency_id"], agent_id,
        )
        if already:
            # Ya es miembro — marcar invitación aceptada de todas formas
            await conn.execute(
                "UPDATE agency_invite SET estado = 'aceptada', agent_id = $1 WHERE id = $2",
                agent_id, invite["id"],
            )
            return {"ok": True, "ya_miembro": True}

        # Insertar en agency_member + marcar invite aceptada
        await conn.execute(
            "INSERT INTO agency_member (agency_id, agent_id, rol) VALUES ($1, $2, 'agente')",
            invite["agency_id"], agent_id,
        )
        await conn.execute(
            "UPDATE agency_invite SET estado = 'aceptada', agent_id = $1 WHERE id = $2",
            agent_id, invite["id"],
        )

    # Realtor recién creado por esta vía → GHL (Contact). Fuera de la
    # transacción (sync usa conexión aparte). Best-effort: hoy levanta (stub).
    # ponytail: este agent nace flaco (telefono=''), el Contact sale incompleto
    # hasta que el realtor complete su perfil; aceptable para el esqueleto.
    if agent_nuevo:
        try:
            await ghl_client.sync_agent(agent_id)
        except Exception:
            log.exception("sync_agent(%s) falló", agent_id)  # best-effort, no bloquea la aceptación

    return {"ok": True, "ya_miembro": False}
