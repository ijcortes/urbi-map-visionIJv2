"""Anti-scraping guard: reject non-browser scraping tools on the API (pure ASGI).

robots.txt only deters polite crawlers; this blocks the common DIY scrapers
(curl / python-requests / scrapy / headless browsers ...) that ignore it, by
their User-Agent. Real browsers and search-engine crawlers (Googlebot, Bingbot)
never send these UAs, so the false-positive risk is low and SEO is preserved.

Per-IP request-rate limiting is NOT done here: it already exists per-route via
slowapi (@limiter.limit) on the heavy data endpoints (listings/viewport 120/min,
detail 100/min, ...). This middleware only adds the client-identity filter.

Env:
  ANTI_SCRAPE_DISABLED=1      turn the guard off entirely
  ANTI_SCRAPE_EXTRA_UAS=a,b   extra substrings to block (comma-separated)
"""
from __future__ import annotations

import json
import os

# Substrings matched case-insensitively against User-Agent. Non-browser HTTP
# clients and scraping frameworks. Deliberately NOT "googlebot"/"bingbot": those
# are allowed for indexing (option A). Google's renderer identifies as Googlebot,
# not HeadlessChrome, so blocking headless UAs does not hurt SEO.
#
# Deliberately NOT here: httpx / aiohttp / node-fetch / axios / okhttp — generic
# HTTP libraries common in legit backends, mobile apps and our own test harness
# (httpx sends "python-httpx/..."); the false-positive cost outweighs the catch.
# Those still face the per-route rate limits.
_BLOCKED_UA = (
    "python-requests", "python-urllib", "curl/", "wget", "scrapy",
    "go-http-client", "java/", "libwww-perl", "httpclient", "guzzle",
    "mechanize", "phantomjs", "headlesschrome", "puppeteer", "playwright",
    "selenium", "colly", "httrack",
)

# Path prefixes that legitimately receive non-browser clients (server-to-server),
# so the UA filter must not touch them. /health is the Railway probe.
_EXEMPT_PREFIXES = ("/health", "/api/v1/webhook", "/api/v1/ghl")


def _blocked_uas() -> tuple[str, ...]:
    extra = os.getenv("ANTI_SCRAPE_EXTRA_UAS", "")
    extra_list = tuple(s.strip().lower() for s in extra.split(",") if s.strip())
    return _BLOCKED_UA + extra_list


class AntiScrapeMiddleware:
    def __init__(self, app):
        self.app = app
        self.enabled = os.getenv("ANTI_SCRAPE_DISABLED", "").strip().lower() not in ("1", "true", "yes")
        self.blocked = _blocked_uas()

    async def __call__(self, scope, receive, send):
        if not self.enabled or scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path.startswith(_EXEMPT_PREFIXES):
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        ua = headers.get(b"user-agent", b"").decode("latin-1").lower()

        # ponytail: empty UA is NOT blocked — internal SSR/fetch clients and some
        # uptime probes send none; false positives there would break the site.
        # Explicit tool UAs only; empty-UA scrapers still hit the per-route limits.
        if ua and any(tok in ua for tok in self.blocked):
            await self._reject(send)
            return

        await self.app(scope, receive, send)

    async def _reject(self, send):
        body = json.dumps({"detail": "Automated access is not permitted."}).encode()
        await send({
            "type": "http.response.start",
            "status": 403,
            "headers": [
                (b"content-type", b"application/json"),
                (b"x-robots-tag", b"noai, noimageai"),
            ],
        })
        await send({"type": "http.response.body", "body": body})
