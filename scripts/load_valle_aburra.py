"""
Load Valle de Aburrá (5 non-Medellín municipalities) into PostgreSQL.

Steps:
  1. Insert GeoJSON polygons → raw.barrios
  2. Spatially assign each raw listing to a barrio via point-in-polygon
  3. Insert real listings (with fincaraiz URLs) → raw.listings_fincaraiz
  4. Print dbt commands to run

Run:
  python scripts/load_valle_aburra.py [--dry-run]
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

import sys

import psycopg2
import psycopg2.extras
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).parent.parent))
from scraping.utils.quality import in_valle, resolve_barrio  # noqa: E402

# ── Config ────────────────────────────────────────────────────────────────────

import os
DB_URL = os.environ["DATABASE_URL"]

ROOT = Path(__file__).parent.parent
GEOJSON_PATH = ROOT / "public" / "data" / "barrios_valle_aburra.geojson"
RAW_DIR = Path(__file__).parent / "data" / "raw"

TARGET_SLUGS = {"bello", "envigado", "itagui", "la-estrella", "sabaneta"}

SLUG_MUN_DB = {
    "bello":       "BELLO",
    "envigado":    "ENVIGADO",
    "itagui":      "ITAGUI",
    "la-estrella": "LA ESTRELLA",
    "sabaneta":    "SABANETA",
}

# Accepted municipio values per slug (for cross-mun filter)
SLUG_VALID_MUNICIPIOS = {
    "bello":       {"BELLO"},
    "envigado":    {"ENVIGADO"},
    "itagui":      {"ITAGÜÍ", "ITAGUI", "ITAGUÍ"},
    "la-estrella": {"LA ESTRELLA"},
    "sabaneta":    {"SABANETA"},
}

FINCARAIZ_URL = "https://www.fincaraiz.com.co/ficha/{}"

# Outlier filters
MIN_PRECIO_M2 = 500_000
MAX_PRECIO_M2 = 30_000_000
MIN_ARRIENDO  = 300_000
MAX_ARRIENDO  = 30_000_000
MIN_AREA = 20
MAX_AREA = 1000


def norm(s: str) -> str:
    nfd = unicodedata.normalize("NFD", s)
    return nfd.encode("ascii", "ignore").decode("ascii").strip().upper()


# ── Step 1: Insert GeoJSON polygons ──────────────────────────────────────────

def load_geojson_to_db(cur, dry_run: bool) -> list[dict]:
    # raw.barrios ya está poblada en prod y es la fuente de verdad de las
    # geometrías de barrios; se leen de ahí para el point-in-polygon en vez del
    # geojson estático (public/data/barrios_valle_aburra.geojson NO se copia a la
    # imagen de cron → FileNotFoundError tumbaba todo el load de Valle de Aburrá).
    # ponytail: ya no inserta barrios nuevos desde archivo; si apareciera un barrio
    # que no está en raw.barrios, sus listings caen al vecino <2km o se saltan.
    norm_mun_slug = {norm(mun): slug for slug, mun in SLUG_MUN_DB.items()}

    cur.execute("""
        SELECT id, nombre, municipio, ST_AsGeoJSON(geometry) AS geojson
        FROM raw.barrios
        WHERE geometry IS NOT NULL
    """)

    result = []
    for row in cur.fetchall():
        slug = norm_mun_slug.get(norm(row["municipio"] or ""))
        if not slug:
            continue
        try:
            shp = shape(json.loads(row["geojson"])) if row["geojson"] else None
        except Exception:
            shp = None
        result.append({
            "barrio_id": row["id"],
            "nombre_db": row["nombre"],
            "mun_db": row["municipio"],
            "slug": slug,
            "geom": shp,
        })

    print(f"raw.barrios: {len(result)} barrios de Valle de Aburrá leídos de la DB")
    return result


# ── Step 2 + 3: Load real listings, assign barrio via PIP, insert ─────────────

def load_real_listings(cur, db_features: list[dict], dry_run: bool):
    # Group DB features by slug for PIP
    by_slug: dict[str, list[dict]] = {}
    for f in db_features:
        by_slug.setdefault(f["slug"], []).append(f)

    # Existing URLs — used only to skip dup check before upsert (ON CONFLICT handles actual dedup)
    cur.execute("SELECT url FROM raw.listings_fincaraiz WHERE url IS NOT NULL")
    existing_urls = {row["url"] for row in cur.fetchall()}

    venta_n = arriendo_n = skipped_mun = skipped_geo = skipped_dup = 0

    for json_file in sorted(RAW_DIR.glob("*.json")):
        # Parse slug from filename: {slug}_{tipo}.json  (la-estrella_venta.json)
        stem = json_file.stem
        # Find matching target slug
        slug = None
        for s in TARGET_SLUGS:
            if stem.startswith(s + "_"):
                slug = s
                tipo_str = stem[len(s)+1:]
                break
        if not slug:
            continue

        valid_muns = SLUG_VALID_MUNICIPIOS[slug]

        with open(json_file) as f:
            listings = json.load(f)

        for lst in listings:
            if not lst:
                continue

            # Filter wrong municipality
            municipio = (lst.get("municipio") or "").upper().strip()
            if municipio and municipio not in valid_muns:
                skipped_mun += 1
                continue

            lat = lst.get("lat")
            lng = lst.get("lng")
            tipo = lst.get("tipo", tipo_str)
            precio = lst.get("precio") or 0
            area = lst.get("area") or 0.0
            listing_id = lst.get("id")

            if not listing_id:
                skipped_geo += 1
                continue

            url = FINCARAIZ_URL.format(listing_id)
            # Already-known URLs are UPSERTED (price/area/last_seen refresh), not
            # skipped: skipping froze prices and made every listing look unseen.
            if url in existing_urls:
                skipped_dup += 1  # counted as "updated" below

            # Filter outliers
            if tipo == "venta":
                precio_m2 = lst.get("precio_m2") or 0
                if not (MIN_PRECIO_M2 <= precio_m2 <= MAX_PRECIO_M2):
                    continue
                if area > 0 and not (MIN_AREA <= area <= MAX_AREA):
                    continue
            else:
                if not (MIN_ARRIENDO <= precio <= MAX_ARRIENDO):
                    continue
                if area > 0 and not (MIN_AREA <= area <= MAX_AREA):
                    continue

            # Polygon check (not the lat/lon box) + barrio with a 300 m cap.
            barrio_id = None
            if lat and lng:
                if not in_valle(cur, lat, lng):
                    skipped_geo += 1
                    continue
                barrio_id = resolve_barrio(cur, lat, lng)

            if barrio_id is None:
                skipped_geo += 1
                continue

            tipo_inmueble = lst.get("tipo_inmueble", "apartamento")

            raw_data_json = json.dumps({
                "id": listing_id,
                "descripcion": lst.get("descripcion"),
                "amenidades": lst.get("amenidades") or [],
            })

            amenidades_list = lst.get("amenidades") or []

            if not dry_run:
                cur.execute(
                    """
                    INSERT INTO raw.listings_fincaraiz
                        (fuente, tipo_operacion, tipo_inmueble, precio, area_m2,
                         habitaciones, banos, direccion_raw,
                         barrio_id, url, barrio_raw, municipio_raw, raw_data, activo,
                         lat, lon, estrato_real, descripcion, amenidades, fecha_scraping,
                         fotos, last_seen_at, destacado, anunciante_tipo, moneda,
                         precio_incluye_admin, area_tipo)
                    VALUES ('fincaraiz',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,true,%s,%s,%s,%s,%s,NOW(),
                            %s,NOW(),%s,%s,%s,%s,%s)
                    ON CONFLICT (url) DO UPDATE SET
                        descripcion    = COALESCE(EXCLUDED.descripcion, listings_fincaraiz.descripcion),
                        amenidades     = COALESCE(EXCLUDED.amenidades, listings_fincaraiz.amenidades),
                        fotos          = CASE WHEN array_length(EXCLUDED.fotos,1) > 0 THEN EXCLUDED.fotos ELSE listings_fincaraiz.fotos END,
                        precio         = EXCLUDED.precio,
                        area_m2        = EXCLUDED.area_m2,
                        habitaciones   = EXCLUDED.habitaciones,
                        banos          = EXCLUDED.banos,
                        tipo_inmueble  = EXCLUDED.tipo_inmueble,
                        raw_data       = EXCLUDED.raw_data,
                        fecha_scraping = EXCLUDED.fecha_scraping,
                        barrio_id      = COALESCE(EXCLUDED.barrio_id, listings_fincaraiz.barrio_id),
                        activo         = true,
                        last_seen_at   = NOW(),
                        destacado      = EXCLUDED.destacado,
                        anunciante_tipo = COALESCE(EXCLUDED.anunciante_tipo, listings_fincaraiz.anunciante_tipo),
                        moneda         = EXCLUDED.moneda,
                        precio_incluye_admin = EXCLUDED.precio_incluye_admin,
                        area_tipo      = EXCLUDED.area_tipo
                    """,
                    (
                        tipo, tipo_inmueble, precio, area if area > 0 else None,
                        lst.get("habitaciones"), lst.get("banos"),
                        lst.get("direccion"),
                        barrio_id, url,
                        (lst.get("barrio") or "").upper(),
                        (lst.get("municipio") or "").upper() or None,
                        raw_data_json,
                        float(lat) if lat else None,
                        float(lng) if lng else None,
                        lst.get("estrato") or None,
                        lst.get("descripcion"),
                        amenidades_list if amenidades_list else None,
                        (lst.get("fotos") or None),
                        lst.get("destacado"),
                        lst.get("anunciante_tipo"),
                        lst.get("moneda") or "COP",
                        lst.get("precio_incluye_admin"),
                        lst.get("area_tipo"),
                    ),
                )

            existing_urls.add(url)
            if tipo == "venta":
                venta_n += 1
            else:
                arriendo_n += 1

    print(f"listings: {venta_n} venta + {arriendo_n} arriendo inserted")
    print(f"  skipped: {skipped_mun} wrong-mun, {skipped_geo} outside Valle/no-geo; {skipped_dup} existing URLs refreshed")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        print("── Step 1: GeoJSON → raw.barrios ─────────────────────────────")
        db_features = load_geojson_to_db(cur, args.dry_run)

        print("\n── Step 2+3: Real listings → raw.listings_fincaraiz ─────────")
        load_real_listings(cur, db_features, args.dry_run)

        if not args.dry_run:
            conn.commit()
            print("\n✓ Committed")
        else:
            conn.rollback()
            print("\n[dry-run] rolled back")

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print("""
── Step 4: Run dbt ────────────────────────────────────────────────
cd /home/edwlearn/urbi/dbt && dbt run --profiles-dir . --select \\
  staging.stg_listings_unificado \\
  analytics.barrios_mercado \\
  analytics.score_corto_plazo \\
  analytics.score_mediano_plazo \\
  analytics.score_largo_plazo \\
  analytics.barrios_score_consolidado
""")


if __name__ == "__main__":
    main()
