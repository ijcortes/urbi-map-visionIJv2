"""
DAG: actualizar parámetros financieros diariamente.
Schedule: 6:00 AM COT (11:00 UTC)
Tasks:
    t1 — fetch USD/COP rate from exchangerate-api.com → raw.parametros_sistema
"""
from datetime import datetime, timedelta

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

import sys
import os

# Make project scripts importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from scripts.fetch_usd_rate import fetch_and_save_usd_rate

default_args = {
    "owner": "social",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "email_on_failure": False,
}

with DAG(
    dag_id="parametros_diario",
    default_args=default_args,
    description="Actualiza parámetros financieros desde fuentes externas",
    schedule_interval=_sched("0 11 * * *"),  # 6:00 AM COT = 11:00 UTC
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["parametros", "finanzas"],
) as dag:
    t1 = PythonOperator(
        task_id="fetch_usd_rate",
        python_callable=fetch_and_save_usd_rate,
    )
