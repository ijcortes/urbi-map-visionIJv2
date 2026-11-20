# ARCHITECTURE — Medellín Social

> **Qué es este documento.** El mapa único y canónico de todo el sistema: qué hace
> cada parte, **qué archivos `.py`/`.tsx`/`.sql` la implementan**, cómo se conecta
> con el resto, qué tablas de DB toca, y el modelo de negocio que todo esto sirve.
> Pensado para leerse de arriba a abajo y entender el proyecto completo sin abrir el
> código. Última síntesis: **2026-11-07**.
>
> **Cómo leerlo.** Cada subsistema trae una tabla `archivo | qué hace | cómo
> funciona | con qué conecta (+ tablas DB) | estado`. Estados: **VIVO** (en uso
> real), **DUDOSO** (parcialmente usado / a verificar), **BLOQUEADO** (construido
> pero inerte por dependencia externa), **CONGELADO/ROTO** (corre pero no rinde),
> **MUERTO** (sin uso). Los archivos sin conexión y los candidatos a borrar están
> en §11.
>
> Documentos relacionados: [MISION_VISION.md](MISION_VISION.md),
> [SCOPE_DATOS_2026-10-22.md](SCOPE_DATOS_2026-10-22.md),
> [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md),
> [GHL_CONTRATO_PROPUESTO.md](GHL_CONTRATO_PROPUESTO.md),
> [FUNNEL_B2B.md](FUNNEL_B2B.md), [adr/](adr/) (decisiones de arquitectura).

---

## 1. Qué es Medellín Social (resumen de 1 minuto)

Medellín Social es un **portal inmobiliario + de comunidad hiperlocal** para el Valle
de Aburrá. El corazón es un **mapa MLS gratuito**: agrega avisos de propiedad de
múltiples portales (scraping) + publicaciones directas, los ubica por barrio, y los
enriquece con un **motor de analítica por barrio** (score de inversión, mediana de
precio/m², liquidez, yield de renta, seguridad, POIs, estrato, uso de suelo POT).
Encima viven módulos de **comunidad** (eventos, noticias, negocios locales) y de
**realtors** (dashboard tipo Zillow: leads calificados, inteligencia de zona, ROI).

**El modelo de negocio no es cobrar por ver el mapa** (eso es gratis para atraer
tráfico), sino **monetizar el lado B2B**: agentes patrocinando zonas con
exclusividad (comuna/barrio), listings destacados, y suscripciones. Ver §9.

Proyecto hermano: **Panamá Social** (misma plataforma, discriminada por `ciudad_id`)
— ver [ADR-0001](adr/).

---

## 2. Topología de despliegue (Railway)

Un **solo repositorio** alimenta **tres servicios** de Railway, cada uno con su
propio Dockerfile pero compartiendo las mismas variables de entorno (`DATABASE_URL`,
`SENTRY_DSN`, etc.) y **la misma base de datos Postgres+PostGIS**.

| Servicio Railway | Dockerfile | Qué corre | Arranque |
|---|---|---|---|
| **WEB** (`urbi-map-vision`) | `Dockerfile` | Frontend SPA (Vite/React) servido por `server.mjs` | build Vite + serve estático |
| **Social-api** (`urbi-api`) | `Dockerfile.api` | API FastAPI (`api.main:app`, uvicorn) | **`alembic upgrade head && uvicorn ...`** — las migraciones se aplican solas en cada deploy |
| **social-cron** (`urbi-cron`) | `Dockerfile.cron` | `cron -f` headless — todos los jobs de datos | crontab UTC + traducción offline bakeada |

**Consecuencias de diseño clave:**

- **El código se reproduce solo** (DEV y PROD corren el mismo commit). Lo que diverge
  son los *efectos de scripts manuales sobre la DB* → por eso todo cambio de
  datos/schema/compute debe vivir en **alembic / cron / dbt** versionado, nunca en un
  script suelto corrido a mano (ver [CLAUDE.md](../CLAUDE.md) y [ADR-0002](adr/)).
- **Migraciones automáticas**: `Dockerfile.api` corre `alembic upgrade head` en el
  `CMD`. Hoy hay **122 migraciones** (head `0122_cron_runs_ledger`). ⚠️ Nunca hacer
  `upgrade head` en prod con una migración sin commitear.
- **`railway.toml` es compartido** por los 3 servicios → no tiene `healthcheckPath`
  (si lo tuviera, mataría a social-cron que no escucha en `$PORT`).
- **Base de datos**: PostGIS. Esquemas lógicos: `raw.*` (crudos de scrapers/loaders),
  `staging.*` (dbt unifica), `analytics.*` (dbt computa scores/mercado), `public.*`
  (operacional: usuarios, listings propios, comunidad, sponsorship, tracking).

---

## 3. Mapa del repositorio

```
api/            Backend FastAPI (routers, services, utils, cache, main)   → §5
scraping/       Scrapers de listings, renta, eventos, noticias, negocios   → §6
scripts/        Pipeline de datos: orquestadores cron, loaders, compute    → §7
dbt/            Transformaciones SQL raw → staging → analytics             → §7
alembic/        Migraciones de schema (122, head 0122) — se aplican en deploy
src/            Frontend React (TanStack Router, rutas en src/routes/)     → §8
public/         Assets estáticos + geojson servidos al mapa
docs/           Documentación (este archivo es el índice de arquitectura)  → §10/§11
airflow/        ⚠️ Stack LOCAL viejo (migrado a cron 2026-08-24). NO corre en nube.
server.mjs      Servidor estático del frontend (servicio WEB)
Dockerfile{,.api,.cron}   Los 3 servicios Railway                          → §2
```

> ⚠️ **`airflow/dags/*` está MUERTO en la nube**: fue migrado a `Dockerfile.cron` el
> 2026-08-24. Corre solo en el WSL del dev, nunca en producción. Si un archivo solo
> es referenciado por `airflow/dags/`, no está vivo en el pipeline real.

**Alcance de este documento.** Cubre **todo el `.py`/`.sql` de producción vivo** en
`api/`, `scraping/`, `scripts/` y `dbt/` (§5–§7), el frontend a granularidad de ruta (§8)
y el negocio (§9). **Excluido a propósito** (no es código corriendo en prod, dímelo si lo
quieres documentado): la suite de **tests** (`tests/`, `api/tests/` ≈37 archivos, `qc/`
journeys Playwright), las **122 migraciones alembic** una por una (se documentan como
sistema en §2/§4, no archivo por archivo), y `airflow/dags/*` (muerto, arriba).

---

## 4. Sistema de datos: cron + observabilidad

**`Dockerfile.cron`** define un crontab plano en UTC (migrado de los DAGs de Airflow).
Desde hace poco, **cada job se envuelve en `scripts/run_job.py`** — la capa de
observabilidad que convierte fallas silenciosas en visibles:

- **`scripts/run_job.py <nombre> <cmd...>`** — corre el comando, reemite su salida al
  logfile, y graba la corrida en **`raw.cron_runs`** (inicio/fin/duración/exit/ok/tail).
  Escribe la fila de inicio *primero* → un job colgado/OOM queda como `started_at` con
  `finished_at NULL` (zombie visible). Si `exit != 0` → alerta Sentry + webhook.
  *(Resuelve el bug histórico "el cron corrió y no se enteró nadie".)*
- **`scripts/cron_status.py`** — lector on-demand de `raw.cron_runs`. Es lo que se corre
  cuando alguien pide "tráeme los logs / qué pasó con el cron". Flags: `--fails`,
  `--job NAME`, `--hours`, `--zombie-hours`.
- **`raw.cron_runs`** — ledger durable (migración **0122**), sobrevive redeploys (a
  diferencia de los logfiles del contenedor efímero).

### Calendario de cron (UTC)

