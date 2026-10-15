"""
habi.co scraper for Valle de Aburrá — writes to raw.listings_habi.

Strategy (reverse-engineered 2026-08-23):
  - habi.co is a Gatsby SPA. The city-slug search pages (/venta-apartamentos/
    {slug}) are cosmetic — every slug serves the identical 32 nationwide
    "featured" listings, none of them geo-filtered. Real pagination happens
    client-side against a backend API discovered by clicking the page-2
    control and inspecting the network tab:

        GET https://apiv2.habi.co/listing-global-api/get_properties
            ?offset=N&limit=200&filters={}&country=CO
            header: x-api-key: <HABI_API_KEY from env>

    No Akamai bot-check on this endpoint — plain requests works, no
    Playwright/browser needed. Paginate offset until more_available=False,
    filter client-side on metropolitan_area == "Valle de Aburrá" (no
    working server-side geo filter param found — cheap enough to just
    walk the whole country and discard the rest, ~1600-2000 nationwide).
    This response already carries the bulk of what a listing needs:
    price, area, rooms, baths, parking, floor, address, stratum,
    admin fee, antiquity, lat/lon, description, photos, discount pricing.

  - A handful of fields (url_360 Matterport tour, direct contact
    correo/telefono, servicios[] utility costs, sitios_interes{} nearby
    POIs) only exist on the per-listing detail page's Gatsby page-data.json
    (/venta-apartamentos/{nid}/{slug}), which DOES sit behind Akamai and is
    unreliable even with a real browser — most of these static pages
    return 403 regardless of TLS fingerprint (confirmed with curl_cffi
    chrome124 impersonation), meaning the page simply isn't in habi's
    current build, not a bot block. Detail enrichment is therefore
    best-effort: attempted via Playwright, skipped silently on failure.
    "Externo" (aggregated from another portal) vs habi-owned inventory
    could not be cleanly derived from inventory_type_id/property_moment_id
    (checked against known list results — no clean split) — both raw
    discriminator fields are stored so the split can be derived from the
    real data distribution later instead of guessed.

Run:
  python scraping/habi/habi_scraper.py [--dry-run] [--no-detail] [--max-pages N]
"""

import os
import argparse
import json
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from config import (
    get_conn,
    load_barrios,
    match_barrio,
    make_dedup_hash,
    upsert_listing,
)

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from scraping.utils.quality import RunStats, http_get, implausible_reason, record_run, resolve_barrio, scraper_user_agent  # noqa: E402

STATS = RunStats("habi")

API_URL = "https://apiv2.habi.co/listing-global-api/get_properties"
# Portal web-client key. NOT stored in the repo: set HABI_API_KEY in the
# environment (see .env.example). The value is never logged.
API_KEY = os.getenv("HABI_API_KEY", "").strip()


def _require_api_key() -> str:
    if not API_KEY:
        raise RuntimeError(
            "HABI_API_KEY is not set. Export it (see .env.example) before running the Habi scraper."
        )
    return API_KEY
BASE_URL = "https://habi.co"
IMG_BASE = "https://d3hzflklh28tts.cloudfront.net"
PAGE_LIMIT = 200
API_DELAY = 1.0
DETAIL_DELAY = 2.0
TARGET_METRO = "Valle de Aburrá"

MUNICIPIO_HINT = {
    "Medellín": "MEDELLIN",
    "Bello": "BELLO",
    "Itagüí": "ITAGUI",
    "Envigado": "ENVIGADO",
    "Sabaneta": "SABANETA",
    "La Estrella": "LA ESTRELLA",
}

def _headers() -> dict:
    return {**_BASE_HEADERS, "x-api-key": _require_api_key()}


_BASE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://habi.co/",
    "User-Agent": scraper_user_agent(),
}


