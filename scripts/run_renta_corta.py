"""
Airbnb + VRBO + NomadBarrio + Flatio + Booking (renta corta/media), cada 3 días.
Puerto de airflow/dags/scrape_renta_corta.py — en Airflow corrían en paralelo
(workers separados); acá van secuenciales a propósito: 5 scrapers Playwright
en paralelo en un contenedor ya-documentado con riesgo de OOM es la forma
más rápida de tumbarlo, y un scraper matado por OOM se ve igual a "corrió
bien y no encontró nada" (mismo bug silencioso que meetup en scrape_eventos).

Run: python scripts/run_renta_corta.py
"""
import subprocess
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent


def _run(label: str, cmd: list[str]) -> bool:
    print(f"[renta_corta] START {label}", flush=True)
    t0 = time.time()
    result = subprocess.run(cmd, cwd=str(PROJECT_DIR))
    ok = result.returncode == 0
    print(f"[renta_corta] {'OK' if ok else 'FAIL'}    {label} ({time.time()-t0:.1f}s)", flush=True)
    return ok


def main() -> int:
    steps: list[tuple[str, list[str]]] = [
        ("scrape_airbnb", [
            sys.executable, "scraping/renta_media/airbnb_mensual_scraper.py",
            "--detail-limit", "50",  # reducido de 150 — Playwright crashea en runs largos en contenedor
        ]),
        ("scrape_vrbo", [sys.executable, "scraping/vrbo/vrbo_scraper.py"]),
        # medellinliving va tras vrbo a propósito: vrbo.ensure_table() crea el trigger
        # trg_precio_cambio_premium en raw.listings_premium, que es lo que captura el
        # historial de precio del UPSERT de medellinliving (requests, no Playwright → liviano).
        ("scrape_medellinliving", [sys.executable, "scripts/scrape_medellinliving.py"]),
        ("scrape_nomadbarrio", [sys.executable, "scraping/renta_media/nomadbarrio_scraper.py"]),
        ("scrape_flatio", [sys.executable, "scraping/renta_media/flatio_scraper.py"]),
        ("scrape_booking", [sys.executable, "scraping/renta_media/booking_scraper.py", "--max-pages", "3"]),
    ]
    failed = [label for label, cmd in steps if not _run(label, cmd)]

    if failed:
        print(f"[renta_corta] DONE con fallas: {failed}", file=sys.stderr, flush=True)
        return 1
    print("[renta_corta] DONE — todos los pasos OK", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
