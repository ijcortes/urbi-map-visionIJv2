from __future__ import annotations

import hashlib
import os
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import PyJWTError

from api.db import get_pool

_bearer = HTTPBearer(auto_error=False)

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET or len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET env var requerida (mín 32 caracteres)")
JWT_ALGORITHM = "HS256"


def _canonical_token(token: str) -> str:
    """Canonical base64url form of the signature segment. PyJWT decodes the signature leniently
    (padding, non-zero trailing bits, stray characters are ignored), so several different strings
    carry the same valid signature; the blacklist must treat them as one token."""
    head, _, sig = token.rpartition(".")
    try:
        raw = jwt.utils.base64url_decode(sig.encode())
    except Exception:
        return token
    return f"{head}.{jwt.utils.base64url_encode(raw).decode()}"


def blacklist_key(token: str, payload: dict) -> str:
    """Revocation key of a token whose signature was ALREADY verified: its random jti, or, for
    tokens issued before jti existed, the canonicalised token string."""
    jti = payload.get("jti")
    if jti:
        return f"jti:{jti}"
    # Legacy (pre-jti) tokens: store a digest, never the bearer token itself, so a
    # read of token_blacklist does not hand out still-unexpired JWTs. Migration
    # 0111 rewrites existing clear-text rows into this same form.
    return "sha256:" + hashlib.sha256(_canonical_token(token).encode()).hexdigest()


def token_key(token: str) -> str:
    """blacklist_key() of a token; raises PyJWTError when the token does not verify."""
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub"]})
    return blacklist_key(token, payload)


async def _get_user_from_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub"]},
        )
        user_id = payload.get("sub")
        token_version = int(payload.get("tv", 0))
        user_id = int(user_id)
    except (PyJWTError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")

    pool = get_pool()
    # Check blacklist (by jti / canonical signature, not by the raw string the client sent)
    blacklisted = await pool.fetchval(
        "SELECT 1 FROM token_blacklist WHERE token = $1", blacklist_key(token, payload)
    )
    if blacklisted:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revocado")

    row = await pool.fetchrow(
        """SELECT id, email, nombre, apellido, activo, plan, email_verificado, token_version,
                  perfil_busqueda, onboarding_completado, origen_registro,
                  EXISTS(SELECT 1 FROM agent a
                         WHERE a.usuario_id = usuarios.id
                           AND a.estado = 'activo') AS es_agente
           FROM usuarios WHERE id = $1""",
        user_id,
    )
    if row is None or not row["activo"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no encontrado")
    # Session revocation: a password reset (or account merge) bumps token_version.
    if (row["token_version"] or 0) != token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revocado")
    # An account whose email was never proven is not a usable account (see auth.register).
    if not row["email_verificado"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Correo no verificado")

    return dict(row)


# ── Cookie sessions (opt-in) ───────────────────────────────────────────────────
# AUTH_COOKIE_MODE=1: the JWT also travels in an HttpOnly cookie, so page scripts
# (and any XSS) cannot read it. Needs the API on the same site as the web app
# (e.g. api.medellinsocial.com): browsers block third-party cookies, so with the
# API on *.up.railway.app the cookie would never be sent. Bearer keeps working.
AUTH_COOKIE_NAME = "ms_session"
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def auth_cookie_mode() -> bool:
    return os.getenv("AUTH_COOKIE_MODE", "").strip().lower() in ("1", "true", "yes")


def request_token(request: Request, credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[str]:
    """Bearer header first; otherwise the session cookie (cookie mode only).

    CSRF: a cookie is sent by the browser on its own, so cookie-authenticated
    writes must carry X-Requested-With. A custom header forces a CORS preflight,
    which only the configured origins pass."""
    if credentials is not None:
        return credentials.credentials
    if not auth_cookie_mode():
        return None
    tok = request.cookies.get(AUTH_COOKIE_NAME)
    if not tok:
        return None
    if request.method not in _SAFE_METHODS and not request.headers.get("x-requested-with"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Falta X-Requested-With")
    return tok


async def current_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    tok = request_token(request, credentials)
    if not tok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token requerido")
    return tok


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    tok = request_token(request, credentials)
    if not tok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token requerido")
    return await _get_user_from_token(tok)


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[dict]:
    try:
        tok = request_token(request, credentials)
        if not tok:
            return None
        return await _get_user_from_token(tok)
    except HTTPException:
        return None


_PLAN_ORDEN = ["free", "pro", "agente"]


def is_pro(user: Optional[dict]) -> bool:
    """True when user has plan pro or agente."""
    if not user:
        return False
    return (user.get("plan") or "free") in ("pro", "agente")


def is_agente(user: Optional[dict]) -> bool:
    """True when user is a sponsored/approved real-estate agent.

    Gates the only agent-exclusive map data: buena_oferta / pct_bajo_mediana.
    plan == 'agente' OR an approved row (estado='aprobado') in `agentes`.
    """
    if not user:
        return False
    return (user.get("plan") == "agente") or bool(user.get("es_agente"))


def require_plan(plan_minimo: str):
    """Factory: use as `Depends(require_plan("pro"))` on any route."""
    async def _check(current_user: dict = Depends(get_current_user)) -> dict:
        plan_usuario = current_user.get("plan") or "free"
        try:
            idx_req = _PLAN_ORDEN.index(plan_minimo)
            idx_usr = _PLAN_ORDEN.index(plan_usuario)
        except ValueError:
            idx_req, idx_usr = 1, 0

        if idx_usr < idx_req:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "plan_requerido",
                    "plan_actual": plan_usuario,
                    "plan_minimo": plan_minimo,
                    "upgrade_url": "/planes",
                },
            )
        return current_user
    return _check
