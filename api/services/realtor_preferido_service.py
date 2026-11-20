"""Realtor Preferido: slots por zona con rotación fija.

Reglas (Israel, 20-nov-2026):
  - 4 slots por barrio, 8 por comuna.
  - Rotación en orden fijo y repetitivo por posición (sin regla de tiempo de respuesta).
  - El precio depende de la zona (nivel A/B/C/D, tabla realtor_slot_precio; valores de ejemplo).
  - Toda zona arranca con >= 1 preferido, aunque no pague (tipo 'gratis').
  - El slot 'gratis' es un relleno: si la zona está llena y entra un pagador, lo reemplaza.

El slot SOLO se activa tras pago verificado (webhook de GHL/Stripe) o por admin;
nunca desde el redirect de "éxito" del front.
"""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta

logger = logging.getLogger(__name__)

CAPACIDAD = {"barrio": 4, "comuna": 8}
ROTACION_SEG = 20  # ventana de rotación: sin escrituras por vista, estable detrás de caché/CDN
NIVEL_DEFAULT = "C"


class SlotError(Exception):
    """Error de negocio al asignar un slot (mensaje apto para el usuario)."""


def _validar_zona(zona_nivel: str) -> None:
    if zona_nivel not in CAPACIDAD:
        raise SlotError("zona_nivel debe ser 'barrio' o 'comuna'")


async def nivel_zona(conn, zona_nivel: str, zona_codigo: str) -> str:
    try:
        n = await conn.fetchval(
            "SELECT nivel FROM analytics.zonas_nivel_precio WHERE zona_nivel = $1 AND zona_codigo = $2",
            zona_nivel, zona_codigo,
        )
    except Exception:  # dbt aún no corrió en este env → nivel por defecto
        return NIVEL_DEFAULT
    return n or NIVEL_DEFAULT


async def precio_slot(conn, zona_nivel: str, zona_codigo: str) -> float:
    nivel = await nivel_zona(conn, zona_nivel, zona_codigo)
    p = await conn.fetchval(
        "SELECT precio_mensual FROM realtor_slot_precio WHERE zona_nivel = $1 AND nivel = $2",
        zona_nivel, nivel,
    )
    return float(p or 0)


async def vencer_slots(conn) -> int:
    """Marca 'vencido' los slots de pago cuya fecha_fin pasó. Idempotente."""
    r = await conn.execute(
        "UPDATE realtor_slot SET estado = 'vencido', updated_at = now() "
        "WHERE estado = 'activo' AND fecha_fin IS NOT NULL AND fecha_fin < CURRENT_DATE"
    )
    return int(r.split()[-1])


async def slots_activos(conn, zona_nivel: str, zona_codigo: str):
    return await conn.fetch(
        "SELECT s.id, s.posicion, s.agent_id, s.tipo, s.fecha_fin FROM realtor_slot s "
        "JOIN agent a ON a.id = s.agent_id AND a.estado::text = 'activo' "
        "WHERE s.zona_nivel = $1 AND s.zona_codigo = $2 AND s.estado = 'activo' "
        "AND (s.fecha_fin IS NULL OR s.fecha_fin >= CURRENT_DATE) ORDER BY s.posicion",
        zona_nivel, zona_codigo,
    )


