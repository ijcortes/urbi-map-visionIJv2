"""Realtor Preferido: slots por zona (4 por barrio, 8 por comuna) con rotación fija

Modelo decidido por Israel (20-nov-2026), ver docs/DECISION_REALTOR_PREFERIDO.md:
  - 4 slots por barrio y 8 por comuna, iguales en todas las zonas.
  - Precio depende de la zona (nivel A/B/C/D). PRECIOS DE EJEMPLO, editables en
    realtor_slot_precio sin tocar código.
  - Rotación en orden fijo y repetitivo (sin regla de tiempo de respuesta).
  - Cobro vía Stripe en GHL; el webhook activa el slot.
  - Arranque: toda zona con >= 1 preferido, aunque no pague (slot tipo 'gratis').

zona_codigo sigue la convención de `sponsorship`: barrio -> raw.barrios.id::text,
comuna -> cd_comuna (o pseudo-código 101-109 del Valle).

Revision ID: 0123
Revises: 0122
"""
from alembic import op

revision = "0123"
down_revision = "0122"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS realtor_slot (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        zona_nivel    TEXT NOT NULL CHECK (zona_nivel IN ('barrio','comuna')),
        zona_codigo   TEXT NOT NULL,
        posicion      SMALLINT NOT NULL CHECK (posicion BETWEEN 1 AND 8),
        CONSTRAINT chk_realtor_slot_cap CHECK (zona_nivel = 'comuna' OR posicion <= 4),
        agent_id      UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        tipo          TEXT NOT NULL DEFAULT 'pago' CHECK (tipo IN ('pago','gratis')),
        estado        TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','vencido','cancelado')),
        precio_mensual NUMERIC NOT NULL DEFAULT 0,
        fecha_inicio  DATE NOT NULL DEFAULT CURRENT_DATE,
        fecha_fin     DATE,
        pago_ref      TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")
    # una posición activa por zona; un agente no ocupa dos slots activos en la misma zona
    op.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_realtor_slot_pos
        ON realtor_slot(zona_nivel, zona_codigo, posicion) WHERE estado = 'activo'""")
    op.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_realtor_slot_agente
        ON realtor_slot(zona_nivel, zona_codigo, agent_id) WHERE estado = 'activo'""")
    op.execute("CREATE INDEX IF NOT EXISTS idx_realtor_slot_zona ON realtor_slot(zona_nivel, zona_codigo, estado)")

    # Ledger de pagos: idempotencia real por pago_ref (sobrevive a renovaciones del slot)
    op.execute("""
    CREATE TABLE IF NOT EXISTS realtor_slot_pago (
        pago_ref   TEXT PRIMARY KEY,
        slot_id    UUID REFERENCES realtor_slot(id) ON DELETE SET NULL,
        agent_id   UUID NOT NULL,
        zona_nivel TEXT NOT NULL,
        zona_codigo TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")

    op.execute("""
    CREATE TABLE IF NOT EXISTS realtor_rotacion (
        zona_nivel  TEXT NOT NULL,
        zona_codigo TEXT NOT NULL,
        contador    BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (zona_nivel, zona_codigo)
    )""")

    op.execute("""
    CREATE TABLE IF NOT EXISTS realtor_slot_precio (
        zona_nivel     TEXT NOT NULL CHECK (zona_nivel IN ('barrio','comuna')),
        nivel          TEXT NOT NULL CHECK (nivel IN ('A','B','C','D')),
        precio_mensual NUMERIC NOT NULL,
        es_ejemplo     BOOLEAN NOT NULL DEFAULT TRUE,
        PRIMARY KEY (zona_nivel, nivel)
    )""")
    # PRECIOS DE EJEMPLO (COP/mes por slot) hasta que el equipo defina la tabla real.
    op.execute("""
    INSERT INTO realtor_slot_precio (zona_nivel, nivel, precio_mensual) VALUES
        ('barrio','A',400000), ('barrio','B',280000), ('barrio','C',200000), ('barrio','D',120000),
        ('comuna','A',2000000), ('comuna','B',1400000), ('comuna','C',1000000), ('comuna','D',600000)
    ON CONFLICT DO NOTHING""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS realtor_slot_precio")
    op.execute("DROP TABLE IF EXISTS realtor_slot_pago")
    op.execute("DROP TABLE IF EXISTS realtor_rotacion")
    op.execute("DROP TABLE IF EXISTS realtor_slot")
