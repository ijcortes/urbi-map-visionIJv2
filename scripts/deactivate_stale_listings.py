"""
Age out listings the portals no longer show (activo was hard-set TRUE on every
upsert and never set FALSE, so sold/removed listings stayed on the map).

Rule (per source), deliberately conservative:
  * the row was last seen more than STALE_DAYS ago (default 10), AND
  * for EVERY scrape config that could have produced it (municipio | tipo | op),
    at least 2 COMPLETE full passes ran after it was last seen
    (complete = >=95 % of the portal's total reached, no failed pages; see
    scraping/utils/quality.record_run). Configs that never complete — e.g. a
    search above Metrocuadrado's 10k API cap — never age anything out.
  * mass brake: if more than STALE_MAX_PCT (default 30 %) of a source's active
    rows qualify, nothing is changed for that source and the run exits 2.

Reversible: the next scrape that sees the listing again sets activo = TRUE.

Run: python scripts/deactivate_stale_listings.py [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import sys
import unicodedata
from collections import defaultdict

import psycopg2

STALE_DAYS = int(os.getenv("STALE_DAYS", "10"))
MAX_PCT = float(os.getenv("STALE_MAX_PCT", "30"))
STRIKES = 2

SOURCES = {
    "metrocuadrado": ("raw.listings_metrocuadrado", True),
    "fincaraiz": ("raw.listings_fincaraiz", True),
    "habi": ("raw.listings_habi", False),
}


def slug(municipio: str | None) -> str:
    s = unicodedata.normalize("NFD", municipio or "").encode("ascii", "ignore").decode()
    return "-".join(s.strip().lower().split())


def config_keys(fuente: str, municipio, tipo, op) -> list[str]:
    if fuente == "habi":
        return ["valle_aburra"]
    tipo = (tipo or "").lower()
    tipos = [tipo, "apartaestudio"] if tipo == "apartamento" else [tipo]  # studios were folded into apartamento
    return [f"{slug(municipio)}|{t}|{(op or '').lower()}" for t in tipos]


def stale_ids(cur, fuente: str, table: str, has_op: bool) -> tuple[list[int], int]:
    cur.execute(
        "SELECT config_key, run_at FROM raw.scrape_runs "
        "WHERE fuente = %s AND modo = 'full' AND complete ORDER BY run_at",
        (fuente,),
    )
    runs: dict[str, list] = defaultdict(list)
    for key, run_at in cur.fetchall():
        runs[key].append(run_at)

    cur.execute(f"SELECT COUNT(*) FROM {table} WHERE activo")
    active = cur.fetchone()[0]
    op_col = "tipo_operacion" if has_op else "'venta'"
    cur.execute(
        f"""SELECT id, last_seen_at, municipio_raw, tipo_inmueble, {op_col}
              FROM {table}
             WHERE activo AND last_seen_at < NOW() - make_interval(days => %s)""",
        (STALE_DAYS,),
    )
    out = []
    for id_, seen, mun, tipo, op in cur.fetchall():
        keys = config_keys(fuente, mun, tipo, op)
        if all(sum(1 for t in runs.get(k, ()) if t > seen) >= STRIKES for k in keys):
            out.append(id_)
    return out, active


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    rc = 0
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        for fuente, (table, has_op) in SOURCES.items():
            with conn, conn.cursor() as cur:
                cur.execute("SELECT to_regclass(%s)", (table,))
                if cur.fetchone()[0] is None:
                    continue
                ids, active = stale_ids(cur, fuente, table, has_op)
                pct = 100.0 * len(ids) / active if active else 0.0
                print(f"[stale] {fuente}: {len(ids)} of {active} active rows qualify ({pct:.1f}%)")
                if not ids:
                    continue
                if pct > MAX_PCT:
                    print(f"[stale] {fuente}: BRAKE — above {MAX_PCT}%, nothing changed (check scrapers)", file=sys.stderr)
                    rc = 2
                    continue
                if args.dry_run:
                    continue
                cur.execute(
                    f"UPDATE {table} SET activo = FALSE WHERE id = ANY(%s) AND activo",
                    (ids,),
                )
                print(f"[stale] {fuente}: {cur.rowcount} deactivated")
    finally:
        conn.close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
