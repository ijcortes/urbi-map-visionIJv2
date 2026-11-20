# Flujo Realtor (modelo Zillow) — estado, pendientes y plan

Doc vivo. Consolida TODO el workstream "realtor estilo Zillow": captura de lead →
calificación → enrutamiento → toma por el realtor → trabajo del lead → cierre, +
la API GHL (entrada y salida) que se construye **de este lado primero**, antes de
cablear GoHighLevel.

Última revisión: 2026-11-11. Rama: `feat/market-intel-public-gate`.
Ver también: [GHL_CONTRATO_PROPUESTO.md](GHL_CONTRATO_PROPUESTO.md) (contrato campo
a campo con Talal) · [GHL_TALAL_TEST_HANDOFF.md](GHL_TALAL_TEST_HANDOFF.md) (handoff
de prueba a Talal).

---

## 0. Los 6 pasos Zillow ↔ Medellín Social

| Paso Zillow | Estado MS | Dónde |
|---|---|---|
| 1. Captura del lead | ✅ | `POST /visitas`, favoritos, `/publicar`, `POST /listings/{id}/reclamar` |
| 2. Calificación + enrutamiento | ✅ calificar (migr 0101) + ✅ enrutar (asignador) | `visita_solicitud.{intencion,presupuesto,plazo,credito}`, `asignador_service` |
| 3. Respuesta del agente (velocidad) | ✅ medida + diente | `/realtor/desempeno` grado de servicio |
| 4. CRM / seguimiento | ✅ interno + 🟡 GHL | `/realtor/agenda`, `/realtor/visitas/{id}`; push GHL stub |
| 5. Reporte de estado/cierre | ✅ backend, 🟡 UI | `POST /realtor/listings/{id}/cerrar` + ledger `propiedad_evento` (migr 0100) |
| 6. Cierre y cobro | ❌ cobro | cobro va por GHL (no construido aquí) |

---

## 1. Flujo Realtor interno — PROBADO end-to-end 2026-11-11

Verificado contra API local (login real `realtor.test@example.com`, DB `social`:5433).

### 1a. Tomar un listing como propio
- `GET /realtor/pool` — leads sin dueño (intakes `en_pool`). **Probado: 9 en pool.**
- `POST /realtor/pool/{intake_id}/tomar` — UPDATE atómico condicional
  (`estado='en_pool' AND agent_id IS NULL`), gana la DB no un select-then-update.
  **Probado: 200 `{"resultado":"tomado","estado":"asignado","agent_id":...}`.**
- `GET /realtor/asignados` — lo que el realtor tomó/le asignaron.
- Timeout: `sweep_asignados_vencidos` devuelve al pool los `asignado` que nadie
  aceptó en `ASIGNADO_TIMEOUT_HORAS` (24h). Corre al leer pool/asignados (sin cron).

> **🐛 2 bugs encontrados testeando + arreglados 2026-11-11** (verificados DB A/B):
> 1. **`tomar_del_pool` no reseteaba `updated_at`** → como el sweep cuenta 24h desde
>    `updated_at`, cualquier lead que esperó >24h en el pool volvía al pool en el
>    primer sweep tras tomarlo (los leads más añejos = los que más urge tomar =
>    intomables). Fix: `tomar` setea `updated_at=NOW()` (reloj del timeout arranca al
>    tomar). Mismo fix en `asignar_intake` por consistencia.
> 2. **`_agent_del_usuario` no-determinista** con >1 fila `agent` por usuario →
>    `/pool/tomar` escribía en una fila y `/asignados` leía de otra → el lead tomado
>    "desaparecía". Fix: `ORDER BY (estado='activo') DESC, created_at ASC LIMIT 1`
>    (canónica = activa más vieja). Protege prod si un usuario llegara a tener 2 filas.

### 1b. Trabajar el lead (subir datos)
- `POST /intake/{id}/aceptar` → crea `listing` borrador + 8 ítems de due-diligence.
- `PATCH /realtor/listings/{id}` — editar ficha (título, precio, área, hab/baños…).
- `POST /realtor/listings/{id}/fotos` — subir fotos a R2 (1ª = portada).
- `POST /realtor/asignados/{id}/publicar` — borrador → `en_revision` (guardia
  server-side: ningún listing incompleto pasa, espejo de `datos_minimos_completos`).

### 1c. Cerrar (paso 5 Zillow — poblar el dato de transacción)
- `POST /realtor/listings/{id}/cerrar` — marca vendido + graba precio de cierre +
  llaves ORIP/catastro en el ledger `propiedad_evento` (append-only, sobrevive al
  listing). Precio autoreportado → `verificado=false` hasta cruzar con SNR.
- UI "Marcar vendido": botón en Mis listings (publicado/pausado) → modal
  (precio + matrícula obligatoria + fecha/catastral opc) → `cerrar`. ✅ construido.

### 1c-bis. INCENTIVOS del realtor — ✅ construido + testeado 2026-11-11

El loop: **reportar cierres → desbloquea comparables de cierre + sube tu puntaje →
tasas mejor → ganas más → más cierres.**

