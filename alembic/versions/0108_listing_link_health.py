"""listing link health: shared health table + broken-link reports

Single source of truth for "is the original portal link of this listing still alive?".
One shared table (keyed by url, which is already the join key of every serving query)
instead of columns on each scraper table, so no scraper table is modified.

* public.listing_link_health   one row per listing url (written only by scraping/link_checker
                                and the report endpoint)
* public.listing_link_reports  one row per (ip_hash, url) user report (dedup enforced by PK)

`url_status` is the CONFIRMED state: unknown | ok | redirected | gone | blocked | error.
A single "gone" observation only bumps consecutive_gone; after N strikes >= 24h apart the status
becomes 'pending_review' (link hidden, listing STAYS ACTIVE). A human approves via a signed e-mail link:
'gone' = retired (raw table deactivated), or 'keep' (suppressed for keep_until). raw.listings_*.url_activa is kept as a
mirror of this table for the staging rebuild (api/cache.py) — it is no longer written by anything else.

Revision ID: 0108
Revises: 0107
"""
from alembic import op

revision = "0108"
down_revision = "0107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS public.listing_link_health (
        url                 text PRIMARY KEY,
        fuente              text NOT NULL,
        url_status          text NOT NULL DEFAULT 'unknown'
                            CHECK (url_status IN ('unknown','ok','redirected','pending_review','gone','blocked','error')),
        last_result         text,
        http_status         integer,
        final_url           text,
        last_checked_at     timestamptz,
        last_ok_at          timestamptz,
        consecutive_failures integer NOT NULL DEFAULT 0,
        consecutive_gone    integer NOT NULL DEFAULT 0,
        first_gone_at       timestamptz,
        last_gone_at        timestamptz,
        check_error         text,
        priority            integer NOT NULL DEFAULT 0,
        report_count        integer NOT NULL DEFAULT 0,
        review_notified_at  timestamptz,
        review_batch        integer,
        review_decision     text,
        reviewed_at         timestamptz,
        keep_until          timestamptz,
        deactivated_at      timestamptz,
        deactivation_reason text,
        created_at          timestamptz NOT NULL DEFAULT now()
    );
    -- checker queue: priority first, then never-checked, then oldest check
    CREATE INDEX IF NOT EXISTS ix_llh_queue
        ON public.listing_link_health (priority DESC, last_checked_at NULLS FIRST);
    CREATE INDEX IF NOT EXISTS ix_llh_fuente_status
        ON public.listing_link_health (fuente, url_status);
    -- serving filter only ever looks for the rare 'gone'/'error' rows
    CREATE INDEX IF NOT EXISTS ix_llh_bad
        ON public.listing_link_health (url) WHERE url_status IN ('gone','pending_review','error');

    CREATE TABLE IF NOT EXISTS public.listing_link_reports (
        url         text NOT NULL,
        ip_hash     text NOT NULL,
        reported_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (url, ip_hash)
    );

    -- single-use enforcement for signed review links (jti recorded when a link is acted on)
    CREATE TABLE IF NOT EXISTS public.listing_link_review_used (
        jti      text PRIMARY KEY,
        action   text NOT NULL,
        target   text NOT NULL,
        used_at  timestamptz NOT NULL DEFAULT now()
    );

    -- one row per review email/digest (cadence: max one per day); id doubles as review_batch
    CREATE TABLE IF NOT EXISTS public.listing_link_digest_log (
        id        serial PRIMARY KEY,
        sent_at   timestamptz NOT NULL DEFAULT now(),
        kind      text NOT NULL,          -- 'candidates' | 'brake' | 'file_only'
        n_items   integer NOT NULL DEFAULT 0,
        n_recipients integer NOT NULL DEFAULT 0
    );
    """)


def downgrade() -> None:
    # Restore url_activa for rows this system turned off, so a rollback does not leave
    # listings hidden by a mirror nobody maintains any more.
    op.execute("""
    DO $$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['listings_metrocuadrado','listings_fincaraiz'] LOOP
        IF to_regclass('raw.' || t) IS NOT NULL
           AND to_regclass('public.listing_link_health') IS NOT NULL THEN
          EXECUTE format(
            'UPDATE raw.%I r SET url_activa = NULL FROM public.listing_link_health h
              WHERE h.url = r.url AND h.deactivated_at IS NOT NULL', t);
        END IF;
      END LOOP;
      IF to_regclass('public.listing_link_health') IS NOT NULL THEN
        FOREACH t IN ARRAY ARRAY['listings_metrocuadrado','listings_fincaraiz','listings_habi','listings_casadolcecasa'] LOOP
          IF to_regclass('raw.' || t) IS NOT NULL THEN
            EXECUTE format(
              'UPDATE raw.%I r SET activo = true FROM public.listing_link_health h
                WHERE h.url = r.url AND h.deactivation_reason LIKE ''link_checker:%%''', t);
          END IF;
        END LOOP;
      END IF;
    END $$;
    DROP TABLE IF EXISTS public.listing_link_digest_log;
    DROP TABLE IF EXISTS public.listing_link_review_used;
    DROP TABLE IF EXISTS public.listing_link_reports;
    DROP TABLE IF EXISTS public.listing_link_health;
    """)
