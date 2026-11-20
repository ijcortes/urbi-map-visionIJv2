"""alertas_precio.ultima_notificacion — dedup del cron de notificación (#4).

El cron (scripts/alertas_notificar.py) solo notifica listings nuevos desde la
última corrida (fecha_scraping > ultima_notificacion), así no re-manda lo mismo.

Revision ID: 0117
Revises: 0116
"""
from alembic import op

revision = "0117"
down_revision = "0116"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.alertas_precio ADD COLUMN IF NOT EXISTS ultima_notificacion timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE public.alertas_precio DROP COLUMN IF EXISTS ultima_notificacion")
