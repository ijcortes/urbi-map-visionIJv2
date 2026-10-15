"""
Extrae datos Airbnb Valle de Aburrá via AirROI API.

FASE A — Mercados (/markets/search):
  - 1 llamada por municipio (10 total)  → n_listings por distrito
  - Inserta en raw.airbnb_mercado_valle con barrio_id por nombre
  - Costo estimado: ~$0.00 (endpoint gratuito)

FASE B — Refresh listings existentes (/listings):
  - Lee los listing_id actuales de raw.airbnb_listings_portal
  - Refresca TTM metrics, ocupación, ADR, RevPAR via AirROI /listings
  - Actualiza raw.airbnb_listings_portal con datos frescos
  - Costo estimado: ~$0.01 por listing

Uso:
  python scripts/fetch_airroi_valle_aburra.py            # ambas fases
  python scripts/fetch_airroi_valle_aburra.py --dry-run  # solo imprime
  python scripts/fetch_airroi_valle_aburra.py --fase A   # solo mercados
  python scripts/fetch_airroi_valle_aburra.py --fase B   # solo refresh listings
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

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from scraping.utils.cost_ledger import charge  # noqa: E402  (raises BudgetExceeded at the cap)

load_dotenv(Path(__file__).parent.parent / ".env")

DB_URL  = os.environ["DATABASE_URL"]
API_KEY = os.getenv("AIRROI_API_KEY", "RXInlmmQ5G3RqmaajGD325HfuvPagkKB10VrwCZi")
BASE    = "https://api.airroi.com"
DELAY   = 1.2

USD_TO_COP = float(os.getenv("USD_TO_COP", "4163"))

MUNICIPIOS_VALLE = [
    ("Medellin",    "MEDELLIN"),
    ("Envigado",    "ENVIGADO"),
    ("Bello",       "BELLO"),
    ("Itagui",      "ITAGUI"),
    ("La Estrella", "LA ESTRELLA"),
    ("Sabaneta",    "SABANETA"),
    ("Copacabana",  "COPACABANA"),
    ("Caldas",      "CALDAS"),
    ("Barbosa",     "BARBOSA"),
    ("Girardota",   "GIRARDOTA"),
]


def norm(s: str) -> str:
    return (
        s.lower()
        .replace("á", "a").replace("é", "e").replace("í", "i")
        .replace("ó", "o").replace("ú", "u").replace("ñ", "n")
        .strip()
    )


def _strip_prefixes(s: str) -> str:
    """Remove common prefixes from barrio names for fuzzy matching."""
    for prefix in ("b. ", "barrio ", "brio. ", "sector "):
        if s.startswith(prefix):
            s = s[len(prefix):]
    return s.strip()


def match_barrio(district: str, barrios: list[dict]) -> dict | None:
    d = norm(district)
    d_stripped = _strip_prefixes(d)

    # Pass 1: exact match
    for b in barrios:
        if norm(b["nombre"]) == d:
            return b

    # Pass 2: exact match after stripping prefixes from both sides
    for b in barrios:
        if _strip_prefixes(norm(b["nombre"])) == d_stripped:
            return b

    # Pass 3: substring match (stripped)
    for b in barrios:
        bn = _strip_prefixes(norm(b["nombre"]))
        if d_stripped and (d_stripped in bn or bn in d_stripped):
            return b

    # Pass 4: original substring match
    for b in barrios:
        bn = norm(b["nombre"])
        if d in bn or bn in d:
            return b

    return None


# ── Fase A: /markets/search ───────────────────────────────────────────────────

def fase_a(session: requests.Session, conn, dry_run: bool) -> dict:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    total_calls = 0
    stats = {}

    for mun_query, mun_db in MUNICIPIOS_VALLE:
        print(f"\n── {mun_query} ({mun_db}) ─────────────────────────")

        cur.execute(
            "SELECT id, nombre FROM raw.barrios WHERE upper(municipio)=upper(%s)",
            (mun_db,),
        )
        barrios = [dict(r) for r in cur.fetchall()]
        print(f"  Barrios en DB: {len(barrios)}")

        charge("airroi", "markets/search")
        resp = session.get(
            f"{BASE}/markets/search",
            params={"query": f"{mun_query} Antioquia Colombia"},
            timeout=20,
        )
        resp.raise_for_status()
        total_calls += 1
        time.sleep(DELAY)

        entries = resp.json().get("entries", [])
        target = norm(mun_query)
        districts = [
            e for e in entries
            if norm(e.get("locality", "")) == target and e.get("district", "").strip()
        ]
        print(f"  Distritos AirROI: {len(districts)} (de {len(entries)} entradas)")

        matched = 0
        unmatched = 0
        for dist in districts:
            n  = dist.get("active_listings_count", 0)
            dn = dist.get("district", "")
            b  = match_barrio(dn, barrios)

            if not b:
                print(f"    [sin match] {dn} → {n} listings")
                unmatched += 1
                barrio_id = None
            else:
                matched += 1
                barrio_id = b["id"]
                print(f"    {dn} → {b['nombre']} ({n} listings)")

            if not dry_run:
                cur.execute(
                    """
                    INSERT INTO raw.airbnb_mercado_valle
                        (municipio, barrio_raw, barrio_id, n_listings,
                         fuente, fase, fecha_extraccion)
                    VALUES (%s, %s, %s, %s, 'airroi', 'markets_search', NOW())
                    ON CONFLICT (municipio, barrio_raw, fuente) DO UPDATE SET
                        barrio_id        = EXCLUDED.barrio_id,
                        n_listings       = EXCLUDED.n_listings,
                        fase             = EXCLUDED.fase,
                        fecha_extraccion = NOW()
                    """,
                    (mun_db, dn, barrio_id, n),
                )

        stats[mun_db] = {"districts": len(districts), "matched": matched, "unmatched": unmatched}
        print(f"  Match: {matched}/{len(districts)} (sin match: {unmatched})")

    if not dry_run:
        conn.commit()

    print(f"\n  Total llamadas Fase A: {total_calls}, costo estimado: ~$0.00")
    return stats


# ── Fase B: refresh /listings ─────────────────────────────────────────────────

def _map_listing(data: dict, listing_id: int) -> dict:
    li = data.get("listing_info", {})
    hi = data.get("host_info", {})
    lo = data.get("location_info", {})
    pd = data.get("property_details", {})
    bs = data.get("booking_settings", {})
    pr = data.get("pricing_info", {})
    ra = data.get("ratings", {})
    pm = data.get("performance_metrics", {})

    currency = pr.get("currency", "COP")
    native_to_usd = (1.0 / USD_TO_COP) if currency == "COP" else 1.0

    def to_usd(val):
        return round(val * native_to_usd, 2) if val is not None else None

    amenities = pd.get("amenities", [])

    return {
        "listing_id":              listing_id,
        "listing_name":            li.get("listing_name"),
        "listing_type":            li.get("listing_type"),
        "room_type":               li.get("room_type"),
        "host_id":                 hi.get("host_id"),
        "host_name":               hi.get("host_name"),
        "superhost":               hi.get("superhost"),
        "latitude":                lo.get("latitude"),
        "longitude":               lo.get("longitude"),
        "guests":                  pd.get("guests"),
        "bedrooms":                pd.get("bedrooms"),
        "beds":                    pd.get("beds"),
        "baths":                   pd.get("baths"),
        "min_nights":              bs.get("min_nights"),
        "cancellation_policy":     bs.get("cancellation_policy"),
        "professional_management": hi.get("professional_management"),
        "guest_favorite":          li.get("guest_favorite"),
        "num_reviews":             ra.get("num_reviews"),
        "rating_overall":          ra.get("rating_overall"),
        "rating_accuracy":         ra.get("rating_accuracy"),
        "rating_checkin":          ra.get("rating_checkin"),
        "rating_cleanliness":      ra.get("rating_cleanliness"),
        "rating_communication":    ra.get("rating_communication"),
        "rating_location":         ra.get("rating_location"),
        "rating_value":            ra.get("rating_value"),
        "currency":                currency,
        "cleaning_fee":            pr.get("cleaning_fee"),
        "ttm_revenue":             to_usd(pm.get("ttm_revenue")),
        "ttm_revenue_native":      pm.get("ttm_revenue"),
        "ttm_avg_rate":            to_usd(pm.get("ttm_avg_rate")),
        "ttm_avg_rate_native":     pm.get("ttm_avg_rate"),
        "ttm_occupancy":           pm.get("ttm_occupancy"),
        "ttm_revpar":              to_usd(pm.get("ttm_revpar")),
        "ttm_revpar_native":       pm.get("ttm_revpar"),
        "ttm_reserved_days":       pm.get("ttm_days_reserved"),
        "ttm_available_days":      pm.get("ttm_available_days"),
        "ttm_total_days":          pm.get("ttm_total_days"),
        "ttm_avg_min_nights":      pm.get("ttm_avg_min_nights"),
        "ttm_avg_length_of_stay":  pm.get("ttm_avg_length_of_stay"),
        "l90d_revenue":            to_usd(pm.get("l90d_revenue")),
        "l90d_avg_rate":           to_usd(pm.get("l90d_avg_rate")),
        "l90d_occupancy":          pm.get("l90d_occupancy"),
        "l90d_revpar":             to_usd(pm.get("l90d_revpar")),
        "l90d_reserved_days":      pm.get("l90d_days_reserved"),
        "amenities":               json.dumps(amenities) if amenities else None,
    }


def fase_b(session: requests.Session, conn, dry_run: bool) -> dict:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("SELECT listing_id, barrio_id FROM raw.airbnb_listings_portal ORDER BY listing_id")
    existing = [dict(r) for r in cur.fetchall()]
    print(f"\n  Listings a refrescar: {len(existing)}")

    updated = 0
    failed  = 0
    cost    = 0.0

    for i, row in enumerate(existing, 1):
        lid = row["listing_id"]
        charge("airroi", "listings", 0.01)
        resp = session.get(f"{BASE}/listings", params={"id": lid}, timeout=20)
        cost += 0.01
        time.sleep(DELAY)

        if resp.status_code == 404:
            print(f"    [{i}/{len(existing)}] {lid}: NOT FOUND en AirROI")
            failed += 1
            continue
        if resp.status_code != 200:
            print(f"    [{i}/{len(existing)}] {lid}: HTTP {resp.status_code}")
            failed += 1
            continue

        mapped = _map_listing(resp.json(), lid)
        mapped["barrio_id"] = row["barrio_id"]

        print(
            f"    [{i}/{len(existing)}] {lid}: occ={mapped['ttm_occupancy']}"
            f" adr=${mapped['ttm_avg_rate']} rev=${mapped['ttm_revenue']}"
        )

        if not dry_run:
            cols  = [k for k in mapped if k != "listing_id"]
            sets  = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
            ph    = ", ".join(["%s"] * (len(cols) + 1))
            vals  = [mapped["listing_id"]] + [mapped[c] for c in cols]
            cur.execute(
                f"""
                INSERT INTO raw.airbnb_listings_portal
                    (listing_id, {", ".join(cols)}, fecha_descarga)
                VALUES ({ph}, NOW())
                ON CONFLICT (listing_id) DO UPDATE SET
                    {sets},
                    fecha_descarga = NOW()
                """,
                vals,
            )
            updated += 1

    if not dry_run:
        conn.commit()

    print(f"\n  Fase B: {updated} actualizados, {failed} fallidos, costo ~${cost:.2f}")
    return {"updated": updated, "failed": failed, "cost": cost}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--fase", choices=["A", "B"], help="Ejecutar solo una fase")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"x-api-key": API_KEY, "Accept": "application/json"})

    conn = psycopg2.connect(DB_URL)

    run_a = args.fase in (None, "A")
    run_b = args.fase in (None, "B")

    if run_a:
        print("\n╔══════════════════════════════════════╗")
        print("║  FASE A — AirROI /markets/search      ║")
        print("╚══════════════════════════════════════╝")
        stats_a = fase_a(session, conn, args.dry_run)
        print("\n── Resumen Fase A ───────────────────────")
        total_d = sum(v["districts"] for v in stats_a.values())
        total_m = sum(v["matched"]   for v in stats_a.values())
        for mun, v in stats_a.items():
            pct = round(v["matched"] * 100 / v["districts"], 1) if v["districts"] else 0
            print(f"  {mun:15} {v['matched']:3}/{v['districts']:3} distritos matched ({pct}%)")
        print(f"  TOTAL            {total_m:3}/{total_d:3}")

    if run_b:
        print("\n╔══════════════════════════════════════╗")
        print("║  FASE B — AirROI /listings refresh    ║")
        print("╚══════════════════════════════════════╝")
        stats_b = fase_b(session, conn, args.dry_run)

    conn.close()

    if not args.dry_run:
        print("\n✓ Listo. Ejecutar ahora:")
        print("  python scripts/compute_barrios_airbnb.py")


if __name__ == "__main__":
    main()
