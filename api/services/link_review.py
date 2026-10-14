"""Human review of broken listing links (shared by the API confirm endpoint and scraping/link_checker).

Flow: checker two-strike -> health.url_status='pending_review' (link hidden, listing STILL ACTIVE) ->
daily digest e-mail with signed one-click links -> human opens link (GET = confirm page only) ->
POST performs Retire / Keep. Nothing is retired without a human, unless the owner explicitly sets
LINK_AUTO_RETIRE_AFTER_DAYS.

Env:
  LINK_REVIEW_EMAILS      comma separated recipients (no default; unset -> digest written to a file)
  LINK_REVIEW_SECRET      HMAC signing key (>= 16 chars; required to create action links)
  LINK_REVIEW_BASE_URL    public API base used in e-mail links, e.g. https://api.example.com
  LINK_REVIEW_TOKEN_TTL_DAYS (default 7) / LINK_REVIEW_REMINDER_DAYS (7) / LINK_REVIEW_KEEP_DAYS (30)
  LINK_AUTO_RETIRE_AFTER_DAYS  optional; default OFF. Counted from the FIRST successful notification (first_notified_at)
  LINK_AUTO_RETIRE_EVIDENCE_HOURS (48) auto-retire also needs a conclusive 'gone' check this recent, source not braked
  LINK_REVIEW_FALLBACK_DIR     where the digest HTML goes when e-mail cannot be sent (default ./link_review_digests)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html as _html
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable, Callable, Optional
from urllib.parse import quote

log = logging.getLogger("link_review")

# key -> (table, deactivatable: has `activo`, mirrors url_activa/url_validada_at)
SOURCES: dict[str, tuple[str, bool, bool]] = {
    "metrocuadrado": ("raw.listings_metrocuadrado", True, True),
    "fincaraiz":     ("raw.listings_fincaraiz", True, True),
    "habi":          ("raw.listings_habi", True, False),
    "casadolcecasa": ("raw.listings_casadolcecasa", True, False),
    "premium":       ("raw.listings_premium", False, False),     # no activo column: health + API filter only
    "renta_media":   ("raw.listings_renta_media", False, False),
}


# ── activation primitives (the only code that touches raw.*.activo) ───────────────────────────

async def deactivate_listing(conn, fuente: str, url: str, reason: str) -> int:
    """THE single place that turns a listing off. Reached only through apply_decision('retire') (human
    click) or auto_retire() (explicit opt-in env). Never from the checker itself, never in --dry-run.
    Switches off raw.<source>.activo (+url_activa where present) for the rows that are STILL active and
    logs each row it really changed, with its previous values, in public.listing_link_transitions.
    Only when at least one raw row transitioned is deactivated_at / deactivation_reason ('link_checker: ...')
    set on the health row; a listing something else already disabled is therefore never ours to restore.
    Returns the number of raw rows transitioned. Reversible: reactivate_listing()."""
    table, can, mirrors = SOURCES.get(fuente, (None, False, False))
    n = 0
    if can:
        name = table.split(".", 1)[1]
        extra = ", url_activa = FALSE, url_validada_at = now()" if mirrors else ""
        prev_cols = "activo, url_activa, url_validada_at" if mirrors else "activo, NULL::boolean AS url_activa, NULL::timestamptz AS url_validada_at"
        n = await conn.fetchval(
            f"""WITH old AS (SELECT ctid AS cid, {prev_cols} FROM {table}
                              WHERE url = $1 AND activo IS NOT FALSE FOR UPDATE),
                     upd AS (UPDATE {table} t SET activo = FALSE{extra} FROM old WHERE t.ctid = old.cid RETURNING 1),
                     log AS (INSERT INTO public.listing_link_transitions (url, tabla, prev_activo, prev_url_activa, prev_url_validada_at)
                             SELECT $1, $2, activo, url_activa, url_validada_at FROM old RETURNING 1)
                SELECT (SELECT count(*) FROM upd)::int""", url, name)
    if n:
        await conn.execute(
            "UPDATE public.listing_link_health SET deactivated_at = now(), deactivation_reason = $2 WHERE url = $1",
            url, f"link_checker: {reason}"[:300])
    return n


async def reactivate_listing(conn, fuente: str, url: str) -> bool:
    """Undo deactivate_listing() (link recovered or manual rollback): restores exactly the raw rows that
    were logged as transitioned, to their previous values. True when something was restored."""
    table, can, mirrors = SOURCES.get(fuente, (None, False, False))
    if not can:
        return False
    name = table.split(".", 1)[1]
    logged = await conn.fetch(
        "SELECT id, prev_activo, prev_url_activa, prev_url_validada_at FROM public.listing_link_transitions "
        "WHERE url = $1 AND tabla = $2 AND reverted_at IS NULL ORDER BY id", url, name)
    if not logged:
        return False
    first = logged[0]
    if mirrors:
        await conn.execute(f"UPDATE {table} SET activo = $2, url_activa = $3, url_validada_at = $4 WHERE url = $1",
                           url, first["prev_activo"], first["prev_url_activa"], first["prev_url_validada_at"])
    else:
        await conn.execute(f"UPDATE {table} SET activo = $2 WHERE url = $1", url, first["prev_activo"])
    await conn.execute("UPDATE public.listing_link_transitions SET reverted_at = now() WHERE id = ANY($1::bigint[])",
                       [r["id"] for r in logged])
    await conn.execute(
        "UPDATE public.listing_link_health SET deactivated_at = NULL, deactivation_reason = NULL WHERE url = $1", url)
    return True


# ── signed single-use tokens ──────────────────────────────────────────────────────────────────

class TokenError(Exception):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind          # malformed | bad_signature | expired | used | unconfigured


def _secret() -> bytes:
    s = os.getenv("LINK_REVIEW_SECRET", "")
    if len(s) < 16:
        raise TokenError("unconfigured")
    return s.encode()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_token(action: str, target: str, *, gen: int | None = None, ttl: timedelta | None = None,
               now: datetime | None = None) -> str:
    """action: retire | keep | retire_all. target: listing url (retire/keep) or digest batch id (retire_all).
    gen: review generation of the pending episode the link was issued for (required for retire/keep)."""
    now = now or datetime.now(timezone.utc)
    ttl = ttl or timedelta(days=float(os.getenv("LINK_REVIEW_TOKEN_TTL_DAYS", "7")))
    payload = {"a": action, "t": target, "j": secrets.token_hex(8), "e": int((now + ttl).timestamp())}
    if gen is not None:
        payload["g"] = int(gen)
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def verify_token(token: str, *, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    try:
        body, sig = token.split(".")
        payload = json.loads(_unb64(body))
        action, target, jti, exp = payload["a"], payload["t"], payload["j"], int(payload["e"])
    except Exception:
        raise TokenError("malformed")
    good = _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(good, sig):
        raise TokenError("bad_signature")
    if action not in ("retire", "keep", "retire_all"):
        raise TokenError("malformed")
    if now.timestamp() > exp:
        raise TokenError("expired")
    gen = payload.get("g")
    if action in ("retire", "keep") and not isinstance(gen, int):
        raise TokenError("malformed")      # no episode bound: cannot be matched against the current review
    return {"action": action, "target": target, "jti": jti, "exp": exp, "gen": gen}


async def token_is_used(conn, jti: str) -> bool:
    return bool(await conn.fetchval("SELECT 1 FROM public.listing_link_review_used WHERE jti = $1", jti))


async def consume_token(conn, tok: dict) -> bool:
    """Atomic single use. False = replay."""
    r = await conn.execute(
        "INSERT INTO public.listing_link_review_used (jti, action, target) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        tok["jti"], tok["action"], str(tok["target"])[:500])
    return r.endswith(" 1")


# ── decisions ─────────────────────────────────────────────────────────────────────────────────

async def _lock_pending(conn, url: str, gen: int | None):
    """Row-lock the health row and return it only while it is STILL pending_review (and, when gen is
    given, still in the episode the caller's link was issued for). Concurrent Keep/Retire/checker
    updates of the same listing serialize on this lock; after waiting, the WHERE is re-evaluated."""
    row = await conn.fetchrow(
        "SELECT fuente, review_generation FROM public.listing_link_health "
        "WHERE url = $1 AND url_status = 'pending_review' FOR UPDATE", url)
    if not row or (gen is not None and row["review_generation"] != gen):
        return None
    return row


async def _retire_one(conn, url: str, who: str, gen: int | None = None) -> bool:
    row = await _lock_pending(conn, url, gen)
    if not row:
        return False
    await conn.execute(
        "UPDATE public.listing_link_health SET url_status='gone', review_decision='retire', reviewed_at=now() WHERE url=$1", url)
    await deactivate_listing(conn, row["fuente"], url, f"retired by review ({who})")
    return True


async def _keep_one(conn, url: str, gen: int | None = None) -> bool:
    row = await _lock_pending(conn, url, gen)
    if not row:
        return False
    days = float(os.getenv("LINK_REVIEW_KEEP_DAYS", "30"))
    await conn.execute(
        """UPDATE public.listing_link_health
              SET url_status='unknown', review_decision='keep', reviewed_at=now(),
                  keep_until = now() + make_interval(secs => $2), consecutive_gone=0, first_gone_at=NULL,
                  last_gone_at=NULL, last_gone_confirmed_at=NULL, review_notified_at=NULL,
                  first_notified_at=NULL, review_batch=NULL
            WHERE url=$1""", url, days * 86400)
    return True


async def apply_decision(conn, action: str, target: str, who: str = "email-link", gen: int | None = None) -> dict:
    """Perform a (verified, consumed) decision. Items no longer pending_review, or whose pending episode
    (review_generation) differs from the one the link was issued for, are skipped, never errors.
    Run inside a transaction: the row locks live until it commits."""
    if action == "retire":
        return {"retired": int(await _retire_one(conn, target, who, gen)), "kept": 0}
    if action == "keep":
        return {"retired": 0, "kept": int(await _keep_one(conn, target, gen))}
    if action == "retire_all":
        urls = [r["url"] for r in await conn.fetch(
            "SELECT url FROM public.listing_link_health WHERE review_batch = $1 AND url_status='pending_review' ORDER BY url",
            int(target))]
        n = 0
        for u in urls:
            n += int(await _retire_one(conn, u, who))
        return {"retired": n, "kept": 0}
    raise ValueError(action)


async def auto_retire(conn, braked: list[str] | tuple[str, ...] = ()) -> int:
    """Opt-in only (LINK_AUTO_RETIRE_AFTER_DAYS > 0). Retires a candidate only when ALL hold:
    the grace period since the FIRST successful notification (first_notified_at, never reset by
    reminders) has elapsed; the latest check was a conclusive 'gone' (not blocked/error/gone_suspect);
    that gone evidence is recent (LINK_AUTO_RETIRE_EVIDENCE_HOURS, default 48); its source is not braked."""
    days = float(os.getenv("LINK_AUTO_RETIRE_AFTER_DAYS", "0") or 0)
    if days <= 0:
        return 0
    evidence = float(os.getenv("LINK_AUTO_RETIRE_EVIDENCE_HOURS", "48") or 48)
    urls = [r["url"] for r in await conn.fetch(
        """SELECT url FROM public.listing_link_health
            WHERE url_status='pending_review' AND last_result='gone'
              AND first_notified_at IS NOT NULL AND first_notified_at < now() - make_interval(secs => $1)
              AND last_gone_confirmed_at > now() - make_interval(secs => $2)
              AND NOT (fuente = ANY($3::text[]))""", days * 86400, evidence * 3600, list(braked))]
    n = 0
    for u in urls:
        async with conn.transaction():
            n += int(await _retire_one(conn, u, f"auto-retire after {days:g}d"))
    return n


# ── digest ────────────────────────────────────────────────────────────────────────────────────

Sender = Callable[[str, str, str], Awaitable[None]]


def recipients() -> list[str]:
    return [e.strip() for e in os.getenv("LINK_REVIEW_EMAILS", "").split(",") if e.strip()]


async def _candidates(conn, reminder_days: float) -> list[dict]:
    rows = await conn.fetch(
        """SELECT h.url, h.fuente, h.http_status, h.final_url, h.check_error, h.first_gone_at, h.last_gone_at,
                  h.report_count, h.review_notified_at, h.review_generation,
                  s.direccion_raw, s.barrio_raw, s.precio_cop,
                  ('x'||substr(md5(h.url),1,8))::bit(32)::int AS listing_id
             FROM public.listing_link_health h
             LEFT JOIN LATERAL (SELECT direccion_raw, barrio_raw, precio_cop
                                  FROM staging.stg_listings_unificado WHERE url = h.url LIMIT 1) s ON TRUE
            WHERE h.url_status = 'pending_review'
              AND (h.review_notified_at IS NULL OR h.review_notified_at < now() - make_interval(secs => $1))
            ORDER BY h.fuente, h.first_gone_at""", reminder_days * 86400)
    return [dict(r) for r in rows]


def _link(base: str, token: str) -> str:
    return f"{base.rstrip('/')}/api/v1/link-review/confirm?t={quote(token)}"


def render_digest(cands: list[dict], *, base_url: str | None, batch_id: int | None, braked: list[str],
                  alerts: list[str], now: datetime | None = None) -> tuple[str, str]:
    """Returns (subject, html). base_url None -> no action links (informational)."""
    now = now or datetime.now(timezone.utc)
    esc = _html.escape
    reminders = sum(1 for c in cands if c.get("review_notified_at"))
    if braked and not cands:
        subject = "[Listing links] Possible portal change/block - nothing proposed"
    else:
        subject = f"[Listing links] {len(cands)} listing(s) with broken original links need review"
    parts = [f"<h3>{esc(subject)}</h3>",
             "<p>Revisión de enlaces rotos / Broken-link review. Nothing is retired until you click Retire "
             "(the public link is already hidden for these listings; the listings stay visible).</p>"]
    if braked or alerts:
        parts.append("<div style='background:#fff4e5;padding:10px;border-radius:6px'><b>Possible portal change/block - "
                     "nothing proposed for: " + esc(", ".join(braked) or "n/a") + "</b><ul>" +
                     "".join(f"<li>{esc(a)}</li>" for a in alerts) + "</ul></div>")
    if cands:
        if reminders:
            parts.append(f"<p>{reminders} item(s) are reminders (unreviewed for 7+ days).</p>")
        rows = []
        for c in cands:
            why = f"HTTP {c['http_status']}" if c.get("http_status") else ""
            if c.get("check_error"):
                why = (why + " " if why else "") + esc(str(c["check_error"]))
            act = ""
            if base_url:
                act = (f"<a href='{esc(_link(base_url, sign_token('retire', c['url'], gen=c.get('review_generation'))))}'>Retire</a> | "
                       f"<a href='{esc(_link(base_url, sign_token('keep', c['url'], gen=c.get('review_generation'))))}'>Keep</a>")
            fd = lambda d: d.strftime("%Y-%m-%d") if d else "-"
            rows.append(
                "<tr>" + "".join(f"<td style='border:1px solid #ddd;padding:4px'>{x}</td>" for x in [
                    esc(c["fuente"]), c.get("listing_id") or "", esc(str(c.get("barrio_raw") or c.get("direccion_raw") or "-")),
                    f"{c['precio_cop']:,}" if c.get("precio_cop") else "-",
                    f"<a href='{esc(c['url'])}'>{esc(c['url'][:70])}</a>", why or "-",
                    f"{fd(c.get('first_gone_at'))} / {fd(c.get('last_gone_at'))}", c.get("report_count") or 0, act]) + "</tr>")
        head = "".join(f"<th style='border:1px solid #ddd;padding:4px;background:#f3f3f3'>{h}</th>" for h in
                       ["Source", "Listing id", "Title / barrio", "Price COP", "Original URL", "Trigger",
                        "First / last failure", "User reports", "Action"])
        parts.append(f"<table style='border-collapse:collapse;font-size:12px'><tr>{head}</tr>{''.join(rows)}</table>")
        if base_url and batch_id is not None:
            parts.append(f"<p><a href='{esc(_link(base_url, sign_token('retire_all', str(batch_id))))}'><b>Retire all {len(cands)}</b></a> "
                         "(opens a confirmation page first). Links expire in "
                         f"{os.getenv('LINK_REVIEW_TOKEN_TTL_DAYS', '7')} days and work once.</p>")
        elif not base_url:
            parts.append("<p><i>Action links are disabled: set LINK_REVIEW_SECRET and LINK_REVIEW_BASE_URL.</i></p>")
    return subject, "".join(parts)


async def maybe_send_digest(conn, *, sender: Sender | None, braked: list[str], alerts: list[str],
                            now: datetime | None = None, force: bool = False) -> dict:
    """At most one digest per 24h, only when there are new/reminder candidates (or a brake notice).
    No recipients / no secret / no base URL -> HTML written to a file instead, never an exception."""
    reminder_days = float(os.getenv("LINK_REVIEW_REMINDER_DAYS", "7"))
    last = await conn.fetchval("SELECT max(sent_at) FROM public.listing_link_digest_log")
    now = now or datetime.now(timezone.utc)
    if last and not force and now - last < timedelta(hours=24):
        return {"sent": False, "reason": "already sent in last 24h"}
    cands = await _candidates(conn, reminder_days)
    if not cands and not braked:
        return {"sent": False, "reason": "nothing to review"}
    to = recipients()
    secret_ok = len(os.getenv("LINK_REVIEW_SECRET", "")) >= 16
    base = os.getenv("LINK_REVIEW_BASE_URL", "").strip() or None
    kind = "brake" if (braked and not cands) else "candidates"
    batch_id = await conn.fetchval(
        "INSERT INTO public.listing_link_digest_log (sent_at, kind, n_items, n_recipients) VALUES ($1,$2,$3,$4) RETURNING id",
        now, kind, len(cands), len(to))
    links_on = secret_ok and base is not None
    subject, body = render_digest(cands, base_url=base if links_on else None, batch_id=batch_id, braked=braked,
                                  alerts=alerts, now=now)
    delivered = False
    if to and sender is not None:
        from api.utils.email import _wrap
        wrapped = _wrap(body)
        for addr in to:
            try:
                await sender(addr, subject, wrapped)
                delivered = True
            except Exception:
                log.exception("review digest to a recipient failed")
    if not delivered:
        d = Path(os.getenv("LINK_REVIEW_FALLBACK_DIR", "./link_review_digests"))
        d.mkdir(parents=True, exist_ok=True)
        f = d / f"digest-{now.strftime('%Y%m%dT%H%M%S')}.html"
        f.write_text(f"<h2>{_html.escape(subject)}</h2>" + body, encoding="utf-8")
        log.warning("LINK_REVIEW_EMAILS %s: digest written to %s instead of e-mail",
                    "unset" if not to else "delivery failed", f)
    if cands:
        # first_notified_at is IMMUTABLE once set (reminders only move review_notified_at) and only starts
        # the auto-retire grace clock after a delivery that carried working action links.
        await conn.execute(
            "UPDATE public.listing_link_health SET review_notified_at=$2, review_batch=$3, "
            "first_notified_at = CASE WHEN $4 THEN COALESCE(first_notified_at, $2) ELSE first_notified_at END "
            "WHERE url = ANY($1::text[]) AND url_status = 'pending_review'",
            [c["url"] for c in cands], now, batch_id, bool(delivered and links_on))
    return {"sent": delivered, "file": not delivered, "n_items": len(cands), "batch_id": batch_id, "subject": subject}
