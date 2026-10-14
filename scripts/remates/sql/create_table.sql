-- Paso 2: tabla PostgreSQL para remates judiciales
-- DB: postgresql://USER:PASSWORD@localhost:5433/urbidata

CREATE SCHEMA IF NOT EXISTS raw;

CREATE TABLE IF NOT EXISTS raw.remates_judiciales (
    id                  SERIAL PRIMARY KEY,
    fuente              VARCHAR         DEFAULT 'rematesjudiciales.click',
    titulo              VARCHAR,
    municipio           VARCHAR,
    zona_raw            VARCHAR,
    tipo_inmueble       VARCHAR,
    precio_base_cop     BIGINT,
    avaluo_cop          BIGINT,
    descuento_pct       DECIMAL,
    fecha_remate        DATE,
    estado              VARCHAR         DEFAULT 'activo',
    url                 VARCHAR         UNIQUE,
    fecha_scraping      TIMESTAMP       DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remates_municipio ON raw.remates_judiciales(municipio);
CREATE INDEX IF NOT EXISTS idx_remates_estado    ON raw.remates_judiciales(estado);
CREATE INDEX IF NOT EXISTS idx_remates_fecha     ON raw.remates_judiciales(fecha_remate);
