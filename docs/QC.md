# QC — Control de calidad y observabilidad del cron

Doc vivo. Objetivo: **que nada falle en silencio**. Cada scraper/script del cron
queda registrado (corrió, cuánto tardó, con qué resultado) y, si revienta, avisa.

> **Cómo usar este doc:** cuando agregues un job, una alerta o descubras un
> gotcha de QC, anótalo acá — tabla de jobs + bitácora al final. Es el índice
> único de "qué vigila qué".

Relacionado: [ARCHITECTURE.md](ARCHITECTURE.md) (qué hace cada script), proceso
DEV→PROD en [CLAUDE.md](../CLAUDE.md).

---

## 1. Las 2 capas

El cron puede fallar de dos formas distintas. Una sola capa no las cubre ambas:

| Capa | Detecta | Cómo | Pieza |
|---|---|---|---|
| **1 — crash** | el script reventó / salió ≠0 / ni arrancó | exit code del job | `run_job.py` (wrapper) |
| **2 — no-op** | corrió verde (exit 0) **pero no produjo nada** | frescura/volumen/fotos en la DB | `qc_report.py`, `data_quality_check.py` |

Un crash NO lo ve la capa 2 (la tabla simplemente no se actualizó, puede parecer normal).
Un "corrió y no hizo nada" NO lo ve la capa 1 (exit 0). Necesitamos las dos.

---

## 2. Componentes

### `scripts/run_job.py` — el wrapper (capa 1)
Envuelve **cada** línea del crontab: `run_job.py <nombre> <cmd...>`.
- Graba la corrida en `raw.cron_runs` (fila de inicio → fila de fin).
- Reemite la salida al logfile (`/var/log/urbi/<job>.log`).
- Si el job revienta o sale ≠0 → alerta (Sentry/webhook) con las últimas 50 líneas.
- Si no hay canal de alerta → lo **grita en el log** (no se calla).
- **La instrumentación nunca rompe el job**: todo DB/alerta en try/except, propaga el exit real del hijo (los `&&` del cron siguen funcionando).

Límites conocidos: solo guarda 50 líneas (tail) en DB; sin timeout por job (un
cuelgue se ve como ZOMBIE, no se mata); no detecta no-op (eso es capa 2).

### `raw.cron_runs` — el ledger (almacén durable)
Migración `0122`. Sobrevive restarts (el `/var/log/urbi/*.log` se pierde al redeploy).

| Columna | Significado |
|---|---|
| `job` | nombre corto del job (= 1er arg de run_job) |
| `started_at` / `finished_at` | inicio / fin. **`finished_at` NULL + viejo = ZOMBIE** (colgado u OOM) |
| `duration_s` | segundos |
| `exit_code` / `ok` | código de salida / `ok = (exit==0)` |
| `tail` | últimas 50 líneas de salida |
| `host_env` | DEV / production |

### `scripts/cron_status.py` — el lector ("tráeme los logs")
Lee `raw.cron_runs` y dice qué pasó. Ver §4.

### `scripts/qc_report.py` — frescura (capa 2)
Agendado c/3 días 15:00 UTC. Revisa que cada job corrió dentro de su ventana; sale
exit 1 si hay jobs STALE → el wrapper lo alerta por Sentry. (El email cae a stub
sin `SMTP_*`.)

### `scripts/data_quality_check.py` — volumen/fotos por fuente (capa 2)
Agendado diario 13:00 UTC. Por fuente de listings: frescura, caída de volumen >30%,
fotos faltantes >40%. Snapshot en `raw.data_quality_runs`. Alerta Sentry/webhook + exit 1.

---

## 3. Inventario de jobs (crontab en `Dockerfile.cron`, todo UTC)

Cada línea va envuelta en `run_job.py`. El nombre del job = clave en `raw.cron_runs`.

