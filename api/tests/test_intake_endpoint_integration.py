"""Integración: POST /intake resuelve usuario→owner contra la DB real migrada.

Regresión del bug D1: intake.owner_id es UUID FK→owner, pero el endpoint pasaba
usuarios.id (INT) y GET /intake/{id} comparaba INT vs UUID (403 siempre).
Camino HTTP completo — auth real, PostGIS real, sin mocks:

    pytest -m require_db api/tests/test_intake_endpoint_integration.py
"""
import os
import uuid

import asyncpg
import pytest
import pytest_asyncio

EMAIL_A = "pytest_intake_owner_a@example.com"
EMAIL_B = "pytest_intake_owner_b@example.com"
PASSWORD = "Test1234!"


async def _register_and_login(client, email: str) -> dict:
    await client.post("/api/v1/auth/register", json={
        "email": email, "password": PASSWORD, "nombre": "Pytest", "apellido": "Intake",
    })  # 201, o 409 si quedó de una corrida anterior
    # Registration no longer yields a usable account: simulate the emailed-link click.
    from api.db import get_pool
    await get_pool().execute("UPDATE usuarios SET email_verificado = TRUE WHERE email = $1", email)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


# Pool de la app y limiter: los monta el fixture `client` (conftest.py).


@pytest_asyncio.fixture
async def db():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    yield conn
    # Limpieza al final (orden por FK: intake RESTRICT sobre owner).
    await conn.execute(
        "DELETE FROM intake WHERE owner_id IN (SELECT o.id FROM owner o "
        "JOIN usuarios u ON u.id = o.usuario_id WHERE u.email = ANY($1))",
        [EMAIL_A, EMAIL_B],
    )
    await conn.execute(
        "DELETE FROM owner WHERE usuario_id IN "
        "(SELECT id FROM usuarios WHERE email = ANY($1))",
        [EMAIL_A, EMAIL_B],
    )
    await conn.close()


async def _punto_en_barrio(db) -> str:
    wkt = await db.fetchval(
        "SELECT ST_AsText(ST_PointOnSurface(geometry)) FROM raw.barrios "
        "WHERE geometry IS NOT NULL LIMIT 1"
    )
    assert wkt, "raw.barrios sin geometrías — DB local incompleta"
    return wkt


def _payload(geom: str) -> dict:
    # arriendo = cuestionario liviano (solo operacion/tipo_inmueble/geom obligatorios)
    return {
        "operacion": "arriendo", "tipo_inmueble": "apartamento", "geom": geom,
        "precio_esperado": 2_500_000, "area_m2": 60, "habitaciones": 2, "banos": 1,
    }


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_post_intake_crea_owner_y_get_no_da_403(client, db):
    headers = await _register_and_login(client, EMAIL_A)
    geom = await _punto_en_barrio(db)

    r = await client.post("/api/v1/intake", json=_payload(geom), headers=headers)
    assert r.status_code == 201, r.text
    intake_id = r.json()["id"]

    # El intake quedó colgado del owner del usuario (UUID→UUID, FK satisfecha).
    row = await db.fetchrow(
        "SELECT o.usuario_id FROM intake i JOIN owner o ON o.id = i.owner_id "
        "WHERE i.id = $1",
        uuid.UUID(intake_id),
    )
    usuario_id = await db.fetchval("SELECT id FROM usuarios WHERE email = $1", EMAIL_A)
    assert row is not None and row["usuario_id"] == usuario_id

    # El dueño puede leerlo: 200, no 403.
    r = await client.get(f"/api/v1/intake/{intake_id}", headers=headers)
    assert r.status_code == 200, r.text


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_segundo_post_reusa_owner_no_duplica(client, db):
    headers = await _register_and_login(client, EMAIL_A)
    geom = await _punto_en_barrio(db)

    r1 = await client.post("/api/v1/intake", json=_payload(geom), headers=headers)
    r2 = await client.post("/api/v1/intake", json=_payload(geom), headers=headers)
    assert r1.status_code == 201 and r2.status_code == 201

    n = await db.fetchval(
        "SELECT COUNT(*) FROM owner o JOIN usuarios u ON u.id = o.usuario_id "
        "WHERE u.email = $1",
        EMAIL_A,
    )
    assert n == 1


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_get_intake_usuario_ajeno_403(client, db):
    headers_a = await _register_and_login(client, EMAIL_A)
    headers_b = await _register_and_login(client, EMAIL_B)
    geom = await _punto_en_barrio(db)

    r = await client.post("/api/v1/intake", json=_payload(geom), headers=headers_a)
    assert r.status_code == 201
    intake_id = r.json()["id"]

    # B no es dueño ni realtor asignado.
    r = await client.get(f"/api/v1/intake/{intake_id}", headers=headers_b)
    assert r.status_code == 403

    # Y /intake/mias de B no lo lista.
    r = await client.get("/api/v1/intake/mias", headers=headers_b)
    assert r.status_code == 200
    assert all(i["id"] != intake_id for i in r.json())
