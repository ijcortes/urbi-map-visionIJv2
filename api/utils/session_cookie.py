"""Sets / clears the HttpOnly session cookie around the auth endpoints (AUTH_COOKIE_MODE=1).

Token-issuing endpoints keep returning the token in JSON (Bearer clients and
older frontends keep working); in cookie mode the same token is also written as
an HttpOnly, Secure cookie the page's JavaScript cannot read.
"""
from __future__ import annotations

import json
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from api.dependencies import AUTH_COOKIE_NAME, auth_cookie_mode

_ISSUE_PATHS = (
    "/api/v1/auth/login",
    "/api/v1/auth/google",
    "/api/v1/auth/refresh",
    "/api/v1/auth/magic-link/verificar",
)
_CLEAR_PATHS = ("/api/v1/auth/logout",)


def _cookie_kwargs() -> dict:
    hours = int(os.getenv("JWT_EXPIRY_HOURS", "168") or 168)
    samesite = os.getenv("AUTH_COOKIE_SAMESITE", "lax").strip().lower()
    kw = {
        "httponly": True,
        "secure": os.getenv("AUTH_COOKIE_INSECURE", "") != "1",  # only for local http testing
        "samesite": samesite if samesite in ("lax", "strict", "none") else "lax",
        "path": "/api",
        "max_age": max(1, min(hours, 24 * 30)) * 3600,
    }
    domain = os.getenv("AUTH_COOKIE_DOMAIN", "").strip()
    if domain:
        kw["domain"] = domain
    return kw


class SessionCookieMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if not auth_cookie_mode():
            return response
        path = request.url.path
        if path in _CLEAR_PATHS and response.status_code < 400:
            response.delete_cookie(AUTH_COOKIE_NAME, path="/api", domain=os.getenv("AUTH_COOKIE_DOMAIN") or None)
            return response
        if path not in _ISSUE_PATHS or response.status_code != 200:
            return response
        if "application/json" not in response.headers.get("content-type", ""):
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        new = Response(content=body, status_code=response.status_code, headers=headers,
                       media_type=response.media_type)
        try:
            token = json.loads(body).get("token")
        except Exception:
            token = None
        if token:
            new.set_cookie(AUTH_COOKIE_NAME, token, **_cookie_kwargs())
        return new
