"""Regression tests for the codex round-2 review (link review part). DB tests: pytest -m require_db."""
import asyncio
import os
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

from api.services import link_review as lr
from api.tests.test_link_review import (  # noqa: F401  (fixtures + helpers)
    NOW, U_OK, U_P1, U_P2, U_P3, Sender, _env, _seed, _stg, conn,
)
from scraping.link_checker.config import Settings
from scraping.link_checker.state import next_state

db = pytest.mark.require_db


def cfg():
    return Settings(domain_delay=0.0, retries=0, backoff_base=0.0)


# ── state machine / tokens (no DB) ───────────────────────────────────────────

def test_review_generation_bumps_per_pending_episode_and_notification_clock_resets():
    c = cfg()
    s = next_state(None, "gone", now=NOW, cfg=c)
    s = next_state(s, "gone", now=NOW + timedelta(hours=25), cfg=c)
    assert s["url_status"] == "pending_review" and s["review_generation"] == 1
    assert s["last_gone_confirmed_at"] == NOW + timedelta(hours=25)
    s["first_notified_at"] = NOW + timedelta(days=1)
    s = next_state(s, "gone", now=NOW + timedelta(days=3), cfg=c)             # still pending: same episode
    assert s["review_generation"] == 1 and s["first_notified_at"] == NOW + timedelta(days=1)
    s = next_state(s, "ok", now=NOW + timedelta(days=4), cfg=c)               # recovery clears the episode
    assert s["first_notified_at"] is None and s["last_gone_confirmed_at"] is None
    s = next_state(s, "gone", now=NOW + timedelta(days=5), cfg=c)
    s = next_state(s, "gone", now=NOW + timedelta(days=7), cfg=c)
    assert s["url_status"] == "pending_review" and s["review_generation"] == 2


def test_item_tokens_must_carry_a_review_generation(monkeypatch):
    monkeypatch.setenv("LINK_REVIEW_SECRET", "unit-test-secret-0123456789abcdef")
    t = lr.sign_token("retire", "u")                                          # no gen: unusable
    with pytest.raises(lr.TokenError):
        lr.verify_token(t)
    assert lr.verify_token(lr.sign_token("keep", "u", gen=3))["gen"] == 3
    assert lr.verify_token(lr.sign_token("retire_all", "7"))["gen"] is None


# ── DB ───────────────────────────────────────────────────────────────────────

@db
@pytest.mark.asyncio
async def test_concurrent_keep_is_never_overridden_by_retire(conn):
    await _seed(conn, U_P1)
    c2 = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        tx = conn.transaction()
        await tx.start()
        assert await lr._keep_one(conn, U_P1, 0)                               # Keep holds the row lock, uncommitted

        async def retire():
            async with c2.transaction():
                return await lr.apply_decision(c2, "retire", U_P1, gen=0)

        task = asyncio.create_task(retire())
        await asyncio.sleep(0.4)                                               # Retire is now waiting on the lock
        assert not task.done()
        await tx.commit()
        assert (await task) == {"retired": 0, "kept": 0}
    finally:
        await c2.close()
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "unknown"
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is True


@db
@pytest.mark.asyncio
async def test_checker_persistence_does_not_overwrite_a_newer_keep(conn):
    from scraping.link_checker import store
    await _seed(conn, U_P1)
    stale = (await store.load_prev(conn, [U_P1]))[U_P1]                        # snapshot taken before the fetch
    assert stale["url_status"] == "pending_review"
    assert await lr._keep_one(conn, U_P1, 0)                                   # human Keep lands during the fetch
    st = await store.locked_update(
        conn, U_P1, "metrocuadrado", lambda p: next_state(p, "gone", now=NOW + timedelta(days=2), cfg=cfg()))
    row = await conn.fetchrow("SELECT url_status, review_decision, keep_until, review_generation FROM public.listing_link_health WHERE url=$1", U_P1)
    assert row["url_status"] == "unknown" and row["review_decision"] == "keep" and row["keep_until"] is not None
    assert st["url_status"] == "unknown"


