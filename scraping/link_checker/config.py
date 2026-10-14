"""Settings + marker config for the link checker (env-overridable, no secrets)."""
from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

MARKERS_PATH = Path(__file__).with_name("markers.json")


def norm_text(s: str) -> str:
    """lowercase + strip accents so 'no está disponible' matches 'no esta disponible'."""
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    domain_delay: float = field(default_factory=lambda: _env_float("LINK_CHECK_DOMAIN_DELAY", 1.0))   # s between requests / domain
    domain_concurrency: int = field(default_factory=lambda: _env_int("LINK_CHECK_DOMAIN_CONCURRENCY", 1))
    timeout: float = field(default_factory=lambda: _env_float("LINK_CHECK_TIMEOUT", 15.0))
    retries: int = field(default_factory=lambda: _env_int("LINK_CHECK_RETRIES", 2))
    backoff_base: float = field(default_factory=lambda: _env_float("LINK_CHECK_BACKOFF", 2.0))
    max_redirects: int = 5
    max_body_bytes: int = 400_000
    strikes: int = field(default_factory=lambda: _env_int("LINK_CHECK_STRIKES", 2))            # consecutive 'gone' to confirm
    strike_gap_hours: float = field(default_factory=lambda: _env_float("LINK_CHECK_STRIKE_GAP_HOURS", 24.0))
    error_threshold: int = field(default_factory=lambda: _env_int("LINK_CHECK_ERROR_THRESHOLD", 3))  # consecutive errors -> status 'error'
    max_gone_pct: float = field(default_factory=lambda: _env_float("LINK_CHECK_MAX_GONE_PCT", 30.0))  # mass-gone brake
    brake_min_sample: int = field(default_factory=lambda: _env_int("LINK_CHECK_BRAKE_MIN_SAMPLE", 20))
    max_blocked_pct: float = field(default_factory=lambda: _env_float("LINK_CHECK_MAX_BLOCKED_PCT", 50.0))
    domain_block_abort: int = field(default_factory=lambda: _env_int("LINK_CHECK_DOMAIN_BLOCK_ABORT", 5))  # blocks in a row -> stop that domain this run
    alert_webhook: str = field(default_factory=lambda: os.getenv("LINK_CHECK_ALERT_WEBHOOK", ""))
    contact: str = field(default_factory=lambda: os.getenv("LINK_CHECK_CONTACT", ""))
    bot_url: str = field(default_factory=lambda: os.getenv("LINK_CHECK_BOT_URL", ""))

    @property
    def user_agent(self) -> str:
        parts = ["UrbiLinkChecker/1.0"]
        info = []
        if self.bot_url:
            info.append(f"+{self.bot_url}")
        if self.contact:
            info.append(f"contact: {self.contact}")
        return parts[0] + (f" ({'; '.join(info)})" if info else "")


class Markers:
    def __init__(self, data: dict | None = None):
        if data is None:
            data = json.loads(MARKERS_PATH.read_text(encoding="utf-8"))
        g = data.get("generic", {})
        self._generic_gone = [norm_text(x) for x in g.get("gone_text", [])]
        self._blocked = [norm_text(x) for x in g.get("blocked_text", [])]
        self._generic_index = [re.compile(x) for x in g.get("index_path_regex", [])]
        self._portals: dict[str, dict] = {}
        for dom, p in data.get("portals", {}).items():
            self._portals[dom] = {
                "label": p.get("label", dom),
                "needs_body": bool(p.get("needs_body", True)),
                "gone_text": [norm_text(x) for x in p.get("gone_text", [])],
                "index": [re.compile(x) for x in p.get("index_path_regex", [])],
            }

    def portal(self, url: str) -> dict:
        host = (urlparse(url).hostname or "").lower()
        for dom, p in self._portals.items():
            if host == dom or host.endswith("." + dom):
                return p
        return {"label": host, "needs_body": True, "gone_text": [], "index": []}

    def gone_texts(self, url: str) -> list[str]:
        return self._generic_gone + self.portal(url)["gone_text"]

    def index_patterns(self, url: str) -> list[re.Pattern]:
        return self._generic_index + self.portal(url)["index"]

    def blocked_texts(self) -> list[str]:
        return self._blocked

    def needs_body(self, url: str) -> bool:
        return self.portal(url)["needs_body"]
