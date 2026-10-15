"""security hardening round 3 (ALL-ISSUES open items)

* usuarios.rol                  referenced by /usuario/suscribirse INSERT but never created
                                (schema drift, API-19); also backs ADMIN_REQUIRE_DB_ROLE (SEA-22).
                                The ADMIN_EMAIL row (if present at migration time) gets rol='admin'.
* stripe_events                 processed Stripe event ids: webhook idempotency (SEA-14)
* throttle_hits                 shared per-key throttle counters (email caps, login lockout) that
                                survive restarts and hold across workers (SEA-07)
* ghl_push_failures             first-time GHL pushes that failed (no mapping row yet) kept for
                                retry instead of only logged (API-14)
* owner.otp_intentos            per-account wrong-code counter for the phone code (SEA-17)
* token_blacklist               legacy clear-text JWT rows rewritten to sha256 digests (SEA-09)

Revision ID: 0111
Revises: 0110
"""
import os

from alembic import op

revision = "0111"
down_revision = "0110"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'usuario';

    CREATE TABLE IF NOT EXISTS public.stripe_events (
        event_id     TEXT PRIMARY KEY,
        tipo         TEXT,
        recibido_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.throttle_hits (
        id      BIGSERIAL PRIMARY KEY,
        key     TEXT NOT NULL,
        hit_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ix_throttle_hits_key_at ON public.throttle_hits (key, hit_at);

    CREATE TABLE IF NOT EXISTS public.ghl_push_failures (
        id                  BIGSERIAL PRIMARY KEY,
        object_type         TEXT NOT NULL,
        internal_object_id  TEXT NOT NULL,
        error               TEXT,
        attempts            INTEGER NOT NULL DEFAULT 1,
        first_failed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_failed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at         TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_ghl_push_failures_open
        ON public.ghl_push_failures (object_type, internal_object_id) WHERE resolved_at IS NULL;

    DO $$ BEGIN
        IF to_regclass('public.owner') IS NOT NULL THEN
            ALTER TABLE public.owner ADD COLUMN IF NOT EXISTS otp_intentos INTEGER NOT NULL DEFAULT 0;
        END IF;
    END $$;

    DO $$ BEGIN
        IF to_regclass('public.token_blacklist') IS NOT NULL THEN
            UPDATE public.token_blacklist
               SET token = 'sha256:' || encode(sha256(convert_to(token, 'UTF8')), 'hex')
             WHERE token NOT LIKE 'jti:%' AND token NOT LIKE 'sha256:%';
        END IF;
    END $$;
    """)

    admin_email = (os.getenv("ADMIN_EMAIL") or "").strip().lower()
    if admin_email:
        op.get_bind().exec_driver_sql(
            "UPDATE public.usuarios SET rol = 'admin' WHERE lower(email) = %(e)s",
            {"e": admin_email},
        )


def downgrade() -> None:
    # token_blacklist digests cannot be reversed; leaving them is harmless (they
    # simply stop matching legacy tokens, which expire on their own).
    op.execute("""
    DO $$ BEGIN
        IF to_regclass('public.owner') IS NOT NULL THEN
            ALTER TABLE public.owner DROP COLUMN IF EXISTS otp_intentos;
        END IF;
    END $$;
    DROP TABLE IF EXISTS public.ghl_push_failures;
    DROP TABLE IF EXISTS public.throttle_hits;
    DROP TABLE IF EXISTS public.stripe_events;
    -- usuarios.rol is kept: prod may have had it before 0111 (drift), dropping could lose data.
    """)
