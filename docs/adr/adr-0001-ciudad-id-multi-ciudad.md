# ADR-0001 — Multi-ciudad por `ciudad_id`, no `community_id`

**Estado:** Aceptada · **Fecha:** 2026 · **Relacionado:** [ARCHITECTURE §9](../ARCHITECTURE.md#9-modelo-de-negocio), Panamá Social

## Contexto

El producto está diseñado para **replicarse ciudad por ciudad** ("Medellín Social",
"Panamá Social", "Bogotá Social"…). La primera réplica real es **Panamá Social**
(rama `feat/panama-mvp`, geografía ANATI live en DEV). Se necesitaba un discriminador
multi-ciudad sobre **una sola base de datos** (Panamá = otra comunidad en la misma DB,
no una DB aparte).

## Decisión

El discriminador es **`ciudad_id`**, NO `community_id`. `community_id` se omitió a
propósito (migración 0084). La jerarquía: `raw.barrios.ciudad_id` → FK a
`public.ciudades` (que ya tiene columna `pais`). **Todo el embudo rutea por
`barrio_id → raw.barrios`**; no se mete `community_id` en ~40 tablas.

`ciudad_id` es `SERIAL` por-DB (p.ej. Panamá = 4 en local, 2 en DEV) → el front no
hardcodea el id.

## Consecuencias

- **+** Una sola DB, un solo pipeline; agregar ciudad = cargar geografía + listings con
  su `ciudad_id`.
- **+** Evita propagar una columna nueva por decenas de tablas.
- **−** El mapa de comunas de Medellín usa geojson **estático solo-Medellín**; los barrios
  de otras ciudades vienen del API `/barrios` (que hoy NO filtra por ciudad → trae todos).
- **Gotcha**: `ciudades.id` seq puede quedar rezagada → `setval` antes de INSERT.
  `raw.barrios` tiene `unique(nombre,municipio)` en local pero no en DEV (drift).
