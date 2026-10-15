"""
Obtiene n_listings de Airbnb por barrio para municipios no-Medellín
via AirROI /markets/search (1 llamada por municipio = 5 llamadas totales).

Solo disponible: active_listings_count por distrito.
Ocupa, ADR y yield no disponibles en este endpoint.

Uso:
    python scripts/fetch_airbnb_otros_municipios.py           # escribe a DB + JSON
    python scripts/fetch_airbnb_otros_municipios.py --dry-run # solo imprime
"""

import argparse
import json
import os
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

import sys as _sys
_sys.path.insert(0, str(Path(__file__).parent.parent))
from scraping.utils.cost_ledger import charge  # noqa: E402  (raises BudgetExceeded at the monthly cap)

load_dotenv(Path(__file__).parent.parent / ".env")

DB_URL  = os.environ["DATABASE_URL"]
API_KEY = os.getenv("AIRROI_API_KEY", "RXInlmmQ5G3RqmaajGD325HfuvPagkKB10VrwCZi")
BASE    = "https://api.airroi.com"
DELAY   = 1.2  # segundos entre llamadas

MUNICIPIOS = ["Bello", "Envigado", "Itagui", "La Estrella", "Sabaneta"]

# Normaliza nombre para comparación
def norm(s: str) -> str:
    return (s.lower()
              .replace("á","a").replace("é","e").replace("í","i")
              .replace("ó","o").replace("ú","u").replace("ñ","n")
              .strip())


def search_municipality(session: requests.Session, municipio: str) -> list[dict]:
    """1 API call — returns all districts with n_listings."""
    charge("airroi", "markets/search")
    resp = session.get(
        f"{BASE}/markets/search",
        params={"query": f"{municipio} Antioquia Colombia"},
        timeout=20,
    )
    resp.raise_for_status()
    entries = resp.json().get("entries", [])
    # Filter to target municipality only, with a district name
    target = norm(municipio)
    return [
        e for e in entries
        if norm(e.get("locality","")) == target and e.get("district","").strip()
    ]


def match_barrio(district: str, barrios: list[dict]) -> dict | None:
    """Fuzzy match district name to closest barrio nombre."""
    d = norm(district)
    # Exact match first
    for b in barrios:
        if norm(b["nombre"]) == d:
            return b
    # Partial match
    for b in barrios:
        bn = norm(b["nombre"])
        if d in bn or bn in d:
            return b
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"x-api-key": API_KEY, "Accept": "application/json"})

    conn = psycopg2.connect(DB_URL)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    total_calls   = 0
    total_matched = 0
    total_cost    = 0.0

    for mun in MUNICIPIOS:
        print(f"\n── {mun} ──────────────────────────────────")

        # Load barrios from DB for this municipality
        cur.execute(
            "SELECT id, nombre FROM raw.barrios WHERE upper(municipio)=upper(%s)",
            (mun,)
        )
        barrios = [dict(r) for r in cur.fetchall()]
        print(f"  Barrios en DB: {len(barrios)}")

        # 1 API call
        districts = search_municipality(session, mun)
        total_calls  += 1
        total_cost   += 0.01
        print(f"  Distritos AirROI: {len(districts)} (llamada #{total_calls}, ~${total_cost:.2f})")
        time.sleep(DELAY)

        matched = 0
        for dist in districts:
            n  = dist.get("active_listings_count", 0)
            dn = dist.get("district","")
            b  = match_barrio(dn, barrios)
            if not b:
                print(f"    [NO MATCH] {dn} → {n} listings")
                continue

            matched += 1
            total_matched += 1
            print(f"    {dn} → {b['nombre']} ({n} listings)")

            if not args.dry_run:
                # Delete existing record for this barrio (no unique on barrio_id)
                cur.execute("DELETE FROM raw.airbnb_barrios WHERE barrio_id = %s", (b["id"],))
                cur.execute("""
                    INSERT INTO raw.airbnb_barrios
                        (barrio_id, n_listings, ocupacion_pct, adr_cop,
                         ingresos_anuales_estimados, raw_data)
                    VALUES (%s, %s, NULL, NULL, NULL, %s)
                """, (b["id"], n, json.dumps(dist)))

        print(f"  Matched: {matched}/{len(districts)}")

    if not args.dry_run:
        conn.commit()
        print(f"\n✓ Guardado en DB. Llamadas: {total_calls}, costo estimado: ~${total_cost:.2f}")
        print("  Ahora corre: python scripts/enrich_barrios_stats.py")
    else:
        print(f"\n[dry-run] Llamadas: {total_calls}, costo estimado: ~${total_cost:.2f}")

    conn.close()


if __name__ == "__main__":
    main()
