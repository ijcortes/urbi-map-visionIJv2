"""Fast-path "toda la ciudad" (_LISTINGS_ALLCITY_SQL): mismo top-500 que el
query base pero limitando candidatos antes de los joins → más rápido.

Corre contra la BD local real (usa DATABASE_URL). Compara por URL (el `id`
md5-32bit colisiona). La única diferencia permitida es el empate de precio_cop
en el borde (posición ~500), que el query original tampoco desempata de forma
determinista.
"""
import os
import time

import asyncpg
import pytest

pytestmark = pytest.mark.require_db  # needs a live Postgres (conn refused in CI sandbox)

from api.routers import listings as L

ALL_NULL = (None, None, None, None, None, None, None, None, False,
            None, None, None, None, None, None,
            None, False)  # + $16 segmento, $17 ocultar_destacados
VENTA = (None, None, "venta", None, None, None, None, None, False,
         None, None, None, None, None, None,
         None, False)


async def _fetch(conn, sql, args, limit=500):
    return await conn.fetch(f"{sql} LIMIT {limit} OFFSET 0", *args)


@pytest.mark.asyncio
@pytest.mark.parametrize("args", [ALL_NULL, VENTA], ids=["sin_filtro", "venta"])
async def test_fast_equals_slow_ignoring_boundary_ties(args):
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        slow = await _fetch(conn, L._LISTINGS_SQL, args)
        fast = await _fetch(conn, L._LISTINGS_ALLCITY_SQL, args)
    finally:
        await conn.close()

    assert len(slow) == len(fast) == 500, (len(slow), len(fast))

    slow_pm2 = {r["url"]: r["precio_cop"] for r in slow}
    fast_pm2 = {r["url"]: r["precio_cop"] for r in fast}

    # precio_cop de la última fila = el borde. Solo las filas EMPATADAS en ese
    # valor son ambiguas (ni el query original las desempata determinísticamente).
    boundary = slow[-1]["precio_cop"]
    INF = float("inf")
    key = lambda v: INF if v is None else v  # NULLS LAST

    # Invariante fuerte: TODA fila estrictamente por debajo del borde (inequívoca
    # en el top-500) debe estar en AMBOS resultados.
    slow_below = {u for u, v in slow_pm2.items() if key(v) < key(boundary)}
    fast_below = {u for u, v in fast_pm2.items() if key(v) < key(boundary)}
    assert slow_below == fast_below, (
        f"difieren filas fuera de la banda de empate: "
        f"solo_slow={len(slow_below - fast_below)} solo_fast={len(fast_below - slow_below)}"
    )

    # Y cualquier diferencia restante debe ser exactamente el valor del borde.
    for u in set(slow_pm2) ^ set(fast_pm2):
        v = slow_pm2.get(u, fast_pm2.get(u))
        assert key(v) == key(boundary), f"diferencia fuera de la banda: pm2={v} borde={boundary}"


@pytest.mark.asyncio
async def test_fast_is_faster():
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)

    async def timed(sql, n=3):
        best = float("inf")
        for _ in range(n):
            t = time.perf_counter()
            await _fetch(conn, sql, ALL_NULL)
            best = min(best, time.perf_counter() - t)
        return best

    try:
        slow = await timed(L._LISTINGS_SQL)
        fast = await timed(L._LISTINGS_ALLCITY_SQL)
    finally:
        await conn.close()

    # Margen amplio: en la práctica es ~10x. Falla solo si NO hay mejora clara.
    assert fast < slow * 0.6, f"fast={fast:.3f}s no mejora vs slow={slow:.3f}s"
