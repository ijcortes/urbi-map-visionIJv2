"""Shared scraper hygiene: polite HTTP (robots, identification, retry/backoff),
run accounting (non-zero exit on silent truncation / parse drift), plausibility
bounds, barrio resolution with a distance cap, Valle de Aburrá polygon check and
coverage bookkeeping for the stale-listing rule.

Every scraper/loader imports from here so the rules live in one place.
"""
from __future__ import annotations

import logging
import os
import random
import time
import urllib.robotparser
from dataclasses import dataclass, field
from urllib.parse import urlsplit

log = logging.getLogger(__name__)

# ── Identification + robots.txt ──────────────────────────────────────────────

_BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def scraper_user_agent() -> str:
    """Browser-compatible UA that also identifies the bot and a contact URL.

    SCRAPER_USER_AGENT overrides it completely. SCRAPER_CONTACT_URL sets the
    contact shown to the portal (defaults to the public site)."""
    explicit = os.getenv("SCRAPER_USER_AGENT", "").strip()
    if explicit:
        return explicit
    contact = os.getenv("SCRAPER_CONTACT_URL", "https://medellinsocial.com").strip()
    return f"{_BROWSER_UA} MedellinSocialBot/1.0 (+{contact})"


_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def robots_allowed(url: str, user_agent: str | None = None) -> bool:
    """True when the site's robots.txt allows `url` for our UA.

    Fails open only when robots.txt cannot be fetched at all (network error /
    no file), which is the standard crawler convention. Disable the check with
    SCRAPER_RESPECT_ROBOTS=0 (not recommended)."""
    if os.getenv("SCRAPER_RESPECT_ROBOTS", "1").strip() in ("0", "false", "no"):
        return True
    parts = urlsplit(url)
    root = f"{parts.scheme}://{parts.netloc}"
    if root not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(root + "/robots.txt")
        try:
            rp.read()
            _robots_cache[root] = rp
        except Exception:
            _robots_cache[root] = None
    rp = _robots_cache[root]
    if rp is None:
        return True
    return rp.can_fetch(user_agent or scraper_user_agent(), url)


# ── Run accounting ───────────────────────────────────────────────────────────

@dataclass
class RunStats:
    """Counts what a scraper run did so it can fail loudly instead of exiting 0
    after a silently truncated or schema-drifted run."""
    name: str
    pages_ok: int = 0
    pages_failed: int = 0
    items_seen: int = 0
    parse_failed: int = 0
    implausible: int = 0
    rejected_other: int = 0
    truncated_configs: list[str] = field(default_factory=list)

    def page(self, ok: bool) -> None:
        if ok:
            self.pages_ok += 1
        else:
            self.pages_failed += 1

    @property
    def page_fail_pct(self) -> float:
        total = self.pages_ok + self.pages_failed
        return 100.0 * self.pages_failed / total if total else 0.0

    @property
    def parse_fail_pct(self) -> float:
        return 100.0 * self.parse_failed / self.items_seen if self.items_seen else 0.0

    def summary(self) -> str:
        return (
            f"[{self.name}] pages ok={self.pages_ok} failed={self.pages_failed} "
            f"({self.page_fail_pct:.1f}%) | items={self.items_seen} parse_failed={self.parse_failed} "
            f"({self.parse_fail_pct:.1f}%) implausible={self.implausible} "
            f"rejected={self.rejected_other} | truncated={len(self.truncated_configs)}"
        )

    def exit_code(self) -> int:
        """0 = healthy. 2 = degraded run that must alert (cron runners treat any
        non-zero as a failed step and report it).

        Thresholds: SCRAPER_MAX_PAGE_FAIL_PCT (default 10) and
        SCRAPER_MAX_PARSE_FAIL_PCT (default 20)."""
        max_page = float(os.getenv("SCRAPER_MAX_PAGE_FAIL_PCT", "10"))
        max_parse = float(os.getenv("SCRAPER_MAX_PARSE_FAIL_PCT", "20"))
        problems = []
        if self.pages_ok + self.pages_failed == 0:
            problems.append("no pages fetched")
        if self.page_fail_pct > max_page:
            problems.append(f"{self.page_fail_pct:.1f}% pages failed (> {max_page}%)")
        if self.parse_fail_pct > max_parse:
            problems.append(f"{self.parse_fail_pct:.1f}% items unparseable (> {max_parse}%) — portal schema changed?")
        if problems:
            log.error("%s DEGRADED: %s", self.name, "; ".join(problems))
            return 2
        return 0


