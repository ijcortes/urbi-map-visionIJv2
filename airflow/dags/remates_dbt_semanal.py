"""
DAG: remates_dbt_semanal

Refresh dbt de scores que dependen de remates judiciales.
Schedule: miércoles 5am COT (10:00 UTC).

Recortada 2026-08-23 de ~/urbi/airflow/dags/remates_semanal.py: el t1 original
(scraping de remates) se eliminó — scripts/refresh_data.py, corrido diario por
urbi-cron en Railway, ya scrapea remates (raw.listings_*). Agregar el scraper
acá lo hubiera duplicado. También se quitó `barrios_salud_financiera` del
--select: ese modelo dbt no existe en ~/urbi/dbt/models (referencia muerta en
el DAG original), dbt hubiera fallado con "model not found".
"""

from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.bash import BashOperator

DBT_DIR = "/home/edwlearn/urbi/dbt"

default_args = {
    "owner":            "social",
    "retries":          2,
    "retry_delay":      timedelta(minutes=5),
    "email_on_failure": False,
}

with DAG(
    dag_id="remates_dbt_semanal",
    description="dbt run scores que dependen de remates (sin re-scrapear, cubierto por Railway)",
    schedule_interval=_sched("0 10 * * 3"),  # miércoles 10:00 UTC = 05:00 COT
    start_date=datetime(2024, 1, 10),
    catchup=False,
    default_args=default_args,
    tags=["social", "dbt"],
) as dag:

    t1 = BashOperator(
        task_id="dbt_scores_post_remates",
        bash_command=(
            f"cd {DBT_DIR} && "
            "dbt run --select score_largo_plazo barrios_score_consolidado --profiles-dir ."
        ),
    )
