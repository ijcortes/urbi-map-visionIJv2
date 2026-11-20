"""Incentivos del realtor — suite repetible, SIN tocar la DB dev.

Dos capas:
  1. Funciones puras (puntaje, componentes, degradación honesta del ranking).
  2. Endpoint /realtor/comparables con un pool falso (gate de reciprocidad en
     ambas direcciones + no-leak de matrícula/agente).

NO siembra cierres reales en la DB (eso contaminaría el dataset que el incentivo
existe para construir). El FLIP del gate contra la DB real se verifica aparte,
en vivo y con cleanup. Correr: `pytest api/tests/test_realtor_incentivos.py -v`.
"""
import datetime as dt
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from api.dependencies import get_current_user
from api.main import app
from api.routers import realtor as R


# ───────────────────────── 1. Funciones puras ─────────────────────────

def test_componente_velocidad_umbrales():
    assert R._componente_velocidad(None) == 0.0      # sin visitas respondidas
    assert R._componente_velocidad(2) == 100.0       # <=4h
    assert R._componente_velocidad(4) == 100.0
    assert R._componente_velocidad(10) == 75.0       # <=12h
    assert R._componente_velocidad(20) == 50.0       # <=24h
    assert R._componente_velocidad(40) == 25.0       # lento


def _row(cierres=0, resp_med=None, show_rate=None, aceptacion=None, actividad=0, agent_id="a"):
    return {"agent_id": agent_id, "cierres": cierres, "resp_med": resp_med,
            "show_rate": show_rate, "aceptacion": aceptacion, "actividad": actividad}


def test_puntaje_perfecto_y_cero():
    # Todo al tope: 5 cierres, respuesta <=4h, show 100%, aceptación 100% → 100.
    perfecto = _row(cierres=5, resp_med=2, show_rate=1.0, aceptacion=1.0)
    assert R._puntaje_standing(perfecto) == 100
    # Todo en cero → 0.
    cero = _row(cierres=0, resp_med=None, show_rate=0, aceptacion=0)
    assert R._puntaje_standing(cero) == 0


def test_puntaje_respeta_pesos():
    # Solo contribución al tope (peso 0.30) → 30. Verifica que el peso manda.
    solo_contrib = _row(cierres=5, resp_med=None, show_rate=0, aceptacion=0)
    assert R._puntaje_standing(solo_contrib) == round(R._PUNTAJE_PESOS["contribucion"] * 100)
    # Contribución topa en _CONTRIB_CAP: 10 cierres no suma más que 5.
    assert R._puntaje_standing(_row(cierres=10, resp_med=None, show_rate=0, aceptacion=0)) == \
           R._puntaje_standing(_row(cierres=R._CONTRIB_CAP, resp_med=None, show_rate=0, aceptacion=0))


def test_standing_degrada_honesto_sin_actividad():
    # Agente bajo el umbral de actividad → puntaje y ranking None (no inventa señal).
    rows = [_row(actividad=0, agent_id="me")]
    s = R._standing_de(rows, "me")
    assert s["puntaje"] is None and s["ranking"] is None
    assert s["cierres_reportados_12m"] == 0
    assert "insuficiente" in s["nota"].lower()


def test_standing_sin_ranking_si_un_solo_agente():
    # Con actividad suficiente pero solo 1 agente calificado → puntaje sí, ranking None.
    rows = [_row(cierres=2, resp_med=3, show_rate=1.0, aceptacion=1.0,
                 actividad=R._RANKING_MIN_ACTIVIDAD, agent_id="me")]
    s = R._standing_de(rows, "me")
    assert s["puntaje"] is not None
    assert s["ranking"] is None  # hace falta >=2 para un puesto con sentido


def test_standing_ranking_ordena_por_puntaje():
    # 3 agentes calificados: el de más cierres+velocidad va primero.
    rows = [
        _row(cierres=5, resp_med=2,  show_rate=1.0, aceptacion=1.0, actividad=10, agent_id="top"),
        _row(cierres=1, resp_med=20, show_rate=0.5, aceptacion=0.5, actividad=10, agent_id="mid"),
        _row(cierres=0, resp_med=40, show_rate=0.2, aceptacion=0.3, actividad=10, agent_id="low"),
    ]
    assert R._standing_de(rows, "top")["ranking"] == {"posicion": 1, "total": 3}
    assert R._standing_de(rows, "low")["ranking"] == {"posicion": 3, "total": 3}


