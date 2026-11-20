-- Re-resuelve barrio_id desde lat/lon para las tablas fuente del mapa.
-- Lógica = scraping/utils/quality.py RESOLVE_BARRIO_SQL: contiene primero,
-- si no el más cercano <=80m, si no NULL (no inventa a lo lejos).
-- Corrige barrio_id viejos grabados con polígonos/radios anteriores → pins que
-- caían bajo el filtro de una comuna estando físicamente en otro municipio.
--
-- Rendimiento: rama "nearest" = KNN <-> LIMIT 1 (usa idx_barrios_geometry) y UN
-- solo cálculo de distancia geography sobre ese candidato (no ST_DWithin::geography
-- por cada barrio). Idempotente: solo escribe donde el id cambia.
-- Autocommit por tabla (ver progreso); statement_timeout guard por si algo se va.
\set snap 80
\timing on
SET statement_timeout = '15min';

\echo === fincaraiz ===
UPDATE raw.listings_fincaraiz t SET barrio_id = n.newid
FROM (
  SELECT t2.id, COALESCE(
      (SELECT b.id FROM raw.barrios b WHERE b.geometry && pt.g AND ST_Contains(b.geometry,pt.g) LIMIT 1),
      (SELECT z.id FROM (SELECT b.id, ST_Distance(b.geometry::geography, pt.g::geography) AS d
                           FROM raw.barrios b WHERE b.geometry IS NOT NULL
                           ORDER BY b.geometry <-> pt.g LIMIT 1) z WHERE z.d <= :snap)
  ) AS newid
  FROM raw.listings_fincaraiz t2
  CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Point(t2.lon,t2.lat),4326) AS g) pt
  WHERE t2.lat IS NOT NULL AND t2.lat<>0 AND t2.lon IS NOT NULL AND t2.lon<>0
) n
WHERE t.id = n.id AND t.barrio_id IS DISTINCT FROM n.newid;

\echo === habi ===
UPDATE raw.listings_habi t SET barrio_id = n.newid
FROM (
  SELECT t2.id, COALESCE(
      (SELECT b.id FROM raw.barrios b WHERE b.geometry && pt.g AND ST_Contains(b.geometry,pt.g) LIMIT 1),
      (SELECT z.id FROM (SELECT b.id, ST_Distance(b.geometry::geography, pt.g::geography) AS d
                           FROM raw.barrios b WHERE b.geometry IS NOT NULL
                           ORDER BY b.geometry <-> pt.g LIMIT 1) z WHERE z.d <= :snap)
  ) AS newid
  FROM raw.listings_habi t2
  CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Point(t2.lon,t2.lat),4326) AS g) pt
  WHERE t2.lat IS NOT NULL AND t2.lat<>0 AND t2.lon IS NOT NULL AND t2.lon<>0
) n
WHERE t.id = n.id AND t.barrio_id IS DISTINCT FROM n.newid;

\echo === metrocuadrado ===
UPDATE raw.listings_metrocuadrado t SET barrio_id = n.newid
FROM (
  SELECT t2.id, COALESCE(
      (SELECT b.id FROM raw.barrios b WHERE b.geometry && pt.g AND ST_Contains(b.geometry,pt.g) LIMIT 1),
      (SELECT z.id FROM (SELECT b.id, ST_Distance(b.geometry::geography, pt.g::geography) AS d
                           FROM raw.barrios b WHERE b.geometry IS NOT NULL
                           ORDER BY b.geometry <-> pt.g LIMIT 1) z WHERE z.d <= :snap)
  ) AS newid
  FROM raw.listings_metrocuadrado t2
  CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Point(t2.lon,t2.lat),4326) AS g) pt
  WHERE t2.lat IS NOT NULL AND t2.lat<>0 AND t2.lon IS NOT NULL AND t2.lon<>0
) n
WHERE t.id = n.id AND t.barrio_id IS DISTINCT FROM n.newid;

\echo === premium ===
UPDATE raw.listings_premium t SET barrio_id = n.newid
FROM (
  SELECT t2.id, COALESCE(
      (SELECT b.id FROM raw.barrios b WHERE b.geometry && pt.g AND ST_Contains(b.geometry,pt.g) LIMIT 1),
      (SELECT z.id FROM (SELECT b.id, ST_Distance(b.geometry::geography, pt.g::geography) AS d
                           FROM raw.barrios b WHERE b.geometry IS NOT NULL
                           ORDER BY b.geometry <-> pt.g LIMIT 1) z WHERE z.d <= :snap)
  ) AS newid
  FROM raw.listings_premium t2
  CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Point(t2.lon,t2.lat),4326) AS g) pt
  WHERE t2.lat IS NOT NULL AND t2.lat<>0 AND t2.lon IS NOT NULL AND t2.lon<>0
) n
WHERE t.id = n.id AND t.barrio_id IS DISTINCT FROM n.newid;

\echo === renta_media ===
UPDATE raw.listings_renta_media t SET barrio_id = n.newid
FROM (
  SELECT t2.id, COALESCE(
      (SELECT b.id FROM raw.barrios b WHERE b.geometry && pt.g AND ST_Contains(b.geometry,pt.g) LIMIT 1),
      (SELECT z.id FROM (SELECT b.id, ST_Distance(b.geometry::geography, pt.g::geography) AS d
                           FROM raw.barrios b WHERE b.geometry IS NOT NULL
                           ORDER BY b.geometry <-> pt.g LIMIT 1) z WHERE z.d <= :snap)
  ) AS newid
  FROM raw.listings_renta_media t2
  CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Point(t2.lon,t2.lat),4326) AS g) pt
  WHERE t2.lat IS NOT NULL AND t2.lat<>0 AND t2.lon IS NOT NULL AND t2.lon<>0
) n
WHERE t.id = n.id AND t.barrio_id IS DISTINCT FROM n.newid;
