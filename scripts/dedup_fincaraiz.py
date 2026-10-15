"""
Marca (no borra) duplicados en raw.listings_fincaraiz. El loader hace ON CONFLICT
(url), así que el mismo inmueble re-publicado con otra URL entra duplicado.

Soft dedup: el perdedor queda con duplicado_de = id del ganador y deja de
servirse (cache.py / dbt filtran duplicado_de IS NULL). Nada se borra, así que
un falso positivo (dos unidades idénticas en la misma torre) se revierte con
UPDATE ... SET duplicado_de = NULL, y cada corrida recalcula desde cero.

Clave: misma fórmula de hash que scraping/utils/dedup.py + coordenada a ~11 m
(4 decimales) cuando existe, para no fusionar unidades de torres distintas que
comparten barrio y características.

Run: python scripts/dedup_fincaraiz.py [--dry-run]
"""
import argparse
import os
import sys
from pathlib import Path

import psycopg2

sys.path.insert(0, str(Path(__file__).parent.parent))
from scraping.utils.dedup import DEDUP_HASH_SQL  # noqa: E402

_KEY = f"""{DEDUP_HASH_SQL} || '|' ||
    COALESCE(ROUND(lat::numeric, 4)::text, '') || ',' || COALESCE(ROUND(lon::numeric, 4)::text, '')"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn, conn.cursor() as cur:
            cur.execute(f"""
                WITH ranked AS (
                    SELECT id,
                           FIRST_VALUE(id) OVER (PARTITION BY {_KEY} ORDER BY id DESC) AS ganador
                    FROM raw.listings_fincaraiz
                    WHERE activo = true
                )
                UPDATE raw.listings_fincaraiz f
                   SET duplicado_de = CASE WHEN r.ganador = f.id THEN NULL ELSE r.ganador END
                  FROM ranked r
                 WHERE r.id = f.id
                   AND f.duplicado_de IS DISTINCT FROM (CASE WHEN r.ganador = f.id THEN NULL ELSE r.ganador END)
            """)
            changed = cur.rowcount
            cur.execute("SELECT COUNT(*) FROM raw.listings_fincaraiz WHERE duplicado_de IS NOT NULL")
            marked = cur.fetchone()[0]
            print(f"[dedup_fincaraiz] {changed} filas actualizadas; {marked} marcadas como duplicado (ninguna borrada)")
            if args.dry_run:
                conn.rollback()
                print("[dedup_fincaraiz] dry-run: rollback")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
