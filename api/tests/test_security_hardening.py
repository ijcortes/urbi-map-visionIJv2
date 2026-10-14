import pytest
from fastapi import HTTPException

from api.utils.storage import MAX_UPLOAD_BYTES, validate_image_upload

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
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    monkeypatch.delenv("EXPOSE_DOCS", raising=False)
    m2 = importlib.reload(m)
    try:
        assert m2.app.docs_url is None and m2.app.openapi_url is None
        assert "http://localhost:3000" not in m2._build_origins()
    finally:
        monkeypatch.delenv("RAILWAY_ENVIRONMENT")
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
