"""Materialized cache refresh for listings query.

Replaces 3 per-request CTEs (med, bctx, barrio_cd) and 3-way lat/lon JOINs
with pre-computed analytics tables. Called on API startup and every hour.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

_CACHE_REFRESH_INTERVAL = 3600  # seconds

_INSERT_BARRIOS_MEDIANAS = """
INSERT INTO analytics.barrios_medianas (barrio_id, tipo_inmueble, m2_mediana, arr_mediana, m2_p25, m2_p75, arr_p25, arr_p75, refreshed_at)
SELECT
    barrio_id,
    tipo_inmueble,
    ROUND(
        PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY precio_cop::float / NULLIF(area_m2, 0)
        ) FILTER (WHERE
            tipo_operacion = 'venta'
            AND area_m2 > 0
            AND precio_cop::float / area_m2 > 500000
            AND precio_cop::float / area_m2 < 50000000
        )
    )::bigint AS m2_mediana,
    CASE
        WHEN COUNT(*) FILTER (WHERE tipo_operacion = 'arriendo'
                              AND precio_cop BETWEEN 300000 AND 50000000) >= 3
        THEN PERCENTILE_CONT(0.5) WITHIN GROUP (
                 ORDER BY precio_cop::float
             ) FILTER (WHERE tipo_operacion = 'arriendo'
                       AND precio_cop BETWEEN 300000 AND 50000000)::bigint
        ELSE NULL
    END AS arr_mediana,
    ROUND(
        PERCENTILE_CONT(0.25) WITHIN GROUP (
            ORDER BY precio_cop::float / NULLIF(area_m2, 0)
        ) FILTER (WHERE
            tipo_operacion = 'venta'
            AND area_m2 > 0
            AND precio_cop::float / area_m2 > 500000
            AND precio_cop::float / area_m2 < 50000000
        )
    )::bigint AS m2_p25,
    ROUND(
        PERCENTILE_CONT(0.75) WITHIN GROUP (
            ORDER BY precio_cop::float / NULLIF(area_m2, 0)
        ) FILTER (WHERE
            tipo_operacion = 'venta'
            AND area_m2 > 0
            AND precio_cop::float / area_m2 > 500000
            AND precio_cop::float / area_m2 < 50000000
        )
    )::bigint AS m2_p75,
    CASE
        WHEN COUNT(*) FILTER (WHERE tipo_operacion = 'arriendo'
                              AND precio_cop BETWEEN 300000 AND 50000000) >= 3
        THEN PERCENTILE_CONT(0.25) WITHIN GROUP (
                 ORDER BY precio_cop::float
             ) FILTER (WHERE tipo_operacion = 'arriendo'
                       AND precio_cop BETWEEN 300000 AND 50000000)::bigint
        ELSE NULL
    END AS arr_p25,
    CASE
        WHEN COUNT(*) FILTER (WHERE tipo_operacion = 'arriendo'
                              AND precio_cop BETWEEN 300000 AND 50000000) >= 3
        THEN PERCENTILE_CONT(0.75) WITHIN GROUP (
                 ORDER BY precio_cop::float
             ) FILTER (WHERE tipo_operacion = 'arriendo'
                       AND precio_cop BETWEEN 300000 AND 50000000)::bigint
        ELSE NULL
    END AS arr_p75,
    now()
FROM staging.stg_listings_unificado
WHERE precio_cop > 0 AND barrio_id IS NOT NULL
GROUP BY barrio_id, tipo_inmueble
"""

_INSERT_BARRIOS_CONTEXTO = """
INSERT INTO analytics.barrios_contexto (
    barrio_id, yield_bruto_pct, n_listings_airbnb,
    score_corto, score_mediano, score_largo,
    liquidez_score, indice_nomada, seguridad_score,
    var_anual_pct, pct_wifi, refreshed_at
)
SELECT
    bm.barrio_id,
    bm.yield_bruto                AS yield_bruto_pct,
    bm.airbnb_n_listings          AS n_listings_airbnb,
    sc.score_corto,
    sc.score_mediano,
    sc.score_largo,
    lq.liquidez_score,
    poi.indice_nomada,
    seg.score_seguridad_residente AS seguridad_score,
    sl.var_anual_5anos_pct        AS var_anual_pct,
    am.pct_wifi,
    now()
FROM analytics.barrios_mercado bm
LEFT JOIN analytics.barrios_score_consolidado sc  ON sc.barrio_id = bm.barrio_id
LEFT JOIN analytics.barrios_liquidez          lq  ON lq.barrio_id = bm.barrio_id
LEFT JOIN analytics.barrios_pois_distancia    poi ON poi.barrio_id = bm.barrio_id
LEFT JOIN analytics.barrios_seguridad         seg ON seg.barrio_id = bm.barrio_id
LEFT JOIN analytics.score_largo_plazo         sl  ON sl.barrio_id = bm.barrio_id
LEFT JOIN analytics.barrios_amenities         am  ON am.barrio_id = bm.barrio_id
ON CONFLICT (barrio_id) DO UPDATE SET
    yield_bruto_pct   = EXCLUDED.yield_bruto_pct,
    n_listings_airbnb = EXCLUDED.n_listings_airbnb,
    score_corto       = EXCLUDED.score_corto,
    score_mediano     = EXCLUDED.score_mediano,
    score_largo       = EXCLUDED.score_largo,
    liquidez_score    = EXCLUDED.liquidez_score,
    indice_nomada     = EXCLUDED.indice_nomada,
    seguridad_score   = EXCLUDED.seguridad_score,
    var_anual_pct     = EXCLUDED.var_anual_pct,
    pct_wifi          = EXCLUDED.pct_wifi,
    refreshed_at      = EXCLUDED.refreshed_at
