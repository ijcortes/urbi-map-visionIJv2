import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from api.db import get_pool
from api.dependencies import get_current_user
from api.limiter import limiter

log = logging.getLogger(__name__)

router = APIRouter()


# ── Listing favorites ─────────────────────────────────────────────────────────

class FavListingRequest(BaseModel):
    url: str
    barrio_id: Optional[int] = None


@router.get("/listings/ids")
@limiter.limit("100/minute")
async def fav_listing_ids(request: Request, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT url FROM raw.favoritos_listings WHERE usuario_id = $1",
        current_user["id"],
    )
    return {"ids": [r["url"] for r in rows]}


@router.get("/listings")
@limiter.limit("100/minute")
async def list_fav_listings(request: Request, current_user: dict = Depends(get_current_user)):
    """Favoritos de inmuebles ENRIQUECIDOS para el perfil (foto, precio, specs,
    barrio, id para 'ver en el mapa'). LATERAL LIMIT 1 porque un mismo url puede
    duplicarse en staging (colisión de hash). Propio sin match en staging → datos
    NULL (fallback: barrio del favorito)."""
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT fl.url, fl.created_at,
               ('x'||substr(md5(fl.url),1,8))::bit(32)::int AS listing_id,
               l.precio_cop, l.area_m2, l.habitaciones, l.banos, l.foto,
               l.tipo_operacion, l.tipo_inmueble,
               COALESCE(l.barrio_id, fl.barrio_id) AS barrio_id,
               b.nombre AS barrio_nombre, b.municipio
        FROM raw.favoritos_listings fl
        LEFT JOIN LATERAL (
            SELECT precio_cop, area_m2, NULLIF(habitaciones, -1) AS habitaciones, banos,
                   fotos[1] AS foto, tipo_operacion, tipo_inmueble, barrio_id
            FROM staging.stg_listings_unificado WHERE url = fl.url LIMIT 1
        ) l ON TRUE
        LEFT JOIN raw.barrios b ON b.id = COALESCE(l.barrio_id, fl.barrio_id)
        WHERE fl.usuario_id = $1
        ORDER BY fl.created_at DESC
        """,
        current_user["id"],
    )
    return [dict(r) for r in rows]


@router.post("/listings", status_code=201)
@limiter.limit("30/minute")
async def add_fav_listing(request: Request, req: FavListingRequest, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    await pool.execute(
        """
        INSERT INTO raw.favoritos_listings (usuario_id, url, barrio_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (usuario_id, url) DO NOTHING
        """,
        current_user["id"], req.url, req.barrio_id,
    )
    return {"ok": True}


@router.delete("/listings", status_code=204)
@limiter.limit("30/minute")
async def remove_fav_listing(
    request: Request,
    url: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    await pool.execute(
        "DELETE FROM raw.favoritos_listings WHERE usuario_id = $1 AND url = $2",
        current_user["id"], url,
    )


class FavoritoRequest(BaseModel):
    barrio_id: int
    nota: Optional[str] = None


@router.get("")
@limiter.limit("100/minute")
async def list_favoritos(request: Request, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT f.id, f.barrio_id, f.nota, f.created_at,
               b.nombre, b.comuna, b.municipio,
               bm.precio_venta_m2_p50, bm.yield_bruto,
               sc.score_corto, sc.score_mediano, sc.score_largo,
               sc.perfil_recomendado
        FROM favoritos f
        JOIN raw.barrios b ON f.barrio_id = b.id
        LEFT JOIN analytics.barrios_mercado bm ON f.barrio_id = bm.barrio_id
        LEFT JOIN analytics.barrios_score_consolidado sc ON f.barrio_id = sc.barrio_id
        WHERE f.usuario_id = $1
        ORDER BY f.created_at DESC
        """,
        current_user["id"],
    )
    return [dict(r) for r in rows]


@router.post("", status_code=201)
@limiter.limit("30/minute")
async def add_favorito(request: Request, req: FavoritoRequest, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO favoritos (usuario_id, barrio_id, nota)
            VALUES ($1, $2, $3)
            ON CONFLICT (usuario_id, barrio_id) DO UPDATE SET nota = EXCLUDED.nota
            RETURNING *
            """,
            current_user["id"], req.barrio_id, req.nota,
        )
    except Exception:
        log.exception("add_favorito failed")
        raise HTTPException(status_code=400, detail="No se pudo guardar el favorito")
    return dict(row)


@router.delete("/{barrio_id}", status_code=204)
@limiter.limit("30/minute")
async def remove_favorito(request: Request, barrio_id: int, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    deleted = await pool.fetchval(
        "DELETE FROM favoritos WHERE usuario_id = $1 AND barrio_id = $2 RETURNING id",
        current_user["id"], barrio_id,
    )
    if deleted is None:
        raise HTTPException(status_code=404, detail="Favorito no encontrado")
