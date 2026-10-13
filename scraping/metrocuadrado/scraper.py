"""
Scraper Metrocuadrado — apartamentos y casas en venta y arriendo, Valle de Aburrá.

Usa la REST API interna de Metrocuadrado (no scraping de HTML).
La API sirve JSON con size=50 obligatorio; paginación por offset `from`.

Uso:
    python -m scraping.metrocuadrado.scraper                       # Medellín completo
    python -m scraping.metrocuadrado.scraper --municipios all_valle # 10 municipios
    python -m scraping.metrocuadrado.scraper --municipios envigado sabaneta
    python -m scraping.metrocuadrado.scraper --dry-run --max-pages 2
    python -m scraping.metrocuadrado.scraper --tipos venta

Reconocimiento ejecutado 2026-05-03:
    - Sitio Next.js con RSC; listings cargados vía API REST interna
    - Endpoint: https://www.metrocuadrado.com/rest-search/search
    - Header requerido: X-Api-Key (extraído de config embebida en HTML)
    - size=50 obligatorio (constante n.L=50 en bundle JS)
    - Paginación: parámetro `from` (offset), máximo 10.000 entradas por query
    - Sin CAPTCHA activo para requests con User-Agent realista + X-Api-Key
    - Listings incluyen lat/lon directamente en campo `localizacion`
    - Parámetro `city` acepta slugs de municipio (medellin, envigado, itagui, etc.)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import random
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scraping.utils.db import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuración API
# ---------------------------------------------------------------------------
API_URL = "https://www.metrocuadrado.com"
# Extraído del HTML embebido: env.apiKey en config de Next.js RSC
API_KEY = os.getenv("METROCUADRADO_API_KEY", "P1MfFHfQMOtL16Zpg36NcntJYCLFm8FqFfudnavl")
PAGE_SIZE = 50  # n.L=50, obligatorio — otras sizes retornan 0 resultados

# Municipios del Valle de Aburrá — slug URL → nombre display
MUNICIPIOS_VALLE: dict[str, str] = {
    "medellin":    "Medellín",
    "envigado":    "Envigado",
    "itagui":      "Itagüí",
    "sabaneta":    "Sabaneta",
    "bello":       "Bello",
    "la-estrella": "La Estrella",
    "copacabana":  "Copacabana",
    "girardota":   "Girardota",
    "barbosa":     "Barbosa",
    "caldas":      "Caldas",
}

# Verified 2026-06-04: all values accepted by MQ REST API (realEstateTypeList param).
# lote: venta only (arriendo lots are not a real market segment).
BASE_CONFIGS = [
    {"tipo_inmueble": "apartamento",   "tipo_operacion": "venta"},
    {"tipo_inmueble": "apartamento",   "tipo_operacion": "arriendo"},
    {"tipo_inmueble": "apartaestudio", "tipo_operacion": "venta"},
    {"tipo_inmueble": "apartaestudio", "tipo_operacion": "arriendo"},
    {"tipo_inmueble": "casa",          "tipo_operacion": "venta"},
    {"tipo_inmueble": "casa",          "tipo_operacion": "arriendo"},
    {"tipo_inmueble": "local",         "tipo_operacion": "venta"},
    {"tipo_inmueble": "local",         "tipo_operacion": "arriendo"},
    {"tipo_inmueble": "oficina",       "tipo_operacion": "venta"},
    {"tipo_inmueble": "oficina",       "tipo_operacion": "arriendo"},
    {"tipo_inmueble": "bodega",        "tipo_operacion": "venta"},
    {"tipo_inmueble": "bodega",        "tipo_operacion": "arriendo"},
    {"tipo_inmueble": "lote",          "tipo_operacion": "venta"},
]

HEADERS = {
    "User-Agent": os.getenv(
        "SCRAPER_USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "X-Api-Key": API_KEY,
    "Referer": "https://www.metrocuadrado.com/",
}

# ---------------------------------------------------------------------------
# Dedup hash
# ---------------------------------------------------------------------------

def calcular_dedup_hash(
    barrio_raw,
    tipo_inmueble,
    tipo_operacion,
    habitaciones,
    banos,
    area_m2,
    precio,
) -> str:
    # math.floor(x + 0.5) matches PostgreSQL ROUND() half-away-from-zero
    area_r = math.floor(float(area_m2 or 0) + 0.5)
    precio_val = float(precio or 0)
    # Scale-aware rounding: arriendo prices ~1M-5M → 500K buckets
    #                        venta prices ~100M-500M → 10M buckets
    factor = 500_000 if (tipo_operacion or "").lower() == "arriendo" else 10_000_000
    precio_r = math.floor(precio_val / factor + 0.5) * factor
    campos = "|".join([
        (barrio_raw or "").lower().strip(),
        (tipo_inmueble or ""),
        (tipo_operacion or ""),
        str(int(habitaciones or 0)),
        str(int(banos or 0)),
        str(area_r),
        str(int(precio_r)),
    ])
    return hashlib.md5(campos.encode()).hexdigest()


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS raw.listings_metrocuadrado (
    id                SERIAL PRIMARY KEY,
    fuente            TEXT NOT NULL DEFAULT 'metrocuadrado',
    tipo_operacion    TEXT,
    tipo_inmueble     TEXT,
    precio            NUMERIC,
    area_m2           NUMERIC,
    habitaciones      INTEGER,
    banos             INTEGER,
    direccion_raw     TEXT,
    barrio_raw        TEXT,
    municipio_raw     TEXT,
    url               TEXT,
    lat               DOUBLE PRECISION,
    lon               DOUBLE PRECISION,
    estrato           INTEGER,
    fecha_scraping    TIMESTAMPTZ DEFAULT NOW(),
    activo            BOOLEAN DEFAULT TRUE,
    barrio_id         INTEGER REFERENCES raw.barrios(id),
    raw_data          JSONB,
    fecha_publicacion DATE,
    dias_en_mercado   INTEGER,
    dedup_hash        VARCHAR,
    fotos             TEXT[]
);
ALTER TABLE raw.listings_metrocuadrado ADD COLUMN IF NOT EXISTS fecha_publicacion DATE;
ALTER TABLE raw.listings_metrocuadrado ADD COLUMN IF NOT EXISTS dias_en_mercado   INTEGER;
ALTER TABLE raw.listings_metrocuadrado ADD COLUMN IF NOT EXISTS dedup_hash        VARCHAR;
ALTER TABLE raw.listings_metrocuadrado ADD COLUMN IF NOT EXISTS municipio_raw     TEXT;
ALTER TABLE raw.listings_metrocuadrado ADD COLUMN IF NOT EXISTS fotos             TEXT[];
CREATE INDEX IF NOT EXISTS idx_mq_tipo_op  ON raw.listings_metrocuadrado(tipo_operacion);
CREATE INDEX IF NOT EXISTS idx_mq_tipo_inm ON raw.listings_metrocuadrado(tipo_inmueble);
CREATE INDEX IF NOT EXISTS idx_mq_barrio   ON raw.listings_metrocuadrado(barrio_id);
CREATE INDEX IF NOT EXISTS idx_mq_precio   ON raw.listings_metrocuadrado(precio);
CREATE INDEX IF NOT EXISTS idx_mq_scraping ON raw.listings_metrocuadrado(fecha_scraping);
CREATE INDEX IF NOT EXISTS idx_mq_geo      ON raw.listings_metrocuadrado(lat, lon);
CREATE UNIQUE INDEX IF NOT EXISTS listings_mq_url_op_unique ON raw.listings_metrocuadrado(url, tipo_operacion);
"""

