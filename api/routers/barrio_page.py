"""Página de barrio (Ken, call 23-oct): todo lo "destacado" de UNA comuna en una llamada.

Orden de la página: embajador + artículo clave + historias → eventos → 2 realtors
destacados + listings → negocios 5★ con oferta → lo último del barrio. Eventos,
listings y negocios ya tienen endpoints propios; acá va solo lo que no existía:
embajador, artículos destacados (tag featured-<slug>) y los 2 realtors que pagan
la zona (sponsorship activa de la comuna o municipio).

Zona: cd_comuna para comunas de Medellín, municipio para el resto del Valle —
mismo criterio que el resto de /comunidad.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from api.db import get_pool
from api.limiter import limiter
from api.routers.admin import _audit, require_admin
from api.utils.urls import require_safe_url

logger = logging.getLogger(__name__)
router = APIRouter()


class EmbajadorOut(BaseModel):
    nombre: str
    foto_url: Optional[str]
    bio: Optional[str]
    video_url: Optional[str]
    post_id: Optional[int]


class PostCard(BaseModel):
    id: int
    titulo: str
    cuerpo: str
    imagen_url: Optional[str]
    enlace_url: Optional[str]
    autor_nombre: str
    created_at: Optional[str]
    destacado: bool


class RealtorCard(BaseModel):
    id: str
    nombre: str
    foto_url: Optional[str]
    bio: Optional[str]
    agencia_nombre: Optional[str]
    rating_promedio: Optional[float]
    n_resenas: int


class BarrioPageOut(BaseModel):
    embajador: Optional[EmbajadorOut]
    historias: list[PostCard]
    realtors: list[RealtorCard]


# Comuna → barrios vía analytics.barrios_cd; municipio del Valle → raw.barrios.municipio.
_ZONA_BARRIOS = """
    (($1::int IS NOT NULL AND p.barrio_id IN (SELECT barrio_id FROM analytics.barrios_cd WHERE cd_comuna = $1))
     OR ($2::text IS NOT NULL AND (upper(p.municipio) = upper($2)
         OR p.barrio_id IN (SELECT id FROM raw.barrios WHERE upper(municipio) = upper($2)))))
"""

_EMBAJADOR_SQL = """
SELECT nombre, foto_url, bio, video_url, post_id
FROM public.embajador_perfil
WHERE activo AND (($1::int IS NOT NULL AND cd_comuna = $1)
               OR ($2::text IS NOT NULL AND upper(municipio) = upper($2)))
ORDER BY created_at DESC
LIMIT 1
"""

# Destacados primero (tag featured-<slug>), luego lo más reciente de la zona.
_HISTORIAS_SQL = f"""
SELECT p.id, p.titulo, p.cuerpo, p.imagen_url, p.enlace_url, p.autor_nombre, p.created_at,
       ($3::text = ANY(p.tags)) AS destacado
FROM public.comunidad_post p
WHERE p.estado = 'aprobado' AND ({_ZONA_BARRIOS} OR $3::text = ANY(p.tags))
ORDER BY ($3::text = ANY(p.tags)) DESC, p.created_at DESC NULLS LAST
LIMIT 8
"""

# Los 2 realtors que pagan la zona: un agente activo por agencia con sponsorship vigente.
_REALTORS_SQL = """
SELECT DISTINCT ON (s.agency_id)
       a.id::text, a.nombre, a.foto_url, a.bio, ag.nombre AS agencia_nombre,
       rev.rating_promedio, COALESCE(rev.n_resenas, 0) AS n_resenas
FROM sponsorship s
JOIN agency ag ON ag.id = s.agency_id
JOIN agency_member am ON am.agency_id = s.agency_id
JOIN agent a ON a.id = am.agent_id AND a.estado = 'activo'
LEFT JOIN (
    SELECT agent_id, ROUND(AVG(calificacion)::numeric, 1)::float8 AS rating_promedio,
           COUNT(*)::int AS n_resenas
    FROM agent_review GROUP BY agent_id
) rev ON rev.agent_id = a.id
WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
  AND (($1::int IS NOT NULL AND s.zona_nivel = 'comuna' AND s.zona_codigo = $1::text)
    OR ($2::text IS NOT NULL AND s.zona_nivel = 'municipio' AND upper(s.zona_codigo) = upper($2)))
