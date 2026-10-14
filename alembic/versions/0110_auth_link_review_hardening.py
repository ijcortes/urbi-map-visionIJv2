"""auth + link-review hardening (codex round 2)

* usuarios.google_sub           verified Google subject; Google logins authenticate by it
* listing_link_health.review_generation   bumps each time a listing ENTERS pending_review; signed
                                          into per-item review tokens so an old e-mail cannot act on a new episode
* listing_link_health.first_notified_at   immutable first successful notification (grace period base)
* listing_link_health.last_gone_confirmed_at   last conclusive 'gone' observation (auto-retire needs it recent)
* listing_link_transitions      raw rows Retire actually switched off, with their previous values;
                                the 0108 downgrade restores exactly these

Revision ID: 0110
Revises: 0109
"""
from alembic import op

revision = "0110"
down_revision = "0109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS google_sub TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_google_sub ON public.usuarios (google_sub) WHERE google_sub IS NOT NULL;

    ALTER TABLE public.listing_link_health
        ADD COLUMN IF NOT EXISTS review_generation integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS first_notified_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_gone_confirmed_at timestamptz;
    -- rows already waiting for review: their first notification is the one already recorded
    UPDATE public.listing_link_health SET first_notified_at = review_notified_at
     WHERE first_notified_at IS NULL AND review_notified_at IS NOT NULL;
    UPDATE public.listing_link_health SET last_gone_confirmed_at = last_gone_at
     WHERE last_gone_confirmed_at IS NULL AND url_status = 'pending_review';

    CREATE TABLE IF NOT EXISTS public.listing_link_transitions (
        id          bigserial PRIMARY KEY,
        url         text NOT NULL,
        tabla       text NOT NULL,            -- raw table name without schema, e.g. listings_habi
        prev_activo boolean,
        prev_url_activa boolean,
        prev_url_validada_at timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now(),
        reverted_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS ix_llt_url ON public.listing_link_transitions (url) WHERE reverted_at IS NULL;
    """)


def downgrade() -> None:
    # 0108's downgrade (which runs next) restores listings from the transitions table when it exists:
    # do that here, restricted to the rows this system actually switched off.
    op.execute("""
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT DISTINCT ON (url, tabla) url, tabla, prev_activo, prev_url_activa, prev_url_validada_at FROM public.listing_link_transitions
                WHERE reverted_at IS NULL ORDER BY url, tabla, id LOOP
        IF to_regclass('raw.' || r.tabla) IS NOT NULL THEN
          EXECUTE format('UPDATE raw.%I SET activo = $1 WHERE url = $2', r.tabla) USING r.prev_activo, r.url;
          IF r.tabla IN ('listings_metrocuadrado','listings_fincaraiz') THEN
            EXECUTE format('UPDATE raw.%I SET url_activa = $1, url_validada_at = $2 WHERE url = $3', r.tabla)
              USING r.prev_url_activa, r.prev_url_validada_at, r.url;
          END IF;
        END IF;
      END LOOP;
    END $$;
    DROP TABLE IF EXISTS public.listing_link_transitions;
    ALTER TABLE public.listing_link_health
        DROP COLUMN IF EXISTS last_gone_confirmed_at,
        DROP COLUMN IF EXISTS first_notified_at,
        DROP COLUMN IF EXISTS review_generation;
    DROP INDEX IF EXISTS public.ux_usuarios_google_sub;
    ALTER TABLE public.usuarios DROP COLUMN IF EXISTS google_sub;
    """)