UPSERT_SQL = """
INSERT INTO raw.listings_metrocuadrado
    (fuente, tipo_operacion, tipo_inmueble, precio, area_m2,
     habitaciones, banos, direccion_raw, barrio_raw, municipio_raw, url,
     lat, lon, estrato, parqueaderos, piso, antiguedad, administracion,
     amenidades, fecha_scraping, activo, raw_data,
     fecha_publicacion, dias_en_mercado, dedup_hash, fotos)
VALUES
    (%(fuente)s, %(tipo_operacion)s, %(tipo_inmueble)s, %(precio)s,
     %(area_m2)s, %(habitaciones)s, %(banos)s, %(direccion_raw)s,
     %(barrio_raw)s, %(municipio_raw)s, %(url)s, %(lat)s, %(lon)s, %(estrato)s,
     %(parqueaderos)s, %(piso)s, %(antiguedad)s, %(administracion)s,
     %(amenidades)s, %(fecha_scraping)s, %(activo)s, %(raw_data)s,
     %(fecha_publicacion)s, %(dias_en_mercado)s, %(dedup_hash)s, %(fotos)s)
-- Identidad = (url, tipo_operacion), estable y sin precio. Una url de MC
-- (murldetalle keyea por midinmueble) hostea venta Y arriendo del mismo
-- inmueble, así que url sola fusionaría ambas operaciones -> (url,op). dedup_hash
-- incluye precio y queda SOLO para el dedup cross-fuente en serving (cache.py/
-- dbt), NO como clave de upsert: con precio en la clave, un cambio de precio
-- insertaba fila nueva en vez de UPDATE -> el trigger de historial nunca
-- disparaba. Mismo espíritu que fincaraiz/vrbo/renta_media (key por url).
ON CONFLICT (url, tipo_operacion) DO UPDATE SET
    precio            = EXCLUDED.precio,
    area_m2           = EXCLUDED.area_m2,
    habitaciones      = EXCLUDED.habitaciones,
    banos             = EXCLUDED.banos,
    direccion_raw     = EXCLUDED.direccion_raw,
    barrio_raw        = EXCLUDED.barrio_raw,
    municipio_raw     = COALESCE(EXCLUDED.municipio_raw, raw.listings_metrocuadrado.municipio_raw),
    lat               = COALESCE(EXCLUDED.lat, raw.listings_metrocuadrado.lat),
    lon               = COALESCE(EXCLUDED.lon, raw.listings_metrocuadrado.lon),
    estrato           = EXCLUDED.estrato,
    parqueaderos      = COALESCE(EXCLUDED.parqueaderos, raw.listings_metrocuadrado.parqueaderos),
    piso              = COALESCE(EXCLUDED.piso, raw.listings_metrocuadrado.piso),
    antiguedad        = COALESCE(EXCLUDED.antiguedad, raw.listings_metrocuadrado.antiguedad),
    administracion    = COALESCE(EXCLUDED.administracion, raw.listings_metrocuadrado.administracion),
    amenidades        = CASE WHEN array_length(EXCLUDED.amenidades,1) > 0 THEN EXCLUDED.amenidades ELSE raw.listings_metrocuadrado.amenidades END,
    fecha_scraping    = EXCLUDED.fecha_scraping,
    activo            = EXCLUDED.activo,
    raw_data          = EXCLUDED.raw_data,
    fecha_publicacion = EXCLUDED.fecha_publicacion,
    dias_en_mercado   = EXCLUDED.dias_en_mercado,
    fotos             = CASE WHEN array_length(EXCLUDED.fotos,1) > 0 THEN EXCLUDED.fotos ELSE raw.listings_metrocuadrado.fotos END;
"""

