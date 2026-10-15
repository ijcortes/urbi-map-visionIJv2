import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, field_validator

from api.db import get_pool
from api.dependencies import get_current_user
from api.limiter import limiter
from api.utils.urls import require_plain_text, require_safe_url

logger = logging.getLogger(__name__)
router = APIRouter()


def _sanitize_foto(url: Optional[str]) -> Optional[str]:
    """Return None for googleapis URLs — images not yet migrated to CDN."""
    if url and "googleapis.com" in url:
        return None
    return url


# ── Planes ────────────────────────────────────────────────────────────────────

class PlanOut(BaseModel):
    id: int
    nombre: str
    tipo: str
    precio_usd: Optional[float]
    precio_cop: Optional[float]
    descripcion: Optional[str]
    features: Any


@router.get("/planes", response_model=list[PlanOut])
async def get_planes(pool=Depends(get_pool)):
    try:
        rows = await pool.fetch(
            "SELECT id, nombre, tipo, precio_usd, precio_cop, descripcion, features "
            "FROM public.planes_negocio WHERE activo = TRUE ORDER BY precio_usd ASC"
        )
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return [
        PlanOut(
            id=r["id"], nombre=r["nombre"], tipo=r["tipo"],
            precio_usd=float(r["precio_usd"]) if r["precio_usd"] is not None else None,
            precio_cop=float(r["precio_cop"]) if r["precio_cop"] is not None else None,
            descripcion=r["descripcion"], features=r["features"],
        )
        for r in rows
    ]


# ── Aplicar (lead form) ───────────────────────────────────────────────────────

class AplicarIn(BaseModel):
    nombre_negocio: str
    email: str
    telefono: Optional[str] = None
    categoria: Optional[str] = None
    barrio_id: Optional[int] = None
    plan_tipo: Optional[str] = None
    mensaje: Optional[str] = None


class AplicarOut(BaseModel):
    ok: bool
    lead_id: int
    mensaje: str


@router.post("/aplicar", response_model=AplicarOut)
@limiter.limit("5/minute")
async def aplicar_negocio(request: Request, body: AplicarIn = Body(...), pool=Depends(get_pool)):
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO public.leads_negocio
                (nombre_negocio, email, telefono, categoria, barrio_id, plan_tipo, mensaje)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
            """,
            body.nombre_negocio, body.email, body.telefono,
            body.categoria, body.barrio_id, body.plan_tipo, body.mensaje,
        )
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return AplicarOut(
        ok=True,
        lead_id=row["id"],
        mensaje="Gracias por tu interés. Te contactaremos en las próximas 24 horas.",
    )


# ── Deals ─────────────────────────────────────────────────────────────────────

class DealOut(BaseModel):
    id: int
    tipo_deal: str
    descripcion: str
    categoria: Optional[str]
    tienda_nombre: str
    foto_url: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    barrio_nombre: Optional[str]


class DealsResponse(BaseModel):
    ciudad_id: int
    total: int
    deals: list[DealOut]


_DEALS_QUERY = """
SELECT
    d.id,
    d.tipo_deal,
    d.descripcion,
    d.categoria,
    t.nombre   AS tienda_nombre,
    COALESCE(d.foto_url, t.foto_url) AS foto_url,
    t.lat,
    t.lon,
    b.nombre   AS barrio_nombre
FROM public.deals d
JOIN public.tiendas t ON d.tienda_id = t.id
LEFT JOIN raw.barrios b ON COALESCE(d.barrio_id, t.barrio_id) = b.id
WHERE d.activo    = TRUE
  AND d.destacado = TRUE
  AND (d.fecha_fin IS NULL OR d.fecha_fin >= CURRENT_DATE)
  AND (
    -- Comuna de Medellín: todos sus barrios (analytics.barrios_cd). Gana al barrio_id
    -- del representante (el home manda el rep de la comuna, que es 1 solo barrio).
    ($4::int IS NOT NULL AND COALESCE(d.barrio_id, t.barrio_id) IN (
        SELECT barrio_id FROM analytics.barrios_cd WHERE cd_comuna = $4
    ))
    OR ($4::int IS NULL AND $2::int IS NOT NULL AND COALESCE(d.barrio_id, t.barrio_id) IN (
        SELECT id FROM raw.barrios b2
        WHERE ST_DWithin(
            b2.geometry,
            (SELECT geometry FROM raw.barrios WHERE id = $2),
            3000
        )
    ))
    OR ($4::int IS NULL AND $2::int IS NULL AND $3::text IS NOT NULL AND COALESCE(d.barrio_id, t.barrio_id) IN (
        SELECT id FROM raw.barrios WHERE municipio = $3
    ))
    OR ($4::int IS NULL AND $2::int IS NULL AND $3::text IS NULL AND d.ciudad_id = $1)
  )
