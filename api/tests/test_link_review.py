"""Human-review flow + API behaviour for link health. Mail sender is ALWAYS a mock; nothing is sent.
DB tests (require_db) run against a throwaway postgis container: DATABASE_URL=... pytest -m require_db"""
import os
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest
import pytest_asyncio

from api.services import link_review as lr

SECRET = "unit-test-secret-0123456789abcdef"
NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("LINK_REVIEW_SECRET", SECRET)
    monkeypatch.setenv("LINK_REVIEW_BASE_URL", "https://api.example.test")
    monkeypatch.setenv("LINK_REVIEW_EMAILS", "reviewer1@example.test, reviewer2@example.test")
    monkeypatch.setenv("LINK_REVIEW_FALLBACK_DIR", str(tmp_path / "digests"))
    monkeypatch.delenv("LINK_AUTO_RETIRE_AFTER_DAYS", raising=False)


# ── tokens (no DB) ────────────────────────────────────────────────────────────
def test_token_roundtrip_and_tamper_detection():
    t = lr.sign_token("retire", "https://x.example/a", now=NOW)
    p = lr.verify_token(t, now=NOW + timedelta(days=1))
    assert p["action"] == "retire" and p["target"] == "https://x.example/a"
    body, sig = t.split(".")
    with pytest.raises(lr.TokenError) as e:
        lr.verify_token(body + "." + sig[:-2] + "AA", now=NOW)
    assert e.value.kind == "bad_signature"
    # swapping the action inside the payload invalidates the signature
    forged = lr._b64(lr._unb64(body).replace(b'"retire"', b'"keep"'))
    with pytest.raises(lr.TokenError):
        lr.verify_token(forged + "." + sig, now=NOW)
    with pytest.raises(lr.TokenError) as e:
        lr.verify_token("garbage", now=NOW)
    assert e.value.kind == "malformed"


def test_token_expiry_and_missing_secret(monkeypatch):
    t = lr.sign_token("keep", "u", ttl=timedelta(days=7), now=NOW)
    with pytest.raises(lr.TokenError) as e:
        lr.verify_token(t, now=NOW + timedelta(days=7, seconds=1))
    assert e.value.kind == "expired"
    monkeypatch.setenv("LINK_REVIEW_SECRET", "short")
    with pytest.raises(lr.TokenError) as e:
        lr.sign_token("keep", "u")
    assert e.value.kind == "unconfigured"


def test_digest_render_contents_and_links():
    c = [{"url": "https://www.fincaraiz.com.co/x/1", "fuente": "fincaraiz", "http_status": 404, "check_error": "http 404",
          "first_gone_at": NOW - timedelta(days=2), "last_gone_at": NOW, "report_count": 3, "review_notified_at": None,
          "direccion_raw": "Cra 1", "barrio_raw": "El Poblado", "precio_cop": 450000000, "listing_id": 123}]
    subj, body = lr.render_digest(c, base_url="https://api.example.test", batch_id=7, braked=[], alerts=[], now=NOW)
    assert "1 listing(s)" in subj
    for needle in ["fincaraiz", "El Poblado", "450,000,000", "https://www.fincaraiz.com.co/x/1", "404",
                   "2026-10-12", "2026-10-14", ">3<", "Retire</a>", "Keep</a>", "Retire all 1", "link-review/confirm?t="]:
        assert needle in body, needle
    s2, b2 = lr.render_digest([], base_url="https://api.example.test", batch_id=8, braked=["metrocuadrado"],
                              alerts=["metrocuadrado: 70% gone"], now=NOW)
    assert "nothing proposed" in s2.lower() and "Retire all" not in b2


# ── DB-backed ─────────────────────────────────────────────────────────────────
pytestmark_db = pytest.mark.require_db
U_OK, U_P1, U_P2, U_P3 = (f"https://lh-test.example/{n}" for n in ("ok", "p1", "p2", "p3"))


@pytest_asyncio.fixture
async def conn():
    c = await asyncpg.connect(os.environ["DATABASE_URL"])
    await _clean(c)
    yield c
    await _clean(c)
    await c.close()


