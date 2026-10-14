"""Pure classification of one fetch into ok | redirected | gone | blocked | error."""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from .config import Markers, norm_text

OK, REDIRECTED, GONE, BLOCKED, ERROR = "ok", "redirected", "gone", "blocked", "error"


@dataclass
class Fetch:
    """What the fetcher saw. status None = transport failure (timeout / DNS / TLS)."""
    status: int | None
    final_url: str | None = None
    body: str | None = None        # None when only HEAD was done
    error: str | None = None


@dataclass
class Verdict:
    result: str
    reason: str


def _path(url: str) -> str:
    return urlparse(url).path or "/"


def _norm_url(url: str) -> str:
    p = urlparse(url)
    return f"{(p.hostname or '').lower()}{p.path.rstrip('/')}"


def classify(original_url: str, f: Fetch, markers: Markers) -> Verdict:
    if f.status is None:
        return Verdict(ERROR, f.error or "transport error")
    s = f.status
    # Bot protection is never "gone": 401/403/429 and captcha pages.
    if s in (401, 403, 407, 429):
        return Verdict(BLOCKED, f"http {s}")
    body_n = norm_text(f.body) if f.body else ""
    if body_n and any(m in body_n for m in markers.blocked_texts()) and (s >= 400 or len(body_n) < 20_000):
        # captcha/challenge interstitials are short pages; long real pages that merely mention 'captcha' pass on.
        return Verdict(BLOCKED, "challenge page")
    if s in (404, 410):
        return Verdict(GONE, f"http {s}")
    if s >= 500:
        return Verdict(ERROR, f"http {s}")
    if s >= 400:
        return Verdict(ERROR, f"http {s}")
    if s < 200 or s >= 300:           # unresolved 3xx (redirect loop / limit hit)
        return Verdict(ERROR, f"http {s}")
    # 2xx from here on
    final = f.final_url or original_url
    redirected = _norm_url(final) != _norm_url(original_url)
    if redirected:
        path = _path(final)
        for pat in markers.index_patterns(final):
            if pat.search(path):
                return Verdict(GONE, f"redirected to index/home ({path})")
    if body_n:
        for m in markers.gone_texts(final):
            if m in body_n:
                return Verdict(GONE, f"marker: {m}")
    return Verdict(REDIRECTED if redirected else OK, "redirect to equivalent page" if redirected else "ok")
