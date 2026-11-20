# ADR-0002 — Todo cambio de datos vive en alembic/cron/dbt, nunca en script manual

**Estado:** Aceptada (es la regla base del repo) · **Fuente:** [CLAUDE.md](../../CLAUDE.md)

## Contexto

El código ya se reproduce solo (DEV y PROD corren el mismo commit). Lo que **diverge**
son los *efectos de scripts manuales sobre la DB*. Varias veces un script que producía
dato que la app sirve corría a mano en DEV y nunca en PROD → el feature salía vacío en
producción (ej. `barrios_pois_distancia`: `compute_barrios_pois.py` corría a mano en DEV,
no en prod → el drawer "Entorno" salía vacío en prod).

## Decisión

Un cambio de datos/schema/compute **no está "listo"** hasta vivir en un camino
versionado que ambos entornos ejecutan automáticamente. Tres carriles, un cambio vive en **uno**:

| Tipo de cambio | Dónde vive | Cómo llega a prod |
|---|---|---|
| Schema + backfill | **alembic migration** | `alembic upgrade head` en CMD de `Dockerfile.api`, en cada deploy |
| Compute/load recurrente | **crontab en `Dockerfile.cron`** | mismo cron en ambos envs |
| Transformación SQL | **modelo dbt** | corre en cron (`run_dbt_full_refresh.py`) |

**Gate: DEV primero, siempre.** Nada pasa a prod sin estar verificado en DEV (efecto real
en DB/app, no solo "el script corrió").

## Consecuencias

- **+** Elimina la clase de bug "funciona en DEV, vacío en PROD".
- **−** Los `scripts/*.py` sirven para explorar/one-shots, pero en el momento que producen
  dato que la app sirve, **deben graduarse** a migración/cron/dbt. Si no, son deuda que
  diverge (ver [ARCHITECTURE §11.2](../ARCHITECTURE.md#11-archivos-sin-conexión--candidatos-a-limpieza)).
- **Gotcha**: dos scripts escribiendo la misma tabla donde uno hace `TRUNCATE` se pisan →
  encadenar con `&&` en una línea de cron, no en jobs separados (ver el bug de `load_pois`
  en [ARCHITECTURE §7.6](../ARCHITECTURE.md#76-problemas-conocidos-del-pipeline--accionables)).