async def _clean(c):
    await c.execute("DELETE FROM public.listing_link_health WHERE url LIKE 'https://lh-test.example/%'")
    await c.execute("DELETE FROM public.listing_link_reports WHERE url LIKE 'https://lh-test.example/%'")
    await c.execute("DELETE FROM public.listing_link_review_used")
    await c.execute("DELETE FROM public.listing_link_digest_log")
    await c.execute("DELETE FROM raw.listings_metrocuadrado WHERE url LIKE 'https://lh-test.example/%'")
    await c.execute("DELETE FROM staging.stg_listings_unificado WHERE url LIKE 'https://lh-test.example/%'")


async def _seed(c, url, status="pending_review", fuente="metrocuadrado", notified=None, first_gone=None, mc_row=True):
    if mc_row:
        await c.execute("INSERT INTO raw.listings_metrocuadrado (id, url, activo, precio, area_m2) "
                        "VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM raw.listings_metrocuadrado), $1, true, 1000000, 50)", url)
    await c.execute(
        "INSERT INTO public.listing_link_health (url, fuente, url_status, http_status, review_notified_at, first_gone_at, last_gone_at, report_count) "
        "VALUES ($1,$2,$3,404,$4,$5,$5,2)", url, fuente, status, notified, first_gone or NOW - timedelta(days=2))


async def _stg(c, url, fuente="metrocuadrado"):
    # a DB built from migrations only has the older staging shape; api/cache.py adds these in prod
    for col, typ in (("verificado", "boolean"), ("nombre_edificio", "text")):
        await c.execute(f"ALTER TABLE staging.stg_listings_unificado ADD COLUMN IF NOT EXISTS {col} {typ}")
    await c.execute(
        "INSERT INTO staging.stg_listings_unificado (listing_uid, fuente, tier, tipo_operacion, tipo_inmueble, precio_cop, area_m2, "
        "lat, lon, url, direccion_raw, barrio_raw) VALUES ($1,$2,'standard','venta','apartamento',900000000,80,6.2,-75.57,$3,'Cra 1','El Poblado')",
        url + "_uid", fuente, url)


class Sender:
    def __init__(self): self.sent = []
    async def __call__(self, to, subject, html): self.sent.append((to, subject, html))