MQ_CDN = "https://multimedia.metrocuadrado.com"


def _build_fotos(item: dict) -> list[str]:
    """Build full CDN photo URLs from mgaleriainmueble IDs."""
    import re as _re
    gallery = item.get("mgaleriainmueble") or []
    fotos: list[str] = []
    for gid in gallery[:12]:
        if not isinstance(gid, str):
            continue
        prefix = _re.sub(r"_\d+$", "", gid)
        fotos.append(f"{MQ_CDN}/{prefix}/{gid}_p.jpg")
    # Fallback: imageLink as first photo if no gallery
    if not fotos and item.get("imageLink"):
        fotos.append(item["imageLink"])
    return fotos

# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def _parse_fecha_publicacion(item: dict) -> str | None:
    """Extract publish date from Metrocuadrado API JSON response."""
    for field in ("publishedAt", "createdAt", "updatedAt",
                  "fechaPublicacion", "fecha_publicacion", "mfechapublicacion"):
        val = item.get(field)
        if val:
            try:
                return str(val)[:10]  # YYYY-MM-DD portion of ISO string
            except Exception:
                pass
    return None


def _parse_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        m = re.search(r"(\d+)", str(val))
        return int(m.group(1)) if m else None


def _parse_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _parse_listing(item: dict, tipo_inmueble: str, tipo_operacion: str,
                   municipio_raw: str | None = None) -> dict | None:
    """Convert raw API listing to normalized record."""
    link = item.get("link") or item.get("data", {}).get("murldetalle", "")
    if not link:
        return None
    url = API_URL + link if not link.startswith("http") else link

    # Price: use mvalorventa for venta, mvalorarriendo for arriendo
    precio = None
    if tipo_operacion == "venta":
        precio = _parse_float(item.get("mvalorventa"))
    else:
        precio = _parse_float(item.get("mvalorarriendo"))

    # Area: prefer private area, fall back to total
    area = _parse_float(item.get("areaprivada") or item.get("areaPrivada") or item.get("marea"))

    # Rooms/baths
    habitaciones = _parse_int(item.get("mnrocuartos"))
    banos = _parse_int(item.get("mnrobanos"))

    # Location
    barrio = (item.get("mbarrio") or item.get("mnombrecomunbarrio") or "").strip() or None
    if barrio:
        barrio = barrio.title()

    # Geolocation (direct from API)
    geo = item.get("localizacion") or {}
    lat = _parse_float(geo.get("lat"))
    lon = _parse_float(geo.get("lon"))

    # Estrato
    estrato = _parse_int(item.get("estrato"))

    # Title as direccion proxy (no raw address available)
    title = item.get("title") or ""

    # Parse amenidades from `featured` list: ["conPiscina:S", "nroCuartos:3", ...]
    # Keep only boolean flags (value == "S") and map to human names
    _AMENIDAD_MAP = {
        "conPiscina": "Piscina", "conGimnasio": "Gimnasio", "conSauna": "Sauna",
        "conJacuzzi": "Jacuzzi", "conBBQ": "BBQ", "conAsador": "Asador",
        "conSalonComunal": "Salón Comunal", "conZonaNinos": "Zona Niños",
        "conZonasVerdes": "Zonas Verdes", "conVigilancia": "Vigilancia",
        "enConjuntoCerrado": "Conjunto Cerrado", "conPorteria": "Portería",
        "porteria": "Portería", "conElevador": "Elevador",
        "conParqueaderoVisitantes": "Parqueadero Visitantes",
        "conCanchaFutbol": "Cancha Fútbol", "conCanchaMultiple": "Cancha Múltiple",
        "conVistaPanoramica": "Vista Panorámica", "conZonaLavanderia": "Lavandería",
        "conCocinaIntegral": "Cocina Integral", "sobreViaPrincipal": "Vía Principal",
        "cercaTransportePublico": "Cerca Transporte",
    }
    # Parse featured array: ["key:value", ...] → dict
    featured_kv: dict[str, str] = {}
    amenidades = []
    for feat in (item.get("featured") or []):
        if not isinstance(feat, str):
            continue
        key, _, val = feat.strip().partition(":")
        key = key.strip().lstrip()
        val = val.strip()
        if key:
            featured_kv[key] = val
        # Map boolean flags to human amenity names
        for map_key, label in _AMENIDAD_MAP.items():
            if key.startswith(map_key) and val == "S":
                amenidades.append(label)
                break

    # Extra fields from featured array (not available as direct API fields)
    antiguedad   = featured_kv.get("tiempoConstruido") or None
    parqueaderos = _parse_int(featured_kv.get("nroGarajes"))
    piso         = _parse_int(featured_kv.get("nroPiso"))
    # Administration cost: try API field first, then featured
    admin_raw = item.get("commonExpenses")
    if isinstance(admin_raw, dict):
        admin_val = _parse_float(admin_raw.get("amount"))
    else:
        admin_str = featured_kv.get("valorAdministracion")
        admin_val = _parse_float(admin_str) if admin_str else None
    administracion = admin_val if admin_val and admin_val > 0 else None

    fecha_pub_str = _parse_fecha_publicacion(item)
    fecha_pub = date.fromisoformat(fecha_pub_str) if fecha_pub_str else None
    dias_mercado = (date.today() - fecha_pub).days if fecha_pub else None

    fotos = _build_fotos(item)

    raw_data = {
        "midinmueble":      item.get("midinmueble"),
        "title":            title,
        "mtiponegocio":     item.get("mtiponegocio"),
        "mtipoinmueble":    item.get("mtipoinmueble"),
        "mvalorventa":      item.get("mvalorventa"),
        "mvalorarriendo":   item.get("mvalorarriendo"),
        "marea":            item.get("marea"),
        "areaprivada":      item.get("areaprivada") or item.get("areaPrivada"),
        "mnrocuartos":      item.get("mnrocuartos"),
        "mnrobanos":        item.get("mnrobanos"),
        "mnrogarajes":      item.get("mnrogarajes"),
        "mbarrio":          item.get("mbarrio"),
        "mciudad":          item.get("mciudad"),
        "estrato":          item.get("estrato"),
        "mestadoinmueble":  item.get("mestadoinmueble"),
        "mnombreproyecto":  item.get("mnombreproyecto"),
        "localizacion":     geo,
        "featured":         item.get("featured"),
        "badge":            item.get("badge"),
        "publishedAt":      item.get("publishedAt"),
        "createdAt":        item.get("createdAt"),
        "tiempoConstruido": antiguedad,
        "nroGarajes":       parqueaderos,
        "nroPiso":          piso,
        "valorAdministracion": administracion,
    }

    # municipio_raw: prefer explicit arg, fall back to mciudad from API
    mun_raw = municipio_raw or (item.get("mciudad") or "").strip().title() or None

    return {
        "fuente":             "metrocuadrado",
        "tipo_operacion":     tipo_operacion,
        "tipo_inmueble":      tipo_inmueble,
        "precio":             precio,
        "area_m2":            area,
        "habitaciones":       habitaciones,
        "banos":              banos,
        "direccion_raw":      title if title else barrio,
        "barrio_raw":         barrio,
        "municipio_raw":      mun_raw,
        "url":                url,
        "lat":                lat,
        "lon":                lon,
        "estrato":            estrato,
        "parqueaderos":       parqueaderos,
        "piso":               piso,
        "antiguedad":         antiguedad,
        "administracion":     administracion,
        "amenidades":         amenidades if amenidades else None,
        "fecha_scraping":     datetime.now(timezone.utc).isoformat(),
        "activo":             True,
        "raw_data":           json.dumps(raw_data, ensure_ascii=False, default=str),
        "fecha_publicacion":  fecha_pub_str,
        "dias_en_mercado":    dias_mercado,
        "fotos":              fotos if fotos else None,
        "dedup_hash":         calcular_dedup_hash(
            barrio_raw=barrio,
            tipo_inmueble=tipo_inmueble,
            tipo_operacion=tipo_operacion,
            habitaciones=habitaciones,
            banos=banos,
            area_m2=area,
            precio=precio,
        ),
    }


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------

