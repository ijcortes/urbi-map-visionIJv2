"""Cron: reasigna leads cuyos agentes no respondieron a tiempo (#23 penalización).

Devuelve al pool los intakes 'asignado' que el realtar no aceptó en
ASIGNADO_TIMEOUT_HORAS (24h). Antes el sweep solo corría al leer el pool (lazy);
ahora proactivo vía cron (Dockerfile.cron, horario) para que un lead no se atasque
con un agente lento aunque nadie lea el pool.
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()


async def main() -> None:
    import asyncpg
    from api.services.asignador_service import sweep_asignados_vencidos

    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=2)
    try:
        n = await sweep_asignados_vencidos(pool)
        print(f"sweep_asignados: {n} intake(s) devuelto(s) al pool")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
