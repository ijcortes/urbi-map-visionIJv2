"""Tests for POST /auth/google (Google Sign-In login/auto-register).

Unit tests mock httpx to verify _verify_google_id_token's validation logic
without hitting Google. HTTP tests (require_db) mock the verification helper
itself to drive the new-account / existing-account paths against a real DB.
"""
import pytest

import api.routers.auth as auth_mod
from api.routers.auth import _verify_google_id_token


class _FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json_data = json_data or {}

    def json(self):
        return self._json_data


def _fake_httpx(response):
    class FakeAsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **kwargs):
            return response

    class FakeHttpx:
        AsyncClient = FakeAsyncClient
        HTTPError = Exception

    return FakeHttpx


# ── _verify_google_id_token (unit, no DB) ───────────────────────────────────

async def test_verify_google_id_token_accepts_matching_aud(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "web-client-id")
    monkeypatch.setattr(auth_mod, "httpx", _fake_httpx(_FakeResponse(200, {
        "aud": "web-client-id", "sub": "1234", "email": "user@example.com", "email_verified": "true",
    })))

    claims = await _verify_google_id_token("fake-id-token")

    assert claims["email"] == "user@example.com"


async def test_verify_google_id_token_rejects_wrong_aud(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "web-client-id")
    monkeypatch.setattr(auth_mod, "httpx", _fake_httpx(_FakeResponse(200, {
        "aud": "some-other-app", "email": "user@example.com", "email_verified": "true",
    })))

    with pytest.raises(Exception) as exc_info:
        await _verify_google_id_token("fake-id-token")
    assert getattr(exc_info.value, "status_code", None) == 401


async def test_verify_google_id_token_rejects_unverified_email(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "web-client-id")
    monkeypatch.setattr(auth_mod, "httpx", _fake_httpx(_FakeResponse(200, {
        "aud": "web-client-id", "email": "user@example.com", "email_verified": "false",
    })))

    with pytest.raises(Exception) as exc_info:
        await _verify_google_id_token("fake-id-token")
    assert getattr(exc_info.value, "status_code", None) == 401


async def test_verify_google_id_token_rejects_bad_status(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "web-client-id")
    monkeypatch.setattr(auth_mod, "httpx", _fake_httpx(_FakeResponse(400, {"error": "invalid_token"})))

    with pytest.raises(Exception) as exc_info:
        await _verify_google_id_token("expired-or-bogus-token")
    assert getattr(exc_info.value, "status_code", None) == 401


# ── POST /auth/google (HTTP, require_db) ────────────────────────────────────

@pytest.mark.require_db
@pytest.mark.asyncio
async def test_google_login_creates_new_user(client, monkeypatch):
    email = "pytest_google_new@example.com"

    async def fake_verify(id_token):
        return {"sub": "sub-" + email, "email": email, "email_verified": "true", "given_name": "Pytest", "family_name": "Google"}

    monkeypatch.setattr(auth_mod, "_verify_google_id_token", fake_verify)

    r = await client.post("/api/v1/auth/google", json={"id_token": "whatever"})

    assert r.status_code == 200
    data = r.json()
    assert data["user"]["email"] == email
    assert data["user"]["nombre"] == "Pytest"
    assert "token" in data and data["token"]


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_google_login_existing_user_logs_in(client, monkeypatch):
    email = "pytest_google_existing@example.com"

    async def fake_verify(id_token):
        return {"sub": "sub-" + email, "email": email, "email_verified": "true", "given_name": "Pytest", "family_name": "Existing"}

    monkeypatch.setattr(auth_mod, "_verify_google_id_token", fake_verify)

    r1 = await client.post("/api/v1/auth/google", json={"id_token": "whatever"})
    assert r1.status_code == 200
    user_id_1 = r1.json()["user"]["id"]

    r2 = await client.post("/api/v1/auth/google", json={"id_token": "whatever-again"})
    assert r2.status_code == 200
    user_id_2 = r2.json()["user"]["id"]

    assert user_id_1 == user_id_2  # same account, no duplicate created


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_google_login_rejects_invalid_token(client, monkeypatch):
    from fastapi import HTTPException

    async def fake_verify(id_token):
        raise HTTPException(status_code=401, detail="Token de Google inválido")

    monkeypatch.setattr(auth_mod, "_verify_google_id_token", fake_verify)

    r = await client.post("/api/v1/auth/google", json={"id_token": "bogus"})

    assert r.status_code == 401
