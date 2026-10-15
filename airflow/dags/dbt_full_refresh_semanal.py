"""
DAG: dbt_full_refresh_semanal

Rebuild completo de todos los modelos dbt (analytics + staging) + test suite.
Schedule: lunes 2am COT (07:00 UTC).

Recortada 2026-08-23 de ~/urbi/airflow/dags/scraping_semanal.py: los t1-t5
originales (scraping Fincaraíz/Metrocuadrado, geocodificar, remates, POIs)
se eliminaron — todos duplicados de pipelines que ya corren: Fincaraíz+
Metrocuadrado en el DAG scrape_listings de este mismo directorio, remates en
scripts/refresh_data.py (urbi-cron/Railway, diario), POIs en ingest_pois
(este directorio, semanal). Solo se conserva el rebuild + test de dbt.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator

log = logging.getLogger(__name__)

DBT_DIR = "/home/edwlearn/urbi/dbt"

default_args = {
    "owner":            "social",
    "retries":          2,
    "retry_delay":      timedelta(minutes=5),
    "email_on_failure": False,
}

with DAG(
    dag_id="dbt_full_refresh_semanal",
    description="dbt run --full-refresh + dbt test, todos los modelos",
    schedule_interval=_sched("0 7 * * 1"),  # lunes 07:00 UTC = 02:00 COT
    start_date=datetime(2024, 1, 8),
    catchup=False,
    default_args=default_args,
    tags=["social", "dbt"],
) as dag:

    t1 = BashOperator(
        task_id="dbt_full_refresh",
        bash_command=f"cd {DBT_DIR} && dbt run --full-refresh --profiles-dir .",
    )

    t2 = BashOperator(
        task_id="dbt_test",
        bash_command=f"cd {DBT_DIR} && dbt test --profiles-dir .",
    )

    def log_resultado(**context):
        log.info(
            "dbt_full_refresh_semanal completado — run_id=%s fecha=%s",
            context["run_id"],
            context["ds"],
        )
        return "ok"

    t3 = PythonOperator(
        task_id="notificacion_resultado",
        python_callable=log_resultado,
    )

    t1 >> t2 >> t3