ORDER BY s.agency_id, s.fecha_inicio, a.created_at
LIMIT 2
"""


@router.get("", response_model=BarrioPageOut)
@limiter.limit("60/minute")
async def get_barrio_page(
    request: Request,
    slug: str = Query(..., min_length=1, max_length=120),
    cd_comuna: Optional[int] = Query(None),
    municipio: Optional[str] = Query(None, max_length=120),
    pool=Depends(get_pool),
):
    if cd_comuna is None and not municipio:
        raise HTTPException(status_code=422, detail="cd_comuna o municipio requerido")
    tag = f"featured-{slug.lower()}"
    try:
        emb = await pool.fetchrow(_EMBAJADOR_SQL, cd_comuna, municipio)
        posts = await pool.fetch(_HISTORIAS_SQL, cd_comuna, municipio, tag)
        realtors = await pool.fetch(_REALTORS_SQL, cd_comuna, municipio)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    return BarrioPageOut(
        embajador=EmbajadorOut(**dict(emb)) if emb else None,
        historias=[
            PostCard(
                id=r["id"], titulo=r["titulo"], cuerpo=r["cuerpo"], imagen_url=r["imagen_url"],
                enlace_url=r["enlace_url"], autor_nombre=r["autor_nombre"], destacado=r["destacado"],
                created_at=r["created_at"].isoformat() if r["created_at"] else None,
            )
            for r in posts
        ],
        realtors=[RealtorCard(**dict(r)) for r in realtors],
    )


# ── Admin: marcar destacado y cargar embajador ─────────────────────────────

class TagsIn(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=20)


@router.put("/admin/posts/{post_id}/tags")
@limiter.limit("30/minute")
async def set_post_tags(request: Request, post_id: int, body: TagsIn = Body(...),
                        admin: dict = Depends(require_admin), pool=Depends(get_pool)):
    tags = sorted({t.strip().lower() for t in body.tags if t.strip()})
    r = await pool.execute("UPDATE public.comunidad_post SET tags = $2 WHERE id = $1", post_id, tags)
    if r.endswith(" 0"):
        raise HTTPException(status_code=404, detail="Post no encontrado")
    await _audit(pool, admin, "post_tags", "comunidad_post", str(post_id), {"tags": tags}, request)
    return {"ok": True, "tags": tags}


class EmbajadorIn(BaseModel):
    cd_comuna: Optional[int] = None
    municipio: Optional[str] = Field(default=None, max_length=120)
    nombre: str = Field(min_length=2, max_length=120)
    foto_url: Optional[str] = Field(default=None, max_length=1000)
    bio: Optional[str] = Field(default=None, max_length=2000)
    video_url: Optional[str] = Field(default=None, max_length=1000)
    post_id: Optional[int] = None

    _validar_foto = field_validator("foto_url")(require_safe_url)
    _validar_video = field_validator("video_url")(require_safe_url)


@router.post("/admin/embajador", status_code=201)
@limiter.limit("30/minute")
async def set_embajador(request: Request, body: EmbajadorIn = Body(...),
                        admin: dict = Depends(require_admin), pool=Depends(get_pool)):
    """Nuevo embajador de la zona; el anterior queda inactivo (uno activo por zona)."""
    if body.cd_comuna is None and not body.municipio:
        raise HTTPException(status_code=422, detail="cd_comuna o municipio requerido")
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """UPDATE public.embajador_perfil SET activo = FALSE
               WHERE activo AND (($1::int IS NOT NULL AND cd_comuna = $1)
                              OR ($2::text IS NOT NULL AND upper(municipio) = upper($2)))""",
            body.cd_comuna, body.municipio,
        )
        eid = await conn.fetchval(
            """INSERT INTO public.embajador_perfil
                   (cd_comuna, municipio, nombre, foto_url, bio, video_url, post_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id""",
            body.cd_comuna, body.municipio, body.nombre, body.foto_url, body.bio,
            body.video_url, body.post_id,
        )
    await _audit(pool, admin, "set_embajador", "embajador_perfil", str(eid), body.model_dump(), request)
    return {"ok": True, "id": eid}
