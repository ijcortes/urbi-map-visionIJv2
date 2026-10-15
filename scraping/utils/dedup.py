"""Single definition of the listing dedup hash (Python + the identical SQL).

Used by the Metrocuadrado scraper (dedup_hash column, cross-source dedup in
serving) and by scripts/dedup_fincaraiz.py. Before this module the formula was
copied in three places and could drift.
"""
from __future__ import annotations

import hashlib
import math

ARRIENDO_BUCKET = 500_000
VENTA_BUCKET = 10_000_000


def dedup_hash(barrio_raw, tipo_inmueble, tipo_operacion, habitaciones, banos, area_m2, precio) -> str:
    # math.floor(x + 0.5) matches PostgreSQL ROUND() half-away-from-zero (positive values)
    area_r = math.floor(float(area_m2 or 0) + 0.5)
    factor = ARRIENDO_BUCKET if (tipo_operacion or "").lower() == "arriendo" else VENTA_BUCKET
    precio_r = math.floor(float(precio or 0) / factor + 0.5) * factor
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


DEDUP_HASH_SQL = f"""MD5(
    LOWER(TRIM(COALESCE(barrio_raw, ''))) || '|' ||
    COALESCE(tipo_inmueble, '') || '|' ||
    COALESCE(tipo_operacion, '') || '|' ||
    COALESCE(habitaciones, 0)::text || '|' ||
    COALESCE(banos, 0)::text || '|' ||
    ROUND(COALESCE(area_m2, 0))::text || '|' ||
    CASE COALESCE(tipo_operacion, '')
        WHEN 'arriendo' THEN (ROUND(COALESCE(precio, 0) / {ARRIENDO_BUCKET})  * {ARRIENDO_BUCKET})::bigint::text
        ELSE                 (ROUND(COALESCE(precio, 0) / {VENTA_BUCKET}) * {VENTA_BUCKET})::bigint::text
    END
)"""
