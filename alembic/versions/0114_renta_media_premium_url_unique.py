"""fix: raw.listings_renta_media / listings_premium sin UNIQUE(url) en prod

Mismo drift local-only que 0103/0104: en local existen
`listings_renta_media_url_key` y el equivalente de premium (UNIQUE sobre url),
pero en prod las tablas quedaron solo con el pkey(id). Los scrapers hacen
`ON CONFLICT (url) DO UPDATE` (scraping/renta_media/config.py:140,
scraping/vrbo/config.py:85) -> en prod revienta con:

    DB error: there is no unique or exclusion constraint matching the ON CONFLICT

-> flatio/nomadbarrio/booking (listings_renta_media) y vrbo (listings_premium)
encuentran listings pero escriben 0. Por eso renta_media llevaba congelado
desde 2026-08-23 y premium desde 2026-05-31.

Verificado en prod antes de crear el índice: url sin NULLs y sin duplicados en
ambas tablas, así que el UNIQUE no falla.

Idempotente (IF NOT EXISTS). No se toca dedup_hash: el ON CONFLICT del scraper
keyea por url; dedup_hash es para el dedup cross-fuente en serving.

Revision ID: 0105
Revises: 0104
"""
from alembic import op

revision = "0114"
down_revision = "0113"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS listings_renta_media_url_key ON raw.listings_renta_media(url)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS listings_premium_url_key ON raw.listings_premium(url)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS raw.listings_renta_media_url_key")
    op.execute("DROP INDEX IF EXISTS raw.listings_premium_url_key")