# ── HTTP with retry/backoff ──────────────────────────────────────────────────

_RETRY_STATUS = {429, 500, 502, 503, 504}


def http_get(session, url: str, *, params=None, timeout: float = 30, retries: int = 4,
             backoff: float = 2.0, stats: RunStats | None = None, check_robots: bool = True):
    """GET with robots check and bounded retries (429/5xx/network), honouring
    Retry-After. Returns the Response (2xx) or None; never raises."""
    if check_robots and not robots_allowed(url, session.headers.get("User-Agent")):
        log.error("robots.txt disallows %s — skipped", url)
        if stats:
            stats.page(False)
        return None
    import requests  # local: keeps this module importable without requests

    for attempt in range(retries + 1):
        try:
            resp = session.get(url, params=params, timeout=timeout)
        except requests.RequestException as e:
            if attempt == retries:
                log.error("GET %s failed after %d attempts: %s", url, attempt + 1, e)
                break
            time.sleep(backoff ** attempt + random.uniform(0, 1))
            continue
        if resp.status_code in _RETRY_STATUS and attempt < retries:
            ra = resp.headers.get("Retry-After", "")
            wait = float(ra) if ra.isdigit() else backoff ** (attempt + 1)
            log.warning("GET %s -> %d, retry %d/%d in %.0fs", url, resp.status_code, attempt + 1, retries, wait)
            time.sleep(min(wait, 120) + random.uniform(0, 1))
            continue
        if 200 <= resp.status_code < 300:
            if stats:
                stats.page(True)
            return resp
        log.error("GET %s -> HTTP %d", url, resp.status_code)
        break
    if stats:
        stats.page(False)
    return None


# ── Plausibility (same bounds as serving: api/cache.py _PLAUSIBLE) ───────────

AREA_MIN, AREA_MAX, AREA_MAX_LAND = 8, 20_000, 5_000_000
PPM2_VENTA = (300_000, 60_000_000)
PPM2_ARRIENDO = (2_000, 400_000)
_LAND = ("lote", "terreno", "finca", "casa_lote")


def implausible_reason(precio, area_m2, tipo_inmueble: str | None, tipo_operacion: str | None) -> str | None:
    """None when the record looks sane; otherwise a short reason. Records are
    still stored (raw is never filtered); the reason is counted and logged."""
    try:
        precio = float(precio or 0)
        area = float(area_m2 or 0)
    except (TypeError, ValueError):
        return "non-numeric price/area"
    tipo = (tipo_inmueble or "").lower()
    op = (tipo_operacion or "").lower()
    if precio <= 0:
        return "no price"
    if area <= 0:
        return None  # area optional for some portals; serving decides
    land = tipo.startswith(_LAND) or tipo.startswith("bodega")
    if area < AREA_MIN or area > (AREA_MAX_LAND if land else AREA_MAX):
        return f"area {area:g} m2 out of bounds"
    if tipo.startswith(("lote", "terreno", "finca", "casa_lote")):
        return None
    ppm2 = precio / area
    lo, hi = PPM2_VENTA if op.startswith("venta") else PPM2_ARRIENDO if op.startswith("arriendo") else (0, float("inf"))
    if not (lo <= ppm2 <= hi):
        return f"price/m2 {ppm2:,.0f} out of bounds"
    return None


