"""indexes for the hot listings filters (tipo_operacion, tipo, precio, lat/lon, address)

The /listings and /listings/viewport queries filter staging.stg_listings_unificado on
tipo_operacion, tipo_inmueble, precio_cop and a lat/lon bbox, and the `busqueda`
parameter does `direccion_raw ILIKE '%x%'`. Until now only (barrio_id), (url) and
(precio_cop) were indexed. NOTE: the staging table has no activo/estado column
(inactive rows are filtered when it is rebuilt from the raw tables).

IMPORTANT: staging is rebuilt by a swap-table every hour (api/cache.py), which
discards indexes of the old table. api/cache.py therefore recreates the same
indexes on every rebuild; this migration only makes them exist right away.

pg_trgm needs the extension privilege; if it can't be created the trigram index is
skipped (the btree ones are still created). Reversible.

Revision ID: 0106
Revises: 0105
"""
from alembic import op

revision = "0106"
down_revision = "0105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
          IF to_regclass('staging.stg_listings_unificado') IS NOT NULL THEN
            CREATE INDEX IF NOT EXISTS idx_stg_op_tipo_precio
                ON staging.stg_listings_unificado (tipo_operacion, lower(tipo_inmueble), precio_cop);
            CREATE INDEX IF NOT EXISTS idx_stg_lat_lon
                ON staging.stg_listings_unificado (lat, lon);
            BEGIN
              CREATE EXTENSION IF NOT EXISTS pg_trgm;
              CREATE INDEX IF NOT EXISTS idx_stg_direccion_trgm
                  ON staging.stg_listings_unificado USING gin (direccion_raw gin_trgm_ops);
            EXCEPTION WHEN OTHERS THEN
              RAISE NOTICE 'pg_trgm unavailable, skipping trigram index';
            END;
          END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS staging.idx_stg_direccion_trgm")
    op.execute("DROP INDEX IF EXISTS staging.idx_stg_lat_lon")
    op.execute("DROP INDEX IF EXISTS staging.idx_stg_op_tipo_precio")
