"""Shared fixtures for API tests. Uses httpx.AsyncClient against the real FastAPI app."""
import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("JWT_SECRET", "test-secret-key-not-for-production-0123456789")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.local")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/social_test")

from api.main import app  # noqa: E402  (import after env vars set)


@pytest_asyncio.fixture
async def client():
    """HTTP client contra la app real, con pool DB inicializado.

    ASGITransport no ejecuta el lifespan de la app → el pool se crea/cierra a
    mano aquí. Limiter off: register es 3/min y las suites de integración
    registran varios usuarios. Todo consumidor de `client` es un test HTTP
    require_db, así que el costo solo se paga donde hace falta.
    """
    from api.db import close_pool, create_pool
    from api.limiter import limiter

    limiter.enabled = False
    await create_pool()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    finally:
        await close_pool()
        limiter.enabled = True
