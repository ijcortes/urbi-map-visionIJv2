"""Barrio aliases endpoints (fallback path, no DB) + data-migration sanity checks."""
import importlib.util
import json
import pathlib
import re

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app
from api.routers import barrios as B

ROOT = pathlib.Path(__file__).resolve().parents[2]


class DeadPool:
    async def fetch(self, *a, **k):
        raise RuntimeError("no db")


@pytest.fixture
def dead_db(monkeypatch):
    monkeypatch.setattr(B, "get_pool", lambda: DeadPool())


async def _get(path, **params):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        return await ac.get(path, params=params)


async def test_aliases_fallback_has_ciudad_del_rio_and_provenza(dead_db):
    r = await _get("/api/v1/barrios/aliases")
    assert r.status_code == 200
    by = {a["alias_norm"]: a for a in r.json()}
    assert by["ciudad del rio"]["cd_comuna"] == 14 and by["ciudad del rio"]["barrio_id"] == 226
    assert by["provenza"]["cd_comuna"] == 14 and by["provenza"]["asumido"] is True


async def test_buscar_is_accent_insensitive(dead_db):
    r = await _get("/api/v1/barrios/buscar", q="Ciudad del Río")
    assert [a["alias"] for a in r.json()] == ["Ciudad del Río"]
    r = await _get("/api/v1/barrios/buscar", q="prove")
    assert r.json()[0]["alias"] == "Provenza"


def _load(name):
    f = next((ROOT / "alembic" / "versions").glob(f"{name}_*.py"))
    spec = importlib.util.spec_from_file_location(name, f)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_chain_and_barrio_fix_matches_geojson():
    m4, m5, m6 = _load("0104"), _load("0105"), _load("0106")
    assert (m4.down_revision, m5.down_revision, m6.down_revision) == ("0103", "0104", "0105")
    gj = json.loads((ROOT / "public/data/barrios_medellin.geojson").read_text())
    cd = {f["properties"]["id"]: f["properties"]["cd_comuna"] for f in gj["features"]}
    assert dict(m4._NEW) == {i: cd[i] for i, _ in m4._NEW}   # frontend data is the reference
    assert set(dict(m4._NEW)) == {11, 42, 61, 63, 64, 183}
    assert dict(m4._OLD) != dict(m4._NEW)                     # downgrade restores the old values


def test_only_one_alembic_head():
    revs, downs = set(), set()
    for f in (ROOT / "alembic" / "versions").glob("*.py"):
        t = f.read_text()
        r = re.search(r'^revision\s*=\s*"([^"]+)"', t, re.M)
        d = re.search(r'^down_revision\s*=\s*"([^"]+)"', t, re.M)
        if r:
            revs.add(r.group(1))
        if d:
            downs.add(d.group(1))
    assert len(revs - downs) == 1, revs - downs


def test_scraper_normalises_studio():
    pytest.importorskip("requests")
    from scraping.metrocuadrado.scraper import normalize_tipo_inmueble
    assert normalize_tipo_inmueble("apartaestudio") == ("apartamento", True)
    assert normalize_tipo_inmueble("casa") == ("casa", False)
