"""backfill: apartaestudio -> apartamento with habitaciones = 0

The scraper stored `apartaestudio` as its own tipo_inmueble, so "Studio apartment"
showed next to "Apartment" in filters. A studio is an apartment with 0 rooms:
the scraper (and the staging rebuild in api/cache.py) now normalise it; this
migration fixes the rows already stored.

Safe + reversible: every touched row (table, id, old habitaciones) is written to
raw._bk_apartaestudio_0105 first; downgrade restores tipo_inmueble='apartaestudio'
and the old habitaciones from that table ONLY for rows still matching what the
migration wrote; changed rows are kept (and reported) in that table. Only BASE TABLEs that have the columns are
touched (raw.listings_fincaraiz is a VIEW on some environments). The staging table
is rebuilt hourly from the raw tables; it is updated here too so the fix is
immediate (no data restore for staging: the next rebuild regenerates it).

Revision ID: 0105
Revises: 0104
"""
from alembic import op

revision = "0105"
down_revision = "0104"
branch_labels = None
depends_on = None

_TABLES = ("listings_metrocuadrado", "listings_fincaraiz", "listings_habi",
           "listings_casadolcecasa", "listings_premium")


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS raw._bk_apartaestudio_0105 (
            tbl text NOT NULL, id bigint NOT NULL, habitaciones integer,
            PRIMARY KEY (tbl, id)
        )
    """)
    for t in _TABLES:
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.tables
                         WHERE table_schema='raw' AND table_name='{t}' AND table_type='BASE TABLE')
                 AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema='raw' AND table_name='{t}' AND column_name='habitaciones')
                 AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema='raw' AND table_name='{t}' AND column_name='id') THEN
                EXECUTE 'INSERT INTO raw._bk_apartaestudio_0105 (tbl, id, habitaciones)
                         SELECT ''{t}'', id, habitaciones FROM raw.{t}
                         WHERE lower(tipo_inmueble) = ''apartaestudio''
                         ON CONFLICT DO NOTHING';
                EXECUTE 'UPDATE raw.{t} SET tipo_inmueble = ''apartamento'', habitaciones = 0
                         WHERE lower(tipo_inmueble) = ''apartaestudio''';
              END IF;
            END $$;
        """)
    op.execute("""
        DO $$
        BEGIN
          IF to_regclass('staging.stg_listings_unificado') IS NOT NULL THEN
            UPDATE staging.stg_listings_unificado
               SET tipo_inmueble = 'apartamento', habitaciones = 0
             WHERE lower(tipo_inmueble) = 'apartaestudio';
          END IF;
        END $$;
    """)


def downgrade() -> None:
    # Restore ONLY rows still holding exactly what upgrade() wrote (tipo_inmueble =
    # 'apartamento' AND habitaciones = 0). A row a scraper/admin corrected after the
    # upgrade is NOT overwritten: its backup row stays in raw._bk_apartaestudio_0105
    # (the table is then kept, and a WARNING reports how many conflicts remain).
    for t in _TABLES:
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.tables
                         WHERE table_schema='raw' AND table_name='{t}' AND table_type='BASE TABLE')
                 AND to_regclass('raw._bk_apartaestudio_0105') IS NOT NULL THEN
                EXECUTE 'WITH u AS (
                           UPDATE raw.{t} r SET tipo_inmueble = ''apartaestudio'', habitaciones = b.habitaciones
                           FROM raw._bk_apartaestudio_0105 b
                           WHERE b.tbl = ''{t}'' AND b.id = r.id
                             AND lower(r.tipo_inmueble) = ''apartamento'' AND r.habitaciones = 0
                           RETURNING r.id)
                         DELETE FROM raw._bk_apartaestudio_0105
                         WHERE tbl = ''{t}'' AND id IN (SELECT id FROM u)';
              END IF;
            END $$;
        """)
    op.execute("""
        DO $$
        DECLARE n integer;
        BEGIN
          IF to_regclass('raw._bk_apartaestudio_0105') IS NOT NULL THEN
            SELECT count(*) INTO n FROM raw._bk_apartaestudio_0105;
            IF n = 0 THEN
              DROP TABLE raw._bk_apartaestudio_0105;
            ELSE
              RAISE WARNING '0105 downgrade: % row(s) changed since upgrade were NOT restored; kept in raw._bk_apartaestudio_0105', n;
            END IF;
          END IF;
        END $$;
    """)
