"""Lee raw.cron_runs y dice qué pasó con cada job de cron. On-demand — esto es lo
que se corre cuando alguien pide "tráeme los logs / qué ha pasado".

Uso:
    python3 scripts/cron_status.py              # estado del último run por job
    python3 scripts/cron_status.py --fails      # solo fallas + zombies recientes (con tail)
    python3 scripts/cron_status.py --job NAME    # historial + tail de un job
    python3 scripts/cron_status.py --hours 72    # ventana del resumen (default 48)
    python3 scripts/cron_status.py --zombie-hours 6  # un run sin terminar más viejo = ZOMBIE

Necesita DATABASE_URL. Contra DEV/prod:
    railway run -e DEV -s social-cron -- python3 scripts/cron_status.py --fails
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg2


def _status(ok, finished_at, age_h: float, zombie_h: float) -> str:
    if finished_at is None:
        return "ZOMBIE" if age_h is not None and age_h > zombie_h else "RUNNING"
    return "OK" if ok else "FALLÓ"


def summary(cur, hours: float, zombie_h: float) -> int:
    cur.execute(
        """
        SELECT DISTINCT ON (job)
               job, started_at, finished_at, ok, exit_code, duration_s,
               EXTRACT(EPOCH FROM now() - started_at) / 3600.0 AS age_h
          FROM raw.cron_runs
         WHERE started_at > now() - make_interval(hours => %s::int)
         ORDER BY job, started_at DESC
        """,
        (int(hours),),
    )
    rows = cur.fetchall()
    if not rows:
        print(f"(sin corridas en las últimas {hours:.0f} h — ¿cron no corrió o tabla vacía?)")
        return 0
    bad = 0
    print(f"{'JOB':<22} {'ESTADO':<8} {'HACE':>7} {'DUR':>7} {'EXIT':>5}  ÚLTIMO INICIO")
    print("-" * 78)
    for job, started, finished, ok, code, dur, age_h in sorted(rows, key=lambda r: (r[3] is not False, r[0])):
        st = _status(ok, finished, age_h, zombie_h)
        if st in ("FALLÓ", "ZOMBIE"):
            bad += 1
        age = f"{age_h:.1f}h" if age_h is not None else "—"
        d = f"{dur:.0f}s" if dur is not None else "—"
        c = str(code) if code is not None else "—"
        print(f"{job:<22} {st:<8} {age:>7} {d:>7} {c:>5}  {started:%Y-%m-%d %H:%M}")
    print("-" * 78)
    print(f"{len(rows)} jobs · {bad} con problema (FALLÓ/ZOMBIE)")
    return 1 if bad else 0


def fails(cur, hours: float, zombie_h: float) -> int:
    cur.execute(
        """
        SELECT DISTINCT ON (job)
               job, started_at, finished_at, ok, exit_code, duration_s, tail,
               EXTRACT(EPOCH FROM now() - started_at) / 3600.0 AS age_h
          FROM raw.cron_runs
         WHERE started_at > now() - make_interval(hours => %s::int)
         ORDER BY job, started_at DESC
        """,
        (int(hours),),
    )
    shown = 0
    for job, started, finished, ok, code, dur, tail, age_h in cur.fetchall():
        st = _status(ok, finished, age_h, zombie_h)
        if st not in ("FALLÓ", "ZOMBIE"):
            continue
        shown += 1
        print(f"\n=== {job} — {st} (exit={code}, hace {age_h:.1f}h) {started:%Y-%m-%d %H:%M} ===")
        print((tail or "(sin salida capturada)").rstrip())
    if shown == 0:
        print(f"✅ sin fallas ni zombies en las últimas {hours:.0f} h")
    return 1 if shown else 0


def one_job(cur, job: str, limit: int = 10) -> int:
    cur.execute(
        """SELECT started_at, finished_at, ok, exit_code, duration_s, tail
             FROM raw.cron_runs WHERE job = %s ORDER BY started_at DESC LIMIT %s""",
        (job, limit),
    )
    rows = cur.fetchall()
    if not rows:
        print(f"(sin corridas registradas para '{job}')")
        return 0
    print(f"Últimas {len(rows)} corridas de '{job}':")
    for started, finished, ok, code, dur, tail in rows:
        st = "RUNNING" if finished is None else ("OK" if ok else "FALLÓ")
        d = f"{dur:.0f}s" if dur is not None else "—"
        print(f"  {started:%Y-%m-%d %H:%M}  {st:<7} exit={code} dur={d}")
    print(f"\n--- tail del último run ---\n{(rows[0][5] or '(sin salida)').rstrip()}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Estado de los jobs de cron (raw.cron_runs)")
    p.add_argument("--fails", action="store_true", help="solo fallas + zombies, con tail")
    p.add_argument("--job", help="historial + tail de un job específico")
    p.add_argument("--hours", type=float, default=48, help="ventana del resumen (default 48)")
    p.add_argument("--zombie-hours", type=float, default=6,
                   help="run sin terminar más viejo que esto = ZOMBIE (default 6)")
    args = p.parse_args()

    url = os.getenv("DATABASE_URL")
    if not url:
        print("falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('raw.cron_runs')")
            if cur.fetchone()[0] is None:
                print("raw.cron_runs no existe aún (¿migración 0122 no aplicada?)")
                return 2
            if args.job:
                return one_job(cur, args.job)
            if args.fails:
                return fails(cur, args.hours, args.zombie_hours)
            return summary(cur, args.hours, args.zombie_hours)
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
