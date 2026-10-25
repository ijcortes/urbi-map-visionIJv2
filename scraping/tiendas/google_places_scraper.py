"""
Google Places (New API) scraper — writes to public.tiendas.

Strategy:
  - Default mode: top 20 barrios by listing activity (get_top_barrios)
  - Full mode (--all): all Valle de Aburrá barrios from raw.barrios
  - POST to places.googleapis.com/v1/places:searchNearby per barrio/categoria
  - UPSERT on google_place_id UNIQUE constraint
  - Rate limit: 1 req/sec

Cost estimate:
  Top 20 barrios × 8 categorías = 160 requests × $0.032 = ~$5 USD/run
  Full Valle de Aburrá: ~597 barrios × 8 cats = ~4776 req ≈ $153 USD

Run:
  # Top 20 barrios (default — within free tier)
  python scraping/tiendas/google_places_scraper.py

  # Cobertura pareja: 3 barrios por comuna/municipio (~$16 USD) — recomendado
  python scraping/tiendas/google_places_scraper.py --por-comuna 3

  # Full Valle de Aburrá
  python scraping/tiendas/google_places_scraper.py --all

  # Single municipio
  python scraping/tiendas/google_places_scraper.py --municipio MEDELLIN

  # Single barrio (test)
  python scraping/tiendas/google_places_scraper.py --barrio "Poblado" --test
  python scraping/tiendas/google_places_scraper.py --barrio "Poblado" --categoria brunch
"""

import argparse
import os
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_ROOT))
from scraping.utils.cost_ledger import BudgetExceeded, charge  # noqa: E402

load_dotenv(_ROOT / ".env.local")
load_dotenv(_ROOT / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
API_KEY = os.getenv("GOOGLE_PLACES_API_KEY", "")
BASE_URL = "https://places.googleapis.com/v1/places:searchNearby"

FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.regularOpeningHours",
    "places.priceLevel",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.photos",
    "places.types",
    "places.primaryType",
    "places.editorialSummary",
])

VALLE_ABURRA = [
    "MEDELLIN", "BELLO", "ITAGUI", "ENVIGADO", "SABANETA", "LA ESTRELLA",
]

CATEGORIAS_PLACES = {
    # Gastronomía
    "brunch":        ["breakfast_restaurant", "brunch_restaurant", "cafe", "coffee_shop", "bakery"],
    "almuerzo":      ["restaurant", "colombian_restaurant", "latin_american_restaurant", "food_court"],
    "cena":          ["fine_dining_restaurant", "steak_house", "seafood_restaurant", "italian_restaurant", "mediterranean_restaurant"],
    "bares":         ["bar", "pub", "sports_bar", "cocktail_bar", "wine_bar", "brewery"],
    "cafes":         ["cafe", "coffee_shop"],
    "comida_rapida": ["fast_food_restaurant", "pizza_restaurant", "sandwich_shop", "hamburger_restaurant"],
    "panaderia":     ["bakery", "pastry_shop", "dessert_shop", "ice_cream_shop", "chocolate_shop"],
    "asiatica":      ["chinese_restaurant", "japanese_restaurant", "sushi_restaurant", "thai_restaurant", "korean_restaurant", "asian_restaurant"],
    # Salud & Belleza
    "medicos":       ["doctor", "medical_clinic", "hospital"],
    "dentistas":     ["dentist", "dental_clinic"],
    "dermatologia":  ["skin_care_clinic"],
    "fisioterapia":  ["physiotherapist", "chiropractor"],
    "masajes_spa":   ["spa", "wellness_center", "sauna"],
    "peluquerias":   ["hair_salon", "barber_shop", "beauty_salon"],
    "estetica":      ["nail_salon"],
    # Fitness
    "gimnasios":     ["gym", "fitness_center", "sports_club", "athletic_field"],
    "yoga":          ["yoga_studio"],
    # Servicios del hogar
    "remodelaciones": ["home_improvement_store"],
    "plomeria":      ["plumber"],
    "electricistas": ["electrician"],
    "mudanzas":      ["moving_company"],
    "cerrajeria":    ["locksmith"],
    "jardineria":    ["garden_center"],
    # Más servicios
    "bancos":        ["bank", "atm"],
    "mascotas":      ["pet_store"],
    "parqueaderos":  ["parking", "parking_lot", "parking_garage"],
    "segunda_mano":  ["thrift_store"],
}