ORDER BY d.created_at DESC
LIMIT 4
"""


@router.get("/deals", response_model=DealsResponse)
async def get_deals(
    ciudad_id: int = Query(1),
    barrio_id: Optional[int] = Query(None),
    municipio: Optional[str] = Query(None),
    cd_comuna: Optional[int] = Query(None),
    pool=Depends(get_pool),
):
    try:
        rows = await pool.fetch(_DEALS_QUERY, ciudad_id, barrio_id, municipio, cd_comuna)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    deals = [
        DealOut(
            id=r["id"], tipo_deal=r["tipo_deal"], descripcion=r["descripcion"],
            categoria=r["categoria"], tienda_nombre=r["tienda_nombre"],
            foto_url=_sanitize_foto(r["foto_url"]), lat=r["lat"], lon=r["lon"],
            barrio_nombre=r["barrio_nombre"],
        )
        for r in rows
    ]
    return DealsResponse(ciudad_id=ciudad_id, total=len(deals), deals=deals)


# ── Hotspots ──────────────────────────────────────────────────────────────────

class HotspotOut(BaseModel):
    id: int
    categoria_experiencia: str
    descripcion: str
    tienda_nombre: str
    foto_url: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    barrio_nombre: Optional[str]


class HotspotsResponse(BaseModel):
    ciudad_id: int
    total: int
    hotspots: list[HotspotOut]


_HOTSPOTS_QUERY = """
SELECT
    h.id,
    h.categoria_experiencia,
    h.descripcion,
    t.nombre   AS tienda_nombre,
    COALESCE(h.foto_url, t.foto_url) AS foto_url,
    t.lat,
    t.lon,
    b.nombre   AS barrio_nombre
FROM public.hotspots h
JOIN public.tiendas t ON h.tienda_id = t.id
LEFT JOIN raw.barrios b ON COALESCE(h.barrio_id, t.barrio_id) = b.id
WHERE h.activo    = TRUE
  AND h.destacado = TRUE
  AND (h.fecha_fin IS NULL OR h.fecha_fin >= CURRENT_DATE)
  AND (
    ($4::int IS NOT NULL AND COALESCE(h.barrio_id, t.barrio_id) IN (
        SELECT barrio_id FROM analytics.barrios_cd WHERE cd_comuna = $4
    ))
    OR ($4::int IS NULL AND $2::int IS NOT NULL AND COALESCE(h.barrio_id, t.barrio_id) IN (
        SELECT id FROM raw.barrios b2
        WHERE ST_DWithin(
            b2.geometry,
            (SELECT geometry FROM raw.barrios WHERE id = $2),
            3000
        )
    ))
    OR ($4::int IS NULL AND $2::int IS NULL AND $3::text IS NOT NULL AND COALESCE(h.barrio_id, t.barrio_id) IN (
        SELECT id FROM raw.barrios WHERE municipio = $3
    ))
    OR ($4::int IS NULL AND $2::int IS NULL AND $3::text IS NULL AND h.ciudad_id = $1)
  )
