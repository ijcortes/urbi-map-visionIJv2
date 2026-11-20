"""
Scraper de MedellinLiving Real Estate — agencia premium El Poblado/Laureles.

Estrategia:
  1. Descarga la homepage y páginas de listado para obtener URLs de propiedades.
  2. Por cada URL de propiedad, descarga la página de detalle.
  3. Extrae todos los campos disponibles (precio COP + USD, área, hab, baños,
     parqueaderos, piso, amenidades, fotos, descripción, barrio).
  4. Guarda en raw.listings_premium con fuente_tipo='agencia_premium'.

Sin coordenadas: MedellinLiving no expone lat/lon.
  → La función geocode_premium_centroids() asigna centroide del barrio.

Uso:
    python scripts/scrape_medellinliving.py
    python scripts/scrape_medellinliving.py --dry-run
    python scripts/scrape_medellinliving.py --limit 20
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

BASE_URL  = "https://www.medellinlivingrealestate.com"
# All known property paths (discovered via recursive crawl 2026-05-30).
# Crawl strategy: each property page links to ~9 related properties;
# starting from homepage featured listings and following all links until
# the graph is exhausted yields the full catalog.
KNOWN_PROPERTY_PATHS = [
    "/property/3-bed-apartment-with-0fb30e61",
    "/property/3-bedroom-eco-home-a427fde8",
    "/property/4-bedroom-apartment-with-5ed6f6d2",
    "/property/airbnb-income-property-with-43dad324",
    "/property/airbnb-licensed-luxury-home-for-sale-in-medell-n-el-tesoro-el-poblado-994161d4",
    "/property/apartment-for-sale-in-4a7ff396",
    "/property/brand-new-apartment-with-93a4fbff",
    "/property/el-poblado-renovation-opportunity-d9e08d24",
    "/property/elegant-4-bedroom-family-home-for-sale-in-medell-n-san-lucas-area-b9b66866",
    "/property/elegant-5-bedroom-luxury-c4c47c9a",
    "/property/exceptional-5-bedroom-house-in-las-palmas-medell-n-55c9122c",
    "/property/for-sale-in-calasanz-a3f18d25",
    "/property/for-sale-in-provenza-ab41f963",
    "/property/for-sale-spectacular-city-0d54d5c6",
    "/property/fully-remodeled-3-bedroom-2d461a45",
    "/property/fully-renovated-3-level-4e4b6ea2",
    "/property/laureles-apartment-for-sale-76e292f8",
    "/property/luxurious-3-bedroom-penthouse-2ad857c6",
    "/property/luxury-4-bedroom-penthouse-in-el-poblado-with-jacuzzi-75ae292b",
    "/property/luxury-7-bedroom-penthouse-8a6c3332",
    "/property/luxury-apartment-with-short-458b5976",
    "/property/luxury-duplex-with-short-d6be5877",
    "/property/luxury-penthouse-with-private-491792c2",
    "/property/modern-1-bedroom-apartment-94ad214c",
    "/property/modern-2-bedroom-apartment-31217a99",
    "/property/modern-2-bedroom-apartment-8bd4bd2b",
    "/property/modern-3-bedroom-apartment-c1893d4b",
    "/property/new-3-bedroom-apartment-499b9343",
    "/property/new-apartment-for-sale-30dfdda6",
    "/property/penthouse-with-private-rooftop-53d09b5a",
    "/property/premium-furnished-2-bedroom-283374b5",
    "/property/private-4-bedroom-lakefront-45f6c10e",
    "/property/remodeled-3-bedroom-house-eca8a02f",
    "/property/short-term-rental-approved-32093cea",
    "/property/spacious-3-bedroom-apartment-67e413da",
    "/property/spacious-3-bedroom-apartment-bb9deb46",
    "/property/spacious-3-level-home-b94ae636",
    "/property/spacious-4-bedroom-apartment-4e32b2e5",
    "/property/spacious-4-bedroom-apartment-b5ac0536",
    "/property/spacious-5-bedroom-duplex-e436bfb8",
    "/property/str-approved-2-bedroom-c94e60f9",
    "/property/stunning-2-bedroom-apartment-e366f6c8",
    "/property/turn-key-4-bedroom-431a0a47",
    "/property/ultra-luxury-5-bedroom-5ca40df7",
]

SEED_URLS = ["/", "/search", "/buy"]
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Referer": BASE_URL + "/",
}

DB_URL = os.getenv("DATABASE_URL") or (
    f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST','localhost')}:{os.getenv('POSTGRES_PORT','5432')}"
    f"/{os.getenv('POSTGRES_DB')}"
)

UPSERT_SQL = """
INSERT INTO raw.listings_premium (
    fuente, fuente_tipo, titulo, descripcion,
    precio_cop, precio_usd,
    area_m2, habitaciones, banos, parqueaderos, piso,
    amenidades, barrio_raw, municipio,
    url, fotos,
    tipo_operacion, tipo_inmueble,
    fecha_scraping, dedup_hash,
    lat, lon
)
VALUES (
    %(fuente)s, %(fuente_tipo)s, %(titulo)s, %(descripcion)s,
    %(precio_cop)s, %(precio_usd)s,
    %(area_m2)s, %(habitaciones)s, %(banos)s, %(parqueaderos)s, %(piso)s,
    %(amenidades)s, %(barrio_raw)s, %(municipio)s,
    %(url)s, %(fotos)s,
    %(tipo_operacion)s, %(tipo_inmueble)s,
    %(fecha_scraping)s, %(dedup_hash)s,
    %(lat)s, %(lon)s
)
ON CONFLICT (url) DO UPDATE SET
    titulo         = EXCLUDED.titulo,
    descripcion    = EXCLUDED.descripcion,
    precio_cop     = EXCLUDED.precio_cop,
    precio_usd     = EXCLUDED.precio_usd,
    area_m2        = EXCLUDED.area_m2,
    habitaciones   = EXCLUDED.habitaciones,
    banos          = EXCLUDED.banos,
    parqueaderos   = EXCLUDED.parqueaderos,
    piso           = EXCLUDED.piso,
    amenidades     = EXCLUDED.amenidades,
    barrio_raw     = EXCLUDED.barrio_raw,
    fotos          = EXCLUDED.fotos,
    tipo_operacion = EXCLUDED.tipo_operacion,
    tipo_inmueble  = EXCLUDED.tipo_inmueble,
    fecha_scraping = EXCLUDED.fecha_scraping,
    dedup_hash     = EXCLUDED.dedup_hash,
    lat            = COALESCE(EXCLUDED.lat, raw.listings_premium.lat),
    lon            = COALESCE(EXCLUDED.lon, raw.listings_premium.lon);
