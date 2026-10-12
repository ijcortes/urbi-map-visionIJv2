from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from api.db import get_pool
from api.dependencies import get_current_user
from api.utils.urls import require_safe_url

logger = logging.getLogger(__name__)
router = APIRouter()


class EventoOut(BaseModel):
    id: int
    fuente: str
    titulo: str
    descripcion: Optional[str]
    foto_url: Optional[str]
    url_externo: Optional[str]
    fecha_inicio: str
    fecha_fin: Optional[str]
    gratuito: bool
    precio: float
    moneda: str = "COP"
    organizador: Optional[str]
    categoria: Optional[str]
    tipo_audiencia: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    barrio_id: Optional[int]
    barrio_nombre: Optional[str]
    destacado: bool


class EventosResponse(BaseModel):
    barrio_id: Optional[int]
    municipio: Optional[str] = None
    total: int
    eventos: list[EventoOut]


# ── Todos (Valle de Aburrá completo) — must be before /{barrio_id}/ routes ────

# "Destacado" en un contexto sin barrio (todos / municipio) solo cuenta si el
# alcance es 'ciudad' (o NULL — filas de antes de la migración 0079, tratadas
# como ciudad para no regresar el comportamiento que ya tenían).
_DESTACADO_CIUDAD = "(e.destacado AND (e.destacado_nivel IS NULL OR e.destacado_nivel = 'ciudad'))"

_TODOS_EVENTOS_QUERY = f"""
SELECT
    e.id, e.fuente, e.titulo, e.descripcion,
    e.foto_url, e.url_externo,
    e.fecha_inicio::text AS fecha_inicio,
    e.fecha_fin::text    AS fecha_fin,
    e.gratuito, COALESCE(e.precio, 0) AS precio,
    COALESCE(e.moneda, 'COP') AS moneda,
    e.organizador, e.categoria, e.tipo_audiencia,
    e.lat, e.lon, e.barrio_id,
    b.nombre AS barrio_nombre,
    {_DESTACADO_CIUDAD} AS destacado
FROM public.eventos e
LEFT JOIN raw.barrios b ON e.barrio_id = b.id
WHERE e.activo = TRUE
  AND e.fecha_inicio >= $1
  AND e.fecha_inicio <= $2
  AND ($3::text IS NULL OR e.categoria     = $3)
  AND ($4::text IS NULL OR e.tipo_audiencia = $4)
  AND ($5::bool IS NULL OR e.gratuito       = $5)
ORDER BY destacado DESC, e.fecha_inicio ASC
LIMIT $6 OFFSET $7
"""

_TODOS_COUNT_QUERY = """
SELECT COUNT(*)
FROM public.eventos e
WHERE e.activo = TRUE
  AND e.fecha_inicio >= $1
  AND e.fecha_inicio <= $2
  AND ($3::text IS NULL OR e.categoria     = $3)
  AND ($4::text IS NULL OR e.tipo_audiencia = $4)
  AND ($5::bool IS NULL OR e.gratuito       = $5)
"""


