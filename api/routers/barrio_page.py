"""Página de barrio (Ken, call 23-oct): todo lo "destacado" de UNA comuna en una llamada.

Orden de la página: embajador + artículo clave + historias → eventos → 2 realtors
destacados + listings → negocios 5★ con oferta → lo último del barrio. Eventos,
listings y negocios ya tienen endpoints propios; acá va solo lo que no existía:
embajador, historias (destacadas primero) y los 2 realtors que pagan la zona.

Zona = código de comuna: cd_comuna real (Medellín) o el pseudo-código 101-109 del
municipio — el mismo esquema que destacados (admin.py) y sponsorships.
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from api.db import get_pool
from api.limiter import limiter
from api.routers.admin import _MUNICIPIO_A_PSEUDO_COMUNA
from api.routers.comunidad import _zona_comuna_de

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
    created_at: Optional[datetime]
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


# $1 = código de zona (cd_comuna o pseudo-comuna del municipio).
_EMBAJADOR_SQL = f"""
SELECT u.nombre, e.foto_url, e.bio, e.video_url, e.post_id
FROM public.embajadores e
JOIN public.usuarios u ON u.id = e.usuario_id
WHERE e.activo AND e.verificado AND {_zona_comuna_de("e.barrio_id")} = $1
ORDER BY e.created_at DESC
LIMIT 1
"""

# Destacado con el mismo alcance que eventos/tiendas (ciudad, o esta comuna).
_POST_DESTACADO = """(p.destacado AND (p.destacado_nivel IS NULL OR p.destacado_nivel = 'ciudad'
    OR (p.destacado_nivel = 'comuna' AND p.destacado_zona_codigo = $1)))"""

_HISTORIAS_SQL = f"""
SELECT p.id, p.titulo, p.cuerpo, p.imagen_url, p.enlace_url, p.autor_nombre, p.created_at,
       {_POST_DESTACADO} AS destacado
FROM public.comunidad_post p
WHERE p.estado = 'aprobado'
  AND ({_POST_DESTACADO} OR {_zona_comuna_de("p.barrio_id")} = $1
       OR ($2::text IS NOT NULL AND upper(p.municipio) = $2))
ORDER BY destacado DESC, p.created_at DESC NULLS LAST
LIMIT 8
"""

# Los 2 realtors que pagan la zona: un agente activo por agencia con sponsorship vigente.
_REALTORS_SQL = """
SELECT DISTINCT ON (s.agency_id)
       a.id::text, a.nombre, a.foto_url, a.bio, ag.nombre AS agencia_nombre,
       rev.rating_promedio, rev.n_resenas
FROM sponsorship s
JOIN agency ag ON ag.id = s.agency_id
JOIN agency_member am ON am.agency_id = s.agency_id
JOIN agent a ON a.id = am.agent_id AND a.estado = 'activo'
LEFT JOIN LATERAL (
    SELECT ROUND(AVG(calificacion)::numeric, 1)::float8 AS rating_promedio, COUNT(*)::int AS n_resenas
    FROM agent_review WHERE agent_id = a.id
) rev ON true
WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
  AND s.zona_nivel = 'comuna' AND s.zona_codigo = $1
ORDER BY s.agency_id, s.fecha_inicio, a.created_at
LIMIT 2
"""


@router.get("", response_model=BarrioPageOut)
@limiter.limit("60/minute")
async def get_barrio_page(
    request: Request,
    cd_comuna: Optional[int] = Query(None),
    municipio: Optional[str] = Query(None, max_length=120),
    pool=Depends(get_pool),
):
    muni = municipio.upper() if municipio else None
    zona = str(cd_comuna) if cd_comuna is not None else _MUNICIPIO_A_PSEUDO_COMUNA.get(muni or "")
    if zona is None:
        raise HTTPException(status_code=422, detail="cd_comuna o municipio del Valle requerido")
    try:
        emb, posts, realtors = await asyncio.gather(
            pool.fetchrow(_EMBAJADOR_SQL, zona),
            pool.fetch(_HISTORIAS_SQL, zona, muni),
            pool.fetch(_REALTORS_SQL, zona),
        )
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    return BarrioPageOut(
        embajador=EmbajadorOut(**dict(emb)) if emb else None,
        historias=[PostCard(**dict(r)) for r in posts],
        realtors=[RealtorCard(**dict(r)) for r in realtors],
    )
