"""
Metrocuadrado + Habi + dedup + stale rule + analytics + espejo R2 + dbt incremental.
Complementa refresh_data.py (fincaraiz+remates). Diario: incremental de 2 días,
pasada completa los domingos (alimenta la regla de listings vencidos).
Dockerfile.cron es la única fuente de horarios (Airflow solo local/manual).

Run: python scripts/run_listings_metrocuadrado.py
"""
import subprocess
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
SCRIPTS_DIR = Path(__file__).parent


def _run(label: str, cmd: list[str], cwd: Path) -> bool:
    print(f"[listings_m2] START {label}", flush=True)
    t0 = time.time()
    result = subprocess.run(cmd, cwd=str(cwd))
    ok = result.returncode == 0
    print(f"[listings_m2] {'OK' if ok else 'FAIL'}    {label} ({time.time()-t0:.1f}s)", flush=True)
    return ok


def _alert(text: str) -> None:
    """Same channels as data_quality_check (Sentry and/or webhook)."""
    try:
        sys.path.insert(0, str(SCRIPTS_DIR))
        from data_quality_check import _alert as dq_alert
        dq_alert(text)
    except Exception:
        pass


def main() -> int:
    failed: list[str] = []

    # metrocuadrado y habi no dependen entre sí — pero se corren secuenciales,
    # nunca en paralelo: el contenedor ya tiene riesgo de OOM documentado con
    # menos scrapers Playwright que estos.
    if not _run("scrape_metrocuadrado", [
        sys.executable, "-m", "scraping.metrocuadrado.scraper",
        "--municipios", "all_valle", "--max-pages", "200", "--since-days", "2",
        "--full-on-weekday", "6",
    ], PROJECT_DIR):
        failed.append("scrape_metrocuadrado")

    if not _run("scrape_habi", [sys.executable, "-m", "scraping.habi.habi_scraper"], PROJECT_DIR):
        failed.append("scrape_habi")

    if not _run("dedup_fincaraiz", [sys.executable, str(SCRIPTS_DIR / "dedup_fincaraiz.py")], SCRIPTS_DIR):
        failed.append("dedup_fincaraiz")

    if not _run("deactivate_stale", [sys.executable, str(SCRIPTS_DIR / "deactivate_stale_listings.py")], SCRIPTS_DIR):
        failed.append("deactivate_stale")

    if not _run("refresh_analytics", [sys.executable, "enrich_barrios_stats.py"], SCRIPTS_DIR):
        failed.append("refresh_analytics")

    if not _run("mirror_media_r2", [sys.executable, "mirror_listings_media.py", "--limit", "5000"], SCRIPTS_DIR):
        failed.append("mirror_media_r2")

    if not _run("dbt_run_incremental", [sys.executable, str(SCRIPTS_DIR / "dbt_run.py"), "run"], SCRIPTS_DIR):
        failed.append("dbt_run_incremental")

    if failed:
        print(f"[listings_m2] DONE con fallas: {failed}", file=sys.stderr, flush=True)
        _alert(f"run_listings_metrocuadrado: pasos fallidos {failed}")
        return 1
    print("[listings_m2] DONE — todos los pasos OK", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