def fetch_all_valle_aburra(max_pages: int | None) -> list[dict]:
    """Paginate the nationwide feed, keep only Valle de Aburrá listings."""
    session = requests.Session()
    session.headers.update(_headers())

    matched: list[dict] = []
    offset = 0
    page = 0
    while True:
        page += 1
        if max_pages and page > max_pages:
            break
        r = http_get(
            session, API_URL,
            params={"offset": offset, "limit": PAGE_LIMIT, "filters": "{}", "country": "CO"},
            timeout=25, stats=STATS,
        )
        if r is None:
            print(f"  offset {offset}: failed after retries, stopping (run marked degraded)")
            STATS.truncated_configs.append(f"offset {offset}")
            break
        try:
            msg = r.json().get("messagge", {})
        except ValueError:
            STATS.parse_failed += 1
            STATS.items_seen += 1
            break
        items = msg.get("data", [])
        if not items:
            break
        # habi tags Rionegro (Oriente Antioqueño, not Valle de Aburrá) under this
        # same metropolitan_area — restrict to our actual 6 municipios too.
        local = [
            i for i in items
            if i.get("metropolitan_area") == TARGET_METRO and i.get("city") in MUNICIPIO_HINT
        ]
        matched.extend(local)
        print(f"  offset {offset}: {len(items)} fetched, {len(local)} in {TARGET_METRO} (cumulative={len(matched)})")

        if not msg.get("more_available"):
            break
        offset = msg.get("more_offset", offset + PAGE_LIMIT)
        time.sleep(API_DELAY)

    return matched


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_discount_rate(v) -> float | None:
    if not v:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", str(v))
    return float(m.group(1)) if m else None


def normalize(item: dict) -> dict | None:
    nid = item.get("property_nid")
    if not nid or not item.get("sale_price"):
        return None

    url = f"{BASE_URL}/venta-apartamentos/{nid}/{item.get('slug', '')}"

    images_raw = item.get("images") or ""
    fotos = [f"{IMG_BASE}/{f.strip()}" for f in images_raw.split(",") if f.strip()]

    fecha_pub = None
    pub_str = item.get("publication_date")
    if pub_str:
        try:
            fecha_pub = datetime.fromisoformat(str(pub_str))
        except ValueError:
            pass

    raw_data = {
        "observations": item.get("observations"),
        "rated": item.get("rated"),
        "tower": item.get("tower"),
        "num_apartment": item.get("num_apartment"),
        "zone_median_id": item.get("zone_median_id"),
        "zone_big_id": item.get("zone_big_id"),
        "city_id": item.get("city_id"),
        "metropolitan_id": item.get("metropolitan_id"),
        "metropolitan_area": item.get("metropolitan_area"),
        "price_observation": item.get("price_observation"),
        "num_deposito": item.get("num_deposito"),
        "lot_id": item.get("lot_id"),
    }

    return {
        "tipo_inmueble": item.get("tipo_inmueble") or "Apartamento",
        "precio": _num(item.get("sale_price")),
        "precio_anterior": _num(item.get("previous_price")),
        "discount_rate": parse_discount_rate(item.get("discount_rate")),
        "area_m2": _num(item.get("area")),
        "habitaciones": _int(item.get("room")),
        "banos": _int(item.get("bath")),
        "parqueaderos": _int(item.get("garage")),
        "piso": _int(item.get("floor")),
        "num_ascensores": _int(item.get("elevator")),
        "direccion_raw": item.get("address"),
        "barrio_raw": item.get("zone_median") or item.get("zone_big"),
        "url": url,
        "property_nid": _int(nid),
        "property_uuid": item.get("property_uuid"),
        "barrio_id": None,  # resolved in main()
        "raw_data": json.dumps(raw_data, ensure_ascii=False),
        "fecha_publicacion": fecha_pub,
        "dedup_hash": make_dedup_hash(url),
        "lat": _num(item.get("latitude")),
        "lon": _num(item.get("length")),  # habi's field name for longitude
        "municipio_raw": item.get("city"),
        "estrato_real": _int(item.get("stratum")),
        "descripcion": item.get("description"),
        "amenidades": None,
        "fotos": fotos or None,
        "antiguedad": _int(item.get("antiquity")),
        "administracion": _num(item.get("admin_price")),
        "url_360": None,
        "correo_contacto": None,
        "telefono_contacto": None,
        "contacto_zona": None,
        "has_three_checks": None,
        "inventory_type_id": _int(item.get("inventory_type_id")),
        "property_moment_id": _int(item.get("property_moment_id")),
        "is_private": None,
        "remodelado": None,
        "publicado_status": _int(item.get("published")),
        "_slug": item.get("slug"),
    }


