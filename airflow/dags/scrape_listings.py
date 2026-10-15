"""
DAG: scrape_listings — extrae listings de Fincaraiz y Metrocuadrado cada 3 días.

Modo incremental: solo procesa los listings publicados en los últimos 4 días
(ventana de 4 días para cubrir el gap entre ejecuciones de 3 días + margen).

Schedule: cada 3 días a las 3:00 AM COT (08:00 UTC)
Tasks:
    t1 — scrape Fincaraiz  (--since-days 4, todos los municipios)
    t2 — load Fincaraiz a DB
    t2b — dedup Fincaraiz (marca duplicado_de, nunca borra)
    t3 — scrape Metrocuadrado (--since-days 4, all_valle)
    t8 — scrape Habi (Valle de Aburrá; escribe directo a DB, sin paso load separado)
    t4 — refresh analytics cache (enrich_barrios_stats)
    t5 — shim -> scraping.link_checker (ventana 7d; el chequeo diario real es el DAG link_health_diario)
    t7 — dbt run incremental (staging/analytics dependientes de stg_listings_unificado)

t7 viene de ~/urbi/airflow/dags/scrape_listings_incremental.py (2026-08-23) —
esa DAG scrapeaba Fincaraíz+Metrocuadrado de nuevo (duplicado exacto de t1-t3
de aquí), solo se rescató su paso final de dbt.
"""

import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

PROJECT_DIR = Path(__file__).parent.parent.parent  # urbi-map-vision/
SCRIPTS_DIR = PROJECT_DIR / "scripts"
URBI_DIR = Path("/home/edwlearn/urbi")

default_args = {
    "owner": "social",
    "retries": 1,
    "retry_delay": timedelta(minutes=10),
    "email_on_failure": False,
}


def _run(cmd: list[str], cwd: Path) -> None:
    result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if result.stdout:
        print(result.stdout[-4000:])
    if result.stderr:
        print(result.stderr[-2000:], file=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(cmd)}")


def scrape_fincaraiz() -> None:
    _run(
        [sys.executable, "scrape_fincaraiz.py", "--since-days", "4"],
        cwd=SCRIPTS_DIR,
    )


def load_fincaraiz() -> None:
    _run(
        [sys.executable, "load_medellin_fincaraiz.py"],
        cwd=SCRIPTS_DIR,
    )


def scrape_metrocuadrado() -> None:
    _run(
        [
            sys.executable, "-m", "scraping.metrocuadrado.scraper",
            "--municipios", "all_valle",
            "--max-pages", "200",
            "--since-days", "4",
        ],
        cwd=URBI_DIR,
    )


def scrape_habi() -> None:
    _run(
        [sys.executable, "-m", "scraping.habi.habi_scraper"],
        cwd=PROJECT_DIR,
    )


def refresh_analytics() -> None:
    _run(
        [sys.executable, "enrich_barrios_stats.py"],
        cwd=SCRIPTS_DIR,
    )


def dedup_fincaraiz() -> None:
    # Soft dedup (marks duplicado_de, never DELETEs) — same script cron runs.
    _run([sys.executable, "dedup_fincaraiz.py"], cwd=SCRIPTS_DIR)


def validate_urls() -> None:
    # ponytail: batch 3000 ≈ 9k urls/semana; si el backlog activo supera eso,
    # subir batch o mover a DAG diario propio
    _run(
        [sys.executable, "validate_listings_urls.py", "--batch", "3000"],
        cwd=SCRIPTS_DIR,
    )


def dbt_run_incremental() -> None:
    _run(
        [sys.executable, "-m", "dbt", "run", "--profiles-dir", "."],
        cwd=URBI_DIR / "dbt",
    )


def mirror_media() -> None:
    # Espeja portadas nuevas a R2 (incremental: solo listings sin fila en el
    # mirror). Backfill completo se corre una vez a mano con --all.
    # Si S3_BUCKET no está seteado, el script corre en modo stub (no sube).
    _run(
        [sys.executable, "mirror_listings_media.py", "--limit", "5000"],
        cwd=SCRIPTS_DIR,
    )


with DAG(
    dag_id="scrape_listings",
    default_args=default_args,
    description="Scraping incremental de Fincaraiz + Metrocuadrado + Habi cada 3 días",
    schedule_interval=_sched("0 8 */3 * *"),   # 3:00 AM COT = 08:00 UTC, cada 3 días
    start_date=datetime(2026, 6, 1),
    catchup=False,
    tags=["listings", "scraping", "fincaraiz", "metrocuadrado", "habi"],
    max_active_runs=1,
) as dag:

    t1 = PythonOperator(
        task_id="scrape_fincaraiz",
        python_callable=scrape_fincaraiz,
        execution_timeout=timedelta(hours=2),
    )

    t2 = PythonOperator(
        task_id="load_fincaraiz_db",
        python_callable=load_fincaraiz,
        execution_timeout=timedelta(minutes=30),
    )

    t3 = PythonOperator(
        task_id="scrape_metrocuadrado",
        python_callable=scrape_metrocuadrado,
        execution_timeout=timedelta(hours=3),
    )

    t8 = PythonOperator(
        task_id="scrape_habi",
        python_callable=scrape_habi,
        execution_timeout=timedelta(hours=1),
    )

    t2b = PythonOperator(
        task_id="dedup_fincaraiz",
        python_callable=dedup_fincaraiz,
        execution_timeout=timedelta(minutes=10),
    )

    t4 = PythonOperator(
        task_id="refresh_analytics",
        python_callable=refresh_analytics,
        execution_timeout=timedelta(minutes=20),
    )

    t5 = PythonOperator(
        task_id="validate_urls",
        python_callable=validate_urls,
        execution_timeout=timedelta(hours=1),
    )

    t6 = PythonOperator(
        task_id="mirror_media_r2",
        python_callable=mirror_media,
        execution_timeout=timedelta(hours=2),
    )

    t7 = PythonOperator(
        task_id="dbt_run_incremental",
        python_callable=dbt_run_incremental,
        execution_timeout=timedelta(minutes=30),
    )

    # fincaraiz: scrape → load → dedup → analytics
    # metrocuadrado: scrape → analytics (dedupa al insertar)
    # habi: scrape → analytics (upsert por property_nid, sin dedup step aparte)
    # analytics espera las tres; validación de URLs y espejo de portadas al final
    # dbt incremental corre último, depende de stg_listings_unificado ya fresco
    t1 >> t2 >> t2b >> t4
    t3 >> t4
    t8 >> t4
    t4 >> t5
    t4 >> t6
    t4 >> t7
