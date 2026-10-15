import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import httpx
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from pydantic import BaseModel, EmailStr, Field, field_validator

from api.db import get_pool
from api.dependencies import JWT_ALGORITHM, JWT_SECRET, get_current_user, token_key
from api.limiter import email_throttle, limiter, login_fail_throttle

_APP_URL = os.getenv("APP_URL", "https://medellinsocial.com")

_bearer = HTTPBearer()

router = APIRouter()

# Access-token lifetime. Env JWT_EXPIRY_HOURS (default 168 = 7 days; was 30 days; max 720).
# Sessions are also revoked server-side via usuarios.token_version (password
# reset / account merge) and the token_blacklist (logout / refresh).
def _jwt_expiry_hours() -> int:
    try:
        return min(720, max(1, int(os.getenv("JWT_EXPIRY_HOURS", "168"))))  # capped at 30 d (blacklist purge window)
    except ValueError:
        return 168


# Emails that can never be claimed through password registration (they can only
# be created by proving inbox ownership: Google sign-in or magic link).
def _reserved_emails() -> set[str]:
    out = {e.strip().lower() for e in os.getenv("RESERVED_EMAILS", "").split(",") if e.strip()}
    admin = os.getenv("ADMIN_EMAIL", "").strip().lower()
    if admin:
        out.add(admin)
    return out


# Used to burn the same bcrypt time when the email is unknown (login timing oracle).
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-timing", bcrypt.gensalt()).decode()
_REGISTER_MSG = "Si el correo es válido, te enviamos un enlace para confirmar tu cuenta."


# ── Models ────────────────────────────────────────────────────────────────────

def _normalizar_email(v: str) -> str:
    return v.strip().lower()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    telefono: Optional[str] = None
    origen: Optional[str] = None  # 'mls' | 'comunidad'

    _normalizar_email = field_validator("email")(_normalizar_email)


class RegisterResponse(BaseModel):
    ok: bool = True
    verification_required: bool = True
    message: str = _REGISTER_MSG


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    _normalizar_email = field_validator("email")(_normalizar_email)


class GoogleAuthRequest(BaseModel):
    id_token: str


class UserBasic(BaseModel):
    id: int
    email: str
    nombre: Optional[str]
    apellido: Optional[str]
    telefono: Optional[str] = None
    plan: Optional[str] = "free"
    es_agente: Optional[bool] = False
    perfil_busqueda: Optional[str] = None
    onboarding_completado: Optional[bool] = False
    origen_registro: Optional[str] = None


class AuthResponse(BaseModel):
    token: str
    user: UserBasic
    perfil_inversor: Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_token(user_id: int, token_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=_jwt_expiry_hours())
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "iat": now, "tv": int(token_version or 0),
         "jti": secrets.token_urlsafe(16)},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


async def _send_quietly(coro_fn, **kwargs) -> None:
    """Background mail send: never raises, response time does not depend on SMTP."""
    try:
        await coro_fn(**kwargs)
    except Exception:
        pass  # ponytail: silent — user can request resend later


async def _issue_verification(pool, user_id: int, to: str, nombre: str) -> None:
    from api.utils.email import send_verify_email

    verify_token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    await pool.execute(
        """INSERT INTO email_verification_tokens (usuario_id, token, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (usuario_id) DO UPDATE
               SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, used = FALSE""",
        user_id, verify_token, expires,
    )
    verify_url = f"{_APP_URL}/verify-email?token={verify_token}"
    await _send_quietly(send_verify_email, to=to, nombre=nombre, verify_url=verify_url)


