"""Tiempos de recorrido en hora pico por zona hacia puntos clave (#27).

Fuente: HERE Routing API v8 (router.hereapi.com/v8/routes, summary.duration con
departureTime = traffic-aware). Dato ESTATICO estilo campana, igual que el perfil
de trafico (analytics.barrios_trafico_perfil): se corre scripts/load_routing_here.py
y queda congelado hasta la proxima corrida. Tabla vacia aqui; la puebla el script.

Grano = ZONA (comuna para Medellin, municipio para el resto, ~25 zonas) para no
gastar la cuota free de HERE (per-barrio serian ~2300 llamadas). Mismo keying que
raw.poblacion_* : zona_codigo en mayusculas = comuna o municipio.

Revision ID: 0116
Revises: 0115
"""
from alembic import op

revision = "0116"
down_revision = "0115"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS analytics.zona_tiempos_recorrido (
            zona_tipo           TEXT NOT NULL,   -- 'comuna' | 'municipio'
            zona_codigo         TEXT NOT NULL,   -- nombre en mayusculas (= raw.barrios.comuna/municipio)
            tiempo_poblado_min  INTEGER,         -- minutos en auto a El Poblado, hora pico AM
            tiempo_centro_min   INTEGER,         -- minutos en auto al Centro,     hora pico AM
            calculado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (zona_tipo, zona_codigo)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS analytics.zona_tiempos_recorrido")
