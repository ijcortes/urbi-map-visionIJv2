"""Realtor Preferido: slots por zona (4 por barrio, 8 por comuna), rotación fija.

Público: precios, ocupación de una zona, próximo realtor de la rotación.
Realtor: checkout (link de pago Stripe en GHL) y confirmación simulada (solo dev).
Admin: asignar/liberar slots (incluye los 'gratis' del arranque) y ver cobertura.
El slot de pago se activa por webhook (ghl_webhook: object_type "realtor_slot").
"""
from __future__ import annotations

import os
from typing import Literal, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from api.db import get_pool
from api.dependencies import get_current_user
from api.limiter import limiter
from api.routers.admin import require_admin
from api.services import realtor_preferido_service as svc

router = APIRouter()
Nivel = Literal["barrio", "comuna"]


def _simulacion_habilitada() -> bool:
    return os.getenv("ENABLE_SIMULATED_PAYMENTS", "").lower() in ("1", "true", "yes")


async def _agente_activo(user: dict, pool) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id, estado::text AS estado FROM agent WHERE usuario_id = $1", user.get("id"))
    if not row:
        raise HTTPException(status_code=403, detail="No eres agente")
    if row["estado"] != "activo":
        raise HTTPException(status_code=403, detail="Tu cuenta de agente no está activa")
    return str(row["id"])


@router.get("/precios")
async def precios(pool=Depends(get_pool)):
    rows = await pool.fetch("SELECT zona_nivel, nivel, precio_mensual, es_ejemplo FROM realtor_slot_precio ORDER BY 1, 2")
    return {"capacidad": svc.CAPACIDAD, "precios": [dict(r) for r in rows]}


