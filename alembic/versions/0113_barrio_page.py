"""feat: página de barrio (Ken, call 23-oct) — reusa embajadores y el destacado con alcance

* public.embajadores + video_url, post_id   el embajador del barrio ya existe (0012);
                                             solo faltaban su video y su artículo clave.
* comunidad_post + destacado / destacado_nivel / destacado_zona_codigo
                                             mismo alcance (barrio | comuna | ciudad) que
                                             eventos y tiendas (0079), editable con el
                                             mismo PATCH de admin.

Revision ID: 0113
Revises: 0112
"""
from alembic import op

revision = "0113"
down_revision = "0112"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.embajadores
            ADD COLUMN IF NOT EXISTS video_url VARCHAR,
            ADD COLUMN IF NOT EXISTS post_id   INTEGER REFERENCES public.comunidad_post(id) ON DELETE SET NULL
    """)
    op.execute("""
        ALTER TABLE public.comunidad_post
            ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS destacado_nivel VARCHAR
                CHECK (destacado_nivel IN ('barrio', 'comuna', 'ciudad')),
            ADD COLUMN IF NOT EXISTS destacado_zona_codigo VARCHAR
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE public.comunidad_post
            DROP COLUMN IF EXISTS destacado_zona_codigo,
            DROP COLUMN IF EXISTS destacado_nivel,
            DROP COLUMN IF EXISTS destacado
    """)
    op.execute("ALTER TABLE public.embajadores DROP COLUMN IF EXISTS post_id, DROP COLUMN IF EXISTS video_url")
