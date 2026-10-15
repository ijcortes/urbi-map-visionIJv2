"""
Fincaraiz.com.co scraper for Valle de Aburrá.

Findings from reverse-engineering:
  - Correct URL: /venta/apartamentos/{slug}/antioquia  (or /arriendo/...)
  - Pagination: ?page=N  (NOT ?pagina=N)
  - Data in: __NEXT_DATA__ → props.pageProps.fetchResult.searchFast.data
  - Pagination info: paginatorInfo.{currentPage, lastPage, total, hasMorePages}
  - Listing fields: latitude, longitude, price.amount, m2Built/m2apto/m2,
                    stratum, locations.location_main.{name, slug, location_type},
                    operation_type_id (1=venta, 2=arriendo)

Run:
  python scrape_fincaraiz.py                       # all municipalities
  python scrape_fincaraiz.py --slug medellin        # one municipality
  python scrape_fincaraiz.py --slug medellin --tipo venta
  python scrape_fincaraiz.py --max-pages 5          # limit pages per combo
"""

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from config import MUNICIPIOS, MUNICIPIOS_BY_SLUG, TIPOSNEGOCIOS

sys.path.insert(0, str(Path(__file__).parent.parent))
from scraping.utils.quality import RunStats, http_get, implausible_reason, record_run, scraper_user_agent  # noqa: E402

RAW_DIR = Path(__file__).parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

# Verified 2026-06-04: all URLs return 200+__NEXT_DATA__. locales-comerciales redirects → use locales.
# edificios-apartamentos / edificios-oficinas redirect → excluded.
TIPOS_FINCARAIZ: dict[str, str] = {
    "apartamento":   "apartamentos",
    "apartaestudio": "apartaestudios",
    "casa":          "casas",
    "local":         "locales",
    "oficina":       "oficinas",
    "bodega":        "bodegas",
    "consultorio":   "consultorios",
    "lote":          "lotes",
    "casa_lote":     "casas-lotes",
    "finca":         "fincas",
}

