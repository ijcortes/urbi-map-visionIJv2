from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException, status
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
    return f"jti:{jti}" if jti else _canonical_token(token)


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


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token requerido")
    return await _get_user_from_token(credentials.credentials)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[dict]:
    if credentials is None:
        return None
    try:
        return await _get_user_from_token(credentials.credentials)
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
