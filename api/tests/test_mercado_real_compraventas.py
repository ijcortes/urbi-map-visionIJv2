"""Fase 2 (compraventas SNR/ORIPS a nivel municipio) — sanidad del LATERAL
en api/routers/barrios.py::_BARRIO_SQL contra la BD real."""
import os
from datetime import date

import asyncpg
import pytest

pytestmark = pytest.mark.require_db  # needs a live Postgres (conn refused in CI sandbox)

# Mismo LATERAL que _BARRIO_SQL, aislado para poder probarlo sin levantar la API.
_MERCADO_REAL_SQL = """
WITH ultimo AS (
    SELECT anio, n_transacciones, valor_mediana
    FROM analytics.compraventas_municipio_stats cs
    WHERE cs.municipio = $1
      AND cs.anio IS NOT NULL
      AND cs.anio < EXTRACT(YEAR FROM CURRENT_DATE)::int
      AND cs.n_transacciones >= 30
    ORDER BY cs.anio DESC
    LIMIT 1
),
previo AS (
    SELECT cs2.valor_mediana
    FROM analytics.compraventas_municipio_stats cs2, ultimo u
    WHERE cs2.municipio = $1 AND cs2.anio = u.anio - 1 AND cs2.n_transacciones >= 30
),
inventario AS (
    SELECT COUNT(*)::float AS n_activo
    FROM staging.stg_listings_unificado sl2
    JOIN raw.barrios b2 ON b2.id = sl2.barrio_id
    WHERE UPPER(b2.municipio) = $1 AND sl2.tipo_operacion = 'venta'
),
pedido AS (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sl3.precio_cop) AS asking_mediana
    FROM staging.stg_listings_unificado sl3
    JOIN raw.barrios b3 ON b3.id = sl3.barrio_id
    WHERE UPPER(b3.municipio) = $1 AND sl3.tipo_operacion = 'venta' AND sl3.precio_cop > 0
)
SELECT
    u.anio AS anio_dato,
    u.n_transacciones AS n_transacciones_anual,
    u.valor_mediana AS valor_mediana_anual,
    CASE WHEN p.valor_mediana > 0
         THEN ROUND(((u.valor_mediana - p.valor_mediana)::numeric / p.valor_mediana) * 100, 1)
    END AS var_anual_pct,
    CASE WHEN u.n_transacciones > 0
         THEN ROUND((i.n_activo / (u.n_transacciones / 12.0))::numeric, 1)
    END AS meses_inventario,
    CASE
        WHEN u.n_transacciones = 0 OR i.n_activo IS NULL THEN NULL
        WHEN (i.n_activo / (u.n_transacciones / 12.0)) < 3 THEN 'vendedor'
        WHEN (i.n_activo / (u.n_transacciones / 12.0)) <= 6 THEN 'balanceado'
        ELSE 'comprador'
    END AS clasificacion_mercado,
    CASE WHEN pe.asking_mediana > 0
         THEN ROUND(((u.valor_mediana::numeric / pe.asking_mediana::numeric) * 100)::numeric, 1)
    END AS ratio_cierre_pedido_pct
FROM ultimo u
LEFT JOIN previo p ON TRUE
LEFT JOIN inventario i ON TRUE
LEFT JOIN pedido pe ON TRUE
"""


@pytest.mark.asyncio
async def test_mercado_real_medellin_sano():
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchrow(_MERCADO_REAL_SQL, "MEDELLIN")
    finally:
        await conn.close()

    assert row is not None, "sin fila para MEDELLIN — matview vacía o sin refrescar"
    assert row["anio_dato"] < date.today().year, "año parcial en curso no debe usarse como 'último completo'"
    assert row["n_transacciones_anual"] >= 30, "por debajo del umbral anti-ruido"
    assert row["valor_mediana_anual"] > 0
    assert row["meses_inventario"] is None or row["meses_inventario"] > 0
    assert row["clasificacion_mercado"] in (None, "vendedor", "balanceado", "comprador")


@pytest.mark.asyncio
async def test_mercado_real_municipio_sin_datos_no_rompe():
    """Municipio inexistente/sin compraventas → sin fila, no excepción."""
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchrow(_MERCADO_REAL_SQL, "MUNICIPIO_QUE_NO_EXISTE")
    finally:
        await conn.close()
    assert row is None
