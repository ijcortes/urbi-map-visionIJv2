"""DB-backed regression tests for H1, H2, M3, M4, M6, M7 of the 2026-10 security report.

Run with a throwaway database:  pytest -m require_db api/tests/test_security_fixes_db.py
"""
import pytest

from api.limiter import email_throttle, event_throttle, view_throttle

pytestmark = [pytest.mark.require_db, pytest.mark.asyncio]

PW = "Attacker-pass-123"
ADMIN = "sec-admin@example.com"


@pytest.fixture(autouse=True)
def _admin_email(monkeypatch):
    # conftest's default admin@test.local is not a valid EmailStr; use a routable one.
    import api.routers.admin as admin_mod
    monkeypatch.setattr(admin_mod, "ADMIN_EMAIL", ADMIN)
    monkeypatch.setenv("ADMIN_EMAIL", ADMIN)


@pytest.fixture(autouse=True)
def _reset_throttles():
    for t in (email_throttle, view_throttle, event_throttle):
        t.reset()
    yield


async def _pool():
    from api.db import get_pool
    return get_pool()


async def _clean(*emails):
    pool = await _pool()
    await pool.execute("DELETE FROM agent WHERE email = ANY($1)", list(emails))
    await pool.execute("DELETE FROM usuarios WHERE email = ANY($1)", list(emails))


async def _register(client, email, pw=PW):
    return await client.post("/api/v1/auth/register", json={"email": email, "password": pw, "nombre": "X"})


async def _magic_login(client, email):
    r = await client.post("/api/v1/auth/magic-link", json={"email": email})
    assert r.status_code == 200
    pool = await _pool()
    token = await pool.fetchval("SELECT token FROM magic_link_tokens WHERE email = $1", email)
    r = await client.post("/api/v1/auth/magic-link/verificar", json={"token": token})
    assert r.status_code == 200
    return r.json()


# ── H1 ───────────────────────────────────────────────────────────────────────

async def test_register_issues_no_session_and_login_is_blocked_until_verified(client):
    email = "sec_h1_a@example.com"
    await _clean(email)
    r = await _register(client, email)
    assert r.status_code == 201
    body = r.json()
    assert "token" not in body and "user" not in body and body["verification_required"] is True

    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 403

    pool = await _pool()
    assert await pool.fetchval("SELECT email_verificado FROM usuarios WHERE email = $1", email) is False
    # the emailed link flips it
    tok = await pool.fetchval(
        "SELECT t.token FROM email_verification_tokens t JOIN usuarios u ON u.id = t.usuario_id WHERE u.email = $1", email)
    assert tok
    assert (await client.get("/api/v1/auth/verify-email", params={"token": tok})).status_code == 200
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200 and r.json()["token"]


async def test_legacy_unverified_token_is_rejected_by_the_api(client):
    from api.routers.auth import _make_token
    email = "sec_h1_legacy@example.com"
    await _clean(email)
    pool = await _pool()
    uid = await pool.fetchval(
        "INSERT INTO usuarios (email, password_hash, email_verificado) VALUES ($1, 'x', FALSE) RETURNING id", email)
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {_make_token(uid)}"})
    assert r.status_code == 401


async def test_pre_hijack_password_is_dead_after_victim_signs_in_with_magic_link(client):
    email = "sec_h1_victim@example.com"
    await _clean(email)
    await _register(client, email, "Attacker-pass-123")           # attacker pre-registers victim's email
    pool = await _pool()
    # attacker also manages to get a session (e.g. via an old token) -> simulate
    from api.routers.auth import _make_token
    uid = await pool.fetchval("SELECT id FROM usuarios WHERE email = $1", email)
    attacker_token = _make_token(uid, 0)

    victim = await _magic_login(client, email)                    # victim proves inbox ownership
    assert victim["user"]["id"] == uid

    r = await client.post("/api/v1/auth/login", json={"email": email, "password": "Attacker-pass-123"})
    assert r.status_code == 401                                   # attacker's password invalidated
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {attacker_token}"})
    assert r.status_code == 401                                   # attacker's session revoked
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {victim['token']}"})
    assert r.status_code == 200                                   # victim's session works


async def test_pre_hijack_password_is_dead_after_google_login(client, monkeypatch):
    from api.routers import auth as auth_mod
    email = "sec_h1_google@example.com"
    await _clean(email)
    await _register(client, email)

    async def fake(_t):
        return {"email": email, "given_name": "V", "family_name": "V"}

    monkeypatch.setattr(auth_mod, "_verify_google_id_token", fake)
    r = await client.post("/api/v1/auth/google", json={"id_token": "x"})
    assert r.status_code == 200
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 401


