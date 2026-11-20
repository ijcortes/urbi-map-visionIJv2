"""Cron de notificación de alertas de precio (#4).

Por cada alerta ACTIVA, busca listings NUEVOS desde la última corrida que matcheen
el criterio guardado (barrio + tipo_operacion + tipo_inmueble + precio <= precio_max)
y le manda un email al usuario con los nuevos. Marca ultima_notificacion = now()
para no re-notificar. Canal = api.utils.email (Gmail API / SMTP; stub si no hay creds).

Pensado para correr 1×/día (cron / Airflow). Una notificación por alerta con match.

  python scripts/alertas_notificar.py             # envía (prod/cron)
  python scripts/alertas_notificar.py --dry-run   # consulta la DB, imprime, NO envía
  python scripts/alertas_notificar.py --self-check # test offline del armado de email, sin DB
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

# el script importa api.utils.email → el repo root debe estar en sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

# Listings nuevos (fecha_scraping posterior a la última notificación, o a la
# creación de la alerta si nunca se notificó) que cumplen el criterio y están al
# precio tope o por debajo. Sanity de precio para no colar valores basura.
_MATCH_SQL = """
SELECT a.id AS alerta_id, a.usuario_id, u.email, COALESCE(u.nombre, '') AS nombre,
       b.nombre AS barrio_nombre, a.tipo_operacion, a.precio_max,
       l.precio_cop, l.area_m2, l.habitaciones,
       ('x'||substr(md5(l.url),1,8))::bit(32)::int AS listing_id
FROM public.alertas_precio a
JOIN public.usuarios u ON u.id = a.usuario_id
JOIN raw.barrios b ON b.id = a.barrio_id
JOIN staging.stg_listings_unificado l
  ON l.barrio_id = a.barrio_id
 AND l.tipo_operacion = a.tipo_operacion
 AND (a.tipo_inmueble IS NULL OR l.tipo_inmueble IS NOT DISTINCT FROM a.tipo_inmueble)
 AND l.precio_cop > 0
 AND (a.precio_max IS NULL OR l.precio_cop <= a.precio_max)
 AND l.fecha_scraping > COALESCE(a.ultima_notificacion, a.fecha_creacion)
 AND l.url IS NOT NULL
WHERE a.activa IS TRUE AND u.email IS NOT NULL
ORDER BY a.id, l.precio_cop
LIMIT 5000
"""


def _fmt_cop(v: int | float | None) -> str:
    return "$" + f"{int(v):,}".replace(",", ".") if v is not None else "—"


def _build_email(nombre: str, barrio: str, tipo_op: str, listings: list[dict], site_url: str) -> str:
    """HTML del email con los nuevos matches. Importa el wrapper del backend."""
    from api.utils.email import _wrap, esc
    filas = ""
    for l in listings[:20]:
        link = f"{site_url}/map?listing={l['listing_id']}"
        specs = " · ".join(filter(None, [
            f"{l['area_m2']:.0f} m²" if l.get("area_m2") else "",
            f"{l['habitaciones']} hab" if l.get("habitaciones") and l["habitaciones"] > 0 else "",
        ]))
        filas += (
            f'<tr><td style="padding:8px 0;border-bottom:1px solid #eee">'
            f'<a href="{esc(link)}" style="color:#1D9E75;font-weight:600;text-decoration:none">{_fmt_cop(l["precio_cop"])}</a>'
            f'<span style="color:#777"> &nbsp;{esc(specs)}</span></td></tr>'
        )
    body = (
        f"<p>Hola {esc(nombre) or 'vecino'},</p>"
        f"<p>Nuevos inmuebles en <strong>{esc(barrio)}</strong> ({esc(tipo_op)}) dentro de tu alerta de precio:</p>"
        f'<table style="width:100%;border-collapse:collapse">{filas}</table>'
        f'<p style="margin-top:16px;font-size:12px;color:#999">Recibís esto porque creaste una alerta. '
        f'Podés gestionarla en tu perfil.</p>'
    )
    return _wrap(body)


async def run(dry_run: bool = False) -> int:
    import asyncpg
    site_url = os.getenv("SITE_URL") or os.getenv("VITE_SITE_URL") or "https://www.medellinsocial.com"
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        rows = await conn.fetch(_MATCH_SQL)
        # agrupar por alerta
        por_alerta: dict[int, dict] = {}
        for r in rows:
            d = por_alerta.setdefault(r["alerta_id"], {"meta": r, "listings": []})
            d["listings"].append(dict(r))
        print(f"{len(por_alerta)} alertas con matches nuevos ({len(rows)} listings)")
        if not dry_run:
            from api.utils.email import send_email
        enviados = 0
        for alerta_id, d in por_alerta.items():
            m = d["meta"]
            html = _build_email(m["nombre"], m["barrio_nombre"], m["tipo_operacion"], d["listings"], site_url)
            subject = f"{len(d['listings'])} inmueble(s) nuevo(s) en {m['barrio_nombre']} — Medellín Social"
            if dry_run:
                print(f"  [DRY] alerta {alerta_id} -> {m['email']}: {len(d['listings'])} listings | {subject}")
            else:
                await send_email(m["email"], subject, html)
                await conn.execute("UPDATE public.alertas_precio SET ultima_notificacion = now() WHERE id = $1", alerta_id)
                enviados += 1
        return enviados if not dry_run else len(por_alerta)
    finally:
        await conn.close()


def self_check() -> None:
    """Arma un email con filas falsas — valida el template sin DB ni red."""
    html = _build_email(
        "Ana", "El Poblado", "venta",
        [{"listing_id": -123, "precio_cop": 450000000, "area_m2": 72.0, "habitaciones": 3},
         {"listing_id": -456, "precio_cop": 390000000, "area_m2": 60.0, "habitaciones": 2}],
        "https://x.test",
    )
    assert "El Poblado" in html and "$450.000.000" in html and "/map?listing=-123" in html, "template mal armado"
    assert "72 m²" in html and "3 hab" in html, "specs mal"
    print("self-check OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        self_check()
    else:
        n = asyncio.run(run(dry_run=args.dry_run))
        print(f"{'(dry) ' if args.dry_run else ''}alertas procesadas: {n}")
