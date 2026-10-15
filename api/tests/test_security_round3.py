"""Regression tests for the ALL-ISSUES round-3 fixes (no DB needed)."""
import hashlib

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from api import limiter as lim
from api.dependencies import JWT_ALGORITHM, JWT_SECRET, blacklist_key
from api.utils.pii import mask_email


def test_mask_email():
    assert mask_email("juana.perez@gmail.com") == "j***@gmail.com"
    assert mask_email(None) == "***"
    assert mask_email("not-an-email") == "***"


def test_legacy_blacklist_key_is_a_digest_not_the_token():
    tok = jwt.encode({"sub": "1", "exp": 4102444800}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    key = blacklist_key(tok, {"sub": "1"})
    assert key.startswith("sha256:") and tok not in key
    assert len(key) == len("sha256:") + 64
    assert blacklist_key(tok, {"jti": "abc"}) == "jti:abc"


def test_validation_errors_do_not_echo_input():
    from api.main import _validation_error_handler
    from fastapi.exceptions import RequestValidationError

    app = FastAPI()
    app.add_exception_handler(RequestValidationError, _validation_error_handler)

    class Body(BaseModel):
        n: int

    @app.post("/x")
    async def x(b: Body):
        return b

    r = TestClient(app).post("/x", json={"n": "s3cret-password"})
    assert r.status_code == 422
    assert "s3cret-password" not in r.text
    assert r.json()["detail"][0]["loc"] == ["body", "n"]


def test_cors_origin_regex_is_opt_in_in_prod(monkeypatch):
    import api.main as m
    monkeypatch.delenv("CORS_ORIGIN_REGEX", raising=False)
    monkeypatch.setattr(m, "_IS_PROD", True)
    assert m._build_origin_regex() is None
    monkeypatch.setenv("CORS_ORIGIN_REGEX", r"https://preview\.example\.com")
    assert m._build_origin_regex() == r"https://preview\.example\.com"


@pytest.mark.asyncio
async def test_shared_throttle_falls_back_to_memory_without_db():
    class NoDB:
        def acquire(self):
            raise RuntimeError("no db")

        async def fetchval(self, *a):
            raise RuntimeError("no db")

    t = lim.KeyedThrottle(max_events=2, window_s=60)
    assert await t.allow_shared(NoDB(), "k")
    assert await t.allow_shared(NoDB(), "k")
    assert not await t.allow_shared(NoDB(), "k")
    assert await t.count_shared(NoDB(), "k") == 0  # unknown -> never locks anyone out


def test_ghl_leads_accepts_any_of_rotated_tokens(monkeypatch):
    from fastapi import HTTPException
    from starlette.requests import Request
    from api.routers.ghl_leads import require_ghl_token

    req = Request({"type": "http", "headers": [], "client": ("1.1.1.1", 1), "method": "GET", "path": "/"})
    monkeypatch.delenv("GHL_LEADS_ALLOWED_IPS", raising=False)
    monkeypatch.setenv("GHL_LEADS_TOKEN", "old-token-aaaa, new-token-bbbb")
    require_ghl_token(req, "old-token-aaaa")
    require_ghl_token(req, "new-token-bbbb")
    with pytest.raises(HTTPException) as e:
        require_ghl_token(req, "nope")
    assert e.value.status_code == 401
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", "0")
    monkeypatch.setenv("GHL_LEADS_ALLOWED_IPS", "2.2.2.2")
    with pytest.raises(HTTPException) as e:
        require_ghl_token(req, "new-token-bbbb")
    assert e.value.status_code == 403
