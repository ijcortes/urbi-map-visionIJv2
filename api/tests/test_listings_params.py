"""Unit tests (no DB) for the listings API contract: segmento, ocultar_destacados,
moneda/USD, apartaestudio normalisation, zoom tiers, bbox/zone independence, url."""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from api.main import app
from api.limiter import limiter
from api.routers import listings as L
from api.services import trm_service

RATE = 4000.0


class FakePool:
    def __init__(self, rows=None, count=0):
        self.rows = rows or []
        self.count = count
        self.calls = []  # (sql, args)

    async def fetch(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self.rows

    async def fetchval(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self.count

    async def fetchrow(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self.rows[0] if self.rows else None


def _row(**kw):
    base = dict(id=1, fuente="metrocuadrado", fuente_display="metrocuadrado", tier="standard",
                tipo_operacion="arriendo", tipo_inmueble="apartamento", precio_cop=2_000_000,
                precio_usd=None, area_m2=40.0, habitaciones=1, banos=1.0, lat=6.2, lon=-75.5,
                url="https://www.metrocuadrado.com/inmueble/x", barrio_id=1, foto_principal=None,
                direccion_raw=None, barrio_nombre="X", municipio="MEDELLIN", estrato_real=4)
    base.update(kw)
    return base


@pytest_asyncio.fixture
async def api(monkeypatch):
    pool = FakePool()
    monkeypatch.setattr(L, "get_pool", lambda: pool)

    async def _rate():
        return RATE
    monkeypatch.setattr(L, "get_usd_rate", _rate)
    limiter.enabled = False
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield ac, pool
    limiter.enabled = True


# ── pure helpers ─────────────────────────────────────────────────────────────
def test_effective_segmento_defaults():
    assert L._effective_segmento(None, "arriendo", None) == "residencial"
    assert L._effective_segmento(None, "venta", None) == "residencial"
    assert L._effective_segmento(None, None, None) is None
    assert L._effective_segmento(None, "arriendo", ["local"]) is None   # explicit types win
    assert L._effective_segmento("comercial", "arriendo", None) == "comercial"
    assert L._effective_segmento("todos", "arriendo", None) is None


def test_norm_tipos_maps_apartaestudio():
    assert L._norm_tipos(["Apartaestudio", "apartamento", "Casa"]) == ["apartamento", "casa"]
    assert L._norm_tipos([]) is None and L._norm_tipos(None) is None


def test_finalize_row_rules():
    d = L._finalize_row(_row(tipo_inmueble="apartaestudio", habitaciones=2, precio_cop=2_500_000), RATE)
    assert d["tipo_inmueble"] == "apartamento" and d["habitaciones"] == 0
    assert d["precio_usd"] == 625
    # rounding, not int() truncation: 2_000_001/4000 = 500.00025 -> 500 ; 2_002_000/4000=500.5 -> 500 (banker) / 501
    assert L._finalize_row(_row(precio_cop=1_999_999), RATE)["precio_usd"] == 500
    assert L._finalize_row(_row(precio_cop=1_999_000), 4100.0)["precio_usd"] == 488  # 487.56
    assert L._finalize_row(_row(fuente="propio", url="123"), RATE)["url"] is None
    assert L._finalize_row(_row(url=""), RATE)["url"] is None
    assert L._finalize_row(_row(), RATE)["url"].startswith("https://")


def test_comercial_regex_matches_expected():
    import re
    rx = re.compile(L._COMERCIAL_RE)
    for t in ("local", "oficina", "bodega", "lote", "finca", "local comercial"):
        assert rx.match(t)
    for t in ("apartamento", "casa", "", "habitacion"):
        assert not rx.match(t)


def test_sql_floor_keeps_cheap_rentals():
    for sql in (L._LISTINGS_SQL, L._COUNT_SQL, L._VIEWPORT_POINTS_SQL, L._VIEWPORT_CLUSTERS_SQL):
        assert "precio_cop >= 150000" in sql and "'arriendo'" in sql
    assert "usd" not in L._LISTINGS_SQL.lower().replace("precio_usd", "")  # no baked-in rate


def test_zoom_thresholds_and_cell():
    assert L._VIEWPORT_CLUSTER_MAX_ZOOM == 10
    assert L._thin_cell_deg(10) == pytest.approx(2 * L._thin_cell_deg(11))
    assert L._thin_cell_deg(12) < 0.01


# ── /listings ────────────────────────────────────────────────────────────────
async def test_listings_default_segmento_and_args(api):
    ac, pool = api
    pool.rows = [_row(tipo_inmueble="apartaestudio", habitaciones=3)]
    r = await ac.get("/api/v1/listings", params={"tipo_operacion": "arriendo"})
    assert r.status_code == 200, r.text
    args = pool.calls[-1][1]
    assert args[15] == "residencial" and args[16] is False
    item = r.json()["listings"][0]
    assert item["tipo_inmueble"] == "apartamento" and item["habitaciones"] == 0
    assert item["precio_usd"] == 500


async def test_listings_segmento_comercial_and_ocultar(api):
    ac, pool = api
    await ac.get("/api/v1/listings", params={"tipo_operacion": "venta", "segmento": "comercial",
                                             "ocultar_destacados": "true"})
    args = pool.calls[-1][1]
    assert args[15] == "comercial" and args[16] is True
    # ocultar_destacados disables the "toda la ciudad" fast path
    assert all("LIMIT 700" not in c[0] for c in pool.calls)


async def test_listings_explicit_tipo_skips_default_segmento(api):
    ac, pool = api
    await ac.get("/api/v1/listings", params={"tipo_operacion": "arriendo", "tipo_inmueble": ["Local", "apartaestudio"]})
    args = pool.calls[-1][1]
    assert args[3] == ["local", "apartamento"] and args[15] is None


async def test_listings_invalid_segmento_422(api):
    ac, _ = api
    r = await ac.get("/api/v1/listings", params={"segmento": "otro"})
    assert r.status_code == 422


async def test_listings_usd_filter_converted_with_shared_rate(api):
    ac, pool = api
    await ac.get("/api/v1/listings", params={"moneda": "USD", "precio_min": 500, "precio_max": 2500})
    args = pool.calls[-1][1]
    assert args[4] == 500 * 4000 and args[5] == 2500 * 4000
    await ac.get("/api/v1/listings", params={"precio_min": 500})   # default COP untouched
    assert pool.calls[-1][1][4] == 500


async def test_listings_url_null_for_propio(api):
    ac, pool = api
    pool.rows = [_row(fuente="propio", fuente_display="propio", url="42"), _row(id=2)]
    items = (await ac.get("/api/v1/listings", params={"tipo_operacion": "venta"})).json()["listings"]
    assert items[0]["url"] is None and items[1]["url"].startswith("https://")
    # favorites stay keyed by the stable raw key, so own listings remain favoritable
    assert items[0]["fav_key"] == "42" and items[1]["fav_key"] == items[1]["url"]


async def test_amenidades_params_start_after_new_params(api):
    ac, pool = api
    await ac.get("/api/v1/listings", params={"amenidades": ["piscina"]})
    sql, args = pool.calls[0]
    assert "$18::text[]" in sql and len(args) == 18


# ── /listings/viewport ───────────────────────────────────────────────────────
VP = dict(min_lng=-75.7, min_lat=6.1, max_lng=-75.4, max_lat=6.4)


async def test_viewport_zoom_tiers(api):
    ac, pool = api
    pool.rows = [_row()]
    r = await ac.get("/api/v1/listings/viewport", params={**VP, "zoom": 14})
    assert r.json()["mode"] == "points" and r.json()["thinned"] is False
    assert "LIMIT 3000" in pool.calls[-1][0]
    r = await ac.get("/api/v1/listings/viewport", params={**VP, "zoom": 11})
    j = r.json()
    assert j["mode"] == "points" and j["thinned"] is True and len(j["listings"]) == 1
    sql, args = pool.calls[-1]
    assert "LIMIT 1500" in sql and "_cell_rn" in sql and len(args) == 25
    assert args[24] == pytest.approx(L._thin_cell_deg(11))
    pool.rows = []
    r = await ac.get("/api/v1/listings/viewport", params={**VP, "zoom": 9})
    assert r.json()["mode"] == "clusters"


async def test_viewport_thin_is_deterministic_sql():
    assert "md5(c.url)" in L._VIEWPORT_POINTS_THIN_SQL
    assert "ORDER BY" in L._VIEWPORT_POINTS_THIN_SQL


async def test_viewport_bbox_kept_with_zone_unless_flag(api):
    ac, pool = api
    await ac.get("/api/v1/listings/viewport", params={**VP, "zoom": 14, "cd_comuna": 14})
    a = pool.calls[-1][1]
    assert a[:4] == (-75.7, 6.1, -75.4, 6.4) and a[8] == 14
    await ac.get("/api/v1/listings/viewport", params={**VP, "zoom": 14, "cd_comuna": 14, "zona_completa": "true"})
    assert pool.calls[-1][1][:4] == (None, None, None, None)


async def test_viewport_filters_usd_segmento_compact(api):
    ac, pool = api
    pool.rows = [_row(foto_principal="f.jpg", direccion_raw="Calle 1", barrio_nombre="B", tipo_inmueble="apartaestudio")]
    r = await ac.get("/api/v1/listings/viewport", params={
        **VP, "zoom": 14, "tipo_operacion": "arriendo", "moneda": "USD", "precio_max": 1000, "compact": "true"})
    args = pool.calls[-1][1]
    assert args[6] == 4_000_000 and args[22] == "residencial" and args[23] is False
    it = r.json()["listings"][0]
    assert it["direccion_raw"] is None
    # fields a card/popup renders must survive compact
    assert it["foto_principal"] == "f.jpg" and it["barrio_nombre"] == "B"
    assert it["tipo_inmueble"] == "apartamento" and it["habitaciones"] == 0 and it["url"]


async def test_viewport_default_keeps_every_card_field(api):
    """Exactly what the map sends (no compact): the response must carry all fields a
    card / popup / barrio-name filter reads."""
    ac, pool = api
    pool.rows = [_row(foto_principal="f.jpg", direccion_raw="Calle 1", barrio_nombre="Laureles", municipio="MEDELLIN")]
    it = (await ac.get("/api/v1/listings/viewport", params={**VP, "zoom": 14})).json()["listings"][0]
    for k in ("foto_principal", "barrio_nombre", "municipio", "direccion_raw", "precio_cop", "area_m2", "habitaciones"):
        assert it[k] is not None, k


async def test_viewport_ocultar_destacados_flag(api):
    ac, pool = api
    await ac.get("/api/v1/listings/viewport", params={**VP, "zoom": 14, "ocultar_destacados": "true", "segmento": "comercial"})
    a = pool.calls[-1][1]
    assert a[22] == "comercial" and a[23] is True


# ── shared TRM ────────────────────────────────────────────────────────────────
async def test_trm_service_uses_db_then_env_fallback(monkeypatch):
    trm_service.clear_cache()

    class P:
        async def fetchrow(self, sql, m):
            return {"valor": 3900.5, "vigencia": "2026-10-13"}
    monkeypatch.setattr(trm_service, "get_pool", lambda: P())
    assert await trm_service.get_trm("USD") == (3900.5, "2026-10-13")
    trm_service.clear_cache()

    class Boom:
        async def fetchrow(self, *a):
            raise RuntimeError("db down")
    monkeypatch.setattr(trm_service, "get_pool", lambda: Boom())
    valor, vig = await trm_service.get_trm("USD")
    assert valor == trm_service._FALLBACK["USD"] and vig is None
    trm_service.clear_cache()


def test_trm_conversions():
    assert trm_service.cop_from_moneda(1000, "USD", 4100.4) == 4_100_400
    assert trm_service.cop_from_moneda(1000, "COP", 4100.4) == 1000
    assert trm_service.cop_from_moneda(None, "USD", 4000) is None
    assert trm_service.usd_from_cop(None, 4000) is None


async def test_trm_endpoint_and_listings_share_rate(monkeypatch):
    trm_service.clear_cache()

    class P:
        async def fetchrow(self, sql, m):
            return {"valor": 3800.0, "vigencia": "v"}
    monkeypatch.setattr(trm_service, "get_pool", lambda: P())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/api/v1/trm")
    assert r.json()["valor"] == 3800.0
    assert await trm_service.get_usd_rate() == 3800.0
    trm_service.clear_cache()


def test_ocultar_destacados_sql_is_null_safe():
    """tier IS NULL for most rows: `NOT (tier IN (...) OR ...)` would be NULL and drop them
    (found against real Postgres: ocultar_destacados=true returned 0 rows)."""
    import api.routers.listings as L
    for sql in (L._LISTINGS_SQL_TMPL, L._COUNT_SQL_TMPL, L._VIEWPORT_POINTS_SQL):
        assert "NOT COALESCE(" in sql
