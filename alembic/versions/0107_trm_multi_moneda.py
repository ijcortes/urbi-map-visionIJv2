"""public.trm multi-moneda (PK moneda) — schema the API and scripts/fetch_trm.py already assume

api/services/trm_service.py reads `WHERE moneda = $1` and scripts/fetch_trm.py upserts
`ON CONFLICT (moneda)`, but migration 0041 only created the legacy single-row table
(id=1, USD). On a database built from migrations the rate lookup therefore always
failed silently and every price used the env fallback. This migration is idempotent
(a database already converted by hand is left untouched).

Revision ID: 0107
Revises: 0106
"""
from alembic import op

revision = "0107"
down_revision = "0106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='trm' AND column_name='moneda') THEN
        ALTER TABLE public.trm ADD COLUMN moneda text;
        UPDATE public.trm SET moneda = 'USD';
        ALTER TABLE public.trm DROP CONSTRAINT IF EXISTS trm_id_check;
        ALTER TABLE public.trm DROP CONSTRAINT IF EXISTS trm_pkey;
        ALTER TABLE public.trm DROP COLUMN IF EXISTS id;
        ALTER TABLE public.trm ALTER COLUMN moneda SET NOT NULL;
        ALTER TABLE public.trm ADD PRIMARY KEY (moneda);
      END IF;
    END $$;
    """)


def downgrade() -> None:
    # Non-destructive: keeping the multi-moneda shape is harmless for the old code path.
    pass
