"""scraping / data-quality hardening (ALL-ISSUES DAT-*, LNK-12)

* raw.listings_premium / raw.listings_renta_media .activo   so retired rows can leave serving
                                                           (only an API predicate existed, LNK-12)
* raw.listings_{metrocuadrado,fincaraiz,habi}.last_seen_at  last scrape that saw the listing;
                                                           stale rule ages out unseen rows (DAT-02)
* .destacado / .anunciante_tipo                             paid highlight + advertiser kind (DAT-10)
* .moneda / .precio_incluye_admin                           listing currency + admin-in-price (DAT-11)
* .area_tipo                                                which area the portal gave (DAT-12)
* raw.listings_fincaraiz.duplicado_de                       soft dedup: never DELETE (DAT-06)
* raw.scrape_runs                                           per-config coverage of each pass (DAT-02/R6)
* raw.api_cost_ledger                                       paid API calls per provider/month (DAT-24)
* raw.data_quality_runs                                     nightly freshness/volume snapshot (DAT-22)

All guarded: raw tables are created by the scrapers and may not exist yet.

Revision ID: 0112
Revises: 0111
"""
from alembic import op

revision = "0112"
down_revision = "0111"
branch_labels = None
depends_on = None

_LISTING_TABLES = ("listings_metrocuadrado", "listings_fincaraiz", "listings_habi")


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS raw")
    op.execute("""
    DO $$ BEGIN
        IF to_regclass('raw.listings_premium') IS NOT NULL THEN
            ALTER TABLE raw.listings_premium ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
        END IF;
        IF to_regclass('raw.listings_renta_media') IS NOT NULL THEN
            ALTER TABLE raw.listings_renta_media ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
        END IF;
    END $$;
    """)
    for t in _LISTING_TABLES:
        op.execute(f"""
        DO $$ BEGIN
            IF to_regclass('raw.{t}') IS NOT NULL THEN
                ALTER TABLE raw.{t}
                    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS destacado BOOLEAN,
                    ADD COLUMN IF NOT EXISTS anunciante_tipo TEXT,
                    ADD COLUMN IF NOT EXISTS moneda TEXT,
                    ADD COLUMN IF NOT EXISTS precio_incluye_admin BOOLEAN,
                    ADD COLUMN IF NOT EXISTS area_tipo TEXT;
                UPDATE raw.{t} SET last_seen_at = fecha_scraping WHERE last_seen_at IS NULL;
            END IF;
        END $$;
        """)
    op.execute("""
    DO $$ BEGIN
        IF to_regclass('raw.listings_fincaraiz') IS NOT NULL THEN
            ALTER TABLE raw.listings_fincaraiz ADD COLUMN IF NOT EXISTS duplicado_de INTEGER;
        END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS raw.scrape_runs (
        id            BIGSERIAL PRIMARY KEY,
        fuente        TEXT NOT NULL,
        config_key    TEXT NOT NULL,
        modo          TEXT NOT NULL CHECK (modo IN ('full', 'incremental')),
        total_hits    INTEGER,
        seen          INTEGER NOT NULL DEFAULT 0,
        pages_failed  INTEGER NOT NULL DEFAULT 0,
        complete      BOOLEAN NOT NULL DEFAULT FALSE,
        run_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ix_scrape_runs_cfg ON raw.scrape_runs (fuente, config_key, run_at DESC);

    CREATE TABLE IF NOT EXISTS raw.api_cost_ledger (
        id              BIGSERIAL PRIMARY KEY,
        proveedor       TEXT NOT NULL,
        endpoint        TEXT,
        llamadas        INTEGER NOT NULL DEFAULT 1,
        costo_usd_est   NUMERIC(10, 4),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ix_api_cost_ledger_prov ON raw.api_cost_ledger (proveedor, created_at);

    CREATE TABLE IF NOT EXISTS raw.data_quality_runs (
        id          BIGSERIAL PRIMARY KEY,
        fuente      TEXT NOT NULL,
        activos     INTEGER,
        ultimo_scrape TIMESTAMPTZ,
        sin_fotos_pct NUMERIC(5, 1),
        implausibles  INTEGER,
        problemas   TEXT[],
        run_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """)


def downgrade() -> None:
    op.execute("""
    DROP TABLE IF EXISTS raw.data_quality_runs;
    DROP TABLE IF EXISTS raw.api_cost_ledger;
    DROP TABLE IF EXISTS raw.scrape_runs;
    DO $$ BEGIN
        IF to_regclass('raw.listings_fincaraiz') IS NOT NULL THEN
            ALTER TABLE raw.listings_fincaraiz DROP COLUMN IF EXISTS duplicado_de;
        END IF;
    END $$;
    """)
    for t in _LISTING_TABLES:
        op.execute(f"""
        DO $$ BEGIN
            IF to_regclass('raw.{t}') IS NOT NULL THEN
                ALTER TABLE raw.{t}
                    DROP COLUMN IF EXISTS last_seen_at,
                    DROP COLUMN IF EXISTS destacado,
                    DROP COLUMN IF EXISTS anunciante_tipo,
                    DROP COLUMN IF EXISTS moneda,
                    DROP COLUMN IF EXISTS precio_incluye_admin,
                    DROP COLUMN IF EXISTS area_tipo;
            END IF;
        END $$;
        """)
    # premium/renta_media .activo kept: dropping it would re-serve retired rows.
