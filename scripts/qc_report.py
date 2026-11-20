"""QC de scrapers + validación → email cada 3 días a ADMIN_EMAIL.

Reporta:
  1. Si cada job corrió a tiempo (STALE = no corrió / se rompió).
  2. Si la validación de URLs corrió y cuántos muertos limpió en los últimos 3 días.
  3. Backlog pendiente + total de muertos ocultos.
  4. Cobertura de fotos por fuente (lo que ve el mapa).

Corre en social-cron (crontab). Email vía api.utils.email (Gmail API u SMTP).
  -> Para que REALMENTE envíe, el env de social-cron necesita SMTP_USER + SMTP_PASS
     (app password de Gmail) o las creds de Gmail API. Sin eso, api.utils.email imprime
     "[EMAIL STUB]" (visible en /var/log/qc.log) pero no manda.

Uso:
  python scripts/qc_report.py            # genera reporte, lo imprime y lo manda por correo
  python scripts/qc_report.py --no-email # solo imprime (para probar sin mandar)
  python scripts/qc_report.py --selftest # chequeo de la lógica de veredicto
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone

# Repo root al path: al correr `python3 scripts/qc_report.py`, sys.path[0] es scripts/,
# no el root -> `import api` fallaría. Meter el directorio padre (/app en el cron).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

# (etiqueta, SQL que devuelve UN timestamp, cadencia legible, horas_max_sin_correr)
_FRESHNESS = [
    ("Scrape fincaraiz",      "SELECT max(fecha_scraping) FROM raw.listings_fincaraiz",       "diario 03:00 UTC", 30),
    ("Scrape metrocuadrado",  "SELECT max(fecha_scraping) FROM raw.listings_metrocuadrado",   "c/3d 08:00 UTC",   96),
    ("Scrape renta corta",    "SELECT max(fecha_scraping) FROM raw.listings_renta_media",     "c/3d 09:00 UTC",   96),
    ("Validación de URLs",    "SELECT max(url_validada_at) FROM (SELECT url_validada_at FROM raw.listings_fincaraiz "
                              "UNION ALL SELECT url_validada_at FROM raw.listings_metrocuadrado) z", "diario 04:00 UTC", 30),
    ("Comunidad noticias/eventos", "SELECT max(created_at) FROM (SELECT created_at FROM noticias "
                              "UNION ALL SELECT created_at FROM eventos) z", "c/6h", 10),
]


def _age_hours(ts, now: datetime):
    """Horas desde ts hasta now; None si ts es None."""
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (now - ts).total_seconds() / 3600.0


def _verdict(age_hours, max_hours) -> str:
    """OK solo si corrió dentro de su ventana. None (nunca) o viejo => STALE."""
    return "OK" if (age_hours is not None and age_hours <= max_hours) else "STALE"


def _gather(engine) -> dict:
    now = datetime.now(timezone.utc)
    out = {"now": now, "freshness": [], "alerts": 0}
    with engine.connect() as conn:
        for label, sql, cadence, max_h in _FRESHNESS:
            ts = conn.execute(text(sql)).scalar()
            age = _age_hours(ts, now)
            v = _verdict(age, max_h)
            if v == "STALE":
                out["alerts"] += 1
            out["freshness"].append({"label": label, "ts": ts, "age": age, "cadence": cadence, "verdict": v})

        out["validados_3d"] = conn.execute(text(
            "SELECT count(*) FROM (SELECT url_validada_at FROM raw.listings_fincaraiz WHERE url_validada_at > now()-interval '3 days' "
            "UNION ALL SELECT url_validada_at FROM raw.listings_metrocuadrado WHERE url_validada_at > now()-interval '3 days') z"
        )).scalar()
        out["muertos_3d"] = conn.execute(text(
            "SELECT count(*) FROM (SELECT 1 FROM raw.listings_fincaraiz WHERE url_activa IS FALSE AND url_validada_at > now()-interval '3 days' "
            "UNION ALL SELECT 1 FROM raw.listings_metrocuadrado WHERE url_activa IS FALSE AND url_validada_at > now()-interval '3 days') z"
        )).scalar()

        out["fuentes"] = []
        for fuente, tabla in (("fincaraiz", "raw.listings_fincaraiz"), ("metrocuadrado", "raw.listings_metrocuadrado")):
            row = conn.execute(text(
                f"SELECT count(*) FILTER (WHERE url_activa IS FALSE), "
                f"count(*) FILTER (WHERE activo AND (url_validada_at IS NULL OR url_validada_at < now()-interval '7 days')) "
                f"FROM {tabla}"
            )).fetchone()
            out["fuentes"].append({"fuente": fuente, "muertos_ocultos": row[0], "backlog": row[1]})

        out["fotos"] = conn.execute(text(
            "SELECT fuente, count(*), count(*) FILTER (WHERE fotos IS NULL OR array_length(fotos,1) IS NULL) "
            "FROM staging.stg_listings_unificado GROUP BY fuente ORDER BY count(*) DESC"
        )).fetchall()

    # Alerta extra: la validación no limpió NADA en 3 días (corrió en seco o no corrió).
    if out["validados_3d"] == 0:
        out["alerts"] += 1
    return out


def _fmt_ts(ts) -> str:
    return ts.strftime("%Y-%m-%d %H:%M UTC") if ts else "—NUNCA—"


def render_html(d: dict) -> str:
    from api.utils.email import _wrap

    def badge(v):
        color = "#1D9E75" if v == "OK" else "#D85A30"
        return f'<span style="color:{color};font-weight:700">{v}</span>'

    fresh_rows = "".join(
        f'<tr><td style="padding:6px">{f["label"]}</td>'
        f'<td style="padding:6px;color:#62736d">{f["cadence"]}</td>'
        f'<td style="padding:6px">{_fmt_ts(f["ts"])}</td>'
        f'<td style="padding:6px">{badge(f["verdict"])}</td></tr>'
        for f in d["freshness"]
    )
    fuente_rows = "".join(
        f'<tr><td style="padding:6px">{x["fuente"]}</td>'
        f'<td style="padding:6px;text-align:right">{x["muertos_ocultos"]:,}</td>'
        f'<td style="padding:6px;text-align:right">{x["backlog"]:,}</td></tr>'
        for x in d["fuentes"]
    )
    foto_rows = "".join(
        f'<tr><td style="padding:6px">{r[0]}</td>'
        f'<td style="padding:6px;text-align:right">{r[1]:,}</td>'
        f'<td style="padding:6px;text-align:right">{(100.0*(r[1]-r[2])/r[1] if r[1] else 0):.0f}%</td></tr>'
        for r in d["fotos"]
    )
    head = ("✅ Todos los jobs corrieron" if d["alerts"] == 0
            else f'⚠️ {d["alerts"]} alerta(s) — revisar abajo')
    head_color = "#1D9E75" if d["alerts"] == 0 else "#D85A30"

    return _wrap(f"""
      <h3 style="color:{head_color}">QC scrapers — {head}</h3>
      <p style="color:#62736d;font-size:13px">Generado {d["now"].strftime("%Y-%m-%d %H:%M UTC")} · cada 3 días</p>

      <h4 style="color:#085041;margin-bottom:4px">1. ¿Corrió cada job?</h4>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="color:#62736d;text-align:left"><th style="padding:6px">Job</th><th style="padding:6px">Cadencia</th><th style="padding:6px">Último</th><th style="padding:6px">Estado</th></tr>
        {fresh_rows}
      </table>

      <h4 style="color:#085041;margin-bottom:4px;margin-top:20px">2. Validación / limpieza (últimos 3 días)</h4>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px;color:#62736d">URLs validadas</td><td style="padding:6px;font-weight:600">{d["validados_3d"]:,}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Muertos nuevos ocultados</td><td style="padding:6px;font-weight:600">{d["muertos_3d"]:,}</td></tr>
      </table>

      <h4 style="color:#085041;margin-bottom:4px;margin-top:20px">3. Estado por fuente</h4>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="color:#62736d;text-align:left"><th style="padding:6px">Fuente</th><th style="padding:6px;text-align:right">Muertos ocultos</th><th style="padding:6px;text-align:right">Backlog pendiente</th></tr>
        {fuente_rows}
      </table>

      <h4 style="color:#085041;margin-bottom:4px;margin-top:20px">4. Fotos en el mapa</h4>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="color:#62736d;text-align:left"><th style="padding:6px">Fuente</th><th style="padding:6px;text-align:right">Servidos</th><th style="padding:6px;text-align:right">% con foto</th></tr>
        {foto_rows}
      </table>

      <p style="margin-top:16px;color:#62736d;font-size:12px">
        Backlog debe BAJAR cada reporte. Si un job sale STALE, revisar logs en Railway (social-cron).
      </p>
    """)


def render_text(d: dict) -> str:
    lines = [f"QC scrapers — {d['now'].strftime('%Y-%m-%d %H:%M UTC')} — alertas: {d['alerts']}", ""]
    lines.append("1. FRESCURA DE JOBS")
    for f in d["freshness"]:
        lines.append(f"  [{f['verdict']:>5}] {f['label']:<28} ({f['cadence']}) último {_fmt_ts(f['ts'])}")
    lines.append("")
    lines.append(f"2. VALIDACION 3d: {d['validados_3d']:,} URLs validadas, {d['muertos_3d']:,} muertos nuevos ocultados")
    lines.append("3. POR FUENTE:")
    for x in d["fuentes"]:
        lines.append(f"  {x['fuente']:<14} muertos_ocultos={x['muertos_ocultos']:,}  backlog={x['backlog']:,}")
    lines.append("4. FOTOS:")
    for r in d["fotos"]:
        pct = 100.0 * (r[1] - r[2]) / r[1] if r[1] else 0
        lines.append(f"  {r[0]:<16} servidos={r[1]:,}  con_foto={pct:.0f}%")
    return "\n".join(lines)


async def main(send: bool) -> int:
    engine = create_engine(os.environ["DATABASE_URL"])
    d = _gather(engine)

    print(render_text(d), flush=True)  # queda en /var/log/qc.log

    if send:
        from api.utils.email import send_email, ADMIN_EMAIL
        subject = ("[QC Medellín Social] ✅ Todo OK" if d["alerts"] == 0
                   else f"[QC Medellín Social] ⚠️ {d['alerts']} alerta(s)")
        subject += f" — {d['now'].strftime('%Y-%m-%d')}"
        await send_email(ADMIN_EMAIL, subject, render_html(d))
        # Decir la verdad en el log: send_email cae a un stub silencioso si no hay transporte.
        smtp_ok = bool(os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))
        try:
            from api.utils.gmail_api import is_configured
            gmail_ok = is_configured()
        except Exception:
            gmail_ok = False
        if smtp_ok or gmail_ok:
            print(f"[qc] email ENVIADO a {ADMIN_EMAIL}", flush=True)
        else:
            print(f"[qc] ⚠️ NO enviado — falta SMTP_USER/SMTP_PASS (o Gmail API) en el env. "
                  f"Solo se imprimió el stub. Setear esas vars en social-cron.", flush=True)

    # exit code != 0 si hay alertas -> visible también en monitoreo de cron
    return 1 if d["alerts"] else 0


def _selftest() -> None:
    assert _verdict(5, 30) == "OK"
    assert _verdict(40, 30) == "STALE"
    assert _verdict(None, 30) == "STALE"          # nunca corrió
    assert _verdict(96, 96) == "OK"               # justo en el borde
    assert _verdict(96.1, 96) == "STALE"
    now = datetime(2026, 1, 2, tzinfo=timezone.utc)
    assert _age_hours(None, now) is None
    assert abs(_age_hours(datetime(2026, 1, 1, tzinfo=timezone.utc), now) - 24.0) < 0.01
    # naive timestamp (como los devuelve psycopg a veces) se trata como UTC, no crashea
    assert abs(_age_hours(datetime(2026, 1, 1), now) - 24.0) < 0.01
    print("selftest OK")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="QC report scrapers -> email")
    p.add_argument("--no-email", action="store_true", help="solo imprime, no manda correo")
    p.add_argument("--selftest", action="store_true", help="chequea la lógica de veredicto y sale")
    args = p.parse_args()
    if args.selftest:
        _selftest()
        sys.exit(0)
    sys.exit(asyncio.run(main(send=not args.no_email)))