class MetrocuadradoScraper:
    def __init__(
        self,
        max_pages: int = 10,
        delay_min: float = 2.0,
        delay_max: float = 5.0,
        tipos: list[str] | None = None,
        municipios: list[str] | None = None,
        since_date: date | None = None,
    ):
        self.max_pages = max_pages
        self.delay_min = delay_min
        self.delay_max = delay_max
        self.tipos = tipos
        self.municipios = municipios or ["medellin"]
        self.since_date = since_date
        self._session = requests.Session()
        self._session.headers.update(HEADERS)

    def _get_page(self, tipo_inmueble: str, tipo_operacion: str,
                  from_offset: int, city: str) -> dict | None:
        params = {
            "realEstateTypeList":     tipo_inmueble,
            "realEstateBusinessList": tipo_operacion,
            "city":                   city,
            "from":                   from_offset,
            "size":                   PAGE_SIZE,
        }
        try:
            resp = self._session.get(
                f"{API_URL}/rest-search/search",
                params=params,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            log.error(f"HTTP error [{city}/{tipo_inmueble}/{tipo_operacion}] from={from_offset}: {e}")
            return None
        except ValueError as e:
            log.error(f"JSON decode error [{city}/{tipo_inmueble}/{tipo_operacion}] from={from_offset}: {e}")
            return None

    def _delay(self) -> None:
        delay = random.uniform(self.delay_min, self.delay_max)
        log.debug(f"Waiting {delay:.1f}s")
        time.sleep(delay)

    def _scrape_config(self, config: dict, city: str, municipio_display: str) -> list[dict]:
        tipo_inmueble  = config["tipo_inmueble"]
        tipo_operacion = config["tipo_operacion"]

        all_results: list[dict] = []
        seen_urls: set[str] = set()

        for page_num in range(self.max_pages):
            from_offset = page_num * PAGE_SIZE
            log.info(
                f"  [{city}/{tipo_inmueble}/{tipo_operacion}] "
                f"Página {page_num + 1}/{self.max_pages} (from={from_offset})"
            )

            data = self._get_page(tipo_inmueble, tipo_operacion, from_offset, city)
            if not data:
                break

            total_hits = data.get("totalHits", 0)
            items = data.get("results", [])

            if page_num == 0:
                log.info(f"    Total disponible en API: {total_hits:,}")

            if not items:
                log.info(f"    Sin resultados en página {page_num + 1}, deteniendo")
                break

            new_items = []
            old_count = 0
            for item in items:
                parsed = _parse_listing(item, tipo_inmueble, tipo_operacion,
                                        municipio_raw=municipio_display)
                if not parsed or parsed["url"] in seen_urls:
                    continue
                # Incremental filter: skip if older than since_date
                if self.since_date and parsed.get("fecha_publicacion"):
                    try:
                        pub = date.fromisoformat(parsed["fecha_publicacion"])
                        if pub < self.since_date:
                            old_count += 1
                            continue
                    except (ValueError, TypeError):
                        pass
                seen_urls.add(parsed["url"])
                new_items.append(parsed)

            if not new_items and not old_count:
                log.info(f"    Sin items nuevos, deteniendo")
                break

            # Stop early if whole page is older than cutoff
            if self.since_date and old_count > 0 and len(new_items) == 0:
                log.info(f"    Página completa más antigua que {self.since_date} — deteniendo")
                break

            all_results.extend(new_items)
            log.info(f"    +{len(new_items)} listings, {old_count} old (total {len(all_results)})")

            if from_offset + PAGE_SIZE >= min(total_hits, 10000):
                log.info(f"    Alcanzado el límite de la API o fin de resultados")
                break

            if page_num < self.max_pages - 1:
                self._delay()

        return all_results

    def run(self, save_func=None) -> list[dict]:
        base = BASE_CONFIGS
        if self.tipos:
            base = [c for c in BASE_CONFIGS if c["tipo_operacion"] in self.tipos]

        all_results: list[dict] = []
        for mun_slug in self.municipios:
            mun_display = MUNICIPIOS_VALLE.get(mun_slug, mun_slug.title())
            for config in base:
                log.info(
                    f"=== {mun_display.upper()} | "
                    f"{config['tipo_inmueble'].upper()} | {config['tipo_operacion'].upper()} ==="
                )
                results = self._scrape_config(config, city=mun_slug,
                                              municipio_display=mun_display)
                log.info(f"  Subtotal: {len(results)}")
                if save_func and results:
                    saved = save_func(results)
                    log.info(f"  → Guardados {saved} en DB")
                all_results.extend(results)
                time.sleep(random.uniform(3, 7))

        log.info(f"Total extraídos: {len(all_results)}")
        return all_results


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def ensure_table() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE_SQL)


