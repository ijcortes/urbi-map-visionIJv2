"""
DAG: ingest_pois
Descarga POIs de OpenStreetMap (Overpass API) y los carga en raw.pois.
También recalcula analytics.barrios_pois_distancia.
Schedule: semanal (datos OSM no cambian frecuentemente).

Movida desde ~/urbi/airflow/dags 2026-08-23 — esa carpeta ya no la lee el
Airflow que corre hoy (DAGS_FOLDER apunta solo a urbi-map-vision/airflow/dags).
"""

from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

SCRIPTS_PATH = Path("/home/edwlearn/urbi/scripts")  # load_pois.py vive en ~/urbi, no en urbi-map-vision

default_args = {
    "owner": "social",
    "retries": 2,
    "retry_delay": timedelta(minutes=10),
    "email_on_failure": False,
}

with DAG(
    dag_id="ingest_pois",
    description="Carga POIs del Valle de Aburrá desde OpenStreetMap en raw.pois",
    schedule_interval=_sched("0 4 * * 1"),  # lunes 4am
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["raw", "geoespacial", "pois", "openstreetmap"],
    default_args=default_args,
) as dag:

    def run_load_pois(**context):
        import subprocess
        import sys

        result = subprocess.run(
            [sys.executable, str(SCRIPTS_PATH / "load_pois.py"), "--build-analytics"],
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            raise RuntimeError(f"load_pois falló con código {result.returncode}")

    cargar_pois = PythonOperator(
        task_id="cargar_pois_raw",
        python_callable=run_load_pois,
    )
