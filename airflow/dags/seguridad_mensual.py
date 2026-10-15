"""
DAG: seguridad_mensual

Actualización mensual de datos de seguridad + dbt.
Schedule: día 1 de cada mes, 4am COT (09:00 UTC).

Orden:
  t1: load_seguridad.py (~/urbi/scripts) — carga raw.criminalidad
  t2: dbt run --select barrios_seguridad score_largo_plazo barrios_score_consolidado

Movida desde ~/urbi/airflow/dags 2026-08-23 — esa carpeta ya no la lee el
Airflow que corre hoy. Rutas corregidas: /opt/airflow no existe en este
contenedor (el mount real es /home/edwlearn/urbi).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.bash import BashOperator

URBI_DIR = "/home/edwlearn/urbi"
DBT_DIR = f"{URBI_DIR}/dbt"

default_args = {
    "owner":            "social",
    "retries":          2,
    "retry_delay":      timedelta(minutes=5),
    "email_on_failure": False,
}

with DAG(
    dag_id="seguridad_mensual",
    description="Carga datos seguridad + dbt score largo plazo",
    schedule_interval=_sched("0 9 1 * *"),  # día 1 cada mes 09:00 UTC = 04:00 COT
    start_date=datetime(2024, 1, 1),
    catchup=False,
    default_args=default_args,
    tags=["social", "dbt"],
) as dag:

    t1 = BashOperator(
        task_id="load_seguridad",
        bash_command=f"cd {URBI_DIR} && python scripts/load_seguridad.py",
    )

    t2 = BashOperator(
        task_id="dbt_seguridad_scores",
        bash_command=(
            f"cd {DBT_DIR} && "
            "dbt run --select barrios_seguridad score_largo_plazo barrios_score_consolidado "
            "--profiles-dir ."
        ),
    )

    t1 >> t2
