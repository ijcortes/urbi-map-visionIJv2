-- Migración: dedup_hash en raw.listings_fincaraiz y raw.listings_metrocuadrado
-- DB: postgresql://USER:PASSWORD@localhost:5433/urbidata
--
-- Ejecutar ANTES de dedup_cleanup.sql
-- Seguro de re-ejecutar (IF NOT EXISTS / IF EXISTS).

-- 1. Agregar columna dedup_hash
ALTER TABLE raw.listings_fincaraiz
    ADD COLUMN IF NOT EXISTS dedup_hash VARCHAR;

ALTER TABLE raw.listings_metrocuadrado
    ADD COLUMN IF NOT EXISTS dedup_hash VARCHAR;

-- 2. Índice parcial (rápido) — único constraint se agrega después del cleanup
CREATE INDEX IF NOT EXISTS idx_fc_dedup_hash
    ON raw.listings_fincaraiz(dedup_hash)
    WHERE dedup_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mq_dedup_hash
    ON raw.listings_metrocuadrado(dedup_hash)
    WHERE dedup_hash IS NOT NULL;
