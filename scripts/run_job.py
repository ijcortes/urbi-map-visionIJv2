"""Wrapper que envuelve CADA job de cron. Convierte fallas silenciosas en fallas
visibles, guardadas y notificadas.

Antes: `python3 scripts/X.py >> /var/log/urbi/X.log 2>&1`. El log vive en un
archivo dentro del contenedor efímero (se pierde al redeploy, Railway no lo ve) y
si el script revienta, el exit code se traga en el archivo — nadie se entera.

Ahora: `python3 scripts/run_job.py <nombre> python3 scripts/X.py`. Este wrapper:
  1. Corre el comando y reemite su salida (sigue yendo al logfile por el redirect
     del crontab, para `railway logs`/exec mientras el contenedor vive).
  2. Graba el resultado en raw.cron_runs (inicio, fin, duración, exit, ok, tail).
     ESE es el almacén durable y consultable — sobrevive restarts, a diferencia
     del archivo. Fila de inicio primero → un job colgado/OOM queda como
     started_at con finished_at NULL (zombie visible).
  3. Si el exit != 0 (crash O "encontré problemas", p.ej. qc_report/data_quality
     salen 1 a propósito) → alerta por Sentry (único canal vivo hoy en social-cron)
     y webhook si está configurado, con las últimas líneas de salida.
  4. Si NO hay canal de alerta configurado, lo grita en el log (no falla en
     silencio — es justo el bug que arregla).

La instrumentación NUNCA rompe el job: todo lo de DB/alerta va en try/except y el
exit code que propaga es siempre el del comando hijo.

Uso (en crontab):
    python3 scripts/run_job.py <nombre_job> <cmd> [args...]
    p.ej.  python3 scripts/run_job.py refresh python3 scripts/refresh_data.py

ponytail: sin timeout por-job — los scrapers pesados (metrocuadrado) corren horas
y un tope global los mataría. Un cuelgue se ve igual en el ledger (finished_at
NULL). Agregar timeout por-job si algún cuelgue real aparece.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from collections import deque

_TAIL_LINES = 50


def _db():
    """Conexión psycopg2 o None si no se puede (instrumentación nunca rompe job)."""
    url = os.getenv("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg2
        return psycopg2.connect(url)
    except Exception as e:
        print(f"[run_job] aviso: sin ledger DB ({e})", file=sys.stderr, flush=True)
        return None


# Conexión FRESCA por operación (start y finish): un job largo (metrocuadrado,
# scrapers de horas) dejaría una conexión idle que el proxy de Railway puede
# cortar → el UPDATE de finish fallaría y un job EXITOSO quedaría como zombie
# (finished_at NULL). Abrir y cerrar en cada llamada evita eso.
def _ledger_start(job: str) -> int | None:
    conn = _db()
    if conn is None:
        return None
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO raw.cron_runs (job, host_env) VALUES (%s, %s) RETURNING id",
                (job, os.getenv("RAILWAY_ENVIRONMENT_NAME") or os.getenv("RAILWAY_ENVIRONMENT")),
            )
            return cur.fetchone()[0]
    except Exception as e:
        print(f"[run_job] aviso: ledger start falló ({e})", file=sys.stderr, flush=True)
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _ledger_finish(run_id, code: int, dur: float, tail: str) -> None:
    if run_id is None:
        return
    conn = _db()
    if conn is None:
        return
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE raw.cron_runs SET finished_at = now(), duration_s = %s, "
                "exit_code = %s, ok = %s, tail = %s WHERE id = %s",
                (dur, code, code == 0, tail, run_id),
            )
    except Exception as e:
        print(f"[run_job] aviso: ledger finish falló ({e})", file=sys.stderr, flush=True)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _notify(subject: str, body: str) -> None:
    """Sentry (vivo hoy) + webhook (si está). Grita si no hay ningún canal."""
    sent = False
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if dsn:
        try:
            import sentry_sdk
            sentry_sdk.init(dsn=dsn, environment=os.getenv("RAILWAY_ENVIRONMENT", "production"))
            sentry_sdk.capture_message(f"{subject}\n{body}", level="error")
            sentry_sdk.flush(timeout=5)
            sent = True
        except Exception as e:
            print(f"[run_job] Sentry falló: {e}", file=sys.stderr, flush=True)
    hook = os.getenv("DATA_QUALITY_ALERT_WEBHOOK", "").strip()
    if hook:
        try:
            req = urllib.request.Request(
                hook, data=json.dumps({"text": f"{subject}\n{body}"}).encode(),
                headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10)
            sent = True
        except Exception as e:
            print(f"[run_job] webhook falló: {e}", file=sys.stderr, flush=True)
    if not sent:
        # No fallar en silencio: si no hay canal, al menos que el log lo diga fuerte.
        print(f"[run_job] ⚠️ SIN CANAL DE ALERTA (ni SENTRY_DSN ni "
              f"DATA_QUALITY_ALERT_WEBHOOK) — alerta NO enviada:\n{subject}",
              file=sys.stderr, flush=True)


def run(job: str, cmd: list[str]) -> int:
    run_id = _ledger_start(job)
    tail: deque[str] = deque(maxlen=_TAIL_LINES)
    t0 = time.monotonic()
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
    except Exception as e:
        # El comando ni arrancó (binario no existe, etc.) — es una falla real.
        line = f"[run_job] no se pudo ejecutar {cmd!r}: {e}\n"
        print(line, end="", flush=True)
        tail.append(line)
        _ledger_finish(run_id, 127, time.monotonic() - t0, "".join(tail))
        _notify(f"[cron] {job} NO ARRANCÓ", "".join(tail))
        return 127

    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)   # → logfile del crontab (full log mientras viva el contenedor)
        sys.stdout.flush()
        tail.append(line)
    code = proc.wait()
    dur = time.monotonic() - t0
    tail_str = "".join(tail)

    _ledger_finish(run_id, code, dur, tail_str)
    if code != 0:
        _notify(f"[cron] {job} FALLÓ exit={code} en {dur:.0f}s",
                f"--- últimas {len(tail)} líneas ---\n{tail_str}")
    else:
        print(f"[run_job] {job} OK en {dur:.0f}s", flush=True)
    return code


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("uso: python3 scripts/run_job.py <nombre_job> <cmd> [args...]", file=sys.stderr)
        sys.exit(2)
    sys.exit(run(sys.argv[1], sys.argv[2:]))
