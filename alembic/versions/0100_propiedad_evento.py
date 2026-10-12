"""feat: propiedad_evento — ledger append-only de eventos de propiedad (venta /
cambio de precio) keyed por matrícula ORIP + cédula catastral. Sobrevive a la
muerte del listing (que se trunca/cierra); la propiedad es durable, el listing
efímero. Precio autoreportado por el realtor → verificado=false hasta cruzar
con compraventas_orips (SNR).

Revision ID: 0100
Revises: 0099
Create Date: 2026-10-12
"""
from alembic import op

revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.propiedad_evento (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            matricula_inmobiliaria  TEXT,
            cedula_catastral        TEXT,
            listing_id              UUID,            -- provenancia (sin FK: ledger)
            tipo_evento             TEXT NOT NULL,   -- 'venta' | 'cambio_precio'
            precio                  NUMERIC,
            moneda                  TEXT NOT NULL DEFAULT 'COP',
            fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
            agent_id                UUID,            -- quién reportó
            verificado              BOOLEAN NOT NULL DEFAULT FALSE,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_propiedad_evento_matricula "
        "ON public.propiedad_evento (matricula_inmobiliaria)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.propiedad_evento")