"""

# Plausibility bounds for serving (DAT-01). Wide on purpose: they only drop rows
# that are certainly wrong (typos, price in thousands, area in cm2, etc.).
_PLAUSIBLE = {
    "AREA_MIN": 8, "AREA_MAX": 20000, "AREA_MAX_LAND": 5000000,
    "PPM2_VENTA_MIN": 300000, "PPM2_VENTA_MAX": 60000000,
    "PPM2_ARRIENDO_MIN": 2000, "PPM2_ARRIENDO_MAX": 400000,
    "STACK_MIN": 5,
    # Above STACK_NULL listings share the EXACT same raw coordinate: that is never a real building,
    # it is a portal "city-centre" fallback for listings it could not geocode (metrocuadrado returned
    # ~900 El Poblado/Laureles/etc. listings at the La Candelaria centroid). Jittering 45m still leaves
    # a huge false downtown blob, so these get NO map pin (coord nulled); the listing stays in list/search.
    "STACK_NULL": 50,
}

_REFRESH_STG_LISTINGS_TMPL = """
INSERT INTO staging.stg_listings_unificado
    (listing_uid, fuente, tier, tipo_operacion, tipo_inmueble,
     precio_cop, precio_usd, precio_min_cluster, precio_max_cluster, precio_variable,
     area_m2, precio_m2, habitaciones, banos, barrio_raw, barrio_id,
     direccion_raw, lat, lon, geom, url, fotos, fecha_scraping, n_duplicados, estrato_real,
     amoblado, antiguedad, amenidades, administracion, nombre_edificio, geo_aproximada)
