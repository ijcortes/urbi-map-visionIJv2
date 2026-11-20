"""
Catastro Medellín Vigente — carga Hoja2 dentro de raw.catastro_medellin
(tabla compartida con Hoja1 desde la fusión 2026-08-23; discriminador: cd_vig_pred='S').

Mismas columnas que Hoja1 + cd_vig_pred (siempre 'S' = vigente).
Diferencias respecto a Hoja1:
  - nm_ar_lote  : enteros puros (sin coma decimal)
  - nm_ar_constru, area_desenglobe, vl_* : coma decimal (formato europeo)

Nota: Hoja1 y Hoja2 resultaron ser mayormente predios distintos (~1% de
solapamiento de matricula_anonimizada), no snapshots del mismo universo — se
fusionaron preservando ambos, no se deduplicó.

Run:
  python scripts/load_catastro_medellin_vigente.py
"""

import os
import sys
from pathlib import Path

import pandas as pd
import psycopg2
import psycopg2.extras

DB_URL = os.environ["DATABASE_URL"]

CSV_PATH = Path(__file__).parent.parent / "PQR_Predios anonimizado(Hoja2).csv"

DDL = """
ALTER TABLE raw.catastro_medellin ADD COLUMN IF NOT EXISTS cd_vig_pred VARCHAR;

CREATE INDEX IF NOT EXISTS idx_catastro_medellin_comuna
    ON raw.catastro_medellin(cd_comuna);
CREATE INDEX IF NOT EXISTS idx_catastro_medellin_uso
    ON raw.catastro_medellin(ds_uso_tipo);
CREATE INDEX IF NOT EXISTS idx_catastro_medellin_avaluo
    ON raw.catastro_medellin(vl_avaluo_total);
CREATE INDEX IF NOT EXISTS idx_catastro_medellin_vig
    ON raw.catastro_medellin(cd_vig_pred);
"""

VERIFY_SQL = """
SELECT
    ds_comuna,
    COUNT(*)                                          AS predios,
    ROUND(AVG(vl_avaluo_total) / 1000000.0, 1)        AS avaluo_prom_M_COP,
    ROUND(AVG(nm_ar_constru), 0)                      AS area_prom_m2,
    SUM(CASE WHEN cd_ind_ru_ur = 'U' THEN 1 ELSE 0 END) AS urbanos,
    SUM(CASE WHEN cd_ind_ru_ur = 'R' THEN 1 ELSE 0 END) AS rurales
FROM raw.catastro_medellin
WHERE cd_vig_pred = 'S'
GROUP BY ds_comuna
ORDER BY predios DESC;
"""

# Reconstruye analytics.catastro_comunas_stats (lo lee barrios.py para el ratio
# mercado/catastro). Filtro clave: SOLO viviendas reales. Antes el agregado tomaba
# todo lo '%residencial%' — metía 70k PARQUEADEROS y matrices de edificio entero
# (nm_ar_constru de miles de m²) → avalúo/m² ~40x chico → ratio mercado/catastro de
# ~100 (irreal; se espera 1,5–4). Acá: área 30–400 m², sin parqueadero/lote, y
# mediana (no promedio) por robustez. Ver docs To-do §1. [NOTA: mismo filtro vive
# en dbt/models/analytics/listings_vs_catastro.sql — mantener ambos en sync.]
REBUILD_STATS_SQL = """
TRUNCATE analytics.catastro_comunas_stats;
INSERT INTO analytics.catastro_comunas_stats
    (comuna, total_predios, pct_apartamento, area_mediana_apto_m2, avaluo_m2)
SELECT
    upper(trim(ds_comuna))                                                       AS comuna,
    count(*)                                                                     AS total_predios,
    round(100.0 * avg(((ds_uso_tipo ilike '%4 o más pisos%'
                        OR ds_uso_tipo ilike '%conjunto%'))::int), 1)            AS pct_apartamento,
    round(percentile_cont(0.5) within group (order by nm_ar_constru))            AS area_mediana_apto_m2,
    round(percentile_cont(0.5) within group (order by vl_avaluo_total / nm_ar_constru)) AS avaluo_m2
FROM raw.catastro_medellin
WHERE cd_vig_pred = 'S'
  AND cd_ind_ru_ur = 'U'
  AND vl_avaluo_total > 0
  AND nm_ar_constru BETWEEN 30 AND 400
  AND ds_uso_tipo ILIKE '%residencial%'
  AND ds_uso_tipo NOT ILIKE '%parqueadero%'
  AND ds_uso_tipo NOT ILIKE '%lote%'
GROUP BY upper(trim(ds_comuna))
HAVING count(*) >= 20;
"""

# nm_ar_lote es entero puro — se lee directamente como Int64
DTYPE = {
    "matricula_anonimizada": str,
    "cd_comuna":             "Int64",
    "cd_uso":                "Int64",
    "cd_tipo":               "Int64",
    "cd_uso_lote":           "Int64",
    "cd_tipo_lote":          "Int64",
    # Coma decimal en este archivo
    "nm_ar_constru":         str,
    "area_desenglobe":       str,
    "vl_av_lote":            str,
    "vl_av_constru":         str,
    "vl_avaluo_total":       str,
    "cd_ind_ru_ur":          str,
    "cd_vig_pred":           str,
}

