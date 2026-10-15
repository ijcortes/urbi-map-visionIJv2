"""
DAG: scrape_eventos
Schedule: 6:00 AM COT (11:00 UTC) daily
Tasks (all parallel):
  scrape_meetup          — GraphQL API + Playwright fallback
  scrape_eventbrite      — requests + BeautifulSoup + detail enrichment
  scrape_luma            — Playwright + __NEXT_DATA__
  scrape_medellin_travel — WordPress/Elementor event pages
  scrape_tuboleta        — Playwright + API intercept
  scrape_alcaldia        — Playwright JS-rendered Drupal
  scrape_cultura_eterea  — REST API pública (sin auth, sin Playwright)
  normalizar_y_cargar    — deduplicate + UPSERT + barrio PIP
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
    "retry_delay": timedelta(minutes=5),
    "email_on_failure": False,
}


def run_meetup_scraper(**kwargs):
    from scraping.eventos.meetup_scraper import run
    eventos = run()
    kwargs["ti"].xcom_push(key="meetup_eventos", value=eventos)
    print(f"[meetup] {len(eventos)} eventos")


def run_eventbrite_scraper(**kwargs):
    from scraping.eventos.eventbrite_scraper import run
    eventos = run()
    kwargs["ti"].xcom_push(key="eventbrite_eventos", value=eventos)
    print(f"[eventbrite] {len(eventos)} eventos")


def run_luma_scraper(**kwargs):
    from scraping.eventos.luma_scraper import run
    eventos = run()
    kwargs["ti"].xcom_push(key="luma_eventos", value=eventos)
    print(f"[luma] {len(eventos)} eventos")


def run_medellin_travel_scraper(**kwargs):
    from scraping.eventos.medellin_travel_scraper import run
    eventos = run()
    kwargs["ti"].xcom_push(key="medellin_travel_eventos", value=eventos)
    print(f"[medellin_travel] {len(eventos)} eventos")


def run_tuboleta_scraper(**kwargs):
    from scraping.eventos.tuboleta_scraper import run
    eventos = run()
    kwargs["ti"].xcom_push(key="tuboleta_eventos", value=eventos)
    print(f"[tuboleta] {len(eventos)} eventos")


def run_alcaldia_scraper(**kwargs):
    from scraping.eventos.alcaldia_scraper import run
    eventos = run()
    kwargs["ti"].xcom_push(key="alcaldia_eventos", value=eventos)
    print(f"[alcaldia] {len(eventos)} eventos")


def run_cultura_eterea_scraper(**kwargs):
    from scraping.eventos.cultura_eterea_scraper import run
    eventos = run()
    kwargs["ti"].xcom_push(key="cultura_eterea_eventos", value=eventos)
    print(f"[cultura_eterea] {len(eventos)} eventos")


def normalizar_y_cargar(**kwargs):
    from scraping.eventos.normalizer import run_todos
    ti = kwargs["ti"]
    meetup          = ti.xcom_pull(task_ids="scrape_meetup",          key="meetup_eventos")          or []
    eventbrite      = ti.xcom_pull(task_ids="scrape_eventbrite",      key="eventbrite_eventos")      or []
    luma            = ti.xcom_pull(task_ids="scrape_luma",            key="luma_eventos")            or []
    medellin_travel = ti.xcom_pull(task_ids="scrape_medellin_travel", key="medellin_travel_eventos") or []
    tuboleta        = ti.xcom_pull(task_ids="scrape_tuboleta",        key="tuboleta_eventos")        or []
    alcaldia        = ti.xcom_pull(task_ids="scrape_alcaldia",        key="alcaldia_eventos")        or []
    cultura_eterea  = ti.xcom_pull(task_ids="scrape_cultura_eterea",  key="cultura_eterea_eventos")  or []

    resultado = run_todos(meetup, eventbrite, luma, medellin_travel, tuboleta, alcaldia, cultura_eterea)
    print(
        f"[normalizar] procesados={resultado['total_procesados']} "
        f"virtuales_filtrados={resultado['virtuales_filtrados']} "
        f"insertados={resultado['insertados_actualizados']} "
        f"errores={resultado['errores']} "
        f"desactivados={resultado['eventos_pasados_desactivados']}"
    )
    print(f"[normalizar] por fuente: {resultado['por_fuente']}")
    return resultado


with DAG(
    dag_id="scrape_eventos",
    default_args=default_args,
    description="Scrape 6 fuentes → public.eventos (Medellín)",
    schedule_interval=_sched("0 11 * * *"),  # 6:00 AM COT = 11:00 UTC
    start_date=datetime(2026, 6, 1),
    catchup=False,
    tags=["scraping", "eventos", "comunidad"],
) as dag:

    t_meetup = PythonOperator(task_id="scrape_meetup",          python_callable=run_meetup_scraper)
    t_eb     = PythonOperator(task_id="scrape_eventbrite",      python_callable=run_eventbrite_scraper)
    t_luma   = PythonOperator(task_id="scrape_luma",            python_callable=run_luma_scraper)
    t_mt     = PythonOperator(task_id="scrape_medellin_travel", python_callable=run_medellin_travel_scraper)
    t_tb     = PythonOperator(task_id="scrape_tuboleta",        python_callable=run_tuboleta_scraper)
    t_alc    = PythonOperator(task_id="scrape_alcaldia",        python_callable=run_alcaldia_scraper)
    t_ce     = PythonOperator(task_id="scrape_cultura_eterea",  python_callable=run_cultura_eterea_scraper)

    t_norm = PythonOperator(task_id="normalizar_y_cargar", python_callable=normalizar_y_cargar)

    [t_meetup, t_eb, t_luma, t_mt, t_tb, t_alc, t_ce] >> t_norm
