"""create_user_events_partition() auto-sana huecos (mes anterior+actual+siguiente).

Antes la función creaba SOLO el mes siguiente y dependía de correr cada mes
(cron run_analytics_usuarios). Un mes sin correr dejaba al mes ACTUAL sin
partición → todo user_event de ese mes se caía silenciosamente (el endpoint
/track traga la excepción) → el embudo de tráfico/prospectos no registraba nada.
Se detectó con huecos 2026_09 y 2026_10 en DEV y prod.

Ahora crea mes anterior + actual + siguiente (idempotente), así un run perdido
no vuelve a tumbar el mes actual. Se llama al final para crear las faltantes ya.

Revision ID: 0120
Revises: 0119
"""
from alembic import op

revision = "0120"
down_revision = "0119"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.create_user_events_partition()
        RETURNS void LANGUAGE plpgsql AS $fn$
        DECLARE d DATE; nm TEXT; s TEXT; e TEXT;
        BEGIN
            -- mes anterior + actual + siguiente: auto-sana si el cron no corrió un mes
            FOR d IN SELECT generate_series(
                         date_trunc('month', now()) - interval '1 month',
                         date_trunc('month', now()) + interval '1 month',
                         interval '1 month')::date LOOP
                nm := 'user_events_' || to_char(d, 'YYYY_MM');
                s  := to_char(d, 'YYYY-MM-01');
                e  := to_char(d + interval '1 month', 'YYYY-MM-01');
                IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = nm) THEN
                    EXECUTE format(
                        'CREATE TABLE public.%I PARTITION OF public.user_events FOR VALUES FROM (%L) TO (%L)',
                        nm, s, e);
                END IF;
            END LOOP;
        END;
        $fn$;
        """
    )
    op.execute("SELECT public.create_user_events_partition()")


def downgrade() -> None:
    # No se revierte la función (el comportamiento nuevo es estrictamente más seguro).
    pass