| Hora | Job (nombre run_job) | Script | Qué hace |
|---|---|---|---|
| 03:00 diario | `refresh` | `refresh_data.py` | fincaraíz + remates → cache |
| 08:00 diario | `listings_m2` | `run_listings_metrocuadrado.py` | metrocuadrado + habi + dedup + stale + R2 + dbt (completo domingos) |
| 13:00 diario | `data_quality` | `data_quality_check.py` | frescura/volumen/fotos → alerta |
| 15:00 c/3 días | `qc_report` | `qc_report.py --no-email` | reporte QC de scrapers |
| 09:00 c/3 días | `renta_corta` | `run_renta_corta.py` | airbnb_mensual/vrbo/medellinliving/nomadbarrio/flatio/booking |
| cada 6 h | `comunidad` | `scraping/run_comunidad.py` | eventos + noticias |
| 09:30 diario | `link_check` | `scraping.link_checker` | salud de URLs (reemplazó a `validate_listings_urls.py`) |
| 05:30 diario | `translate` | `translate_descripciones.py` | traducción offline es→en |
| 07:00 diario | `analytics_usuarios` | `run_analytics_usuarios.py` | partición user_events + user_interests |
| 08:00 domingo | `airbnb_semanal` | `run_airbnb_semanal.py` | AirROI + dbt scores STR |
| 07:30 lunes | `dbt_full_refresh` | `run_dbt_full_refresh.py` | dbt run --full-refresh + test |
| 10:00 miérc. | `remates_dbt` | `dbt_run.py` | scores post-remates |
| 03:30 día 1 | `ingest_barrios` | `load_barrios.py` | re-ingesta barrios |
| 04:00 lunes | `ingest_pois` + `compute_barrios_pois` | `load_pois.py --build-analytics && compute_barrios_pois.py` | POIs → columnas barrio (encadenado con `&&`) |
| 12:00 día 1 | `seguridad_mensual` | `run_seguridad_mensual.py` | criminalidad → barrios_seguridad |
| 11:00 diario | `parametros_diario` | `fetch_usd_rate.py` | tasa USD |
| 11:15 lunes | `trm_semanal` | `fetch_trm.py` | TRM COP/USD/EUR |
| 14:00 diario | `alertas` | `alertas_notificar.py` | notifica alertas de precio |
| cada hora | `sweep_asignados` | `sweep_asignados.py` | libera intakes vencidos (24h) al pool |

> **GOTCHA documentado**: `load_pois` hace TRUNCATE+reconstruye columnas viejas;
> `compute_barrios_pois` RELLENA columnas nuevas. Van **encadenados con `&&`** en una
> sola línea de cron — si se separan, `compute` puede perder lo que `load_pois` acaba
> de truncar. No separar.

---

## 5. Backend — API FastAPI (`api/`)

**`api/main.py`** es el punto de entrada: su `lifespan` conecta el pool (con
reintentos), carga parámetros, corre `refresh_listings_cache` en el arranque y lanza
la tarea horaria de refresh; monta **37 routers** bajo `/api/v1/*` y la SPA de admin
desde `admin_dist/`. Seguridad fail-closed (`_IS_PROD` por defecto: sin `/docs` salvo
`ENV=dev`), middlewares en orden SessionCookie → GZip → BodyLimit → AntiScrape → CORS.

**Arquitectura en 3 capas:** los **routers** son capa delgada HTTP (validan, chequean
auth, delegan); los **services** son la verdad única por dominio (transiciones de
estado, reglas de patrocinio, resolución espacial); los **utils** son infraestructura
transversal (email, GHL, storage, saneamiento). Imports hacia abajo:
routers → services → utils.

### 5.1 El corazón de datos: `api/cache.py`

Reconstruye cada hora (y en el arranque) las tablas materializadas que sirven el mapa,
reemplazando CTEs y JOINs lat/lon por request con tablas precomputadas:

- **UNION de 7 fuentes** en `staging.stg_listings_unificado`: `raw.listings_metrocuadrado`,
  `raw.listings_fincaraiz`, `raw.listings_habi`, `raw.listings_casadolcecasa`,
  `raw.listings_premium`, `raw.listings_renta_media` y `public.listing` (publicaciones
  propias). Cada rama normaliza a 31 columnas y asigna `tier`.
- **`barrio_id` espacial**: para filas con `barrio_id` NULL pero coords válidas, un
  `COALESCE` con `ST_Contains(raw.barrios.geometry, punto)` (GIST) las ubica en su barrio.
- **Pipeline de calidad/dedup**: cotas de plausibilidad `_PLAUSIBLE` → `ST_ClusterDBSCAN`
  (eps 40 m) + bucket log de precio (~5%) para duplicados cross-portal → representante
  por cluster → jitter determinista de coords apiladas (5–50 → ~45 m; ≥50 → anula el
  pin pero conserva el listing en lista/búsqueda).
- **`analytics.listings_georef`**: `DISTINCT ON (url)` + JOIN `raw.barrios` + LATERALs a
  `raw.pot_usos_medellin` (uso de suelo) y `raw.estratos_manzana` (estrato) + `fecha_primera_vez`
  (días en mercado).
- **`analytics.barrios_contexto`**: consolida scores/yield/liquidez/seguridad desde
  `analytics.*`. NO usa swap-table (corre aunque falten fuentes raw).
- **Swap-table en 3 tablas** (`stg_listings_unificado`, `barrios_medianas`,
  `listings_georef`): llena una tabla `_new` ya indexada y hace `RENAME` casi instantáneo,
  en vez de TRUNCATE+INSERT que bloquearía `/listings` minutos con `ACCESS EXCLUSIVE`
  (ver [ADR-0003](adr/)).
- **`insert_listing_into_cache(pool, id)`**: inserta UNA fila al publicar (sin esperar la
  hora), con `ROW EXCLUSIVE` (no bloquea lectores). Lo llama `moderacion_service.aprobar`.

### 5.2 Núcleo y soporte

| archivo | qué hace | cómo funciona | conecta con (+ tablas) | estado |
|---|---|---|---|---|
| `main.py` | Entrypoint FastAPI | lifespan (pool + refresh + tarea horaria), monta 37 routers, middlewares, seguridad prod | todo | VIVO |
| `cache.py` | Corazón de datos (§5.1) | swap-table, UNION 7 fuentes, dedup DBSCAN | `main`, `moderacion_service`; escribe staging/analytics | VIVO |
| `db.py` | Pool asyncpg global | min2/max10, `command_timeout=30`, `statement_timeout=15s`, `work_mem=64MB` | todo | VIVO |
| `dependencies.py` | AuthN/AuthZ | JWT HS256 + blacklist por `jti` + `token_version`; `require_plan`, `is_pro`/`is_agente`; modo cookie opt-in | casi todos los routers; `usuarios`, `token_blacklist`, `agent` | VIVO |
| `limiter.py` | Rate-limit por IP + throttles | slowapi + `KeyedThrottle` (memoria + Postgres advisory lock); email/login/view/event | routers; `public.throttle_hits` | VIVO |
| `parametros.py` | Parámetros financieros en caliente | `load()` lee `raw.parametros_sistema` a cache; `get()` con `_DEFAULTS` | `main`; `raw.parametros_sistema` | VIVO |
| `legal.py` | Versión de consentimiento Ley 1581 | `HABEAS_DATA_VERSION` (auditable) | routers auth/registro | VIVO |
| `config.py` *(archivo)* | Define solo `USD_TO_COP` | **Sombreado por el paquete `api/config/`** (que define USD+EUR). Nadie lo alcanza. | — | **MUERTO** (§11) |

### 5.3 Services (`api/services/`) — verdad única por dominio

| archivo | qué hace | usado por | estado |
|---|---|---|---|
| `intake_service.py` | Captación de inmuebles (owner) → crea `intake`, `aceptar_intake` crea `listing` borrador + sync GHL | intake/listings/listings_propios | VIVO |
| `zona_service.py` | `resolver_zona`: `ST_Contains(raw.barrios.geometry, geom)` → barrio_id | asignador/intake services | VIVO |
| `sponsorship_service.py` | `patrocinadores_vigentes`: sponsorship activa hoy, ordenada por antigüedad | asignador_service | VIVO |
| `asignador_service.py` | Orquesta owner→zona→realtor; `asignar_intake` idempotente, `tomar_del_pool` atómico, `sweep_asignados_vencidos` | asignador/realtor/listings/listings_propios/sweep | VIVO |
| `agent_service.py` | Ciclo de vida agente (aprobar/rechazar/suspender); `ESTADOS_ASIGNABLES={'activo'}` | admin_agentes/asignador_service | VIVO |
| `listing_service.py` | Máquina de estados del listing (pura, sin DB); `datos_minimos_completos` espejo del front | moderacion/realtor/listings_propios | VIVO |
| `moderacion_service.py` | Aprobar/rechazar publicación inicial + `insert_listing_into_cache` + sync GHL | moderacion.py | VIVO |
| `due_diligence_service.py` | Checklist de verificación de documentos (owner reporta, realtor verifica) | intake.py | VIVO |
| `personalizacion.py` | Scoring de relevancia listing×barrio por perfil (puro); `calcular_relevancia` | barrios/listings | VIVO |
| `zona_sponsor_service.py` | Asignación de zonas con exclusividad; precio A/B/C/D; `procesar_pago_zona` (único punto post-pago); `ZonaOcupadaError` | zonas/admin_agentes; `sponsorship`, `analytics.zonas_nivel_precio` | VIVO |
| `trm_service.py` | Fuente única COP/moneda; cache 300s + fallback env; nunca lanza | comparador/realtor/trm/listings/barrios; `public.trm` | VIVO |
| `link_review.py` | Revisión humana de links rotos; único punto que voltea `raw.*.activo`; digest HMAC single-use | routers/link_review, link_checker | VIVO |

### 5.4 Utils (`api/utils/`) — infraestructura transversal

