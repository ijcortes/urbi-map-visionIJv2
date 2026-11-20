# ADR-0006 — Capa analytics partida: dbt + tablas no-dbt (scripts/alembic) conviven

**Estado:** Aceptada de facto (describe la realidad) · **Relacionado:** [ARCHITECTURE §7.5](../ARCHITECTURE.md#75-dbt--linaje-raw--staging--analytics)

## Contexto

La API lee muchas tablas `analytics.*`. La intención de diseño ([ADR-0002](adr-0002-reproducible-dev-prod.md))
es que las transformaciones SQL vivan en **dbt**. Pero en la práctica el schema `analytics`
tiene **dos productores**:

1. **dbt** (`dbt/models/analytics/*`): `barrios_mercado`, los 3 `score_*_plazo`,
   `barrios_score_consolidado`, `barrios_oportunidades`, `barrios_seguridad`, etc.
2. **Scripts Python / migraciones alembic** (NO dbt): `analytics.barrios_cd`
   (migr 0060/0061/0062/0104), `listings_georef` + `barrios_medianas` + `barrios_contexto`
   (cache.py / `enrich_barrios_stats`), `barrios_pois_distancia` (`compute_barrios_pois`),
   `zona_tiempos_recorrido`, `barrios_congestion`, `barrios_trafico_perfil`,
   `compraventas_municipio_stats`, `catastro_comunas_stats`.

Además, varios modelos dbt alcanzan tablas externas con **referencias hardcodeadas**
(`analytics.barrios_pois_distancia`, `raw.estratos_manzana`, `public.user_events`…) en
lugar de `ref()`/`source()`, por lo que esas aristas son **invisibles al DAG de dbt**.

## Decisión

Aceptar la convivencia: dbt es el productor principal del motor de scoring; las tablas
que requieren PostGIS pesado, geometrías o cómputo imperativo viven en scripts/alembic. **El
orden de ejecución entre ambos lo garantiza el cron, no dbt.**

## Consecuencias

- **+** Flexibilidad (cómputo espacial en Python donde dbt no alcanza).
- **−** El `dbt run --full-refresh` (lun 07:30) asume que `compute_barrios_pois` (lun 04:00)
  y los loaders ya corrieron — dependencia de orden gestionada a mano en el crontab.
- **−** Un `dbt docs`/lineage NO muestra el grafo real (faltan las aristas hardcodeadas).
- **Riesgo**: al tocar un modelo dbt que lee `analytics.barrios_pois_distancia`, recordar
  que esa tabla no es un `ref()` → dbt no la reconstruye ni respeta su orden.