ORDER BY h.created_at DESC
LIMIT 4
"""


@router.get("/hotspots", response_model=HotspotsResponse)
async def get_hotspots(
    ciudad_id: int = Query(1),
    barrio_id: Optional[int] = Query(None),
    municipio: Optional[str] = Query(None),
    cd_comuna: Optional[int] = Query(None),
    pool=Depends(get_pool),
):
    try:
        rows = await pool.fetch(_HOTSPOTS_QUERY, ciudad_id, barrio_id, municipio, cd_comuna)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    hotspots = [
        HotspotOut(
            id=r["id"], categoria_experiencia=r["categoria_experiencia"],
            descripcion=r["descripcion"], tienda_nombre=r["tienda_nombre"],
            foto_url=_sanitize_foto(r["foto_url"]), lat=r["lat"], lon=r["lon"],
            barrio_nombre=r["barrio_nombre"],
        )
        for r in rows
    ]
    return HotspotsResponse(ciudad_id=ciudad_id, total=len(hotspots), hotspots=hotspots)


# ── Directorio Featured ───────────────────────────────────────────────────────

class DirectorioOut(BaseModel):
    id: int
    nombre: str
    categoria: str
    rating_google: Optional[float]
    google_place_id: Optional[str]
    foto_url: Optional[str]
    direccion: Optional[str]
    whatsapp: Optional[str]
    website: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    barrio_nombre: Optional[str]


class DirectorioResponse(BaseModel):
    ciudad_id: int
    total: int
    negocios: list[DirectorioOut]


_DIRECTORIO_CATEGORIAS = [
    "brunch", "cena", "gimnasios", "masajes_spa", "medicos",
    "cafes", "bares", "yoga", "dentistas", "peluquerias",
]

_DIRECTORIO_QUERY = """
WITH ranked AS (
    SELECT
        t.id, t.nombre, t.categoria, t.rating_google,
        t.google_place_id,
        t.foto_url, t.direccion, t.whatsapp, t.website,
        t.lat, t.lon,
        b.nombre AS barrio_nombre,
        ROW_NUMBER() OVER (
            PARTITION BY t.categoria
            ORDER BY t.rating_google DESC, t.nombre ASC
        ) AS rn
    FROM public.tiendas t
    LEFT JOIN raw.barrios b ON t.barrio_id = b.id
    WHERE t.activo        = TRUE
      AND t.rating_google >= 4.8
      AND t.categoria     = ANY($3::text[])
      AND (
        ($5::int IS NOT NULL AND t.barrio_id IN (
            SELECT barrio_id FROM analytics.barrios_cd WHERE cd_comuna = $5
        ))
        OR ($5::int IS NULL AND $2::int IS NOT NULL AND t.barrio_id IN (
            SELECT id FROM raw.barrios b2
            WHERE ST_DWithin(
                b2.geometry,
                (SELECT geometry FROM raw.barrios WHERE id = $2),
                3000
            )
        ))
        OR ($5::int IS NULL AND $2::int IS NULL AND $4::text IS NOT NULL AND t.barrio_id IN (
            SELECT id FROM raw.barrios WHERE municipio = $4
        ))
        OR ($5::int IS NULL AND $2::int IS NULL AND $4::text IS NULL AND t.ciudad_id = $1)
      )
)
SELECT * FROM ranked WHERE rn = 1 ORDER BY rating_google DESC LIMIT 4
"""


@router.get("/directorio", response_model=DirectorioResponse)
async def get_directorio(
    ciudad_id: int = Query(1),
    barrio_id: Optional[int] = Query(None),
    municipio: Optional[str] = Query(None),
    cd_comuna: Optional[int] = Query(None),
    pool=Depends(get_pool),
):
    try:
        rows = await pool.fetch(_DIRECTORIO_QUERY, ciudad_id, barrio_id, _DIRECTORIO_CATEGORIAS, municipio, cd_comuna)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    negocios = [
        DirectorioOut(
            id=r["id"], nombre=r["nombre"], categoria=r["categoria"],
            rating_google=r["rating_google"], google_place_id=r["google_place_id"],
            foto_url=_sanitize_foto(r["foto_url"]), direccion=r["direccion"],
            whatsapp=r["whatsapp"], website=r["website"],
            lat=r["lat"], lon=r["lon"], barrio_nombre=r["barrio_nombre"],
        )
        for r in rows
    ]
    return DirectorioResponse(ciudad_id=ciudad_id, total=len(negocios), negocios=negocios)


# ── POST /mi-negocio — publicación de usuario, queda pendiente de aprobación ───

class MiNegocioIn(BaseModel):
    nombre: str
    categoria: str
    barrio_id: Optional[int] = None
    descripcion: Optional[str] = None
    direccion: Optional[str] = None
    telefono: Optional[str] = None
    whatsapp: Optional[str] = None
    instagram: Optional[str] = None
    website: Optional[str] = None
    foto_url: Optional[str] = None

    _validar_website = field_validator("website")(require_safe_url)
    _validar_foto_url = field_validator("foto_url")(require_safe_url)
    # Stored XSS defense: these end up in a public map popup / directory.
    _v_nombre = field_validator("nombre")(require_plain_text(120))
    _v_categoria = field_validator("categoria")(require_plain_text(60))
    _v_descripcion = field_validator("descripcion")(require_plain_text(2000))
    _v_direccion = field_validator("direccion")(require_plain_text(200))
    _v_telefono = field_validator("telefono")(require_plain_text(30))
    _v_whatsapp = field_validator("whatsapp")(require_plain_text(30))
    _v_instagram = field_validator("instagram")(require_plain_text(100))


class MiNegocioOut(BaseModel):
    id: int
    estado: str


@router.post("/mi-negocio", response_model=MiNegocioOut, status_code=201)
async def submit_negocio(
    body: MiNegocioIn = Body(...),
    current_user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Negocio subido por su dueño. Queda con activo=FALSE hasta que admin lo
    apruebe (admin.py POST /admin/tiendas/{id}/aprobar) — el directorio público
    y todas las queries de comunidad.py ya filtran activo=TRUE."""
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO public.tiendas
                (nombre, categoria, barrio_id, descripcion, direccion,
                 telefono, whatsapp, instagram, website, foto_url,
                 subido_por, activo, verificado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE, FALSE)
            RETURNING id
            """,
            body.nombre, body.categoria, body.barrio_id, body.descripcion, body.direccion,
            body.telefono, body.whatsapp, body.instagram, body.website, body.foto_url,
            current_user["id"],
        )
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return MiNegocioOut(id=row["id"], estado="pendiente")
