"""
DAG: analytics_usuarios
Tasks:
  t1 — crear partición user_events del mes siguiente (corre día 25 a las 2am COT)
  t2 — calcular user_interests (corre cada noche a las 2am COT)
Schedule: 0 7 * * * (2:00 AM COT = 7:00 UTC)
"""
import os
import sys
from datetime import datetime, timedelta

import asyncpg
from airflow import DAG

from _schedule import cron_or_none as _sched
from airflow.operators.python import PythonOperator

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

DATABASE_URL = os.getenv("DATABASE_URL", "")

default_args = {
    "owner": "social",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "email_on_failure": False,
}


def crear_particion(**kwargs):
    import asyncio

    async def _run():
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            await conn.execute("SELECT create_user_events_partition()")
        finally:
            await conn.close()

    asyncio.run(_run())


def calcular_interests(**kwargs):
    import asyncio

    async def _run():
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            await conn.execute("""
                INSERT INTO public.user_interests (
                    usuario_id,
                    top_barrios,
                    inversion_preferida,
                    tipo_inmueble_top,
                    categorias_eventos_top,
                    total_sesiones,
                    total_eventos,
                    dias_activo,
                    ultimo_activo,
                    engagement_score,
                    inversion_intent_score,
                    updated_at
                )
                SELECT
                    ue.usuario_id,
                    ARRAY(
                        SELECT barrio_id::integer
                        FROM public.user_events sub
                        WHERE sub.usuario_id = ue.usuario_id
                          AND sub.barrio_id IS NOT NULL
                          AND sub.created_at > NOW() - INTERVAL '30 days'
                        GROUP BY barrio_id
                        ORDER BY COUNT(*) DESC
                        LIMIT 5
                    ) AS top_barrios,
                    (
                        SELECT metadata->>'tipo_inversion'
                        FROM public.user_events sub
                        WHERE sub.usuario_id = ue.usuario_id
                          AND sub.event_type = 'simulator_run'
                          AND sub.created_at > NOW() - INTERVAL '30 days'
                        GROUP BY metadata->>'tipo_inversion'
                        ORDER BY COUNT(*) DESC
                        LIMIT 1
                    ) AS inversion_preferida,
                    (
                        SELECT metadata->>'tipo_inmueble'
                        FROM public.user_events sub
                        WHERE sub.usuario_id = ue.usuario_id
                          AND sub.created_at > NOW() - INTERVAL '30 days'
                        GROUP BY metadata->>'tipo_inmueble'
                        ORDER BY COUNT(*) DESC
                        LIMIT 1
                    ) AS tipo_inmueble_top,
                    ARRAY(
                        SELECT metadata->>'categoria'
                        FROM public.user_events sub
                        WHERE sub.usuario_id = ue.usuario_id
                          AND sub.event_type LIKE 'evento_%'
                          AND sub.created_at > NOW() - INTERVAL '30 days'
                        GROUP BY metadata->>'categoria'
                        ORDER BY COUNT(*) DESC
                        LIMIT 3
                    ) AS categorias_eventos_top,
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
                    total_sesiones = EXCLUDED.total_sesiones,
                    total_eventos = EXCLUDED.total_eventos,
                    dias_activo = EXCLUDED.dias_activo,
                    ultimo_activo = EXCLUDED.ultimo_activo,
                    engagement_score = EXCLUDED.engagement_score,
                    inversion_intent_score = EXCLUDED.inversion_intent_score,
                    updated_at = NOW()
            """)
        finally:
            await conn.close()

    asyncio.run(_run())


with DAG(
    dag_id="analytics_usuarios",
    default_args=default_args,
    description="Crear partición user_events + calcular user_interests",
    schedule_interval=_sched("0 7 * * *"),  # 2:00 AM COT = 7:00 UTC
    start_date=datetime(2026, 6, 1),
    catchup=False,
    tags=["analytics", "usuarios", "tracking"],
) as dag:

    t1 = PythonOperator(
        task_id="crear_particion_siguiente_mes",
        python_callable=crear_particion,
    )

    t2 = PythonOperator(
        task_id="calcular_user_interests",
        python_callable=calcular_interests,
    )

    t1 >> t2