async def asignar_slot(conn, agent_id: str, zona_nivel: str, zona_codigo: str,
                       tipo: str = "pago", meses: int = 1, pago_ref: str | None = None) -> dict:
    """Asigna o renueva un slot. Correr dentro de una transacción.
    - Renovación: si el agente ya tiene slot activo en la zona, extiende fecha_fin.
    - Si hay posición libre → la menor libre. Si no, un pagador reemplaza un slot 'gratis'.
    - Si no hay lugar → SlotError."""
    _validar_zona(zona_nivel)
    if tipo not in ("pago", "gratis"):
        raise SlotError("tipo debe ser 'pago' o 'gratis'")
    hoy = date.today()

    # Serializa asignaciones concurrentes de la misma zona (evita carreras de posición).
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"slot:{zona_nivel}:{zona_codigo}")
    await vencer_slots(conn)

    fin = None if tipo == "gratis" else hoy + timedelta(days=30 * meses)
    precio = 0.0 if tipo == "gratis" else await precio_slot(conn, zona_nivel, zona_codigo)

    propio = await conn.fetchrow(
        "SELECT id, tipo, fecha_fin FROM realtor_slot WHERE zona_nivel = $1 AND zona_codigo = $2 "
        "AND agent_id = $3 AND estado = 'activo'", zona_nivel, zona_codigo, agent_id,
    )
    if propio:
        if tipo == "gratis":
            return {"slot_id": str(propio["id"]), "accion": "sin_cambio"}
        base = max(propio["fecha_fin"] or hoy, hoy) if propio["tipo"] == "pago" else hoy
        await conn.execute(
            "UPDATE realtor_slot SET tipo = 'pago', precio_mensual = $1, fecha_fin = $2, "
            "pago_ref = COALESCE($3, pago_ref), aviso_vencimiento_at = NULL, updated_at = now() WHERE id = $4",
            precio, base + timedelta(days=30 * meses), pago_ref, propio["id"],
        )
        return {"slot_id": str(propio["id"]), "accion": "renovado"}

    activos = await slots_activos(conn, zona_nivel, zona_codigo)
    ocupadas = {r["posicion"] for r in activos}
    libres = [p for p in range(1, CAPACIDAD[zona_nivel] + 1) if p not in ocupadas]
    if libres:
        pos = libres[0]
    else:
        gratis = [r for r in activos if r["tipo"] == "gratis"]
        if tipo != "pago" or not gratis:
            raise SlotError("La zona no tiene slots disponibles")
        pos = gratis[-1]["posicion"]
        await conn.execute("UPDATE realtor_slot SET estado = 'cancelado', updated_at = now() WHERE id = $1",
                           gratis[-1]["id"])

    sid = await conn.fetchval(
        "INSERT INTO realtor_slot (zona_nivel, zona_codigo, posicion, agent_id, tipo, precio_mensual, "
        "fecha_inicio, fecha_fin, pago_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        zona_nivel, zona_codigo, pos, agent_id, tipo, precio, hoy, fin, pago_ref,
    )
    return {"slot_id": str(sid), "accion": "asignado", "posicion": pos}


async def liberar_slot(conn, slot_id: str) -> bool:
    r = await conn.execute(
        "UPDATE realtor_slot SET estado = 'cancelado', updated_at = now() WHERE id = $1 AND estado = 'activo'",
        slot_id,
    )
    return r.endswith(" 1")


async def siguiente_realtor(conn, zona_nivel: str, zona_codigo: str):
    """Próximo preferido en la rotación (orden fijo por posición, vuelve al inicio).
    Avanza el puntero de forma atómica. None si la zona no tiene preferidos."""
    _validar_zona(zona_nivel)
    activos = await slots_activos(conn, zona_nivel, zona_codigo)
    if not activos:
        return None
    contador = await conn.fetchval(
        "INSERT INTO realtor_rotacion (zona_nivel, zona_codigo, contador) VALUES ($1, $2, 1) "
        "ON CONFLICT (zona_nivel, zona_codigo) DO UPDATE SET contador = realtor_rotacion.contador + 1 "
        "RETURNING contador - 1", zona_nivel, zona_codigo,
    )
    elegido = activos[contador % len(activos)]
    return await conn.fetchrow(
        "SELECT a.id::text AS id, a.nombre, a.foto_url, "
        "       ag.nombre AS agencia_nombre, rev.rating_promedio, rev.n_resenas, $1::text AS tipo "
        "FROM agent a "
        "LEFT JOIN agency_member am ON am.agent_id = a.id "
        "LEFT JOIN agency ag ON ag.id = am.agency_id "
        "LEFT JOIN LATERAL ("
        "  SELECT ROUND(AVG(calificacion)::numeric, 1)::float8 AS rating_promedio, COUNT(*)::int AS n_resenas "
        "  FROM agent_review WHERE agent_id = a.id) rev ON true "
        "WHERE a.id = $2 LIMIT 1",
        elegido["tipo"], elegido["agent_id"],
    )


async def validar_zona(conn, zona_nivel: str, zona_codigo: str) -> None:
    """La zona debe existir: evita cobrar/asignar slots en códigos inventados o mal escritos."""
    _validar_zona(zona_nivel)
    if zona_nivel == "comuna":
        if not (zona_codigo.isdigit() and 1 <= int(zona_codigo) <= 999):
            raise SlotError("zona_codigo de comuna inválido")
        return
    if not zona_codigo.isdigit():
        raise SlotError("zona_codigo de barrio inválido")
    try:
        ok = await conn.fetchval("SELECT 1 FROM raw.barrios WHERE id = $1", int(zona_codigo))
    except Exception:
        return  # raw.barrios ausente en este env: no bloquear
    if not ok:
        raise SlotError("El barrio no existe")


