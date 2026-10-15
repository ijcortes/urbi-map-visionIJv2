import os
import threading
import time
from collections import defaultdict, deque

from slowapi import Limiter
from starlette.requests import Request


def _trusted_proxy_count() -> int | None:
    """Number of trusted reverse-proxy hops in front of this app.

    TRUSTED_PROXY_COUNT=N (N >= 0) is read at request time:
      * 0  -> never trust X-Forwarded-For / X-Real-IP; key on the TCP peer.
      * N>0 -> the client IP is the entry N hops from the right of the chain
               (X-Forwarded-For entries + TCP peer), like Express "trust proxy N".
    Unset:
      * on Railway (RAILWAY_ENVIRONMENT set) -> None = legacy behaviour: Railway's
        edge overwrites client-supplied X-Real-IP / X-Forwarded-For (verified
        against prod, see _client_ip), so X-Real-IP is trusted.
      * anywhere else -> 0 (fail closed: headers are attacker-controlled).
    """
    raw = os.getenv("TRUSTED_PROXY_COUNT", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            return 0
    return None if os.getenv("RAILWAY_ENVIRONMENT") else 0


def _client_ip(request: Request) -> str:
    """Real client IP, trusting forwarded headers only from configured proxy hops.

    Railway context (why X-Real-IP is used when TRUSTED_PROXY_COUNT is unset
    there): uvicorn runs without --proxy-headers, so request.client.host is the
    platform proxy's pooled connection, not the caller; that made every
    @limiter.limit() a silent no-op in prod. Railway's X-Forwarded-For is
    "<real_client_ip>, <railway_internal_edge_ip>" (second value rotates per
    request) and X-Real-IP matches the first XFF value; Railway overwrites (not
    appends to) client-supplied values at its edge.
    """
    peer = request.client.host if request.client else "unknown"
    n = _trusted_proxy_count()
    if n == 0:
        return peer
    if n is None:  # Railway legacy mode
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
        return peer
    xff = request.headers.get("x-forwarded-for", "")
    chain = [p.strip() for p in xff.split(",") if p.strip()] + [peer]
    idx = len(chain) - 1 - n
    return chain[idx] if idx >= 0 else chain[0]


limiter = Limiter(key_func=_client_ip)


class KeyedThrottle:
    """Per-key sliding-window counter (e.g. per target email) for endpoints
    where the per-IP limit alone allows mail-bombing one victim from many IPs.

    In-process memory: with N workers the effective limit is N x max_events, and
    it resets on restart. That is acceptable for an anti-mailbomb cap; use Redis
    if a hard guarantee is needed.
    """

    def __init__(self, max_events: int, window_s: float, max_keys: int = 50_000):
        self.max_events = max_events
        self.window_s = window_s
        self.max_keys = max_keys
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > self.max_keys:
                for k in [k for k, d in self._hits.items() if not d or now - d[-1] > self.window_s]:
                    self._hits.pop(k, None)
            q = self._hits[key]
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.max_events:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    async def allow_shared(self, pool, key: str) -> bool:
        """Same rule, counted in Postgres (public.throttle_hits, migration 0111) so
        the cap holds across workers and restarts. Falls back to the in-process
        counter if the table/DB is unavailable (never blocks the request on it)."""
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    # serialize per key so two workers cannot both pass the last slot
                    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", key)
                    n = await conn.fetchval(
                        "SELECT COUNT(*) FROM public.throttle_hits "
                        "WHERE key = $1 AND hit_at > NOW() - make_interval(secs => $2)",
                        key, float(self.window_s),
                    )
                    if n >= self.max_events:
                        return False
                    await conn.execute("INSERT INTO public.throttle_hits (key) VALUES ($1)", key)
                    return True
        except Exception:
            return self.allow(key)

    async def count_shared(self, pool, key: str) -> int:
        """Hits for key inside the window (0 if the table is unavailable)."""
        try:
            return int(await pool.fetchval(
                "SELECT COUNT(*) FROM public.throttle_hits "
                "WHERE key = $1 AND hit_at > NOW() - make_interval(secs => $2)",
                key, float(self.window_s),
            ) or 0)
        except Exception:
            return 0

    async def hit_shared(self, pool, key: str) -> None:
        try:
            await pool.execute("INSERT INTO public.throttle_hits (key) VALUES ($1)", key)
        except Exception:
            pass


# Outgoing-mail throttles (per target email). Callers must answer uniformly
# (same response whether or not the mail was sent).
email_throttle = KeyedThrottle(max_events=3, window_s=3600)

# Per-account login lockout: after N failed passwords for one email in the window,
# further attempts are refused regardless of source IP (counted for unknown
# emails too, so the lockout itself is not an account-existence oracle).
login_fail_throttle = KeyedThrottle(max_events=10, window_s=15 * 60)


# View-count de-duplication: one counted view per (client IP, entity) per window.
# Stops anonymous callers from inflating the "vistas" shown to owners/realtors by
# looping on /track or /listings/{id}/vista (the per-IP rate limit only caps speed).
view_throttle = KeyedThrottle(max_events=1, window_s=30 * 60)
event_throttle = KeyedThrottle(max_events=1, window_s=5)


def client_ip(request: Request) -> str:
    return _client_ip(request)