async def test_password_reset_revokes_existing_sessions_and_verifies(client):
    email = "sec_m6@example.com"
    await _clean(email)
    pool = await _pool()
    from api.routers.auth import _hash_password
    await pool.execute(
        "INSERT INTO usuarios (email, password_hash, email_verificado) VALUES ($1, $2, TRUE)", email, _hash_password(PW))
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    old = r.json()["token"]
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old}"})).status_code == 200

    await client.post("/api/v1/auth/forgot-password", json={"email": email})
    rt = await pool.fetchval(
        "SELECT t.token FROM password_reset_tokens t JOIN usuarios u ON u.id=t.usuario_id WHERE u.email=$1", email)
    r = await client.post("/api/v1/auth/reset-password", json={"token": rt, "new_password": "Brand-new-pass-1"})
    assert r.status_code == 200
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old}"})).status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": "Brand-new-pass-1"})
    assert r.status_code == 200


async def test_agent_row_takeover_via_registro_is_refused(client):
    email = "sec_h1_agent@example.com"
    await _clean(email, "sec_h1_agent_owner@example.com")
    pool = await _pool()
    owner = await pool.fetchval(
        "INSERT INTO usuarios (email, password_hash, email_verificado) VALUES ($1,'x',TRUE) RETURNING id",
        "sec_h1_agent_owner@example.com")
    agent_id = await pool.fetchval(
        "INSERT INTO agent (usuario_id, email, nombre, telefono, estado) VALUES ($1,$2,'Real','3000000000','activo') RETURNING id",
        owner, email)
    # someone else controls a verified account with that email (e.g. changed owner) -> still cannot repoint
    me = await _magic_login(client, email)
    r = await client.post("/api/v1/suscripciones/agente/registro",
                          json={"nombre": "Mallory", "telefono": "1"},
                          headers={"Authorization": f"Bearer {me['token']}"})
    assert r.status_code == 409
    row = await pool.fetchrow("SELECT usuario_id, nombre FROM agent WHERE id = $1", agent_id)
    assert row["usuario_id"] == owner and row["nombre"] == "Real"


async def test_agent_registro_links_an_unlinked_row_only_for_verified_owner(client):
    email = "sec_h1_agent2@example.com"
    await _clean(email)
    pool = await _pool()
    await pool.execute("INSERT INTO agent (usuario_id, email, nombre, telefono) VALUES (NULL,$1,'Imported','1')", email)
    me = await _magic_login(client, email)  # verified owner of the email
    r = await client.post("/api/v1/suscripciones/agente/registro",
                          json={"nombre": "Owner", "telefono": "2"}, headers={"Authorization": f"Bearer {me['token']}"})
    assert r.status_code == 200
    assert await pool.fetchval("SELECT usuario_id FROM agent WHERE email=$1", email) == me["user"]["id"]


# ── H2 ───────────────────────────────────────────────────────────────────────

async def test_admin_email_cannot_be_registered_with_a_password(client):
    await _clean(ADMIN)
    r = await _register(client, ADMIN)
    assert r.status_code == 201                                   # uniform answer...
    pool = await _pool()
    assert await pool.fetchval("SELECT COUNT(*) FROM usuarios WHERE email = $1", ADMIN) == 0   # ...but nothing created
    assert (await client.post("/api/v1/auth/login", json={"email": ADMIN, "password": PW})).status_code == 401


async def test_admin_access_needs_verified_seeded_row(client):
    await _clean(ADMIN)
    pool = await _pool()
    from api.routers.auth import _make_token
    uid = await pool.fetchval(
        "INSERT INTO usuarios (email, password_hash, email_verificado) VALUES ($1,'x',FALSE) RETURNING id", ADMIN)
    h = {"Authorization": f"Bearer {_make_token(uid)}"}
    assert (await client.get("/api/v1/admin/dashboard", headers=h)).status_code in (401, 403)   # unverified: closed
    admin = await _magic_login(client, ADMIN)                     # proves inbox -> verified
    r = await client.get("/api/v1/admin/dashboard", headers={"Authorization": f"Bearer {admin['token']}"})
    assert r.status_code != 403 and r.status_code != 401
    # and a non-admin verified user is still refused
    other = await _magic_login(client, "sec_h2_other@example.com")
    r = await client.get("/api/v1/admin/dashboard", headers={"Authorization": f"Bearer {other['token']}"})
    assert r.status_code == 403


# ── M3 ───────────────────────────────────────────────────────────────────────

async def test_register_response_is_identical_for_new_and_existing_email(client):
    email = "sec_m3@example.com"
    await _clean(email)
    first = await _register(client, email)
    second = await _register(client, email, "Another-pass-999")
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    # the second call must not have touched the existing row's password
    pool = await _pool()
    from api.routers.auth import _verify_password
    h = await pool.fetchval("SELECT password_hash FROM usuarios WHERE email=$1", email)
    assert _verify_password(PW, h) and not _verify_password("Another-pass-999", h)


