"""
DAG: refrescar la TRM (COP/USD) semanalmente desde datos.gov.co (32sa-8pi3).
Schedule: lunes 6:00 AM COT (11:00 UTC). Upsert de la única fila de public.trm.
Fail-safe: si la API falla, conserva el último valor (ver scripts/fetch_trm.py).
"""
import os
import sys
from datetime import datetime, timedelta

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from scripts.fetch_trm import fetch_and_save_trm

default_args = {
    "owner": "social",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "email_on_failure": False,
}

with DAG(
    dag_id="trm_semanal",
    default_args=default_args,
    description="Refresca la TRM oficial (COP/USD) semanal desde datos.gov.co",
    schedule_interval=_sched("0 11 * * 1"),  # lunes 6:00 AM COT = 11:00 UTC
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["trm", "finanzas"],
) as dag:
    PythonOperator(
        task_id="fetch_trm",
        python_callable=fetch_and_save_trm,
    )
