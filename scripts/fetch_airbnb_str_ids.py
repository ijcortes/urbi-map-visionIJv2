"""
Descubre Airbnb listing IDs para todo el Valle de Aburrá y los enriquece via AirROI.

FASE C — Descubrir IDs (Playwright, sin AirROI):
  - Scrape Airbnb STR search pages por municipio y distrito
  - Extrae room_id + coordenadas de cada listing
  - Asigna barrio_id via PostGIS ST_Contains
  - Inserta en raw.airbnb_listings_portal (métricas NULL al inicio)
  - LD_LIBRARY_PATH=/home/edwlearn/miniconda3/lib requerido

FASE D — Enriquecer via AirROI /listings:
  - Lee listing_ids con ttm_occupancy IS NULL de raw.airbnb_listings_portal
  - Consulta AirROI /listings para cada uno
  - Actualiza TTM metrics, ocupación, ADR, RevPAR, ratings
  - Requiere balance en cuenta AirROI

Uso:
  LD_LIBRARY_PATH=/home/edwlearn/miniconda3/lib python scripts/fetch_airbnb_str_ids.py
  LD_LIBRARY_PATH=/home/edwlearn/miniconda3/lib python scripts/fetch_airbnb_str_ids.py --fase C
  python scripts/fetch_airbnb_str_ids.py --fase D          # AirROI enrichment only
  python scripts/fetch_airbnb_str_ids.py --fase C --dry-run
  python scripts/fetch_airbnb_str_ids.py --fase C --municipio Envigado
  python scripts/fetch_airbnb_str_ids.py --fase D --max-listings 100
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from datetime import date, timedelta
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
USD_TO_COP = float(os.getenv("USD_TO_COP", "4163"))

# (display_name, airbnb_slug, municipio_db)
# For each municipio: search at city level + specific high-density districts
SEARCH_TARGETS = [
    # Envigado — 538 listings vía /markets/search
    ("Envigado",          "Envigado--Antioquia--Colombia",                    "ENVIGADO"),
    ("La Magnolia",       "La-Magnolia--Envigado--Antioquia--Colombia",       "ENVIGADO"),
    ("La Paz Envigado",   "La-Paz--Envigado--Antioquia--Colombia",            "ENVIGADO"),
    # Sabaneta — 447 listings
    ("Sabaneta",          "Sabaneta--Antioquia--Colombia",                    "SABANETA"),
    ("Cañaveralejo",      "Cañaveralejo--Sabaneta--Antioquia--Colombia",      "SABANETA"),
    ("San Isidro Sab",    "San-Isidro--Sabaneta--Antioquia--Colombia",        "SABANETA"),
    # Bello — 129 listings
    ("Bello",             "Bello--Antioquia--Colombia",                       "BELLO"),
    # Itagüí
    ("Itagui",            "Itagüí--Antioquia--Colombia",                      "ITAGUI"),
    # La Estrella
    ("La Estrella",       "La-Estrella--Antioquia--Colombia",                 "LA ESTRELLA"),
    # Medellín neighborhoods (extender cobertura)
    ("El Poblado",        "El-Poblado--Medellín--Antioquia--Colombia",        "MEDELLIN"),
    ("Laureles",          "Laureles--Medellín--Antioquia--Colombia",          "MEDELLIN"),
    ("Belén",             "Belén--Medellín--Antioquia--Colombia",             "MEDELLIN"),
    ("Manila",            "Manila--Medellín--Antioquia--Colombia",            "MEDELLIN"),
    ("Estadio",           "Estadio--Medellín--Antioquia--Colombia",           "MEDELLIN"),
    ("La América",        "La-América--Medellín--Antioquia--Colombia",        "MEDELLIN"),
    ("Buenos Aires",      "Buenos-Aires--Medellín--Antioquia--Colombia",      "MEDELLIN"),
    ("Aranjuez",          "Aranjuez--Medellín--Antioquia--Colombia",          "MEDELLIN"),
    ("Manrique",          "Manrique--Medellín--Antioquia--Colombia",          "MEDELLIN"),
]

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

COORD_PATTERN = re.compile(
    r'"demandStayListing"\s*:\s*\{[^}]{0,50}"id"\s*:\s*"([A-Za-z0-9+/=]+)"'
    r'[^}]{0,300}"latitude"\s*:\s*([-\d.]+)[^}]{0,100}"longitude"\s*:\s*([-\d.]+)',
    re.DOTALL,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def barrio_from_coords(conn, lat: float, lon: float) -> int | None:
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM raw.barrios
                WHERE ST_Contains(geometry, ST_SetSRID(ST_Point(%s, %s), 4326))
                LIMIT 1
                """,
                (lon, lat),
            )
            row = cur.fetchone()
            return row[0] if row else None
    except Exception:
        return None