_PRECIO_MAP = {
    "PRICE_LEVEL_FREE":           "$",
    "PRICE_LEVEL_INEXPENSIVE":    "$",
    "PRICE_LEVEL_MODERATE":       "$$",
    "PRICE_LEVEL_EXPENSIVE":      "$$$",
    "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$",
}

_UPSERT_SQL = """
INSERT INTO public.tiendas (
    google_place_id, nombre, descripcion,
    categoria, barrio_id, ciudad_id,
    direccion, telefono, website,
    foto_url, lat, lon, rating_google,
    precio_rango, horario, activo, verificado
) VALUES (
    %(google_place_id)s, %(nombre)s, %(descripcion)s,
    %(categoria)s, %(barrio_id)s, %(ciudad_id)s,
    %(direccion)s, %(telefono)s, %(website)s,
    %(foto_url)s, %(lat)s, %(lon)s, %(rating_google)s,
    %(precio_rango)s, %(horario)s, %(activo)s, %(verificado)s
)
ON CONFLICT (google_place_id) DO UPDATE SET
    nombre        = EXCLUDED.nombre,
    rating_google = EXCLUDED.rating_google,
    horario       = EXCLUDED.horario,
    foto_url      = EXCLUDED.foto_url,
    updated_at    = NOW()
"""

