"""feat: fecha_primera_vez en todas las fuentes -> dias_en_mercado universal

Hasta ahora dias_en_mercado solo salía para metrocuadrado: era el único con
fecha_primera_vez (migr add_url_validation_columns.sql). Fincaraiz también la
tenía pero el serving nunca la usaba. El resto (habi, casadolcecasa, premium/
medellinliving, renta_media) no la tenía → dias_en_mercado NULL.

Fix: dar fecha_primera_vez (first-seen estable) a las 4 tablas que faltan, y
exponerla en analytics.listings_georef (keyed por url, ya joineada en todos los
serving paths de dias) para que el cálculo CURRENT_DATE - fecha_primera_vez
funcione para TODAS las fuentes sin 6 joins por request.

Patrón de backfill a propósito en 3 pasos (ADD nullable -> UPDATE -> SET DEFAULT):
ADD COLUMN ... DEFAULT NOW() poblaría cada fila existente con el now() de la
migración y el UPDATE backfill no matchearía ninguna (col ya no es NULL). Con el
split, las filas existentes toman fecha_scraping (last-seen; su edad real no se
registró nunca, mismo límite que tuvo metrocuadrado) y las nuevas toman NOW() en
el INSERT. El UPSERT de cada scraper no toca la columna (no está en su SET) -> se
preserva el first-seen en re-scrapes.

Revision ID: 0115
Revises: 0114
"""
from alembic import op

revision = "0115"
down_revision = "0114"
branch_labels = None
depends_on = None

# premium/renta_media no son alembic-managed (ensure_table en scraping/*) -> el
# DO-block con check de existencia evita fallar en una DB donde el scraper aún no
# corrió. habi/casadolcecasa sí son managed pero el patrón uniforme es seguro.
_RAW_TABLES = ["listings_habi", "listings_casadolcecasa", "listings_premium", "listings_renta_media"]


def upgrade() -> None:
    for table in _RAW_TABLES:
        op.execute(f"""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'raw' AND table_name = '{table}'
                      AND table_type = 'BASE TABLE'
                ) THEN
                    ALTER TABLE raw.{table} ADD COLUMN IF NOT EXISTS fecha_primera_vez TIMESTAMP;
                    UPDATE raw.{table}
                       SET fecha_primera_vez = fecha_scraping
                     WHERE fecha_primera_vez IS NULL AND fecha_scraping IS NOT NULL;
                    ALTER TABLE raw.{table} ALTER COLUMN fecha_primera_vez SET DEFAULT NOW();
                END IF;
            END $$;
        """)

    # Columna servida: listings_georef se joinea en todos los paths de dias.
    op.execute("ALTER TABLE analytics.listings_georef ADD COLUMN IF NOT EXISTS fecha_primera_vez TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE analytics.listings_georef DROP COLUMN IF EXISTS fecha_primera_vez")
    for table in _RAW_TABLES:
        op.execute(f"ALTER TABLE raw.{table} DROP COLUMN IF EXISTS fecha_primera_vez")