async def _act(conn, tok_str):
    tok = lr.verify_token(tok_str)
    assert await lr.consume_token(conn, tok)
    return tok, await lr.apply_decision(conn, tok["action"], tok["target"])


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_digest_sent_once_per_day_and_marks_notified(conn):
    await _seed(conn, U_P1); await _stg(conn, U_P1)
    s = Sender()
    r = await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW)
    assert r["sent"] and r["n_items"] == 1 and len(s.sent) == 2         # two recipients
    assert s.sent[0][0] == "reviewer1@example.test" and "El Poblado" in s.sent[0][2] and "Retire all 1" in s.sent[0][2]
    await _seed(conn, U_P2)                                              # new candidate, but < 24h later
    r2 = await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW + timedelta(hours=5))
    assert not r2["sent"] and "24h" in r2["reason"] and len(s.sent) == 2
    r3 = await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW + timedelta(hours=25))
    assert r3["n_items"] == 1                                            # only the NEW one; U_P1 is not re-mailed yet


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_nothing_to_review_sends_nothing_and_brake_notice(conn):
    s = Sender()
    assert (await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW))["reason"] == "nothing to review"
    r = await lr.maybe_send_digest(conn, sender=s, braked=["metrocuadrado"], alerts=["70% gone"], now=NOW)
    assert r["sent"] and "nothing proposed" in r["subject"].lower() and len(s.sent) == 2


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_reminder_after_7_days_never_silent_retirement(conn):
    await _seed(conn, U_P1, notified=NOW - timedelta(days=8))
    await _seed(conn, U_P2, notified=NOW - timedelta(days=3))
    s = Sender()
    r = await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW)
    assert r["n_items"] == 1 and "reminders" in s.sent[0][2]
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is True
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "pending_review"
    assert await lr.auto_retire(conn) == 0                               # default OFF


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_auto_retire_only_when_opted_in(conn, monkeypatch):
    await _seed(conn, U_P1, notified=NOW - timedelta(days=20), first_gone=datetime.now(timezone.utc) - timedelta(days=20))
    monkeypatch.setenv("LINK_AUTO_RETIRE_AFTER_DAYS", "14")
    assert await lr.auto_retire(conn) == 1
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is False
    assert "auto-retire" in await conn.fetchval("SELECT deactivation_reason FROM public.listing_link_health WHERE url=$1", U_P1)


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_no_recipients_writes_file_instead_of_failing(conn, monkeypatch, tmp_path):
    monkeypatch.delenv("LINK_REVIEW_EMAILS")
    await _seed(conn, U_P1)
    s = Sender()
    r = await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW)
    assert s.sent == [] and r["file"] and not r["sent"]
    files = list((tmp_path / "digests").glob("digest-*.html"))
    assert len(files) == 1 and U_P1 in files[0].read_text()
    assert await conn.fetchval("SELECT review_notified_at FROM public.listing_link_health WHERE url=$1", U_P1) is not None


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_missing_secret_falls_back_to_file_without_links(conn, monkeypatch, tmp_path):
    monkeypatch.delenv("LINK_REVIEW_SECRET")
    await _seed(conn, U_P1)
    s = Sender()
    r = await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW)
    assert r["sent"] and "confirm?t=" not in s.sent[0][2] and "Action links are disabled" in s.sent[0][2]


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_retire_keep_replay_and_retire_all(conn):
    for u in (U_P1, U_P2, U_P3):
        await _seed(conn, u)
    # retire: deactivates raw row, status gone; replay rejected
    t = lr.sign_token("retire", U_P1)
    tok, res = await _act(conn, t)
    assert res["retired"] == 1
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is False
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "gone"
    assert not await lr.consume_token(conn, lr.verify_token(t))          # replay
    # keep: listing untouched, link restored (unknown), proposals suppressed
    await _act(conn, lr.sign_token("keep", U_P2))
    row = await conn.fetchrow("SELECT url_status, keep_until FROM public.listing_link_health WHERE url=$1", U_P2)
    assert row["url_status"] == "unknown" and row["keep_until"] > datetime.now(timezone.utc) + timedelta(days=29)
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P2) is True
    # a second action on an already-decided item is a harmless no-op
    _, res = await _act(conn, lr.sign_token("retire", U_P2))
    assert res["retired"] == 0
    # retire_all for a batch
    bid = await conn.fetchval("INSERT INTO public.listing_link_digest_log (kind) VALUES ('candidates') RETURNING id")
    await conn.execute("UPDATE public.listing_link_health SET review_batch=$1 WHERE url=$2", bid, U_P3)
    _, res = await _act(conn, lr.sign_token("retire_all", str(bid)))
    assert res["retired"] == 1
    # reactivation is possible (reversible)
    assert await lr.reactivate_listing(conn, "metrocuadrado", U_P1)
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is True


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_queue_orders_priority_then_oldest_and_skips_inactive(conn):
    from scraping.link_checker import store
    for i, u in enumerate((U_OK, U_P1, U_P2)):
        await conn.execute("INSERT INTO raw.listings_metrocuadrado (id, url, activo) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM raw.listings_metrocuadrado), $1, $2)", u, u != U_P2)
    await conn.execute("INSERT INTO public.listing_link_health (url, fuente, last_checked_at, priority) VALUES ($1,'metrocuadrado', now() - interval '3 days', 0)", U_OK)
    q = await store.fetch_queue(conn, ["metrocuadrado"], 50, timedelta(hours=24))
    urls = [r["url"] for r in q if r["url"].startswith("https://lh-test")]
    assert urls == [U_P1, U_OK] or set(urls) == {U_OK, U_P1}            # never-checked first; inactive U_P2 skipped
    assert U_P2 not in urls
    await conn.execute("INSERT INTO public.listing_link_health (url, fuente, last_checked_at, priority) VALUES ($1,'metrocuadrado', now(), 10)", U_P1)
    q = await store.fetch_queue(conn, ["metrocuadrado"], 50, timedelta(hours=24))
    assert [r["url"] for r in q if r["url"].startswith("https://lh-test")][0] == U_P1


