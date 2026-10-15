"""Realtor intake — captación del inventario del owner + cuestionario."""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.db import get_pool
from api.dependencies import get_current_user
from api.routers.asignador import _agent_del_usuario
from api.schemas.intake_cuestionario import cuestionario_para
from api.services.due_diligence_service import (
    checklist_completo, checklist_verificado, generar_checklist, verificar_item,
)
from api.services.intake_service import (
    IntakeError, aceptar_intake, crear_intake, get_or_create_owner,
)

router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class IntakeCreateRequest(BaseModel):
    operacion: str          # 'venta' | 'arriendo'
    tipo_inmueble: str
    geom: str               # WKT Point "POINT(lon lat)"
    direccion_aprox: Optional[str] = None
    precio_esperado: Optional[float] = None
    area_m2: Optional[float] = None
    habitaciones: Optional[int] = None
    banos: Optional[int] = None
    # Declaraciones legales (autoreporte)
    en_propiedad_horizontal: Optional[bool] = None
    al_dia_administracion: Optional[bool] = None
    al_dia_predial: Optional[bool] = None
    tiene_hipoteca: Optional[bool] = None
    tiene_escritura: Optional[bool] = None
    servicios_al_dia: Optional[bool] = None
    estado_civil: Optional[str] = None
    es_persona_juridica: Optional[bool] = None
    notas_owner: Optional[str] = None


class VerificarItemRequest(BaseModel):
    estado: str              # 'verificado' | 'rechazado'
    nota: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/intake", status_code=201)
async def crear_intake_endpoint(
    req: IntakeCreateRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Owner crea una solicitud de captación. Valida cuestionario, resuelve zona,
    guarda en 'nuevo'."""
    # intake.owner_id es UUID FK→owner; el INT de usuarios.id jamás entra aquí.
    owner_id = await get_or_create_owner(user, pool)

    payload = req.model_dump(exclude={"operacion", "tipo_inmueble", "geom"})
    try:
        intake = await crear_intake(
            owner_id=owner_id,
            geom=req.geom,
            operacion=req.operacion,
            tipo_inmueble=req.tipo_inmueble,
            payload=payload,
            pool=pool,
        )
    except (IntakeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO intake (
                id, owner_id, estado, operacion, tipo_inmueble, geom, municipio,
                barrio, zona_nivel, zona_codigo, direccion_aprox, precio_esperado,
                area_m2, habitaciones, banos, declaraciones, notas_owner
            ) VALUES (
                $1, $2, $3, $4, $5, ST_GeomFromText($6, 4326), $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16::jsonb, $17
            )
            """,
            intake["id"], intake["owner_id"], intake["estado"],
            intake["operacion"], intake["tipo_inmueble"], req.geom,
            intake["municipio"], intake["barrio"], intake["zona_nivel"],
            intake["zona_codigo"], intake["direccion_aprox"],
            intake["precio_esperado"], intake["area_m2"],
            intake["habitaciones"], intake["banos"],
            json.dumps(intake["declaraciones"]), intake["notas_owner"],
        )

    return {"id": intake["id"], "estado": "nuevo"}