"""

GEOCODE_CENTROID_SQL = """
-- Step 1: assign barrio_id via real PIP for listings with real coords
UPDATE raw.listings_premium lp
SET barrio_id = b.id
FROM raw.barrios b
WHERE lp.fuente = 'medellinliving'
  AND lp.lat IS NOT NULL AND lp.lon IS NOT NULL
  AND lp.barrio_id IS NULL
  AND ST_Within(
      ST_SetSRID(ST_MakePoint(lp.lon::float, lp.lat::float), 4326),
      b.geometry
  );

-- Step 2: centroid fallback for listings still missing barrio_id or real coords
UPDATE raw.listings_premium lp
SET
    barrio_id = b.id,
    lat  = COALESCE(lp.lat, ROUND(ST_Y(ST_Centroid(b.geometry))::numeric, 6)),
    lon  = COALESCE(lp.lon, ROUND(ST_X(ST_Centroid(b.geometry))::numeric, 6)),
    geom = COALESCE(lp.geom, ST_Centroid(b.geometry))
FROM (
    SELECT DISTINCT ON (nombre) id, nombre, geometry
    FROM raw.barrios
    WHERE geometry IS NOT NULL
    ORDER BY nombre
) b
WHERE lp.fuente = 'medellinliving'
  AND lp.barrio_raw IS NOT NULL
  AND lp.barrio_id IS NULL
  AND UPPER(b.nombre) = UPPER(lp.barrio_raw);