| Job | Cadencia | Script | Qué hace | Logfile |
|---|---|---|---|---|
| `refresh` | diario 03:00 | `refresh_data.py` | fincaraiz + remates | refresh.log |
| `listings_m2` | diario 08:00 | `run_listings_metrocuadrado.py` | metrocuadrado+habi+dedup+stale+R2+dbt | listings_m2.log |
| `data_quality` | diario 13:00 | `data_quality_check.py` | **QC capa 2** volumen/fotos | data_quality.log |
| `qc_report` | c/3d 15:00 | `qc_report.py --no-email` | **QC capa 2** frescura | qc_report.log |
| `renta_corta` | c/3d 09:00 | `run_renta_corta.py` | airbnb/vrbo/nomad/flatio/booking | renta_corta.log |
| `comunidad` | c/6h | `run_comunidad.py` | eventos + noticias | comunidad.log |
| `link_check` | diario 09:30 | `scraping.link_checker` | valida URLs vivas/muertas | link_check.log |
| `translate` | diario 05:30 | `translate_descripciones.py` | traducción es↔en offline | translate.log |
| `analytics_usuarios` | diario 07:00 | `run_analytics_usuarios.py` | partición + user_interests | analytics_usuarios.log |
| `airbnb_semanal` | domingo 08:00 | `run_airbnb_semanal.py` | AirROI + dbt | airbnb_semanal.log |
| `dbt_full_refresh` | lunes 07:30 | `run_dbt_full_refresh.py` | dbt full-refresh + test | dbt_full_refresh.log |
| `remates_dbt` | miércoles 10:00 | `dbt_run.py` | scores post-remates | remates_dbt.log |
| `ingest_barrios` | día 1 03:30 | `load_barrios.py` | carga barrios | ingest_barrios.log |
| `ingest_pois` → `ingest_pois_overpass` → `compute_barrios_pois` | lunes 04:00 | 3 scripts encadenados con `&&` | POIs base → UPSERT overpass → cómputo 1km. **Orden crítico**: load_pois TRUNCA; sin overpass en medio se pierden 9 POIs (ver ARCHITECTURE §7.6) | ingest_pois.log |
| `seguridad_mensual` | día 1 12:00 | `run_seguridad_mensual.py` | criminalidad mensual | seguridad_mensual.log |
| `parametros_diario` | diario 11:00 | `fetch_usd_rate.py` | tasa USD | parametros_diario.log |
| `trm_semanal` | lunes 11:15 | `fetch_trm.py` | TRM | trm_semanal.log |
| `alertas` | diario 14:00 | `alertas_notificar.py` | notifica alertas usuarios | alertas.log |
| `sweep_asignados` | c/hora | `sweep_asignados.py` | barrido asignaciones | sweep_asignados.log |

---

## 4. Cómo leer los logs desde fuera del contenedor

`cron_status.py` necesita `DATABASE_URL`. Como el `DATABASE_URL` interno de Railway
no se alcanza desde afuera, se usa la **URL pública** del servicio `postgis`:

```bash
# Arma la URL pública de la DB (DEV; para prod usar env "production")
eval "$(railway variables -e 'Medellin social DEV' -s postgis --kv \
  | grep -E '^(POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|RAILWAY_TCP_PROXY_DOMAIN|RAILWAY_TCP_PROXY_PORT)=' \
  | sed -E 's/^/export /')"
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}/${POSTGRES_DB}"

python3 scripts/cron_status.py             # último estado por job (OK/FALLÓ/ZOMBIE/RUNNING)
python3 scripts/cron_status.py --fails     # solo fallas + zombies, con el error (tail)
python3 scripts/cron_status.py --job refresh   # historial + tail de un job
python3 scripts/cron_status.py --hours 72      # ventana del resumen
```

Estados: **OK** (exit 0) · **FALLÓ** (exit ≠0) · **ZOMBIE** (sin terminar y viejo
> 6h — colgado/OOM) · **RUNNING** (sin terminar, reciente).

---

## 5. Canales de alerta

| Canal | Estado | Env var | Nota |
|---|---|---|---|
| Sentry | **VIVO** (DEV + prod) | `SENTRY_DSN` | Único canal activo hoy. `capture_message` crea issue; que llegue a un humano depende de **alert rules** en Sentry (fuera del repo) |
| Webhook (Slack) | inactivo | `DATA_QUALITY_ALERT_WEBHOOK` | si se setea, run_job + data_quality postean ahí |
| Email | inactivo | `SMTP_USER` / `SMTP_PASS` | qc_report cae a `[EMAIL STUB]` sin esto |

> ⚠️ "Seteado ≠ te llega". Verificar que las alertas de `data_quality_check`
> (diario, mismo canal Sentry) realmente llegan. Si no → cablear email.

---

## 6. Estado de deploy

| Pieza | DEV | PROD |
|---|---|---|
| `run_job.py` + crontab envuelto | ✅ deployado social-cron | ⬜ pendiente |
| `cron_status.py` | ✅ en imagen | ⬜ |
| tabla `raw.cron_runs` | ✅ creada (DDL manual, idempotente) | ⬜ |
| migración `0122` vía alembic | ⬜ (DEV en head 0120) | ⬜ |
| `qc_report` agendado | ✅ | ⬜ |

