"""Comparador — historial de comparaciones y endpoint batch listings."""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.db import get_pool
from api.dependencies import get_current_user, get_optional_user

router = APIRouter()

_USD = 4200  # fallback rate — real rate loaded from parametros at startup


class ComparacionCreate(BaseModel):
    tipo: str  # 'barrios' | 'listings'
    items: List[int]
    filtro_inversion: Optional[str] = None
    nombre: Optional[str] = None


# ─── Historial de comparaciones ───────────────────────────────────────────────

@router.post("/historial", status_code=201)
async def guardar_comparacion(
    body: ComparacionCreate,
    current_user: dict = Depends(get_current_user),
):
    if body.tipo not in ("barrios", "listings"):
        raise HTTPException(status_code=400, detail="tipo debe ser 'barrios' o 'listings'")
    pool = get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO public.comparaciones_historial
            (usuario_id, tipo, items, filtro_inversion, nombre)
        VALUES ($1, $2, $3::jsonb, $4, $5)
        RETURNING id, tipo, items, filtro_inversion, nombre, fecha_creacion
        """,
        current_user["id"], body.tipo,
        json.dumps(body.items),
        body.filtro_inversion, body.nombre,
    )
    result = dict(row)
    if isinstance(result.get("items"), str):
        result["items"] = json.loads(result["items"])
    return result


@router.get("/historial")
async def listar_comparaciones(current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT id, tipo, items, filtro_inversion, nombre, fecha_creacion
        FROM public.comparaciones_historial
        WHERE usuario_id = $1
        ORDER BY fecha_creacion DESC
        LIMIT 20
        """,
        current_user["id"],
    )
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("items"), str):
            d["items"] = json.loads(d["items"])
        out.append(d)
    return out


@router.get("/historial/{comp_id}")
async def obtener_comparacion(
    comp_id: int,
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    row = await pool.fetchrow(
        """
        SELECT id, tipo, items, filtro_inversion, nombre, fecha_creacion
        FROM public.comparaciones_historial
        WHERE id = $1 AND usuario_id = $2
        """,
        comp_id, current_user["id"],
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Comparación no encontrada")
    result = dict(row)
    if isinstance(result.get("items"), str):
        result["items"] = json.loads(result["items"])
    return result


@router.delete("/historial/{comp_id}", status_code=204)
async def eliminar_comparacion(
    comp_id: int,
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    await pool.execute(
        "DELETE FROM public.comparaciones_historial WHERE id = $1 AND usuario_id = $2",
        comp_id, current_user["id"],
    )


# ─── Batch listings para la tabla comparativa ─────────────────────────────────

@router.get("/listings")
async def batch_listings(
    ids: str,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """Devuelve datos completos de hasta 5 listings para la tabla comparativa."""
    try:
        id_list = [int(i.strip()) for i in ids.split(",") if i.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers")
    if not id_list:
        raise HTTPException(status_code=400, detail="Provide at least 1 listing ID")
    if len(id_list) > 5:
        raise HTTPException(status_code=400, detail="Máximo 5 listings por comparación")

    pool = get_pool()
    from api.services.trm_service import get_usd_rate
    usd = await get_usd_rate() or _USD

    rows = await pool.fetch(
        f"""
        WITH lraw AS (
            SELECT ('x'||substr(md5(url),1,8))::bit(32)::int AS id,
                   fuente, tier, tipo_operacion, tipo_inmueble,
                   precio_cop, area_m2,
                   NULLIF(habitaciones, -1) AS habitaciones,
                   banos, barrio_id, url, fotos,
                   CASE
                       WHEN precio_m2 > 0 AND precio_m2 < 2147483647 THEN precio_m2::int
                       WHEN area_m2 > 0 AND precio_cop::float8 / area_m2 < 2147483647
                            THEN ROUND(precio_cop::float8 / area_m2)::int
                       ELSE NULL
                   END AS pm2,
                   fotos[1] AS foto_principal
            FROM staging.stg_listings_unificado
            WHERE ('x'||substr(md5(url),1,8))::bit(32)::int = ANY($1::int[])
        )
        SELECT
            l.id,
            l.fuente,
            l.tipo_operacion,
            l.tipo_inmueble,
            l.precio_cop::bigint,
            (l.precio_cop / {usd})::bigint AS precio_usd,
            l.area_m2::float8,
            l.pm2 AS precio_m2,
            l.habitaciones,
            l.banos::float8,
            l.url,
            l.foto_principal,
            g.estrato_real,
            g.url_activa AS disponible_actualmente,
            l.barrio_id,
            b.nombre AS barrio_nombre,
            CASE
                WHEN l.tipo_operacion = 'venta'
                     AND l.pm2 IS NOT NULL AND l.pm2 > 0 AND m.m2_mediana > 0
                THEN round(((m.m2_mediana - l.pm2)::float8 / m.m2_mediana * 100)::numeric, 1)::float8
                WHEN l.tipo_operacion = 'arriendo'
                     AND l.precio_cop > 0 AND m.arr_mediana > 0
                THEN round(((m.arr_mediana - l.precio_cop)::float8 / m.arr_mediana * 100)::numeric, 1)::float8
                ELSE NULL
            END AS pct_bajo_mediana,
            CASE
                WHEN l.tipo_operacion = 'venta'
                     AND l.pm2 IS NOT NULL AND l.pm2 > 0 AND m.m2_mediana > 0
                     AND (m.m2_mediana - l.pm2)::float8 / m.m2_mediana > 0.10 THEN TRUE
                WHEN l.tipo_operacion = 'arriendo'
                     AND l.precio_cop > 0 AND m.arr_mediana > 0
                     AND (m.arr_mediana - l.precio_cop)::float8 / m.arr_mediana > 0.10 THEN TRUE
                ELSE FALSE
            END AS buena_oferta,
            CASE
                WHEN l.tipo_operacion = 'venta' AND l.precio_cop > 0 AND m.arr_mediana > 0
                THEN round(((m.arr_mediana * 12)::float8 / l.precio_cop * 100)::numeric, 2)::float8
                ELSE NULL
            END AS yield_estimado,
            m.m2_mediana::int AS precio_m2_mediana_barrio,
            m.arr_mediana::int AS arriendo_p50_barrio,
            (CURRENT_DATE - lm.fecha_primera_vez::date)::int
                AS dias_en_mercado,
            ctx.yield_bruto_pct,
            ctx.score_corto,
            ctx.score_mediano,
            ctx.score_largo,
            ctx.liquidez_score,
            ctx.indice_nomada,
            ctx.seguridad_score,
            ctx.var_anual_pct,
            m.m2_p25::int   AS precio_m2_p25,
            m.m2_p75::int   AS precio_m2_p75,
            m.arr_p25::int  AS arr_p25,
            m.arr_p75::int  AS arr_p75
        FROM lraw l
        JOIN raw.barrios b ON b.id = l.barrio_id
        LEFT JOIN analytics.listings_georef g ON g.url = l.url
        LEFT JOIN analytics.barrios_medianas m
            ON m.barrio_id = l.barrio_id
            AND m.tipo_inmueble IS NOT DISTINCT FROM l.tipo_inmueble
        LEFT JOIN analytics.barrios_contexto ctx ON ctx.barrio_id = l.barrio_id
        LEFT JOIN raw.listings_metrocuadrado lm ON lm.url = l.url AND l.fuente = 'metrocuadrado'
        """,
        id_list,
    )
    return [dict(r) for r in rows]
