"""Contenido self-serve del barrio (fase 1 del blog).

Sin `from __future__ import annotations` a propósito: comunidad.py lo tiene y eso
rompe el body-parsing de FastAPI cuando el endpoint usa @limiter.limit (bug ya
documentado). El submit es abierto (sin login), así que el rate-limit es la única
barrera anti-spam antes de la cola de moderación — no quitarlo.

Aprobación: admin.py POST /admin/posts/{id}/aprobar. GET solo devuelve
estado='aprobado', así que nada aparece hasta que un admin lo revise.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from api.db import get_pool
from api.limiter import limiter
from api.utils.urls import require_safe_url

logger = logging.getLogger(__name__)
router = APIRouter()


class PostSubmitIn(BaseModel):
    autor_nombre: str = Field(min_length=2, max_length=120)
    autor_email: str = Field(min_length=5, max_length=200)
    autor_handle: Optional[str] = Field(default=None, max_length=120)
    titulo: str = Field(min_length=3, max_length=200)
    cuerpo: str = Field(min_length=10, max_length=8000)
    imagen_url: Optional[str] = Field(default=None, max_length=1000)
    enlace_url: Optional[str] = Field(default=None, max_length=1000)
    barrio_id: Optional[int] = None
    municipio: Optional[str] = Field(default=None, max_length=120)
    categoria: Optional[str] = Field(default=None, max_length=60)

    _validar_imagen = field_validator("imagen_url")(require_safe_url)
    _validar_enlace = field_validator("enlace_url")(require_safe_url)


class PostSubmitOut(BaseModel):
    id: int
    estado: str


class PostOut(BaseModel):
    id: int
    autor_nombre: str
    autor_handle: Optional[str]
    titulo: str
    cuerpo: str
    imagen_url: Optional[str]
    enlace_url: Optional[str]
    barrio_id: Optional[int]
    categoria: Optional[str]
    created_at: Optional[str]


class PostsResponse(BaseModel):
    total: int
    posts: list[PostOut]


_LIST_QUERY = """
SELECT id, autor_nombre, autor_handle, titulo, cuerpo, imagen_url, enlace_url,
       barrio_id, categoria, created_at
FROM public.comunidad_post
WHERE estado = 'aprobado'
  AND ($2::int  IS NULL OR barrio_id = $2)
  AND ($3::text IS NULL OR municipio = $3)
ORDER BY created_at DESC NULLS LAST
LIMIT $1
"""


@router.get("", response_model=PostsResponse)
async def list_posts(
    limit: int = Query(12, ge=1, le=50),
    barrio_id: Optional[int] = Query(None),
    municipio: Optional[str] = Query(None),
    pool=Depends(get_pool),
):
    try:
        rows = await pool.fetch(_LIST_QUERY, limit, barrio_id, municipio)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")

    posts = [
        PostOut(
            id=r["id"], autor_nombre=r["autor_nombre"], autor_handle=r["autor_handle"],
            titulo=r["titulo"], cuerpo=r["cuerpo"], imagen_url=r["imagen_url"],
            enlace_url=r["enlace_url"], barrio_id=r["barrio_id"], categoria=r["categoria"],
            created_at=r["created_at"].isoformat() if r["created_at"] else None,
        )
        for r in rows
    ]
    return PostsResponse(total=len(posts), posts=posts)


@router.post("", response_model=PostSubmitOut, status_code=201)
@limiter.limit("5/minute")
async def submit_post(request: Request, body: PostSubmitIn = Body(...), pool=Depends(get_pool)):
    """Post abierto (sin login). Queda estado='pendiente' hasta aprobación admin."""
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO public.comunidad_post
                (autor_nombre, autor_email, autor_handle, titulo, cuerpo,
                 imagen_url, enlace_url, barrio_id, municipio, categoria, estado)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendiente')
            RETURNING id
            """,
            body.autor_nombre, body.autor_email, body.autor_handle, body.titulo,
            body.cuerpo, body.imagen_url, body.enlace_url, body.barrio_id,
            body.municipio, body.categoria,
        )
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
    return PostSubmitOut(id=row["id"], estado="pendiente")
