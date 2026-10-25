"""feat: página de barrio (Ken, call 23-oct) — embajador por comuna + tags de destacado

* public.embajador_perfil       embajador del barrio: foto, bio, video, artículo clave.
                                Uno activo por comuna (cd_comuna) o municipio del Valle.
* comunidad_post.tags text[]    "featured-<slug>" marca el artículo destacado de esa
                                comuna; se cambia quitando/poniendo el tag, el post sigue
                                en el blog del barrio.

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
        CREATE TABLE IF NOT EXISTS public.embajador_perfil (
            id          SERIAL PRIMARY KEY,
            cd_comuna   INTEGER,
            municipio   VARCHAR,
            nombre      VARCHAR NOT NULL,
            foto_url    VARCHAR,
            bio         TEXT,
            video_url   VARCHAR,
            post_id     INTEGER REFERENCES public.comunidad_post(id) ON DELETE SET NULL,
            activo      BOOLEAN NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMP DEFAULT NOW(),
            CONSTRAINT chk_embajador_zona CHECK (cd_comuna IS NOT NULL OR municipio IS NOT NULL)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_embajador_cd ON public.embajador_perfil(cd_comuna) WHERE activo")
    op.execute("CREATE INDEX IF NOT EXISTS ix_embajador_muni ON public.embajador_perfil(upper(municipio)) WHERE activo")
    op.execute("ALTER TABLE public.comunidad_post ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'")
    op.execute("CREATE INDEX IF NOT EXISTS ix_comunidad_post_tags ON public.comunidad_post USING GIN (tags)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.ix_comunidad_post_tags")
    op.execute("ALTER TABLE public.comunidad_post DROP COLUMN IF EXISTS tags")
    op.execute("DROP TABLE IF EXISTS public.embajador_perfil")
