"""agent.tier (member|certified|preferred) + agent.es_realtor_casa (relleno gratis de arranque)

- tier: lo recalcula realtor_preferido_service.sincronizar_tier (preferred = slot de pago activo).
- certificado: lo marca el equipo/quiz (futuro); sube de member a certified.
- es_realtor_casa: agente(s) que cubren con slot 'gratis' los barrios sin preferido
  (cron scripts/seed_preferidos_gratis.py, idempotente).

Revision ID: 0124
Revises: 0123
"""
from alembic import op

revision = "0124"
down_revision = "0123"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE agent ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'member'")
    op.execute("ALTER TABLE agent DROP CONSTRAINT IF EXISTS chk_agent_tier")
    op.execute("ALTER TABLE agent ADD CONSTRAINT chk_agent_tier CHECK (tier IN ('member','certified','preferred'))")
    op.execute("ALTER TABLE agent ADD COLUMN IF NOT EXISTS certificado BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE agent ADD COLUMN IF NOT EXISTS es_realtor_casa BOOLEAN NOT NULL DEFAULT FALSE")
    # Aviso de vencimiento: una sola vez por slot
    op.execute("ALTER TABLE realtor_slot ADD COLUMN IF NOT EXISTS aviso_vencimiento_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE realtor_slot DROP COLUMN IF EXISTS aviso_vencimiento_at")
    op.execute("ALTER TABLE agent DROP COLUMN IF EXISTS es_realtor_casa")
    op.execute("ALTER TABLE agent DROP COLUMN IF EXISTS certificado")
    op.execute("ALTER TABLE agent DROP CONSTRAINT IF EXISTS chk_agent_tier")
    op.execute("ALTER TABLE agent DROP COLUMN IF EXISTS tier")
