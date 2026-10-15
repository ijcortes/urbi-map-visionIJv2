"""GHL tests with MOCKED HTTP only (httpx.MockTransport). Nothing here can reach
the live GHL API: AsyncClient is replaced and no token is real.

NOTE: there is no lead push to GHL on reclamar / contact form in the codebase;
the visita sync is a stub that raises NotImplementedError (swallowed by the
caller). GHL gets leads by PULLING /api/v1/ghl/leads. The tests below cover what
exists and pin the stub behaviour so a future real push is noticed.
"""
import asyncio
import datetime as dt

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from api.limiter import limiter
from api.main import app
from api.routers import ghl_leads
from api.utils import ghl_client as G

_RealAsyncClient = httpx.AsyncClient


class FakeMapPool:
    def __init__(self, existing=None):
        self.existing = existing
        self.executed = []

    async def fetchrow(self, sql, *a):
        return self.existing

    async def execute(self, sql, *a):
        self.executed.append(a)


@pytest.fixture
def ghl(monkeypatch):
    monkeypatch.setattr(G, "_GHL_PRIVATE_TOKEN", "fake-token")
    monkeypatch.setattr(G, "_GHL_LOCATION_ID", "loc-fake")
    monkeypatch.setattr(G, "_RETRY_BACKOFF", 0)
    pool = FakeMapPool()
    monkeypatch.setattr(G, "get_pool", lambda: pool)
    calls = []
    state = {"handler": None}

    def factory(*a, **kw):
        def h(req):
            calls.append(req)
            return state["handler"](req)
        return _RealAsyncClient(transport=httpx.MockTransport(h), **{k: v for k, v in kw.items() if k == "timeout"})
    monkeypatch.setattr(G.httpx, "AsyncClient", factory)
    return pool, calls, state


CAMPOS = {"titulo": "Apto", "estado": "activo", "operacion": "venta", "tipo_inmueble": "apartamento",
          "municipio": "Medellin", "precio": 100, "moneda": "COP"}


def _props_ok(monkeypatch):
    monkeypatch.setattr(G, "_listing_campos_to_properties", lambda c, i: {"x": 1})


async def test_not_configured_is_noop(monkeypatch):
    monkeypatch.setattr(G, "_GHL_PRIVATE_TOKEN", None)
    assert await G.push_listing_to_ghl("l1", CAMPOS) is None


