"""fix 6 barrios with inconsistent comuna + add barrio aliases (Ciudad del Río, Provenza)

1) Six Medellín barrios were mapped to a different comuna in alembic 0062
   (`_BARRIO_CD`) than in the frontend's public/data/barrios_medellin.geojson and
   barrios_comunas.json (which agree with each other). They sit on comuna borders,
   so the 0062 point-in-polygon join returned nothing for them and a manual value
   was used. The geojson/json value is the one that matches the official division:

       id   barrio              0062 (wrong)        geojson (correct)
       11   PICACHITO           5  CASTILLA         6  DOCE DE OCTUBRE
       42   PAJARITO            6  DOCE DE OCTUBRE  7  ROBLEDO
       61   LA GABRIELA         7  ROBLEDO          13 SAN JAVIER
       63   METROPOLITANO       7  ROBLEDO          13 SAN JAVIER
       64   SANTA ROSA DE LIMA  7  ROBLEDO          13 SAN JAVIER
       183  LLANADITAS No.2     3  MANRIQUE         8  VILLA HERMOSA

2) raw.barrio_alias: names people search for that are not official barrios.
   ASSUMPTION (flagged for the owner to confirm): "Ciudad del Río" is a sector in
   EL POBLADO (comuna 14); its coordinates fall inside barrio 226 COLOMBIA, so the
   alias points there. "Provenza" is a sector of EL POBLADO (comuna 14) that falls
   inside barrio 236 EL POBLADO. No official barrio/comuna polygon exists for
   either, so the alias resolves to the containing barrio.

Idempotent and reversible (downgrade restores the 0062 values and drops the alias table).

Revision ID: 0104
Revises: 0103
"""
from alembic import op

revision = "0104"
down_revision = "0103"
branch_labels = None
depends_on = None

_COMUNAS = {
    3: "MANRIQUE", 5: "CASTILLA", 6: "DOCE DE OCTUBRE", 7: "ROBLEDO",
    8: "VILLA HERMOSA", 13: "SAN JAVIER",
}
_NEW = [(11, 6), (42, 7), (61, 13), (63, 13), (64, 13), (183, 8)]
_OLD = [(11, 5), (42, 6), (61, 7), (63, 7), (64, 7), (183, 3)]

# (alias_norm, display alias, barrio_id, note)
_ALIASES = [
    ("ciudad del rio", "Ciudad del Río", 226,
     "ASSUMPTION: sector of El Poblado (comuna 14); coordinates fall in barrio 226 COLOMBIA"),
    ("provenza", "Provenza", 236,
     "ASSUMPTION: sector of El Poblado (comuna 14); falls in barrio 236 EL POBLADO"),
]


def _set_cd(pairs):
    values = ", ".join(f"({b}, {cd})" for b, cd in pairs)
    op.execute(f"""
        INSERT INTO analytics.barrios_cd (barrio_id, cd_comuna)
        SELECT v.barrio_id, v.cd_comuna
        FROM (VALUES {values}) AS v(barrio_id, cd_comuna)
        JOIN raw.barrios b ON b.id = v.barrio_id
        ON CONFLICT (barrio_id) DO UPDATE SET cd_comuna = EXCLUDED.cd_comuna
    """)
    names = ", ".join(f"({cd}, '{_COMUNAS[cd]}')" for cd in sorted({cd for _, cd in pairs}))
    op.execute(f"""
        UPDATE raw.barrios b
        SET    comuna = c.nombre
        FROM   analytics.barrios_cd bc
        JOIN   (VALUES {names}) AS c(cd, nombre) ON c.cd = bc.cd_comuna
        WHERE  bc.barrio_id = b.id
          AND  b.id IN ({", ".join(str(b) for b, _ in pairs)})
          AND  b.comuna IS DISTINCT FROM c.nombre
          AND  b.municipio = 'MEDELLIN'
    """)


def upgrade() -> None:
    _set_cd(_NEW)
    op.execute("""
        CREATE TABLE IF NOT EXISTS raw.barrio_alias (
            alias_norm TEXT PRIMARY KEY,
            alias      TEXT NOT NULL,
            barrio_id  INTEGER NOT NULL,
            nota       TEXT
        )
    """)
    for norm, alias, bid, nota in _ALIASES:
        op.execute(f"""
            INSERT INTO raw.barrio_alias (alias_norm, alias, barrio_id, nota)
            SELECT '{norm}', '{alias}', b.id, '{nota}'
            FROM raw.barrios b WHERE b.id = {bid}
            ON CONFLICT (alias_norm) DO NOTHING
        """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS raw.barrio_alias")
    _set_cd(_OLD)
