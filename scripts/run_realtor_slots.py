"""Mantenimiento diario de Realtor Preferido (cron, un solo job para evitar carreras):
vence slots → siembra 1 preferido gratis por barrio → sincroniza agent.tier → avisa por vencer.

Run: python scripts/run_realtor_slots.py
"""
import asyncio
import logging
import os
import sys

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api.services import realtor_preferido_service as svc  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("realtor_slots")


async def _avisar(filas) -> int:
    from api.utils.email import esc, send_email
    app_url = os.getenv("APP_URL", "https://medellin.social")
    ok = 0
    for r in filas:
        try:
            await send_email(
                r["email"], "Tu lugar de Realtor Preferido vence pronto",
                f"<h3 style='color:#1D9E75'>Tu lugar preferido vence el {r['fecha_fin']}</h3>"
                f"<p>Hola {esc(r['nombre'])}, tu slot en la zona {esc(r['zona_codigo'])} ({esc(r['zona_nivel'])}) "
                f"vence pronto. Renuévalo para no perder tu posición.</p>"
                f"<p><a href='{app_url}/planes/featured-realtor'>Renovar →</a></p>")
            ok += 1
        except Exception:
            log.exception("aviso a %s falló", r["email"])
    return ok


async def main() -> int:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        vencidos = await svc.vencer_slots(conn)
        seed = await svc.seed_gratis(conn)
        tiers = await svc.sincronizar_tier(conn)
        avisos = await svc.por_vencer(conn)
        enviados = await _avisar(avisos)
        log.info("vencidos=%s seed=%s tiers=%s avisos=%s/%s", vencidos, seed, tiers, enviados, len(avisos))
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
