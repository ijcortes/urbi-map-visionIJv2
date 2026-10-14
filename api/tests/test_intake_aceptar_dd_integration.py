"""Integración: POST /intake/{id}/aceptar + ciclo de due diligence.

Camino real (HTTP + DB migrada, sin mocks): owner crea intake por HTTP (D1),
se asigna a un realtor (fixture), el realtor acepta → listing 'borrador' +
checklist DD, verifica items hasta completo.

    pytest -m require_db api/tests/test_intake_aceptar_dd_integration.py
"""
import os
import uuid

import asyncpg
import pytest
import pytest_asyncio

from api.schemas.intake_cuestionario import DECLARACIONES_KEYS

EMAIL_OWNER = "pytest_dd_owner@example.com"
EMAIL_REALTOR = "pytest_dd_realtor@example.com"
EMAIL_OTRO = "pytest_dd_otro@example.com"      # agente NO asignado
EMAIL_CIVIL = "pytest_dd_civil@example.com"     # usuario sin agent
EMAILS = [EMAIL_OWNER, EMAIL_REALTOR, EMAIL_OTRO, EMAIL_CIVIL]
PASSWORD = "Test1234!"


async def _register_and_login(client, email: str) -> dict:
    await client.post("/api/v1/auth/register", json={
        "email": email, "password": PASSWORD, "nombre": "Pytest", "apellido": "DD",
    })
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
    # Limpieza en orden de FKs: intake (DD cascade) → listing → agency/agent → owner.
    await conn.execute(
        "DELETE FROM intake WHERE owner_id IN (SELECT o.id FROM owner o "
        "JOIN usuarios u ON u.id = o.usuario_id WHERE u.email = ANY($1))", EMAILS)
    await conn.execute(
        "DELETE FROM listing WHERE agent_id IN (SELECT a.id FROM agent a "
        "JOIN usuarios u ON u.id = a.usuario_id WHERE u.email = ANY($1))", EMAILS)
    await conn.execute(
        "DELETE FROM agency WHERE id IN (SELECT am.agency_id FROM agency_member am "
        "JOIN agent a ON a.id = am.agent_id "
        "JOIN usuarios u ON u.id = a.usuario_id WHERE u.email = ANY($1))", EMAILS)
    await conn.execute(
        "DELETE FROM agent WHERE usuario_id IN "
        "(SELECT id FROM usuarios WHERE email = ANY($1))", EMAILS)
    await conn.execute(
        "DELETE FROM owner WHERE usuario_id IN "
        "(SELECT id FROM usuarios WHERE email = ANY($1))", EMAILS)
    await conn.close()


async def _crear_realtor(db, email: str) -> uuid.UUID:
    """agent activo + agency independiente + membership owner. Devuelve agent.id."""
    usuario_id = await db.fetchval("SELECT id FROM usuarios WHERE email = $1", email)
    agent_id = await db.fetchval(
        "INSERT INTO agent (usuario_id, email, nombre, telefono, estado) "
        "VALUES ($1, $2, 'Realtor Pytest', '3000000000', 'activo') "
        "ON CONFLICT (email) DO UPDATE SET usuario_id = EXCLUDED.usuario_id "
        "RETURNING id",
        usuario_id, email,
    )
    agency_id = await db.fetchval(
        "INSERT INTO agency (nombre, tipo) VALUES ('Pytest Realty', 'independiente') "
        "RETURNING id")
    await db.execute(
        "INSERT INTO agency_member (agency_id, agent_id, rol) VALUES ($1, $2, 'owner') "
        "ON CONFLICT DO NOTHING", agency_id, agent_id)
    return agent_id


