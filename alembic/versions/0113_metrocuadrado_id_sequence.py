"""fix: raw.listings_metrocuadrado.id sin sequence/default en prod -> INSERT falla

Drift local-only (mismo patrón que 0103): en local `id` tiene
DEFAULT nextval('raw.listings_metrocuadrado_id_seq'); en prod la columna quedó
`integer` sin default y la sequence NI existe (tabla restaurada sin la sequence).
Mientras el scraper crasheaba antes del UPSERT por el ON CONFLICT roto, este bug
quedaba oculto. Arreglado el ON CONFLICT (0103 + rebuild del cron), el siguiente
INSERT de un listing nuevo revienta con:

    psycopg2.errors.NotNullViolation: null value in column "id" ...

El UPSERT_SQL del scraper no lista `id` a propósito (confía en el default). Este
fix recrea la sequence, la engancha como OWNED BY la columna, pone el default y
la adelanta a max(id) para no chocar con los ids ya cargados.

Idempotente: CREATE SEQUENCE IF NOT EXISTS + SET DEFAULT + setval re-ejecutable.

Revision ID: 0104
Revises: 0103
"""
from alembic import op

revision = "0113"
down_revision = "0112"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE SEQUENCE IF NOT EXISTS raw.listings_metrocuadrado_id_seq
            OWNED BY raw.listings_metrocuadrado.id
    """)
    op.execute("""
        ALTER TABLE raw.listings_metrocuadrado
            ALTER COLUMN id SET DEFAULT nextval('raw.listings_metrocuadrado_id_seq')
    """)
    # Adelantar la sequence por encima del max(id) existente (COALESCE para tabla
    # vacía). is_called=true -> el próximo nextval devuelve max(id)+1.
    op.execute("""
        SELECT setval('raw.listings_metrocuadrado_id_seq',
                      (SELECT COALESCE(max(id), 1) FROM raw.listings_metrocuadrado))
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE raw.listings_metrocuadrado ALTER COLUMN id DROP DEFAULT")
    op.execute("DROP SEQUENCE IF EXISTS raw.listings_metrocuadrado_id_seq")
