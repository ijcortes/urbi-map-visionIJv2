"""Link checker unit tests. ALL HTTP is mocked with respx (no network); the DB layer is an in-memory fake."""
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from scraping.link_checker import runner, store
from scraping.link_checker.classify import Fetch, classify
from scraping.link_checker.config import Markers, Settings
from scraping.link_checker.fetcher import LinkFetcher
from scraping.link_checker.state import next_state

MC = "https://www.metrocuadrado.com/inmueble/venta-apartamento-poblado/123456789"
FR = "https://www.fincaraiz.com.co/inmueble/apartamento-en-venta/medellin/987654"
HABI = "https://habi.co/venta-apartamentos/apto-1/55555"
NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def cfg(**kw) -> Settings:
    c = Settings(domain_delay=0.0, retries=1, backoff_base=0.0, timeout=2.0)
    c.contact = "ops@example.test"
    for k, v in kw.items():
        setattr(c, k, v)
    return c


async def check(url, cfg_=None):
    f = LinkFetcher(cfg_ or cfg(), Markers())
    try:
        return await f.check(url)
    finally:
        await f.aclose()


# ── classification over mocked HTTP ──────────────────────────────────────────
@pytest.mark.asyncio
@respx.mock
async def test_404_and_410_are_gone():
    respx.route(method="HEAD", url=MC).respond(404)
    respx.get(MC).respond(404)
    v, _ = await check(MC)
    assert v.result == "gone"
    respx.clear()
    respx.get(FR).respond(410)
    v, _ = await check(FR)
    assert v.result == "gone" and "410" in v.reason


@pytest.mark.asyncio
@respx.mock
async def test_200_ok():
    respx.get(MC).respond(200, text="<html>" + "Apartamento en El Poblado " * 50 + "</html>")
    v, f = await check(MC)
    assert v.result == "ok" and f.status == 200


@pytest.mark.asyncio
@respx.mock
async def test_200_with_not_available_marker_is_gone_accent_insensitive():
    respx.get(FR).respond(200, text="<h1>Este inmueble ya no está disponible</h1>")
    v, _ = await check(FR)
    assert v.result == "gone" and "marker" in v.reason
    respx.clear()
    respx.get(MC).respond(200, text="<div>PUBLICACIÓN FINALIZADA</div>")
    assert (await check(MC))[0].result == "gone"


@pytest.mark.asyncio
@respx.mock
async def test_redirect_to_homepage_or_index_is_gone():
    respx.get(MC).respond(302, headers={"location": "https://www.metrocuadrado.com/"})
    respx.get("https://www.metrocuadrado.com/").respond(200, text="home page " * 20)
    v, f = await check(MC)
    assert v.result == "gone" and "index/home" in v.reason and f.final_url == "https://www.metrocuadrado.com/"
    respx.clear()
    respx.get(FR).respond(301, headers={"location": "https://www.fincaraiz.com.co/venta"})
    respx.get("https://www.fincaraiz.com.co/venta").respond(200, text="resultados " * 20)
    assert (await check(FR))[0].result == "gone"


@pytest.mark.asyncio
@respx.mock
async def test_redirect_chain_to_valid_page_is_redirected_not_gone():
    respx.get(MC).respond(301, headers={"location": "https://www.metrocuadrado.com/inmueble/a"})
    respx.get("https://www.metrocuadrado.com/inmueble/a").respond(302, headers={"location": "https://www.metrocuadrado.com/inmueble/venta-apartamento-poblado/123456789-canonical"})
    respx.get("https://www.metrocuadrado.com/inmueble/venta-apartamento-poblado/123456789-canonical").respond(200, text="ficha " * 100)
    v, f = await check(MC)
    assert v.result == "redirected" and f.final_url.endswith("canonical")


@pytest.mark.asyncio
@respx.mock
@pytest.mark.parametrize("status", [403, 429, 401])
async def test_blocks_are_blocked_never_gone(status):
    respx.get(MC).respond(status, text="Access denied")
    v, _ = await check(MC)
    assert v.result == "blocked"


@pytest.mark.asyncio
@respx.mock
async def test_captcha_page_with_200_is_blocked():
    respx.get(FR).respond(200, text="<html>Please complete the CAPTCHA to continue</html>")
    assert (await check(FR))[0].result == "blocked"


@pytest.mark.asyncio
@respx.mock
async def test_timeout_is_error_after_retries_and_5xx_retried():
    route = respx.get(MC).mock(side_effect=httpx.ReadTimeout("slow"))
    v, _ = await check(MC)
    assert v.result == "error" and "timeout" in v.reason
    assert route.call_count == 2          # 1 try + 1 retry
    respx.clear()
    seq = respx.get(FR).mock(side_effect=[httpx.Response(503), httpx.Response(200, text="ok page " * 50)])
    assert (await check(FR))[0].result == "ok" and seq.call_count == 2


