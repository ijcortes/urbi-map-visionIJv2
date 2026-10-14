"""
DAG: link_health_diario — verifica que el link original de cada listing siga vivo.

Corre scraping.link_checker (educado: 1 req/s por dominio, HEAD->GET, soft-404, 2 strikes >=24h,
403/429/captcha = bloqueado, NO muerto, freno si >30% de una fuente sale 'gone' en una corrida).
Exit code 2 = alerta (freno de mass-gone / bloqueos masivos): la task falla y NO se desactivó nada
de la fuente frenada. Mismo comando que el cron del contenedor (Dockerfile.cron).

Schedule: diario 09:30 UTC = 4:30 AM COT, después del scrape de las 3:00 AM COT.
"""
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from airflow import DAG
from airflow.operators.python import PythonOperator

PROJECT_DIR = Path(__file__).parent.parent.parent

default_args = {
    "owner": "social",
    "retries": 0,          # a re-run would just re-hit the portals; the next day's run resumes the queue
    "email_on_failure": False,
}


def run_link_checker(limit: int = 2000) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "scraping.link_checker", "--limit", str(limit), "--older-than", "24h"],
        cwd=str(PROJECT_DIR), capture_output=True, text=True,
    )
    print(result.stdout[-4000:])
    if result.stderr:
        print(result.stderr[-4000:], file=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"link_checker exit {result.returncode} (2 = mass-gone/mass-block alert, nothing deactivated for braked source)")


with DAG(
    dag_id="link_health_diario",
    default_args=default_args,
    description="Salud de links originales de listings (soft-404, 2 strikes, freno mass-gone)",
    schedule_interval="30 9 * * *",
    start_date=datetime(2026, 10, 1),
    catchup=False,
    tags=["listings", "link-health"],
    max_active_runs=1,
) as dag:
    PythonOperator(
        task_id="check_links",
        python_callable=run_link_checker,
        execution_timeout=timedelta(hours=3),
    )
