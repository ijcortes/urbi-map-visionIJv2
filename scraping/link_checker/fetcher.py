"""Polite async fetching: per-domain pacing, HEAD then GET, retries with backoff."""
from __future__ import annotations

import asyncio
import logging
import time
from urllib.parse import urlparse

import httpx

from .classify import Fetch, classify, Verdict, BLOCKED
from .config import Markers, Settings

log = logging.getLogger(__name__)


class DomainPacer:
    """Max `concurrency` in-flight requests per domain and >= `delay` seconds between request starts."""

    def __init__(self, delay: float, concurrency: int):
        self.delay, self.concurrency = delay, max(1, concurrency)
        self._sems: dict[str, asyncio.Semaphore] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._next: dict[str, float] = {}
        self.blocked_streak: dict[str, int] = {}

    def _get(self, d: str):
        if d not in self._sems:
            self._sems[d] = asyncio.Semaphore(self.concurrency)
            self._locks[d] = asyncio.Lock()
        return self._sems[d], self._locks[d]

    async def slot(self, domain: str):
        sem, lock = self._get(domain)
        await sem.acquire()
        async with lock:
            wait = self._next.get(domain, 0.0) - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._next[domain] = time.monotonic() + self.delay
        return sem

    def note(self, domain: str, blocked: bool) -> None:
        self.blocked_streak[domain] = (self.blocked_streak.get(domain, 0) + 1) if blocked else 0


def _domain(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


class LinkFetcher:
    def __init__(self, cfg: Settings, markers: Markers, client: httpx.AsyncClient | None = None):
        self.cfg, self.markers = cfg, markers
        self.pacer = DomainPacer(cfg.domain_delay, cfg.domain_concurrency)
        self._own = client is None
        self.client = client or httpx.AsyncClient(
            headers={"User-Agent": cfg.user_agent, "Accept": "text/html,*/*;q=0.8",
                     "Accept-Language": "es-CO,es;q=0.9,en;q=0.5"},
            timeout=cfg.timeout, follow_redirects=True,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
        self.client.max_redirects = cfg.max_redirects
        self.aborted_domains: set[str] = set()

    async def aclose(self):
        if self._own:
            await self.client.aclose()

    async def _once(self, method: str, url: str) -> Fetch:
        dom = _domain(url)
        sem = await self.pacer.slot(dom)
        try:
            if method == "HEAD":
                r = await self.client.head(url)
                return Fetch(r.status_code, str(r.url), None)
            async with self.client.stream("GET", url) as r:
                chunks, n = [], 0
                async for c in r.aiter_bytes():
                    chunks.append(c)
                    n += len(c)
                    if n >= self.cfg.max_body_bytes:
                        break
                body = b"".join(chunks).decode(r.encoding or "utf-8", errors="replace")
                return Fetch(r.status_code, str(r.url), body)
        except httpx.TimeoutException as e:
            return Fetch(None, error=f"timeout: {type(e).__name__}")
        except httpx.TooManyRedirects:
            return Fetch(310, error="too many redirects")
        except httpx.HTTPError as e:
            return Fetch(None, error=f"{type(e).__name__}: {e}"[:200])
        finally:
            sem.release()

    async def _retrying(self, method: str, url: str) -> Fetch:
        f = await self._once(method, url)
        attempt = 0
        # retry only transient failures (transport error / 5xx); 4xx and blocks are final
        while (f.status is None or f.status >= 500) and attempt < self.cfg.retries:
            await asyncio.sleep(self.cfg.backoff_base * (2 ** attempt))
            attempt += 1
            f = await self._once(method, url)
        return f

    async def check(self, url: str) -> tuple[Verdict, Fetch]:
        dom = _domain(url)
        if dom in self.aborted_domains:
            return Verdict("skipped", "domain aborted for this run (repeated blocks)"), Fetch(None)
        if self.markers.needs_body(url):
            # soft-404 portals answer HEAD 200 for dead listings: HEAD would only double the request load
            f = await self._retrying("GET", url)
            v = classify(url, f, self.markers)
        else:
            f = await self._retrying("HEAD", url)
            v = classify(url, f, self.markers)
            if f.status is None or f.status >= 400 or f.status == 405 or v.result != "ok":
                f = await self._retrying("GET", url)       # confirm with GET before believing HEAD
                v = classify(url, f, self.markers)
        blocked = v.result == BLOCKED
        self.pacer.note(dom, blocked)
        if self.pacer.blocked_streak.get(dom, 0) >= self.cfg.domain_block_abort:
            self.aborted_domains.add(dom)
            log.warning("domain %s: %d consecutive blocks, aborting it for this run", dom, self.cfg.domain_block_abort)
        return v, f
