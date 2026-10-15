"""Integración: POST /listings/agentes/{id}/resenas — dedup por (agent_id, user_id)
y promedio en GET /listings/agentes solo sobre reseñas reales (nunca 0 falso).

    pytest -m require_db api/tests/test_agent_review.py
"""
import os

import asyncpg
import pytest
import pytest_asyncio

EMAIL = "pytest_agent_review@example.com"
PASSWORD = "Test1234!"


async def _register_and_login(client, email: str) -> dict:
    await client.post("/api/v1/auth/register", json={
        "email": email, "password": PASSWORD, "nombre": "Pytest", "apellido": "Review",
    })  # 201, o 409 si quedó de una corrida anterior
    # Registration no longer yields a usable account: simulate the emailed-link click.
    from api.db import get_pool
    await get_pool().execute("UPDATE usuarios SET email_verificado = TRUE WHERE email = $1", email)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


EMAIL_AGENT_OWNER = "pytest_agent_review_agent@example.com"


@pytest_asyncio.fixture
async def db():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    yield conn
    await conn.execute(
        "DELETE FROM agent_review WHERE user_id IN (SELECT id FROM usuarios WHERE email = $1)", EMAIL,
    )
    await conn.execute("DELETE FROM agent WHERE email = $1", EMAIL_AGENT_OWNER)
    await conn.execute("DELETE FROM usuarios WHERE email = ANY($1)", [EMAIL, EMAIL_AGENT_OWNER])
    await conn.close()


async def _agente_de_prueba(db) -> str:
    # estado='activo' exige usuario_id (chk_agent_activo_requires_usuario) — cuenta
    # dueña del agente, nunca se loguea con ella en este test.
    usuario_id = await db.fetchval(
        """INSERT INTO usuarios (email, password_hash, nombre)
           VALUES ($1, 'x', 'Agente Pytest')
           ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
           RETURNING id""",
        EMAIL_AGENT_OWNER,
    )
    return await db.fetchval(
        """INSERT INTO agent (usuario_id, email, nombre, telefono, estado)
           VALUES ($1, $2, 'Agente Pytest', '3000000000', 'activo')
           ON CONFLICT (email) DO UPDATE SET estado = 'activo', usuario_id = EXCLUDED.usuario_id
           RETURNING id::text""",
        usuario_id, EMAIL_AGENT_OWNER,
    )


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_resena_dedup_y_promedio_null_safe(client, db):
    headers = await _register_and_login(client, EMAIL)
    agent_id = await _agente_de_prueba(db)

    # Antes de reseñar: rating_promedio debe ser None, no 0 (nunca fabricar un score).
    r = await client.get("/api/v1/listings/agentes")
    assert r.status_code == 200
    antes = next(a for a in r.json() if a["id"] == agent_id)
    assert antes["rating_promedio"] is None
    assert antes["n_resenas"] == 0

    # Primera reseña.
    r = await client.post(f"/api/v1/listings/agentes/{agent_id}/resenas",
                           json={"calificacion": 3, "comentario": "ok"}, headers=headers)
    assert r.status_code == 201

    # Segunda reseña del MISMO usuario → upsert, no una fila nueva (UNIQUE agent_id+user_id).
    r = await client.post(f"/api/v1/listings/agentes/{agent_id}/resenas",
                           json={"calificacion": 5, "comentario": "mejor de lo que pensé"}, headers=headers)
    assert r.status_code == 201

    n_filas = await db.fetchval(
        "SELECT COUNT(*) FROM agent_review WHERE agent_id = $1::uuid", agent_id,
    )
    assert n_filas == 1, "el segundo POST del mismo usuario debe actualizar, no duplicar"

    r = await client.get("/api/v1/listings/agentes")
    despues = next(a for a in r.json() if a["id"] == agent_id)
    assert despues["rating_promedio"] == 5.0  # quedó el valor actualizado, no el promedio 3+5
    assert despues["n_resenas"] == 1