@router.get("/zona")
@limiter.limit("60/minute")
async def zona(request: Request, zona_nivel: Nivel, zona_codigo: str = Query(max_length=40), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        activos = await svc.slots_activos(conn, zona_nivel, zona_codigo)
        precio = await svc.precio_slot(conn, zona_nivel, zona_codigo)
        nivel = await svc.nivel_zona(conn, zona_nivel, zona_codigo)
    cap = svc.CAPACIDAD[zona_nivel]
    pagos = sum(1 for r in activos if r["tipo"] == "pago")
    return {"zona_nivel": zona_nivel, "zona_codigo": zona_codigo, "nivel": nivel, "capacidad": cap,
            "ocupados": len(activos), "pagos": pagos, "libres": cap - len(activos),
            "disponibles_para_pagar": cap - pagos, "precio_mensual": precio}


@router.get("/siguiente")
@limiter.limit("120/minute")
async def siguiente(request: Request, zona_nivel: Nivel, zona_codigo: str = Query(max_length=40), pool=Depends(get_pool)):
    """Realtor que toca ahora en la rotación de la zona (avanza el puntero)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            r = await svc.siguiente_realtor(conn, zona_nivel, zona_codigo)
    return {"realtor": dict(r) if r else None}


class CheckoutIn(BaseModel):
    zona_nivel: Nivel
    zona_codigo: str = Field(max_length=40)
    meses: int = Field(default=1, ge=1, le=12)


@router.post("/checkout")
async def checkout(body: CheckoutIn, user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Devuelve el link de pago Stripe (orden form / payment link de GHL) con los datos del slot,
    o modo simulado si no hay link configurado."""
    agent_id = await _agente_activo(user, pool)
    async with pool.acquire() as conn:
        try:
            await svc.validar_zona(conn, body.zona_nivel, body.zona_codigo)
        except svc.SlotError as e:
            raise HTTPException(status_code=422, detail=str(e))
        activos = await svc.slots_activos(conn, body.zona_nivel, body.zona_codigo)
        precio = await svc.precio_slot(conn, body.zona_nivel, body.zona_codigo)
        email = await conn.fetchval("SELECT email FROM agent WHERE id = $1", agent_id)
    suyo = any(str(r["agent_id"]) == agent_id for r in activos)
    pagos = sum(1 for r in activos if r["tipo"] == "pago")
    if not suyo and pagos >= svc.CAPACIDAD[body.zona_nivel]:
        raise HTTPException(status_code=409, detail="No quedan slots de pago en esta zona")
    base = {"zona_nivel": body.zona_nivel, "zona_codigo": body.zona_codigo, "meses": body.meses,
            "precio_mensual": precio, "total": precio * body.meses}
    link = os.getenv("GHL_SLOT_CHECKOUT_URL")
    if link:
        q = urlencode({"email": email, "zona_nivel": body.zona_nivel, "zona_codigo": body.zona_codigo,
                       "meses": body.meses})
        return {**base, "modo": "ghl_stripe", "checkout_url": f"{link}{'&' if '?' in link else '?'}{q}"}
    return {**base, "modo": "simulado", "mensaje": "Link de pago no configurado (GHL_SLOT_CHECKOUT_URL)."}


@router.post("/confirmar-simulado")
async def confirmar_simulado(body: CheckoutIn, user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """DEV: simula el pago aprobado. Requiere ENABLE_SIMULATED_PAYMENTS y que NO haya link real."""
    if os.getenv("GHL_SLOT_CHECKOUT_URL") or not _simulacion_habilitada():
        raise HTTPException(status_code=403, detail="Confirmación simulada deshabilitada")
    agent_id = await _agente_activo(user, pool)
    try:
        return await svc.procesar_pago_slot(pool, agent_id, body.zona_nivel, body.zona_codigo, body.meses, "simulado")
    except svc.SlotError as e:
        raise HTTPException(status_code=409, detail=str(e))


class AsignarIn(BaseModel):
    agent_id: str
    zona_nivel: Nivel
    zona_codigo: str = Field(max_length=40)
    tipo: Literal["pago", "gratis"] = "gratis"
    meses: int = Field(default=1, ge=1, le=12)


@router.post("/admin/asignar")
async def admin_asignar(body: AsignarIn, admin: dict = Depends(require_admin), pool=Depends(get_pool)):
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await svc.validar_zona(conn, body.zona_nivel, body.zona_codigo)
                return await svc.asignar_slot(conn, body.agent_id, body.zona_nivel, body.zona_codigo,
                                              body.tipo, body.meses, "admin")
    except svc.SlotError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/admin/slot/{slot_id}")
async def admin_liberar(slot_id: str, admin: dict = Depends(require_admin), pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        if not await svc.liberar_slot(conn, slot_id):
            raise HTTPException(status_code=404, detail="Slot activo no encontrado")
    return {"ok": True}


@router.get("/admin/cobertura")
async def admin_cobertura(nivel: Optional[Nivel] = None, admin: dict = Depends(require_admin), pool=Depends(get_pool)):
    """Zonas con slots + conteo; y barrios de Medellín sin ningún preferido (meta de lanzamiento)."""
    async with pool.acquire() as conn:
        await svc.vencer_slots(conn)
        zonas = await conn.fetch(
            "SELECT zona_nivel, zona_codigo, COUNT(*)::int AS ocupados, "
            "COUNT(*) FILTER (WHERE tipo='pago')::int AS pagos FROM realtor_slot "
            "WHERE estado='activo' AND ($1::text IS NULL OR zona_nivel=$1) GROUP BY 1,2 ORDER BY 1,2", nivel)
        try:
            sin = await conn.fetch(
                "SELECT b.id::text AS zona_codigo, INITCAP(LOWER(b.nombre)) AS nombre FROM raw.barrios b "
                "WHERE b.municipio ILIKE '%medellin%' AND NOT EXISTS (SELECT 1 FROM realtor_slot s "
                "WHERE s.zona_nivel='barrio' AND s.zona_codigo=b.id::text AND s.estado='activo') ORDER BY b.nombre")
            total = await conn.fetchval("SELECT COUNT(*) FROM raw.barrios WHERE municipio ILIKE '%medellin%'")
        except Exception:
            sin, total = [], 0
    return {"zonas": [dict(r) for r in zonas], "barrios_total": total,
            "barrios_sin_preferido": [dict(r) for r in sin]}


@router.get("/zonas")
@limiter.limit("30/minute")
async def zonas(request: Request, pool=Depends(get_pool)):
    """Selector de zona de la landing: barrios y comunas con nivel, precio y cupos de pago."""
    from api.routers.admin import _MUNICIPIO_A_PSEUDO_COMUNA
    async with pool.acquire() as conn:
        precios = {(r["zona_nivel"], r["nivel"]): float(r["precio_mensual"])
                   for r in await conn.fetch("SELECT zona_nivel, nivel, precio_mensual FROM realtor_slot_precio")}
        ocup = {(r["zona_nivel"], r["zona_codigo"]): r["pagos"] for r in await conn.fetch(
            "SELECT zona_nivel, zona_codigo, COUNT(*) FILTER (WHERE tipo='pago')::int AS pagos "
            "FROM realtor_slot WHERE estado='activo' AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_DATE) GROUP BY 1,2")}
        try:
            niv = {(r["zona_nivel"], r["zona_codigo"]): r["nivel"] for r in await conn.fetch(
                "SELECT zona_nivel, zona_codigo::text AS zona_codigo, nivel FROM analytics.zonas_nivel_precio")}
        except Exception:
            niv = {}
        barrios = await conn.fetch(
            "SELECT id::text AS codigo, INITCAP(LOWER(nombre)) AS nombre, municipio FROM raw.barrios "
            "WHERE municipio IS NOT NULL ORDER BY municipio, nombre")
        comunas = await conn.fetch(
            "SELECT DISTINCT bc.cd_comuna::text AS codigo, INITCAP(LOWER(b.comuna)) AS nombre "
            "FROM analytics.barrios_cd bc JOIN raw.barrios b ON b.id = bc.barrio_id "
            "WHERE b.municipio = 'MEDELLIN' AND bc.cd_comuna IS NOT NULL ORDER BY 1")

    def fila(nivel_z, codigo, nombre, extra=None):
        n = niv.get((nivel_z, codigo), "C")
        cap = svc.CAPACIDAD[nivel_z]
        d = {"zona_nivel": nivel_z, "zona_codigo": codigo, "nombre": nombre, "nivel": n,
             "precio_mensual": precios.get((nivel_z, n), 0.0), "cupos": max(cap - ocup.get((nivel_z, codigo), 0), 0)}
        if extra:
            d.update(extra)
        return d

    out_c = [fila("comuna", r["codigo"], r["nombre"] or r["codigo"], {"municipio": "MEDELLIN"}) for r in comunas]
    out_c += [fila("comuna", cod, mun.title(), {"municipio": mun}) for mun, cod in _MUNICIPIO_A_PSEUDO_COMUNA.items()]
    return {"barrios": [fila("barrio", r["codigo"], r["nombre"], {"municipio": r["municipio"]}) for r in barrios],
            "comunas": out_c, "capacidad": svc.CAPACIDAD}


class CasaIn(BaseModel):
    agent_id: str
    es_realtor_casa: bool = True


@router.post("/admin/casa")
async def admin_casa(body: CasaIn, admin: dict = Depends(require_admin), pool=Depends(get_pool)):
    """Marca/desmarca al realtor de la casa que ocupa el preferido gratis de arranque (cron lo siembra)."""
    r = await pool.execute("UPDATE agent SET es_realtor_casa = $1 WHERE id = $2::uuid", body.es_realtor_casa, body.agent_id)
    if r.endswith(" 0"):
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    return {"ok": True}