HEADERS = {
    "User-Agent": scraper_user_agent(),
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.fincaraiz.com.co/",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

# Pages per (slug, tipo) combo. 482 pages × 21 listings = 10,120 for Medellín venta.
# A full pass must reach the end (coverage gap: 20 pages left Medellín venta at
# 670 rows vs Envigado 861). Incremental passes stop on old pages long before.
DEFAULT_MAX_PAGES = int(os.getenv("FINCARAIZ_MAX_PAGES", "600"))
DELAY = 1.8  # seconds between requests (respectful crawling)

# URL patterns (confirmed working)
# tipo "venta" → /venta/apartamentos/{slug}/antioquia
# tipo "arriendo" → /arriendo/apartamentos/{slug}/antioquia
BASE_URL = "https://www.fincaraiz.com.co/{operacion}/{tipo_url}/{slug}/antioquia"

# Valle de Aburrá bounding box: cheap pre-filter only. It includes Rionegro /
# Guarne, so the loaders re-check every point against the barrio polygons
# (scraping/utils/quality.in_valle) before anything reaches the DB.
LAT_MIN, LAT_MAX = 5.95, 6.55
LNG_MIN, LNG_MAX = -75.85, -75.30

STATS = RunStats("fincaraiz")
COVERAGE: list[tuple[str, int | None, int, int]] = []


def in_valle_aburra(lat, lng) -> bool:
    try:
        return LAT_MIN <= float(lat) <= LAT_MAX and LNG_MIN <= float(lng) <= LNG_MAX
    except (TypeError, ValueError):
        return False


def fetch_html(url: str) -> str | None:
    r = http_get(SESSION, url, timeout=25, stats=STATS)
    if r is None:
        print(f"  ERROR fetching {url} (after retries)")
        return None
    return r.text


def extract_next_data(html: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag:
        return None
    try:
        return json.loads(tag.string)
    except json.JSONDecodeError:
        return None


def parse_search_fast(next_data: dict) -> tuple[list[dict], dict]:
    """Extract (listings_raw, paginatorInfo) from __NEXT_DATA__."""
    try:
        sf = next_data["props"]["pageProps"]["fetchResult"]["searchFast"]
        return sf.get("data", []), sf.get("paginatorInfo", {})
    except (KeyError, TypeError):
        return [], {}


_AREA_TIPO = {"m2Built": "construida", "m2apto": "privada", "m2": "total"}


def get_area(raw: dict) -> tuple[float, str | None]:
    """Best area estimate and which definition it is. m2Built > m2apto > m2."""
    for key in ("m2Built", "m2apto", "m2"):
        val = raw.get(key)
        if val and float(val) > 0:
            return float(val), _AREA_TIPO[key]
    return 0.0, None


class OutOfScope(Exception):
    """Valid listing we deliberately skip (outside the Valle, foreign currency)."""


def _moneda(price_obj: dict) -> str:
    name = str(((price_obj or {}).get("currency") or {}).get("name") or "$").strip().upper()
    return "COP" if name in ("$", "COP", "COP$") else name


def normalize_listing(raw: dict, slug: str, tipo_negocio: str, tipo_inmueble: str) -> dict | None:
    """
    Normalize a fincaraiz listing to our schema.
    Returns None if required fields are missing; raises OutOfScope for listings
    skipped on purpose (outside the Valle, foreign currency). Any other exception
    is a parse failure and is counted by the caller (schema-drift alarm).
    """
    # Coordinates
    lat = raw.get("latitude")
    lng = raw.get("longitude")
    if not in_valle_aburra(lat, lng):
        raise OutOfScope("outside Valle box")

    # Price (+ currency: a USD price stored as pesos was off by ~4000x)
    price_obj = raw.get("price") or {}
    moneda = _moneda(price_obj)
    if moneda != "COP":
        raise OutOfScope(f"currency {moneda}")
    precio = price_obj.get("amount") or 0
    if not precio or precio <= 0:
        return None

    # Area
    area, area_tipo = get_area(raw)
    if area <= 0:
        # Some listings don't have area — still useful for arriendo stats
        area = 0.0

    precio_m2 = int(precio / area) if area > 0 else 0

    # Barrio from locations
    locs = raw.get("locations") or {}
    main = locs.get("location_main") or {}
    barrio = (main.get("name") or "").upper().strip()
    if not barrio:
        return None

    # Paid placement + advertiser kind (highlight > 0 = paid highlight level)
    destacado = bool(raw.get("highlight")) or bool(raw.get("isMapFeatured"))
    owner = raw.get("owner") or {}
    anunciante_tipo = (owner.get("type") or ("particular" if owner.get("particular") else None))

    # Municipio — get from city field in locations
    city_info = locs.get("city")
    if isinstance(city_info, list) and city_info:
        city_info = city_info[0]
    municipio = ""
    if isinstance(city_info, dict):
        municipio = (city_info.get("name") or "").upper().strip()

    estrato = raw.get("stratum") or 0

    listing_id = raw.get("id")
    url = f"https://www.fincaraiz.com.co/ficha/{listing_id}" if listing_id else None

    # Rich fields available in searchFast response
    descripcion = (raw.get("description") or "").strip() or None
    amenidades = [f["name"] for f in (raw.get("facilities") or []) if f.get("name")]
    direccion = raw.get("address") if raw.get("showAddress") else None
    habitaciones = raw.get("rooms") or raw.get("bedrooms")
    banos = raw.get("bathrooms")
    garajes = raw.get("garage")
    precio_usd = raw.get("price_amount_usd")

    # Photos — images[].image contains full CDN URLs
    fotos = [
        img["image"] for img in (raw.get("images") or [])
        if img.get("image")
    ][:12]

    # Publish date — created_at in ISO format
    fecha_pub_str = raw.get("created_at") or raw.get("updated_at")
    fecha_pub: date | None = None
    if fecha_pub_str:
        try:
            fecha_pub = datetime.fromisoformat(str(fecha_pub_str)[:10]).date()
        except ValueError:
            pass

    return {
        "barrio": barrio,
        "municipio_slug": slug,
        "municipio": municipio,
        "precio": int(precio),
        "precio_usd": int(precio_usd) if precio_usd else None,
        "area": round(area, 2),
        "precio_m2": precio_m2,
        "tipo": tipo_negocio,
        "tipo_inmueble": tipo_inmueble,
        "estrato": int(estrato) if estrato else 0,
        "lat": round(float(lat), 7),
        "lng": round(float(lng), 7),
        "id": listing_id,
        "url": url,
        "descripcion": descripcion,
        "amenidades": amenidades,
        "direccion": direccion,
        "habitaciones": int(habitaciones) if habitaciones else None,
        "banos": int(banos) if banos else None,
        "garajes": int(garajes) if garajes else None,
        "fotos": fotos,
        "fecha_publicacion": fecha_pub.isoformat() if fecha_pub else None,
        "destacado": destacado,
        "anunciante_tipo": anunciante_tipo,
        "moneda": moneda,
        "precio_incluye_admin": bool(raw.get("include_administration")),
        "area_tipo": area_tipo,
    }


def scrape_municipio_tipo(
    slug: str,
    operacion: str,
    tipo_inmueble: str,
    tipo_url: str,
    max_pages: int,
    since_date: date | None = None,
) -> list[dict]:
    """Scrape pages for one (municipio, operacion, tipo_inmueble) combination.

    If since_date is set, stops pagination once ALL listings on a page were
    published before that date (incremental mode).
    """
    url_base = BASE_URL.format(operacion=operacion, tipo_url=tipo_url, slug=slug)
    mode = f"since {since_date}" if since_date else f"max {max_pages} pages"
    print(f"  → {url_base} ({mode})")

    listings: list[dict] = []
    seen_ids: set = set()
    config_key = f"{slug}|{tipo_inmueble}|{operacion}"
    total_listings = None
    pages_failed = 0
    consecutive_old = 0

    for page in range(1, max_pages + 1):
        url = url_base if page == 1 else f"{url_base}?page={page}"
        html = fetch_html(url)
        if not html:
            print(f"  page {page}: fetch failed")
            pages_failed += 1
            STATS.truncated_configs.append(config_key)
            break

        nd = extract_next_data(html)
        if not nd:
            # Page fetched but the data island is gone: portal markup changed.
            print(f"  page {page}: no __NEXT_DATA__")
            STATS.parse_failed += 1
            STATS.items_seen += 1
            pages_failed += 1
            STATS.truncated_configs.append(config_key)
            break

        raw_listings, pag = parse_search_fast(nd)
        if not raw_listings:
            print(f"  page {page}: 0 raw listings — stopping")
            break

        total_pages = pag.get("lastPage", max_pages)
        total_listings = pag.get("total", "?")

        page_listings = []
        old_count = 0
        for raw in raw_listings:
            lid = raw.get("id")
            if lid in seen_ids:
                continue
            seen_ids.add(lid)
            STATS.items_seen += 1
            try:
                normalized = normalize_listing(raw, slug, operacion, tipo_inmueble)
            except OutOfScope:
                STATS.rejected_other += 1
                continue
            except Exception:
                STATS.parse_failed += 1
                continue
            if not normalized:
                STATS.rejected_other += 1
                continue
            if implausible_reason(normalized["precio"], normalized["area"], tipo_inmueble, operacion):
                STATS.implausible += 1
            if since_date and normalized.get("fecha_publicacion"):
                pub = date.fromisoformat(normalized["fecha_publicacion"])
                if pub < since_date:
                    old_count += 1
                    continue
            page_listings.append(normalized)

        listings.extend(page_listings)
        print(
            f"  page {page}/{min(max_pages, total_pages)}: "
            f"+{len(page_listings)} valid, {old_count} old "
            f"(cumulative={len(listings)}, server_total={total_listings})"
        )

        # Incremental stop after 3 consecutive all-old pages (sort order by
        # publish date is not guaranteed: bumped/highlighted listings interleave).
        if since_date and old_count > 0 and len(page_listings) == 0:
            consecutive_old += 1
            if consecutive_old >= 3:
                print(f"  3 consecutive pages predate {since_date} — stopping")
                break
        else:
            consecutive_old = 0

        if not pag.get("hasMorePages") or page >= total_pages:
            print(f"  no more pages at page {page}")
            break

        time.sleep(DELAY)

    total_int = total_listings if isinstance(total_listings, int) else None
    COVERAGE.append((config_key, total_int, len(seen_ids), pages_failed))
    if not since_date and total_int and len(seen_ids) < 0.95 * total_int:
        print(f"  WARNING coverage {len(seen_ids)}/{total_int} for {config_key} — raise --max-pages")
    return listings


def save_raw(slug: str, tipo_inmueble: str, operacion: str, listings: list[dict]) -> Path:
    out = RAW_DIR / f"{slug}_{tipo_inmueble}_{operacion}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(listings, f, ensure_ascii=False, indent=2)
    print(f"  saved {len(listings)} listings → {out.name}")
    return out


def main():
    parser = argparse.ArgumentParser(description="Scrape fincaraiz.com.co — Valle de Aburrá")
    parser.add_argument("--slug", help="Single municipio slug (e.g. medellin)")
    parser.add_argument("--operacion", choices=TIPOSNEGOCIOS, help="Only scrape this operacion (venta|arriendo)")
    parser.add_argument(
        "--tipo-inmueble",
        choices=list(TIPOS_FINCARAIZ.keys()),
        help="Only scrape this tipo de inmueble",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help=f"Max pages per combination (default={DEFAULT_MAX_PAGES})",
    )
    parser.add_argument(
        "--since-days",
        type=int,
        default=None,
        help="Incremental mode: only scrape listings published in the last N days",
    )
    parser.add_argument(
        "--full-on-weekday",
        type=int,
        default=None,
        help="With --since-days: do a full pass instead on this weekday (0=Mon .. 6=Sun)",
    )
    args = parser.parse_args()
    if args.since_days is not None and args.full_on_weekday is not None \
            and date.today().weekday() == args.full_on_weekday:
        print("Full pass today (--full-on-weekday)")
        args.since_days = None

    since_date: date | None = None
    if args.since_days is not None:
        since_date = date.today() - timedelta(days=args.since_days)
        print(f"Incremental mode: only listings since {since_date}")

    slugs = [args.slug] if args.slug else [m["slug"] for m in MUNICIPIOS]
    operaciones = [args.operacion] if args.operacion else TIPOSNEGOCIOS
    tipos_iter = (
        {args.tipo_inmueble: TIPOS_FINCARAIZ[args.tipo_inmueble]}.items()
        if args.tipo_inmueble
        else TIPOS_FINCARAIZ.items()
    )

    total_saved = 0
    for slug in slugs:
        if slug not in MUNICIPIOS_BY_SLUG:
            print(f"Unknown slug: {slug}")
            continue
        for tipo_inmueble, tipo_url in tipos_iter:
            for operacion in operaciones:
                print(f"\n{'='*60}")
                print(f"Scraping: {slug} / {tipo_inmueble} / {operacion}")
                print(f"{'='*60}")
                listings = scrape_municipio_tipo(
                    slug, operacion, tipo_inmueble, tipo_url,
                    args.max_pages, since_date=since_date,
                )
                save_raw(slug, tipo_inmueble, operacion, listings)
                total_saved += len(listings)
                time.sleep(DELAY * 2)

    print(f"\nDone. Total listings saved: {total_saved}")
    print(STATS.summary())
    _save_coverage("incremental" if since_date else "full")
    return STATS.exit_code()


def _save_coverage(modo: str) -> None:
    """Coverage per (municipio, tipo, operación) → raw.scrape_runs (stale rule)."""
    if not os.getenv("DATABASE_URL") or not COVERAGE:
        return
    try:
        import psycopg2
        with psycopg2.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
            for config_key, total, seen, failed in COVERAGE:
                record_run(cur, "fincaraiz", config_key, modo, total, seen, failed)
    except Exception as e:
        print(f"  could not record raw.scrape_runs: {e}")


if __name__ == "__main__":
    sys.exit(main())
