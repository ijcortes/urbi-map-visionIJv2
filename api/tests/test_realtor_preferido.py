"""Lógica pura de Realtor Preferido con una conexión simulada (sin DB)."""
import asyncio
import pytest
from api.services import realtor_preferido_service as svc


class FakeConn:
    def __init__(self, activos, propio=None):
        self.activos, self.propio, self.inserts, self.cancelados = activos, propio, [], []

    async def execute(self, q, *a):
        if "SET estado = 'cancelado'" in q:
            self.cancelados.append(a[0])
        return "UPDATE 0"

    async def fetchval(self, q, *a):
        if "INSERT INTO realtor_slot" in q:
            self.inserts.append(a)
            return "nuevo-id"
        if "precio_mensual FROM realtor_slot_precio" in q:
            return 200000
        return None

    async def fetchrow(self, q, *a):
        return self.propio

    async def fetch(self, q, *a):
        return self.activos


def _slot(pos, tipo="pago"):
    return {"id": f"s{pos}", "posicion": pos, "agent_id": f"a{pos}", "tipo": tipo, "fecha_fin": None}


def run(c):
    return asyncio.run(c)


def test_capacidades():
    assert svc.CAPACIDAD == {"barrio": 4, "comuna": 8}


def test_toma_primera_posicion_libre():
    c = FakeConn([_slot(1), _slot(3)])
    r = run(svc.asignar_slot(c, "nuevo", "barrio", "1"))
    assert r["posicion"] == 2


def test_zona_llena_rechaza_pagador_si_todos_pagan():
    c = FakeConn([_slot(i) for i in range(1, 5)])
    with pytest.raises(svc.SlotError):
        run(svc.asignar_slot(c, "nuevo", "barrio", "1", tipo="pago"))


def test_pagador_reemplaza_slot_gratis():
    c = FakeConn([_slot(1), _slot(2), _slot(3), _slot(4, "gratis")])
    r = run(svc.asignar_slot(c, "nuevo", "barrio", "1", tipo="pago"))
    assert r["posicion"] == 4 and c.cancelados == ["s4"]


def test_gratis_no_desplaza_a_nadie():
    c = FakeConn([_slot(i) for i in range(1, 5)])
    with pytest.raises(svc.SlotError):
        run(svc.asignar_slot(c, "nuevo", "barrio", "1", tipo="gratis"))


def test_comuna_tiene_8():
    c = FakeConn([_slot(i) for i in range(1, 8)])
    assert run(svc.asignar_slot(c, "nuevo", "comuna", "3"))["posicion"] == 8


def test_zona_invalida():
    with pytest.raises(svc.SlotError):
        run(svc.asignar_slot(FakeConn([]), "x", "ciudad", "1"))


class ValConn:
    def __init__(self, existe=True):
        self.existe = existe

    async def fetchval(self, q, *a):
        return 1 if self.existe else None


def test_validar_zona():
    run(svc.validar_zona(ValConn(), "barrio", "12"))
    run(svc.validar_zona(ValConn(), "comuna", "101"))
    for nivel, cod, conn in [("barrio", "abc", ValConn()), ("barrio", "9999", ValConn(False)),
                             ("comuna", "x", ValConn()), ("ciudad", "1", ValConn())]:
        with pytest.raises(svc.SlotError):
            run(svc.validar_zona(conn, nivel, cod))


class PagoConn(FakeConn):
    def __init__(self):
        super().__init__([])
        self.refs = set()

    async def fetchval(self, q, *a):
        if "INSERT INTO realtor_slot_pago" in q:
            if a[0] in self.refs:
                return None
            self.refs.add(a[0])
            return 1
        return await super().fetchval(q, *a)


class _Tx:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False


class _Acq(_Tx):
    def __init__(self, c): self.c = c
    async def __aenter__(self): return self.c


class FakePool:
    def __init__(self, c): self.c = c
    def acquire(self): return _Acq(self.c)


def test_pago_idempotente():
    c = PagoConn()
    c.transaction = lambda: _Tx()
    pool = FakePool(c)
    r1 = run(svc.procesar_pago_slot(pool, "ag", "comuna", "3", 1, "ord_1"))
    r2 = run(svc.procesar_pago_slot(pool, "ag", "comuna", "3", 1, "ord_1"))
    assert r1["accion"] == "asignado" and r2["accion"] == "duplicado" and len(c.inserts) == 1


def test_elegir_rotados_ventana_y_vuelta():
    activos = ["a", "b", "c"]
    w = svc.ROTACION_SEG
    assert svc.elegir_rotados(activos, 2, ahora=0) == ["a", "b"]
    assert svc.elegir_rotados(activos, 2, ahora=w) == ["b", "c"]
    assert svc.elegir_rotados(activos, 2, ahora=2 * w) == ["c", "a"]
    assert svc.elegir_rotados(["x"], 2, ahora=5 * w) == ["x"]
    assert svc.elegir_rotados([], 2) == []