async def _mark_verified_login(pool, user_id: int) -> int:  # pool or connection
    """Called when the caller just PROVED inbox ownership (Google / magic link /
    password-reset). Marks the email verified and returns the token_version to
    put in the new JWT.

    If the row was still UNVERIFIED, somebody may have pre-registered this email
    with a password they know (pre-hijack): that password is replaced by a random
    one and every previously issued token is revoked (token_version + 1).
    """
    return await pool.fetchval(
        """UPDATE usuarios SET
               last_login = NOW(),
               password_hash = CASE WHEN email_verificado THEN password_hash ELSE $2 END,
               token_version = CASE WHEN email_verificado THEN token_version ELSE token_version + 1 END,
               email_verificado = TRUE
           WHERE id = $1
           RETURNING token_version""",
        user_id, _hash_password(secrets.token_urlsafe(32)),
    )


async def _get_perfil(pool, user_id: int) -> Optional[dict]:
    row = await pool.fetchrow(
        "SELECT * FROM perfil_inversor WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1",
        user_id,
    )
    return dict(row) if row else None


_USER_SELECT = """SELECT id, email, nombre, apellido, activo, plan, google_sub,
                  perfil_busqueda, onboarding_completado, origen_registro,
                  EXISTS(SELECT 1 FROM agent a
                         WHERE a.usuario_id = usuarios.id
                           AND a.estado = 'activo') AS es_agente
           FROM usuarios"""

_GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


async def _verify_google_id_token(id_token: str) -> dict:
    """Validate a Google Identity Services id_token against Google's tokeninfo
    endpoint and return its claims. Raises 401 on any invalid/mismatched token.
    """
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            resp = await client.get(_GOOGLE_TOKENINFO_URL, params={"id_token": id_token})
        except httpx.HTTPError:
            raise HTTPException(status_code=401, detail="No se pudo verificar el token de Google")

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Token de Google inválido")

    claims = resp.json()
    if not client_id or claims.get("aud") != client_id:
        raise HTTPException(status_code=401, detail="Token de Google inválido")
    if claims.get("email_verified") not in ("true", True):
        raise HTTPException(status_code=401, detail="Correo de Google no verificado")
    if not claims.get("email") or not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Token de Google inválido")
    return claims


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=RegisterResponse, status_code=201)
@limiter.limit("3/minute")
async def register(request: Request, background: BackgroundTasks, req: RegisterRequest = Body(...)):
    """Create an UNVERIFIED account and e-mail a confirmation link. No token is
    issued: the account is unusable (login/API reject it) until the link is
    clicked. The response is identical whether the email is new, already
    registered, or reserved, so it is not an account oracle and an attacker
    cannot pre-register a victim's address into something usable."""
    pool = get_pool()
    # Always hash: equalises timing between the new-email and existing-email paths.
    password_hash = _hash_password(req.password)

    if req.email in _reserved_emails():
        return RegisterResponse()
    existing = await pool.fetchval("SELECT id FROM usuarios WHERE email = $1", req.email)
    if existing:
        return RegisterResponse()  # never touch an existing row from an anonymous call

    user_id = await pool.fetchval(
        """
        INSERT INTO usuarios (email, password_hash, nombre, apellido, telefono, origen_registro, email_verificado)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
        """,
        req.email, password_hash, req.nombre, req.apellido, req.telefono, req.origen,
    )
    if user_id is not None and await email_throttle.allow_shared(pool, f"verify:{req.email}"):
        background.add_task(_issue_verification, pool, user_id, req.email, req.nombre or "")
    return RegisterResponse()


class ResendVerificationRequest(BaseModel):
    email: EmailStr

    _normalizar_email = field_validator("email")(_normalizar_email)


@router.post("/resend-verification", status_code=200)
@limiter.limit("3/minute")
async def resend_verification(
    request: Request, background: BackgroundTasks, req: ResendVerificationRequest = Body(...),
):
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT id, nombre, email_verificado FROM usuarios WHERE email = $1", req.email
    )
    if row is not None and not row["email_verificado"] and await email_throttle.allow_shared(pool, f"verify:{req.email}"):
        background.add_task(_issue_verification, pool, row["id"], req.email, row["nombre"] or "")
    return {"message": _REGISTER_MSG}