@router.get("/todos/eventos", response_model=EventosResponse)
async def get_eventos_todos(
    categoria: Optional[str] = Query(None),
    tipo_audiencia: Optional[str] = Query(None),
    fecha_desde: Optional[date] = Query(None),
    fecha_hasta: Optional[date] = Query(None),
    gratuito: Optional[bool] = Query(None),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    pool=Depends(get_pool),
):
    hoy = date.today()
    f_desde = fecha_desde or hoy
    f_hasta = fecha_hasta or (hoy + timedelta(days=30))
    args = (f_desde, f_hasta, categoria, tipo_audiencia, gratuito)
    try:
        rows, total_row = await pool.fetch(
            _TODOS_EVENTOS_QUERY, *args, limit, offset
        ), await pool.fetchrow(_TODOS_COUNT_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return EventosResponse(
        barrio_id=None, municipio="VALLE DE ABURRÁ",
        total=total_row[0] if total_row else 0,
        eventos=[_build_evento_out(r) for r in rows],
    )


# "Comuna" de un barrio: la real (Medellín, analytics.barrios_cd) o, para los otros
# municipios del Valle de Aburrá (sin comunas), el pseudo-código 101-109 del municipio —
# mismo mapeo que admin.py::_MUNICIPIO_A_PSEUDO_COMUNA y comunidad.py::_MUNICIPIO_TOTAL_COUNTS_QUERY.
def _zona_comuna_de(barrio_param: str) -> str:
    return f"""COALESCE(
        (SELECT bc.cd_comuna::text FROM analytics.barrios_cd bc WHERE bc.barrio_id = {barrio_param}),
        (SELECT CASE bx.municipio
            WHEN 'BELLO' THEN '101' WHEN 'ENVIGADO' THEN '102' WHEN 'ITAGUI' THEN '103'
            WHEN 'SABANETA' THEN '104' WHEN 'LA ESTRELLA' THEN '105'
            WHEN 'CALDAS' THEN '106' WHEN 'COPACABANA' THEN '107'
            WHEN 'GIRARDOTA' THEN '108' WHEN 'BARBOSA' THEN '109' END
         FROM raw.barrios bx WHERE bx.id = {barrio_param})
    )"""


# Alcance completo (barrio | comuna | ciudad) para la vista de un barrio puntual.
# NULL en destacado_nivel (filas de antes de 0079) = ciudad, mismo criterio que arriba.
_DESTACADO_AQUI = f"""(
    e.destacado AND (
        e.destacado_nivel IS NULL
        OR e.destacado_nivel = 'ciudad'
        OR (e.destacado_nivel = 'comuna' AND e.destacado_zona_codigo = {_zona_comuna_de("$6")})
        OR (e.destacado_nivel = 'barrio' AND e.destacado_zona_codigo = $6::text)
    )
)"""

_EVENTOS_QUERY = f"""
SELECT
    e.id,
    e.fuente,
    e.titulo,
    e.descripcion,
    e.foto_url,
    e.url_externo,
    e.fecha_inicio::text    AS fecha_inicio,
    e.fecha_fin::text       AS fecha_fin,
    e.gratuito,
    COALESCE(e.precio, 0)   AS precio,
    COALESCE(e.moneda, 'COP') AS moneda,
    e.organizador,
    e.categoria,
    e.tipo_audiencia,
    e.lat,
    e.lon,
    e.barrio_id,
    b.nombre                AS barrio_nombre,
    {_DESTACADO_AQUI} AS destacado
FROM public.eventos e
LEFT JOIN raw.barrios b ON e.barrio_id = b.id
WHERE e.activo = TRUE
  AND e.fecha_inicio >= $1
  AND e.fecha_inicio <= $2
  AND ($3::text IS NULL OR e.categoria     = $3)
  AND ($4::text IS NULL OR e.tipo_audiencia = $4)
  AND ($5::bool IS NULL OR e.gratuito       = $5)
  AND (
    e.barrio_id IN (
        SELECT b2.id FROM raw.barrios b2
        WHERE b2.municipio = (SELECT municipio FROM raw.barrios WHERE id = $6)
          AND b2.comuna    = (SELECT comuna    FROM raw.barrios WHERE id = $6)
    )
    OR {_DESTACADO_AQUI}
  )
ORDER BY destacado DESC, e.fecha_inicio ASC
LIMIT $7 OFFSET $8
"""

_COUNT_QUERY = f"""
SELECT COUNT(*)
FROM public.eventos e
WHERE e.activo = TRUE
  AND e.fecha_inicio >= $1
  AND e.fecha_inicio <= $2
  AND ($3::text IS NULL OR e.categoria     = $3)
  AND ($4::text IS NULL OR e.tipo_audiencia = $4)
  AND ($5::bool IS NULL OR e.gratuito       = $5)
  AND (
    e.barrio_id IN (
        SELECT b2.id FROM raw.barrios b2
        WHERE b2.municipio = (SELECT municipio FROM raw.barrios WHERE id = $6)
          AND b2.comuna    = (SELECT comuna    FROM raw.barrios WHERE id = $6)
    )
    OR {_DESTACADO_AQUI}
  )
"""


@router.get("/{barrio_id}/eventos", response_model=EventosResponse)
async def get_eventos_barrio(
    barrio_id: int,
    categoria: Optional[str] = Query(None),
    tipo_audiencia: Optional[str] = Query(None),
    fecha_desde: Optional[date] = Query(None),
    fecha_hasta: Optional[date] = Query(None),
    gratuito: Optional[bool] = Query(None),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    pool=Depends(get_pool),
):
    hoy = date.today()
    f_desde = fecha_desde or hoy
    f_hasta = fecha_hasta or (hoy + timedelta(days=30))

    args = (f_desde, f_hasta, categoria, tipo_audiencia, gratuito, barrio_id)

    try:
        rows, total_row = await pool.fetch(
            _EVENTOS_QUERY, *args, limit, offset
        ), await pool.fetchrow(_COUNT_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    return EventosResponse(
        barrio_id=barrio_id, total=total_row[0] if total_row else 0,
        eventos=[_build_evento_out(r) for r in rows],
    )


_MUNICIPIO_EVENTOS_QUERY = f"""
SELECT
    e.id, e.fuente, e.titulo, e.descripcion,
    e.foto_url, e.url_externo,
    e.fecha_inicio::text AS fecha_inicio,
    e.fecha_fin::text    AS fecha_fin,
    e.gratuito, COALESCE(e.precio, 0) AS precio,
    COALESCE(e.moneda, 'COP') AS moneda,
    e.organizador, e.categoria, e.tipo_audiencia,
    e.lat, e.lon, e.barrio_id,
    b.nombre AS barrio_nombre,
    {_DESTACADO_CIUDAD} AS destacado
FROM public.eventos e
LEFT JOIN raw.barrios b ON e.barrio_id = b.id
WHERE e.activo = TRUE
  AND e.fecha_inicio >= $1
  AND e.fecha_inicio <= $2
  AND ($3::text IS NULL OR e.categoria     = $3)
  AND ($4::text IS NULL OR e.tipo_audiencia = $4)
  AND ($5::bool IS NULL OR e.gratuito       = $5)
  AND ($6::text IS NULL OR UPPER(b.municipio) = UPPER($6))
ORDER BY destacado DESC, e.fecha_inicio ASC
LIMIT $7 OFFSET $8
"""

_MUNICIPIO_COUNT_QUERY = """
SELECT COUNT(*)
FROM public.eventos e
LEFT JOIN raw.barrios b ON e.barrio_id = b.id
WHERE e.activo = TRUE
  AND e.fecha_inicio >= $1
  AND e.fecha_inicio <= $2
  AND ($3::text IS NULL OR e.categoria     = $3)
  AND ($4::text IS NULL OR e.tipo_audiencia = $4)
  AND ($5::bool IS NULL OR e.gratuito       = $5)
  AND ($6::text IS NULL OR UPPER(b.municipio) = UPPER($6))
"""


def _build_evento_out(r) -> EventoOut:
    return EventoOut(
        id=r["id"], fuente=r["fuente"], titulo=r["titulo"],
        descripcion=r["descripcion"], foto_url=r["foto_url"],
        url_externo=r["url_externo"], fecha_inicio=r["fecha_inicio"],
        fecha_fin=r["fecha_fin"], gratuito=r["gratuito"],
        precio=float(r["precio"]), moneda=r["moneda"], organizador=r["organizador"],
        categoria=r["categoria"], tipo_audiencia=r["tipo_audiencia"],
        lat=r["lat"], lon=r["lon"], barrio_id=r["barrio_id"],
        barrio_nombre=r["barrio_nombre"], destacado=r["destacado"],
    )


@router.get("/municipio/{municipio}/eventos", response_model=EventosResponse)
async def get_eventos_municipio(
    municipio: str,
    categoria: Optional[str] = Query(None),
    tipo_audiencia: Optional[str] = Query(None),
    fecha_desde: Optional[date] = Query(None),
    fecha_hasta: Optional[date] = Query(None),
    gratuito: Optional[bool] = Query(None),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    pool=Depends(get_pool),
):
    hoy = date.today()
    f_desde = fecha_desde or hoy
    f_hasta = fecha_hasta or (hoy + timedelta(days=30))
    mun_filter = None if municipio.upper() == "VALLE DE ABURRÁ" else municipio
    args = (f_desde, f_hasta, categoria, tipo_audiencia, gratuito, mun_filter)
    try:
        rows, total_row = await pool.fetch(
            _MUNICIPIO_EVENTOS_QUERY, *args, limit, offset
        ), await pool.fetchrow(_MUNICIPIO_COUNT_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return EventosResponse(
        barrio_id=None, municipio=municipio.upper(),
        total=total_row[0] if total_row else 0,
        eventos=[_build_evento_out(r) for r in rows],
    )



# ── Tiendas ────────────────────────────────────────────────────────────────────


GRUPOS: dict[str, list[str]] = {
    "gastronomia": ["brunch", "almuerzo", "cena", "bares", "cafes", "comida_rapida", "panaderia", "asiatica"],
    "salud": ["medicos", "dentistas", "dermatologia", "optometria", "fisioterapia", "masajes_spa", "peluquerias", "estetica"],
    "fitness": ["gimnasios", "yoga"],
    "servicios_hogar": ["remodelaciones", "plomeria", "electricistas", "mudanzas", "cerrajeria", "jardineria"],
    "mas_servicios": ["bancos", "mascotas", "parqueaderos", "segunda_mano"],
}


class TiendaOut(BaseModel):
    id: int
    google_place_id: Optional[str]
    nombre: str
    descripcion: Optional[str]
    categoria: Optional[str]
    barrio_id: Optional[int]
    barrio_nombre: Optional[str]
    direccion: Optional[str]
    telefono: Optional[str]
    whatsapp: Optional[str]
    website: Optional[str]
    foto_url: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    rating_google: Optional[float]
    precio_rango: Optional[str]
    horario: Optional[Any]
    destacado: bool
    verificado: bool


class TiendasResponse(BaseModel):
    barrio_id: Optional[int]
    municipio: Optional[str] = None
    total: int
    tiendas: list[TiendaOut]


_DESTACADO_AQUI_TIENDA = f"""(
    t.destacado AND (
        t.destacado_nivel IS NULL
        OR t.destacado_nivel = 'ciudad'
        OR (t.destacado_nivel = 'comuna' AND t.destacado_zona_codigo = {_zona_comuna_de("$1")})
        OR (t.destacado_nivel = 'barrio' AND t.destacado_zona_codigo = $1::text)
    )
)"""
_DESTACADO_CIUDAD_TIENDA = "(t.destacado AND (t.destacado_nivel IS NULL OR t.destacado_nivel = 'ciudad'))"

# Vista agregada de un municipio completo (Bello/Envigado/...) — $1 = nombre de
# municipio, no hay un barrio_id puntual. Solo ciudad o comuna (pseudo-código del
# propio municipio) pueden aparecer aquí; un destacado a nivel barrio nunca
# "sube" a esta vista agregada (mismo criterio que a nivel comuna en `_DESTACADO_AQUI_TIENDA`).
_DESTACADO_MUNICIPIO_TIENDA = """COALESCE(
    t.destacado AND (
        t.destacado_nivel IS NULL
        OR t.destacado_nivel = 'ciudad'
        OR (t.destacado_nivel = 'comuna' AND t.destacado_zona_codigo = CASE UPPER($1)
              WHEN 'BELLO' THEN '101' WHEN 'ENVIGADO' THEN '102' WHEN 'ITAGUI' THEN '103'
              WHEN 'SABANETA' THEN '104' WHEN 'LA ESTRELLA' THEN '105'
              WHEN 'CALDAS' THEN '106' WHEN 'COPACABANA' THEN '107'
              WHEN 'GIRARDOTA' THEN '108' WHEN 'BARBOSA' THEN '109' END)
    ),
    FALSE
)"""

_TIENDAS_QUERY = f"""
SELECT
    t.id,
    t.google_place_id,
    t.nombre,
    t.descripcion,
    t.categoria,
    t.barrio_id,
    b.nombre        AS barrio_nombre,
    t.direccion,
    t.telefono,
    t.whatsapp,
    t.website,
    t.foto_url,
    t.lat,
    t.lon,
    t.rating_google,
    t.precio_rango,
    t.horario,
    {_DESTACADO_AQUI_TIENDA} AS destacado,
    t.verificado
FROM public.tiendas t
LEFT JOIN raw.barrios b ON t.barrio_id = b.id
WHERE t.activo = TRUE
  AND (
    t.barrio_id = $1
    OR t.barrio_id IN (
        SELECT b2.id FROM raw.barrios b2
        WHERE ST_DWithin(
            b2.geometry::geography,
            (SELECT geometry::geography FROM raw.barrios WHERE id = $1),
            1500
        )
    )
    OR {_DESTACADO_AQUI_TIENDA}
  )
  AND ($2::text[] IS NULL OR t.categoria = ANY($2::text[]))
  AND ($3::text IS NULL OR t.categoria    = $3)
  AND ($4::text IS NULL OR t.precio_rango = $4)
  AND ($5::float IS NULL OR t.rating_google >= $5::float)
  AND (NOT $6::bool OR t.whatsapp IS NOT NULL OR t.telefono IS NOT NULL)
  AND ($7::bool IS NULL OR {_DESTACADO_AQUI_TIENDA} = $7::bool)
ORDER BY destacado DESC, t.rating_google DESC NULLS LAST
LIMIT $8 OFFSET $9
"""

_TIENDAS_COUNT_QUERY = f"""
SELECT COUNT(*)
FROM public.tiendas t
WHERE t.activo = TRUE
  AND (
    t.barrio_id = $1
    OR t.barrio_id IN (
        SELECT b2.id FROM raw.barrios b2
        WHERE ST_DWithin(
            b2.geometry::geography,
            (SELECT geometry::geography FROM raw.barrios WHERE id = $1),
            1500
        )
    )
    OR {_DESTACADO_AQUI_TIENDA}
  )
  AND ($2::text[] IS NULL OR t.categoria = ANY($2::text[]))
  AND ($3::text IS NULL OR t.categoria    = $3)
  AND ($4::text IS NULL OR t.precio_rango = $4)
  AND ($5::float IS NULL OR t.rating_google >= $5::float)
  AND (NOT $6::bool OR t.whatsapp IS NOT NULL OR t.telefono IS NOT NULL)
  AND ($7::bool IS NULL OR {_DESTACADO_AQUI_TIENDA} = $7::bool)
"""


_TODOS_TIENDAS_QUERY = f"""
SELECT
    t.id, t.google_place_id, t.nombre, t.descripcion, t.categoria,
    t.barrio_id, b.nombre AS barrio_nombre,
    t.direccion, t.telefono, t.whatsapp, t.website,
    t.foto_url, t.lat, t.lon,
    t.rating_google, t.precio_rango, t.horario,
    {_DESTACADO_CIUDAD_TIENDA} AS destacado, t.verificado
FROM public.tiendas t
LEFT JOIN raw.barrios b ON t.barrio_id = b.id
WHERE t.activo = TRUE
  AND ($1::text[] IS NULL OR t.categoria = ANY($1::text[]))
  AND ($2::text IS NULL OR t.categoria   = $2)
  AND ($3::text IS NULL OR t.precio_rango = $3)
  AND ($4::float IS NULL OR t.rating_google >= $4::float)
  AND (NOT $5::bool OR t.whatsapp IS NOT NULL OR t.telefono IS NOT NULL)
  AND ($6::bool IS NULL OR {_DESTACADO_CIUDAD_TIENDA} = $6::bool)
ORDER BY destacado DESC, t.rating_google DESC NULLS LAST
LIMIT $7 OFFSET $8
"""

_TODOS_TIENDAS_COUNT_QUERY = f"""
SELECT COUNT(*) FROM public.tiendas t
WHERE t.activo = TRUE
  AND ($1::text[] IS NULL OR t.categoria = ANY($1::text[]))
  AND ($2::text IS NULL OR t.categoria   = $2)
  AND ($3::text IS NULL OR t.precio_rango = $3)
  AND ($4::float IS NULL OR t.rating_google >= $4::float)
  AND (NOT $5::bool OR t.whatsapp IS NOT NULL OR t.telefono IS NOT NULL)
  AND ($6::bool IS NULL OR {_DESTACADO_CIUDAD_TIENDA} = $6::bool)
"""


@router.get("/todos/tiendas", response_model=TiendasResponse)
async def get_tiendas_todos(
    grupo: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    precio_rango: Optional[str] = Query(None),
    rating_min: Optional[float] = Query(None),
    con_whatsapp: bool = Query(False),
    destacado: Optional[bool] = Query(None),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    pool=Depends(get_pool),
):
    grupo_cats: Optional[list[str]] = GRUPOS.get(grupo) if grupo else None
    args = (grupo_cats, categoria, precio_rango, rating_min, con_whatsapp, destacado)
    try:
        rows, total_row = await pool.fetch(
            _TODOS_TIENDAS_QUERY, *args, limit, offset
        ), await pool.fetchrow(_TODOS_TIENDAS_COUNT_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    total = total_row[0] if total_row else 0
    tiendas = [
        TiendaOut(
            id=r["id"], google_place_id=r["google_place_id"], nombre=r["nombre"],
            descripcion=r["descripcion"], categoria=r["categoria"],
            barrio_id=r["barrio_id"], barrio_nombre=r["barrio_nombre"],
            direccion=r["direccion"], telefono=r["telefono"], whatsapp=r["whatsapp"],
            website=r["website"], foto_url=r["foto_url"], lat=r["lat"], lon=r["lon"],
            rating_google=r["rating_google"], precio_rango=r["precio_rango"],
            horario=r["horario"], destacado=r["destacado"], verificado=r["verificado"],
        )
        for r in rows
    ]
    return TiendasResponse(barrio_id=None, municipio="VALLE DE ABURRÁ", total=total, tiendas=tiendas)


@router.get("/{barrio_id}/tiendas", response_model=TiendasResponse)
async def get_tiendas_barrio(
    barrio_id: int,
    grupo: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    precio_rango: Optional[str] = Query(None),
    rating_min: Optional[float] = Query(None),
    con_whatsapp: bool = Query(False),
    destacado: Optional[bool] = Query(None),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    pool=Depends(get_pool),
):
    grupo_cats: Optional[list[str]] = GRUPOS.get(grupo) if grupo else None
    args = (barrio_id, grupo_cats, categoria, precio_rango, rating_min, con_whatsapp, destacado)

    try:
        rows, total_row = await pool.fetch(
            _TIENDAS_QUERY, *args, limit, offset
        ), await pool.fetchrow(_TIENDAS_COUNT_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    total = total_row[0] if total_row else 0

    tiendas = [
        TiendaOut(
            id=r["id"],
            google_place_id=r["google_place_id"],
            nombre=r["nombre"],
            descripcion=r["descripcion"],
            categoria=r["categoria"],
            barrio_id=r["barrio_id"],
            barrio_nombre=r["barrio_nombre"],
            direccion=r["direccion"],
            telefono=r["telefono"],
            whatsapp=r["whatsapp"],
            website=r["website"],
            foto_url=r["foto_url"],
            lat=r["lat"],
            lon=r["lon"],
            rating_google=r["rating_google"],
            precio_rango=r["precio_rango"],
            horario=r["horario"],
            destacado=r["destacado"],
            verificado=r["verificado"],
        )
        for r in rows
    ]

    return TiendasResponse(barrio_id=barrio_id, total=total, tiendas=tiendas)


_GRUPOS_MAP: dict[str, list[str]] = {
    "gastronomia":     ["brunch","almuerzo","cena","bares","cafes","comida_rapida","panaderia","asiatica"],
    "salud":           ["medicos","dentistas","dermatologia","fisioterapia","masajes_spa","peluquerias","estetica"],
    "fitness":         ["gimnasios","yoga"],
    "servicios_hogar": ["remodelaciones","plomeria","electricistas","mudanzas","cerrajeria","jardineria"],
    "mas_servicios":   ["bancos","mascotas","parqueaderos","segunda_mano","agente_inmobiliario","otro"],
}

_COUNTS_QUERY = """
SELECT
    CASE
        WHEN t.categoria = ANY($2::text[]) THEN 'gastronomia'
        WHEN t.categoria = ANY($3::text[]) THEN 'salud'
        WHEN t.categoria = ANY($4::text[]) THEN 'fitness'
        WHEN t.categoria = ANY($5::text[]) THEN 'servicios_hogar'
        ELSE 'mas_servicios'
    END AS grupo,
    COUNT(*) AS n
FROM public.tiendas t
LEFT JOIN raw.barrios b ON t.barrio_id = b.id
WHERE t.activo = TRUE
  AND (
    t.barrio_id = $1
    OR t.barrio_id IN (
        SELECT b2.id FROM raw.barrios b2
        WHERE ST_DWithin(
            b2.geometry::geography,
            (SELECT geometry::geography FROM raw.barrios WHERE id = $1),
            1500
        )
    )
  )
GROUP BY grupo
"""

_MUNICIPIO_COUNTS_QUERY = """
SELECT
    CASE
        WHEN t.categoria = ANY($2::text[]) THEN 'gastronomia'
        WHEN t.categoria = ANY($3::text[]) THEN 'salud'
        WHEN t.categoria = ANY($4::text[]) THEN 'fitness'
        WHEN t.categoria = ANY($5::text[]) THEN 'servicios_hogar'
        ELSE 'mas_servicios'
    END AS grupo,
    COUNT(*) AS n
FROM public.tiendas t
LEFT JOIN raw.barrios b ON t.barrio_id = b.id
WHERE t.activo = TRUE
  AND UPPER(b.municipio) = UPPER($1)
GROUP BY grupo
"""


@router.get("/{barrio_id}/tiendas/counts")
async def get_tiendas_counts(barrio_id: int, pool=Depends(get_pool)):
    args = (
        barrio_id,
        _GRUPOS_MAP["gastronomia"],
        _GRUPOS_MAP["salud"],
        _GRUPOS_MAP["fitness"],
        _GRUPOS_MAP["servicios_hogar"],
    )
    try:
        rows = await pool.fetch(_COUNTS_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return {r["grupo"]: r["n"] for r in rows}


@router.get("/municipio/{municipio}/tiendas/counts")
async def get_municipio_tiendas_counts(municipio: str, pool=Depends(get_pool)):
    args = (
        municipio,
        _GRUPOS_MAP["gastronomia"],
        _GRUPOS_MAP["salud"],
        _GRUPOS_MAP["fitness"],
        _GRUPOS_MAP["servicios_hogar"],
    )
    try:
        rows = await pool.fetch(_MUNICIPIO_COUNTS_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return {r["grupo"]: r["n"] for r in rows}


# ── Densidad de negocios por comuna — colorea el mapa de zonas en /local-business ─
# cd_comuna 1-16 = comunas de Medellín, 101-109 = municipios del Valle de Aburrá
# (mismo esquema que api/routers/comunas.py::get_comunas_geojson).

_COMUNA_TOTAL_COUNTS_QUERY = """
SELECT bc.cd_comuna, COUNT(*)::int AS total
FROM public.tiendas t
JOIN raw.barrios b            ON t.barrio_id = b.id
JOIN analytics.barrios_cd bc  ON bc.barrio_id = b.id
WHERE t.activo = TRUE AND b.municipio = 'MEDELLIN'
GROUP BY bc.cd_comuna
"""

_MUNICIPIO_TOTAL_COUNTS_QUERY = """
SELECT
    CASE b.municipio
        WHEN 'BELLO'       THEN 101
        WHEN 'ENVIGADO'    THEN 102
        WHEN 'ITAGUI'      THEN 103
        WHEN 'SABANETA'    THEN 104
        WHEN 'LA ESTRELLA' THEN 105
        WHEN 'CALDAS'      THEN 106
        WHEN 'COPACABANA'  THEN 107
        WHEN 'GIRARDOTA'   THEN 108
        WHEN 'BARBOSA'     THEN 109
    END AS cd_comuna,
    COUNT(*)::int AS total
FROM public.tiendas t
JOIN raw.barrios b ON t.barrio_id = b.id
WHERE t.activo = TRUE
  AND b.municipio IN ('BELLO', 'ENVIGADO', 'ITAGUI', 'SABANETA', 'LA ESTRELLA', 'CALDAS', 'COPACABANA', 'GIRARDOTA', 'BARBOSA')
GROUP BY b.municipio
"""


@router.get("/comunas/tiendas-counts")
async def get_comunas_tiendas_counts(pool=Depends(get_pool)):
    try:
        comuna_rows    = await pool.fetch(_COMUNA_TOTAL_COUNTS_QUERY)
        municipio_rows = await pool.fetch(_MUNICIPIO_TOTAL_COUNTS_QUERY)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    counts: dict[str, int] = {}
    for r in (*comuna_rows, *municipio_rows):
        if r["cd_comuna"] is not None:
            counts[str(r["cd_comuna"])] = r["total"]
    return {"counts": counts}


_MUNICIPIO_TIENDAS_QUERY = f"""
SELECT
    t.id,
    t.google_place_id,
    t.nombre,
    t.descripcion,
    t.categoria,
    t.barrio_id,
    b.nombre        AS barrio_nombre,
    t.direccion,
    t.telefono,
    t.whatsapp,
    t.website,
    t.foto_url,
    t.lat,
    t.lon,
    t.rating_google,
    t.precio_rango,
    t.horario,
    {_DESTACADO_MUNICIPIO_TIENDA} AS destacado,
    t.verificado
FROM public.tiendas t
LEFT JOIN raw.barrios b ON t.barrio_id = b.id
WHERE t.activo = TRUE
  AND UPPER(b.municipio) = UPPER($1)
  AND ($2::text[] IS NULL OR t.categoria = ANY($2::text[]))
  AND ($3::text IS NULL OR t.categoria    = $3)
  AND ($4::text IS NULL OR t.precio_rango = $4)
  AND ($5::float IS NULL OR t.rating_google >= $5::float)
  AND (NOT $6::bool OR t.whatsapp IS NOT NULL OR t.telefono IS NOT NULL)
  AND ($7::bool IS NULL OR {_DESTACADO_MUNICIPIO_TIENDA} = $7::bool)
ORDER BY destacado DESC, t.rating_google DESC NULLS LAST
LIMIT $8 OFFSET $9
"""

_MUNICIPIO_TIENDAS_COUNT_QUERY = f"""
SELECT COUNT(*)
FROM public.tiendas t
LEFT JOIN raw.barrios b ON t.barrio_id = b.id
WHERE t.activo = TRUE
  AND UPPER(b.municipio) = UPPER($1)
  AND ($2::text[] IS NULL OR t.categoria = ANY($2::text[]))
  AND ($3::text IS NULL OR t.categoria    = $3)
  AND ($4::text IS NULL OR t.precio_rango = $4)
  AND ($5::float IS NULL OR t.rating_google >= $5::float)
  AND (NOT $6::bool OR t.whatsapp IS NOT NULL OR t.telefono IS NOT NULL)
  AND ($7::bool IS NULL OR {_DESTACADO_MUNICIPIO_TIENDA} = $7::bool)
"""


@router.get("/municipio/{municipio}/tiendas", response_model=TiendasResponse)
async def get_tiendas_municipio(
    municipio: str,
    grupo: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    precio_rango: Optional[str] = Query(None),
    rating_min: Optional[float] = Query(None),
    con_whatsapp: bool = Query(False),
    destacado: Optional[bool] = Query(None),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    pool=Depends(get_pool),
):
    grupo_cats: Optional[list[str]] = GRUPOS.get(grupo) if grupo else None
    args = (municipio, grupo_cats, categoria, precio_rango, rating_min, con_whatsapp, destacado)

    try:
        rows, total_row = await pool.fetch(
            _MUNICIPIO_TIENDAS_QUERY, *args, limit, offset
        ), await pool.fetchrow(_MUNICIPIO_TIENDAS_COUNT_QUERY, *args)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    total = total_row[0] if total_row else 0

    tiendas = [
        TiendaOut(
            id=r["id"],
            google_place_id=r["google_place_id"],
            nombre=r["nombre"],
            descripcion=r["descripcion"],
            categoria=r["categoria"],
            barrio_id=r["barrio_id"],
            barrio_nombre=r["barrio_nombre"],
            direccion=r["direccion"],
            telefono=r["telefono"],
            whatsapp=r["whatsapp"],
            website=r["website"],
            foto_url=r["foto_url"],
            lat=r["lat"],
            lon=r["lon"],
            rating_google=r["rating_google"],
            precio_rango=r["precio_rango"],
            horario=r["horario"],
            destacado=r["destacado"],
            verificado=r["verificado"],
        )
        for r in rows
    ]

    return TiendasResponse(barrio_id=None, municipio=municipio.upper(), total=total, tiendas=tiendas)


# ---------------------------------------------------------------------------
# Ticker — mezcla noticias RSS + eventos próximos culturales
# ---------------------------------------------------------------------------

_TICKER_CATEGORIAS = ("musica", "cultura", "gastronomia", "bienestar", "deporte", "social")

_TICKER_NOTICIAS_QUERY = """
SELECT
    'noticia'           AS tipo,
    titulo,
    url                 AS link,
    fecha_publicacion   AS fecha
FROM public.noticias
WHERE activa = TRUE
ORDER BY fecha_publicacion DESC
LIMIT 5
"""

_TICKER_EVENTOS_QUERY = """
SELECT
    'evento'            AS tipo,
    titulo,
    url_externo         AS link,
    fecha_inicio        AS fecha
FROM public.eventos
WHERE activo = TRUE
  AND fecha_inicio > NOW()
  AND categoria = ANY($1::text[])
  AND ($2::int IS NULL OR ciudad_id = $2)
ORDER BY fecha_inicio ASC
LIMIT 8
"""


class TickerItem(BaseModel):
    tipo: str
    titulo: str
    link: Optional[str]
    fecha: Optional[str]


class TickerResponse(BaseModel):
    ciudad_id: Optional[int]
    total: int
    items: list[TickerItem]


@router.get("/ticker", response_model=TickerResponse)
async def get_ticker(
    ciudad_id: Optional[int] = Query(None),
    pool=Depends(get_pool),
):
    try:
        noticias_rows, eventos_rows = await asyncio.gather(
            pool.fetch(_TICKER_NOTICIAS_QUERY),
            pool.fetch(_TICKER_EVENTOS_QUERY, list(_TICKER_CATEGORIAS), ciudad_id),
        )
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    items = [
        TickerItem(
            tipo=r["tipo"],
            titulo=r["titulo"],
            link=r["link"],
            fecha=r["fecha"].isoformat() if r["fecha"] else None,
        )
        for r in (*noticias_rows, *eventos_rows)
    ]

    return TickerResponse(ciudad_id=ciudad_id, total=len(items), items=items)


# ── Noticias ──────────────────────────────────────────────────────────────────

class NoticiaOut(BaseModel):
    id: int
    titulo: str
    url: str
    fuente: Optional[str]
    fecha_publicacion: Optional[str]


class NoticiasResponse(BaseModel):
    total: int
    noticias: list[NoticiaOut]


_NOTICIAS_QUERY = """
SELECT id, titulo, url, fuente, fecha_publicacion
FROM public.noticias n
WHERE n.activa = TRUE
  AND (
    -- Sin tag = city-wide, siempre visible (todavía no hay taggeo por barrio).
    n.barrio_id IS NULL
    -- Comuna de Medellín: todos sus barrios. Gana al barrio_id del representante.
    OR ($4::int IS NOT NULL AND n.barrio_id IN (
        SELECT barrio_id FROM analytics.barrios_cd WHERE cd_comuna = $4
    ))
    OR ($4::int IS NULL AND $2::int IS NOT NULL AND n.barrio_id IN (
        SELECT id FROM raw.barrios b2
        WHERE ST_DWithin(
            b2.geometry,
            (SELECT geometry FROM raw.barrios WHERE id = $2),
            3000
        )
    ))
    OR ($4::int IS NULL AND $2::int IS NULL AND $3::text IS NOT NULL AND n.barrio_id IN (
        SELECT id FROM raw.barrios WHERE municipio = $3
    ))
    OR ($4::int IS NULL AND $2::int IS NULL AND $3::text IS NULL)
  )
ORDER BY fecha_publicacion DESC NULLS LAST
LIMIT $1
"""


@router.get("/noticias", response_model=NoticiasResponse)
async def get_noticias(
    limit: int = Query(4, ge=1, le=20),
    barrio_id: Optional[int] = Query(None),
    municipio: Optional[str] = Query(None),
    cd_comuna: Optional[int] = Query(None),
    pool=Depends(get_pool),
):
    try:
        rows = await pool.fetch(_NOTICIAS_QUERY, limit, barrio_id, municipio, cd_comuna)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    noticias = [
        NoticiaOut(
            id=r["id"],
            titulo=r["titulo"],
            url=r["url"],
            fuente=r["fuente"],
            fecha_publicacion=r["fecha_publicacion"].isoformat() if r["fecha_publicacion"] else None,
        )
        for r in rows
    ]
    return NoticiasResponse(total=len(noticias), noticias=noticias)


# ── POST /eventos — publicación de usuario, queda pendiente de aprobación ──────

class EventoSubmitIn(BaseModel):
    titulo: str
    fecha_inicio: str  # ISO datetime
    fecha_fin: Optional[str] = None
    descripcion: Optional[str] = None
    categoria: Optional[str] = None
    barrio_id: Optional[int] = None
    organizador: Optional[str] = None
    gratuito: bool = True
    precio: float = 0
    url_externo: Optional[str] = None
    foto_url: Optional[str] = None

    _validar_url_externo = field_validator("url_externo")(require_safe_url)
    _validar_foto_url = field_validator("foto_url")(require_safe_url)


class EventoSubmitOut(BaseModel):
    id: int
    estado: str


@router.post("/eventos", response_model=EventoSubmitOut, status_code=201)
async def submit_evento(
    body: EventoSubmitIn = Body(...),
    current_user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Evento subido por un usuario ('interno'). Queda con activo=FALSE hasta que
    admin lo apruebe (admin.py POST /admin/eventos/{id}/aprobar) — mismo filtro
    activo=TRUE que ya usan todas las queries públicas de este archivo, así que
    no aparece en ningún lado hasta la aprobación."""
    try:
        # eventos.fecha_inicio/fecha_fin son TIMESTAMP sin tz — quitar tzinfo o
        # asyncpg revienta con "can't subtract offset-naive and offset-aware".
        fecha_inicio = datetime.fromisoformat(body.fecha_inicio.replace("Z", "+00:00")).replace(tzinfo=None)
        fecha_fin = (
            datetime.fromisoformat(body.fecha_fin.replace("Z", "+00:00")).replace(tzinfo=None)
            if body.fecha_fin else None
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Fecha inválida (ISO 8601)")

    try:
        row = await pool.fetchrow(
            """
            INSERT INTO public.eventos
                (titulo, descripcion, categoria, barrio_id, fecha_inicio, fecha_fin,
                 precio, gratuito, url_externo, foto_url, organizador,
                 fuente, subido_por, activo)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'interno', $12, FALSE)
            RETURNING id
            """,
            body.titulo, body.descripcion, body.categoria, body.barrio_id,
            fecha_inicio, fecha_fin, body.precio, body.gratuito,
            body.url_externo, body.foto_url, body.organizador,
            current_user["id"],
        )
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return EventoSubmitOut(id=row["id"], estado="pendiente")
