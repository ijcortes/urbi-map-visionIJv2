"""Import event metadata from a public URL (lu.ma, Eventbrite, Meetup, …) so the
user can paste a link and have the submit form prefilled.

Parser strategy — one code path for every site, no per-site scraping:
  1. JSON-LD  <script type="application/ld+json"> with @type "Event"  (schema.org
     standard — lu.ma, Eventbrite, Meetup all emit it for SEO).
  2. Open Graph tags (og:title / og:image / og:description) as a last resort when
     a page has no Event JSON-LD (gives title+image+desc, no dates).

Security: this fetches a *user-supplied* URL server-side → SSRF surface. Mitigated
by auth + rate limit on the caller, plus host IP validation here (reject private /
loopback / link-local) and manual redirect following that re-validates every hop
(lu.ma legitimately 301s to luma.com, so we can't just block redirects).
"""
from __future__ import annotations

import ipaddress
import json
import logging
import re
import socket
from html import unescape
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)

# ponytail: fixed TRM to match the luma cron scraper (USD_TO_COP=4100). A live rate
# isn't worth a DB hit here — the user reviews/edits precio before submitting.
USD_TO_COP = 4100

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_TIMEOUT = httpx.Timeout(5.0)
_MAX_BYTES = 1_500_000  # cap body read — event pages are well under this
_MAX_REDIRECTS = 4

_LDJSON_RE = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.S | re.I,
)
_OG_RE = re.compile(
    r'<meta[^>]+property=["\']og:(title|image|description)["\'][^>]+content=["\'](.*?)["\']',
    re.I,
)


class ImportError_(Exception):
    """Raised when the URL can't be fetched or holds nothing we can use."""