- **Palanca de reciprocidad (`GET /realtor/comparables`):** comparables de precio de
  CIERRE (el dato más valioso para tasar), **gated**: solo los ve quien reportó
  ≥`_COMPARABLES_MIN_CIERRES` cierres en 12m. Ese gate ES la razón para teclear el
  cierre. NO expone matrícula/dirección/agente/listing de otros (solo
  precio/fecha/zona/tipo/área/$m2) — verificado no-leak.
- **Standing (`/realtor/desempeno.standing`):** `puntaje` 0–100 (contribución 30% +
  velocidad 30% + show 20% + aceptación 20%, pesos en `_PUNTAJE_PESOS`) + `ranking`
  {posicion,total} cross-agente. **Degrada honesto:** sin actividad ≥
  `_RANKING_MIN_ACTIVIDAD` → puntaje/ranking `null` + "datos insuficientes" (no
  inventa un puesto sobre ceros).
- **Diente del grado SLA:** la velocidad de respuesta es 30% del puntaje → el espejo
  se vuelve palanca (vía standing/ranking). NO rewiring de la asignación: la
  velocidad sube el standing, no cambia (aún) el orden de reparto de nuevos leads.

**Parámetros = decisión de PRODUCTO** (en `realtor.py`, placeholder, tunéalos):
`_PUNTAJE_PESOS`, `_CONTRIB_CAP=5`, `_RANKING_MIN_ACTIVIDAD=3`, `_COMPARABLES_MIN_CIERRES=1`.

**Decisiones de negocio pendientes (flagueadas, no bloquean el mecanismo):**
- **Cold-start:** con pocos cierres en el sistema el gate guarda una sala casi vacía
  (comparables finos). El mecanismo crece con los reportes; al inicio el valor
  desbloqueado es bajo. ¿Umbral 1 está bien, o se arranca con gate abierto hasta
  tener N cierres?
- **Integridad del gate — mitigado 2026-11-11 (punto medio):** el cierre sigue
  autoreportado (`verificado=false`, unlock instantáneo = incentivo fuerte), PERO:
  1. **Anti-farm:** gate/contribución cuentan `DISTINCT matrícula` → spamear la misma
     matrícula N veces NO sube el unlock ni el puntaje (una propiedad se vende una vez).
  2. **Transparencia:** los comparables marcan `verificado` vs `sin verificar`, ordenan
     verificados primero y, si hay autoreportado + verificado de la misma matrícula,
     dedup se queda con el verificado → un cierre falso queda abajo, etiquetado "sin
     verificar", inútil para engañar y contaminando solo el bucket descartable (que el
     propio tramposo también ve).
  3. **Futuro (no construido — falta dato):** cruce SNR por matrícula flipearía
     `verificado=true` y permitiría descartar los no-verificados que no aparezcan.
     `compraventas_orips` es nivel municipio hoy → el cruce fino espera ese dato.
  Verificado en vivo: 3 filas / 2 matrículas → `cierres_reportados=2`, 2 comparables
  (dedup), verificados primero, dedup prioriza la verificada.

**Testeo:** `api/tests/test_realtor_incentivos.py` (10 tests: math de puntaje+pesos+cap,
degradación honesta del ranking, gate bloqueado/abierto, no-leak) +
- FLIP del gate en vivo contra API real (0 cierres→gated → `cerrar` → mismo agente ve
  comparables + no-leak) con cleanup (sin dejar cierres sintéticos).
- Standing SQL→math en vivo: seed 2 agentes (5 vs 3 cierres) → `/desempeno` devuelve
  puntaje=30 (= cálculo a mano) + ranking puesto 1 de 2; cleanup. (El pytest prueba la
  math con dicts; esto prueba que `_STANDING_COMPONENTS_SQL` la alimenta bien.)

**Observado vs calibrado (honestidad):** el MECANISMO está probado (gate en vivo, standing
SQL→math en vivo, degradación). Que los pesos/umbrales sean los CORRECTOS para el negocio
NO está validado — son placeholder.

### 1d. Tracking (todo se traquea)
- Vistas: `public.user_events` (`event_type='listing_view'`). **Probado: 7 vistas
  del agente, 837 totales.**
- `/realtor/desempeno`: tasa aceptación, mediana horas aceptar, vistas 30d/total,
  show-rate de visitas, ofertas/interesados, ROI por zona patrocinada, **grado de
  servicio** (velocidad de respuesta A/B/C/D — diente del SLA, paso 3).
- `/realtor/agenda`: visitas (leads) con calificación + favoritos.

### 1e. Reclamar inmueble scrapeado ("claim your home")
- `POST /listings/{listing_id}/reclamar` — un dueño/agente reclama un listing
  scrapeado (sin dueño). Se guarda en `listing_reclamo` + se enruta como lead al
  realtor de zona vía intake/asignador. Idempotente (`unique(listing_url,usuario_id)`).

---

## 2. Calificación del lead (paso 2 Zillow) — migr 0101

