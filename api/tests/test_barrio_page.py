"""GET /comunidad/barrio-page: embajador + historias destacadas + 2 realtors (no DB)."""
from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import limiter as lim
from api.db import get_pool
from api.routers import barrio_page


class FakePool:
    def __init__(self, emb=None, posts=(), realtors=()):
        self.emb, self.posts, self.realtors = emb, list(posts), list(realtors)
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append(("fetchrow", args))
        return self.emb

    async def fetch(self, sql, *args):
        self.calls.append(("fetch", args))
        return self.posts if "comunidad_post" in sql else self.realtors


def _client(pool):
    app = FastAPI()
    app.state.limiter = lim.limiter
    app.include_router(barrio_page.router, prefix="/api/v1/comunidad/barrio-page")
    app.dependency_overrides[get_pool] = lambda: pool
    return TestClient(app)


def test_requiere_comuna_o_municipio():
    r = _client(FakePool()).get("/api/v1/comunidad/barrio-page?slug=el-poblado")
    assert r.status_code == 422


def test_zona_vacia_devuelve_listas_vacias():
    r = _client(FakePool()).get("/api/v1/comunidad/barrio-page?slug=el-poblado&cd_comuna=14")
    assert r.status_code == 200
    assert r.json() == {"embajador": None, "historias": [], "realtors": []}


def test_arma_la_pagina_y_usa_tag_featured_del_slug():
    pool = FakePool(
        emb={"nombre": "Vale", "foto_url": None, "bio": "Local", "video_url": None, "post_id": 7},
        posts=[{"id": 7, "titulo": "Guía", "cuerpo": "Texto largo", "imagen_url": None, "enlace_url": None,
                "autor_nombre": "Vale", "created_at": datetime(2026, 10, 20), "destacado": True}],
        realtors=[{"id": "a1", "nombre": "Ana", "foto_url": None, "bio": None, "agencia_nombre": "Casa",
                   "rating_promedio": 4.8, "n_resenas": 12}],
    )
    r = _client(pool).get("/api/v1/comunidad/barrio-page?slug=El-Poblado&cd_comuna=14")
    body = r.json()
    assert r.status_code == 200
    assert body["embajador"]["nombre"] == "Vale"
    assert body["historias"][0]["destacado"] is True
    assert body["historias"][0]["created_at"].startswith("2026-10-20")
    assert body["realtors"][0]["n_resenas"] == 12
    posts_call = [c for c in pool.calls if c[0] == "fetch"][0]
    assert posts_call[1] == (14, None, "featured-el-poblado")


def test_municipio_pasa_por_nombre():
    pool = FakePool()
    _client(pool).get("/api/v1/comunidad/barrio-page?slug=envigado&municipio=ENVIGADO")
    assert all(c[1][:2] == (None, "ENVIGADO") for c in pool.calls)