| archivo | qué hace | estado |
|---|---|---|
| `ghl_client.py` | Integración GoHighLevel. **Vivo**: `sync_listing`, `link_agency_to_listing`, `sync_tienda`, `sync_agency`, auth de webhooks. **Skeleton (NotImplementedError)**: `crear_checkout_session`, `cancelar_suscripcion`, `find_or_create_contact`, `push_{evento,deal,referidor,agent,visita}` | VIVO (parcial) |
| `email.py` + `gmail_api.py` | Envío email (Gmail API si configurado, si no SMTP/stdout) + plantillas HTML escapadas | VIVO |
| `storage.py` | Subida a S3/Cloudflare R2; valida por magic bytes; dedup content-addressable | VIVO |
| `stripe_client.py` | Pasarela Stripe (checkout + webhook); lazy import. **Es la pasarela de pago realmente viva** (el checkout GHL aún es skeleton) | VIVO |
| `anti_scrape.py` | Middleware ASGI: 403 a UAs de herramientas (curl/scrapy/headless); exime /health,/webhook,/ghl | VIVO |
| `body_limit.py` | Middleware: 413 si body > cap (1 MiB JSON / 12 MiB multipart) | VIVO |
| `session_cookie.py` | Cookie HttpOnly de sesión (modo cookie opt-in) | VIVO |
| `pii.py` | `mask_email` para mantener PII fuera de logs | VIVO |
| `urls.py` | `require_safe_url` / `require_plain_text` (anti-XSS) | VIVO |

### 5.5 Routers de datos/mapa

| archivo | qué hace | cómo funciona + tablas | estado |
|---|---|---|---|
| `listings.py` | **Corazón del mapa**: listado, `/viewport` (pines/clusters), `/{id}` (popup/drawer), `/agente·similares·entorno·slots`, `POST /{id}/vista`, `/reclamar` | Lee `staging.stg_listings_unificado` + `analytics.listings_georef` (refresh horario de cache.py); `id=md5(url)` truncado; scoring de personalización + TRM; clusteriza por zoom | VIVO |
| `barrios.py` | **Motor de scoring**: barrios con score+mercado, ficha `/{id}`, serie mercado, comparar, comunas | `get_score_col(perfil)` = whitelist perfil→columna (anti-inyección) interpolado en SQL; consolida ~20 tablas `analytics.barrios_*` sobre `raw.barrios`; reusa `_finalize_row` de listings.py | VIVO (núcleo) |
| `comunas.py` | Métricas por comuna para el coropleta + drill-down | Agrega `raw.barrios` por comuna/municipio (pseudo 101-109) desde `analytics.barrios_*`; cache memoria 24h; reusa `get_score_col` | VIVO |
| `zonas.py` | Compra self-serve de zonas patrocinadas | `/disponibles` (catálogo+ocupadas+precios), `/checkout` (simulado sin Stripe), delega a `zona_sponsor_service` | VIVO |
| `oportunidades.py` | Top de barrios con oportunidad detectada | `analytics.barrios_oportunidades JOIN score_consolidado`; perfil query>usuario>default; reusa `get_score_col` | VIVO |
| `comparador.py` | Comparador (historial + batch ≤5) | `public.comparaciones_historial` (jsonb) + staging/georef/medianas; calcula % bajo mediana, yield | VIVO |
| `calculadora.py` | Simulador de inversión | `analytics.barrios_*` + `raw.indices_precio_vivienda` (DANE); OPEX por estrategia (airbnb 38%/renta_media 22%/larga 28%); `public.simulaciones_historial` + `historial` | VIVO |
| `stats.py` | Resumen de ciudad + umbrales de color | Agrega `analytics.barrios_mercado/oportunidades/score_consolidado`; `score-thresholds` fijo para el front | VIVO |
| `favoritos.py` | Favoritos de barrios y de listings | `favoritos`+`raw.favoritos_listings`; devuelve métricas de barrio | VIVO |
| `historial.py` | Historial de actividad del usuario | Lee tabla `historial` (lo ESCRIBE calculadora.py); `GET` vivo, `POST` sin cliente detectado | VIVO (GET) / DUDOSO (POST) |
| `visitas.py` | Solicitud de visita desde el drawer (lead calificado) | `INSERT visita_solicitud`; rutea al realtor PATROCINADOR de la zona (sponsorship); `user_events`; GHL por pull | VIVO |
| `barrio_page.py` | Página de comunidad de una comuna en 1 llamada | embajador + historias + 2 realtors patrocinadores; `asyncio.gather` 3 queries | VIVO |

> **Flujo del mapa**: `GET /listings` + `/viewport` sirven pines leyendo
> `stg_listings_unificado` + `listings_georef` (que **cache.py** reconstruye por hora;
> `listings_propios.py` inyecta al publicar). Click en pin → `/listings/{id}` llena el
> drawer → `POST /visitas` enruta el lead al realtor patrocinador. **`barrios.py` es el
> motor analytics** (`get_score_col` + tablas `analytics.barrios_*`) reusado por
> comunas/zonas/stats/oportunidades/calculadora.

### 5.6 Routers de usuarios / negocio / comunidad / GHL

| archivo | qué hace | cómo funciona + tablas | estado |
|---|---|---|---|
| `auth.py` | register/login/**Google OAuth (LIVE)**/magic-link/refresh/verify-email/forgot-reset | JWT propio + blacklist + `token_version`; habeas-data Ley 1581 obligatorio; `usuarios`, `*_tokens`, `token_blacklist`, `perfil_inversor` | VIVO |
| `usuario.py` | onboarding, perfil, config_mapa, suscribirse (newsletter) | `perfil_inversor`, `configuracion_mapa`, `leads` (si wants_agent) | VIVO |
| `tracking.py` | `POST /track` + `/track/impressions` (batch) | `get_optional_user` (anónimo), dedup IP/throttle; `user_events` (partición migr 0120), `user_sessions`; base del **embudo B2B** (consentimiento migr 0121) | VIVO |
| `realtor.py` | Dashboard Zillow: asignados, pool, listings, desempeño/ROI, agenda, inteligencia zona | `_agent_del_usuario`; `agent`, `intake`, `listing`, `sponsorship`, `visita_solicitud`, `user_events`; GHL `sync_listing` vivo | VIVO |
| `agency.py` | Owner de agencia: inbox, delegar, invitar/aceptar | `_agency_owner`; `agency`, `agency_member`, `agency_invite`; GHL `sync_agent` (pata bloqueada, no-op) | VIVO |
| `admin.py` | Dashboard, **funnel B2B**, usuarios, leads, aprobar eventos/tiendas/posts, destacados, audit-log | `require_admin` + `_audit` + re-auth; escribe `audit_log`, `eventos`, `tiendas`, `comunidad_post`; GHL `sync_tienda` vivo | VIVO |
| `admin_agentes.py` | Cola agentes: aprobar/rechazar/suspender, zonas (sponsorship) | `require_admin` + re-auth; `agent_service`, `zona_sponsor_service` | VIVO |
| `intake.py` | Crear intake, aceptar (crea listing+DD), due-diligence, cuestionario | `intake_service`, `due_diligence_service`; `intake`, `owner`, `listing`, `due_diligence_item` | VIVO |
| `moderacion.py` | Aprobar/rechazar listing, listar en-revisión | `require_admin`; `moderacion_service`; `listing`, `listing_media` | VIVO |
| `suscripciones.py` | Planes, iniciar, agente/registro, mi-plan, cancelar, webhook | **Pagos SIMULADOS** (`stripe_client.is_configured()`=false → `modo_manual`); compra real vía checkout GHL-hosted; `suscripciones_usuario`, `stripe_events` | VIVO (pago simulado) |
| `comunidad.py` | Eventos (barrio/municipio/todos), tiendas, ticker, noticias, submit eventos | `eventos`, `tiendas`, `deals`/`hotspots`, `noticias`; filtra activo/aprobado | VIVO |
| `comunidad_posts.py` | Blog self-serve: posts aprobados + submit | rate-limit + `require_safe_url`; `comunidad_post` (pendiente→admin) | VIVO |
| `business.py` | Planes negocio, aplicar, deals, hotspots, directorio, mi-negocio | `planes_negocio`, `leads_negocio`, `deals`, `hotspots`, `tiendas` | VIVO |
| `afiliados.py` / `embajadores.py` | Aplicar a programa afiliados / embajadores de barrio | `aplicacion_referidor`; GHL `sync_referidor` (pata bloqueada, no-op) | VIVO (pata GHL bloqueada) |
| `pasantias.py` | Aplicar a pasantía (convenio EAFIT) | `aplicaciones_pasantia` | VIVO |
| `alertas.py` | CRUD alertas de precio (Pro) | `alertas_precio`; el notificador vive en cron (`alertas_notificar.py`) | VIVO |
| `asignador.py` | `/intake/{id}/asignar` (admin), `/pool`, `/pool/{id}/tomar` | **pool/tomar DUPLICAN realtor.py** (el front usa los de realtor); asignar es acción manual de ops sin botón | DUDOSO (§11) |
| `link_review.py` | Página+POST de confirmación de link roto (token HMAC) | Caller = correos (no front); `listing` | VIVO (externo) |
| `ghl_leads.py` | **Pull API para Talal**: `GET /leads` | `X-API-Key` vs `GHL_LEADS_TOKEN` (cerrado→503); lee `visita_solicitud`+`usuarios`; es el **rodeo** a los bloqueos GHL | VIVO (externo) |
| `ghl_webhook.py` | Receptor de entrada GHL | **Los 7 handlers lanzan 501** esperando contrato Talal | **BLOQUEADO** |
| `trm.py` | Tasa COP/USD(EUR) | `trm_service`; cache 1h; `public.trm` | VIVO |

