import pytest
from fastapi import HTTPException

from api.utils.storage import MAX_UPLOAD_BYTES, read_upload_bounded, validate_image_upload

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20
JPG = b"\xff\xd8\xff\xe0" + b"0" * 20


def test_upload_accepts_real_images_by_magic_bytes():
    assert validate_image_upload(PNG) == ".png"
    assert validate_image_upload(JPG) == ".jpg"
    assert validate_image_upload(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == ".webp"


@pytest.mark.parametrize("payload", [b"<svg onload=alert(1)>", b"<html></html>", b"MZ\x90\x00", b""])
def test_upload_rejects_non_images(payload):
    with pytest.raises(HTTPException) as e:
        validate_image_upload(payload)
    assert e.value.status_code == 415


def test_upload_rejects_oversize():
    with pytest.raises(HTTPException) as e:
        validate_image_upload(PNG + b"0" * MAX_UPLOAD_BYTES)
    assert e.value.status_code == 413


def test_prod_hides_docs_and_dev_origins(monkeypatch):
    import importlib
    import api.main as m
    monkeypatch.delenv("EXPOSE_DOCS", raising=False)
    # Fail closed: neither ENV nor RAILWAY_ENVIRONMENT set -> production behaviour.
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    m2 = importlib.reload(m)
    try:
        assert m2.app.docs_url is None and m2.app.openapi_url is None
        assert "http://localhost:3000" not in m2._build_origins()
        # A Railway env literally named "development" must NOT open docs either.
        monkeypatch.setenv("RAILWAY_ENVIRONMENT", "development")
        m3 = importlib.reload(m)
        assert m3.app.docs_url is None
        # Dev behaviour only when ENV=dev is explicit.
        monkeypatch.setenv("ENV", "dev")
        m4 = importlib.reload(m)
        assert m4.app.docs_url == "/docs"
        assert "http://localhost:3000" in m4._build_origins()
    finally:
        monkeypatch.delenv("ENV", raising=False)
        monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
        importlib.reload(m)


def test_db_data_error_is_422_not_500():
    """asyncpg overflow on a client number (e.g. precio_max=9999999999999999999) must be a 422."""
    import asyncpg
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import api.main as m

    app = FastAPI()
    app.add_exception_handler(asyncpg.exceptions.DataError, m._db_data_error_handler)

    @app.get("/boom")
    async def boom():
        raise asyncpg.exceptions.NumericValueOutOfRangeError("value out of range")

    r = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert r.status_code == 422
    assert asyncpg.exceptions.DataError in m.app.exception_handlers  # registered on the real app


class _FakeUpload:
    def __init__(self, total, size=None):
        self.total, self.size, self.reads = total, size, 0

    async def read(self, n=-1):
        if self.total <= 0:
            return b""
        self.reads += 1
        k = min(n, self.total)
        self.total -= k
        return b"0" * k


async def test_bounded_upload_read_stops_early():
    up = _FakeUpload(MAX_UPLOAD_BYTES * 50)
    with pytest.raises(HTTPException) as e:
        await read_upload_bounded(up)
    assert e.value.status_code == 413
    assert up.reads <= MAX_UPLOAD_BYTES // (64 * 1024) + 2  # never read the whole 500 MB


async def test_bounded_upload_declared_size_rejected_without_reading():
    up = _FakeUpload(10, size=MAX_UPLOAD_BYTES + 1)
    with pytest.raises(HTTPException):
        await read_upload_bounded(up)
    assert up.reads == 0


async def test_bounded_upload_small_ok():
    assert len(await read_upload_bounded(_FakeUpload(1000))) == 1000


async def test_429_carries_retry_after():
    from httpx import ASGITransport, AsyncClient
    from api.limiter import limiter
    from api.main import app
    limiter.enabled = True
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
            hdr = {"x-real-ip": "203.0.113.77"}
            last = None
            for _ in range(130):          # /webhook/ghl is 120/minute
                last = await ac.post("/api/v1/webhook/ghl", content=b"{}", headers=hdr)
                if last.status_code == 429:
                    break
            assert last.status_code == 429
            assert int(last.headers["retry-after"]) >= 1
    finally:
        limiter.reset()
