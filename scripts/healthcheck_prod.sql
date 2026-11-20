-- Chequeo de salud de scrapers + validación en prod.
-- Correr:  psql "postgresql://urbidata:urbidata007@yamabiko.proxy.rlwy.net:10109/urbidata" -f scripts/healthcheck_prod.sql
-- No escribe nada. Seguro de correr cuando sea. ssh al contenedor está muerto (project-wide),
-- así que esto es la vía para saber si el cron y los scrapers funcionan: cada job escribe a una
-- tabla; si su timestamp no avanza según su horario, ese job se rompió.

\echo ====================================================================
\echo  1. FRESCURA DE CADA JOB  (STALE = se rompió / no corrió a tiempo)
\echo ====================================================================
SELECT job, ultimo, round(extract(epoch FROM now()-ultimo)/3600,1) AS horas_atras, verdicto
FROM (
  SELECT 'scrape fincaraiz (diario 03:00)' job, max(fecha_scraping) ultimo,
         CASE WHEN max(fecha_scraping) > now()-interval '30 hours' THEN 'OK' ELSE 'STALE' END verdicto
  FROM raw.listings_fincaraiz
  UNION ALL
  SELECT 'scrape metrocuadrado (c/3d 08:00)', max(fecha_scraping),
         CASE WHEN max(fecha_scraping) > now()-interval '4 days' THEN 'OK' ELSE 'STALE' END
  FROM raw.listings_metrocuadrado
  UNION ALL
  SELECT 'scrape renta corta (c/3d 09:00)', max(fecha_scraping),
         CASE WHEN max(fecha_scraping) > now()-interval '4 days' THEN 'OK' ELSE 'STALE' END
  FROM raw.listings_renta_media
  UNION ALL
  SELECT 'validate URLs (diario 04:00)', max(url_validada_at),
         CASE WHEN max(url_validada_at) > now()-interval '30 hours' THEN 'OK' ELSE 'STALE' END
  FROM (SELECT url_validada_at FROM raw.listings_fincaraiz
        UNION ALL SELECT url_validada_at FROM raw.listings_metrocuadrado) z
  UNION ALL
  SELECT 'comunidad noticias (c/6h)', max(created_at),
         CASE WHEN max(created_at) > now()-interval '8 hours' THEN 'OK' ELSE 'STALE' END
  FROM noticias
  UNION ALL
  SELECT 'comunidad eventos (c/6h)', max(created_at),
         CASE WHEN max(created_at) > now()-interval '8 hours' THEN 'OK' ELSE 'STALE' END
  FROM eventos
) t ORDER BY verdicto DESC, job;

\echo
\echo ====================================================================
\echo  2. LIMPIEZA DE MUERTOS  (backlog debe BAJAR cada día; muertos SUBIR)
\echo ====================================================================
SELECT 'fincaraiz' fuente,
       count(*) FILTER (WHERE url_activa IS FALSE) muertos_ocultos,
       count(*) FILTER (WHERE url_validada_at IS NULL AND activo) nunca_revisado,
       count(*) FILTER (WHERE activo AND (url_validada_at IS NULL OR url_validada_at < now()-interval '7 days')) backlog_pendiente
FROM raw.listings_fincaraiz
UNION ALL
SELECT 'metrocuadrado',
       count(*) FILTER (WHERE url_activa IS FALSE),
       count(*) FILTER (WHERE url_validada_at IS NULL AND activo),
       count(*) FILTER (WHERE activo AND (url_validada_at IS NULL OR url_validada_at < now()-interval '7 days'))
FROM raw.listings_metrocuadrado;

\echo
\echo ====================================================================
\echo  3. LO QUE VE EL MAPA  (servidos + cobertura de fotos por fuente)
\echo ====================================================================
SELECT fuente,
       count(*) servidos,
       count(*) FILTER (WHERE fotos IS NULL OR array_length(fotos,1) IS NULL) sin_foto,
       round(100.0*count(*) FILTER (WHERE fotos IS NOT NULL AND array_length(fotos,1)>0)/count(*),1) AS pct_con_foto,
       count(*) FILTER (WHERE barrio_id IS NULL) sin_barrio
FROM staging.stg_listings_unificado
GROUP BY fuente ORDER BY servidos DESC;

\echo
\echo ====================================================================
\echo  4. MONEDA / TRM  (USD depende 100% de esto; sin fila fresca = todo en COP)
\echo ====================================================================
SELECT 'public.trm' fuente, max(vigencia) ultima_vigencia,
       (now()::date - max(vigencia)) AS dias_atras,
       CASE WHEN max(vigencia) > now()::date - interval '10 days' THEN 'OK' ELSE 'STALE (USD en riesgo)' END verdicto
FROM public.trm;

\echo
\echo ====================================================================
\echo  5. HISTORIAL DE PRECIOS  (cobertura: el chart necesita >=2 puntos por url)
\echo ====================================================================
SELECT fuente,
       count(DISTINCT listing_url)                                       urls_con_historial,
       count(*)                                                          puntos_totales,
       count(DISTINCT listing_url) FILTER (WHERE listing_url IN (
           SELECT listing_url FROM raw.listings_precio_historial
           GROUP BY listing_url HAVING count(*) >= 2))                   urls_con_chart
FROM raw.listings_precio_historial
GROUP BY fuente ORDER BY urls_con_historial DESC;
