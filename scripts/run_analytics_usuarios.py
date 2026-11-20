"""
Crea partición user_events del mes siguiente + recalcula user_interests.
Puerto de airflow/dags/analytics_usuarios.py — SQL puro vía asyncpg, sin
dependencias externas a ~/urbi.

Run: python scripts/run_analytics_usuarios.py
"""
import asyncio
import os
import sys

import asyncpg

DATABASE_URL = os.environ["DATABASE_URL"]

_CALCULAR_INTERESTS_SQL = """
INSERT INTO public.user_interests (
    usuario_id, top_barrios, inversion_preferida, tipo_inmueble_top,
    categorias_eventos_top, categorias_tiendas_top, total_sesiones, total_eventos, dias_activo,
    ultimo_activo, engagement_score, inversion_intent_score, updated_at
)
SELECT
    ue.usuario_id,
    ARRAY(
        SELECT barrio_id::integer
        FROM public.user_events sub
        WHERE sub.usuario_id = ue.usuario_id
          AND sub.barrio_id IS NOT NULL
          AND sub.created_at > NOW() - INTERVAL '30 days'
        GROUP BY barrio_id ORDER BY COUNT(*) DESC LIMIT 5
    ) AS top_barrios,
    (
        SELECT metadata->>'tipo_inversion'
        FROM public.user_events sub
        WHERE sub.usuario_id = ue.usuario_id
          AND sub.event_type = 'simulator_run'
          AND sub.created_at > NOW() - INTERVAL '30 days'
        GROUP BY metadata->>'tipo_inversion' ORDER BY COUNT(*) DESC LIMIT 1
    ) AS inversion_preferida,
    (
        SELECT metadata->>'tipo_inmueble'
        FROM public.user_events sub
        WHERE sub.usuario_id = ue.usuario_id
          AND sub.created_at > NOW() - INTERVAL '30 days'
        GROUP BY metadata->>'tipo_inmueble' ORDER BY COUNT(*) DESC LIMIT 1
    ) AS tipo_inmueble_top,
    ARRAY(
        SELECT metadata->>'categoria'
        FROM public.user_events sub
        WHERE sub.usuario_id = ue.usuario_id
          AND sub.event_type LIKE 'evento_%'
          AND sub.created_at > NOW() - INTERVAL '30 days'
        GROUP BY metadata->>'categoria' ORDER BY COUNT(*) DESC LIMIT 3
    ) AS categorias_eventos_top,
    ARRAY(
        SELECT metadata->>'categoria'
        FROM public.user_events sub
        WHERE sub.usuario_id = ue.usuario_id
          AND sub.event_type LIKE 'negocio_%'
          AND sub.metadata->>'categoria' IS NOT NULL
          AND sub.created_at > NOW() - INTERVAL '30 days'
        GROUP BY metadata->>'categoria' ORDER BY COUNT(*) DESC LIMIT 3
    ) AS categorias_tiendas_top,
    COUNT(DISTINCT us.id) AS total_sesiones,
    COUNT(ue.id) AS total_eventos,
    COUNT(DISTINCT DATE(ue.created_at)) AS dias_activo,
    MAX(ue.created_at) AS ultimo_activo,
    LEAST(100, (
        COUNT(DISTINCT DATE(ue.created_at)) * 5
        + COUNT(DISTINCT us.id) * 2
        + COUNT(ue.id)
    )) AS engagement_score,
    LEAST(100, (
        COUNT(CASE WHEN ue.event_type = 'simulator_run' THEN 1 END) * 10
        + COUNT(CASE WHEN ue.event_type = 'barrio_panel_open' THEN 1 END) * 2
    )) AS inversion_intent_score,
    NOW() AS updated_at
FROM public.user_events ue
LEFT JOIN public.user_sessions us ON us.usuario_id = ue.usuario_id
WHERE ue.usuario_id IS NOT NULL
  AND ue.created_at > NOW() - INTERVAL '90 days'
GROUP BY ue.usuario_id
ON CONFLICT (usuario_id) DO UPDATE SET
    top_barrios = EXCLUDED.top_barrios,
    inversion_preferida = EXCLUDED.inversion_preferida,
    tipo_inmueble_top = EXCLUDED.tipo_inmueble_top,
    categorias_eventos_top = EXCLUDED.categorias_eventos_top,
    categorias_tiendas_top = EXCLUDED.categorias_tiendas_top,
    total_sesiones = EXCLUDED.total_sesiones,
    total_eventos = EXCLUDED.total_eventos,
    dias_activo = EXCLUDED.dias_activo,
    ultimo_activo = EXCLUDED.ultimo_activo,
    engagement_score = EXCLUDED.engagement_score,
    inversion_intent_score = EXCLUDED.inversion_intent_score,
    updated_at = NOW()
"""


async def _run() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        print("[analytics_usuarios] START crear_particion", flush=True)
        await conn.execute("SELECT create_user_events_partition()")
        print("[analytics_usuarios] OK    crear_particion", flush=True)

        print("[analytics_usuarios] START calcular_interests", flush=True)
        await conn.execute(_CALCULAR_INTERESTS_SQL)
        print("[analytics_usuarios] OK    calcular_interests", flush=True)
    finally:
        await conn.close()


if __name__ == "__main__":
    try:
        asyncio.run(_run())
    except Exception as exc:
        print(f"[analytics_usuarios] FAIL {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