WITH todas_fuentes_raw AS (
    SELECT id::text || '_mq'                       AS listing_uid,
           'metrocuadrado'                          AS fuente,
           'standard'                               AS tier,
           tipo_operacion, tipo_inmueble,
           precio                                   AS precio_cop,
           NULL::bigint                             AS precio_usd,
           area_m2, habitaciones, banos::numeric    AS banos,
           barrio_raw,
           -- Resolver barrio_id espacialmente cuando el loader lo dejó NULL (coords
           -- válidas pero sin barrio asignado) -> así el listing aparece en la vista
           -- por-barrio, no solo en el mapa. COALESCE: solo corre el PIP para los NULL
           -- (~14k mc, ~316ms indexado GIST). Mismo patrón que la rama 'propio'.
           COALESCE(barrio_id, (SELECT b.id FROM raw.barrios b
             WHERE lat IS NOT NULL AND lon IS NOT NULL
               AND ST_Contains(b.geometry, ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326))
             LIMIT 1))                               AS barrio_id,
           direccion_raw,
           lat, lon,
           CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326) END AS geom,
           url, fotos, fecha_scraping, dedup_hash,
           COALESCE(estrato_real, estrato)           AS estrato_real,
           NULL::boolean                             AS amoblado,
           antiguedad, amenidades, administracion,
           NULLIF(TRIM(raw_data::jsonb ->> 'mnombreproyecto'), '') AS nombre_edificio
    FROM raw.listings_metrocuadrado WHERE activo = true AND url_activa IS NOT FALSE AND precio > 0 AND area_m2 > 0
    UNION ALL
    SELECT id::text || '_fz', 'fincaraiz', 'standard',
           tipo_operacion, tipo_inmueble,
           precio::bigint                            AS precio_cop,
           NULL::bigint                             AS precio_usd,
           area_m2, habitaciones, banos::numeric    AS banos,
           barrio_raw,
           -- barrio_id espacial para los NULL (ver nota en la rama metrocuadrado arriba).
           COALESCE(barrio_id, (SELECT b.id FROM raw.barrios b
             WHERE lat IS NOT NULL AND lon IS NOT NULL
               AND ST_Contains(b.geometry, ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326))
             LIMIT 1))                               AS barrio_id,
           direccion_raw,
           lat::double precision, lon::double precision,
           CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326) END AS geom,
           url, fotos, fecha_scraping, dedup_hash,
           estrato_real,
           ('Amoblado' = ANY(COALESCE(amenidades, '{}'::text[]))) AS amoblado,
           antiguedad, amenidades, administracion,
           NULLIF(TRIM(CASE
             WHEN (REGEXP_MATCH(descripcion, '(?i)conjunto\\s+(?:residencial|cerrado)\\s+([^\\s,\\.!\\?;:\\(\\)]{3,25}(?:\\s+[^\\s,\\.!\\?;:\\(\\)]{3,25}){0,3})'))[1] ~ '^[A-ZÁÉÍÓÚÑ]'
             THEN (REGEXP_MATCH(descripcion, '(?i)conjunto\\s+(?:residencial|cerrado)\\s+([^\\s,\\.!\\?;:\\(\\)]{3,25}(?:\\s+[^\\s,\\.!\\?;:\\(\\)]{3,25}){0,3})'))[1]
             WHEN (REGEXP_MATCH(descripcion, '(?i)edificio\\s+([^\\s,\\.!\\?;:\\(\\)]{3,25}(?:\\s+[^\\s,\\.!\\?;:\\(\\)]{3,25}){0,2})'))[1] ~ '^[A-ZÁÉÍÓÚÑ]'
             THEN (REGEXP_MATCH(descripcion, '(?i)edificio\\s+([^\\s,\\.!\\?;:\\(\\)]{3,25}(?:\\s+[^\\s,\\.!\\?;:\\(\\)]{3,25}){0,2})'))[1]
             ELSE NULL
           END), '') AS nombre_edificio
    FROM raw.listings_fincaraiz WHERE activo = true AND url_activa IS NOT FALSE AND duplicado_de IS NULL AND precio > 0 AND area_m2 > 0
    UNION ALL
    SELECT id::text || '_habi', 'habi', 'standard',
           tipo_operacion, tipo_inmueble,
           precio::bigint                            AS precio_cop,
           NULL::bigint                             AS precio_usd,
           area_m2, habitaciones, banos::numeric    AS banos,
           barrio_raw, barrio_id, direccion_raw,
           lat::double precision, lon::double precision,
           CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326) END AS geom,
           url, fotos, fecha_scraping, dedup_hash,
           estrato_real,
           NULL::boolean                             AS amoblado,
           antiguedad::text, amenidades, administracion,
           NULL::text                                AS nombre_edificio
    FROM raw.listings_habi WHERE activo = true AND precio > 0 AND area_m2 > 0
    UNION ALL
    -- Socio patrocinado: todos sus listings entran como agencia_premium (prioridad
    -- de sort + badge dorado ya cableados en frontend, tier hasta ahora sin ocupante).
    SELECT id::text || '_cdc', 'casadolcecasa', 'agencia_premium',
           tipo_operacion, tipo_inmueble,
           precio::bigint                            AS precio_cop,
           NULL::bigint                             AS precio_usd,
           area_m2, habitaciones, banos::numeric    AS banos,
           barrio_raw, barrio_id, direccion_raw,
           lat::double precision, lon::double precision,
           CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326) END AS geom,
           url, fotos, fecha_scraping, dedup_hash,
           estrato_real,
           NULL::boolean                             AS amoblado,
           antiguedad, amenidades, NULL::numeric AS administracion,
           NULL::text                                AS nombre_edificio
    FROM raw.listings_casadolcecasa WHERE activo = true AND precio > 0 AND area_m2 > 0
    UNION ALL
    SELECT id::text || '_pr', fuente, COALESCE(fuente_tipo,'standard'), tipo_operacion,
           tipo_inmueble, precio_cop, precio_usd, area_m2, habitaciones, banos, barrio_raw,
           barrio_id, direccion_raw, lat::double precision, lon::double precision,
           CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326) END AS geom,
           url, fotos, fecha_scraping, dedup_hash, NULL::integer,
           NULL::boolean,
           NULL::text AS antiguedad, amenidades, NULL::numeric AS administracion,
           NULL::text AS nombre_edificio
    FROM raw.listings_premium WHERE activo IS NOT FALSE AND precio_cop > 0 AND area_m2 > 0
    UNION ALL
    SELECT id::text || '_rm', fuente, 'renta_media', 'arriendo', 'apartamento', precio_mes_cop,
           NULL::bigint, area_m2, habitaciones, banos, barrio_raw, barrio_id, NULL::text,
           lat::double precision, lon::double precision,
           CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(lon::float, lat::float), 4326) END,
           url, fotos, fecha_scraping, dedup_hash, NULL::integer,
           amoblado,
           NULL::text AS antiguedad, amenidades, NULL::numeric AS administracion,
           NULL::text AS nombre_edificio
    FROM raw.listings_renta_media WHERE activo IS NOT FALSE AND precio_mes_cop > 0
    UNION ALL
    -- Modelo unificado: publicaciones directas (owner/agente) en tabla listing.
    -- Entran al mapa en 'publicado' aunque verificado=false (publica primero).
    SELECT
        l.id::text || '_ls'                                      AS listing_uid,
        'propio'                                                  AS fuente,
        CASE WHEN l.destacado THEN 'agente_premium'
             ELSE 'standard' END                                  AS tier,
        l.operacion::text, l.tipo_inmueble::text,
        l.precio::bigint                                          AS precio_cop,
        NULL::bigint                                              AS precio_usd,
        COALESCE(l.area_m2, 0)::numeric                          AS area_m2,
        l.habitaciones, l.banos::numeric                         AS banos,
        l.barrio                                                  AS barrio_raw,
        -- Resolver barrio_id espacialmente desde geom (antes NULL → sin georef →
        -- el listing propio nunca aparecía en el mapa). Fallback al más cercano.
        (SELECT b.id FROM raw.barrios b
          WHERE l.geom IS NOT NULL AND ST_Contains(b.geometry, l.geom)
          LIMIT 1)                                                AS barrio_id,
        l.direccion_aprox                                         AS direccion_raw,
        ST_Y(l.geom)::double precision, ST_X(l.geom)::double precision,
        l.geom,
        l.id::text                                                AS url,
        (SELECT array_agg(m.url ORDER BY m.orden) FROM listing_media m
         WHERE m.listing_id = l.id)                              AS fotos,
        COALESCE(l.published_at, l.created_at)                   AS fecha_scraping,
        md5(l.id::text || '_ls')                                 AS dedup_hash,
        l.estrato                                                 AS estrato_real,
        l.amoblado,
        l.antiguedad_anios::text, l.amenidades, l.administracion,
        l.nombre_edificio
    FROM listing l
    WHERE l.estado = 'publicado' AND l.precio > 0
),
-- Normalisation + plausibility gate. Raw rows are never modified or deleted; rows
-- outside these (deliberately wide) bounds are simply not served. Land types keep
-- a huge area range and no price/m2 bound (value per m2 varies by orders of magnitude).
todas_fuentes AS (
    SELECT listing_uid, fuente, tier,
           lower(trim(tipo_operacion)) AS tipo_operacion,
           lower(trim(tipo_inmueble))  AS tipo_inmueble,
           precio_cop, precio_usd, area_m2, habitaciones, banos, barrio_raw, barrio_id,
           direccion_raw, lat, lon, geom, url, fotos, fecha_scraping, dedup_hash,
           estrato_real, amoblado, antiguedad, amenidades, administracion, nombre_edificio
    FROM todas_fuentes_raw
    WHERE (fuente = 'propio' AND area_m2 = 0)          -- direct posts may omit the area
       OR (
           area_m2 >= {AREA_MIN}
           AND area_m2 <= CASE WHEN lower(tipo_inmueble) ~ '^(lote|terreno|finca|bodega)'
                               THEN {AREA_MAX_LAND} ELSE {AREA_MAX} END
           AND (
               lower(tipo_inmueble) ~ '^(lote|terreno|finca)'
               OR (lower(tipo_operacion) LIKE 'venta%'
                   AND precio_cop / area_m2 BETWEEN {PPM2_VENTA_MIN} AND {PPM2_VENTA_MAX})
               OR (lower(tipo_operacion) LIKE 'arriendo%'
                   AND precio_cop / area_m2 BETWEEN {PPM2_ARRIENDO_MIN} AND {PPM2_ARRIENDO_MAX})
               OR (lower(tipo_operacion) NOT LIKE 'venta%' AND lower(tipo_operacion) NOT LIKE 'arriendo%')
           )
       )
),
-- Cross-portal duplicates: same physical attributes, within 40 m of each other and
-- a price within ~5 % (log bucket). Replaces the fixed ~111 m grid, which merged
-- different units of the same block and split true duplicates across cell edges.
geo_cluster AS (
    SELECT t.*,
           FLOOR(LN(GREATEST(precio_cop, 1)::float8) / LN(1.05))::int AS precio_bucket,
           ST_ClusterDBSCAN(ST_Transform(geom, 3857), eps := 40, minpoints := 1) OVER (
               PARTITION BY tipo_operacion, tipo_inmueble, habitaciones,
                            (ROUND(area_m2::numeric/5)*5),
                            FLOOR(LN(GREATEST(precio_cop, 1)::float8) / LN(1.05))
           ) AS geo_cid
    FROM todas_fuentes t WHERE geom IS NOT NULL
),
con_geo AS (
    SELECT listing_uid, fuente, tier, tipo_operacion, tipo_inmueble, precio_cop, precio_usd,
           area_m2, habitaciones, banos, barrio_raw, barrio_id, direccion_raw, lat, lon, geom,
           url, fotos, fecha_scraping, estrato_real, amoblado, antiguedad, amenidades, administracion,
           nombre_edificio,
           MIN(precio_cop) OVER w AS precio_min_cluster,
           MAX(precio_cop) OVER w AS precio_max_cluster,
           COUNT(*)        OVER w AS n_duplicados,
           ROW_NUMBER() OVER (w
               ORDER BY CASE tier WHEN 'agencia_premium' THEN 1 WHEN 'renta_media' THEN 2
                        WHEN 'standard' THEN 3 ELSE 4 END, fecha_scraping DESC NULLS LAST) AS _rn
    FROM geo_cluster
    WINDOW w AS (PARTITION BY tipo_operacion, tipo_inmueble, habitaciones,
                 (ROUND(area_m2::numeric/5)*5), precio_bucket, geo_cid)
),
sin_geo AS (
    SELECT listing_uid, fuente, tier, tipo_operacion, tipo_inmueble, precio_cop, precio_usd,
           area_m2, habitaciones, banos, barrio_raw, barrio_id, direccion_raw, lat, lon, geom,
           url, fotos, fecha_scraping, estrato_real, amoblado, antiguedad, amenidades, administracion,
           nombre_edificio,
           precio_cop AS precio_min_cluster, precio_cop AS precio_max_cluster,
           COUNT(*) OVER (PARTITION BY COALESCE(dedup_hash,
               COALESCE(barrio_id::text,barrio_raw,'x')||'|'||COALESCE(tipo_operacion,'?')||'|'||
               COALESCE(tipo_inmueble,'?')||'|'||COALESCE(habitaciones::text,'?')||'|'||
               (ROUND(area_m2::numeric/5)*5)::text)) AS n_duplicados,
           ROW_NUMBER() OVER (PARTITION BY COALESCE(dedup_hash,
               COALESCE(barrio_id::text,barrio_raw,'x')||'|'||COALESCE(tipo_operacion,'?')||'|'||
               COALESCE(tipo_inmueble,'?')||'|'||COALESCE(habitaciones::text,'?')||'|'||
               (ROUND(area_m2::numeric/5)*5)::text)
               ORDER BY CASE tier WHEN 'agencia_premium' THEN 1 WHEN 'renta_media' THEN 2
                        WHEN 'standard' THEN 3 ELSE 4 END, fecha_scraping DESC NULLS LAST) AS _rn
    FROM todas_fuentes WHERE geom IS NULL
),
elegidos AS (
SELECT listing_uid, fuente, tier, tipo_operacion, tipo_inmueble, precio_cop, precio_usd,
       precio_min_cluster, precio_max_cluster,
       CASE WHEN n_duplicados > 1 AND precio_min_cluster IS DISTINCT FROM precio_max_cluster
            THEN true ELSE false END AS precio_variable,
       area_m2, CASE WHEN area_m2 > 0 THEN precio_cop / area_m2 END AS precio_m2,
       habitaciones, banos, barrio_raw, barrio_id, direccion_raw, lat, lon, geom,
       url, fotos, fecha_scraping, n_duplicados, estrato_real, amoblado, antiguedad, amenidades, administracion, nombre_edificio
FROM con_geo WHERE _rn = 1
UNION ALL
SELECT listing_uid, fuente, tier, tipo_operacion, tipo_inmueble, precio_cop, precio_usd,
       precio_min_cluster, precio_max_cluster, false AS precio_variable,
       area_m2, CASE WHEN area_m2 > 0 THEN precio_cop / area_m2 END AS precio_m2,
       habitaciones, banos, barrio_raw, barrio_id, direccion_raw, lat, lon, geom,
       url, fotos, fecha_scraping, n_duplicados, estrato_real, amoblado, antiguedad, amenidades, administracion, nombre_edificio
FROM sin_geo WHERE _rn = 1
),
-- Stacked coordinates (centroid geocoding: many listings on the exact same point).
-- Spread them deterministically inside ~45 m so pins stop hiding each other and
-- flag them as approximate; isolated points are left untouched.
apilados AS (
    SELECT e.*,
           COUNT(*) OVER (PARTITION BY lat, lon) AS stack_n,
           sqrt((abs(hashtext(listing_uid)) % 1000) / 1000.0) * 0.0004 AS jr,
           2 * pi() * ((abs(hashtext(listing_uid || '#')) % 1000) / 1000.0) AS ja
    FROM elegidos e
)
SELECT listing_uid, fuente, tier, tipo_operacion, tipo_inmueble, precio_cop, precio_usd,
       precio_min_cluster, precio_max_cluster, precio_variable,
       area_m2, precio_m2, habitaciones, banos, barrio_raw, barrio_id, direccion_raw,
       CASE WHEN stack_n >= {STACK_NULL} THEN NULL
            WHEN stack_n >= {STACK_MIN} THEN lat + jr * cos(ja) ELSE lat END AS lat,
       CASE WHEN stack_n >= {STACK_NULL} THEN NULL
            WHEN stack_n >= {STACK_MIN} THEN lon + jr * sin(ja) ELSE lon END AS lon,
       CASE WHEN stack_n >= {STACK_NULL} THEN NULL
            WHEN stack_n >= {STACK_MIN} AND lat IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(lon + jr * sin(ja), lat + jr * cos(ja)), 4326)
            ELSE geom END AS geom,
       url, fotos, fecha_scraping, n_duplicados, estrato_real, amoblado, antiguedad, amenidades,
       administracion, nombre_edificio,
       (stack_n >= {STACK_MIN} AND lat IS NOT NULL) AS geo_aproximada