> **Flujo de monetización / GHL**: anónimo → tracking (`user_events`) → embudo B2B;
> login (Google OAuth LIVE) → onboarding → B2C **simulado** (checkout hosted en GHL) /
> B2B zona patrocinada (realtor registra → admin aprueba → sponsorship comuna/barrio).
> Con zona activa: owner crea intake → asignación → aceptar (listing+DD) → publicar →
> moderación → publicado; comprador pide visita (lead Zillow) que GHL consume por pull.
> **Salida GHL viva** para listing/tienda/agency. **BLOQUEADO** por contrato: creación
> de Contact (→ cae push_agent/referidor/owner), Appointments (→ push_visita), GHL
> Payments, y el webhook receptor. Ver [ADR-0004](adr/) y [GHL_CONTRATO_PROPUESTO.md](GHL_CONTRATO_PROPUESTO.md).

---

## 6. Scraping (`scraping/` + scrapers en `scripts/`)

**Flujo**: scrapers → `raw.*` → dbt unifica (`staging.stg_listings_unificado`) + computa
(`analytics.*`) → `api/cache.py` lee y sirve el mapa. La **comunidad** (eventos/noticias/
negocios) salta dbt: los routers leen `public.eventos`/`noticias`/`tiendas` directo. El
**link_checker** sondea URLs de todas las fuentes pero **nunca desactiva** nada — solo
`api/services/link_review` (clic humano) voltea `activo`, que es lo que cache.py filtra.

### 6.1 Listings (propiedad en venta/arriendo)

| módulo | fuente | cómo | tabla raw → consumidor | cadencia | estado |
|---|---|---|---|---|---|
| `metrocuadrado/scraper.py` | Metrocuadrado, 10 municipios | requests a REST interna; `X-Api-Key` auto-extraída del HTML (self-healing); lat/lon directos | `raw.listings_metrocuadrado` → dbt+cache | 08:00 diario | **VIVO** |
| `habi/habi_scraper.py` | habi.co, Valle | requests a API backend; filtra `Valle de Aburrá`; detalle Playwright best-effort; sin PII | `raw.listings_habi` | 08:00 diario | **VIVO** |
| `scripts/scrape_fincaraiz.py` (+load) | Fincaraíz | escribe JSON → `load_medellin_fincaraiz`/`load_valle_aburra` cargan | `raw.listings_fincaraiz` → dbt+cache | 03:00 diario | **VIVO** |
| `scripts/remates/scraper.py` | Remates judiciales | scraper + `aggregate_remates` | remates → dbt | 03:00 diario | **VIVO** |

### 6.2 Renta corta / media (orquesta `scripts/run_renta_corta.py`, secuencial por OOM)

| módulo | fuente | cómo | tabla → consumidor | estado |
|---|---|---|---|---|
| `renta_media/airbnb_mensual_scraper.py` | Airbnb mensual, 11 zonas | Playwright + intercepción `/api/v3/` | `raw.listings_renta_media` (airbnb_mensual) | **CONGELADO** (Playwright OOM en runs largos; `--detail-limit 50`) |
| `vrbo/vrbo_scraper.py` | VRBO, 10 zonas | curl_cffi impersona chrome124 (bypassa Akamai); GraphQL | `raw.listings_premium` (vrbo) | **VIVO** (frágil a IP) |
| `scripts/scrape_medellinliving.py` | MedellinLiving (agencia premium) | requests+BS4; `KNOWN_PROPERTY_PATHS` **hardcodeadas** (crawl 2026-05-30) | `raw.listings_premium` (agencia_premium) | **VIVO** (catálogo congelado) |
| `renta_media/nomadbarrio_scraper.py` | NomadBarrio | Playwright, parseo HTML Bubble.io | `raw.listings_renta_media` (nomadbarrio) | **ROTO** (~0 resultados) |
| `renta_media/flatio_scraper.py` | Flatio | Playwright, `__NEXT_DATA__`+regex | `raw.listings_renta_media` (flatio) | **ROTO** (render React rompe el parseo) |
| `renta_media/booking_scraper.py` | Booking ≥28 noches | Playwright | `raw.listings_renta_media` (booking) | **ROTO** (CAPTCHA aborta) |
| `airbnb/airroi_client.py` | AirROI (métricas STR por barrio) | requests a `api.airroi.io`; `cost_ledger` con tope; `--mock` | `raw.airbnb_barrios` → dbt `barrios_airbnb_real` | **VIVO** (necesita API key + créditos) |

> Enriquecedores one-off (no cron): `renta_media/enrich_airbnb_coords.py`,
> `enrich_barrio_ids.py` — rellenan coords/barrio_id faltantes vía Playwright.

### 6.3 Comunidad (orquesta `scraping/run_comunidad.py`, cada 6 h)

| módulo | fuente | cómo | estado |
|---|---|---|---|
| `eventos/cultura_eterea_scraper.py` | Cultura Etérea | requests a REST pública | **VIVO** (la más fiable) |
| `eventos/medellin_travel_scraper.py` | medellin.travel | requests WP REST; **devuelve lista** (no escribe DB) | **VIVO como librería** (persiste el normalizer) |
| `eventos/eventbrite_scraper.py` | Eventbrite | Playwright + intercepción `/api/v3/` | **VIVO** |
| `eventos/luma_scraper.py` | Lu.ma | Playwright, `__NEXT_DATA__` | **VIVO** (frágil Next.js) |
| `eventos/meetup_scraper.py` | Meetup | GraphQL si `MEETUP_TOKEN`, si no fallback Playwright | **VIVO con token** (sin token rinde poco) |
| `eventos/alcaldia_scraper.py` | Alcaldía Medellín | Playwright (Drupal) | **VIVO** (frágil selectores) |
| `eventos/tuboleta_scraper.py` | tuboleta.com | Playwright | **VIVO** (frágil layout) |
| `eventos/normalizer.py` | — | Normaliza categoría, geocodifica (Nominatim), asigna barrio (PostGIS), UPSERT `public.eventos` | infra |
| `eventos/backfill_categoria.py` | — | One-off ya cumplido (recategorizó 'tech') | **MUERTO/one-off** (§11) |
| `noticias/rss_scraper.py` | El Colombiano (Google News RSS) | feedparser + filtro keywords | `public.noticias` → **VIVO** |

### 6.4 Negocios / tiendas

| módulo | fuente | tabla → consumidor | estado |
|---|---|---|---|
| `tiendas/google_places_scraper.py` | Google Places (~25 categorías) | `public.tiendas` → `business.py` (negocios en el mapa) | **PAUSADO** (no en cron; manual por costo API) |
| `inmobiliarias/google_places_inmobiliarias.py` | Google Places `real_estate_agency` | **escribe CSV** (import GHL) — no DB ni cron | **MUERTO/manual** (herramienta B2B one-shot) |

### 6.5 Salud de links (`scraping/link_checker/`, 09:30 diario)

Paquete ejecutable `python -m scraping.link_checker`. **Nunca desactiva listings** — solo
marca `pending_review` para decisión humana. Módulos: `__main__` (CLI), `runner` (driver
batch + freno "mass-gone" >30% por fuente = cambio de layout, no delisting), `fetcher`
(httpx educado, `DomainPacer` 1 req/s), `classify` (ok/redirected/gone/blocked/error —
401/403/429=BLOCKED nunca gone), `state` (gone necesita 2 strikes ≥24h), `store` (escribe
solo `public.listing_link_health` + espejo `url_activa`), `config`, `alerts` (Sentry+webhook).

### 6.6 Utils de scraping (`scraping/utils/`)

`quality.py` (robots/UA, retry, `RunStats`, `implausible_reason` = mismos límites que
cache.py, `record_run`→`raw.scrape_runs` — solo pasadas ≥95% pueden vencer listings),
`dedup.py` (única definición del hash dedup, Python+SQL idéntico), `cost_ledger.py`
(`charge`→`raw.api_cost_ledger`, tope mensual AirROI/Places), `db.py` (helper psycopg2).

---

## 7. Pipeline de datos: scripts + dbt