@router.post("/login", response_model=AuthResponse)
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest = Body(...)):
    pool = get_pool()
    fail_key = f"login_fail:{req.email.strip().lower()}"
    if await login_fail_throttle.count_shared(pool, fail_key) >= login_fail_throttle.max_events:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos fallidos. Espera 15 minutos o restablece tu contraseña.",
            headers={"Retry-After": str(int(login_fail_throttle.window_s))},
        )
    row = await pool.fetchrow(
        """SELECT id, email, password_hash, nombre, apellido, activo, plan,
                  email_verificado, token_version, perfil_busqueda, onboarding_completado, origen_registro,
                  EXISTS(SELECT 1 FROM agent a
                         WHERE a.usuario_id = usuarios.id
                           AND a.estado = 'activo') AS es_agente
           FROM usuarios WHERE email = $1""",
        req.email,
    )
    # Always run one bcrypt comparison so an unknown email costs the same as a
    # wrong password (no timing oracle).
    pw_ok = _verify_password(
        req.password, row["password_hash"] if row is not None else _DUMMY_HASH
    )
    if row is None or not pw_ok:
        await login_fail_throttle.hit_shared(pool, fail_key)
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not row["activo"]:
        raise HTTPException(status_code=403, detail="Cuenta desactivada")
    if not row["email_verificado"]:
        # Only reachable by someone who knows the password, so it leaks nothing.
        raise HTTPException(
            status_code=403,
            detail="Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja o solicita un nuevo enlace.",
        )

    await pool.execute(
        "UPDATE usuarios SET last_login = NOW() WHERE id = $1", row["id"]
    )
    token = _make_token(row["id"], row["token_version"])
    perfil = await _get_perfil(pool, row["id"])
    return AuthResponse(
        token=token,
        user=UserBasic(
            id=row["id"], email=row["email"], nombre=row["nombre"], apellido=row["apellido"],
            plan=row["plan"], es_agente=row["es_agente"], perfil_busqueda=row["perfil_busqueda"],
            onboarding_completado=row["onboarding_completado"],
            origen_registro=row["origen_registro"],
        ),
        perfil_inversor=perfil,
    )


def _google_email_is_authoritative(claims: dict, email: str) -> bool:
    """True when Google itself is the authority on this mailbox, so a verified Google identity may be
    merged onto an existing row with the same address without a fresh inbox challenge: Gmail
    addresses, or a Workspace domain (`hd` claim equal to the email domain). For any other address
    `email_verified` can outlive the mailbox (domain/mailbox changed hands), see
    https://developers.google.com/identity/gsi/web/guides/verify-google-id-token"""
    domain = email.rsplit("@", 1)[-1]
    if domain in ("gmail.com", "googlemail.com"):
        return True
    hd = str(claims.get("hd") or "").lower()
    return bool(hd) and hd == domain


def _auth_response(row, token: str, perfil) -> "AuthResponse":
    return AuthResponse(
        token=token,
        user=UserBasic(
            id=row["id"], email=row["email"], nombre=row["nombre"], apellido=row["apellido"],
            plan=row["plan"], es_agente=row["es_agente"], perfil_busqueda=row["perfil_busqueda"],
            onboarding_completado=row["onboarding_completado"],
            origen_registro=row["origen_registro"],
        ),
        perfil_inversor=perfil,
    )


async def _issue_magic_link(pool, background: BackgroundTasks, email: str) -> None:
    from api.utils.email import send_magic_link

    if not await email_throttle.allow_shared(pool, f"magic:{email}"):
        return  # per-email cap (mail-bombing / token-clobber)
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)
    await pool.execute(
        """INSERT INTO magic_link_tokens (email, token, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE
               SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, used = FALSE""",
        email, token, expires,
    )
    login_url = f"{_APP_URL}/login/verificar?token={token}"
    background.add_task(_send_quietly, send_magic_link, to=email, login_url=login_url)


_GOOGLE_CHALLENGE_MSG = (
    "Para proteger tu cuenta te enviamos un enlace de acceso a tu correo. Ábrelo para continuar."
)


