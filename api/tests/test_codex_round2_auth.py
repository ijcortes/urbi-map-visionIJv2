"""Regression tests for the codex round-2 review (auth part): JWT revocation by jti / canonical
signature, atomic one-time tokens, Google login by verified `sub`.

Run with a throwaway database:  pytest -m require_db api/tests/test_codex_round2_auth.py
"""
import asyncio
import time

import jwt
import pytest

from api.tests.test_security_fixes_db import (  # noqa: F401  (autouse fixtures + helpers)
    ADMIN, PW, _admin_email, _clean, _magic_login, _pool, _register, _reset_throttles,
)

pytestmark = [pytest.mark.require_db]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ── JWT: jti + canonical blacklist ───────────────────────────────────────────

def test_every_token_has_a_unique_jti_even_within_one_second():
    from api.routers.auth import _make_token
    from api.dependencies import JWT_SECRET
    toks = [_make_token(1, 0) for _ in range(5)]
    assert len(set(toks)) == 5                                   # same-second collision is gone
    jtis = {jwt.decode(t, JWT_SECRET, algorithms=["HS256"])["jti"] for t in toks}
    assert len(jtis) == 5


async def test_signature_padding_variant_is_revoked_with_the_token(client):
    email = "r2_pad@example.com"
    await _clean(email)
    tok = (await _magic_login(client, email))["token"]
    variant = tok + "="                                          # PyJWT still accepts this signature
    assert jwt.decode(variant, __import__("api.dependencies", fromlist=["x"]).JWT_SECRET, algorithms=["HS256"])
    assert (await client.get("/api/v1/auth/me", headers=_h(variant))).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=_h(tok))).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=_h(tok))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_h(variant))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", headers=_h(variant))).status_code == 401


async def test_legacy_token_without_jti_is_revoked_by_canonical_signature(client):
    from api.dependencies import JWT_SECRET
    email = "r2_legacy@example.com"
    await _clean(email)
    uid = (await _magic_login(client, email))["user"]["id"]
    exp = int(time.time()) + 3600
    legacy = jwt.encode({"sub": str(uid), "exp": exp, "iat": exp - 3600, "tv": 0}, JWT_SECRET, algorithm="HS256")
    assert (await client.get("/api/v1/auth/me", headers=_h(legacy))).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=_h(legacy + "="))).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=_h(legacy))).status_code == 401


async def test_refresh_never_returns_the_token_it_revoked(client):
    email = "r2_refresh@example.com"
    await _clean(email)
    tok = (await _magic_login(client, email))["token"]
    r = await client.post("/api/v1/auth/refresh", headers=_h(tok))      # same second as the login
    assert r.status_code == 200
    new = r.json()["token"]
    assert new != tok
    assert (await client.get("/api/v1/auth/me", headers=_h(tok))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_h(new))).status_code == 200
    # refreshing the revoked token twice never mints a second successor
    assert (await client.post("/api/v1/auth/refresh", headers=_h(tok))).status_code == 401


# ── atomic one-time tokens ───────────────────────────────────────────────────

async def test_magic_link_token_is_consumed_atomically(client):
    email = "r2_magic_race@example.com"
    await _clean(email)
    assert (await client.post("/api/v1/auth/magic-link", json={"email": email})).status_code == 200
    pool = await _pool()
    token = await pool.fetchval("SELECT token FROM magic_link_tokens WHERE email = $1", email)
    rs = await asyncio.gather(*[client.post("/api/v1/auth/magic-link/verificar", json={"token": token}) for _ in range(6)])
    assert sorted(r.status_code for r in rs).count(200) == 1
    assert all(r.status_code in (200, 400) for r in rs)


async def test_expired_magic_link_is_rejected_and_not_consumed_state_untouched(client):
    email = "r2_magic_exp@example.com"
    await _clean(email)
    await client.post("/api/v1/auth/magic-link", json={"email": email})
    pool = await _pool()
    await pool.execute("UPDATE magic_link_tokens SET expires_at = NOW() - interval '1 minute' WHERE email = $1", email)
    token = await pool.fetchval("SELECT token FROM magic_link_tokens WHERE email = $1", email)
    r = await client.post("/api/v1/auth/magic-link/verificar", json={"token": token})
    assert r.status_code == 400
    assert await pool.fetchval("SELECT COUNT(*) FROM usuarios WHERE email = $1", email) == 0


async def test_password_reset_token_changes_the_password_exactly_once(client):
    email = "r2_reset_race@example.com"
    await _clean(email)
    await _magic_login(client, email)
    await client.post("/api/v1/auth/forgot-password", json={"email": email})
    pool = await _pool()
    token = await pool.fetchval(
        "SELECT t.token FROM password_reset_tokens t JOIN usuarios u ON u.id = t.usuario_id WHERE u.email = $1", email)
    rs = await asyncio.gather(*[
        client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": f"Password-{i}-xxxx"})
        for i in range(5)])
    winners = [i for i, r in enumerate(rs) if r.status_code == 200]
    assert len(winners) == 1
    ok = await client.post("/api/v1/auth/login", json={"email": email, "password": f"Password-{winners[0]}-xxxx"})
    assert ok.status_code == 200
    tv = await pool.fetchval("SELECT token_version FROM usuarios WHERE email = $1", email)
    assert tv == 1                                                # bumped once, not once per request


