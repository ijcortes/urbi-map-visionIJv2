"""Shared config for habi.co scraper — writes to raw.listings_habi."""
import hashlib
import os
from pathlib import Path
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from rapidfuzz import fuzz, process

_ROOT = Path(__file__).parent.parent.parent
load_dotenv(_ROOT / ".env.local")
load_dotenv(_ROOT / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]

# Valle de Aburrá city slugs as used on habi.co (verified: same convention as fincaraiz).
MUNICIPIOS_SLUGS = ["medellin", "bello", "itagui", "envigado", "sabaneta", "la-estrella"]

UPSERT_SQL = """
INSERT INTO raw.listings_habi (
    tipo_inmueble, precio, precio_anterior, discount_rate, area_m2,
    habitaciones, banos, parqueaderos, piso, num_ascensores,
    direccion_raw, barrio_raw, url, property_nid, property_uuid,
    barrio_id, raw_data, fecha_publicacion, dedup_hash, lat, lon,
    municipio_raw, estrato_real, descripcion, amenidades, fotos,
    antiguedad, administracion, url_360, correo_contacto,
    telefono_contacto, contacto_zona, has_three_checks,
    inventory_type_id, property_moment_id, is_private, remodelado,
    publicado_status, last_seen_at
) VALUES (
    %(tipo_inmueble)s, %(precio)s, %(precio_anterior)s, %(discount_rate)s, %(area_m2)s,
    %(habitaciones)s, %(banos)s, %(parqueaderos)s, %(piso)s, %(num_ascensores)s,
    %(direccion_raw)s, %(barrio_raw)s, %(url)s, %(property_nid)s, %(property_uuid)s,
    %(barrio_id)s, %(raw_data)s, %(fecha_publicacion)s, %(dedup_hash)s, %(lat)s, %(lon)s,
    %(municipio_raw)s, %(estrato_real)s, %(descripcion)s, %(amenidades)s, %(fotos)s,
    %(antiguedad)s, %(administracion)s, %(url_360)s, %(correo_contacto)s,
    %(telefono_contacto)s, %(contacto_zona)s, %(has_three_checks)s,
    %(inventory_type_id)s, %(property_moment_id)s, %(is_private)s, %(remodelado)s,
    %(publicado_status)s, NOW()
)
ON CONFLICT (property_nid) DO UPDATE SET
    precio              = EXCLUDED.precio,
    precio_anterior     = EXCLUDED.precio_anterior,
    discount_rate       = EXCLUDED.discount_rate,
    area_m2             = EXCLUDED.area_m2,
    habitaciones        = EXCLUDED.habitaciones,
    banos               = EXCLUDED.banos,
    parqueaderos        = EXCLUDED.parqueaderos,
    piso                = EXCLUDED.piso,
    num_ascensores      = EXCLUDED.num_ascensores,
    direccion_raw       = EXCLUDED.direccion_raw,
    barrio_raw          = EXCLUDED.barrio_raw,
    barrio_id           = EXCLUDED.barrio_id,
    raw_data            = EXCLUDED.raw_data,
    lat                 = EXCLUDED.lat,
    lon                 = EXCLUDED.lon,
    estrato_real        = EXCLUDED.estrato_real,
    descripcion         = EXCLUDED.descripcion,
    amenidades          = EXCLUDED.amenidades,
    fotos               = EXCLUDED.fotos,
    antiguedad          = EXCLUDED.antiguedad,
    administracion      = EXCLUDED.administracion,
    url_360             = EXCLUDED.url_360,
    -- contact PII is no longer collected; NULL out on every refresh (Ley 1581 minimisation)
    correo_contacto     = NULL,
    telefono_contacto   = NULL,
    contacto_zona       = EXCLUDED.contacto_zona,
    has_three_checks    = EXCLUDED.has_three_checks,
    inventory_type_id   = EXCLUDED.inventory_type_id,
    property_moment_id  = EXCLUDED.property_moment_id,
    is_private          = EXCLUDED.is_private,
    remodelado          = EXCLUDED.remodelado,
    publicado_status    = EXCLUDED.publicado_status,
    activo              = true,
    fecha_scraping      = NOW(),
    last_seen_at        = NOW()
"""


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def load_barrios(conn) -> list[dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, nombre, municipio FROM raw.barrios ORDER BY id")
        return [dict(r) for r in cur.fetchall()]


def match_barrio(
    barrio_raw: str,
    barrios: list[dict],
    municipio_hint: Optional[str] = None,
) -> Optional[int]:
    if not barrio_raw or not barrios:
        return None
    query = barrio_raw.upper()
    if municipio_hint:
        scoped = [b for b in barrios if b.get("municipio", "").upper() == municipio_hint.upper()]
        if scoped:
            nombres_s = [b["nombre"] for b in scoped]
            result = process.extractOne(
                query, nombres_s, scorer=fuzz.token_set_ratio, score_cutoff=68
            )
            if result:
                return scoped[nombres_s.index(result[0])]["id"]
    nombres = [b["nombre"] for b in barrios]
    result = process.extractOne(query, nombres, scorer=fuzz.token_set_ratio, score_cutoff=70)
    if not result:
        return None
    return barrios[nombres.index(result[0])]["id"]


def barrio_from_coords(conn, lat: float, lon: float) -> Optional[int]:
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


def make_dedup_hash(url: str) -> str:
    return hashlib.md5(f"habi:{url}".encode()).hexdigest()


def upsert_listing(conn, listing: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(UPSERT_SQL, listing)
    conn.commit()
