"""
DAG: scrape_renta_corta — Airbnb + VRBO + NomadBarrio + Flatio + Booking
(renta corta/media) cada 3 días.

Schedule: cada 3 días a las 4:00 AM COT (09:00 UTC), 1h después de
scrape_listings para no competir por CPU/memoria con esos scrapers.

Tasks (paralelas, todas → raw.listings_renta_media salvo vrbo):
    airbnb       — scraping/renta_media/airbnb_mensual_scraper.py
                   --detail-limit 150: visita páginas de detalle para campos ricos
                   (coords faltantes primero)
    vrbo         — scraping/vrbo/vrbo_scraper.py → raw.listings_premium
    nomadbarrio  — scraping/renta_media/nomadbarrio_scraper.py
    flatio       — scraping/renta_media/flatio_scraper.py
    booking      — scraping/renta_media/booking_scraper.py
"""

import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

PROJECT_DIR = Path(__file__).parent.parent.parent  # urbi-map-vision/

default_args = {
    "owner": "social",
    "retries": 1,
    "retry_delay": timedelta(minutes=15),
    "email_on_failure": False,
}


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, cwd=str(PROJECT_DIR), capture_output=True, text=True)
    if result.stdout:
        print(result.stdout[-4000:])
    if result.stderr:
        print(result.stderr[-2000:], file=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(cmd)}")


def scrape_airbnb() -> None:
    _run([
        sys.executable, "scraping/renta_media/airbnb_mensual_scraper.py",
        "--detail-limit", "50",  # reduced from 150 — Playwright crashes on long runs in container
    ])


def scrape_vrbo() -> None:
    _run([sys.executable, "scraping/vrbo/vrbo_scraper.py"])


def scrape_nomadbarrio() -> None:
    _run([sys.executable, "scraping/renta_media/nomadbarrio_scraper.py"])


def scrape_flatio() -> None:
    _run([sys.executable, "scraping/renta_media/flatio_scraper.py"])


def scrape_booking() -> None:
    _run([sys.executable, "scraping/renta_media/booking_scraper.py", "--max-pages", "3"])


with DAG(
    dag_id="scrape_renta_corta",
    default_args=default_args,
    description="Airbnb + VRBO + NomadBarrio + Flatio + Booking renta corta/media cada 3 días",
    schedule_interval=_sched("0 9 */3 * *"),  # 4:00 AM COT = 09:00 UTC, cada 3 días
    start_date=datetime(2026, 7, 1),
    catchup=False,
    tags=["renta_corta", "airbnb", "vrbo", "nomadbarrio", "flatio", "booking", "scraping"],
    max_active_runs=1,
) as dag:

    t_airbnb = PythonOperator(
        task_id="scrape_airbnb",
        python_callable=scrape_airbnb,
        execution_timeout=timedelta(hours=4),
    )

    t_vrbo = PythonOperator(
        task_id="scrape_vrbo",
        python_callable=scrape_vrbo,
        execution_timeout=timedelta(hours=2),
    )

    t_nomadbarrio = PythonOperator(
        task_id="scrape_nomadbarrio",
        python_callable=scrape_nomadbarrio,
        execution_timeout=timedelta(hours=1),
    )

    t_flatio = PythonOperator(
        task_id="scrape_flatio",
        python_callable=scrape_flatio,
        execution_timeout=timedelta(hours=1),
    )

    t_booking = PythonOperator(
        task_id="scrape_booking",
        python_callable=scrape_booking,
        execution_timeout=timedelta(hours=1),
    )
