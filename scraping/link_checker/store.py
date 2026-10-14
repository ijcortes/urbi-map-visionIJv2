"""All DB access for the link checker (asyncpg). The checker itself writes ONLY public.listing_link_health
(+ the url_activa mirror for ok links). Turning a listing off lives in api.services.link_review and needs a human decision."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.link_review import SOURCES, deactivate_listing, reactivate_listing  # noqa: F401  (shared with the API)

DEFAULT_SOURCES = list(SOURCES)


async def fetch_queue(conn, sources: list[str], limit: int, older_than: timedelta) -> list[dict]:
    """Oldest-checked-first (priority rows first). Skips rows already deactivated (activo = false)."""
    parts, args = [], [older_than, limit]
    for s in sources:
        table, has_activo, _ = SOURCES[s]
        act = "AND activo IS NOT FALSE" if has_activo else ""
        parts.append(f"""
            SELECT u.url, '{s}'::text AS fuente, COALESCE(h.priority, 0) AS priority, h.last_checked_at
            FROM (SELECT url FROM {table} WHERE url ~ '^https?://' {act} GROUP BY url) u
            LEFT JOIN public.listing_link_health h ON h.url = u.url
            WHERE h.url IS NULL OR h.priority > 0 OR h.last_checked_at < now() - $1::interval
        """)
    if not parts:
        return []
    sql = f"""
        SELECT url, fuente, priority FROM (
            SELECT DISTINCT ON (url) * FROM ({' UNION ALL '.join(parts)}) u ORDER BY url
        ) d
        ORDER BY priority DESC, last_checked_at NULLS FIRST, url
        LIMIT $2
    """
    rows = await conn.fetch(sql, *args)
    return [dict(r) for r in rows]


async def load_prev(conn, urls: list[str]) -> dict[str, dict]:
    rows = await conn.fetch("SELECT * FROM public.listing_link_health WHERE url = ANY($1::text[])", urls)
    return {r["url"]: dict(r) for r in rows}


async def save_state(conn, url: str, fuente: str, st: dict[str, Any]) -> None:
    await conn.execute(
        """
        INSERT INTO public.listing_link_health
            (url, fuente, url_status, last_result, http_status, final_url, last_checked_at, last_ok_at,
             consecutive_failures, consecutive_gone, first_gone_at, last_gone_at, check_error, priority,
             review_notified_at, review_batch)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (url) DO UPDATE SET
            fuente = EXCLUDED.fuente, url_status = EXCLUDED.url_status, last_result = EXCLUDED.last_result,
            http_status = EXCLUDED.http_status, final_url = EXCLUDED.final_url,
            last_checked_at = EXCLUDED.last_checked_at, last_ok_at = EXCLUDED.last_ok_at,
            consecutive_failures = EXCLUDED.consecutive_failures, consecutive_gone = EXCLUDED.consecutive_gone,
            first_gone_at = EXCLUDED.first_gone_at, last_gone_at = EXCLUDED.last_gone_at,
            check_error = EXCLUDED.check_error, priority = EXCLUDED.priority,
            review_notified_at = EXCLUDED.review_notified_at, review_batch = EXCLUDED.review_batch
        """,
        url, fuente, st["url_status"], st["last_result"], st["http_status"], st["final_url"],
        st["last_checked_at"], st["last_ok_at"], st["consecutive_failures"], st["consecutive_gone"],
        st["first_gone_at"], st["last_gone_at"], (st["check_error"] or None) and st["check_error"][:300],
        st["priority"], st["review_notified_at"], st["review_batch"],
    )


async def mark_seen_ok(conn, fuente: str, urls: list[str]) -> None:
    """Mirror of ok results into raw.url_activa/url_validada_at for sources that carry them
    (keeps api/cache.py's `url_activa IS NOT FALSE` filter and the old column semantics in sync)."""
    table, _, mirrors = SOURCES.get(fuente, (None, False, False))
    if mirrors and urls:
        await conn.execute(
            f"UPDATE {table} SET url_activa = TRUE, url_validada_at = now(), fecha_ultima_vez_activa = now() "
            "WHERE url = ANY($1::text[])", urls)


async def summary(conn) -> dict:
    rows = await conn.fetch(
        """SELECT fuente, url_status, COUNT(*)::int AS n,
                  MIN(last_checked_at) AS oldest_check
           FROM public.listing_link_health GROUP BY fuente, url_status ORDER BY fuente, url_status""")
    oldest = await conn.fetchval("SELECT MIN(last_checked_at) FROM public.listing_link_health")
    never = await conn.fetchval("SELECT COUNT(*)::int FROM public.listing_link_health WHERE last_checked_at IS NULL")
    return {"rows": [dict(r) for r in rows], "oldest": oldest, "never_checked": never or 0}