@db
@pytest.mark.asyncio
async def test_token_for_an_older_review_episode_cannot_act(conn):
    await _seed(conn, U_P1)
    await conn.execute("UPDATE public.listing_link_health SET review_generation = 2 WHERE url=$1", U_P1)   # new episode
    old = lr.verify_token(lr.sign_token("retire", U_P1, gen=1))
    assert await lr.apply_decision(conn, old["action"], old["target"], gen=old["gen"]) == {"retired": 0, "kept": 0}
    oldkeep = lr.verify_token(lr.sign_token("keep", U_P1, gen=1))
    assert await lr.apply_decision(conn, "keep", U_P1, gen=oldkeep["gen"]) == {"retired": 0, "kept": 0}
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "pending_review"
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is True
    cur = lr.verify_token(lr.sign_token("retire", U_P1, gen=2))
    assert (await lr.apply_decision(conn, "retire", U_P1, gen=cur["gen"]))["retired"] == 1


@db
@pytest.mark.asyncio
async def test_digest_links_carry_the_current_generation(conn):
    await _seed(conn, U_P1)
    await conn.execute("UPDATE public.listing_link_health SET review_generation = 4 WHERE url=$1", U_P1)
    s = Sender()
    await lr.maybe_send_digest(conn, sender=s, braked=[], alerts=[], now=NOW)
    import re, html
    from urllib.parse import unquote
    toks = [unquote(t) for t in re.findall(r"confirm\?t=([^'\"&]+)", html.unescape(s.sent[0][2]))]
    item = [lr.verify_token(t) for t in toks if lr.verify_token(t)["action"] in ("retire", "keep")]
    assert item and all(t["gen"] == 4 for t in item)


async def _arm(conn, url, **cols):
    base = dict(first_notified_at=datetime.now(timezone.utc) - timedelta(days=20), last_result="gone",
                last_gone_confirmed_at=datetime.now(timezone.utc) - timedelta(hours=2))
    base.update(cols)
    sets = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(base))
    await conn.execute(f"UPDATE public.listing_link_health SET {sets} WHERE url = $1", url, *base.values())


@db
@pytest.mark.asyncio
async def test_auto_retire_needs_recent_conclusive_evidence_and_unbraked_source(conn, monkeypatch):
    monkeypatch.setenv("LINK_AUTO_RETIRE_AFTER_DAYS", "14")
    cases = {
        "ok": ({}, 1),
        "blocked": ({"last_result": "blocked"}, 0),
        "error": ({"last_result": "error"}, 0),
        "suspect": ({"last_result": "gone_suspect"}, 0),
        "stale": ({"last_gone_confirmed_at": datetime.now(timezone.utc) - timedelta(days=5)}, 0),
        "no_evidence": ({"last_gone_confirmed_at": None}, 0),
    }
    for i, (name, (cols, _)) in enumerate(cases.items()):
        u = f"https://lh-test.example/ar-{name}"
        await _seed(conn, u)
        await _arm(conn, u, **cols)
    n = await lr.auto_retire(conn)
    assert n == 1
    for name, (_, want) in cases.items():
        u = f"https://lh-test.example/ar-{name}"
        got = await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", u)
        assert got is (want == 0), name


@db
@pytest.mark.asyncio
async def test_auto_retire_skips_braked_sources(conn, monkeypatch):
    monkeypatch.setenv("LINK_AUTO_RETIRE_AFTER_DAYS", "14")
    await _seed(conn, U_P1)
    await _arm(conn, U_P1)
    assert await lr.auto_retire(conn, ["metrocuadrado"]) == 0
    assert await conn.fetchval("SELECT url_status FROM public.listing_link_health WHERE url=$1", U_P1) == "pending_review"
    assert await lr.auto_retire(conn, []) == 1


@db
@pytest.mark.asyncio
async def test_auto_retire_grace_counts_from_first_notification_not_first_gone(conn, monkeypatch):
    monkeypatch.setenv("LINK_AUTO_RETIRE_AFTER_DAYS", "14")
    old_gone = datetime.now(timezone.utc) - timedelta(days=60)
    await _seed(conn, U_P1, first_gone=old_gone)                         # failing for 60 days, never notified
    await _arm(conn, U_P1, first_notified_at=None)
    assert await lr.auto_retire(conn) == 0
    await _arm(conn, U_P1, first_notified_at=datetime.now(timezone.utc) - timedelta(days=1))   # notified yesterday
    assert await lr.auto_retire(conn) == 0
    await _arm(conn, U_P1, first_notified_at=datetime.now(timezone.utc) - timedelta(days=15))
    assert await lr.auto_retire(conn) == 1