async def test_suscribirse_does_not_leak_ids_or_existence(client):
    email = "sec_m3_sub@example.com"
    await _clean(email)
    pool = await _pool()
    if not await pool.fetchval(
        "SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='rol'"
    ):
        pytest.skip("usuarios.rol missing in this DB (schema drift, unrelated to this fix)")
    a = await client.post("/api/v1/usuario/suscribirse", json={"nombre": "A", "email": email})
    b = await client.post("/api/v1/usuario/suscribirse", json={"nombre": "A", "email": email})
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json() == {"success": True}


async def test_login_unknown_and_wrong_password_are_the_same_401(client):
    email = "sec_m3_login@example.com"
    await _clean(email)
    pool = await _pool()
    from api.routers.auth import _hash_password
    await pool.execute("INSERT INTO usuarios (email,password_hash,email_verificado) VALUES ($1,$2,TRUE)", email, _hash_password(PW))
    a = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-wrong-1"})
    b = await client.post("/api/v1/auth/login", json={"email": "nobody_sec@example.com", "password": "wrong-wrong-1"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


# ── M4 ───────────────────────────────────────────────────────────────────────

async def test_per_email_throttle_on_magic_link_and_forgot_password(client):
    email = "sec_m4@example.com"
    await _clean(email)
    pool = await _pool()
    for _ in range(3):
        assert (await client.post("/api/v1/auth/magic-link", json={"email": email})).status_code == 200
    t1 = await pool.fetchval("SELECT token FROM magic_link_tokens WHERE email=$1", email)
    r = await client.post("/api/v1/auth/magic-link", json={"email": email})
    assert r.status_code == 200                                       # same answer...
    assert await pool.fetchval("SELECT token FROM magic_link_tokens WHERE email=$1", email) == t1  # ...but no new token/mail

    await pool.execute("INSERT INTO usuarios (email,password_hash,email_verificado) VALUES ($1,'x',TRUE)", email)
    for _ in range(3):
        await client.post("/api/v1/auth/forgot-password", json={"email": email})
    r1 = await pool.fetchval("SELECT token FROM password_reset_tokens t JOIN usuarios u ON u.id=t.usuario_id WHERE u.email=$1", email)
    r = await client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert r.status_code == 200
    assert await pool.fetchval("SELECT token FROM password_reset_tokens t JOIN usuarios u ON u.id=t.usuario_id WHERE u.email=$1", email) == r1


# ── H3 (server side) ─────────────────────────────────────────────────────────

async def test_mi_negocio_rejects_xss_payloads(client):
    me = await _magic_login(client, "sec_h3@example.com")
    h = {"Authorization": f"Bearer {me['token']}"}
    bad = {"nombre": "<img src=x onerror=alert(1)>", "categoria": "cafe"}
    assert (await client.post("/api/v1/business/mi-negocio", json=bad, headers=h)).status_code == 422
    bad = {"nombre": "Ok", "categoria": "cafe", "website": "javascript:alert(1)"}
    assert (await client.post("/api/v1/business/mi-negocio", json=bad, headers=h)).status_code == 422


# ── M7 ───────────────────────────────────────────────────────────────────────

async def test_track_listing_view_is_deduplicated_per_ip_and_entity(client, monkeypatch):
    from api.routers import tracking

    real = tracking.get_pool()
    inserts = []

    class Spy:
        async def execute(self, sql, *a):
            if "INSERT INTO public.user_events" in sql:
                inserts.append(a)
            return None  # no partition/table dependency

    monkeypatch.setattr(tracking, "get_pool", lambda: Spy())
    ev = {"session_id": "sec-m7", "event_type": "listing_view", "entity_type": "listing", "entity_id": "https://x/y"}
    for _ in range(5):
        assert (await client.post("/api/v1/track", json=ev)).status_code == 200
    assert len(inserts) == 1
    other = dict(ev, entity_id="https://x/z")
    await client.post("/api/v1/track", json=other)
    assert len(inserts) == 2          # a different listing still counts
    assert real is not None


async def test_track_and_oversized_body_are_capped(client):
    big = {"session_id": "s", "event_type": "t", "metadata": {"k": "v" * 6000}}
    assert (await client.post("/api/v1/track", json=big)).status_code == 422
    huge = b'{"session_id":"s","event_type":"t","metadata":{"k":"' + b"v" * (2 * 1024 * 1024) + b'"}}'
    r = await client.post("/api/v1/track", content=huge, headers={"content-type": "application/json"})
    assert r.status_code == 413