async def _intake_asignado(client, db, headers_owner, agent_id) -> str:
    """Owner crea intake por HTTP (camino D1) y se asigna al agent."""
    geom = await db.fetchval(
        "SELECT ST_AsText(ST_PointOnSurface(geometry)) FROM raw.barrios "
        "WHERE geometry IS NOT NULL LIMIT 1")
    assert geom, "raw.barrios sin geometrías — DB local incompleta"
    r = await client.post("/api/v1/intake", json={
        "operacion": "venta", "tipo_inmueble": "apartamento", "geom": geom,
        "precio_esperado": 500_000_000, "area_m2": 80,
        "en_propiedad_horizontal": True, "al_dia_administracion": True,
        "al_dia_predial": True, "tiene_hipoteca": False, "tiene_escritura": True,
        "servicios_al_dia": True,
    }, headers=headers_owner)
    assert r.status_code == 201, r.text
    intake_id = r.json()["id"]
    await db.execute(
        "UPDATE intake SET agent_id = $1, estado = 'asignado' WHERE id = $2",
        agent_id, uuid.UUID(intake_id))
    return intake_id


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_aceptar_crea_borrador_y_es_idempotente(client, db):
    headers_owner = await _register_and_login(client, EMAIL_OWNER)
    headers_realtor = await _register_and_login(client, EMAIL_REALTOR)
    agent_id = await _crear_realtor(db, EMAIL_REALTOR)
    intake_id = await _intake_asignado(client, db, headers_owner, agent_id)

    r = await client.post(f"/api/v1/intake/{intake_id}/aceptar", headers=headers_realtor)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "aceptado"
    assert body["dd_items"] == len(DECLARACIONES_KEYS)
    listing_id = body["listing_id"]

    row = await db.fetchrow(
        "SELECT estado::text AS estado, agent_id FROM listing WHERE id = $1",
        uuid.UUID(listing_id))
    assert row["estado"] == "borrador" and row["agent_id"] == agent_id
    assert await db.fetchval(
        "SELECT estado::text FROM intake WHERE id = $1",
        uuid.UUID(intake_id)) == "aceptado"

    # Segundo POST: mismo listing, sin duplicar nada.
    r2 = await client.post(f"/api/v1/intake/{intake_id}/aceptar", headers=headers_realtor)
    assert r2.status_code == 200
    assert r2.json()["listing_id"] == listing_id
    assert await db.fetchval(
        "SELECT COUNT(*) FROM listing WHERE agent_id = $1", agent_id) == 1
    assert await db.fetchval(
        "SELECT COUNT(*) FROM due_diligence_item WHERE intake_id = $1",
        uuid.UUID(intake_id)) == len(DECLARACIONES_KEYS)


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_aceptar_no_asignado_403(client, db):
    headers_owner = await _register_and_login(client, EMAIL_OWNER)
    await _register_and_login(client, EMAIL_REALTOR)
    headers_otro = await _register_and_login(client, EMAIL_OTRO)
    headers_civil = await _register_and_login(client, EMAIL_CIVIL)
    agent_id = await _crear_realtor(db, EMAIL_REALTOR)
    await _crear_realtor(db, EMAIL_OTRO)  # agente válido pero NO asignado
    intake_id = await _intake_asignado(client, db, headers_owner, agent_id)

    r = await client.post(f"/api/v1/intake/{intake_id}/aceptar", headers=headers_civil)
    assert r.status_code == 403  # ni siquiera es agente
    r = await client.post(f"/api/v1/intake/{intake_id}/aceptar", headers=headers_otro)
    assert r.status_code == 403  # agente, pero no el asignado


@pytest.mark.require_db
@pytest.mark.asyncio
async def test_ciclo_due_diligence_completo(client, db):
    headers_owner = await _register_and_login(client, EMAIL_OWNER)
    headers_realtor = await _register_and_login(client, EMAIL_REALTOR)
    headers_civil = await _register_and_login(client, EMAIL_CIVIL)
    agent_id = await _crear_realtor(db, EMAIL_REALTOR)
    intake_id = await _intake_asignado(client, db, headers_owner, agent_id)

    r = await client.post(f"/api/v1/intake/{intake_id}/aceptar", headers=headers_realtor)
    assert r.status_code == 200

    # GET sirve lo generado; owner también puede leer; un tercero no.
    r = await client.get(f"/api/v1/intake/{intake_id}/due-diligence", headers=headers_realtor)
    assert r.status_code == 200
    dd = r.json()
    assert len(dd["items"]) == len(DECLARACIONES_KEYS) and dd["completo"] is False
    assert (await client.get(f"/api/v1/intake/{intake_id}/due-diligence",
                             headers=headers_owner)).status_code == 200
    assert (await client.get(f"/api/v1/intake/{intake_id}/due-diligence",
                             headers=headers_civil)).status_code == 403

    # Verificar un item: queda verificado, con quién.
    item0 = dd["items"][0]["id"]
    r = await client.post(f"/api/v1/due-diligence/{item0}/verificar",
                          json={"estado": "verificado", "nota": "CTL ok"},
                          headers=headers_realtor)
    assert r.status_code == 200 and r.json()["checklist_completo"] is False
    row = await db.fetchrow(
        "SELECT estado::text AS estado, nota, verificado_por "
        "FROM due_diligence_item WHERE id = $1",
        uuid.UUID(item0))
    assert row["estado"] == "verificado" and row["verificado_por"] == agent_id

    # Un no-asignado no puede verificar.
    assert (await client.post(f"/api/v1/due-diligence/{item0}/verificar",
                              json={"estado": "verificado"},
                              headers=headers_civil)).status_code == 403

    # Completar el resto → checklist_completo True y el GET lo refleja.
    for it in dd["items"][1:]:
        r = await client.post(f"/api/v1/due-diligence/{it['id']}/verificar",
                              json={"estado": "verificado"}, headers=headers_realtor)
        assert r.status_code == 200
    assert r.json()["checklist_completo"] is True
    r = await client.get(f"/api/v1/intake/{intake_id}/due-diligence", headers=headers_realtor)
    assert r.json()["completo"] is True
