"""feat: consentimiento de tratamiento de datos (Ley 1581/2012, Decreto 1377/2013)

Guarda la autorización de habeas data por usuario: el flag, cuándo se dio y qué
versión del aviso firmó (prueba de autorización — Decreto 1377 art. 5). El canal
email ya vive en usuarios.newsletter_activo; aquí se agrega el canal WhatsApp.

Revision ID: 0121
Revises: 0120
Create Date: 2026-11-07
"""
from alembic import op

revision = "0121"
down_revision = "0120"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS habeas_data_aceptado BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS habeas_data_fecha TIMESTAMP")
    op.execute("ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS habeas_data_version VARCHAR")
    op.execute("ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS consent_whatsapp BOOLEAN DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE public.usuarios DROP COLUMN IF EXISTS consent_whatsapp")
    op.execute("ALTER TABLE public.usuarios DROP COLUMN IF EXISTS habeas_data_version")
    op.execute("ALTER TABLE public.usuarios DROP COLUMN IF EXISTS habeas_data_fecha")
    op.execute("ALTER TABLE public.usuarios DROP COLUMN IF EXISTS habeas_data_aceptado")