def test_standing_excluye_no_calificados_del_total():
    # Un agente bajo el umbral no cuenta en el total del ranking.
    rows = [
        _row(cierres=5, resp_med=2, show_rate=1.0, aceptacion=1.0, actividad=10, agent_id="me"),
        _row(cierres=3, resp_med=5, show_rate=1.0, aceptacion=1.0, actividad=10, agent_id="otro"),
        _row(cierres=0, resp_med=None, show_rate=0, aceptacion=0, actividad=0, agent_id="novato"),
    ]
    s = R._standing_de(rows, "me")
    assert s["ranking"]["total"] == 2  # novato (actividad 0) excluido


# ──────────────── 2. Endpoint /comparables con pool falso ────────────────

class _Conn:
    def __init__(self, agent_row):
        self._agent = agent_row

    async def fetchrow(self, sql, *a):
        return self._agent  # _agent_del_usuario


class _AcquireCtx:
    def __init__(self, conn):
        self._c = conn

    async def __aenter__(self):
        return self._c

    async def __aexit__(self, *a):
        return False


class FakePool:
    """Imita lo que /comparables usa: acquire()+fetchrow (agente), fetchval
    (conteo de cierres), fetch (filas de comparables)."""
    def __init__(self, agent_row, cierres_count, comparables):
        self._conn = _Conn(agent_row)
        self._count = cierres_count
        self._comps = comparables

    def acquire(self):
        return _AcquireCtx(self._conn)

    async def fetchval(self, sql, *a):
        return self._count

    async def fetch(self, sql, *a):
        return self._comps


_AGENT = {"id": "11111111-1111-1111-1111-111111111111", "estado": "activo",
          "usuario_id": 1, "nombre": "Test", "foto_url": None, "bio": None}

_COMP_ROW = {
    "precio": Decimal("500000000"), "precio_m2": 7000000, "moneda": "COP",
    "fecha": dt.date(2026, 10, 1), "area_m2": Decimal("71"), "barrio": "El Poblado",
    "tipo_inmueble": "apartamento", "operacion": "venta", "verificado": False,
}


@pytest_asyncio.fixture
async def comps_client():
    def _mk(cierres_count, comparables):
        pool = FakePool(_AGENT, cierres_count, comparables)
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "nombre": "Test"}
        app.dependency_overrides[R.get_pool] = lambda: pool
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    yield _mk
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(R.get_pool, None)


async def test_comparables_gate_bloquea_sin_cierres(comps_client):
    async with comps_client(cierres_count=0, comparables=[_COMP_ROW]) as ac:
        r = await ac.get("/api/v1/realtor/comparables")
    assert r.status_code == 200
    body = r.json()
    assert body["acceso"] is False
    assert body["cierres_reportados"] == 0
    assert body["comparables"] == []          # NO filtra comparables al que no contribuye


async def test_comparables_gate_abre_con_cierre(comps_client):
    async with comps_client(cierres_count=1, comparables=[_COMP_ROW]) as ac:
        r = await ac.get("/api/v1/realtor/comparables")
    body = r.json()
    assert body["acceso"] is True
    assert len(body["comparables"]) == 1
    assert body["comparables"][0]["precio_m2"] == 7000000


async def test_comparables_no_filtra_matricula_ni_agente(comps_client):
    # Trust boundary: la respuesta NO debe exponer matrícula/dirección/agente/listing de otros.
    async with comps_client(cierres_count=1, comparables=[_COMP_ROW]) as ac:
        r = await ac.get("/api/v1/realtor/comparables")
    comp = r.json()["comparables"][0]
    for prohibido in ("matricula_inmobiliaria", "cedula_catastral", "agent_id",
                      "listing_id", "direccion", "direccion_aprox"):
        assert prohibido not in comp, f"LEAK: {prohibido} en comparables"