DECIMAL_COLS = ["nm_ar_constru", "area_desenglobe"]
MONEY_COLS   = ["vl_av_lote", "vl_av_constru", "vl_avaluo_total"]

DB_COLS = [
    "matricula_anonimizada", "cd_comuna", "ds_comuna",
    "nm_ar_lote", "nm_ar_constru", "area_desenglobe",
    "cd_uso", "cd_tipo", "cd_uso_lote", "cd_tipo_lote",
    "ds_uso_tipo", "vl_av_lote", "vl_av_constru",
    "vl_avaluo_total", "cd_ind_ru_ur", "cd_vig_pred",
]

INSERT_SQL = f"""
    INSERT INTO raw.catastro_medellin
        ({', '.join(DB_COLS)})
    VALUES %s
"""


def _clean_num(series: pd.Series) -> pd.Series:
    return series.str.strip().str.replace(",", ".", regex=False)


def parse_decimal(series: pd.Series) -> pd.Series:
    return pd.to_numeric(_clean_num(series), errors="coerce")


def parse_money(series: pd.Series) -> pd.Series:
    return pd.to_numeric(_clean_num(series), errors="coerce").round(0).astype("Int64")


def _py(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item"):
        return v.item()
    return v


def main():
    if not CSV_PATH.exists():
        print(f"ERROR: archivo no encontrado → {CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    # ── Paso 1: DDL ───────────────────────────────────────────────────────────
    print("── Paso 1: Columna cd_vig_pred + índices en raw.catastro_medellin ──")
    cur.execute(DDL)
    conn.commit()
    print("✓ raw.catastro_medellin lista\n")

    # ── Paso 2: Carga en chunks ───────────────────────────────────────────────
    print("── Paso 2: Cargando CSV ─────────────────────────────────────────")
    total = 0
    try:
        for i, chunk in enumerate(
            pd.read_csv(
                CSV_PATH,
                sep=";",
                encoding="latin-1",
                chunksize=50_000,
                dtype=DTYPE,
                low_memory=False,
            )
        ):
            chunk.columns = chunk.columns.str.lower().str.strip()
            chunk = chunk.drop(columns=["id"], errors="ignore")

            for col in DECIMAL_COLS:
                if col in chunk.columns:
                    chunk[col] = parse_decimal(chunk[col])

            for col in MONEY_COLS:
                if col in chunk.columns:
                    chunk[col] = parse_money(chunk[col])

            chunk = chunk.reindex(columns=DB_COLS)

            rows_iter = [
                tuple(_py(v) for v in row)
                for row in chunk.itertuples(index=False, name=None)
            ]

            psycopg2.extras.execute_values(cur, INSERT_SQL, rows_iter, page_size=1000)
            conn.commit()

            total += len(chunk)
            print(f"  Chunk {i + 1:>3}: +{len(chunk):>6} filas → Total: {total:>9,}")

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print(f"\n✅ Carga completa: {total:,} registros\n")

    # ── Paso 3: Verificación ──────────────────────────────────────────────────
    print("── Paso 3: Verificación por comuna ─────────────────────────────")
    v_conn = psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    v_cur = v_conn.cursor()
    v_cur.execute(VERIFY_SQL)
    rows = v_cur.fetchall()
    v_cur.close()
    v_conn.close()

    header = f"{'COMUNA':<30} {'PREDIOS':>9} {'AVALÚO PROM (M COP)':>21} {'ÁREA m²':>9} {'URB':>7} {'RUR':>7}"
    sep = "─" * len(header)
    print(header)
    print(sep)
    for r in rows:
        print(
            f"{(r['ds_comuna'] or 'N/A'):<30} "
            f"{r['predios']:>9,} "
            f"{float(r['avaluo_prom_m_cop'] or 0):>21.1f} "
            f"{float(r['area_prom_m2'] or 0):>9.0f} "
            f"{r['urbanos']:>7,} "
            f"{r['rurales']:>7,}"
        )
    print(sep)
    print(f"{'TOTAL COMUNAS':>30}: {len(rows)}")

    # ── Paso 4: Reconstruir stats por comuna (lo que lee la API) ───────────────
    print("\n── Paso 4: Rebuild analytics.catastro_comunas_stats ────────────")
    s_conn = psycopg2.connect(DB_URL)
    s_cur = s_conn.cursor()
    try:
        s_cur.execute(REBUILD_STATS_SQL)
        s_conn.commit()
        s_cur.execute("SELECT count(*), round(percentile_cont(0.5) within group (order by avaluo_m2)) "
                      "FROM analytics.catastro_comunas_stats")
        n, med = s_cur.fetchone()
        print(f"✅ {n} comunas · avalúo/m² mediano {float(med):,.0f} COP")
    finally:
        s_cur.close()
        s_conn.close()


if __name__ == "__main__":
    main()