**Dos rutas de ingesta**: (a) scraper → JSON en `scripts/data/raw/*.json` → loader → `raw.*`
(fincaraíz, remates, casadolcecasa); (b) scraper directo → `raw.*` (medellinliving;
metrocuadrado/habi viven en `scraping/`). Sobre `raw.*` operan **loaders de referencia**
(barrios, POIs, seguridad, catastro, estratos/POT, icfes, internet, ruido, tráfico) y
**mantenimiento** (dedup, stale, R2 mirror, traducción). Luego **compute PostGIS**
(`compute_barrios_pois`) y sobre todo **dbt** construyen `staging.*`/`analytics.*`.
`api/cache.py` sirve esas tablas a la app.

### 7.1 Orquestadores de cron (`scripts/`)

| script | qué hace | invoca | cadencia |
|---|---|---|---|
| `refresh_data.py` | Pipeline fincaraíz + remates + agregación | scrape_fincaraiz → load_medellin_fincaraiz/load_valle_aburra, remates/scraper+aggregate, aggregate, run_comunidad | 03:00 diario |
| `run_listings_metrocuadrado.py` | metrocuadrado+habi+dedup+stale+R2+dbt | scraping.metrocuadrado, scraping.habi, dedup_fincaraiz, deactivate_stale_listings, enrich_barrios_stats, mirror_listings_media, dbt_run | 08:00 diario (completo dom) |
| `run_renta_corta.py` | 6 scrapers de renta (secuencial, anti-OOM) | airbnb_mensual, vrbo, scrape_medellinliving, nomadbarrio, flatio, booking | 09:00 c/3d |
| `run_airbnb_semanal.py` | AirROI por barrio + dbt scores STR | `scraping.airbnb.airroi_client` + dbt_run `barrios_airbnb_real score_corto_plazo barrios_score_consolidado` | 08:00 dom |
| `run_seguridad_mensual.py` | Criminalidad + dbt | load_seguridad + dbt_run | día 1, 12:00 |
| `run_dbt_full_refresh.py` | Rebuild total dbt + test | dbt_run `run --full-refresh` + `test` | lun 07:30 |
| `run_analytics_usuarios.py` | Partición user_events + user_interests | SQL asyncpg | 07:00 diario |
| `dbt_run.py` | Shim que invoca `dbt` (parsea DATABASE_URL→POSTGRES_*) | motor de todos los modelos | mié 10:00 (scores) + vía orquestadores |
| `run_job.py` | **Wrapper de cada job**: graba `raw.cron_runs` + alerta (§4) | — | cada job |

### 7.2 Loaders de datos (`scripts/load_*`, `seed_*`)

Casi todos son **manuales / one-shot** (recarga de dato de referencia estático) — su data
se carga una vez y `compute_barrios_pois`/dbt solo la leen. Excepciones en cron vía
orquestador: `load_medellin_fincaraiz`, `load_valle_aburra` (vía `refresh_data`),
`load_seguridad` (vía `run_seguridad_mensual`), `load_barrios`, `load_pois` (cron directo).

| script | escribe | fuente | estado |
|---|---|---|---|
| `load_barrios.py` | `raw.barrios` | ArcGIS FeatureServer | VIVO-CRON (día 1) |
| `load_pois.py` | `raw.pois` (**TRUNCATE**+11 tipos), `analytics.barrios_pois_distancia` | OSM Overpass | VIVO-CRON (lun) — ⚠️ ver §7.6 |
| `load_pois_overpass.py` | `raw.pois` (**upsert** `ON CONFLICT`, 9 tipos ricos: colegio/supermercado/farmacia/paradero/cancha/encicla/policia/bomberos/parque_infantil) | OSM Overpass | VIVO-MANUAL — ⚠️ ver §7.6 |
| `load_seguridad.py` | `raw.criminalidad` (Medellín) | medata.gov.co CSV | VIVO-CRON (vía orq.) |
| `load_seguridad_otros_municipios.py` | `raw.criminalidad` (municipios, estimado) | hardcoded (Policía 2022) | VIVO-MANUAL |
| `load_catastro_medellin.py` | `raw.catastro_medellin` (Hoja1) | CSV local | VIVO-MANUAL |
| `load_catastro_medellin_vigente.py` | `raw.catastro_medellin` (Hoja2, `cd_vig_pred='S'`) | CSV local | VIVO-MANUAL |
| `load_compraventas_orips.py` | `raw.compraventas_orips` + refresh MV | CSV SNR (auditable) | VIVO-MANUAL |
| `load_estratos_pot.py` | `raw.estratos_manzana`, `raw.pot_usos_medellin` | geojson (EPSG:9377→4326) | VIVO-MANUAL |
| `load_icfes_municipio.py` | `raw.icfes_municipio` | Socrata (Saber 11) | VIVO-MANUAL (insumo compute_barrios_pois) |
| `load_internet_speed.py` | `raw.internet_speed_tiles` | Ookla parquet S3 | VIVO-MANUAL (trimestral) |
| `load_ruido_siata.py` | `raw.ruido_estaciones` | SIATA geoportal | VIVO-MANUAL |
| `load_routing_here.py` | `analytics.zona_tiempos_recorrido` | HERE Routing v8 | VIVO-MANUAL (estático) |
| `load_traffic_here.py` | `analytics.barrios_congestion` | HERE Traffic Flow v7 | VIVO-MANUAL |
| `load_casadolcecasa.py` | `raw.listings_casadolcecasa` | JSON de `scrape_casadolcecasa` | DUDOSO (no cableado; corrido a mano) |
| `load_medellin_fincaraiz.py` | `raw.listings_fincaraiz` (Medellín) | JSON de scrape_fincaraiz | VIVO-CRON (vía refresh_data) |
| `load_valle_aburra.py` | `raw.barrios`, `raw.listings_fincaraiz` (5 satélite) | geojson + JSON | VIVO-CRON (vía refresh_data) |
| `seed_obras_publicas.py` | `raw.obras_publicas_planeadas` | lista hardcoded (prensa) | VIVO-MANUAL (insumo compute_barrios_pois) |

### 7.3 Compute analytics (`scripts/compute_*`, `trafico_*`)

| script | escribe | estado |
|---|---|---|
| `compute_barrios_pois.py` | `analytics.barrios_pois_distancia` (distancias/conteos POI + internet/ruido/icfes/obra) | **VIVO-CRON** (lun, tras `load_pois &&`) — único compute_* en cron |
| `compute_uso_suelo_barrio.py` | `raw.barrios.uso_suelo_*` (uso POT dominante) | VIVO-MANUAL |
| `compute_trafico_perfil.py` | `analytics.barrios_trafico_perfil` | VIVO-MANUAL (fin de campaña) |
| `trafico_muestrear.py` | `raw.trafico_muestras` (muestreo HERE para campaña) | VIVO-MANUAL |
| `compute_barrios_airbnb.py` | `analytics.barrios_airbnb_real` | **MUERTO** — dbt lo produce; además con **drift** (`n_private_home`≠`n_private_room` de la API) |
| `compute_barrios_verde.py` | `analytics.barrios_verde` | **MUERTO** — dbt lo produce |
| `compute_oportunidades.py` | `analytics.barrios_oportunidades` | **MUERTO** — dbt lo produce, con lógica stale |

> Los 3 compute_* MUERTOS: dbt emite un **superconjunto** de las columnas que la API lee
> (verificado columna por columna). No están en ningún cron. **Candidatos a borrar** (§11).

### 7.4 Scrapers directos + mantenimiento + build