@router.get("/intake/mias")
async def mis_intakes(
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Owner ve sus propias solicitudes."""
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "SELECT id FROM owner WHERE usuario_id = $1", user["id"]
        )
        if owner_id is None:
            return []  # nunca ha subido inmueble → sin owner, sin intakes
        rows = await conn.fetch(
            "SELECT id, estado, operacion, tipo_inmueble, zona_codigo, created_at "
            "FROM intake WHERE owner_id = $1 ORDER BY created_at DESC",
            owner_id,
        )
    return [dict(r) for r in rows]


@router.get("/intake/{intake_id}")
async def get_intake(
    intake_id: str,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Detalle del intake (owner dueño o realtor asignado)."""
    async with pool.acquire() as conn:
        # Explicit columns (no SELECT *): new private columns must be opted in.
        row = await conn.fetchrow(
            """
            SELECT id, owner_id, estado, agent_id, listing_id, operacion, tipo_inmueble,
                   ST_Y(geom) AS lat, ST_X(geom) AS lon,
                   municipio, barrio, direccion_aprox, zona_nivel, zona_codigo,
                   precio_esperado, area_m2, habitaciones, banos,
                   declaraciones, notas_owner, created_at, updated_at
            FROM intake WHERE id = $1
            """,
            intake_id,
        )
        if not row:
            raise HTTPException(status_code=404)
        # Acceso UUID vs UUID: dueño (owner del usuario) o realtor asignado
        # (agent del usuario). agent_id NULL → EXISTS false.
        acceso = await conn.fetchval(
            """
            SELECT EXISTS(SELECT 1 FROM owner WHERE usuario_id = $1 AND id = $2)
                OR EXISTS(SELECT 1 FROM agent WHERE usuario_id = $1 AND id = $3)
            """,
            user["id"], row["owner_id"], row["agent_id"],
        )
    if not acceso:
        raise HTTPException(status_code=403)
    return dict(row)


@router.post("/intake/{intake_id}/aceptar")
async def aceptar_intake_endpoint(
    intake_id: str,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """El realtor ASIGNADO acepta el intake: crea el listing 'borrador' y genera
    el checklist de due diligence. Idempotente: re-aceptar devuelve el listing
    existente sin crear otro."""
    agent = await _agent_del_usuario(user, pool)  # 403 si el usuario no es agente

    async with pool.acquire() as conn:
        # ST_AsText: aceptar_intake re-inserta la geom vía ST_GeomFromText (WKT).
        row = await conn.fetchrow(
            "SELECT id, estado, agent_id, listing_id, zona_codigo, municipio, "
            "barrio, direccion_aprox, operacion, precio_esperado, tipo_inmueble, "
            "area_m2, habitaciones, banos, declaraciones, ST_AsText(geom) AS geom "
            "FROM intake WHERE id = $1",
            intake_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Intake no encontrado")
        if row["agent_id"] != agent.id:  # UUID vs UUID
            raise HTTPException(status_code=403, detail="Solo el realtor asignado puede aceptar")

        # Idempotente: ya aceptado → mismo listing, sin duplicar.
        if str(row["estado"]) == "aceptado" and row["listing_id"]:
            return {"intake_id": intake_id, "listing_id": str(row["listing_id"]),
                    "estado": "aceptado", "dd_items": 0}

        # listing.agency_id es NOT NULL: la agency del agent (owner primero —
        # cubre al independiente, que es owner de su propia agency).
        agency_id = await conn.fetchval(
            "SELECT agency_id FROM agency_member WHERE agent_id = $1 "
            "ORDER BY (rol = 'owner') DESC LIMIT 1",
            agent.id,
        )
        if agency_id is None:
            raise HTTPException(status_code=409, detail="El agente no pertenece a ninguna agency")

    if row["listing_id"]:
        # Flujo "publica primero" (0053): el owner ya publicó y el intake nació
        # enlazado a ese listing. Aceptar = adoptarlo (agent/agency), no crear
        # un borrador duplicado.
        if str(row["estado"]) != "asignado":
            raise HTTPException(
                status_code=409,
                detail=f"Intake no está listo para aceptar (estado={row['estado']})",
            )
        async with pool.acquire() as conn:
            async with conn.transaction():
                result = await conn.execute(
                    "UPDATE intake SET estado = 'aceptado', updated_at = NOW() "
                    "WHERE id = $1 AND estado = 'asignado'",
                    intake_id,
                )
                if result.split()[-1] == "0":
                    raise HTTPException(status_code=409, detail="Otro proceso ya movió este intake")
                await conn.execute(
                    "UPDATE listing SET agent_id = $1, agency_id = $2, updated_at = NOW() "
                    "WHERE id = $3",
                    agent.id, agency_id, row["listing_id"],
                )
        listing_id = str(row["listing_id"])
    else:
        try:
            listing_id = await aceptar_intake(
                intake_id, SimpleNamespace(**dict(row)), str(agent.id), str(agency_id), pool,
            )
        except IntakeError as e:
            raise HTTPException(status_code=409, detail=str(e))

    # El checklist DD nace al aceptar (la verificación empieza cuando el realtor
    # toma el caso). Guard de idempotencia: generar_checklist duplicaría.
    async with pool.acquire() as conn:
        ya_hay = await conn.fetchval(
            "SELECT COUNT(*) FROM due_diligence_item WHERE intake_id = $1", intake_id
        )
    dd_items = 0
    if not ya_hay:
        decl = row["declaraciones"]
        if isinstance(decl, str):  # asyncpg entrega JSONB como str
            decl = json.loads(decl)
        dd_items = await generar_checklist(
            SimpleNamespace(id=intake_id, declaraciones=decl), pool
        )

    return {"intake_id": intake_id, "listing_id": listing_id,
            "estado": "aceptado", "dd_items": dd_items}


@router.get("/intake/{intake_id}/due-diligence")
async def get_due_diligence(
    intake_id: str,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Checklist de due diligence del intake (alimenta el badge del dashboard)."""
    async with pool.acquire() as conn:
        intake_row = await conn.fetchrow(
            "SELECT owner_id, agent_id FROM intake WHERE id = $1", intake_id
        )
        if not intake_row:
            raise HTTPException(status_code=404, detail="Intake no encontrado")
        # Mismo patrón UUID vs UUID de get_intake: dueño o realtor asignado.
        acceso = await conn.fetchval(
            """
            SELECT EXISTS(SELECT 1 FROM owner WHERE usuario_id = $1 AND id = $2)
                OR EXISTS(SELECT 1 FROM agent WHERE usuario_id = $1 AND id = $3)
            """,
            user["id"], intake_row["owner_id"], intake_row["agent_id"],
        )
        if not acceso:
            raise HTTPException(status_code=403)
        rows = await conn.fetch(
            "SELECT id, clave, declarado, estado, nota, verificado_por, verificado_at "
            "FROM due_diligence_item WHERE intake_id = $1 ORDER BY clave",
            intake_id,
        )
    items = [dict(r) for r in rows]
    return {
        "intake_id": intake_id,
        "items": items,
        "completo": all(i["estado"] != "pendiente" for i in items) if items else False,
    }


@router.post("/due-diligence/{item_id}/verificar")
async def verificar_item_endpoint(
    item_id: str,
    req: VerificarItemRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """El realtor asignado marca un item verificado|rechazado (con nota opcional).
    Devuelve si el checklist quedó completo (badge del dashboard)."""
    agent = await _agent_del_usuario(user, pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT d.intake_id, i.agent_id FROM due_diligence_item d "
            "JOIN intake i ON i.id = d.intake_id WHERE d.id = $1",
            item_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    if row["agent_id"] != agent.id:  # UUID vs UUID
        raise HTTPException(status_code=403, detail="Solo el realtor asignado puede verificar")

    try:
        await verificar_item(item_id, str(agent.id), req.estado, req.nota, pool)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    completo = await checklist_completo(str(row["intake_id"]), pool)

    # Sello "Verificada": todos los items verificados → el listing del intake
    # levanta verificado=true (aparece con sello en el mapa).
    verificado = False
    if completo and await checklist_verificado(str(row["intake_id"]), pool):
        async with pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE listing l SET verificado = TRUE, updated_at = NOW() "
                "FROM intake i WHERE i.id = $1 AND l.id = i.listing_id AND l.verificado = FALSE",
                str(row["intake_id"]),
            )
        verificado = result.split()[-1] != "0"

    return {"id": item_id, "estado": req.estado, "checklist_completo": completo,
            "listing_verificado": verificado}


@router.get("/cuestionario")
async def get_cuestionario(operacion: str = Query(...)):
    """Devuelve el esquema del cuestionario para el front (venta | arriendo)."""
    try:
        cuestionario = cuestionario_para(operacion)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return [
        {
            "id": p["id"],
            "texto": p["texto"],
            "tipo": p["tipo"],
            "obligatoria": p.get("obligatoria", False),
            "condicional_si": p.get("condicional_si"),
        }
        for p in cuestionario
    ]