@router.post("/google", response_model=AuthResponse)
@limiter.limit("10/minute")
async def google_login(
    request: Request, background: BackgroundTasks, req: GoogleAuthRequest = Body(...),
):
    """Login or auto-register via Google Sign-In.

    Accounts are identified by Google's stable `sub` (persisted in usuarios.google_sub); once linked,
    that is all that authenticates a Google login. An e-mail match is only trusted to LINK a
    Google identity to a pre-existing row when Google is authoritative for the mailbox (Gmail /
    Workspace `hd`) and the address is not reserved (ADMIN_EMAIL). Anything else gets a 202 and a
    fresh magic link: a stale `email_verified=true` on a recycled third-party mailbox must not
    hand over an existing account."""
    claims = await _verify_google_id_token(req.id_token)
    email = _normalizar_email(claims["email"])
    sub = str(claims["sub"])
    pool = get_pool()

    row = await pool.fetchrow(_USER_SELECT + " WHERE google_sub = $1", sub)
    if row is not None:
        # Authenticated by the verified Google identity itself (the e-mail on Google's side may have changed).
        if not row["activo"]:
            raise HTTPException(status_code=403, detail="Cuenta desactivada")
        tv = await pool.fetchval(
            "UPDATE usuarios SET last_login = NOW() WHERE id = $1 RETURNING token_version", row["id"])
        return _auth_response(row, _make_token(row["id"], tv), await _get_perfil(pool, row["id"]))

    authoritative = _google_email_is_authoritative(claims, email) and email not in _reserved_emails()
    row = await pool.fetchrow(_USER_SELECT + " WHERE email = $1", email)
    if row is not None:
        if row["google_sub"] is not None or not authoritative:
            # Linked to a different Google identity, or the address cannot be trusted: prove the inbox.
            await _issue_magic_link(pool, background, email)
            return JSONResponse(
                status_code=202, content={"challenge": "email", "message": _GOOGLE_CHALLENGE_MSG})
        if not row["activo"]:
            raise HTTPException(status_code=403, detail="Cuenta desactivada")
        # Merge: link the sub, invalidating any password/tokens an impostor set on an unverified row.
        tv = await _mark_verified_login(pool, row["id"])
        await pool.execute(
            "UPDATE usuarios SET google_sub = $2 WHERE id = $1 AND google_sub IS NULL", row["id"], sub)
        return _auth_response(row, _make_token(row["id"], tv), await _get_perfil(pool, row["id"]))

    if email in _reserved_emails():
        await _issue_magic_link(pool, background, email)
        return JSONResponse(
            status_code=202, content={"challenge": "email", "message": _GOOGLE_CHALLENGE_MSG})

    user_id = await pool.fetchval(
        """
        INSERT INTO usuarios (email, password_hash, nombre, apellido, origen_registro, email_verificado, google_sub)
        VALUES ($1, $2, $3, $4, 'google', TRUE, $5)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        email, _hash_password(secrets.token_urlsafe(32)), claims.get("given_name"), claims.get("family_name"), sub,
    )
    if user_id is None:  # lost a race against another sign-in for the same identity: use the challenge
        await _issue_magic_link(pool, background, email)
        return JSONResponse(
            status_code=202, content={"challenge": "email", "message": _GOOGLE_CHALLENGE_MSG})
    row = await pool.fetchrow(_USER_SELECT + " WHERE id = $1", user_id)
    tv = await pool.fetchval("SELECT token_version FROM usuarios WHERE id = $1", user_id)
    return _auth_response(row, _make_token(user_id, tv), await _get_perfil(pool, user_id))


@router.get("/me", response_model=AuthResponse)
async def me(current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    perfil = await _get_perfil(pool, current_user["id"])
    return AuthResponse(
        token="",
        user=UserBasic(**{k: current_user[k] for k in (
            "id", "email", "nombre", "apellido", "plan", "es_agente",
            "perfil_busqueda", "onboarding_completado", "origen_registro",
        )}),
        perfil_inversor=perfil,
    )


class PerfilOnboardingRequest(BaseModel):
    perfil_busqueda: Optional[str] = None
    onboarding_completado: Optional[bool] = None
    origen_registro: Optional[str] = None


@router.patch("/perfil", status_code=200)
async def update_onboarding_perfil(
    req: PerfilOnboardingRequest = Body(...),
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    fields, params = [], [current_user["id"]]
    if req.perfil_busqueda is not None:
        params.append(req.perfil_busqueda)
        fields.append(f"perfil_busqueda = ${len(params)}")
    if req.onboarding_completado is not None:
        params.append(req.onboarding_completado)
        fields.append(f"onboarding_completado = ${len(params)}")
    if req.origen_registro is not None:
        params.append(req.origen_registro)
        fields.append(f"origen_registro = ${len(params)}")
    if not fields:
        return {"ok": True}
    await pool.execute(
        f"UPDATE usuarios SET {', '.join(fields)} WHERE id = $1",
        *params,
    )
    return {"ok": True}


@router.post("/logout", status_code=204)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    await pool.execute(
        "INSERT INTO token_blacklist (token, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        token_key(credentials.credentials), current_user["id"],
    )


@router.post("/refresh", response_model=AuthResponse)
@limiter.limit("10/minute")
async def refresh_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    current_user: dict = Depends(get_current_user),
):
    """Exchange a valid token for a fresh 30-day token. Old token is blacklisted."""
    pool = get_pool()
    # Atomic: only the request that actually revokes the old token may mint its successor.
    revoked = await pool.fetchval(
        "INSERT INTO token_blacklist (token, usuario_id) VALUES ($1, $2) "
        "ON CONFLICT DO NOTHING RETURNING id",
        token_key(credentials.credentials), current_user["id"],
    )
    if revoked is None:
        raise HTTPException(status_code=401, detail="Token revocado")
    new_token = _make_token(current_user["id"], current_user.get("token_version", 0))
    perfil = await _get_perfil(pool, current_user["id"])
    return AuthResponse(
        token=new_token,
        user=UserBasic(**{k: current_user[k] for k in (
            "id", "email", "nombre", "apellido", "plan", "es_agente",
            "perfil_busqueda", "onboarding_completado", "origen_registro",
        )}),
        perfil_inversor=perfil,
    )


# ── Email verification ────────────────────────────────────────────────────────

@router.get("/verify-email", status_code=200)
@limiter.limit("10/minute")
async def verify_email(request: Request, token: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Atomic single use: of N concurrent requests exactly one gets the row back.
            uid = await conn.fetchval(
                "UPDATE email_verification_tokens SET used = TRUE "
                "WHERE token = $1 AND used = FALSE AND expires_at > NOW() RETURNING usuario_id",
                token,
            )
            if uid is None:
                raise HTTPException(status_code=400, detail="Token inválido, expirado o ya utilizado")
            await conn.execute("UPDATE usuarios SET email_verificado = TRUE WHERE id = $1", uid)
    return {"ok": True, "message": "Correo verificado correctamente"}


# ── Password reset ─────────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    _normalizar_email = field_validator("email")(_normalizar_email)


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


@router.post("/forgot-password", status_code=200)
@limiter.limit("3/minute")
async def forgot_password(
    request: Request, background: BackgroundTasks, req: ForgotPasswordRequest = Body(...),
):
    from api.utils.email import send_reset_password
    pool = get_pool()
    user = await pool.fetchrow(
        "SELECT id, nombre FROM usuarios WHERE email = $1", req.email
    )
    # Always 200 — avoid email enumeration
    if user is None or not await email_throttle.allow_shared(pool, f"reset:{req.email}"):
        return {"message": "Si el correo existe recibirás instrucciones."}

    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    await pool.execute(
        """INSERT INTO password_reset_tokens (usuario_id, token, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (usuario_id) DO UPDATE
               SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, used = FALSE""",
        user["id"], token, expires,
    )
    reset_url = f"{_APP_URL}/reset-password?token={token}"
    background.add_task(
        _send_quietly, send_reset_password,
        to=req.email, nombre=user["nombre"] or "", reset_url=reset_url,
    )
    return {"message": "Si el correo existe recibirás instrucciones."}


@router.post("/reset-password", status_code=200)
@limiter.limit("5/minute")
async def reset_password(request: Request, req: ResetPasswordRequest = Body(...)):
    pool = get_pool()
    new_hash = _hash_password(req.new_password)
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Atomic single use: the token is consumed and the password changed in ONE transaction,
            # so two racing requests cannot both change the password.
            uid = await conn.fetchval(
                "UPDATE password_reset_tokens SET used = TRUE "
                "WHERE token = $1 AND used = FALSE AND expires_at > NOW() RETURNING usuario_id",
                req.token,
            )
            if uid is None:
                raise HTTPException(status_code=400, detail="Token inválido, expirado o ya utilizado")
            # The reset link went to the inbox, so it also proves ownership of
            # the email; token_version + 1 revokes every session issued before.
            await conn.execute(
                "UPDATE usuarios SET password_hash = $1, email_verificado = TRUE, "
                "token_version = token_version + 1 WHERE id = $2",
                new_hash, uid,
            )

    return {"message": "Contraseña actualizada correctamente"}


# ── Magic link (passwordless login) ─────────────────────────────────────────

class MagicLinkRequest(BaseModel):
    email: EmailStr

    _normalizar_email = field_validator("email")(_normalizar_email)


class MagicLinkVerifyRequest(BaseModel):
    token: str


@router.post("/magic-link", status_code=200)
@limiter.limit("3/minute")
async def request_magic_link(
    request: Request, background: BackgroundTasks, req: MagicLinkRequest = Body(...),
):
    """Send a one-click login link. Works whether or not the email is already
    registered — verifying it auto-creates the account, same trust model as
    Google Sign-In (a clicked link from their inbox proves email ownership)."""
    pool = get_pool()
    generic = {"message": "Si el correo existe o es válido, recibirás un link para ingresar."}
    await _issue_magic_link(pool, background, req.email)  # per-email throttle inside; same answer either way
    return generic


@router.post("/magic-link/verificar", response_model=AuthResponse)
@limiter.limit("10/minute")
async def verify_magic_link(request: Request, req: MagicLinkVerifyRequest = Body(...)):
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Atomic single use (see reset_password); the account mutation shares the transaction.
            email = await conn.fetchval(
                "UPDATE magic_link_tokens SET used = TRUE "
                "WHERE token = $1 AND used = FALSE AND expires_at > NOW() RETURNING email",
                req.token,
            )
            if email is None:
                raise HTTPException(status_code=400, detail="Link inválido, expirado o ya utilizado")
            user = await conn.fetchrow(_USER_SELECT + " WHERE email = $1", email)
            if user is None:
                user_id = await conn.fetchval(
                    """
                    INSERT INTO usuarios (email, password_hash, origen_registro, email_verificado)
                    VALUES ($1, $2, 'magic_link', TRUE)
                    RETURNING id
                    """,
                    email, _hash_password(secrets.token_urlsafe(32)),
                )
                user = await conn.fetchrow(_USER_SELECT + " WHERE id = $1", user_id)
            elif not user["activo"]:
                raise HTTPException(status_code=403, detail="Cuenta desactivada")
            tv = await _mark_verified_login(conn, user["id"])
    token = _make_token(user["id"], tv)
    perfil = await _get_perfil(pool, user["id"])
    return AuthResponse(
        token=token,
        user=UserBasic(
            id=user["id"], email=user["email"], nombre=user["nombre"], apellido=user["apellido"],
            plan=user["plan"], es_agente=user["es_agente"], perfil_busqueda=user["perfil_busqueda"],
            onboarding_completado=user["onboarding_completado"],
            origen_registro=user["origen_registro"],
        ),
        perfil_inversor=perfil,
    )