| script | rol | estado |
|---|---|---|
| `scrape_fincaraiz.py` | Fincaraíz → JSON | VIVO-CRON (vía refresh_data) |
| `scrape_medellinliving.py` | Agencia premium → `raw.listings_premium` | VIVO-CRON (catálogo hardcoded, congela) |
| `scrape_casadolcecasa.py` | WordPress/Directorist → JSON | DUDOSO (no cableado) |
| `fetch_usd_rate.py` / `fetch_trm.py` | Tasa USD / TRM oficial (USD+EUR) → `raw.parametros_sistema` / `public.trm` | VIVO-CRON |
| `alertas_notificar.py` | Email de alertas de precio con matches nuevos | VIVO-CRON (14:00) |
| `sweep_asignados.py` | Libera intakes vencidos (24h) al pool | VIVO-CRON (c/hora) |
| `data_quality_check.py` | QC frescura/volumen/fotos → `raw.data_quality_runs`, exit 1 si falla | VIVO-CRON (13:00) |
| `qc_report.py` | Reporte QC de scrapers por email | VIVO-CRON (15:00 c/3d) |
| `translate_descripciones.py` | Traduce descripciones es→en (incremental) → `raw.descripcion_traduccion` | VIVO-CRON (05:30) |
| `traductor.py` | Librería Opus-MT/CTranslate2 offline (bakeada en build) | VIVO (lib) |
| `dedup_fincaraiz.py` | Soft-dedup fincaraíz (marca, no borra) | VIVO-CRON (vía orq.) |
| `deactivate_stale_listings.py` | Baja listings viejos (`activo=FALSE`) con freno de masa | VIVO-CRON (vía orq.) |
| `mirror_listings_media.py` | Espejo de portadas a Cloudflare R2 (content-addressable) | VIVO-CRON (vía orq.) |
| `cron_status.py` | Lector on-demand de `raw.cron_runs` ("tráeme los logs") | VIVO-MANUAL (ops) |
| `generate_db_schema_docs.py` | Genera `DATABASE_SCHEMA.md` + `.dbml` por introspección | VIVO-MANUAL (regenerable) |
| `validate_catastro_join.py` | Valida cobertura barrios↔catastro | VIVO-MANUAL |
| `download_comunas.py` / `gen_comunas_municipios.py` | Polígonos de comunas → `public/data/*.geojson` | VIVO-MANUAL (one-shot) |
| `aggregate.py` + `remates/aggregate_remates.py` | Agregan listings/remates → `data/processed/*.json` | **DUDOSO en efecto** (§7.6) |
| `enrich_barrios_stats.py` | Exporta `analytics.*` → `public/data/barrios_stats.json` | **DUDOSO en efecto** (§7.6) |
| `update_ts.py` | Regenera `src/data/*.ts` desde JSON (codegen de build) | VIVO-MANUAL (excluido de cron) |
| `fetch_airbnb_otros_municipios.py` | n_listings Airbnb no-Medellín (AirROI) | VIVO-MANUAL |
| `fetch_airbnb_str_ids.py` | Descubre IDs Airbnb (Playwright) | VIVO-MANUAL **local-only** (hardcodea `LD_LIBRARY_PATH` de conda → no corre en Railway) |
| `config.py` | Config de municipios/barrios/coords (librería) | VIVO (lib) |

### 7.5 dbt — linaje `raw → staging → analytics`

Proyecto `dbt/` (perfil `urbidata`, target `prod`). Default de materialización: staging y
analytics = `table`; **3 modelos lo bajan a `view`** (`stg_airbnb_amenities`,
`comparador_renta`, `embudo_zona`). Orquestación: `run_dbt_full_refresh` (lun, todos),
`run_airbnb_semanal` (dom, scores STR), `dbt_run run --select score_largo_plazo
barrios_score_consolidado` (mié, post-remates).

**Staging (6):** `stg_listings` (fincaraíz+metrocuadrado limpios, outliers p05–p95),
`stg_listings_unificado` (UNION 5 fuentes + dedup DBSCAN 40 m — lo lee `comparador.py`
directo), `stg_airbnb_amenities`, `stg_airbnb_segmentado` (corta/media/larga),
`stg_seguridad` (índice por comuna, población DANE), `stg_valorizacion` (IPVN DANE + IPVU Banrep).

**Analytics — el motor de scoring:**

```
barrios_mercado  (TABLA CENTRAL: precios p25/50/75, yield, "precio justo" por estrato)
  ├─ score_corto_plazo   (Airbnb)    ─┐
  ├─ score_mediano_plazo (Nómadas)   ─┼─► barrios_score_consolidado ─► barrios_oportunidades
  └─ score_largo_plazo   (Arriendo)  ─┘        (fuente principal del mapa)
barrios_seguridad · barrios_liquidez · barrios_verde · barrios_amenities · barrios_airbnb_real
proyecciones_valorizacion · listings_vs_catastro · zonas_nivel_precio (precio de patrocinio A/B/C/D)
```

| modelo analytics | consumidor API | estado |
|---|---|---|
| `barrios_mercado` | cache, barrios, stats, realtor, favoritos, calculadora, oportunidades, comunas | VIVO (central) |
| `barrios_score_consolidado` | cache, stats, oportunidades, comunas, calculadora, barrios, favoritos | VIVO (mapa) |
| `score_largo_plazo` / `score_mediano_plazo` | cache / barrios / calculadora | VIVO |
| `score_corto_plazo` | (solo dbt → consolidado) | VIVO (intermedio) |
| `barrios_seguridad` · `barrios_liquidez` · `barrios_verde` · `barrios_amenities` | barrios, cache, listings, oportunidades | VIVO |
| `barrios_airbnb_real` | barrios, calculadora | VIVO |
| `barrios_oportunidades` | stats, barrios, oportunidades | VIVO |
| `proyecciones_valorizacion` | barrios | VIVO |
| `listings_vs_catastro` | listings | VIVO |
| `zonas_nivel_precio` | zonas, zona_sponsor_service | VIVO |
| `barrios_renta_media` / `barrios_renta_segmentada` | (solo dbt intermedio) | VIVO (intermedio) |
| `barrios_score` | **nadie** | **MUERTO** (legacy monolítico, reemplazado por score_*_plazo) |
| `barrios_top10_yield` | **nadie** | **MUERTO** (huérfano) |
| `comparador_renta` | **nadie** (comparador.py usa `barrios_medianas`, no dbt) | **MUERTO** (huérfano) |
| `embudo_zona` | **nadie en API** (panel interno) | DUDOSO (sin consumidor) |

**Capa analytics NO-dbt (paralela, producida por scripts/alembic):** varias tablas
`analytics.*` que la API usa mucho NO son modelos dbt — `barrios_cd` (mapeo barrio→comuna,
migr alembic 0060/0061/0062/0104), `listings_georef` + `barrios_medianas` + `barrios_contexto`
(cache.py / `enrich_barrios_stats`), `barrios_pois_distancia` (`compute_barrios_pois`),
`zona_tiempos_recorrido`, `barrios_congestion`, `barrios_trafico_perfil`,
`compraventas_municipio_stats`, `catastro_comunas_stats`. Conviven con dbt; el orden lo
garantiza el cron, no el DAG de dbt.

### 7.6 Problemas conocidos del pipeline (⚠️ accionables)