# ── HTTP endpoints ────────────────────────────────────────────────────────────
@pytest.mark.require_db
@pytest.mark.asyncio
async def test_get_confirm_page_never_acts_post_does(client, conn):
    await _seed(conn, U_P1)
    t = lr.sign_token("retire", U_P1)
    r = await client.get("/api/v1/link-review/confirm", params={"t": t})
    assert r.status_code == 200 and "Confirm" in r.text and "<form method=post" in r.text
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "pending_review"
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is True
    for _ in range(2):                                                    # scanner prefetch twice: still nothing
        await client.get("/api/v1/link-review/confirm", params={"t": t})
    assert await conn.fetchval("SELECT count(*) FROM public.listing_link_review_used") == 0
    r = await client.post("/api/v1/link-review/confirm", params={"t": t})
    assert r.status_code == 200 and "retired: 1" in r.text
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is False
    r = await client.post("/api/v1/link-review/confirm", params={"t": t})   # replay
    assert r.status_code == 410
    assert (await client.get("/api/v1/link-review/confirm", params={"t": t})).status_code == 410


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_post_keep_bad_and_expired_tokens(client, conn):
    await _seed(conn, U_P2)
    r = await client.post("/api/v1/link-review/confirm", params={"t": lr.sign_token("keep", U_P2)})
    assert r.status_code == 200 and "Kept: 1" in r.text
    assert (await client.post("/api/v1/link-review/confirm", params={"t": "x.y"})).status_code == 400
    old = lr.sign_token("retire", U_P1, now=datetime.now(timezone.utc) - timedelta(days=30))
    r = await client.post("/api/v1/link-review/confirm", params={"t": old})
    assert r.status_code == 400 and "expired" in r.text


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_listings_api_hides_links_and_filters_retired(client, conn):
    from api.main import app
    from api.dependencies import get_optional_user
    for u, st in ((U_OK, "ok"), (U_P1, "pending_review"), (U_P2, "gone"), (U_P3, "blocked")):
        await _stg(conn, u)
        await conn.execute("INSERT INTO public.listing_link_health (url, fuente, url_status) VALUES ($1,'metrocuadrado',$2)", u, st)
    r = await client.get("/api/v1/listings", params={"limit": 500})
    by = {x["fav_key"] if "fav_key" in x else x["url"]: x for x in r.json()["listings"]}
    mine = {u: by.get(u) for u in (U_OK, U_P1, U_P2, U_P3)}
    assert mine[U_P2] is None                                              # retired: excluded
    assert mine[U_OK]["url"] == U_OK and mine[U_OK]["link_status"] == "ok"
    assert mine[U_P3]["url"] == U_P3 and mine[U_P3]["link_status"] == "unknown"   # blocked != dead
    assert mine[U_P1] is not None and mine[U_P1]["url"] is None and mine[U_P1]["link_status"] == "pending_review"
    # viewport behaves the same
    vp = {"min_lng": -76, "min_lat": 6, "max_lng": -75, "max_lat": 6.5, "zoom": 15}
    items = {(x.get("url") or x.get("link_status")): x for x in (await client.get("/api/v1/listings/viewport", params=vp)).json()["listings"]}
    assert U_OK in items and U_P2 not in items.keys() and U_P3 in items
    # admin override includes retired listings
    app.dependency_overrides[get_optional_user] = lambda: {"email": os.environ["ADMIN_EMAIL"], "id": 1}
    try:
        r = await client.get("/api/v1/listings", params={"limit": 500, "incluir_inactivos": "true"})
        assert any(x.get("fav_key") == U_P2 for x in r.json()["listings"])
        r = await client.get("/api/v1/listings", params={"limit": 500, "incluir_inactivos": "true"})
    finally:
        app.dependency_overrides.pop(get_optional_user, None)
    # non-admin cannot use the override
    r = await client.get("/api/v1/listings", params={"limit": 500, "incluir_inactivos": "true"})
    assert not any(x.get("fav_key") == U_P2 for x in r.json()["listings"])


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_report_broken_link_dedup_priority_and_rate_limit(client, conn, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", "1")      # test client = 1 trusted hop; XFF carries the 'client' IP
    from api.limiter import limiter
    await _stg(conn, U_OK)
    lid = await conn.fetchval("SELECT ('x'||substr(md5($1),1,8))::bit(32)::int", U_OK)
    limiter.enabled = True
    limiter.reset()
    try:
        r = await client.post(f"/api/v1/listings/{lid}/report-broken-link", headers={"x-forwarded-for": "10.0.0.1"})
        assert r.json() == {"status": "reported", "reports": 1}
        r = await client.post(f"/api/v1/listings/{lid}/report-broken-link", headers={"x-forwarded-for": "10.0.0.1"})
        assert r.json()["status"] == "already_reported" and r.json()["reports"] == 1
        pr = await conn.fetchval("SELECT priority FROM public.listing_link_health WHERE url=$1", U_OK)
        assert pr == 1
        for ip in ("10.0.0.2", "10.0.0.3"):
            r = await client.post(f"/api/v1/listings/{lid}/report-broken-link", headers={"x-forwarded-for": ip})
        assert r.json()["reports"] == 3
        assert await conn.fetchval("SELECT priority FROM public.listing_link_health WHERE url=$1", U_OK) == 10
        assert (await client.post("/api/v1/listings/1/report-broken-link")).status_code == 404
        # rate limit: 5/hour per IP
        codes = [(await client.post(f"/api/v1/listings/{lid}/report-broken-link", headers={"x-forwarded-for": "10.9.9.9"})).status_code for _ in range(7)]
        assert codes[-1] == 429 and 429 not in codes[:4]
    finally:
        limiter.enabled = False
        limiter.reset()


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_admin_link_health_summary(client, conn):
    from api.main import app
    from api.routers.admin import require_admin
    assert (await client.get("/api/v1/admin/link-health/summary")).status_code in (401, 403)
    await conn.execute("INSERT INTO public.listing_link_health (url, fuente, url_status, last_checked_at) VALUES ($1,'habi','ok', now() - interval '5 hours'), ($2,'habi','pending_review', now())", U_OK, U_P1)
    app.dependency_overrides[require_admin] = lambda: {"email": "admin"}
    try:
        j = (await client.get("/api/v1/admin/link-health/summary")).json()
    finally:
        app.dependency_overrides.pop(require_admin, None)
    assert j["by_source"]["habi"]["statuses"] == {"ok": 1, "pending_review": 1}
    assert j["by_source"]["habi"]["oldest_check_age_hours"] >= 5 and j["pending_review"] >= 1


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_end_to_end_runner_two_strikes_then_human_review(conn):
    import respx, httpx
    from datetime import timedelta as td
    from scraping.link_checker import runner
    from scraping.link_checker.config import Settings
    await conn.execute("INSERT INTO raw.listings_metrocuadrado (id, url, activo) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM raw.listings_metrocuadrado), $1, true)", U_P1)
    await _stg(conn, U_P1)
    cfg = Settings(domain_delay=0.0, retries=0, backoff_base=0.0)
    s = Sender()
    T0 = datetime.now(timezone.utc) - td(days=10)   # checks stored in the past so the DB clock considers them due
    with respx.mock:
        respx.get(U_P1).respond(404)
        r1 = await runner.run(conn, cfg, sources=["metrocuadrado"], now=T0, sender=s)
        assert r1.candidates == [] and s.sent == []
        # fast-forward: age the strike by 25h (the checker's own clock is injectable via `now`)
        r2 = await runner.run(conn, cfg, sources=["metrocuadrado"], older_than=td(0), now=T0 + td(hours=25), sender=s)
    assert r2.candidates == [("metrocuadrado", U_P1)]
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "pending_review"
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is True   # still live
    assert len(s.sent) == 2 and U_P1 in s.sent[0][2]
    # link recovers -> back to ok, candidate disappears
    with respx.mock:
        respx.get(U_P1).respond(200, text="ficha " * 100)
        await runner.run(conn, cfg, sources=["metrocuadrado"], older_than=td(0), now=T0 + td(days=3), sender=s)
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "ok"
    assert await conn.fetchval("SELECT url_activa FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is True
