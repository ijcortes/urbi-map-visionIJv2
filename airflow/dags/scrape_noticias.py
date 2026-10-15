"""
DAG: scrape_noticias_rss
Schedule: every 4 hours
Tasks:
  scrape_rss_el_colombiano — fetch/filter/upsert noticias from RSS feeds
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
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
    "email_on_failure": False,
}


def run_rss_scraper(**kwargs):
    from scraping.noticias.rss_scraper import run
    stats = run()
    print(f"[noticias] cargadas={stats['total_cargadas']} filtradas={stats['total_filtradas']}")
    kwargs["ti"].xcom_push(key="stats", value=stats)


with DAG(
    "scrape_noticias_rss",
    default_args=default_args,
    description="Scrape noticias culturales El Colombiano vía RSS",
    schedule_interval=_sched("0 */4 * * *"),
    start_date=datetime(2026, 6, 1),
    catchup=False,
    tags=["noticias", "rss", "comunidad"],
) as dag:

    scrape = PythonOperator(
        task_id="scrape_rss_el_colombiano",
        python_callable=run_rss_scraper,
    )
