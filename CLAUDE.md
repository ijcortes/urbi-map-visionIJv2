# CLAUDE.md

## Proceso: todo cambio reproducible DEV → PROD

**Regla base:** el código ya se reproduce solo (DEV y PROD corren el mismo commit).
Lo que diverge son los **efectos de scripts manuales sobre la DB**. Un cambio de
datos/schema/compute NO está "listo" hasta vivir en un camino versionado que ambos
envs ejecutan automáticamente — nunca en un script suelto corrido a mano.

### Gate: DEV primero, siempre

Nada pasa a producción hasta estar **funcionando correctamente en DEV**. DEV es el
filtro obligatorio: se prueba ahí, se verifica el efecto real (no solo que el script
corrió), y recién entonces se despliega a prod por el mismo camino versionado.

### Los 3 carriles — un cambio vive en UNO

| Tipo de cambio | Dónde vive | Cómo llega a prod |
|---|---|---|
| Schema + backfill de una vez | **alembic migration** | `alembic upgrade head` en CMD de `Dockerfile.api`, automático en cada deploy |
| Compute/load recurrente | **crontab en `Dockerfile.cron`** | mismo cron en ambos envs al desplegar |
| Transformación SQL | **modelo dbt** (`dbt/models/...`) | corre en cron (`run_dbt_full_refresh.py`) |

### Checklist de "done" (antes de dar un cambio por terminado)

1. ¿Funciona y está verificado **en DEV** (efecto real en la DB/app, no solo "corrió")?
2. ¿Vive en migración, cron o dbt — **committeado**? (`git show HEAD:<archivo>` lo tiene)
3. ¿Se aplica solo al desplegar a prod, sin "acordarse de correr X a mano"?

Si la respuesta a (3) es "hay que correrlo a mano en prod" → **no está listo**.

### Scripts manuales

`scripts/*.py` sirven para explorar y one-shots. En el momento que un script produce
dato que la app sirve, **se gradúa** a migración/cron/dbt. Si no se gradúa, es deuda
que diverge entre DEV y PROD (ej. `barrios_pois_distancia`: `compute_barrios_pois.py`
corría a mano en DEV, nunca en prod → el drawer "Entorno" salía vacío en prod).

GOTCHA: dos scripts escribiendo la misma tabla donde uno hace `TRUNCATE` pisa al otro.
Encadenar con `&&` en una sola línea de cron (orden garantizado), no en jobs separados.
