"""
Nightly data-quality check for the listing sources (freshness, volume, photos,
plausibility). Failures used to exist only in log files nobody read.

Per source it records a snapshot in raw.data_quality_runs and raises a problem when
  * the newest scrape is older than FRESHNESS_HOURS (default 48),
  * active rows dropped more than VOLUME_DROP_PCT (default 30 %) since the last snapshot,
  * more than NO_PHOTO_MAX_PCT (default 40 %) of active rows have no photos.
Implausible rows (outside the serving bounds) are counted for trend, not alerted.

Alerts: Sentry (SENTRY_DSN) and/or a Slack-compatible webhook
(DATA_QUALITY_ALERT_WEBHOOK). Exit 1 when any problem was found so the cron
runner marks the step failed.

Run: python scripts/data_quality_check.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

import psycopg2

FRESHNESS_HOURS = float(os.getenv("FRESHNESS_HOURS", "48"))
VOLUME_DROP_PCT = float(os.getenv("VOLUME_DROP_PCT", "30"))
NO_PHOTO_MAX_PCT = float(os.getenv("NO_PHOTO_MAX_PCT", "40"))

SOURCES = {
    "metrocuadrado": ("raw.listings_metrocuadrado", "precio", "tipo_operacion"),
    "fincaraiz": ("raw.listings_fincaraiz", "precio", "tipo_operacion"),
    "habi": ("raw.listings_habi", "precio", "'venta'"),
}

# Same bounds as api/cache.py _PLAUSIBLE (serving filter).
_IMPLAUSIBLE = """
    area_m2 > 0 AND (
        area_m2 < 8
        OR area_m2 > CASE WHEN lower(tipo_inmueble) ~ '^(lote|terreno|finca|bodega)' THEN 5000000 ELSE 20000 END
        OR (lower(tipo_inmueble) !~ '^(lote|terreno|finca)' AND (
               (lower({op}) LIKE 'venta%%' AND {precio} / area_m2 NOT BETWEEN 300000 AND 60000000)
            OR (lower({op}) LIKE 'arriendo%%' AND {precio} / area_m2 NOT BETWEEN 2000 AND 400000)))
    )
"""


def _alert(text: str) -> None:
    hook = os.getenv("DATA_QUALITY_ALERT_WEBHOOK", "").strip()
    if hook:
        try:
            req = urllib.request.Request(hook, data=json.dumps({"text": text}).encode(),
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            print(f"[dq] webhook failed: {e}", file=sys.stderr)
    dsn = os.getenv("SENTRY_DSN", "")
    if dsn:
        try:
            import sentry_sdk
            sentry_sdk.init(dsn=dsn, environment=os.getenv("RAILWAY_ENVIRONMENT", "production"))
            sentry_sdk.capture_message(text, level="error")
            sentry_sdk.flush(timeout=5)
        except Exception:
            pass


def check(cur, fuente: str, table: str, precio: str, op: str) -> list[str]:
    cur.execute(f"""
        SELECT COUNT(*) FILTER (WHERE activo),
               MAX(COALESCE(last_seen_at, fecha_scraping)),
               EXTRACT(EPOCH FROM NOW() - MAX(COALESCE(last_seen_at, fecha_scraping))) / 3600.0,
               100.0 * COUNT(*) FILTER (WHERE activo AND COALESCE(array_length(fotos, 1), 0) = 0)
                     / NULLIF(COUNT(*) FILTER (WHERE activo), 0),
               COUNT(*) FILTER (WHERE activo AND {_IMPLAUSIBLE.format(op=op, precio=precio)})
          FROM {table}
    """)
    activos, ultimo, age_h, sin_fotos, implausibles = cur.fetchone()
    cur.execute("SELECT activos FROM raw.data_quality_runs WHERE fuente = %s ORDER BY run_at DESC LIMIT 1",
                (fuente,))
    prev = cur.fetchone()
    problems = []
    if age_h is None or age_h > FRESHNESS_HOURS:
        problems.append(f"sin scrape hace {age_h or 0:.0f} h (> {FRESHNESS_HOURS:.0f} h)")
    if prev and prev[0] and activos is not None and activos < prev[0] * (1 - VOLUME_DROP_PCT / 100):
        problems.append(f"activos {prev[0]} -> {activos} (caída > {VOLUME_DROP_PCT:.0f} %)")
    if sin_fotos is not None and float(sin_fotos) > NO_PHOTO_MAX_PCT:
        problems.append(f"{float(sin_fotos):.0f} % sin fotos (> {NO_PHOTO_MAX_PCT:.0f} %)")
    cur.execute(
        """INSERT INTO raw.data_quality_runs (fuente, activos, ultimo_scrape, sin_fotos_pct, implausibles, problemas)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (fuente, activos, ultimo, sin_fotos, implausibles, problems or None),
    )
    print(f"[dq] {fuente}: activos={activos} ultimo={ultimo} sin_fotos={sin_fotos and round(float(sin_fotos), 1)}% "
          f"implausibles={implausibles} problemas={problems or 'ninguno'}")
    return problems


def main() -> int:
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    all_problems = []
    try:
        for fuente, (table, precio, op) in SOURCES.items():
            with conn, conn.cursor() as cur:
                cur.execute("SELECT to_regclass(%s)", (table,))
                if cur.fetchone()[0] is None:
                    continue
                all_problems += [f"{fuente}: {p}" for p in check(cur, fuente, table, precio, op)]
    finally:
        conn.close()
    if all_problems:
        _alert("Medellín Social — calidad de datos:\n" + "\n".join(f"• {p}" for p in all_problems))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
