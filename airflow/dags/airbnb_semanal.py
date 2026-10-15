"""
DAG: airbnb_semanal

Pipeline completo de datos Airbnb + dbt.
Schedule: domingo 3am COT (08:00 UTC).

Orden:
  t1: AirROI fetch por barrios
  t2: dbt run --select barrios_airbnb_real
  t3: dbt run --select score_corto_plazo barrios_score_consolidado

Movida desde ~/urbi/airflow/dags 2026-08-23 — esa carpeta ya no la lee el
Airflow que corre hoy. airoi_fetch_weekly.py (el otro DAG de esa carpeta) NO
se movió — es un subconjunto exacto de t1 de este DAG, mismo fetch/schedule,
lo hubiera duplicado.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator

DBT_DIR = "/home/edwlearn/urbi/dbt"  # antes /opt/airflow/dbt, no existe en este contenedor

# airroi_client.py vive en ~/urbi/scraping/airbnb, no en urbi-map-vision/scraping —
# esta DAG vivía en ~/urbi/airflow/dags originalmente, donde el import resolvía solo.
URBI_DIR = "/home/edwlearn/urbi"
if URBI_DIR not in sys.path:
    sys.path.insert(0, URBI_DIR)

default_args = {
    "owner":            "social",
    "retries":          2,
    "retry_delay":      timedelta(minutes=5),
    "email_on_failure": False,
}

with DAG(
    dag_id="airbnb_semanal",
    description="Fetch AirROI + dbt Airbnb metrics + score corto plazo",
    schedule_interval=_sched("0 8 * * 0"),  # domingo 08:00 UTC = 03:00 COT
    start_date=datetime(2024, 1, 7),
    catchup=False,
    default_args=default_args,
    tags=["social", "airbnb", "dbt"],
) as dag:

    def fetch_airroi(**context):
        import logging
        from scraping.airbnb.airroi_client import AirROIClient, ensure_table, save_records

        log = logging.getLogger(__name__)
        ensure_table()
        client = AirROIClient()
        records = client.run()
        if not records:
            raise ValueError("AirROI devolvió 0 registros — verificar API key y créditos.")
        saved = save_records(records)
        log.info("airbnb_semanal: %d barrios guardados en raw.airbnb_barrios", saved)
        return saved

    t1 = PythonOperator(
        task_id="fetch_airroi_barrios",
        python_callable=fetch_airroi,
    )

    t2 = BashOperator(
        task_id="dbt_barrios_airbnb_real",
        bash_command=f"cd {DBT_DIR} && dbt run --select barrios_airbnb_real --profiles-dir .",
    )

    t3 = BashOperator(
        task_id="dbt_score_corto_consolidado",
        bash_command=(
            f"cd {DBT_DIR} && "
            "dbt run --select score_corto_plazo barrios_score_consolidado --profiles-dir ."
        ),
    )

    t1 >> t2 >> t3
