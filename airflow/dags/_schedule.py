"""Production schedules live in Dockerfile.cron (the single source of truth).

These DAGs are for local/WSL2 runs only. They do not schedule themselves unless
AIRFLOW_SCHEDULES_ENABLED=1, so a local Airflow can never double-run a job that
cron already runs against the same database. Trigger them manually instead.
"""
import os


def cron_or_none(expr: str):
    return expr if os.getenv("AIRFLOW_SCHEDULES_ENABLED", "").strip() == "1" else None