@pytest.mark.asyncio
@respx.mock
async def test_head_then_get_fallback_for_non_body_portal():
    url = "https://other-portal.example/listing/1"
    head = respx.route(method="HEAD", url=url).respond(405)
    get = respx.get(url).respond(200, text="x" * 100)
    f = LinkFetcher(cfg(), Markers({"portals": {"other-portal.example": {"needs_body": False}}}))
    v, _ = await f.check(url)
    await f.aclose()
    assert v.result == "ok" and head.called and get.called


@pytest.mark.asyncio
@respx.mock
async def test_user_agent_identifies_bot_with_contact():
    r = respx.get(MC).respond(200, text="x" * 300)
    await check(MC)
    ua = r.calls[0].request.headers["user-agent"]
    assert "UrbiLinkChecker" in ua and "ops@example.test" in ua


@pytest.mark.asyncio
@respx.mock
async def test_per_domain_delay_is_respected():
    import time
    for i in range(3):
        respx.get(f"{MC}{i}").respond(200, text="x" * 300)
    f = LinkFetcher(cfg(domain_delay=0.15), Markers())
    t0 = time.monotonic()
    await asyncio.gather(*[f.check(f"{MC}{i}") for i in range(3)])
    await f.aclose()
    assert time.monotonic() - t0 >= 0.28      # 3 starts, 2 gaps of 0.15


@pytest.mark.asyncio
@respx.mock
async def test_domain_aborted_after_repeated_blocks():
    for i in range(4):
        respx.get(f"{MC}{i}").respond(429)
    f = LinkFetcher(cfg(domain_block_abort=2), Markers())
    res = [(await f.check(f"{MC}{i}"))[0].result for i in range(4)]
    await f.aclose()
    assert res == ["blocked", "blocked", "skipped", "skipped"]


# ── state machine ────────────────────────────────────────────────────────────
def test_two_strikes_24h_apart_gives_pending_review_not_gone():
    c = cfg()
    s1 = next_state(None, "gone", now=NOW, cfg=c)
    assert s1["url_status"] == "unknown" and s1["consecutive_gone"] == 1 and not s1["confirmed_gone_now"]
    # second 'gone' only 2h later does not count
    s2 = next_state(s1, "gone", now=NOW + timedelta(hours=2), cfg=c)
    assert s2["consecutive_gone"] == 1 and s2["url_status"] == "unknown"
    s3 = next_state(s2, "gone", now=NOW + timedelta(hours=25), cfg=c)
    assert s3["consecutive_gone"] == 2 and s3["url_status"] == "pending_review" and s3["confirmed_gone_now"]
    # staying gone later does not re-announce a new candidate
    s4 = next_state(s3, "gone", now=NOW + timedelta(hours=50), cfg=c)
    assert s4["url_status"] == "pending_review" and not s4["confirmed_gone_now"]


def test_success_resets_and_blocked_is_neutral():
    c = cfg()
    s1 = next_state(None, "gone", now=NOW, cfg=c)
    sb = next_state(s1, "blocked", now=NOW + timedelta(hours=30), cfg=c)
    assert sb["consecutive_gone"] == 1 and sb["url_status"] == "unknown" or sb["url_status"] == "blocked"
    ok = next_state(s1, "ok", now=NOW + timedelta(hours=30), cfg=c)
    assert ok["consecutive_gone"] == 0 and ok["url_status"] == "ok" and ok["last_ok_at"]
    pend = next_state(next_state(s1, "gone", now=NOW + timedelta(hours=25), cfg=c), "ok", now=NOW + timedelta(days=3), cfg=c)
    assert pend["url_status"] == "ok" and pend["recovered"]


def test_errors_flip_to_error_only_after_threshold_and_never_gone():
    c = cfg(error_threshold=3)
    st = None
    for i in range(2):
        st = next_state(st, "error", now=NOW + timedelta(days=i), cfg=c)
        assert st["url_status"] != "error"
    st = next_state(st, "error", now=NOW + timedelta(days=3), cfg=c)
    assert st["url_status"] == "error" and not st["confirmed_gone_now"]


def test_recent_human_keep_suppresses_reproposal():
    c = cfg()
    prev = {"url_status": "unknown", "consecutive_gone": 1, "last_gone_at": NOW, "first_gone_at": NOW,
            "keep_until": NOW + timedelta(days=20)}
    st = next_state(prev, "gone", now=NOW + timedelta(days=2), cfg=c)
    assert st["url_status"] == "unknown" and not st["confirmed_gone_now"]


