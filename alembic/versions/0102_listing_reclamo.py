"""feat: tabla listing_reclamo — "reclama tu inmueble" (claim your home)

Revision ID: 0102
Revises: 0101
Create Date: 2026-10-12

Un dueño/agente reclama un listing YA scrapeado (fincaraiz/MC/premium) que hoy
no tiene dueño en el sistema. El reclamo nace 'pendiente'; el admin lo verifica
(fase 1 manual). Al verificarse → se convierte en lead para el realtor de zona
(intake/asignador — fase 2). Keyed por listing_url (mismo id que usa el resto
del pipeline de scrapeados). usuario_id = usuarios.id (SERIAL/INTEGER).
"""
from alembic import op

revision = "0102"
down_revision = "0101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.listing_reclamo (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            usuario_id           INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            listing_url          TEXT NOT NULL,
            fuente               TEXT,
            estado               TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | verificado | rechazado
            nombre_contacto      TEXT,
            telefono             TEXT,
            email_contacto       TEXT,
            matricula_declarada  TEXT,
            mensaje              TEXT,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at          TIMESTAMPTZ
        )
        """
    )
    # Un mismo usuario no reclama dos veces el mismo listing (re-submit idempotente).
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_reclamo_url_usuario "
        "ON public.listing_reclamo (listing_url, usuario_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_listing_reclamo_estado "
        "ON public.listing_reclamo (estado)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_listing_reclamo_url "
        "ON public.listing_reclamo (listing_url)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.listing_reclamo")