FROM apilados
"""

_REFRESH_STG_LISTINGS = _REFRESH_STG_LISTINGS_TMPL
for _k, _v in _PLAUSIBLE.items():
    _REFRESH_STG_LISTINGS = _REFRESH_STG_LISTINGS.replace("{" + _k + "}", str(_v))

_INSERT_LISTINGS_GEOREF = """
INSERT INTO analytics.listings_georef_new
    (url, lat, lon, url_activa, estrato_real, uso_suelo_pot, estrato_manzana, fecha_primera_vez, refreshed_at)
SELECT DISTINCT ON (l.url)
    l.url,
    l.lat,
    l.lon,
    TRUE           AS url_activa,
    l.estrato_real AS estrato_real,
    pot.areagraluso,
    em.estrato,
    fpv.fecha_primera_vez,
    now()
FROM staging.stg_listings_unificado l
JOIN raw.barrios b ON b.id = l.barrio_id
-- First-seen (dias_en_mercado universal): keyed por url desde cada tabla fuente.
-- Corre por hora en el refresh (no per-request). Propios: url staging = id::text.
LEFT JOIN (
    SELECT url, fecha_primera_vez FROM raw.listings_metrocuadrado
    UNION ALL SELECT url, fecha_primera_vez FROM raw.listings_fincaraiz
    UNION ALL SELECT url, fecha_primera_vez FROM raw.listings_habi
    UNION ALL SELECT url, fecha_primera_vez FROM raw.listings_casadolcecasa
    UNION ALL SELECT url, fecha_primera_vez FROM raw.listings_premium
    UNION ALL SELECT url, fecha_primera_vez FROM raw.listings_renta_media
    UNION ALL SELECT id::text AS url, created_at AS fecha_primera_vez FROM public.listing
) fpv ON fpv.url = l.url
-- Uso de suelo POT: point-in-polygon con buffer 0.0003° (~30m) para costuras
-- de reproyección — ST_Contains exacto llega a 72.6% de cobertura en
-- Medellín, el buffer sube a ~96% (verificado 2026-08-25). ORDER BY prefiere
-- el match exacto (Contains) sobre el de buffer cuando ambos existen.
-- pot_usos_medellin es Medellín-only — NULL en los otros 9 municipios, esperado.
LEFT JOIN LATERAL (
    SELECT p.areagraluso
    FROM raw.pot_usos_medellin p
    WHERE b.municipio ILIKE 'MEDELLIN'
      AND ST_DWithin(p.geometry, ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326), 0.0003)
    ORDER BY ST_Contains(p.geometry, ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326)) DESC
    LIMIT 1
) pot ON TRUE
-- Estrato a nivel manzana (más fino que estrato_real/comuna) — 99.9% cobertura
-- directa en Medellín, sin necesidad de buffer.
LEFT JOIN LATERAL (
    SELECT em.estrato
    FROM raw.estratos_manzana em
    WHERE b.municipio ILIKE 'MEDELLIN'
      AND ST_Contains(em.geometry, ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326))
    LIMIT 1
) em ON TRUE
WHERE (l.precio_cop >= 500000 OR (l.tipo_operacion = 'arriendo' AND l.precio_cop >= 150000))
  AND NOT (l.tipo_operacion = 'arriendo' AND l.precio_cop > 50000000)
  AND NOT (l.tipo_operacion = 'venta'    AND l.precio_cop > 50000000000)
  AND l.lat IS NOT NULL AND l.lat != 0
  AND ST_DWithin(
      ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326)::geography,
      b.geometry::geography,
      2000
  )
