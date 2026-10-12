"""feat: listing.matricula_inmobiliaria + cedula_catastral — llaves de identidad
de la propiedad (ORIP / catastro) para rastrear cada inmueble a futuro.

Revision ID: 0099
Revises: 0098
Create Date: 2026-10-12
"""
from alembic import op

revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.listing ADD COLUMN IF NOT EXISTS matricula_inmobiliaria TEXT")
    op.execute("ALTER TABLE public.listing ADD COLUMN IF NOT EXISTS cedula_catastral TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE public.listing DROP COLUMN IF EXISTS matricula_inmobiliaria")
    op.execute("ALTER TABLE public.listing DROP COLUMN IF EXISTS cedula_catastral")