# ── runner: in-memory store, mass-gone brake, never deactivates ─────────────
class FakeDB:
    def __init__(self, urls, prev=None):
        self.queue = [{"url": u, "fuente": "metrocuadrado", "priority": 0} for u in urls]
        self.prev = prev or {}
        self.saved = {}
        self.deactivated = []

    def install(self, monkeypatch):
        async def fq(conn, sources, limit, older): return self.queue
        async def lp(conn, urls): return self.prev
        async def ss(conn, url, fuente, st): self.saved[url] = st
        async def lu(conn, url, fuente, compute):
            st = compute(self.prev.get(url)); self.saved[url] = st; return st
        async def mso(conn, fuente, urls): pass
        monkeypatch.setattr(store, "locked_update", lu)
        async def deact(*a, **k): self.deactivated.append(a)
        monkeypatch.setattr(store, "fetch_queue", fq)
        monkeypatch.setattr(store, "load_prev", lp)
        monkeypatch.setattr(store, "save_state", ss)
        monkeypatch.setattr(store, "mark_seen_ok", mso)
        monkeypatch.setattr(store, "deactivate_listing", deact)
        from api.services import link_review
        monkeypatch.setattr(link_review, "deactivate_listing", deact)

        async def auto(conn, braked=()): return 0
        async def digest(conn, **k):
            self.digest_args = k
            return {"sent": False}
        monkeypatch.setattr(link_review, "auto_retire", auto)
        monkeypatch.setattr(link_review, "maybe_send_digest", digest)


def urls(n): return [f"https://www.metrocuadrado.com/inmueble/x/{1000+i}" for i in range(n)]


@pytest.mark.asyncio
@respx.mock
async def test_mass_gone_safety_brake(monkeypatch):
    us = urls(30)
    db = FakeDB(us); db.install(monkeypatch)
    for i, u in enumerate(us):
        respx.get(u).respond(404 if i < 20 else 200, text="ficha " * 80)   # 67% gone in one run
    rep = await runner.run(object(), cfg(), limit=100)
    assert rep.braked_sources == ["metrocuadrado"] and rep.exit_code == 2
    assert rep.candidates == [] and db.deactivated == []
    # braked 'gone' results are recorded as suspect with NO strike counted
    assert all(db.saved[u]["consecutive_gone"] == 0 for u in us[:20])
    assert db.saved[us[0]]["last_result"] == "gone_suspect"
    assert db.digest_args["braked"] == ["metrocuadrado"]


@pytest.mark.asyncio
@respx.mock
async def test_below_threshold_two_run_flow_makes_candidate_but_never_deactivates(monkeypatch):
    us = urls(30)
    db = FakeDB(us); db.install(monkeypatch)
    for i, u in enumerate(us):
        respx.get(u).respond(404 if i == 0 else 200, text="ficha " * 80)
    rep1 = await runner.run(object(), cfg(), now=NOW)
    assert rep1.candidates == [] and rep1.exit_code == 0
    db.prev = {u: s for u, s in db.saved.items()}       # persisted state of run 1
    rep2 = await runner.run(object(), cfg(), now=NOW + timedelta(hours=25))
    assert rep2.candidates == [("metrocuadrado", us[0])]
    assert db.saved[us[0]]["url_status"] == "pending_review"
    assert db.deactivated == []                          # human decision required


@pytest.mark.asyncio
@respx.mock
async def test_dry_run_writes_nothing(monkeypatch):
    us = urls(3)
    db = FakeDB(us); db.install(monkeypatch)
    for u in us: respx.get(u).respond(404)
    rep = await runner.run(object(), cfg(), dry_run=True)
    assert db.saved == {} and db.deactivated == []
    assert rep.checked == 3


@pytest.mark.asyncio
@respx.mock
async def test_blocked_results_never_count_as_gone(monkeypatch):
    us = urls(25)
    db = FakeDB(us); db.install(monkeypatch)
    for u in us: respx.get(u).respond(429)
    rep = await runner.run(object(), cfg(domain_block_abort=1000), limit=100)
    assert rep.candidates == [] and rep.exit_code == 2      # mass-block alert, not mass-gone
    assert all(s["consecutive_gone"] == 0 for s in db.saved.values())


def test_markers_file_loads_and_covers_portals():
    m = Markers()
    for u in (MC, FR, HABI, "https://www.ciencuadras.com/inmueble/1"):
        assert m.gone_texts(u)
    assert m.portal(MC)["label"] == "metrocuadrado"


def test_cli_parses_age_and_flags():
    from scraping.link_checker.__main__ import build_parser, parse_age
    a = build_parser().parse_args(["--limit", "5", "--source", "habi", "--older-than", "48h", "--dry-run"])
    assert a.limit == 5 and a.source == ["habi"] and a.older_than == timedelta(hours=48) and a.dry_run
    assert parse_age("7d") == timedelta(days=7)