# ── Geography ────────────────────────────────────────────────────────────────

BARRIO_MAX_DISTANCE_M = float(os.getenv("BARRIO_MAX_DISTANCE_M", "300"))

# Containment first; otherwise the nearest polygon only if it is within the cap
# (a coordinate 3 km outside any barrio used to be assigned to "the nearest").
RESOLVE_BARRIO_SQL = """
WITH p AS (SELECT ST_SetSRID(ST_Point(%(lon)s, %(lat)s), 4326) AS g)
SELECT id FROM (
    (SELECT b.id, 0::float8 AS d FROM raw.barrios b, p
      WHERE b.geometry IS NOT NULL AND ST_Contains(b.geometry, p.g) LIMIT 1)
    UNION ALL
    (SELECT b.id, ST_Distance(b.geometry::geography, p.g::geography) AS d
       FROM raw.barrios b, p
      WHERE b.geometry IS NOT NULL
        AND ST_DWithin(b.geometry::geography, p.g::geography, %(max_m)s)
      ORDER BY b.geometry <-> p.g LIMIT 1)
) x ORDER BY d LIMIT 1
"""

# Valle de Aburrá = union of the barrio polygons we serve (all 10 municipios).
IN_VALLE_SQL = """
SELECT EXISTS (
    SELECT 1 FROM raw.barrios b
     WHERE b.geometry IS NOT NULL
       AND ST_DWithin(b.geometry::geography,
                      ST_SetSRID(ST_Point(%(lon)s, %(lat)s), 4326)::geography, %(max_m)s)
)
"""

# Coarse box, only as a fallback when raw.barrios is empty (fresh DB).
_BBOX = (5.95, 6.55, -75.85, -75.30)


def _row0(row):
    if row is None:
        return None
    return row[0] if not isinstance(row, dict) else next(iter(row.values()))


def resolve_barrio(cur, lat, lon, max_m: float | None = None) -> int | None:
    if lat is None or lon is None:
        return None
    cur.execute(RESOLVE_BARRIO_SQL, {"lat": float(lat), "lon": float(lon),
                                     "max_m": float(max_m or BARRIO_MAX_DISTANCE_M)})
    return _row0(cur.fetchone())


_barrios_present: bool | None = None


def in_valle(cur, lat, lon, max_m: float | None = None) -> bool:
    """Point inside (or within max_m of) the Valle de Aburrá barrio polygons.
    Rionegro/Guarne pass the old lat/lon box but fail this."""
    global _barrios_present
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    if _barrios_present is None:
        cur.execute("SELECT EXISTS (SELECT 1 FROM raw.barrios WHERE geometry IS NOT NULL)")
        _barrios_present = bool(_row0(cur.fetchone()))
    if not _barrios_present:
        return _BBOX[0] <= lat <= _BBOX[1] and _BBOX[2] <= lon <= _BBOX[3]
    cur.execute(IN_VALLE_SQL, {"lat": lat, "lon": lon, "max_m": float(max_m or BARRIO_MAX_DISTANCE_M)})
    return bool(_row0(cur.fetchone()))


# ── Coverage bookkeeping (feeds the stale-listing rule) ──────────────────────

def record_run(cur, fuente: str, config_key: str, modo: str, total_hits: int | None,
               seen: int, pages_failed: int = 0) -> bool:
    """Store one (source, config) pass. `complete` = a full pass that saw at least
    95 % of what the portal reported, with no failed pages. Only complete full
    passes may age listings out (scripts/deactivate_stale_listings.py)."""
    complete = (
        modo == "full"
        and pages_failed == 0
        and total_hits is not None
        and total_hits > 0
        and seen >= 0.95 * total_hits
    )
    cur.execute(
        """
        INSERT INTO raw.scrape_runs (fuente, config_key, modo, total_hits, seen, pages_failed, complete)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (fuente, config_key, modo, total_hits, seen, pages_failed, complete),
    )
    return complete
