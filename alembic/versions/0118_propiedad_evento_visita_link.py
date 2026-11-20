"""propiedad_evento.visita_solicitud_id — link lead→venta para conversión real (#23).

El cierre (realtor.cerrar_listing) atribuye la venta al lead que la originó:
de las visitas del agente sobre ese listing, elige la que llegó a oferta (o la
más reciente). Permite medir tasa de conversión lead→venta en el perfil del
agente, sin inflar como lo haría n_cierres/n_leads (cierres off-platform).
ON DELETE SET NULL: la venta sobrevive aunque se borre el lead.

Revision ID: 0118
Revises: 0117
"""
from alembic import op

revision = "0118"
down_revision = "0117"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.propiedad_evento "
        "ADD COLUMN IF NOT EXISTS visita_solicitud_id uuid "
        "REFERENCES public.visita_solicitud(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.propiedad_evento DROP COLUMN IF EXISTS visita_solicitud_id")
