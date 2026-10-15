"""
DAG: scrape_tiendas_google
Schedule: día 1 de enero/julio 03:00 COT (08:00 UTC) — pausado por defecto
Tasks:
  scrape_google_places — UPSERT tiendas from Google Places (New) API
"""
import os
import sys
from datetime import datetime, timedelta

from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

default_args = {
    "owner": "social",
    "retries": 2,
    "retry_delay": timedelta(minutes=10),
    "email_on_failure": False,
}


def run_google_places_scraper(**kwargs):
    from scraping.tiendas.google_places_scraper import run
    total = run()
    print(f"[google_places] {total} tiendas upserted")
    kwargs["ti"].xcom_push(key="total_tiendas", value=total)


with DAG(
    "scrape_tiendas_google",
    default_args=default_args,
    description="Scrape tiendas por barrio vía Google Places API",
    schedule_interval=_sched("0 8 1 */6 *"),  # cada 6 meses (ene/jul) — API Google Places cuesta; DAG pausado por ahora
    start_date=datetime(2026, 6, 1),
    catchup=False,
    tags=["tiendas", "google_places", "comunidad"],
) as dag:

    scrape = PythonOperator(
        task_id="scrape_google_places",
        python_callable=run_google_places_scraper,
    )
