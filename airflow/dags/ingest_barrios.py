"""
DAG: ingest_barrios
Descarga polígonos de barrios de Medellín y los carga en raw.barrios.
Schedule: mensual (los límites de barrios no cambian frecuentemente).

Movida desde ~/urbi/airflow/dags 2026-08-23 — esa carpeta ya no la lee el
Airflow que corre hoy (DAGS_FOLDER apunta solo a urbi-map-vision/airflow/dags).
"""

from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

SCRIPTS_PATH = Path("/home/edwlearn/urbi/scripts")  # load_barrios.py vive en ~/urbi, no en urbi-map-vision

default_args = {
    "owner": "social",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "email_on_failure": False,
}

with DAG(
    dag_id="ingest_barrios",
    description="Carga polígonos de barrios del Valle de Aburrá en raw.barrios",
    schedule_interval=_sched("0 3 1 * *"),  # 3am del día 1 de cada mes
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["raw", "geoespacial", "barrios"],
    default_args=default_args,
) as dag:

    def run_load_barrios(**context):
        import subprocess
        import sys

        result = subprocess.run(
            [sys.executable, str(SCRIPTS_PATH / "load_barrios.py")],
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            raise RuntimeError(f"load_barrios falló con código {result.returncode}")

    cargar_barrios = PythonOperator(
        task_id="cargar_barrios_raw",
        python_callable=run_load_barrios,
    )