def save_listings(listings: list[dict]) -> int:
    if not listings:
        return 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, UPSERT_SQL, listings, page_size=50)
    return len(listings)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Scraper Metrocuadrado — Valle de Aburrá")
    parser.add_argument("--dry-run", action="store_true", help="No escribe a DB")
    parser.add_argument("--max-pages", type=int, default=10, help="Máx páginas por tipo (default 10 = 500 listings)")
    parser.add_argument("--since-days", type=int, default=None, help="Incremental: solo listings publicados en los últimos N días")
    parser.add_argument(
        "--tipos",
        nargs="+",
        choices=["venta", "arriendo"],
        help="Tipos de operación a scrapear",
    )
    parser.add_argument(
        "--municipios",
        nargs="+",
        metavar="MUNICIPIO",
        help=(
            "Municipios a scrapear. Usar 'all_valle' para los 10 del Valle de Aburrá. "
            f"Opciones: all_valle, {', '.join(MUNICIPIOS_VALLE.keys())}"
        ),
    )
    args = parser.parse_args()

    # Resolve municipios
    municipios: list[str] | None = None
    if args.municipios:
        if "all_valle" in args.municipios:
            municipios = list(MUNICIPIOS_VALLE.keys())
        else:
            unknown = [m for m in args.municipios if m not in MUNICIPIOS_VALLE]
            if unknown:
                parser.error(f"Municipios desconocidos: {unknown}. Opciones: {list(MUNICIPIOS_VALLE.keys())}")
            municipios = args.municipios

    since_date: date | None = None
    if args.since_days is not None:
        since_date = date.today() - timedelta(days=args.since_days)
        log.info(f"Incremental mode: solo listings desde {since_date}")

    scraper = MetrocuadradoScraper(
        max_pages=args.max_pages,
        tipos=args.tipos,
        municipios=municipios,
        since_date=since_date,
    )

    if args.dry_run:
        listings = scraper.run()
    else:
        ensure_table()
        listings = scraper.run(save_func=save_listings)

    if not listings:
        log.warning("Sin listings extraídos. Verificar API key o conexión.")
        sys.exit(1)

    if args.dry_run:
        log.info(f"[dry-run] {len(listings)} listings. Ejemplo:")
        example = {k: v for k, v in listings[0].items() if k != "raw_data"}
        log.info(json.dumps(example, ensure_ascii=False, indent=2, default=str))
    else:
        log.info(f"Total guardados en raw.listings_metrocuadrado: {len(listings)}")

    tipos_count  = Counter((l["tipo_inmueble"], l["tipo_operacion"]) for l in listings)
    mun_count    = Counter(l.get("municipio_raw", "?") for l in listings)
    prices_by_type: dict[str, list[float]] = {}
    geo_count = sum(1 for l in listings if l.get("lat") and l.get("lon"))

    for l in listings:
        k = f"{l['tipo_inmueble']}/{l['tipo_operacion']}"
        if l["precio"]:
            prices_by_type.setdefault(k, []).append(float(l["precio"]))

    print("\n=== RESUMEN ===")
    for (inm, op), count in sorted(tipos_count.items()):
        k = f"{inm}/{op}"
        prices = prices_by_type.get(k, [])
        avg = sum(prices) / len(prices) if prices else 0
        avg_str = f"${avg:,.0f} COP" if avg else "N/A"
        print(f"  {inm:12} {op:8} | {count:4} listings | precio promedio: {avg_str}")
    print(f"  Total: {len(listings)}")
    print(f"  Con coordenadas: {geo_count}/{len(listings)} ({geo_count/len(listings)*100:.1f}%)")
    print("\n  Por municipio:")
    for mun, cnt in sorted(mun_count.items(), key=lambda x: -x[1]):
        print(f"    {mun:18} {cnt:5}")


if __name__ == "__main__":
    main()