async def test_email_verification_token_is_consumed_atomically(client):
    email = "r2_verify_race@example.com"
    await _clean(email)
    await _register(client, email)
    pool = await _pool()
    token = await pool.fetchval(
        "SELECT t.token FROM email_verification_tokens t JOIN usuarios u ON u.id = t.usuario_id WHERE u.email = $1", email)
    rs = await asyncio.gather(*[client.get("/api/v1/auth/verify-email", params={"token": token}) for _ in range(4)])
    assert sorted(r.status_code for r in rs) == [200, 400, 400, 400]


# ── Google login by verified sub ─────────────────────────────────────────────

def _fake_google(monkeypatch, **claims):
    from api.routers import auth as auth_mod

    async def fake(_t):
        return {"email_verified": "true", "given_name": "G", "family_name": "U", **claims}

    monkeypatch.setattr(auth_mod, "_verify_google_id_token", fake)


async def _google(client):
    return await client.post("/api/v1/auth/google", json={"id_token": "x"})


async def test_google_requires_sub_in_the_verified_token(monkeypatch):
    import httpx
    from api.routers import auth as auth_mod
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")

    class R:
        status_code = 200
        def json(self): return {"aud": "cid", "email": "a@gmail.com", "email_verified": "true"}   # no sub

    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return R()

    monkeypatch.setattr(auth_mod.httpx, "AsyncClient", C)
    with pytest.raises(Exception) as e:
        await auth_mod._verify_google_id_token("t")
    assert getattr(e.value, "status_code", None) == 401


async def test_google_login_authenticates_by_sub_not_by_email(client, monkeypatch):
    email, new_email = "r2_sub_a@example.com", "r2_sub_b@example.com"
    await _clean(email, new_email)
    _fake_google(monkeypatch, sub="sub-r2-1", email=email)
    r = await _google(client)
    assert r.status_code == 200
    uid = r.json()["user"]["id"]
    pool = await _pool()
    assert await pool.fetchval("SELECT google_sub FROM usuarios WHERE id = $1", uid) == "sub-r2-1"
    # same Google identity, but the address on the Google side changed hands: still the same account
    _fake_google(monkeypatch, sub="sub-r2-1", email=new_email)
    r = await _google(client)
    assert r.status_code == 200 and r.json()["user"]["id"] == uid and r.json()["user"]["email"] == email


async def test_third_party_email_does_not_take_over_an_existing_account(client, monkeypatch):
    email = "r2_victim@example.com"
    await _clean(email)
    victim = await _magic_login(client, email)                       # real, verified account
    _fake_google(monkeypatch, sub="sub-attacker", email=email)       # non-Gmail, no `hd`: stale email_verified
    r = await _google(client)
    assert r.status_code == 202 and "token" not in r.json() and r.json()["challenge"] == "email"
    pool = await _pool()
    assert await pool.fetchval("SELECT google_sub FROM usuarios WHERE email = $1", email) is None
    assert await pool.fetchval("SELECT COUNT(*) FROM magic_link_tokens WHERE email = $1 AND NOT used", email) == 1
    # the victim's sessions are untouched
    assert (await client.get("/api/v1/auth/me", headers=_h(victim["token"]))).status_code == 200


async def test_gmail_and_workspace_identities_merge_by_email_and_link_the_sub(client, monkeypatch):
    pool = await _pool()
    for email, extra in (("r2_merge@gmail.com", {}), ("r2_merge@corp-r2.example", {"hd": "corp-r2.example"})):
        await _clean(email)
        uid = (await _magic_login(client, email))["user"]["id"]
        _fake_google(monkeypatch, sub="sub-" + email, email=email, **extra)
        r = await _google(client)
        assert r.status_code == 200 and r.json()["user"]["id"] == uid
        assert await pool.fetchval("SELECT google_sub FROM usuarios WHERE id = $1", uid) == "sub-" + email


async def test_account_linked_to_another_google_identity_needs_a_challenge(client, monkeypatch):
    email = "r2_linked@gmail.com"
    await _clean(email)
    _fake_google(monkeypatch, sub="sub-owner", email=email)
    assert (await _google(client)).status_code == 200
    _fake_google(monkeypatch, sub="sub-other", email=email)
    assert (await _google(client)).status_code == 202


async def test_admin_email_never_gets_a_session_from_an_email_only_google_match(client, monkeypatch):
    await _clean(ADMIN)
    admin = await _magic_login(client, ADMIN)                        # legitimately seeded admin
    _fake_google(monkeypatch, sub="sub-fake-admin", email=ADMIN, hd="example.com")
    r = await _google(client)
    assert r.status_code == 202 and "token" not in r.json()
    pool = await _pool()
    assert await pool.fetchval("SELECT google_sub FROM usuarios WHERE email = $1", ADMIN) is None
    # and with no admin row at all, Google cannot create one either
    await _clean(ADMIN)
    r = await _google(client)
    assert r.status_code == 202
    assert await pool.fetchval("SELECT COUNT(*) FROM usuarios WHERE email = $1", ADMIN) == 0
    assert admin["token"]