def _extract_ids_and_coords(html: str) -> dict[str, tuple[float, float]]:
    """Returns {listing_id: (lat, lon)} from page HTML."""
    result: dict[str, tuple[float, float]] = {}
    for m in COORD_PATTERN.finditer(html):
        b64_id, lat_s, lon_s = m.group(1), m.group(2), m.group(3)
        try:
            decoded = base64.b64decode(b64_id + "==").decode("utf-8", errors="ignore")
            room_m = re.search(r":(\d+)$", decoded)
            if room_m:
                result[room_m.group(1)] = (float(lat_s), float(lon_s))
        except Exception:
            pass
    # Fallback: listingId pattern (no coords)
    for lid in re.findall(r'"listingId":"(\d+)"', html):
        if lid not in result:
            result[lid] = (None, None)
    return result


def _make_url(slug: str, offset: int = 0) -> str:
    checkin  = (date.today() + timedelta(days=7)).isoformat()
    checkout = (date.today() + timedelta(days=9)).isoformat()
    return (
        f"https://www.airbnb.com/s/{slug}/homes"
        "?tab_id=home_tab"
        "&refinement_paths%5B%5D=%2Fhomes"
        f"&checkin={checkin}&checkout={checkout}"
        "&adults=1"
        f"&items_offset={offset}"
    )


# ── Fase C: Playwright scraper ────────────────────────────────────────────────

def fase_c(conn, dry_run: bool, filter_mun: str | None, max_pages: int = 6) -> dict:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright not installed. pip install playwright")
        return {}

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    targets = SEARCH_TARGETS
    if filter_mun:
        targets = [(n, s, m) for n, s, m in targets if m == filter_mun.upper()]

    all_discovered: dict[str, dict] = {}
    total_new = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage",
                  "--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            user_agent=UA,
            locale="es-CO",
            viewport={"width": 1366, "height": 768},
            extra_http_headers={"Accept-Language": "es-CO,es;q=0.9,en;q=0.8"},
        )
        ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
        )
        page = ctx.new_page()

        for name, slug, mun_db in targets:
            print(f"\n  [{name}] [{mun_db}]")
            loc_ids: set[str] = set()

            for page_num in range(max_pages):
                offset = page_num * 18
                url    = _make_url(slug, offset)
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    time.sleep(4)
                except Exception as e:
                    print(f"    Load error p{page_num+1}: {e}")
                    break

                html = page.content()
                ids_coords = _extract_ids_and_coords(html)

                new_on_page = [k for k in ids_coords if k not in all_discovered]
                for lid in new_on_page:
                    lat, lon = ids_coords[lid]
                    barrio_id = None
                    if lat and lon:
                        barrio_id = barrio_from_coords(conn, lat, lon)

                    all_discovered[lid] = {
                        "listing_id": int(lid),
                        "latitude":   lat,
                        "longitude":  lon,
                        "barrio_id":  barrio_id,
                    }
                    loc_ids.add(lid)
                    total_new += 1

                with_barrio = sum(1 for k in new_on_page if all_discovered[k]["barrio_id"])
                print(
                    f"    p{page_num+1}: {len(ids_coords)} listings | "
                    f"{len(new_on_page)} new | barrio={with_barrio}"
                )

                # Stop if no new listings (duplicates = end of results)
                if not new_on_page and page_num > 0:
                    break

                time.sleep(2)

        browser.close()

    print(f"\n  Total descubiertos: {len(all_discovered)} listings")

    if not dry_run:
        inserted = 0
        skipped  = 0
        for lid_str, info in all_discovered.items():
            try:
                cur.execute(
                    """
                    INSERT INTO raw.airbnb_listings_portal
                        (listing_id, latitude, longitude, barrio_id, fecha_descarga)
                    VALUES (%s, %s, %s, %s, NOW())
                    ON CONFLICT (listing_id) DO NOTHING
                    """,
                    (info["listing_id"], info["latitude"], info["longitude"], info["barrio_id"]),
                )
                if cur.rowcount > 0:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as e:
                print(f"    DB error {lid_str}: {e}")
        conn.commit()
        print(f"  Insertados: {inserted} nuevos, {skipped} ya existían")

    return {"total": len(all_discovered)}


# ── Fase D: AirROI enrichment ─────────────────────────────────────────────────