Gates antes de prod (ver bitácora): migración `0122` cuelga de `0121` sin commitear;
deploy toca 2 servicios (Social-api = migración, social-cron = crontab, forzar
`railway up -s social-cron`).

---

## 7. Cómo agregar un job nuevo al sistema QC

1. En `Dockerfile.cron`, nueva línea del crontab **envuelta**:
   `"<cron> app cd /app && python3 scripts/run_job.py <nombre> python3 scripts/<script>.py >> /var/log/urbi/<nombre>.log 2>&1"`
2. Agregar fila a la tabla del §3 de este doc.
3. Si el job produce dato que la app sirve, considerar un chequeo de **capa 2**
   (frescura en `qc_report._FRESHNESS` o volumen en `data_quality_check`).
4. Deploy: `railway up -s social-cron` (push a main NO reconstruye cron).

---

## 8. Bitácora de callouts (append)

Gotchas y decisiones de QC. Nuevo arriba.

- **2026-11-11 — `listings_m2` fallaba hace ≥3 días (3 sub-pasos rotos).** Lo destapó
  el ledger. Causas distintas:
  - **dbt (todos los jobs dbt): protobuf 5.x.** `protobuf` es transitivo de
    `dbt-core==1.7.4` (sin tope de versión) → un rebuild agarró 5.x, que quitó el
    kwarg `including_default_value_fields` que dbt usa en su telemetría de fin de
    corrida. Los modelos PASAN (`PASS=26`) y luego el proceso sale 1. **FIX: pin
    `protobuf<5` en scraping/requirements.txt** (resuelve a 4.25.9). Afecta también
    `remates_dbt`, `dbt_full_refresh`, dbt de `airbnb_semanal`.
  - **metrocuadrado: migraron el sitio — REQUIERE REESCRITURA (pendiente).** La
    X-Api-Key (pública) ya no está en el HTML; el sitio pasó a un SPA
    (`/public-results/`) que NO manda key; el endpoint viejo `/rest-search/search`
    da 401 y el frontend lo abandonó. Los resultados ahora vienen **SSR en el HTML**
    (no hay API JSON de listings — solo el selector de ubicaciones es JSON). Fix =
    reescribir el scraper para parsear el HTML renderizado con paginación. Tarea
    aparte, no es config.
  - **habi: RESUELTO.** No usa token — su x-api-key es PÚBLICA (web-client). Alguien
    la había cambiado a exigir env `HABI_API_KEY`. FIX: `_require_api_key()` ahora
    auto-extrae la key del frontend con un chromium headless (el SPA la inyecta en
    runtime, no está en HTML/JS estático). ADEMÁS 2º bloqueo: `apiv2.habi.co/robots.txt`
    da 403 → `urllib.robotparser` lo lee como "disallow all" (falso positivo; el
    robots REAL de habi.co solo prohíbe /final/ y /undefined) → se pasó
    `check_robots=False` en esa llamada. Verificado: scrapea 46 listings Valle de
    Aburrá sin token, exit 0.
  - **Límite del wrapper evidenciado:** el tail de 50 líneas solo capturó el error
    dbt; los 2 errores de scrape quedaron fuera → hubo que reproducir local.
    Considerar subir `_TAIL_LINES` o capturar el fallo por sub-paso.

- **2026-11-08 — Nace el sistema.** Wrapper `run_job.py` + ledger `raw.cron_runs`
  (migr 0122) + lector `cron_status.py` + `qc_report` agendado. Deployado a DEV.
- **Conexión DB fresca por operación** (no una sola compartida): un scraper de
  horas deja idle una conexión que el proxy de Railway corta → el UPDATE de fin
  falla → un job exitoso aparece como ZOMBIE falso. `_ledger_start`/`_ledger_finish`
  abren y cierran su propia conexión.
- **Sentry seteado ≠ llega a un humano.** El DSN solo garantiza POST. Las alert
  rules viven en el UI de Sentry. Verificar con las alertas ya existentes de
  `data_quality_check`.
- **`qc_report` sin email de verdad.** Sin `SMTP_*` cae a stub. Hoy alerta solo
  porque sale exit 1 y el wrapper lo manda a Sentry.
- **Migración `0122` → `0121` (consentimiento, sin commitear).** Si `0122` deploya
  sin que `0121` aterrice, `alembic upgrade head` muere por parent faltante → la
  tabla no se crea → el ledger no-op en silencio (el bug, otra vez). Resolver orden.