@db
@pytest.mark.asyncio
async def test_first_notification_is_immutable_and_needs_a_delivered_digest_with_links(conn, monkeypatch, tmp_path):
    B = NOW - timedelta(days=40)          # candidates are selected with the DB clock: keep the test clock in the past
    await _seed(conn, U_P1)
    # file fallback (no recipients): the human has NOT been told -> no grace clock
    monkeypatch.setenv("LINK_REVIEW_EMAILS", "")
    await lr.maybe_send_digest(conn, sender=Sender(), braked=[], alerts=[], now=B)
    assert await conn.fetchval("SELECT first_notified_at FROM public.listing_link_health WHERE url=$1", U_P1) is None
    monkeypatch.setenv("LINK_REVIEW_EMAILS", "r@example.test")
    await conn.execute("DELETE FROM public.listing_link_digest_log")
    await conn.execute("UPDATE public.listing_link_health SET review_notified_at = NULL WHERE url=$1", U_P1)
    await lr.maybe_send_digest(conn, sender=Sender(), braked=[], alerts=[], now=B + timedelta(days=1))
    first = await conn.fetchval("SELECT first_notified_at FROM public.listing_link_health WHERE url=$1", U_P1)
    assert first == B + timedelta(days=1)
    await lr.maybe_send_digest(conn, sender=Sender(), braked=[], alerts=[], now=B + timedelta(days=9))   # reminder
    row = await conn.fetchrow("SELECT first_notified_at, review_notified_at FROM public.listing_link_health WHERE url=$1", U_P1)
    assert row["first_notified_at"] == first and row["review_notified_at"] == B + timedelta(days=9)


@db
@pytest.mark.asyncio
async def test_retire_logs_only_rows_it_changed_and_restores_previous_values(conn):
    # independently disabled by a scraper: Retire must not claim it
    await _seed(conn, U_P1)
    await conn.execute("UPDATE raw.listings_metrocuadrado SET activo = FALSE WHERE url=$1", U_P1)
    assert (await lr.apply_decision(conn, "retire", U_P1, gen=0))["retired"] == 1
    h = await conn.fetchrow("SELECT deactivated_at, deactivation_reason FROM public.listing_link_health WHERE url=$1", U_P1)
    assert h["deactivated_at"] is None and h["deactivation_reason"] is None
    assert await conn.fetchval("SELECT count(*) FROM public.listing_link_transitions WHERE url=$1", U_P1) == 0
    assert not await lr.reactivate_listing(conn, "metrocuadrado", U_P1)
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P1) is False
    # a row it really switched off is logged with previous values and restored exactly
    await _seed(conn, U_P2)
    await conn.execute("UPDATE raw.listings_metrocuadrado SET url_activa = TRUE WHERE url=$1", U_P2)
    assert (await lr.apply_decision(conn, "retire", U_P2, gen=0))["retired"] == 1
    t = await conn.fetch("SELECT prev_activo, prev_url_activa FROM public.listing_link_transitions WHERE url=$1", U_P2)
    assert len(t) == 1 and t[0]["prev_activo"] is True and t[0]["prev_url_activa"] is True
    assert await conn.fetchval("SELECT activo FROM raw.listings_metrocuadrado WHERE url=$1", U_P2) is False
    assert await lr.reactivate_listing(conn, "metrocuadrado", U_P2)
    r = await conn.fetchrow("SELECT activo, url_activa FROM raw.listings_metrocuadrado WHERE url=$1", U_P2)
    assert r["activo"] is True and r["url_activa"] is True
    assert await conn.fetchval("SELECT count(*) FROM public.listing_link_transitions WHERE url=$1 AND reverted_at IS NULL", U_P2) == 0