def _map_listing(data: dict, listing_id: int) -> dict:
    li = data.get("listing_info", {})
    hi = data.get("host_info", {})
    lo = data.get("location_info", {})
    pd = data.get("property_details", {})
    bs = data.get("booking_settings", {})
    pr = data.get("pricing_info", {})
    ra = data.get("ratings", {})
    pm = data.get("performance_metrics", {})

    currency     = pr.get("currency", "COP")
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


def fase_d(conn, dry_run: bool, max_listings: int | None, delay: float = 1.2) -> dict:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Only enrich listings without TTM data (newly discovered)
    cur.execute(
        """
        SELECT listing_id, barrio_id FROM raw.airbnb_listings_portal
        WHERE ttm_occupancy IS NULL
        ORDER BY listing_id
        LIMIT %s
        """,
        (max_listings or 10000,),
    )
    to_enrich = [dict(r) for r in cur.fetchall()]
    print(f"\n  Listings a enriquecer: {len(to_enrich)}")

    if not to_enrich:
        print("  Nada que enriquecer.")
        return {"enriched": 0}

    session = requests.Session()
    session.headers.update({"x-api-key": API_KEY, "Accept": "application/json"})

    enriched  = 0
    not_found = 0
    errors    = 0
    cost      = 0.0

    for i, row in enumerate(to_enrich, 1):
        lid = row["listing_id"]
        charge("airroi", "listings", 0.01)
        resp = session.get(f"{BASE}/listings", params={"id": lid}, timeout=20)
        cost += 0.01
        time.sleep(delay)

        if resp.status_code == 404:
            print(f"    [{i}/{len(to_enrich)}] {lid}: NOT FOUND (listing may not exist in AirROI)")
            not_found += 1
            continue
        if resp.status_code == 403:
            print(f"    [{i}/{len(to_enrich)}] {lid}: 403 FORBIDDEN — balance agotado. Top up cuenta AirROI.")
            print(f"    Procesados antes de fallo: {enriched} enriquecidos, costo ~${cost:.2f}")
            break
        if resp.status_code != 200:
            print(f"    [{i}/{len(to_enrich)}] {lid}: HTTP {resp.status_code}")
            errors += 1
            continue

        mapped = _map_listing(resp.json(), lid)
        # Keep existing barrio_id if AirROI response has coords but we already have barrio_id
        if row.get("barrio_id"):
            mapped["barrio_id"] = row["barrio_id"]
        elif mapped.get("latitude") and mapped.get("longitude"):
            mapped["barrio_id"] = None  # will be updated by coords

        print(
            f"    [{i}/{len(to_enrich)}] {lid}: occ={mapped['ttm_occupancy']:.2f}"
            f" adr=${mapped['ttm_avg_rate']} rev=${mapped['ttm_revenue']}"
        ) if mapped.get("ttm_occupancy") else print(f"    [{i}/{len(to_enrich)}] {lid}: no TTM data")

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
            enriched += 1

    if not dry_run:
        conn.commit()

    print(f"\n  Fase D: {enriched} enriquecidos, {not_found} no encontrados, costo ~${cost:.2f}")
    return {"enriched": enriched, "not_found": not_found, "cost": cost}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",      action="store_true")
    parser.add_argument("--fase",         choices=["C", "D"], help="Solo una fase")
    parser.add_argument("--municipio",    help="Fase C: solo este municipio (ej. ENVIGADO)")
    parser.add_argument("--max-pages",    type=int, default=6, help="Fase C: páginas Airbnb por búsqueda")
    parser.add_argument("--max-listings", type=int, default=None, help="Fase D: máx listings a enriquecer")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL)

    run_c = args.fase in (None, "C")
    run_d = args.fase in (None, "D")

    if run_c:
        print("\n╔══════════════════════════════════════════╗")
        print("║  FASE C — Descubrir listing IDs Airbnb   ║")
        print("╚══════════════════════════════════════════╝")
        stats_c = fase_c(conn, args.dry_run, args.municipio, args.max_pages)
        print(f"\n  Total IDs descubiertos: {stats_c.get('total', 0)}")

    if run_d:
        print("\n╔══════════════════════════════════════════╗")
        print("║  FASE D — Enriquecer via AirROI /listings ║")
        print("╚══════════════════════════════════════════╝")
        stats_d = fase_d(conn, args.dry_run, args.max_listings)

    conn.close()

    if not args.dry_run and (run_c or run_d):
        print("\n✓ Listo. Ejecutar ahora:")
        print("  python scripts/compute_barrios_airbnb.py")


if __name__ == "__main__":
    main()