def _assert_public_host(host: str) -> None:
    """Resolve host and reject if ANY resolved IP is private/loopback/etc. — SSRF guard.

    ponytail: DNS-rebinding (host resolves public here, private on the real fetch) is
    a residual; adequate behind auth + rate limit. Upgrade to pinned-IP fetch if this
    ever faces untrusted volume."""
    if not host:
        raise ImportError_("URL sin host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise ImportError_("No pudimos resolver ese dominio")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ImportError_("URL no permitida")


async def _fetch(url: str) -> tuple[str, str]:
    """Follow redirects manually, SSRF-validating every hop. Returns (final_url, html)."""
    async with httpx.AsyncClient(follow_redirects=False, timeout=_TIMEOUT) as client:
        for _ in range(_MAX_REDIRECTS):
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise ImportError_("URL inválida")
            _assert_public_host(parsed.hostname)
            resp = await client.get(url, headers={"User-Agent": _UA})
            if resp.is_redirect and resp.headers.get("location"):
                url = urljoin(url, resp.headers["location"])
                continue
            resp.raise_for_status()
            return str(resp.url), resp.text[:_MAX_BYTES]
    raise ImportError_("Demasiados redirects")


def _first(value):
    return value[0] if isinstance(value, list) and value else value


def _find_event(node):
    """Depth-first search a parsed JSON-LD tree for the first @type Event object."""
    if isinstance(node, dict):
        t = node.get("@type", "")
        if "Event" in (t if isinstance(t, str) else " ".join(map(str, t if isinstance(t, list) else []))):
            return node
        for v in node.values():
            found = _find_event(v)
            if found:
                return found
    elif isinstance(node, list):
        for v in node:
            found = _find_event(v)
            if found:
                return found
    return None


def _price_from_offers(offers) -> tuple[bool, float]:
    """(gratuito, precio_cop) from a schema.org offers dict/list."""
    offers = offers if isinstance(offers, list) else [offers] if offers else []
    prices = []
    for o in offers:
        if not isinstance(o, dict):
            continue
        raw = o.get("price") or o.get("lowPrice") or 0
        try:
            p = float(raw)
        except (TypeError, ValueError):
            continue
        if (o.get("priceCurrency") or "").upper() == "USD":
            p *= USD_TO_COP
        prices.append(p)
    if not prices:
        return True, 0.0  # no offers advertised → treat as free, user can correct
    hi = max(prices)
    return hi == 0, hi


def _from_jsonld(html: str) -> dict | None:
    for block in _LDJSON_RE.findall(html):
        try:
            data = json.loads(block.strip())
        except (ValueError, TypeError):
            continue
        ev = _find_event(data)
        if not ev:
            continue
        gratuito, precio = _price_from_offers(ev.get("offers"))
        org = _first(ev.get("organizer"))
        org_name = org.get("name") if isinstance(org, dict) else (org or None)
        return {
            "titulo": ev.get("name"),
            "descripcion": ev.get("description"),
            "foto_url": _first(ev.get("image")),
            "fecha_inicio": ev.get("startDate"),
            "fecha_fin": ev.get("endDate"),
            "gratuito": gratuito,
            "precio": precio,
            "organizador": org_name,
            "url_externo": ev.get("url"),
        }
    return None


def _from_og(html: str) -> dict | None:
    og = {k.lower(): unescape(v) for k, v in _OG_RE.findall(html)}
    if not og.get("title"):
        return None
    return {
        "titulo": og.get("title"),
        "descripcion": og.get("description"),
        "foto_url": og.get("image"),
        "fecha_inicio": None,
        "fecha_fin": None,
        "gratuito": True,
        "precio": 0.0,
        "organizador": None,
        "url_externo": None,
    }


def parse_event_html(html: str, final_url: str) -> dict:
    data = _from_jsonld(html) or _from_og(html)
    if not data or not data.get("titulo"):
        raise ImportError_("No encontramos datos de evento en ese link")
    data.setdefault("url_externo", None)
    if not data["url_externo"]:
        data["url_externo"] = final_url
    # trim strings the front end re-validates/escapes anyway
    if data.get("descripcion"):
        data["descripcion"] = data["descripcion"][:2000]
    return data


async def import_event(url: str) -> dict:
    final_url, html = await _fetch(url)
    return parse_event_html(html, final_url)


if __name__ == "__main__":
    # SSRF guard rejects internal targets
    for bad in ("127.0.0.1", "localhost", "10.0.0.1", "169.254.169.254", "::1"):
        try:
            _assert_public_host(bad)
            raise AssertionError(f"SSRF guard let {bad} through")
        except ImportError_:
            pass

    # JSON-LD Event parses to the right fields
    sample = '''<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Event","name":"MDE Real Estate Investors",
     "startDate":"2026-11-11T17:30:00.000-05:00","endDate":"2026-11-11T21:00:00.000-05:00",
     "image":["https://img.example/cover.jpg"],"description":"Monthly meetup",
     "offers":[{"@type":"Offer","price":"20","priceCurrency":"USD"}],
     "organizer":[{"@type":"Organization","name":"MDE REI"}],"url":"https://luma.com/l0m9ep5d"}
    </script></head><body></body></html>'''
    out = parse_event_html(sample, "https://luma.com/l0m9ep5d")
    assert out["titulo"] == "MDE Real Estate Investors", out
    assert out["fecha_inicio"].startswith("2026-11-11"), out
    assert out["foto_url"] == "https://img.example/cover.jpg", out
    assert out["gratuito"] is False and out["precio"] == 20 * USD_TO_COP, out
    assert out["organizador"] == "MDE REI", out
    assert out["url_externo"] == "https://luma.com/l0m9ep5d", out

    # OG fallback when there's no Event JSON-LD
    og_html = '<meta property="og:title" content="Fiesta &amp; Baile"><meta property="og:image" content="https://img.example/f.jpg">'
    og = parse_event_html(og_html, "https://site.example/x")
    assert og["titulo"] == "Fiesta & Baile", og
    assert og["url_externo"] == "https://site.example/x", og

    print("event_import self-check OK")