async def procesar_pago_slot(pool, agent_id: str, zona_nivel: str, zona_codigo: str,
                             meses: int = 1, pago_ref: str | None = None) -> dict:
    """Punto único: webhook de pago APROBADO (GHL/Stripe) o confirmador simulado en dev.
    Idempotente por pago_ref (ledger realtor_slot_pago, atómico en la misma transacción)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await validar_zona(conn, zona_nivel, zona_codigo)
            if pago_ref and pago_ref != "simulado":
                nuevo = await conn.fetchval(
                    "INSERT INTO realtor_slot_pago (pago_ref, agent_id, zona_nivel, zona_codigo) "
                    "VALUES ($1,$2,$3,$4) ON CONFLICT (pago_ref) DO NOTHING RETURNING 1",
                    pago_ref, agent_id, zona_nivel, zona_codigo)
                if not nuevo:
                    return {"accion": "duplicado"}
            r = await asignar_slot(conn, agent_id, zona_nivel, zona_codigo, "pago", meses, pago_ref)
            if pago_ref and pago_ref != "simulado":
                await conn.execute("UPDATE realtor_slot_pago SET slot_id = $1 WHERE pago_ref = $2",
                                   r["slot_id"], pago_ref)
            return r


def elegir_rotados(activos: list, k: int = 2, ahora: float | None = None) -> list:
    """k slots consecutivos de la rotación fija, por ventana de tiempo (sin escribir en DB).
    Orden por posición, vuelve al inicio; cada realtor recibe la misma exposición."""
    if not activos:
        return []
    ventana = int((time.time() if ahora is None else ahora) // ROTACION_SEG)
    n = len(activos)
    return [activos[(ventana + i) % n] for i in range(min(k, n))]


async def sincronizar_tier(conn) -> int:
    """agent.tier = preferred (slot de pago activo) > certified (certificado) > member."""
    r = await conn.execute(
        "UPDATE agent a SET tier = x.nuevo FROM ("
        "  SELECT a2.id, CASE WHEN EXISTS (SELECT 1 FROM realtor_slot s WHERE s.agent_id = a2.id "
        "     AND s.estado = 'activo' AND s.tipo = 'pago' AND (s.fecha_fin IS NULL OR s.fecha_fin >= CURRENT_DATE)) "
        "     THEN 'preferred' WHEN a2.certificado THEN 'certified' ELSE 'member' END AS nuevo FROM agent a2"
        ") x WHERE a.id = x.id AND a.tier IS DISTINCT FROM x.nuevo"
    )
    return int(r.split()[-1])


async def seed_gratis(conn) -> dict:
    """Arranque: todo barrio sin preferido recibe un slot 'gratis' de un realtor de la casa
    (agent.es_realtor_casa). Idempotente. Sin realtor de la casa → no hace nada (se avisa)."""
    casa = [str(r["id"]) for r in await conn.fetch(
        "SELECT id FROM agent WHERE es_realtor_casa AND estado::text = 'activo' ORDER BY created_at, id")]
    if not casa:
        logger.warning("seed_gratis: no hay agent.es_realtor_casa activo; barrios sin preferido quedan vacíos")
        return {"asignados": 0, "sin_casa": True}
    vacios = await conn.fetch(
        "SELECT b.id::text AS codigo FROM raw.barrios b WHERE NOT EXISTS (SELECT 1 FROM realtor_slot s "
        "WHERE s.zona_nivel = 'barrio' AND s.zona_codigo = b.id::text AND s.estado = 'activo' "
        "AND (s.fecha_fin IS NULL OR s.fecha_fin >= CURRENT_DATE)) ORDER BY b.id")
    n = 0
    for i, r in enumerate(vacios):
        async with conn.transaction():
            res = await asignar_slot(conn, casa[i % len(casa)], "barrio", r["codigo"], "gratis", 1, None)
        n += res.get("accion") == "asignado"
    return {"asignados": n, "sin_casa": False}


async def por_vencer(conn, dias: int = 5) -> list:
    """Slots de pago que vencen en <= dias y aún sin aviso. Marca aviso_vencimiento_at al devolverlos."""
    return await conn.fetch(
        "UPDATE realtor_slot s SET aviso_vencimiento_at = now() FROM agent a "
        "WHERE a.id = s.agent_id AND s.estado = 'activo' AND s.tipo = 'pago' AND s.aviso_vencimiento_at IS NULL "
        "AND s.fecha_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int "
        "RETURNING a.email, a.nombre, s.zona_nivel, s.zona_codigo, s.fecha_fin", dias)
