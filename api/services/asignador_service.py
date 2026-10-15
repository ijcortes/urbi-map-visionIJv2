"""Asignador — conecta owner→zona→realtar. SOLO orquesta.

Fuente única de verdad delegada:
- zona:      zona_service.resolver_zona()          (ST_Contains raw.barrios)
- vigencia:  sponsorship_service.patrocinadores_vigentes()  (activa + fechas,
             ORDER BY fecha_inicio ASC → [0] es el más antiguo)
- filtro agente: agent_service.ESTADOS_ASIGNABLES  ('activo')

NO reimplementar filtros de fecha ni ST_Contains aquí. Todo cambio de estado del
intake pasa por asignar_intake() o tomar_del_pool(); nunca por el router.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from api.services.agent_service import ESTADOS_ASIGNABLES
from api.services.sponsorship_service import patrocinadores_vigentes
from api.services.zona_service import resolver_zona
from api.utils.pii import mask_email

logger = logging.getLogger(__name__)


class AsignadorError(ValueError):
    """Error de dominio en la asignación."""


# Horas que un intake puede quedarse en 'asignado' sin que el realtor lo acepte
# antes de volver al pool (equivalente a "si no contesta la llamada, va a
# moderación" de Zillow: el proceso nunca se atasca en un humano).
ASIGNADO_TIMEOUT_HORAS = int(os.getenv("ASIGNADO_TIMEOUT_HORAS", "48"))


async def sweep_asignados_vencidos(pool: Any) -> int:
    """Devuelve al pool los intakes asignados que nadie aceptó a tiempo.

    ponytail: sweep al leer (asignados/pool), sin cron; mover a un DAG de
    Airflow si el volumen lo amerita.
    """
    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE intake SET estado = 'en_pool', agent_id = NULL, updated_at = NOW() "
            "WHERE estado = 'asignado' AND updated_at < NOW() - make_interval(hours => $1)",
            ASIGNADO_TIMEOUT_HORAS,
        )
    n = int(result.split()[-1]) if result else 0
    if n:
        logger.info("sweep: %d intake(s) asignados vencidos devueltos al pool", n)
    return n


def _val(x: Any) -> Any:
    return x.value if hasattr(x, "value") else x


async def _owner_activo_de_agency(agency_id: str, pool: Any) -> Optional[str]:
    """agent_id del owner de la agency, SOLO si su estado ∈ ESTADOS_ASIGNABLES.

    Respeta el invariante agent∈agency (el owner es agency_member) y excluye
    owners inactivo/suspendido/pendiente. None si no hay owner asignable.
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT am.agent_id::text AS agent_id
            FROM agency_member am
            JOIN agent a ON a.id = am.agent_id
            WHERE am.agency_id = $1::uuid
              AND am.rol = 'owner'
              AND a.estado::text = ANY($2::text[])
            LIMIT 1
            """,
            agency_id, list(ESTADOS_ASIGNABLES),
        )
    return row["agent_id"] if row else None


async def _notificar_lead_asignado(agent_id: str, intake_id: str, pool: Any) -> None:
    """Email al realtor: te llegó un lead nuevo. Best-effort — jamás tumba la
    asignación (el timeout de 48h es la red de seguridad si el aviso no llega)."""
    try:
        from api.utils.email import esc, send_email  # import tardío: evita ciclo utils↔services

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT a.email, a.nombre,
                       i.tipo_inmueble::text AS tipo, i.operacion::text AS operacion,
                       i.precio_esperado, COALESCE(i.barrio, b.nombre, 'tu zona') AS barrio
                FROM agent a, intake i
                LEFT JOIN raw.barrios b ON b.id::text = i.zona_codigo
                WHERE a.id = $1::uuid AND i.id = $2::uuid
                """,
                agent_id, intake_id,
            )
        if not row or not row["email"]:
            return
        app_url = os.getenv("APP_URL", "https://medellin.social")
        precio = f"${float(row['precio_esperado'] or 0):,.0f} COP"
        await send_email(
            row["email"],
            f"Nuevo inmueble asignado en {row['barrio']} — acéptalo antes de {ASIGNADO_TIMEOUT_HORAS} h",
            f"""
            <h3 style="color:#1D9E75">Te llegó un inmueble nuevo</h3>
            <p>Hola {esc(row['nombre'])}, un propietario publicó en tu zona patrocinada:</p>
            <p><strong>{esc((row['tipo'] or '').capitalize())} en {esc(row['operacion'] or '')}</strong> · {esc(row['barrio'])} · {precio}</p>
            <p>Tienes <strong>{ASIGNADO_TIMEOUT_HORAS} horas</strong> para aceptarlo; después vuelve al pool abierto.</p>
            <p><a href="{app_url}/realtor/dashboard" style="color:#085041;font-weight:600">Abrir mi inbox →</a></p>
            """,
        )
        logger.info("Lead %s: notificación enviada a %s", intake_id, mask_email(row["email"]))
    except Exception:
        logger.exception("Lead %s: notificación al agente %s falló", intake_id, agent_id)