def enrich_with_detail(listings: list[dict]) -> int:
    """Best-effort: fill url_360/contact/servicios from the per-listing detail
    page-data.json. Many of these 403 (page not in habi's current static
    build) — skip silently, this is not required for a usable scrape."""
    from playwright.sync_api import sync_playwright

    enriched = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        ))
        for listing in listings:
            nid, slug = listing["property_nid"], listing["_slug"]
            url = f"{BASE_URL}/venta-apartamentos/{nid}/{slug}"
            captured = {}

            def on_resp(resp, store=captured, nid=nid):
                if "page-data.json" in resp.url and str(nid) in resp.url:
                    try:
                        store["body"] = resp.text()
                    except Exception:
                        pass

            page.on("response", on_resp)
            try:
                resp = page.goto(url, wait_until="load", timeout=20000)
                if resp and resp.status < 400:
                    page.wait_for_timeout(300)
            except Exception:
                pass
            page.remove_listener("response", on_resp)
            time.sleep(DETAIL_DELAY)

            if "body" not in captured:
                continue
            try:
                d = json.loads(captured["body"])
                detail = d["result"]["pageContext"]["propertyDetail"]
                prop = detail.get("property") or {}
                det = prop.get("detalles_propiedad") or {}
            except (KeyError, TypeError, json.JSONDecodeError):
                continue

            listing["url_360"] = prop.get("url_360")
            # Contact e-mail/phone of the seller are personal data we never serve:
            # not stored (privacy review, Ley 1581 data minimisation).
            listing["contacto_zona"] = det.get("contacto_zona")
            listing["has_three_checks"] = bool(det.get("has_three_checks")) if det.get("has_three_checks") is not None else None
            listing["is_private"] = bool(det.get("is_private")) if det.get("is_private") is not None else None
            listing["remodelado"] = bool(det.get("remodelation")) if det.get("remodelation") is not None else None
            extra = {
                "servicios": prop.get("servicios"),
                "sitios_interes": detail.get("sitios_interes"),
                "icon_details": detail.get("icon_details"),
            }
            raw = json.loads(listing["raw_data"])
            raw.update(extra)
            listing["raw_data"] = json.dumps(raw, ensure_ascii=False)
            enriched += 1

        browser.close()
    return enriched


def main():
    parser = argparse.ArgumentParser(description="Scrape habi.co — Valle de Aburrá")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    parser.add_argument("--no-detail", action="store_true", help="Skip best-effort detail-page enrichment")
    parser.add_argument("--max-pages", type=int, default=None, help="Limit API pages (200 listings/page)")
    args = parser.parse_args()

    print(f"Fetching nationwide feed, filtering to {TARGET_METRO}...")
    raw_items = fetch_all_valle_aburra(args.max_pages)
    print(f"\n{len(raw_items)} {TARGET_METRO} listings found")

    listings = []
    for i in raw_items:
        STATS.items_seen += 1
        try:
            l = normalize(i)
        except Exception:
            l = None
        if l is None:
            STATS.parse_failed += 1
            continue
        if implausible_reason(l["precio"], l["area_m2"], l["tipo_inmueble"], "venta"):
            STATS.implausible += 1
        listings.append(l)
    print(f"{len(listings)} normalized successfully")

    if not args.no_detail and listings:
        print("\nAttempting detail-page enrichment (best-effort, many will 403; contact PII is not kept)...")
        n = enrich_with_detail(listings)
        print(f"  enriched {n}/{len(listings)}")

    conn = None if args.dry_run else get_conn()
    barrios = load_barrios(conn) if conn else []

    for listing in listings:
        municipio_hint = MUNICIPIO_HINT.get(listing["municipio_raw"])
        barrio_id = None
        if listing["lat"] and listing["lon"] and conn:
            try:
                with conn.cursor() as cur:
                    barrio_id = resolve_barrio(cur, listing["lat"], listing["lon"])
            except Exception:
                conn.rollback()
        if not barrio_id:
            barrio_id = match_barrio(listing["barrio_raw"], barrios, municipio_hint)
        listing["barrio_id"] = barrio_id
        listing.pop("_slug", None)

        print(
            f"  {listing['property_nid']}: {listing['municipio_raw']} / {listing['barrio_raw']} | "
            f"COP {listing['precio']:,.0f} | {listing['area_m2']}m2 | barrio_id={barrio_id}"
        )
        if conn:
            upsert_listing(conn, listing)

    if conn:
        # The feed is walked end to end every run: complete unless truncated.
        try:
            with conn, conn.cursor() as cur:
                n = len(raw_items)
                record_run(cur, "habi", "valle_aburra", "full" if not args.max_pages else "incremental",
                           n if not STATS.truncated_configs else n + 1, n, len(STATS.truncated_configs))
        except Exception as e:
            print(f"  could not record raw.scrape_runs: {e}")
        conn.close()
    print(f"\nDone. Total listings processed: {len(listings)}")
    print(STATS.summary())
    return STATS.exit_code()


if __name__ == "__main__":
    sys.exit(main())