ORDER BY l.url
"""


_NORMALIZE_STUDIO_SQL = """
UPDATE {table}
   SET tipo_inmueble = 'apartamento', habitaciones = 0
 WHERE lower(tipo_inmueble) = 'apartaestudio'
"""

# Hot-path indexes of /listings and /listings/viewport. The staging table is rebuilt
# (swap-table) every hour, so indexes created by alembic on the old table vanish —
# they must be (re)created here, on the NEW table before the RENAME.
_LISTING_FILTER_INDEXES = (
    "CREATE INDEX ON {t} (tipo_operacion, lower(tipo_inmueble), precio_cop)",
    "CREATE INDEX ON {t} (lat, lon)",
)


async def _create_listing_filter_indexes(conn: Any, table: str) -> None:
    for tmpl in _LISTING_FILTER_INDEXES:
        await conn.execute(tmpl.format(t=table))
    # Trigram index for the `busqueda` ILIKE '%x%' address search — only when the
    # extension is installed (alembic 0106 tries to create it; needs privileges).
    has_trgm = await conn.fetchval("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm')")
    if has_trgm:
        await conn.execute(f"CREATE INDEX ON {table} USING gin (direccion_raw gin_trgm_ops)")


async def refresh_listings_cache(pool: Any) -> None:
    """Refresh all dynamic cache tables. barrios_cd is static — not refreshed here."""
    try:
        async with pool.acquire() as conn:
            # Cache rebuild runs heavy percentile/aggregate queries that exceed the
            # pool-wide 15s statement_timeout — raise it for this connection only
            # (asyncpg RESET ALL on release reverts to the 15s default).
            await conn.execute("SET statement_timeout = '600000'")
            # asyncpg's own command_timeout=30 (api/db.py) is client-side and
            # independent from the server-side statement_timeout above — must
            # be overridden per-call too, or heavy queries below get killed at
            # 30s with an empty-message TimeoutError.
            heavy_timeout = 600
            # stg_listings_unificado: rebuild from raw tables (normally managed by dbt;
            # this keeps it fresh on environments where dbt doesn't run, e.g. Railway)
            stg_exists = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='staging' AND table_name='stg_listings_unificado')"
            )
            if stg_exists:
                # verificado: flag del modelo unificado (listing). Solo las filas
                # '_ls' lo llevan; el resto de fuentes queda FALSE. ADD COLUMN
                # idempotente sobrevive a un recreate de la tabla por dbt/migración.
                # verificado: flag del modelo unificado (listing). Solo las filas
                # '_ls' lo llevan; el resto de fuentes queda FALSE. ADD COLUMN
                # idempotente sobrevive a un recreate de la tabla por dbt/migración.
                await conn.execute(
                    "ALTER TABLE staging.stg_listings_unificado "
                    "ADD COLUMN IF NOT EXISTS verificado BOOLEAN DEFAULT FALSE"
                )
                await conn.execute(
                    "ALTER TABLE staging.stg_listings_unificado "
                    "ADD COLUMN IF NOT EXISTS nombre_edificio TEXT"
                )
                await conn.execute(
                    "ALTER TABLE staging.stg_listings_unificado "
                    "ADD COLUMN IF NOT EXISTS geo_aproximada BOOLEAN DEFAULT FALSE"
                )
                # Swap-table (mismo patrón que listings_georef abajo). Antes: TRUNCATE+
                # INSERT tomaba ACCESS EXCLUSIVE y dejaba /listings + /viewport sin
                # responder durante TODO el rebuild (window fns + subquery espacial por
                # fila = minutos; ver feedback_truncate_insert_lock). Ahora se llena una
                # tabla nueva ya indexada y el RENAME final es ~instantáneo; los lectores
                # golpean la tabla vieja (poblada) hasta el swap.
                await conn.execute("DROP TABLE IF EXISTS staging.stg_listings_unificado_new")
                await conn.execute(
                    "CREATE TABLE staging.stg_listings_unificado_new "
                    "(LIKE staging.stg_listings_unificado INCLUDING DEFAULTS)"
                )
                await conn.execute(
                    _REFRESH_STG_LISTINGS.replace(
                        "INSERT INTO staging.stg_listings_unificado",
                        "INSERT INTO staging.stg_listings_unificado_new", 1),
                    timeout=heavy_timeout,
                )
                # Propagar verificado a las filas de publicación directa (_ls).
                await conn.execute(
                    "UPDATE staging.stg_listings_unificado_new s SET verificado = l.verificado "
                    "FROM listing l WHERE s.listing_uid = l.id::text || '_ls'"
                )
                # Índices en la tabla NUEVA antes del swap (sin nombre → Postgres los
                # auto-nombra único: sin colisión ni bloat entre swaps). url para el
                # JOIN de /viewport (g.url=l.url); barrio_id para el path de zona
                # seleccionada (l.barrio_id = ANY($8)).
                # apartaestudio ≡ apartamento con 0 habitaciones (un solo tipo en filtros).
                await conn.execute(_NORMALIZE_STUDIO_SQL.format(table="staging.stg_listings_unificado_new"))
                await conn.execute("CREATE INDEX ON staging.stg_listings_unificado_new (url)")
                await conn.execute("CREATE INDEX ON staging.stg_listings_unificado_new (barrio_id)")
                await _create_listing_filter_indexes(conn, "staging.stg_listings_unificado_new")
                # Un swap previo que murió entre el rename y el DROP deja un _old
                # huérfano → el rename de abajo revienta ("relation ..._old already
                # exists") y el refresh falla CADA vez (startup + horario) → stale.
                # Dropearlo aquí hace el swap idempotente frente a ese residuo.
                await conn.execute("DROP TABLE IF EXISTS staging.stg_listings_unificado_old")
                async with conn.transaction():
                    await conn.execute(
                        "ALTER TABLE staging.stg_listings_unificado RENAME TO stg_listings_unificado_old"
                    )
                    await conn.execute(
                        "ALTER TABLE staging.stg_listings_unificado_new RENAME TO stg_listings_unificado"
                    )
                await conn.execute("DROP TABLE staging.stg_listings_unificado_old")
                logger.info("[cache] stg_listings_unificado refreshed (swap)")

                # barrios_medianas: swap-table en vez de TRUNCATE+INSERT. El TRUNCATE
                # toma ACCESS EXCLUSIVE; con lectores constantes de /barrios no conseguía
                # el lock → statement_timeout (600s) → el refresh fallaba a mitad y dejaba
                # las medianas congeladas (pasó: 12 días stale desde 2026-10-27). El INSERT
                # en sí tarda <1s; el problema era el lock, no la query. Se llena una tabla
                # nueva y el RENAME final es instantáneo; los lectores golpean la vieja
                # hasta el swap. Mismo patrón que stg_listings_unificado / listings_georef.
                await conn.execute("DROP TABLE IF EXISTS analytics.barrios_medianas_new")
                await conn.execute(
                    "CREATE TABLE analytics.barrios_medianas_new "
                    "(LIKE analytics.barrios_medianas INCLUDING DEFAULTS INCLUDING INDEXES)"
                )
                await conn.execute(
                    _INSERT_BARRIOS_MEDIANAS.replace(
                        "INSERT INTO analytics.barrios_medianas ",
                        "INSERT INTO analytics.barrios_medianas_new ", 1),
                    timeout=heavy_timeout,
                )
                await conn.execute("DROP TABLE IF EXISTS analytics.barrios_medianas_old")
                async with conn.transaction():
                    await conn.execute("ALTER TABLE analytics.barrios_medianas RENAME TO barrios_medianas_old")
                    await conn.execute("ALTER TABLE analytics.barrios_medianas_new RENAME TO barrios_medianas")
                await conn.execute("DROP TABLE analytics.barrios_medianas_old")
                logger.info("[cache] barrios_medianas refreshed (swap)")

                # listings_georef queries stg_listings_unificado — only run when stg exists.
                # Swap-table instead of TRUNCATE+INSERT: el INSERT hace 2 LATERAL joins
                # espaciales por listing (~100k filas) y tarda varios minutos — un
                # TRUNCATE en la misma transacción toma lock exclusivo y deja /listings
                # sin responder todo ese tiempo (pasó en vivo 2026-08-27/28, 2 veces).
                # Se llena una tabla nueva sin tocar la que están leyendo, y el RENAME
                # final es ~instantáneo.
                await conn.execute("DROP TABLE IF EXISTS analytics.listings_georef_new")
                await conn.execute(
                    "CREATE TABLE analytics.listings_georef_new "
                    "(LIKE analytics.listings_georef INCLUDING ALL)"
                )
                await conn.execute(_INSERT_LISTINGS_GEOREF, timeout=heavy_timeout)
                await conn.execute("DROP TABLE IF EXISTS analytics.listings_georef_old")
                async with conn.transaction():
                    await conn.execute(
                        "ALTER TABLE analytics.listings_georef RENAME TO listings_georef_old"
                    )
                    await conn.execute(
                        "ALTER TABLE analytics.listings_georef_new RENAME TO listings_georef"
                    )
                await conn.execute("DROP TABLE analytics.listings_georef_old")
                logger.info("[cache] listings_georef refreshed (swap)")
            else:
                logger.warning("[cache] stg_listings_unificado missing — skipping stg-dependent refreshes")

            # barrios_contexto: upsert from analytics tables — no stg dependency
            await conn.execute(_INSERT_BARRIOS_CONTEXTO, timeout=heavy_timeout)
            logger.info("[cache] barrios_contexto refreshed")

    except Exception as exc:
        logger.error("[cache] refresh failed: %s", exc, exc_info=True)
        try:
            from api.utils.email import ADMIN_EMAIL, send_email
            await send_email(
                ADMIN_EMAIL,
                "⚠️ Medellín Social — refresh_listings_cache falló",
                f"<p>El refresh del cache de listings falló y el mapa puede estar desactualizado.</p><pre>{__import__('html').escape(str(exc))}</pre>",
            )
        except Exception:
            logger.error("[cache] no se pudo enviar alerta de fallo de cache", exc_info=True)


# ── Insert incremental on-publish ────────────────────────────────────────────
# Un listing propio recién publicado aparecía en el mapa solo tras el refresh
# horario (hasta ~1h de espera). Estas dos inserciones de UNA fila meten el
# listing a las tablas vivas al instante; el refresh horario lo re-deriva igual
# desde `listing` (estado='publicado') → sin doble conteo, es solo el puente.
# INSERT de 1 fila toma ROW EXCLUSIVE (no ACCESS EXCLUSIVE) → no bloquea lectores.
#
# keep in sync con la rama '_ls' de _REFRESH_STG_LISTINGS_TMPL (misma lista de 31
# columnas, mismos mapeos). Sin dedup/cluster/stacking: una fila nueva no agrupa
# con nada (n_duplicados=1, precio_variable=false, geo_aproximada=false).
_INSERT_ONE_LISTING_STG = """
INSERT INTO staging.stg_listings_unificado
    (listing_uid, fuente, tier, tipo_operacion, tipo_inmueble,
     precio_cop, precio_usd, precio_min_cluster, precio_max_cluster, precio_variable,
     area_m2, precio_m2, habitaciones, banos, barrio_raw, barrio_id,
     direccion_raw, lat, lon, geom, url, fotos, fecha_scraping, n_duplicados, estrato_real,
     amoblado, antiguedad, amenidades, administracion, nombre_edificio, geo_aproximada)
