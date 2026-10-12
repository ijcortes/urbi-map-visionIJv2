"""feat: calificación del lead en visita_solicitud — presupuesto, plazo,
crédito, intención. Modelo Zillow paso 2: el lead no llega en bruto. Todos
NULL-ables (el form los pide opcionales para no matar la conversión del paso 1).
Sin CHECK: Pydantic valida los valores en el API; la columna queda flexible
para agregar buckets sin migración.

Revision ID: 0101
Revises: 0100
Create Date: 2026-10-12
"""
from alembic import op

revision = "0101"
down_revision = "0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.visita_solicitud
          ADD COLUMN IF NOT EXISTS intencion   TEXT,  -- 'vivir' | 'invertir'
          ADD COLUMN IF NOT EXISTS presupuesto TEXT,  -- bucket: '<200M' | '200-500M' | '500-1000M' | '>1000M'
          ADD COLUMN IF NOT EXISTS plazo       TEXT,  -- 'ya' | '1-3m' | '3-6m' | 'explorando'
          ADD COLUMN IF NOT EXISTS credito     TEXT   -- 'contado' | 'aprobado' | 'en_tramite' | 'no'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.visita_solicitud
          DROP COLUMN IF EXISTS intencion,
          DROP COLUMN IF EXISTS presupuesto,
          DROP COLUMN IF EXISTS plazo,
          DROP COLUMN IF EXISTS credito
        """
    )
