# ADR-0003 — `cache.py` reconstruye con swap-table, no TRUNCATE+INSERT

**Estado:** Aceptada · **Relacionado:** [ARCHITECTURE §5.1](../ARCHITECTURE.md#51-el-corazón-de-datos-apicachepy)

## Contexto

`api/cache.py` reconstruye cada hora las tablas materializadas que sirven el mapa
(`staging.stg_listings_unificado`, `analytics.barrios_medianas`, `analytics.listings_georef`).
La forma ingenua (`TRUNCATE` + `INSERT`) toma `ACCESS EXCLUSIVE` sobre la tabla durante
todo el rebuild — que son **minutos** — dejando `/listings` y `/viewport` (el hot-path del
mapa) sin responder en cada refresh.

## Decisión

Para esas **3 tablas** se usa **swap-table**: se llena una tabla `_new` ya indexada y el
`RENAME` final es casi instantáneo. Los lectores golpean la tabla vieja (poblada) hasta el
swap. Los índices del hot-path se recrean en la `_new` **antes** del rename
(`_create_listing_filter_indexes` + url + barrio_id + trigram), porque el rebuild hace
desaparecer los de alembic. `statement_timeout` se sube a 600s solo para esa conexión.

`analytics.barrios_contexto` es la excepción: usa upsert `ON CONFLICT` (no swap) porque no
depende de staging y debe correr aunque falten las fuentes raw.

Camino rápido fuera del refresh: `insert_listing_into_cache(pool, id)` inserta UNA fila al
publicar (con `ROW EXCLUSIVE`, no bloquea lectores) para que el aviso salga al mapa al
instante; lo llama `moderacion_service.aprobar`.

## Consecuencias

- **+** El mapa nunca se cae durante el refresh horario.
- **−** Lógica de recreación de índices acoplada a cache.py (si se agrega un índice en
  alembic al hot-path, hay que añadirlo también a `_create_listing_filter_indexes` o se
  pierde en cada swap).
- **Histórico**: antes de esto, `barrios_medianas` con TRUNCATE no conseguía lock y quedaba
  stale; el swap-table lo resolvió.
