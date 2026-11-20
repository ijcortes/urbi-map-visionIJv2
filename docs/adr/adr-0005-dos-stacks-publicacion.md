# ADR-0005 — Dos stacks de publicación de propiedad (tabla `listing` nueva vs legacy `agentes`)

**Estado:** En transición (deuda conocida) · **Relacionado:** [ARCHITECTURE §5.5/§5.6/§11.2](../ARCHITECTURE.md#11-archivos-sin-conexión--candidatos-a-limpieza)

## Contexto

Conviven **dos sistemas** para "propiedad publicada por un dueño/agente":

1. **Stack nuevo** — tabla `public.listing` (+ `listing_media`, `owner`, `intake`,
   `due_diligence_item`). Flujo: owner crea `intake` → asignación a realtor → `aceptar`
   (crea `listing` borrador + DD) → publicar → `moderacion` → `publicado` → `cache.py` lo
   UNIfica al mapa. Gobernado por los `services/` (`intake_service`, `listing_service`,
   `moderacion_service`, `asignador_service`). Es el camino vivo y correcto.

2. **Stack legacy** — tablas `public.listings_propios`, `public.agentes`,
   `public.agente_solicitudes`. Sistema viejo de "contactar agente". Sobrevive en
   `listings_propios.py` (`/solicitudes`, `/agentes-para-contactar`) y en SQL suelto
   (`scripts/sql/create_agente_solicitudes.sql`, sin migración alembic que lo posea).

La migración 0053 ("unificar publicación") implementó el stack nuevo; el plan FASE_E de
**borrar `agentes`** se diseñó pero **nunca se ejecutó** → `agentes` sigue viva y consultada.

## Decisión

Avanzar sobre el stack nuevo (`listing`) y tratar el legacy (`agentes`/`agente_solicitudes`)
como deuda a deprecar, **no** borrarlo mientras `listings_propios.py` lo consulte.

## Consecuencias

- **−** Dos modelos de datos para el mismo concepto; riesgo de confusión al leer el código.
- **−** `create_agente_solicitudes.sql` es el **único** DDL de una tabla viva fuera de
  alembic (viola [ADR-0002](adr-0002-reproducible-dev-prod.md)) → candidata a formalizar en migración.
- **Acción**: desacoplar `listings_propios.py` de `agentes`, migrar los endpoints legacy al
  stack `listing`, y recién entonces ejecutar el DROP de `agentes`.