1. **BUG — `load_pois` borra los POIs ricos cada lunes.** `load_pois.py` (cron lun 04:00)
   hace `TRUNCATE TABLE raw.pois RESTART IDENTITY` y recarga **solo 11 tipos**. Los **9
   tipos ricos** que solo aporta `load_pois_overpass.py` (manual, upsert) — colegio,
   supermercado, farmacia, paradero_bus, parque_infantil, cancha, encicla, estacion_policia,
   bomberos — **se borran cada lunes**. Acto seguido `compute_barrios_pois` calcula
   `n_colegios_1km`, `n_canchas_1km`, `dist_encicla_km`, `n_policia_1km`, `n_bomberos_2km`…
   sobre una tabla sin esos POIs → quedan 0/NULL hasta re-correr `load_pois_overpass` a mano.
   Es exactamente el GOTCHA de [CLAUDE.md](../CLAUDE.md) ("dos scripts escribiendo la misma
   tabla donde uno hace TRUNCATE pisa al otro"). ✅ **Corregido 2026-11-08**: se encadenó
   `load_pois_overpass` (que hace UPSERT de los 20 tipos) entre `load_pois` y
   `compute_barrios_pois` en el cron del lunes (`Dockerfile.cron`), así los 9 POIs ricos
   existen antes del compute.
2. **JSON legacy que corre pero nadie lee en runtime.** `aggregate`, `remates/aggregate_remates`
   (vía `refresh_data`) y `enrich_barrios_stats` (vía `run_listings_metrocuadrado`, con label
   engañoso "refresh_analytics") escriben `data/processed/*.json` y `public/data/barrios_stats.json`.
   Pero el único consumidor de esos JSON es `update_ts.py` (codegen de **build**, excluido del
   cron) y el `public/` servido se hornea en el **build del frontend**, no en el contenedor cron
   efímero. → corren a diario y producen archivos que nadie sirve. Son codegen de build mal
   ubicado en el cron de datos.
3. **`sources.yml` stale**: atribuye `valorizacion.indices_precio_vivienda` a
   `scripts/load_ipvn.py` + `scripts/fetch_ipvu_banrep.py`, **que no existen** en `scripts/` hoy.
4. **Docstring stale**: `load_pois.py` dice "5 tipos" pero carga 11.

---

## 8. Frontend (`src/`)

**Routing**: TanStack Router **file-based** — cada `src/routes/*.tsx` exporta
`Route = createFileRoute('/ruta')({...})`; el árbol se autogenera en `src/routeTree.gen.ts`
(no editar a mano). `_` corta herencia de layout (`agentes_.registro`, `planes_.deal`);
`$` = parámetro dinámico (`listing.$id`, `barrio.$slug`). **Guards**: `beforeLoad()` →
`redirect({to:"/login"})` o `navigate` en el componente.

**Capa de datos**: endpoints centralizados en **`src/config/api.ts`** (`API_ENDPOINTS`,
`API_BASE_URL` por entorno: `localhost:8011/api/v1` en dev, Railway en prod vía `VITE_API_URL`).
Se consume vía: hooks `src/hooks/*` (useListings, useBarrios, useDeals, useDirectorio,
useNoticias, useEventosZona…), **`src/lib/realtorApi.ts`** (todo `/realtor/*` + `/agency/*`),
`src/lib/auth.ts`+`useAuth.ts` (auth), `src/lib/adapters.ts` (normalización). `__root.tsx`
emite `page_view` (tracking) en toda ruta.

| grupo | rutas | consume | notas |
|---|---|---|---|
| **Mapa + MLS** | `/map` (el MLS Mapbox real, ~91k pines), `/` (home de comunidad, no el mapa), `/real-estate` (SEO), `/listing/$id`, `/barrio/$slug` | listings, barrios, comunasGeoJSON, ciudadStats, barrio-page | VIVO |
| **Comunidad** | `/eventos/$slug`, `/local-business/$slug`, `/negocios/unirse`, `/blog`; `/comparador` + `/simulador` (auth) | comunidad/eventos·tiendas·noticias, business, calculadora/comparador | `/comunidad`→eventos, `/stores`→local-business, `/calculadora`→simulador (redirects) |
| **Cuenta/Auth** | `/login` (email+Google+magic), `/register` (+ConsentFields), `/perfil`, `/forgot`·`/reset`·`/verify-email`, `/login/verificar`, `/onboarding` | auth/*, usuario/* | VIVO |
| **Monetización/Dueño** | `/planes` + `/planes/{deal,featured-realtor,hot-spot,listing-member}` (marketing, CTA mailto/WhatsApp), `/suscribirse`, `/publicar` (OTP tel, sin login), `/vender`, `/mis-propiedades` | listingsPropios*, usuario/suscribirse | `/planes/*` = **venta manual** (sin checkout). `/suscripcion/exito`·`/cancelada` = **DUDOSO** (retornos Stripe que hoy no se disparan) |
| **Realtor/Agency** | `/agentes` (directorio), `/agentes/registro`, `/conectar-agente`, `/solicitudes`, `/realtor/dashboard` (panel Zillow + compra de zonas), `/realtor/agency-dashboard`, `/realtor/accept-invite` | agentesDirectorio, realtorApi.*, zonasDisponibles/checkout | dashboard VIVO (pago **simulado**) |
| **Programas** | `/afiliado`, `/embajador`, `/pasantias` | afiliados/embajadores/pasantias `/aplicar` | VIVO (forms de lead) |
| **Legal/Admin** | `/politica-privacidad`, `/panel-x9k2` (**admin oculto**, URL ofuscada: ~20 endpoints admin*) | admin* | panel = auth+admin (403 si no admin) |

---

## 9. Modelo de negocio

**Qué es.** El mapa inmobiliario de referencia del **Valle de Aburrá** (10 municipios):
hoy **~91.457 propiedades reales** (venta/arriendo/corto plazo) con foto, barrio, precio
COP+USD, historial y días en mercado. **Tesis central (pivot 29-jun-2026): el MLS es
gratis** — sin "plan Pro" que esconda datos básicos. Visión: cada zona (comuna/barrio)
tiene **un agente verificado que la representa**; los agentes compiten por visibilidad, no
por ocultar información. La riqueza de datos es asimétrica: capas base (precio, foto, POIs,
historial) cubren los 10 municipios; capas ricas (estrato por manzana, uso de suelo, avalúo,
seguridad por barrio ≈335/610) existen **casi solo para Medellín** (271 barrios con fronteras
finas vs. municipios externos con solo el contorno).

**Monetización — tres fuentes:**
1. **Agente patrocinado por zona** (recurrente, exclusividad: un patrocinador activo por
   zona). Fuente de verdad del código: `api/services/zona_sponsor_service.py` →
   `PRECIO_COMUNA=1_000_000`, `PRECIO_BARRIO=200_000` × `NIVEL_MULTIPLICADOR` A/B/C/D =
   2.0/1.4/1.0/0.6 (C=base, D=descuento para mover zonas de baja demanda).
2. **Listing/Propiedad Destacada** (pago único; posicionamiento para compradores en USD +
   recomendación de precio + analítica).
3. **Featured realtor / hot-spot / listing-member** (landings `/planes/*`, hoy venta
   **manual** por mailto/WhatsApp, sin checkout).

> ⚠️ **DISCREPANCIA DE PRECIOS a reconciliar** (no inventar un número, documentar ambos):
> los docs ([MISION_VISION.md](MISION_VISION.md), [ESTADO_…23.md](ESTADO_MEDELLIN_SOCIAL_2026-10-23.md))
> dicen **USD $1.000/mes comuna · USD $200/mes barrio · Destacado USD $1.000 único**. El
> código usa `1.000.000` / `200.000` **sin etiqueta de moneda**, y `realtor/dashboard.tsx`
> los renderiza con `formatCOP(...)/mes` → el front los trata como **COP**. Es decir comuna
> nivel C = $1.000.000 COP/mes (≈USD $250), barrio nivel C = $200.000 COP/mes (≈USD $50) —
> **~4× por debajo** de lo que prometen los docs. Alguien confundió "1.000.000 COP" con
> "USD $1.000". Hay que decidir cuál es la verdad.

El doc [Medellin-Social-Programa-Inmobiliario-ES.md](Medellin-Social-Programa-Inmobiliario-ES.md)
añade un **tarifario de agente paralelo aún NO implementado**: registro $25 único + $5/aviso;
certificación $99 único + $25/mes (5 avisos incl.) + $5/extra; ilimitado $99/mes. **Sin
comisión de cierre** en ningún caso.

**Estado de pagos: construido pero apagado (simulado).** El sistema de agentes está completo
de punta a punta (bandeja de prospectos tipo Zillow, panel de resultados, patrocinio
autogestionado, asignación a pool, agenda, "Agente Certificado" solo por admin), pero **(a)
no hay agentes reales en producción** y **(b) ningún peso cambia de manos**: el checkout de
zona es simulado (gate `STRIPE_SECRET_KEY`), los links de pago vacíos, y la decisión es
**migrar el cobro a GHL** (no a las pasarelas construidas) — migración pendiente.
**Deuda legacy**: `api/config/planes.py` aún define planes **"pro" (USD $29)** y **"agente"
(USD $59)** con `suscripciones.py /iniciar` (Stripe) vivos en código pero **huérfanos de
funnel** — residuo del modelo viejo (el plan-Pro de usuario murió en el pivot; "agente $59"
lo reemplazó el patrocinio de zona). A marcar legacy/limpiar.

**Embudo B2B** ([FUNNEL_B2B.md](FUNNEL_B2B.md)): dos embudos. **Funnel 1 (Demanda)** = el que
se vende: viaje de la audiencia sobre una entidad en 5 etapas — **Alcance** (`impression`,
viewable ≥50%/≥1s, batch a `/track/impressions`), **Interés** (`*_view`), **Intención**
(`*_wa_click`, `listing_save`), **Lead** (`visit_request`, `listing_contact_wa`),
**Conversión** (`conversion`). **Funnel 2 (Ventas)**: Prospecto→Calificado→Pitcheado→Cliente
(paga vía GHL)→Retenido. El valor se crea cerrando a un negocio/realtor **mostrándole su
propio Funnel 1** ("340 te vieron, 85 dieron click a WhatsApp → te damos el slot"). Atribución
honesta: son **sesiones/engagements, no personas únicas** (los leads de `/suscribirse` nunca
loguean). Falta: rollup `funnel_daily` + dashboard, conversión de avisos scrapeados (bloqueada
por sync GHL), `deal_redeem_click`.

**Proyecto hermano Panamá.** El producto está diseñado **replicable ciudad por ciudad**
(discriminador `ciudad_id`, no community_id — ver [ADR-0001](adr/adr-0001-ciudad-id-multi-ciudad.md)).
**Panamá Social** es la primera réplica (rama `feat/panama-mvp`, geografía ANATI LIVE en DEV),
misma arquitectura de mapa gratis + monetización por zona + red de referidos.

---

## 10. Decisiones de arquitectura (ADRs)

Registros en [`docs/adr/`](adr/). Capturan el *por qué* de decisiones que el código no
explica solo:

| ADR | Decisión |
|---|---|
| [ADR-0001](adr/adr-0001-ciudad-id-multi-ciudad.md) | Multi-ciudad por `ciudad_id`, NO `community_id` (Panamá y futuras réplicas) |
| [ADR-0002](adr/adr-0002-reproducible-dev-prod.md) | Todo cambio de datos vive en alembic/cron/dbt versionado, nunca script manual |
| [ADR-0003](adr/adr-0003-cache-swap-table.md) | `cache.py` usa swap-table (no TRUNCATE+INSERT) para no bloquear el mapa |
| [ADR-0004](adr/adr-0004-ghl-bloqueado-pull.md) | Integración GHL: salida construida, Contact/Appointments/Payments bloqueados; rodeo = pull API |
| [ADR-0005](adr/adr-0005-dos-stacks-publicacion.md) | Dos stacks de publicación (tabla `listing` nueva vs `listings_propios`/`agentes` legacy) |
| [ADR-0006](adr/adr-0006-analytics-dbt-vs-scripts.md) | Capa analytics partida: dbt + tablas no-dbt (scripts/alembic) conviven |
| [ADR-0007](adr/adr-0007-pagos-via-ghl.md) | Pagos simulados; cobro real se migra a GHL, no a Stripe (ambos construidos pero apagados) |

---

## 11. Archivos sin conexión / candidatos a limpieza

> Consolidado de las 8 auditorías. **Convención git**: **T** = tracked (recuperable con
> git) · **U** = untracked (**pérdida permanente** si se borra — mover fuera del repo si
> se quiere reversibilidad). Nada aquí se borra sin tu OK.

> ✅ **Aplicado 2026-11-08:** la tabla 11.1 completa se **borró** (`git rm`: `api/config.py`,
> 3 `compute_*`, `backfill_categoria.py`, 3 modelos dbt + sus bloques en `schema.yml`,
> `INVENTARIO_DATOS.pdf`). Los 4 docs MUERTO untracked de §11.3 se movieron a scratchpad
> trash (reversible). El bug de `load_pois` (§11.4/§7.6) se **corrigió** en `Dockerfile.cron`.
> `DATABASE_SCHEMA.md` se **regeneró** (138 tablas). La tabla 11.1 se conserva abajo como
> registro del *por qué* se borró cada uno.

### 11.1 Código MUERTO (borrado 2026-11-08)

| archivo | por qué | reemplazo |
|---|---|---|
| `api/config.py` (archivo) | Sombreado por el paquete `api/config/` (define USD+EUR); nadie lo alcanza. Si lo alcanzara, `trm_service` daría ImportError y la app no arrancaría → prueba de que está muerto | el paquete `api/config/` |
| `scripts/compute_barrios_airbnb.py` | dbt `barrios_airbnb_real` lo produce; además **drift** (`n_private_home`≠`n_private_room`). No en cron | dbt |
| `scripts/compute_barrios_verde.py` | dbt `barrios_verde` lo produce. No en cron | dbt |
| `scripts/compute_oportunidades.py` | dbt `barrios_oportunidades` lo produce (lógica stale en el script). No en cron | dbt |
| `dbt/models/analytics/barrios_score.sql` | Score monolítico legacy; ningún router ni modelo downstream lo lee | score_corto/mediano/largo + consolidado |
| `dbt/models/analytics/barrios_top10_yield.sql` | Huérfano, nadie lo consume | — |
| `dbt/models/analytics/comparador_renta.sql` | Huérfano; `comparador.py` usa `barrios_medianas` (no-dbt), no este modelo | `barrios_medianas` |
| `scraping/eventos/backfill_categoria.py` | One-off ya cumplido (recategorizó 'tech') | — |

> **Verificado por grep** (2026-11-07): los 3 modelos dbt y `api/config.py` no tienen
> consumidor en runtime — `barrios_score`/`barrios_top10_yield`/`comparador_renta` solo
> aparecen en el whitelist de `generate_db_schema_docs.py` (enumeración de tablas, no uso);
> `api/config.py` lo sombrea el paquete `api/config/` (los imports resuelven al paquete, que
> es el único con `EUR_TO_COP`). Antes de borrar un modelo dbt, confirmar que el
> `--full-refresh` no lo necesita como dependencia intermedia.

### 11.2 Código DUDOSO (verificar antes de tocar)

| archivo / endpoint | duda |
|---|---|
| `api/routers/asignador.py` `/pool` + `/tomar` | Duplican `realtor.py` (el front usa los de realtor); `/asignar` es acción manual de ops sin botón |
| `api/routers/listings_propios.py` `/solicitudes` + `/agentes-para-contactar` | Leen tablas **legacy** `public.agentes`/`agente_solicitudes` (sistema viejo "contactar agente", separado de la tabla `listing` nueva) — ver [ADR-0005](adr/adr-0005-dos-stacks-publicacion.md) |
| `api/routers/historial.py` `POST` | Sin cliente detectado (lo escribe `calculadora.py` directo) |
| `dbt/.../embudo_zona.sql` | Vista sin consumidor en API (¿panel interno futuro?) |
| `scripts/aggregate.py`, `remates/aggregate_remates.py`, `enrich_barrios_stats.py` | Corren en cron pero su salida JSON solo la lee `update_ts.py` (codegen de build, excluido del cron) → archivos que nadie sirve en runtime (§7.6) |
| `scripts/scrape_casadolcecasa.py` + `load_casadolcecasa.py` | No cableados en cron/orquestador; corridos a mano |
| `scripts/fetch_airbnb_str_ids.py` | Local-only (hardcodea `LD_LIBRARY_PATH` de conda; no corre en Railway) |
| `api/config/planes.py` planes "pro"/"agente" + `/suscripcion/exito`·`/cancelada` | Legacy del modelo viejo (pre-pivot), huérfanos de funnel — ver [ADR-0007](adr/adr-0007-pagos-via-ghl.md) |

### 11.3 docs/ — ronda 2 (lo que queda tras la ronda 1)

**MUERTO (recomendado borrar):**

| archivo | git | por qué |
|---|:--:|---|
| `rail 1.png`, `rail2.png` | **U** | 2 screenshots sueltos, 0 referencias en el repo |
| `ALL-ISSUES.pdf` | **U** | Issues ya resueltos; su `ALL-ISSUES-STATUS.md` se borró en ronda 1 |
| `PROMPT_AUDITORIA_DATOS_SCOPE.md` | **U** | Prompt one-off ya ejecutado; sus fuentes ya se borraron |
| `INVENTARIO_DATOS.pdf` | T | Export PDF congelado del `.md` que sigue vivo (duplicado) |

**DUDOSO (tu decisión — cluster de partner/expansión):**

`EASE Product and Pricing Schedule.xlsx` (U) + su `.csv` (T), `EASY Street SOPs SOW.txt`,
`Paquete_…Panama_Social_ES.txt`, `Copia de Usefull sites…Panama.docx` (U),
`MEDELLÍN SOCIAL – CERTIFIED REALTOR PROGRAM.txt`, `GHL_DB_SCHEMA_FIELDS.pdf`, los **5
landings HTML** (`01_Subscriber…05_EAFIT`, 0 referencias — mockups), `prompt_alcance_monetario.md`
(su versión llena se borró), `archive/apartamentos_valle_aburra.pdf`. **Duplicación a
resolver**: `Medellin-Social-Programa-Inmobiliario-ES` existe como `.md` y `.docx` (mismo
contenido) — quedarse con uno.

> Estos son docs de partner (EASE/EasyStreet) o de expansión (Panamá) — **vivos solo si
> esas agendas siguen**. Memoria del proyecto dice: Panamá es proyecto hermano **activo** y
> "Certified Realtor Program" es **spec futura**, así que la recomendación por defecto es
> **conservarlos**.

**KEEP (vivos / referencia):** `ARCHITECTURE.md` (este), `MISION_VISION.md`,
`SCOPE_DATOS_2026-10-22.md`, `DATABASE_SCHEMA.md` + `database/*.dbml`, `INVENTARIO_DATOS.md`,
`INFRAESTRUCTURA.md`, `GHL_CONTRATO_PROPUESTO.md`, `GHL_ENDPOINTS_FUNNEL_STATUS.md`,
`GHL_TALAL_TEST_HANDOFF.md`, `GOOGLE_AUTH_SETUP.md`, `FUNNEL_B2B.md`, `RESUMEN_LEGAL_DATOS.md`,
`ESTADO_MEDELLIN_SOCIAL_2026-10-23.md`, `Medellín Social — To-do.md` + `Pendientes y roles.md`,
`estratos.md`, `indice_verde.md`, `TUTORIAL_NAVEGACION.md`, `Medellin-Social-GHL-Architecture.pdf`,
`panel-resultados-realtor.pdf`.

### 11.4 Bugs / deuda de datos accionable (detalle en §7.6)

1. ✅ **CORREGIDO 2026-11-08** — `load_pois` TRUNCATE borraba los 9 POIs ricos cada lunes → columnas colegio/cancha/policía/bomberos en 0/NULL. Fix: `load_pois_overpass` encadenado en el cron.
2. **`sources.yml`** atribuye la valorización a `load_ipvn.py`/`fetch_ipvu_banrep.py` que **no existen**.
3. **Discrepancia de precio de zona** código (COP) vs docs (USD), ~4× (§9).
4. **Drift de schema docs**: `DATABASE_SCHEMA.md` es de agosto (~15+ migraciones de atraso) — regenerar con `scripts/generate_db_schema_docs.py`.
