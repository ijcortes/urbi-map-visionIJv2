"""
Automated data refresh entrypoint — designed to run as a Railway cron job.

Usage:
  python scripts/refresh_data.py [--skip-remates] [--dry-run]

Exit codes:
  0 — success
  1 — pipeline step failed (logged to stderr)

Environment variables consumed:
  SENTRY_DSN     — optional; reports failures to Sentry
  DATABASE_URL   — passed through to load_valle_aburra.py if present
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent


def _log(msg: str) -> None:
    print(f"[refresh_data {time.strftime('%Y-%m-%dT%H:%M:%S')}] {msg}", flush=True)


def _run(cmd: list[str], label: str) -> bool:
    _log(f"START {label}")
    result = subprocess.run(cmd, cwd=SCRIPTS_DIR)
    if result.returncode == 0:
        _log(f"OK    {label}")
        return True
    _log(f"FAIL  {label} (exit {result.returncode})", )
    print(f"FAIL  {label} (exit {result.returncode})", file=sys.stderr, flush=True)
    return False


def _sentry_capture(exc: Exception) -> None:
    dsn = os.getenv("SENTRY_DSN", "")
    if not dsn:
        return
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=dsn, environment=os.getenv("RAILWAY_ENVIRONMENT", "production"))
        sentry_sdk.capture_exception(exc)
        sentry_sdk.flush(timeout=5)
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-remates", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    python = sys.executable
    dry = ["--dry-run"] if args.dry_run else []
    steps: list[tuple[list[str], str]] = [
        # Daily incremental; full pass on Sundays (coverage + stale-listing rule).
        ([python, "scrape_fincaraiz.py", "--since-days", "3", "--full-on-weekday", "6"], "fincaraiz scrape"),
        # scrape_fincaraiz.py only writes JSON to data/raw/ — these two actually
        # load it into raw.listings_fincaraiz. Missing here since this pipeline's
        # inception meant every scrape was discarded on container restart and
        # prod's fincaraiz table stayed empty indefinitely (see migration 0068).
        ([python, "load_medellin_fincaraiz.py", *dry], "fincaraiz load (Medellín)"),
        ([python, "load_valle_aburra.py", *dry], "fincaraiz load (Valle de Aburrá)"),
    ]
    if not args.skip_remates:
        steps.append(([python, "remates/scraper.py"], "remates scrape"))
    steps += [
        ([python, "remates/aggregate_remates.py"], "remates aggregate"),
        ([python, "aggregate.py"], "listings aggregate"),
    ]
    if not args.dry_run:
        # update_ts.py NO va aquí: es codegen de build (regenera src/data/*.ts del
        # frontend, archivos commiteados), no una tarea de datos runtime. En el
        # contenedor de cron src/ no existe y escribir el .ts ahí no sirve de nada
        # (efímero, sin commit, sin build). Se corre en dev al regenerar la data
        # estática del frontend, no en prod.
        steps.append(([python, str(SCRIPTS_DIR.parent / "scraping" / "run_comunidad.py")], "comunidad scrapers"))

    failed: list[str] = []
    for cmd, label in steps:
        if not _run(cmd, label):
            failed.append(label)

    if failed:
        err = RuntimeError(f"refresh_data failed steps: {', '.join(failed)}")
        _sentry_capture(err)
        _log(f"DONE with {len(failed)} failure(s): {failed}")
        return 1

    _log("DONE — all steps succeeded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