async def test_push_creates_with_post_and_records(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl
    st["handler"] = lambda r: httpx.Response(201, json={"record": {"id": "g1"}})
    assert await G.push_listing_to_ghl("l1", CAMPOS) == "g1"
    assert calls[0].method == "POST" and calls[0].headers["authorization"] == "Bearer fake-token"
    assert pool.executed[-1][2] == "g1" and pool.executed[-1][4] == "synced"


async def test_push_updates_with_put_when_mapped(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl
    pool.existing = {"ghl_object_id": "g9"}
    st["handler"] = lambda r: httpx.Response(200, json={})
    assert await G.push_listing_to_ghl("l1", CAMPOS) == "g9"
    assert calls[0].method == "PUT" and calls[0].url.path.endswith("/records/g9")


async def test_429_is_retried_then_succeeds(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl
    seq = iter([httpx.Response(429), httpx.Response(503), httpx.Response(201, json={"record": {"id": "g2"}})])
    st["handler"] = lambda r: next(seq)
    assert await G.push_listing_to_ghl("l2", CAMPOS) == "g2"
    assert len(calls) == 3


async def test_post_not_retried_after_500_or_read_timeout(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl
    st["handler"] = lambda r: httpx.Response(500)
    assert await G.push_listing_to_ghl("l3", CAMPOS) is None
    assert len(calls) == 1                      # no duplicate-creating replay

    calls.clear()

    def boom(r):
        raise httpx.ReadTimeout("slow", request=r)
    st["handler"] = boom
    assert await G.push_listing_to_ghl("l3", CAMPOS) is None
    assert len(calls) == 1


async def test_connect_error_retried_for_post(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl

    def boom(r):
        raise httpx.ConnectError("down", request=r)
    st["handler"] = boom
    assert await G.push_listing_to_ghl("l4", CAMPOS) is None
    assert len(calls) == G._MAX_ATTEMPTS


async def test_put_500_retried_and_failure_recorded(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl
    pool.existing = {"ghl_object_id": "g9"}
    st["handler"] = lambda r: httpx.Response(500)
    assert await G.push_listing_to_ghl("l5", CAMPOS) is None
    assert len(calls) == G._MAX_ATTEMPTS
    assert pool.executed[-1][4] == "failed"


async def test_4xx_not_retried(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl
    st["handler"] = lambda r: httpx.Response(422, json={"message": "bad"})
    assert await G.push_listing_to_ghl("l6", CAMPOS) is None
    assert len(calls) == 1


async def test_concurrent_pushes_same_id_serialized(ghl, monkeypatch):
    _props_ok(monkeypatch)
    pool, calls, st = ghl
    active = {"n": 0, "max": 0}
    orig = G._request

    async def slow(*a, **k):
        active["n"] += 1
        active["max"] = max(active["max"], active["n"])
        await asyncio.sleep(0.01)
        active["n"] -= 1
        return httpx.Response(201, json={"record": {"id": "g"}})
    monkeypatch.setattr(G, "_request", slow)
    await asyncio.gather(*[G.push_listing_to_ghl("same", CAMPOS) for _ in range(4)])
    assert active["max"] == 1


# ── webhook ──────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def client():
    limiter.enabled = False
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield ac
    limiter.enabled = True


async def test_webhook_closed_without_secret(client, monkeypatch):
    monkeypatch.delenv("GHL_WEBHOOK_SECRET", raising=False)
    monkeypatch.setattr(G, "GHL_WEBHOOK_SECRET", None)
    r = await client.post("/api/v1/webhook/ghl", json={"object_type": "listing"})
    assert r.status_code == 503


async def test_webhook_auth_matrix(client, monkeypatch):
    monkeypatch.setenv("GHL_WEBHOOK_SECRET", "s3cret-value")
    url = "/api/v1/webhook/ghl"
    assert (await client.post(url, json={})).status_code == 401
    assert (await client.post(url, json={}, headers={"X-Webhook-Secret": "nope"})).status_code == 401
    ok = {"X-Webhook-Secret": "s3cret-value"}
    assert (await client.post(url, content=b"not json", headers=ok)).status_code == 400
    assert (await client.post(url, json={"object_type": "zzz"}, headers=ok)).status_code == 400
    # valid auth reaches the handler, which is a documented stub -> 501
    assert (await client.post(url, json={"object_type": "visita"}, headers=ok)).status_code == 501
    bearer = {"Authorization": "Bearer s3cret-value"}
    assert (await client.post(url, json={"object_type": "visita"}, headers=bearer)).status_code == 501


async def test_webhook_authenticates_before_reading_body(client, monkeypatch):
    monkeypatch.setenv("GHL_WEBHOOK_SECRET", "s3cret-value")
    url = "/api/v1/webhook/ghl"
    consumed = []

    async def body():
        consumed.append(1)
        yield b"x" * 10

    r = await client.post(url, content=body())
    assert r.status_code == 401
    # body is never pulled for unauthenticated callers (server may not drain it at all)
    big = b"x" * 1_000_001
    assert (await client.post(url, content=big)).status_code == 401


async def test_webhook_oversize_rejected_with_running_limit(client, monkeypatch):
    monkeypatch.setenv("GHL_WEBHOOK_SECRET", "s3cret-value")
    url = "/api/v1/webhook/ghl"
    ok = {"X-Webhook-Secret": "s3cret-value"}
    # Content-Length precheck
    assert (await client.post(url, content=b"x" * 1_000_001, headers=ok)).status_code == 413

    # chunked (no Content-Length): stops once the running total passes the limit
    pulled = []

    async def chunks():
        for _ in range(100):
            pulled.append(1)
            yield b"x" * 100_000

    r = await client.post(url, content=chunks(), headers=ok)
    assert r.status_code == 413


# ── /ghl/leads pull ──────────────────────────────────────────────────────────
class LeadPool:
    def __init__(self):
        self.calls = []
        self.row = None

    async def fetch(self, sql, *a):
        self.calls.append((sql, a))
        return [self.row] if self.row else []

    async def fetchrow(self, sql, *a):
        self.calls.append((sql, a))
        return self.row


def _lead_row():
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    return dict(id="11111111-1111-1111-1111-111111111111", created_at=now, estado="pendiente",
                nombre="N", telefono="3", email="e@x.co", listing_url="u", fecha_visita=None,
                mensaje=None, agent_id=None, intencion="vivir", presupuesto=None, plazo=None,
                credito=None, horas_sin_responder=2)


@pytest_asyncio.fixture
async def leads(client):
    pool = LeadPool()
    pool.row = _lead_row()
    app.dependency_overrides[ghl_leads.get_pool] = lambda: pool
    yield client, pool
    app.dependency_overrides.pop(ghl_leads.get_pool, None)


async def test_leads_auth(leads, monkeypatch):
    c, _ = leads
    monkeypatch.delenv("GHL_LEADS_TOKEN", raising=False)
    assert (await c.get("/api/v1/ghl/leads")).status_code == 503
    monkeypatch.setenv("GHL_LEADS_TOKEN", "tok")
    assert (await c.get("/api/v1/ghl/leads")).status_code == 401
    assert (await c.get("/api/v1/ghl/leads", headers={"X-API-Key": "bad"})).status_code == 401
    r = await c.get("/api/v1/ghl/leads", headers={"X-API-Key": "tok"})
    assert r.status_code == 200 and r.json()["count"] == 1 and r.json()["leads"][0]["calificado"] is True


async def test_leads_order_asc_with_since(leads, monkeypatch):
    c, pool = leads
    monkeypatch.setenv("GHL_LEADS_TOKEN", "tok")
    h = {"X-API-Key": "tok"}
    await c.get("/api/v1/ghl/leads", headers=h)
    assert "created_at DESC" in pool.calls[-1][0]
    await c.get("/api/v1/ghl/leads?since=2026-01-01T00:00:00Z", headers=h)
    assert "created_at ASC" in pool.calls[-1][0]
    assert (await c.get("/api/v1/ghl/leads?since=garbage", headers=h)).status_code == 400
    assert (await c.get("/api/v1/ghl/leads?estado=zzz", headers=h)).status_code == 400


async def test_lead_by_id_bad_uuid_is_404_not_500(leads, monkeypatch):
    c, pool = leads
    monkeypatch.setenv("GHL_LEADS_TOKEN", "tok")
    h = {"X-API-Key": "tok"}
    assert (await c.get("/api/v1/ghl/leads/not-a-uuid", headers=h)).status_code == 404
    assert (await c.get("/api/v1/ghl/leads/11111111-1111-1111-1111-111111111111", headers=h)).status_code == 200
    pool.row = None
    assert (await c.get("/api/v1/ghl/leads/11111111-1111-1111-1111-111111111112", headers=h)).status_code == 404


# ── stub behaviour pinned ────────────────────────────────────────────────────
async def test_visita_push_is_still_a_stub():
    with pytest.raises(NotImplementedError):
        await G.push_visita_to_ghl("any", {})