_SKIP_PREFIXES = (
    "AREA EN DESARROLLO",
    "AREAS SIN DESARROLLAR",
    "ASENTAMIENTO DE HECHO",
    "ZONA RURAL",
    "VEREDA",
    "CORREGIMIENTO",
)


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def get_top_barrios(conn, limit: int = 20) -> list[dict]:
    """Top N barrios ranked by listing activity — default scrape target."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                b.id                                        AS barrio_id,
                b.nombre,
                b.municipio,
                ST_Y(ST_Centroid(b.geometry))               AS lat,
                ST_X(ST_Centroid(b.geometry))               AS lon,
                COUNT(sl.listing_uid)                       AS n_listings
            FROM raw.barrios b
            LEFT JOIN staging.stg_listings_unificado sl ON b.id = sl.barrio_id
            WHERE b.excluir_inversion = FALSE
              AND b.geometry IS NOT NULL
            GROUP BY b.id, b.nombre, b.municipio, b.geometry
            ORDER BY n_listings DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()

    return [
        {
            "barrio_id": r["barrio_id"],
            "nombre":    r["nombre"],
            "municipio": r["municipio"],
            "lat":       float(r["lat"]),
            "lon":       float(r["lon"]),
            "radio":     800,
        }
        for r in rows
    ]


def get_barrios_por_comuna(conn, por_comuna: int = 3) -> list[dict]:
    """N barrios por comuna de Medellín y por municipio del Valle (Ken, 23-oct).

    El default (top por listings) concentra casi todo en El Poblado y deja el
    resto del mapa de negocios vacío. Acá cada comuna/municipio aporta sus N
    barrios más grandes, así el directorio cubre toda la ciudad.
    Costo: ~(16 comunas + 5 municipios) × 3 × 8 cats ≈ 500 req ≈ $16 USD.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            WITH zonas AS (
                SELECT b.id, b.nombre, b.municipio, b.geometry,
                       COALESCE(bc.cd_comuna::text, b.municipio)       AS zona,
                       ROW_NUMBER() OVER (
                           PARTITION BY COALESCE(bc.cd_comuna::text, b.municipio)
                           ORDER BY ST_Area(b.geometry::geography) DESC
                       )                                                AS rk
                FROM raw.barrios b
                LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = b.id
                WHERE b.excluir_inversion = FALSE
                  AND b.geometry IS NOT NULL
                  AND b.municipio = ANY(%s)
            )
            SELECT id AS barrio_id, nombre, municipio, zona,
                   ST_Y(ST_Centroid(geometry)) AS lat,
                   ST_X(ST_Centroid(geometry)) AS lon,
                   LEAST(1500, GREATEST(300, SQRT(ST_Area(geometry::geography) / PI())::int)) AS radio
            FROM zonas
            WHERE rk <= %s
            ORDER BY zona, rk
        """, (VALLE_ABURRA, por_comuna))
        rows = [dict(r) for r in cur.fetchall()]
    return [
        {**r, "lat": float(r["lat"]), "lon": float(r["lon"])}
        for r in rows
        if not any(r["nombre"].upper().startswith(p) for p in _SKIP_PREFIXES)
    ]


def load_barrios_from_db(
    conn,
    municipios: list[str] | None = None,
    nombre_filtro: str | None = None,
) -> list[dict]:
    """Load barrios with centroid coords and radius derived from geometry area."""
    where_clauses = []
    params = []

    target_municipios = municipios or VALLE_ABURRA
    placeholders = ",".join(f"%s" for _ in target_municipios)
    where_clauses.append(f"municipio IN ({placeholders})")
    params.extend(target_municipios)

    if nombre_filtro:
        where_clauses.append("UPPER(nombre) LIKE %s")
        params.append(f"%{nombre_filtro.upper()}%")

    where_sql = " AND ".join(where_clauses)

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"""
            SELECT
                id                                          AS barrio_id,
                nombre,
                municipio,
                ST_Y(ST_Centroid(geometry))                 AS lat,
                ST_X(ST_Centroid(geometry))                 AS lon,
                LEAST(1500, GREATEST(300,
                    SQRT(ST_Area(geometry::geography) / PI())::int
                ))                                          AS radio
            FROM raw.barrios
            WHERE {where_sql}
            ORDER BY municipio, nombre
        """, params)
        rows = [dict(r) for r in cur.fetchall()]

    # Filter out non-commercial zones to save API quota
    filtered = [
        b for b in rows
        if not any(b["nombre"].upper().startswith(p) for p in _SKIP_PREFIXES)
    ]
    skipped = len(rows) - len(filtered)
    if skipped:
        print(f"[info] Saltando {skipped} barrios no comerciales")

    return filtered


def scrape_barrio_categoria(barrio: dict, types: list[str], retries: int = 4) -> list[dict]:
    headers = {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    }
    body = {
        "includedTypes": types,
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": barrio["lat"], "longitude": barrio["lon"]},
                "radius": float(barrio["radio"]),
            }
        },
        "rankPreference": "POPULARITY",
    }
    for attempt in range(retries):
        try:
            charge("google_places", "places:searchNearby", 0.032)
        except BudgetExceeded as e:
            print(f"  [BUDGET] {e} — deteniendo")
            raise
        try:
            r = requests.post(BASE_URL, headers=headers, json=body, timeout=20)
            if r.status_code != 200:
                print(f"  [WARN] {barrio['nombre']} {r.status_code}: {r.text[:200]}")
                return []
            return r.json().get("places", [])
        except requests.exceptions.ConnectionError as e:
            wait = 10 * (2 ** attempt)
            print(f"  [RETRY {attempt+1}/{retries}] DNS/network error — esperando {wait}s: {e!s:.80}")
            time.sleep(wait)
    print(f"  [FAIL] {barrio['nombre']} — se agotaron los reintentos, saltando")
    return []


def normalizar_place(raw: dict, barrio: dict, categoria: str) -> dict:
    location = raw.get("location", {})

    foto_url = None
    if raw.get("photos"):
        photo_name = raw["photos"][0]["name"]
        foto_url = (
            f"https://places.googleapis.com/v1/{photo_name}/media"
            f"?maxHeightPx=400&maxWidthPx=600&key={API_KEY}"
        )

    horario = None
    if raw.get("regularOpeningHours"):
        periods = raw["regularOpeningHours"].get("periods", [])
        horario = psycopg2.extras.Json({"periods": periods})

    return {
        "google_place_id": raw.get("id"),
        "nombre":          raw.get("displayName", {}).get("text", ""),
        "descripcion":     raw.get("editorialSummary", {}).get("text"),
        "categoria":       categoria,
        "barrio_id":       barrio["barrio_id"],
        "ciudad_id":       1,
        "direccion":       raw.get("formattedAddress", ""),
        "telefono":        raw.get("nationalPhoneNumber"),
        "website":         raw.get("websiteUri"),
        "foto_url":        foto_url,
        "lat":             location.get("latitude"),
        "lon":             location.get("longitude"),
        "rating_google":   raw.get("rating"),
        "precio_rango":    _PRECIO_MAP.get(raw.get("priceLevel", ""), "$$"),
        "horario":         horario,
        "activo":          True,
        "verificado":      True,
    }


def get_done_barrios(conn) -> set[int]:
    """Barrios scraped in the last 7 days — safe to skip on resume."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT barrio_id FROM public.tiendas
            WHERE updated_at >= NOW() - INTERVAL '7 days'
        """)
        return {row[0] for row in cur.fetchall()}


def upsert_tienda(cur, tienda: dict) -> None:
    cur.execute(_UPSERT_SQL, tienda)


def run(
    municipios: list[str] | None = None,
    barrios_override: list[dict] | None = None,
    categorias: dict | None = None,
    nombre_filtro: str | None = None,
    top: int | None = 20,
    all_valle: bool = False,
    por_comuna: int | None = None,
    resume: bool = False,
    dry_run: bool = False,
) -> int:
    if not API_KEY:
        print("ERROR: GOOGLE_PLACES_API_KEY not set")
        sys.exit(1)

    categorias = categorias or CATEGORIAS_PLACES
    conn = get_conn()
    total = 0

    try:
        if barrios_override:
            barrios = barrios_override
        elif por_comuna:
            barrios = get_barrios_por_comuna(conn, por_comuna=por_comuna)
        elif municipios or nombre_filtro or all_valle:
            barrios = load_barrios_from_db(conn, municipios=municipios, nombre_filtro=nombre_filtro)
        else:
            barrios = get_top_barrios(conn, limit=top or 20)

        if resume:
            done = get_done_barrios(conn)
            before = len(barrios)
            barrios = [b for b in barrios if b["barrio_id"] not in done]
            print(f"[resume] {before - len(barrios)} barrios ya completos — saltando")

        n_requests = len(barrios) * len(categorias)
        cost_est = n_requests * 0.032
        eta_min = n_requests / 60
        print(
            f"[plan] {len(barrios)} barrios × {len(categorias)} categorías "
            f"= {n_requests} requests | ~${cost_est:.0f} USD | ~{eta_min:.0f} min"
        )

        with conn.cursor() as cur:
            for i, barrio in enumerate(barrios, 1):
                barrio_total = 0
                for categoria, types in categorias.items():
                    places = scrape_barrio_categoria(barrio, types)
                    for raw in places:
                        rating = raw.get("rating")
                        if rating is not None and rating < 4.0:
                            continue
                        tienda = normalizar_place(raw, barrio, categoria)
                        if not dry_run:
                            upsert_tienda(cur, tienda)
                        barrio_total += 1
                        total += 1
                    if not dry_run:
                        conn.commit()
                    time.sleep(1)

                mun = barrio.get("municipio", "")
                print(
                    f"  [{i:3}/{len(barrios)}] {mun:12} {barrio['nombre']:30} "
                    f"→ {barrio_total} tiendas"
                )
    finally:
        conn.close()

    label = "[DRY RUN] " if dry_run else ""
    print(f"\nTotal {label}cargadas: {total}")
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Google Places scraper — tiendas Valle de Aburrá")
    parser.add_argument("--all",       action="store_true", help="Todos los barrios Valle de Aburrá (~$153 USD)")
    parser.add_argument("--top",       type=int, default=20, help="Top N barrios por actividad (default: 20)")
    parser.add_argument("--por-comuna", type=int, metavar="N", help="N barrios por comuna/municipio, cobertura pareja (~$16 USD con N=3)")
    parser.add_argument("--municipio", help="Filtrar por municipio (ej: MEDELLIN, ENVIGADO)")
    parser.add_argument("--barrio",    help="Filtrar por nombre de barrio (substring, ej: 'Poblado')")
    parser.add_argument("--categoria", help="Filtrar por categoria")
    parser.add_argument("--resume",    action="store_true", help="Saltar barrios ya completos en DB")
    parser.add_argument("--test",      action="store_true", help="Dry-run, no escribe en DB")
    args = parser.parse_args()

    municipios_sel = [args.municipio.upper()] if args.municipio else None

    cats_sel = CATEGORIAS_PLACES
    if args.categoria:
        if args.categoria not in CATEGORIAS_PLACES:
            print(f"Categoria invalida. Opciones: {list(CATEGORIAS_PLACES.keys())}")
            sys.exit(1)
        cats_sel = {args.categoria: CATEGORIAS_PLACES[args.categoria]}

    run(
        municipios=municipios_sel,
        nombre_filtro=args.barrio,
        categorias=cats_sel,
        top=args.top,
        all_valle=args.all,
        por_comuna=args.por_comuna,
        resume=args.resume,
        dry_run=args.test,
    )
