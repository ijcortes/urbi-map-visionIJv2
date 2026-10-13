"""fix: metrocuadrado upsert keyea por url (no dedup_hash) -> historial de precio

Dos bugs encadenados en raw.listings_metrocuadrado:

1) El scraper hace `ON CONFLICT (dedup_hash)` pero el unique index sobre
   dedup_hash (listings_mq_dedup_unique) SOLO existía en local — se creó a mano,
   nunca en código ni migración, nunca llegó a prod. En prod ese ON CONFLICT es
   inválido ("no unique or exclusion constraint matching") -> el scraper
   crasheaba cada corrida -> metrocuadrado congelado desde 2026-08-23, cero
   escrituras (incluido el cron ya arreglado en da3a25a).

2) dedup_hash incluye el precio bucketeado. Aun donde el upsert corría (local),
   un cambio de precio generaba un hash distinto -> INSERT fila nueva en vez de
   UPDATE -> el trigger fn_track_precio_cambio (BEFORE UPDATE OF precio) nunca
   disparaba -> listings_precio_historial = 0 filas de metrocuadrado + filas
   duplicadas por el mismo inmueble a precios distintos.

Fix: identidad del upsert = (url, tipo_operacion). Estable y sin precio. OJO: una
url de MC hostea venta Y arriendo del mismo inmueble (murldetalle keyea por
midinmueble, no por operación) — verificado en prod: 182 urls con >1 operación,
234 filas se perderían si se dedupara solo por url. Por eso la clave es compuesta.
dedup_hash queda SOLO para el dedup cross-fuente en serving (cache.py / dbt
stg_listings), que es su rol original.

Idempotente: la misma CREATE UNIQUE INDEX va también en el DDL del scraper
(CREATE UNIQUE INDEX IF NOT EXISTS listings_mq_url_op_unique) para no repetir el
drift — alembic corre antes que el cron, así que el scraper la ve ya creada.

Revision ID: 0103
Revises: 0102
"""
from alembic import op

revision = "0103"
down_revision = "0102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Colapsar duplicados por (url, tipo_operacion) — el bug de precio-en-
    #    dedup_hash los generó. Conservar la fila más reciente = max(id). Partición
    #    por operación para NO borrar la venta cuando también existe el arriendo en
    #    la misma url. IS NOT DISTINCT FROM colapsa además operaciones NULL legacy.
    op.execute("""
        DELETE FROM raw.listings_metrocuadrado a
        USING raw.listings_metrocuadrado b
        WHERE a.url IS NOT NULL
          AND a.url = b.url
          AND a.tipo_operacion IS NOT DISTINCT FROM b.tipo_operacion
          AND a.id < b.id
    """)

    # 2. Quitar el unique sobre dedup_hash (drift local-only). Con (url,op) como
    #    clave, dedup_hash vuelve a ser fingerprint cross-fuente y NO debe ser
    #    único: dos inmuebles distintos pueden caer legítimamente en el mismo bucket.
    # En local es un CONSTRAINT (no índice suelto) -> DROP CONSTRAINT lo cubre y
    # tumba su índice. IF EXISTS = no-op en prod (donde nunca existió).
    op.execute("ALTER TABLE raw.listings_metrocuadrado DROP CONSTRAINT IF EXISTS listings_mq_dedup_unique")

    # 3. Reemplazar el índice no-único de url por el UNIQUE compuesto que
    #    ON CONFLICT (url, tipo_operacion) necesita (prod nunca tuvo ninguno).
    op.execute("DROP INDEX IF EXISTS raw.idx_mq_url")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS listings_mq_url_op_unique ON raw.listings_metrocuadrado(url, tipo_operacion)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS raw.listings_mq_url_op_unique")
    op.execute("CREATE INDEX IF NOT EXISTS idx_mq_url ON raw.listings_metrocuadrado(url)")
    # listings_mq_dedup_unique NO se recrea: era drift manual, nunca debió existir.