async def asignar_intake(intake: Any, pool: Any) -> Dict[str, Any]:
    """Asigna el intake a un realtar según patrocinio de su zona, o lo manda al pool.

    Idempotente: sobre un intake que no está 'nuevo' devuelve su estado sin tocar.
    """
    estado = _val(intake.estado)
    if estado != "nuevo":
        return {"resultado": "idempotente", "estado": estado,
                "agent_id": getattr(intake, "agent_id", None)}

    # 1. Zona: usa la que el intake ya guardó (paso 4); si falta, resuélvela.
    barrio_id = getattr(intake, "zona_codigo", None)
    if not barrio_id:
        zona = await resolver_zona(intake.geom, pool)
        barrio_id = zona["barrio_id"]

    # 2. Patrocinadores vigentes (ordenados por antigüedad; [0] = más antiguo).
    agencies = await patrocinadores_vigentes("barrio", barrio_id, pool)
    reparto = len(agencies) > 1  # informativo; TODO reparto: round-robin/tier/carga

    # 3. Primera agency (por antigüedad) con owner activo gana. ESTADOS_ASIGNABLES
    #    filtra también la asignación directa, no solo el pool.
    for agency_id in agencies:
        owner_agent = await _owner_activo_de_agency(agency_id, pool)
        if owner_agent:
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE intake SET agent_id = $1, estado = 'asignado' "
                    "WHERE id = $2 AND estado = 'nuevo'",
                    owner_agent, intake.id,
                )
            intake.agent_id = owner_agent
            intake.estado = "asignado"
            await _notificar_lead_asignado(owner_agent, intake.id, pool)
            return {"resultado": "asignado", "estado": "asignado",
                    "agent_id": owner_agent, "agency_id": agency_id, "reparto": reparto}
        # Agency paga por la zona pero su owner no es asignable → cuesta plata.
        # NO silencioso: dejar rastro para operaciones.
        logger.warning(
            "Sponsorship saltado: agency %s patrocina barrio %s pero no tiene "
            "owner activo (ESTADOS_ASIGNABLES=%s). Lead pasa a siguiente/pool.",
            agency_id, barrio_id, sorted(ESTADOS_ASIGNABLES),
        )

    # 0 patrocinadores, o ninguno con owner activo → pool.
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE intake SET estado = 'en_pool', agent_id = NULL "
            "WHERE id = $1 AND estado = 'nuevo'",
            intake.id,
        )
    intake.estado = "en_pool"
    intake.agent_id = None
    return {"resultado": "en_pool", "estado": "en_pool", "agent_id": None}


async def tomar_del_pool(intake_id: str, agent: Any, pool: Any) -> Dict[str, Any]:
    """Un agente activo toma un intake del pool. UPDATE atómico condicional:
    la carrera la resuelve la DB, no un select-then-update."""
    if _val(agent.estado) not in ESTADOS_ASIGNABLES:
        raise AsignadorError("El agente debe estar activo para tomar del pool")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE intake SET agent_id = $1, estado = 'asignado' "
            "WHERE id = $2 AND estado = 'en_pool' AND agent_id IS NULL "
            "RETURNING id",
            agent.id, intake_id,
        )
    if row is None:
        # Otro agente ganó la carrera (o no estaba en pool). Respuesta válida.
        return {"resultado": "ya_tomado"}
    return {"resultado": "tomado", "estado": "asignado", "agent_id": str(agent.id)}