SELECT
    l.id::text || '_ls',
    'propio',
    CASE WHEN l.destacado THEN 'agente_premium' ELSE 'standard' END,
    lower(trim(l.operacion::text)), lower(trim(l.tipo_inmueble::text)),
    l.precio::bigint, NULL::bigint,
    l.precio::bigint, l.precio::bigint, false,
    COALESCE(l.area_m2, 0)::numeric,
    CASE WHEN COALESCE(l.area_m2, 0) > 0 THEN l.precio / l.area_m2 END,
    l.habitaciones, l.banos::numeric, l.barrio,
    (SELECT b.id FROM raw.barrios b
       WHERE l.geom IS NOT NULL AND ST_Contains(b.geometry, l.geom) LIMIT 1),
    l.direccion_aprox,
    ST_Y(l.geom)::double precision, ST_X(l.geom)::double precision, l.geom,
    l.id::text,
    (SELECT array_agg(m.url ORDER BY m.orden) FROM listing_media m WHERE m.listing_id = l.id),
    COALESCE(l.published_at, l.created_at), 1, l.estrato,
    l.amoblado, l.antiguedad_anios::text, l.amenidades, l.administracion,
    l.nombre_edificio, false
FROM listing l
WHERE l.id = $1::uuid AND l.estado = 'publicado' AND l.precio > 0
"""

# georef: reutiliza _INSERT_LISTINGS_GEOREF (una sola fuente de verdad) retargeteado
# a la tabla viva y filtrado a este url. Lee de staging → la fila de staging ya
# debe existir (se inserta antes, misma txn).
_INSERT_ONE_LISTING_GEOREF = (
    _INSERT_LISTINGS_GEOREF
    .replace("analytics.listings_georef_new", "analytics.listings_georef", 1)
    .replace("ORDER BY l.url", "AND l.url = $1\nORDER BY l.url", 1)
)


async def insert_listing_into_cache(pool: Any, listing_id: str) -> None:
    """Mete un listing recién-publicado a las tablas vivas del mapa al instante
    (sin esperar el refresh horario). Idempotente: borra la fila previa primero.
    Best-effort — el caller la envuelve en try/except; el refresh horario es el
    respaldo si esto falla. ponytail: si cae justo durante un refresh (swap), la
    fila entra a la tabla _old por descartar → el listing sale ≤1h tarde, nunca
    rompe nada."""
    url = str(listing_id)
    uid = url + "_ls"
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM staging.stg_listings_unificado WHERE listing_uid = $1", uid)
            await conn.execute(
                "DELETE FROM analytics.listings_georef WHERE url = $1", url)
            await conn.execute(_INSERT_ONE_LISTING_STG, url)
            await conn.execute(_INSERT_ONE_LISTING_GEOREF, url)
    logger.info("[cache] listing %s insertado al mapa (on-publish)", url)


async def _cleanup_token_blacklist(pool: Any) -> None:
    # token_blacklist crece con cada logout/refresh; a los 30 días (JWT_EXPIRY_DAYS)
    # el token ya expiró por sí solo → la fila es inútil. Purga en la tarea horaria.
    try:
        async with pool.acquire() as conn:
            res = await conn.execute(
                "DELETE FROM token_blacklist WHERE created_at < NOW() - INTERVAL '30 days'"
            )
        logger.info("[cache] token_blacklist cleanup: %s", res)
    except Exception:
        logger.error("[cache] token_blacklist cleanup failed", exc_info=True)
    try:
        # throttle windows are <= 1h; keep a day for forensics
        await pool.execute("DELETE FROM public.throttle_hits WHERE hit_at < NOW() - INTERVAL '1 day'")
    except Exception:
        logger.error("[cache] throttle_hits cleanup failed", exc_info=True)


async def run_periodic_cache_refresh(pool: Any) -> None:
    """Background task: refresh listings cache every hour."""
    while True:
        await asyncio.sleep(_CACHE_REFRESH_INTERVAL)
        logger.info("[cache] periodic refresh starting")
        await refresh_listings_cache(pool)
        await _cleanup_token_blacklist(pool)
