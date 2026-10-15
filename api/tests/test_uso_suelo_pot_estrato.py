"""Fase 1 (POT + estrato manzana) — cobertura y consistencia contra la BD real.

Corre contra la BD local real (usa DATABASE_URL), igual que
test_listings_allcity_fast.py. No usa la app FastAPI, solo SQL directo:
estos son checks de datos/pipeline, no de la capa HTTP.
"""
import os

import asyncpg
import pytest

pytestmark = pytest.mark.require_db  # needs a live Postgres (conn refused in CI sandbox)

# Mismo mapeo que scripts/compute_uso_suelo_barrio.py — si diverge, el test falla.
SCORE_POR_CATEGORIA = {
    "Áreas de baja mixtura": 50,
    "Espacio Público Existente": 40,
    "Espacio Público Proyectado": 40,
    "Uso Dotacional": 60,
    "Áreas y corredores de media mixtura": 65,
    "Áreas y corredores de alta mixtura": 85,
}


@pytest.mark.asyncio
async def test_listings_georef_coverage_medellin():
    """estrato_manzana >=95%, uso_suelo_pot >=90% de los listings en Medellín
    (verificado manualmente 2026-08-25: 99.9% y ~99.8% respectivamente)."""
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchrow("""
            SELECT
                COUNT(*) FILTER (WHERE b.municipio ILIKE 'MEDELLIN')                                    AS total,
                COUNT(*) FILTER (WHERE b.municipio ILIKE 'MEDELLIN' AND g.estrato_manzana IS NOT NULL)  AS con_estrato,
                COUNT(*) FILTER (WHERE b.municipio ILIKE 'MEDELLIN' AND g.uso_suelo_pot IS NOT NULL)    AS con_pot
            FROM analytics.listings_georef g
            JOIN staging.stg_listings_unificado l ON l.url = g.url
            JOIN raw.barrios b ON b.id = l.barrio_id
        """)
    finally:
        await conn.close()

    assert row["total"] > 0, "no hay listings en Medellín — pipeline vacío"
    assert row["con_estrato"] / row["total"] >= 0.95, (
        f"cobertura estrato_manzana cayó: {row['con_estrato']}/{row['total']}"
    )
    assert row["con_pot"] / row["total"] >= 0.90, (
        f"cobertura uso_suelo_pot cayó: {row['con_pot']}/{row['total']}"
    )


@pytest.mark.asyncio
async def test_listings_georef_otros_municipios_null():
    """Fuera de Medellín, POT/estrato_manzana deben ser NULL (fuente Medellín-only) —
    no un valor heredado por error de join."""
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchrow("""
            SELECT COUNT(*) AS con_dato_fuera
            FROM analytics.listings_georef g
            JOIN staging.stg_listings_unificado l ON l.url = g.url
            JOIN raw.barrios b ON b.id = l.barrio_id
            WHERE NOT (b.municipio ILIKE 'MEDELLIN')
              AND g.uso_suelo_pot IS NOT NULL
        """)
    finally:
        await conn.close()
    assert row["con_dato_fuera"] == 0


@pytest.mark.asyncio
async def test_barrios_uso_suelo_score_mapping():
    """Todo barrio con uso_suelo_dominante debe tener el score exacto del
    mapeo — si alguien cambia el script sin actualizar el mapeo, esto avisa."""
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch("""
            SELECT DISTINCT uso_suelo_dominante, uso_suelo_score
            FROM raw.barrios
            WHERE uso_suelo_dominante IS NOT NULL
        """)
        total_populated = await conn.fetchval(
            "SELECT COUNT(*) FROM raw.barrios WHERE uso_suelo_dominante IS NOT NULL"
        )
    finally:
        await conn.close()

    assert total_populated > 0, "raw.barrios.uso_suelo_dominante vacío — recompute no corrió"
    for r in rows:
        cat, score = r["uso_suelo_dominante"], r["uso_suelo_score"]
        assert cat in SCORE_POR_CATEGORIA, f"categoría no mapeada: {cat!r}"
        assert score == SCORE_POR_CATEGORIA[cat], (
            f"score desalineado para {cat!r}: DB={score} esperado={SCORE_POR_CATEGORIA[cat]}"
        )
