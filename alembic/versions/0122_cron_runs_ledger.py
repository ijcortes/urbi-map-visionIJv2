"""raw.cron_runs — ledger durable de cada corrida de cron (QC fallas silenciosas)

scripts/run_job.py (wrapper de cada job de cron) graba aquí: inicio, fin,
duración, exit code, ok, y las últimas líneas de salida (tail). Es el almacén
que SOBREVIVE restarts del contenedor efímero — a diferencia de /var/log/urbi/*,
que se pierde. Consultable para "¿corrió X?, ¿falló?, ¿qué dijo?" y para que
qc_report/un dashboard vean el historial.

  - finished_at NULL con started_at viejo  => job colgado o OOM-killed (zombie).
  - ok = FALSE                              => reventó o salió != 0 (ya alertó Sentry).

Revision ID: 0122
Revises: 0121
"""
from alembic import op

revision = "0122"
down_revision = "0121"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS raw")
    op.execute("""
    CREATE TABLE IF NOT EXISTS raw.cron_runs (
        id          BIGSERIAL PRIMARY KEY,
        job         TEXT NOT NULL,
        started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        duration_s  DOUBLE PRECISION,
        exit_code   INTEGER,
        ok          BOOLEAN,
        tail        TEXT,
        host_env    TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_cron_runs_job_started ON raw.cron_runs (job, started_at DESC);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS raw.cron_runs")