4 columnas opcionales en `visita_solicitud`, pedidas sin obligar en el modal
"Agendar visita" (obligar hundiría la conversión del paso 1):
- `intencion` (vivir | invertir)
- `presupuesto` (<200M | 200-500M | 500-1000M | >1000M)
- `plazo` (ya | 1-3m | 3-6m | explorando)
- `credito` (contado | aprobado | en_tramite | no)

El realtor las ve en `/realtor/agenda` (chip "✓ Calificado" + pills) y los leads
calificados ordenan arriba.

---

## 3. API para GHL — se construye de ESTE lado primero

**Principio (decisión del usuario):** construir TODA la superficie API aquí —
entrada y salida — ANTES de cablear GoHighLevel. Talal sólo mapea del lado GHL.

**Dos caminos técnicos:**

### 3a. Camino NO bloqueado — REST con shape nuestro + token (✅ construido / a extender)
Nosotros definimos request/response; Talal conecta un HTTP-request action / workflow
de GHL. No necesita la firma del webhook de Talal.

Todos (`api/routers/ghl_leads.py`): auth header `X-API-Key` vs env `GHL_LEADS_TOKEN`
(`hmac.compare_digest`, cerrado por defecto → 503 si no hay token). Rate-limit +
rotación de token por coma + IP allowlist opcional (`GHL_LEADS_ALLOWED_IPS`).

- **Salida (GHL trae nuestros datos por PULL):**
  - ✅ `GET /ghl/leads?since=&estado=&limit=` + `GET /ghl/leads/{id}` — lead calificado.
  - ✅ `GET /ghl/agents?since=&estado=&limit=` + `GET /ghl/agents/{id}` — realtor →
    Contact (first/last name, email, tel, estado, verificado, agent_internal_id).
- **Entrada (GHL empuja a REST nuestro, shape nuestro) — NO usa la firma del webhook:**
  - ✅ `POST /ghl/visitas/{id}/estado` — estado/fecha/resultado de la visita →
    `visita_solicitud`. Verificado: 401 · 200+persist · 400.
  - ✅ `POST /ghl/agents/{id}/estado` — aprobar/rechazar/activar realtor →
    `public.agent`. Guard 409 si se activa sin usuario vinculado (no 500).
    Verificado: 401 · 200 round-trip · 400 · 404 · 409-guard.

Todo verificado por `curl` contra API local, sin Talal.

### 3b. Camino bloqueado — webhook firmado (espera a Talal)
- `POST /api/v1/webhook/ghl` (`api/routers/ghl_webhook.py`) — receptor con dispatch
  por `object_type` (listing/tienda/evento/agent/visita/deal/referidor). Todos los
  handlers `_upsert_*_from_ghl` devuelven **501** a propósito hasta tener: firma del
  webhook + payload real por entidad. **NO se adivina el payload.**
- Salida vía API nativa de GHL: `ghl_client.py` — listing/tienda/agency ✅ live;
  evento/agent/visita stub (falta contrato).

---

## 4. Pendientes

### Código (lo construimos nosotros, sin esperar a nadie)
- [ ] UI "marcar vendido" en dashboard realtor (paso 5) + incentivo.
- [ ] Endpoints de ENTRADA token-authed (GHL→nosotros, shape nuestro) — §5.
- [ ] Extender PULL a más entidades si se necesita (agent, listing status).
- [ ] (hecho hoy) fixes tomar/sweep + agente determinista — falta commit+deploy.

### No-código (bloqueado en terceros — NO urge, se espera)
- [ ] `GHL_LEADS_TOKEN` seteado en el env de la API (prod). Sin él, PULL = 503.
      Lo generamos nosotros y se lo pasamos a Talal.
- [ ] Talal: webhook secret + firma + payload de ejemplo por entidad (desbloquea TODO
      lo de §3b entrante).
- [ ] Talal: `POST /contacts` payload (desbloquea sync de realtor/usuario).
- [ ] Talal: conectar workflow GHL → `GET /ghl/leads` (pull) o → REST de entrada.
- [ ] Cobro por GHL (paso 6) — nada cobra plata aún.

---

## 5. Plan — endpoints de API ahead-of-Talal (próximo)

Objetivo: dejar TODA la API de entrada y salida lista y testeable de este lado, con
shape nuestro + auth por token (mismo patrón que `/ghl/leads`), para que cuando Talal
esté listo sea sólo mapear en GHL.

La superficie realtor/lead de nuestro lado está COMPLETA (entrada + salida):
leads (in/out), visita estado (in), agents (in/out). Ver §3a.

**Lo que queda de nuestro lado (no bloqueado):**
- [x] UI "marcar vendido" (paso 5) + sistema de INCENTIVOS (comparables gated +
      standing/ranking) — ✅ 2026-11-11, ver §1c-bis.
- [ ] (si se necesitan) `GET /ghl/listings?since=` pull — hoy el push nativo
      `ghl_client.sync_listing` ya cubre salida de listings; `POST /ghl/cierres`
      cuando exista la UI de cierre (feed de transacciones para cobro paso 6).

**Bloqueado en terceros (luego):** webhook firmado `/webhook/ghl`, sync nativo a
GHL de evento/agent/visita (contrato Talal), `GHL_LEADS_TOKEN` en prod, cobro.
