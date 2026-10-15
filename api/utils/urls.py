"""Shared URL validation for user-submitted link fields (event url_externo,
business website, etc.) — rejects javascript:/data: schemes that would
execute when rendered as <a href> or img src on the public site."""
import re
from urllib.parse import urlparse


_BAD_URL_CHARS = re.compile(r"[\x00-\x20\"'<>\\`]")


def require_safe_url(value: str | None) -> str | None:
    """http(s) only, with a host, and none of the characters that could break
    out of an HTML attribute / JS string if some client interpolates it."""
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL debe empezar con http:// o https://")
    if _BAD_URL_CHARS.search(value):
        raise ValueError("URL contiene caracteres no permitidos")
    return value


_TEXT_FORBIDDEN = re.compile(r"[<>\x00-\x08\x0b\x0c\x0e-\x1f]")


def require_plain_text(max_len: int):
    """Field validator factory for free-text fields rendered on public pages:
    strips, caps the length and rejects markup characters (< >) and control
    characters. Defense in depth: the frontend must still escape on output."""
    def _check(value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if _TEXT_FORBIDDEN.search(value):
            raise ValueError("Texto contiene caracteres no permitidos (< > o de control)")
        if len(value) > max_len:
            raise ValueError(f"Máximo {max_len} caracteres")
        return value or None
    return _check