"""


# ── Parsers ───────────────────────────────────────────────────────────────────

def _get(session: requests.Session, url: str, retries: int = 3) -> str | None:
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            if attempt < retries - 1:
                wait = 5 * (attempt + 1)
                log.warning(f"Retry {attempt+1}/{retries} for {url}: {e} — waiting {wait}s")
                time.sleep(wait)
            else:
                log.warning(f"Error fetching {url}: {e}")
    return None


def _parse_price(text: str) -> int | None:
    """'$8,943,984,000 COP' → 8943984000"""
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def _parse_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"(\d+)", text)
    return int(m.group(1)) if m else None


def _parse_float(text: str | None) -> float | None:
    if not text:
        return None
    m = re.search(r"([\d]+[\.,]?[\d]*)", text)
    return float(m.group(1).replace(",", ".")) if m else None


def _dedup_hash(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()


def _infer_tipo_operacion(url: str, soup: BeautifulSoup) -> str:
    url_lower = url.lower()
    if "rent" in url_lower or "arriendo" in url_lower:
        return "arriendo"
    text = soup.get_text(" ", strip=True).lower()
    if "for rent" in text or "arriendo" in text:
        return "arriendo"
    return "venta"


def _infer_tipo_inmueble(soup: BeautifulSoup) -> str:
    text = soup.get_text(" ", strip=True).upper()
    if "PENTHOUSE" in text:
        return "apartamento"
    if "APARTMENT" in text or "APARTAMENTO" in text:
        return "apartamento"
    if "HOUSE" in text or "CASA" in text:
        return "casa"
    if "OFFICE" in text or "OFICINA" in text:
        return "oficina"
    return "apartamento"


def collect_property_urls(session: requests.Session) -> set[str]:
    """Return all known property URLs (hardcoded list + recursive discovery from seed pages)."""
    # Start with the pre-discovered catalog
    urls: set[str] = {BASE_URL + p for p in KNOWN_PROPERTY_PATHS}

    # Also crawl seed pages to catch any new listings added since last discovery
    for path in SEED_URLS:
        html = _get(session, BASE_URL + path)
        if not html:
            continue
        for m in re.finditer(r'/property/[\w-]+-[a-f0-9]{8}', html):
            urls.add(BASE_URL + m.group(0))
        log.info(f"  {path}: {len(urls)} URLs totales")
        time.sleep(2.0)

    # Recursive discovery: follow related-property links from each page
    visited: set[str] = set()
    queue = list(urls)
    while queue:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        html = _get(session, url)
        if not html:
            time.sleep(3.0)
            continue
        for m in re.finditer(r'/property/[\w-]+-[a-f0-9]{8}', html):
            new_url = BASE_URL + m.group(0)
            if new_url not in urls:
                urls.add(new_url)
                queue.append(new_url)
                log.info(f"  Nueva URL descubierta: {new_url}")
        time.sleep(2.0)

    log.info(f"Total URLs descubiertas: {len(urls)}")
    return urls


def _is_sold(html: str) -> bool:
    """Return True if the property page shows a SOLD status."""
    return bool(
        re.search(r'\bSOLD\b', html) or
        re.search(r'This property has been sold', html, re.I) or
        re.search(r'property-sold', html, re.I) or
        re.search(r'status["\s:]+["\']sold["\']', html, re.I)
    )


def parse_detail(url: str, html: str) -> dict | None:
    """Extract all fields from a property detail page."""
    soup = BeautifulSoup(html, "html.parser")
    full_text = soup.get_text(" ", strip=True)

    # ── Título ─────────────────────────────────────────────────────────────────
    h1 = soup.find("h1")
    titulo = h1.get_text(strip=True) if h1 else None
    if not titulo:
        h2 = soup.find("h2")
        titulo = h2.get_text(strip=True) if h2 else None

    # ── Precios COP y USD ──────────────────────────────────────────────────────
    # Site format: "$ 3,000,000,000 COP" or "$/m² $6,000,000 COP"
    # Take the largest COP value to avoid capturing per-m² or HOA amounts.
    precio_cop = precio_usd = None
    cop_candidates = []
    for text in re.findall(r"\$\s*[\d,]+\s*COP", full_text):
        v = _parse_price(text)
        if v and v > 500_000:
            cop_candidates.append(v)
    if cop_candidates:
        precio_cop = max(cop_candidates)
    for text in re.findall(r"\$\s*[\d,]+\s*USD", full_text):
        v = _parse_price(text)
        if v and v > 10_000:
            precio_usd = v
            break

    # ── Área m² ────────────────────────────────────────────────────────────────
    area_m2 = None
    m = re.search(r"([\d,]+)\s*m[²2²]", full_text, re.IGNORECASE)
    if m:
        area_m2 = _parse_float(m.group(1))

    # ── Habitaciones ───────────────────────────────────────────────────────────
    habitaciones = None
    m = re.search(r"(\d+)\s*(?:bed(?:room)?s?|hab(?:itaciones?)?)", full_text, re.IGNORECASE)
    if m:
        habitaciones = int(m.group(1))

    # ── Baños ──────────────────────────────────────────────────────────────────
    banos = None
    m = re.search(r"(\d+)\s*(?:bath(?:room)?s?|baños?)", full_text, re.IGNORECASE)
    if m:
        banos = _parse_float(m.group(1))

    # ── Parqueaderos ───────────────────────────────────────────────────────────
    parqueaderos = None
    m = re.search(r"(\d+)\s*(?:parking|parqueadero|garage|coche)", full_text, re.IGNORECASE)
    if m:
        parqueaderos = int(m.group(1))

    # ── Piso ───────────────────────────────────────────────────────────────────
    piso = None
    m = re.search(r"(\d+)(?:st|nd|rd|th)?\s*(?:floor|piso)", full_text, re.IGNORECASE)
    if m:
        piso = int(m.group(1))

    # ── Barrio / Zona ──────────────────────────────────────────────────────────
    # Priority: extract specific barrio from title (most reliable)
    # Patterns: "– Barrio, City"  |  "in Barrio, City"  |  "| Barrio"  |  "in Barrio"
    # Ordered from most-specific to least-specific so longer names match first.
    BARRIO_ALIASES = [
        # Specific barrios (match raw.barrios.nombre via geocode SQL)
        ("San Lucas", "SAN LUCAS"),
        ("El Tesoro", "ELTESORO"),
        ("Los Balsos", "LOS BALSOS No.2"),
        ("Alejandría", "ALEJANDRIA"),
        ("Alejandria", "ALEJANDRIA"),
        ("Provenza", "EL POBLADO"),   # Provenza es microzona de El Poblado
        ("Buenos Aires", "BUENOS AIRES"),
        ("La Florida", "LA FLORIDA"),
        ("Conquistadores", "CONQUISTADORES"),
        ("Los Colores", "LOS COLORES"),
        ("Calasanz", "CALASANZ"),
        ("Suramerica", "SURAMERICA"),
        ("Estadio", "ESTADIO"),
        ("Carlos E.", "CARLOS E. RESTREPO"),
        ("Manila", "MANILA"),
        ("Astorga", "ASTORGA"),
        ("Castropol", "CASTROPOL"),
        ("La Calleja", "LA CALLEJA"),
        ("Santa María", "SANTA MARIA DE LOS ANGELES"),
        ("Patio Bonito", "PATIO BONITO"),
        # Commune-level fallbacks
        ("Envigado", "ENVIGADO"),
        ("Laureles", "LAURELES"),
        ("Belén", "BELEN"),
        ("Belen", "BELEN"),
        ("Robledo", "ROBLEDO"),
        ("El Poblado", "EL POBLADO"),
        ("Poblado", "EL POBLADO"),
        ("Sabaneta", "SABANETA"),
        ("Bello", "BELLO"),
        ("Itagüí", "ITAGUI"),
        ("Itagui", "ITAGUI"),
    ]

    barrio_raw = None

    # 1. Try to extract from title/h1 — patterns after "–", "in", "|"
    if titulo:
        for pattern in [
            r"[–—-]\s*([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)(?:,|\s+Medell[ií]n|\s+Area|\s*$)",
            r"\bin\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)(?:,|\s+Medell[ií]n|\s*$)",
            r"\|\s*([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)(?:,|\s+Medell[ií]n|\s*$)",
        ]:
            m_title = re.search(pattern, titulo)
            if m_title:
                candidate = m_title.group(1).strip()
                for alias, nombre in BARRIO_ALIASES:
                    if alias.lower() in candidate.lower():
                        barrio_raw = nombre
                        break
            if barrio_raw:
                break

    # 2. Fallback: scan full page text
    if not barrio_raw:
        for alias, nombre in BARRIO_ALIASES:
            if alias.lower() in full_text.lower():
                barrio_raw = nombre
                break

    # ── Amenidades ─────────────────────────────────────────────────────────────
    amenidades_keywords = [
        "Pool", "Gym", "Spa", "Rooftop", "Coworking", "Concierge", "Security",
        "Elevator", "Doorman", "Parking", "Storage", "Terrace", "Balcony",
        "Jacuzzi", "Sauna", "BBQ", "Garden", "Playground", "Tennis",
        "Squash", "Cinema", "Events Room", "Restaurant", "Coffee",
    ]
    amenidades = [kw for kw in amenidades_keywords if kw.lower() in full_text.lower()]

    # ── Fotos (Supabase CDN) ───────────────────────────────────────────────────
    fotos = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if "supabase.co" in src and "property-images" in src:
            if src not in fotos:
                fotos.append(src)

    # ── Descripción ────────────────────────────────────────────────────────────
    desc_parts = []
    for tag in soup.find_all(["p"], limit=10):
        t = tag.get_text(strip=True)
        if len(t) > 80:
            desc_parts.append(t)
    descripcion = " ".join(desc_parts[:3]) if desc_parts else None

    # ── Coordenadas reales (GeoJSON embebido en Next.js RSC) ──────────────────
    lat_real = lon_real = None
    m_coord = re.search(
        r'\\?"coordinates\\?"\s*:\s*\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]',
        full_text,
    )
    if m_coord:
        lon_c, lat_c = float(m_coord.group(1)), float(m_coord.group(2))
        if -76.5 < lon_c < -74 and 5 < lat_c < 8:
            lon_real, lat_real = lon_c, lat_c

    # Skip listings without minimal required fields
    if not precio_cop and not precio_usd:
        log.debug(f"  Skipping {url}: sin precio")
        return None

    return {
        "fuente":         "medellinliving",
        "fuente_tipo":    "agencia_premium",
        "titulo":         titulo,
        "descripcion":    descripcion,
        "precio_cop":     precio_cop,
        "precio_usd":     precio_usd,
        "area_m2":        area_m2,
        "habitaciones":   habitaciones,
        "banos":          banos,
        "parqueaderos":   parqueaderos,
        "piso":           piso,
        "amenidades":     amenidades or None,
        "barrio_raw":     barrio_raw,
        "municipio":      "MEDELLIN",
        "url":            url,
        "fotos":          fotos or None,
        "tipo_operacion": _infer_tipo_operacion(url, soup),
        "tipo_inmueble":  _infer_tipo_inmueble(soup),
        "fecha_scraping": datetime.now(timezone.utc).isoformat(),
        "dedup_hash":     _dedup_hash(url),
        "lat":            lat_real,
        "lon":            lon_real,
    }


# ── DB ────────────────────────────────────────────────────────────────────────

def save_listings(listings: list[dict]) -> int:
    if not listings:
        return 0
    conn = psycopg2.connect(DB_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_batch(cur, UPSERT_SQL, listings, page_size=20)
        # Assign barrio centroids for those without coords
        with conn:
            with conn.cursor() as cur:
                cur.execute(GEOCODE_CENTROID_SQL)
                log.info(f"  Centroides asignados: {cur.rowcount}")
    finally:
        conn.close()
    return len(listings)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scraper MedellinLiving Real Estate")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="Máx propiedades a scrapear")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update(HEADERS)

    log.info("=== MedellinLiving — Recolectando URLs ===")
    property_urls = collect_property_urls(session)
    log.info(f"URLs únicas encontradas: {len(property_urls)}")

    if args.limit:
        property_urls = set(list(property_urls)[: args.limit])

    listings: list[dict] = []
    skipped_sold = 0
    for i, url in enumerate(sorted(property_urls), 1):
        log.info(f"  [{i}/{len(property_urls)}] {url}")
        html = _get(session, url)
        if not html:
            continue
        if _is_sold(html):
            log.info(f"    → SOLD, skipping")
            skipped_sold += 1
            continue
        item = parse_detail(url, html)
        if item:
            listings.append(item)
        time.sleep(2.0)

    log.info(f"  Skipped sold: {skipped_sold}")

    log.info(f"\nTotal parseados: {len(listings)}")

    if args.dry_run:
        for l in listings[:3]:
            print(json.dumps({k: v for k, v in l.items() if k != "descripcion"},
                             ensure_ascii=False, indent=2, default=str))
        log.info("[dry-run] Sin cambios en DB")
        return

    saved = save_listings(listings)
    log.info(f"Guardados {saved} listings en raw.listings_premium")

    # Resumen
    print("\n=== RESUMEN MEDELLINLIVING ===")
    print(f"  URLs encontradas  : {len(property_urls)}")
    print(f"  Listings válidos  : {len(listings)}")
    con_precio_usd = sum(1 for l in listings if l.get("precio_usd"))
    con_fotos      = sum(1 for l in listings if l.get("fotos"))
    con_amenidades = sum(1 for l in listings if l.get("amenidades"))
    print(f"  Con precio USD    : {con_precio_usd}")
    print(f"  Con fotos         : {con_fotos}")
    print(f"  Con amenidades    : {con_amenidades}")
    if listings:
        precios = [l["precio_cop"] for l in listings if l.get("precio_cop")]
        if precios:
            print(f"  Precio avg        : ${sum(precios)/len(precios)/1e6:.0f}M COP")
            print(f"  Precio min        : ${min(precios)/1e6:.0f}M COP")
            print(f"  Precio max        : ${max(precios)/1e6:.0f}M COP")


if __name__ == "__main__":
    main()
