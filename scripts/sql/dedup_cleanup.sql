-- Deduplicación de listings existentes con dedup_hash
-- DB: postgresql://USER:PASSWORD@localhost:5433/urbidata
--
-- Ejecutar DESPUÉS de migrate_dedup_hash.sql
-- Pasos: calcular hashes → reportar duplicados → eliminar → agregar constraint

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1 — Calcular dedup_hash para filas existentes
-- ─────────────────────────────────────────────────────────────────────────────

-- Precio redondeado según tipo de operación:
--   venta   → ±5% tolerance a precios 100M-500M  → redondear a 10M
--   arriendo → ±12% tolerance a precios 1M-5M    → redondear a 500K

UPDATE raw.listings_fincaraiz
SET dedup_hash = MD5(
    LOWER(TRIM(COALESCE(barrio_raw, ''))) || '|' ||
    COALESCE(tipo_inmueble, '') || '|' ||
    COALESCE(tipo_operacion, '') || '|' ||
    COALESCE(habitaciones, 0)::text || '|' ||
    COALESCE(banos, 0)::text || '|' ||
    ROUND(COALESCE(area_m2, 0))::text || '|' ||
    CASE COALESCE(tipo_operacion, '')
        WHEN 'arriendo'
            THEN (ROUND(COALESCE(precio, 0) / 500000)  * 500000)::text
        ELSE
            (ROUND(COALESCE(precio, 0) / 10000000) * 10000000)::text
    END
);

UPDATE raw.listings_metrocuadrado
SET dedup_hash = MD5(
    LOWER(TRIM(COALESCE(barrio_raw, ''))) || '|' ||
    COALESCE(tipo_inmueble, '') || '|' ||
    COALESCE(tipo_operacion, '') || '|' ||
    COALESCE(habitaciones, 0)::text || '|' ||
    COALESCE(banos, 0)::text || '|' ||
    ROUND(COALESCE(area_m2, 0))::text || '|' ||
    CASE COALESCE(tipo_operacion, '')
        WHEN 'arriendo'
            THEN (ROUND(COALESCE(precio, 0) / 500000)  * 500000)::text
        ELSE
            (ROUND(COALESCE(precio, 0) / 10000000) * 10000000)::text
    END
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2 — Reporte de duplicados (ejecutar antes de borrar)
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
    'fincaraiz' AS fuente,
    COUNT(*) AS total_listings,
    COUNT(DISTINCT dedup_hash) AS unicos,
    COUNT(*) - COUNT(DISTINCT dedup_hash) AS duplicados,
    ROUND(
        (COUNT(*) - COUNT(DISTINCT dedup_hash))::numeric / COUNT(*) * 100, 1
    ) AS pct_duplicados
FROM raw.listings_fincaraiz
UNION ALL
SELECT
    'metrocuadrado',
    COUNT(*),
    COUNT(DISTINCT dedup_hash),
    COUNT(*) - COUNT(DISTINCT dedup_hash),
    ROUND(
        (COUNT(*) - COUNT(DISTINCT dedup_hash))::numeric / COUNT(*) * 100, 1
    )
FROM raw.listings_metrocuadrado;

-- Top 20 hashes más duplicados en fincaraiz
SELECT
    dedup_hash,
    COUNT(*)         AS n,
    array_agg(url)   AS urls,
    array_agg(precio::bigint) AS precios,
    MAX(barrio_raw)  AS barrio,
    MAX(tipo_operacion) AS tipo_op
FROM raw.listings_fincaraiz
GROUP BY dedup_hash
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 20;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3 — Eliminar duplicados (mantener el de mayor id = más reciente)
-- ─────────────────────────────────────────────────────────────────────────────

-- Verificar caso Alejandría / Loma Los González antes de borrar:
SELECT id, barrio_raw, precio, url, fecha_scraping
FROM raw.listings_fincaraiz
WHERE dedup_hash IN (
    SELECT dedup_hash FROM raw.listings_fincaraiz
    WHERE LOWER(barrio_raw) LIKE '%alejandri%'
       OR LOWER(barrio_raw) LIKE '%loma%gonz%'
)
ORDER BY dedup_hash, id;

-- Borrar duplicados (mantener id más alto por hash)
DELETE FROM raw.listings_fincaraiz a
USING raw.listings_fincaraiz b
WHERE a.dedup_hash = b.dedup_hash
  AND a.id < b.id;

DELETE FROM raw.listings_metrocuadrado a
USING raw.listings_metrocuadrado b
WHERE a.dedup_hash = b.dedup_hash
  AND a.id < b.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4 — Agregar UNIQUE constraint y reemplazar UNIQUE(url)
-- ─────────────────────────────────────────────────────────────────────────────

-- Fincaraiz: reemplazar UNIQUE(url) con índice normal + UNIQUE(dedup_hash)
ALTER TABLE raw.listings_fincaraiz
    DROP CONSTRAINT IF EXISTS listings_fincaraiz_url_key;

CREATE INDEX IF NOT EXISTS idx_fc_url ON raw.listings_fincaraiz(url);

ALTER TABLE raw.listings_fincaraiz
    ADD CONSTRAINT listings_fc_dedup_unique UNIQUE (dedup_hash);

-- Metrocuadrado: idem
ALTER TABLE raw.listings_metrocuadrado
    DROP CONSTRAINT IF EXISTS listings_metrocuadrado_url_key;

CREATE INDEX IF NOT EXISTS idx_mq_url ON raw.listings_metrocuadrado(url);

ALTER TABLE raw.listings_metrocuadrado
    ADD CONSTRAINT listings_mq_dedup_unique UNIQUE (dedup_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 5 — Verificación final
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
    'fincaraiz' AS fuente,
    COUNT(*) AS total_listings,
    COUNT(DISTINCT dedup_hash) AS unicos
FROM raw.listings_fincaraiz
UNION ALL
SELECT
    'metrocuadrado',
    COUNT(*),
    COUNT(DISTINCT dedup_hash)
FROM raw.listings_metrocuadrado;
