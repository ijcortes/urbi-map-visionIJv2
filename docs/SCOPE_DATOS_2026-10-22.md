# Scope Completo de Datos — Medellín Social

**Fecha:** 2026-10-22 · **Auditor:** Claude (Opus 4.8) · **Rama:** `fix/security-hardening`
**Prompt fuente:** [docs/PROMPT_AUDITORIA_DATOS_SCOPE.md](PROMPT_AUDITORIA_DATOS_SCOPE.md)

---

## Cómo se verificó esto (lee primero)

- **Prod API (público): VERIFICADO EN VIVO hoy.** Host real = `https://medellinsocial-api.up.railway.app/api/v1` (NO es same-origin con `www.medellinsocial.com`; el host está horneado en el build vía `VITE_API_URL`). El outage de Railway del 2026-10-21 **ya pasó**: la API responde 200.
- **Prod DB (psql directo): NO verificado.** El clasificador de auto-mode bloqueó la conexión directa a `yamabiko.proxy.rlwy.net:10109` y no se rodeó. Todo lo que requiere query a la DB queda marcado `❓` con el comando exacto listo para correr en el harness ([scripts/healthcheck_prod.sql](../scripts/healthcheck_prod.sql)).
- **Código: VERIFICADO por lectura directa** de `api/cache.py`, `api/routers/listings.py`, y los componentes de frontend (`usePriceFormat`, `useTrm`, `ListingMiniPopup`, `PopupPriceHistory`).
- **Render en navegador (4 combos moneda/idioma): NO verificado** — requiere cargar el sitio y mirar píxeles. Marcado `❓` con URL + qué mirar.

**Leyenda de veredicto:** ✅ funciona · ⚠️ parcial · ❌ roto · 🚫 no existe · ❓ no verificado en prod (con comando)
**Capas de fallo:** `[L1]` código no desplegado · `[L2]` dato no poblado · `[L3]` dato presente pero renderiza mal

---

## A. Resumen ejecutivo (no técnico)

**Veredicto global: la plataforma está sana en su núcleo, con huecos de "campo vacío" bien localizados.** El mapa sirve **95.198 propiedades** reales en producción ahora mismo, con foto, barrio, precio en pesos y en dólares. No es un castillo de naipes. Los problemas que el usuario teme ("aparece pero no abre", "solo en pesos", "sin fotos") **no están rotos a nivel sistémico** — pero hay varios campos que se diseñaron para mostrarse y hoy salen vacíos porque el dato no se está calculando.

**Semáforo por dominio:**

| Dominio | Estado | Una línea |
|---|---|---|
| Listings (mapa) | 🟢 | 95.198 servidos, con foto/barrio/precio. Núcleo sólido. |
| Moneda USD/COP | 🟢 | Arquitectura correcta; USD convierte en inglés. TRM vivo (pero sin red de seguridad, ver riesgo). |
| Popup / "Ver más" | 🟢 | Abre con datos; detalle responde 200 en prod. |
| Imágenes | 🟢 | Foto servida; placeholder elegante si falta. Cobertura por fuente a verificar. |
| Historial de precios | 🟡 | Funciona y sale en USD en inglés (fincaraiz/metrocuadrado/habi). Falta agregar **Medellín Living**. |
| Estado activo/muerto | 🟡 | El filtro existe; job `validate`=`scraping/link_checker` (cron 09:30); confirmar que corre en prod + 2 bugs sin desplegar. |
| Días en mercado | 🟢 | Funciona para metrocuadrado (`fecha_primera_vez`); null por diseño en otras fuentes. NO viene del validate job. |
| Métricas inversor (mediana/buena_oferta) | ⚪ | **Diferido a propósito** — futura sección de inversores. Dato se calcula; no se cablea aún. |
| Enriquecimiento barrio (seguridad/POT/estrato) | 🟡 | POT/estrato llegan al listing; seguridad/score del barrio salen null en el payload del listing. |
| Comunidad (eventos/negocios/noticias) | 🟡 | Scrapers existen; frescura a verificar con el harness. |

> **CORRECCIÓN 2026-10-22 (post-investigación):** el "100% null" de `dias_en_mercado` era **artefacto de muestreo** — la muestra cayó toda en casadolcecasa. `dias_en_mercado` **SÍ funciona** para metrocuadrado (142/143 con valor en prod); es null para las otras fuentes **por diseño** (solo metrocuadrado tiene `fecha_primera_vez`). Las métricas de mediana/buena_oferta son **diferidas a propósito** (futura sección de inversores), no un bug. Ver §C corregido.

**Lo más urgente para "salir a producción con todo funcionando":**
1. 🟡 Desplegar/confirmar el job `validate` (`scraping/link_checker`, cron diario 09:30) — correr `healthcheck_prod.sql §1` para ver si realmente corre en prod (sospecha de stale por historial de social-cron).
2. 🟢→resiliencia: la conversión a USD depende de un solo endpoint sin respaldo; si se cae, todo vuelve a pesos en silencio.
3. 🟡 Agregar recolección de **Medellín Living** (scraper) para que capture historial de precios (la plomería del historial ya existe; falta el re-scrape que la dispare).

---

## B. Matriz Dominio × Capa

| # | Dominio | Fuente | Tabla(s) | Endpoint | Componente FE | L1 (deploy) | L2 (poblado) | L3 (render) | Veredicto |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Listings venta/arriendo | fincaraiz, metrocuadrado, habi, casadolcecasa, propios | `raw.listings_*`, `staging.stg_listings_unificado`, `listing` | `GET /listings` | MapView, ListingMiniPopup | ✅ | ✅ 95.198 | ✅ | 🟢 |
| 2 | Historial de precios | fincaraiz, metrocuadrado | `raw.listings_precio_historial` | `GET /listings/{id}` → `precio_historia` | PopupPriceHistory | ✅ | ⚠️ parcial por fuente | ✅ USD en EN | 🟡 |
| 3 | Imágenes / media | portales + R2 mirror | `raw.listing_media_mirror`, `listing_media`, col `fotos` | listado (`foto_principal`) + detalle (`fotos[]`) | ListingMiniPopup, PopupGallery | ✅ | ❓ cobertura por fuente | ✅ placeholder si falta | 🟢 |
| 4 | Estado activo/muerto | validate cron | `url_activa`, `activo` | filtrado en `cache.py` | — | ❌ fixes sin deploy | ❓ | — | 🟡 |
| 5 | Moneda TRM | Banco Rep / scraper | `public.trm` | `GET /trm` | useTrm, usePriceFormat | ✅ | ✅ vivo (3174.67, vig 2026-10-17) | ✅ | 🟢 |
| 6 | Idioma es/en | — | — | — | i18n.tsx (DOM) | ✅ | n/a | ❓ render | 🟡 |
| 7 | barrio_id espacial | ST_Contains | `cache.py` COALESCE | `GET /listings` | mapa | ❓ fix 65eeea3 pend | ✅ (muestra sin null) | ✅ | 🟢 |
| 8a | `dias_en_mercado` | metrocuadrado scraper | `raw.listings_metrocuadrado.fecha_primera_vez` | `GET /listings` | ListingMiniPopup | ✅ | ✅ 142/143 mc | ✅ (null otras fuentes = diseño) | 🟢 |
| 8b | Métricas inversor (mediana/buena_oferta) | analytics | `analytics.barrios_medianas` | — no unido | — | n/a | ✅ se calcula | ⚪ diferido (no cableado) | ⚪ |
| 9 | Seguridad / score ABCD | policía + loader | `analytics.barrios_seguridad` | `GET /barrios/{id}` | panel barrio | ❓ | ❓ (null en listing) | ❓ | 🟡 |
| 10 | Zonas/barrios/comunas | DANE/polígonos | `raw.barrios` | `GET /barrios`, `/comunas` | mapa | ✅ | ⚠️ cobertura municipios externos | ✅ | 🟡 |
| 11 | POT/estrato/manzana | geojson POT48 | `analytics.listings_georef` | `GET /listings` | drawer | ✅ | ✅ (sale en payload) | ✅ | 🟢 |
| 12 | Tráfico/congestión | HERE Flow | `analytics.barrios_trafico_perfil` | `GET /barrios/{id}` | panel barrio | ❓ | ❓ | ❓ | 🟡 |
| 13 | Compraventas/catastro/mercado real | ORIP/catastro CSV | `raw.compraventas_orips`, `raw.catastro_medellin` | panel | panel barrio | ❓ | ❓ sin geometría catastro | ❓ | 🟡 |
| 14 | POIs/ruido/verde | SIATA/cómputo | `analytics.barrios_pois_distancia` etc. | `GET /barrios/{id}` | panel barrio | ❓ | ❓ | ❓ | 🟡 |
| 15 | Población | DANE | `raw.poblacion_comuna/municipio` | — | — huérfano | n/a | ⚠️ local, no wired | 🚫 sin UI | 🟡 |
| 16 | Eventos | scrapers eventos | `eventos` | `GET /comunidad/...` | EventCard | ✅ | ❓ frescura | ✅ | 🟡 |
| 17 | Negocios locales | scrapers tiendas | `negocios` | `GET /business/...` | BusinessCard | ✅ | ❓ frescura | ✅ | 🟡 |
| 18 | Noticias/blog | RSS | `noticias`, `comunidad_post` | `GET /comunidad/...` | blog feed | ⚠️ UI moderación falta | ❓ frescura | ✅ | 🟡 |
| 19 | Métricas dashboards realtor | analytics | `analytics.*` | `GET /realtor/*` | dashboard | ✅ | ❓ | ❓ | 🟡 |

---

## C. Checklist punto por punto

> Cada ítem trae su método. `[Prod✅]` = verificado en vivo hoy. `[❓]` = comando listo, falta correr contra prod.

### Core: Listings + mapa

- [x] **[L2] Listings se sirven en prod** — `[Prod✅]`
  Prueba: `curl "$API/listings?limit=2"` → `{"total":95198,...}` HTTP 200.
  Veredicto: ✅ 95.198 propiedades servidas.

- [x] **[L3] Mini-popup abre y muestra datos (no vacío)** — `[Prod✅ payload]`
  Prueba: el listado trae `precio_cop`, `area_m2`, `habitaciones`, `barrio_nombre`, `foto_principal`. `ListingMiniPopup` renderiza desde ese payload.
  FE: cargar `/map`, click en pin → popup con precio+foto+barrio.
  Veredicto: ✅ abre con datos (el payload del listado ya trae todo lo que la popup necesita).

- [x] **[L3] "Ver más" abre el drawer con datos (no "aparece pero no abre")** — `[Prod✅]`
  Prueba: `curl "$API/listings/{id}"` → HTTP 200 con `fotos[]`, specs, `precio_historia`.
  Veredicto: ✅ el detalle responde en prod; el drawer no queda vacío por fallo de fetch.

- [ ] **[L3] Precio del popup en USD cuando idioma = EN** — `[❓ render]`
  Código: `usePriceFormat` → `preferred = lang==='en' ? 'USD' : 'COP'`, convierte vía TRM. **Correcto por código.**
  FE: `/map?lang=en` → popup debe decir `$305 USD`, no `$1.250.000 COP`.
  Veredicto: ✅ por código / ❓ confirmar píxel en las 4 combos (es+COP, es+USD, en+COP, en+USD).

- [ ] **[L2/L3] Imágenes cargan: portada + galería** — `[Prod✅ parcial]`
  Prueba: `foto_principal` presente (casadolcecasa 199/200 en muestra); detalle trae `fotos[]` (4 en muestra). Placeholder `BuildingPlaceholder` si null → nunca queda en blanco roto.
  Cobertura por fuente (fincaraiz/mc): `[❓]` → harness §3 `pct_con_foto`.
  Veredicto: ✅ núcleo / ❓ cobertura bulk.

- [ ] **[L2] Listing muerto/inactivo NO visible** — `[❓]`
  Código: `cache.py` filtra `activo = true AND url_activa IS NOT FALSE` en las 6 ramas de fuente. **Correcto por código.**
  Prueba: harness §2 `muertos_ocultos` / `backlog_pendiente`.
  Veredicto: ✅ filtro aplicado / ⚠️ **job `validate` tiene 2 bugs sin desplegar** (muestra muertos 200-redirect + esconde vivos por timeout→FALSE). Requiere `railway up --service social-cron`. `[L1]`

### Moneda / idioma (transversal)

- [x] **[L2] TRM vivo en prod** — `[Prod✅]`
  Prueba: `curl "$API/trm"` → `{"valor":3174.67,"vigencia":"2026-10-17"}`.
  Veredicto: ✅ pero vigencia 5 días (refresh semanal → envejeciendo). Harness §4.

- [x] **[L3] Historial de precios en USD bajo EN** — `[código✅]`
  Código: `PopupPriceHistory` usa el mismo `formatPrice` de `usePriceFormat` → convierte a USD en inglés. La línea grafica COP crudo (forma preservada); solo el tooltip formatea. **No es bug.**
  Veredicto: ✅.

- [ ] **[L3][RIESGO] USD sin red de seguridad** — `[código⚠️]`
  Código: `useTrm` **no tiene fallback hardcodeado** — si `/trm` falla, `valor=null` y TODO precio vuelve a COP aunque esté en inglés (popup, drawer, historial, cards, calculadora, comparador).
  Veredicto: ⚠️ hoy no dispara (TRM vivo), pero es punto único de fallo. Mitigación: cachear último TRM válido en localStorage.

### Días en mercado (CORREGIDO — funciona)

- [x] **[L2] `dias_en_mercado` para metrocuadrado** — `[Prod✅]`
  Fuente: `CURRENT_DATE - raw.listings_metrocuadrado.fecha_primera_vez` (listings.py:366,950). Solo metrocuadrado tiene `fecha_primera_vez` (set al scrapear, `DEFAULT NOW()`, backfill de fecha_scraping — NO lo produce el validate job).
  Prueba: `curl "$API/listings?limit=500" | jq '[.listings[]|select(.fuente=="metrocuadrado")]'` → 142/143 con `dias_en_mercado` (131, 121, 115…).
  Veredicto: ✅ funciona. Null en casadolcecasa/fincaraiz/habi/renta = **por diseño** (sin `fecha_primera_vez`).

### Métricas de inversor (DIFERIDO a propósito)

- [ ] **[⚪ diferido] `precio_m2_mediana_barrio` / `buena_oferta` / `pct_bajo_mediana` / `barrio_score` / `barrio_yield`**
  `analytics.barrios_medianas` + `barrios_contexto` SÍ se calculan en `cache.py`; el JOIN al serving de `listings.py` existe parcialmente pero los badges NO se muestran aún.
  Decisión de producto (2026-10-22): **se recolecta el dato ahora, se cablea después** en la futura sección de inversores. No es bug, no es P0.

### Enriquecimiento de barrio / panel

- [ ] **[L2] POT / estrato / manzana en el listing** — `[Prod✅]`
  Prueba: `estrato_real:5, uso_suelo_pot:"...", estrato_manzana:4` presentes en el payload.
  Veredicto: ✅.

- [ ] **[L2/L3] Panel de barrio (`/barrios/{id}`): seguridad, yield, tráfico, POIs** — `[❓]`
  Prueba: `curl "$API/barrios/191/info"` → inspeccionar campos no-null.
  Veredicto: ❓ verificar en prod (precedente: analytics casi vacío en Railway, arreglado tabla x tabla — reconfirmar).

- [ ] **[L2] Cobertura de barrios en municipios externos** (Girardota/Caldas/Copacabana/Barbosa) — `[❓]`
  Nota: `raw.barrios` casi no los cubre (1 polígono c/u) → listings ahí sin barrio fino.
  Veredicto: ⚠️ gap conocido de completitud.

### Comunidad

- [ ] **[L2] Eventos / negocios / noticias frescos** — `[❓]`
  Prueba: harness §1 (frescura por job). Eventos/noticias cada 6h.
  Veredicto: ❓ correr harness.

- [ ] **[L3] Descripciones libres traducidas** — `[código: NO se traducen por diseño]`
  Nota: i18n es traductor DOM por diccionario, no traduce texto libre de descripciones. Hay pipeline offline es↔en (migr 0094) sin desplegar.
  Veredicto: ⚠️ esperado; decisión de producto.

---

## D. Gap analysis (por capa)

**`[L1]` — Código listo, falta desplegar:**
- Job `validate` fincaraiz: 2 bugs (muestra muertos redirect-200, esconde vivos por timeout). Fix hecho, falta `railway up --service social-cron`.
- Fix `barrio_id` espacial fz/mc (`cache.py` COALESCE+ST_Contains, commit 65eeea3) — deploy pendiente.
- QC report por email (scripts/qc_report.py) — envío real pendiente (creds en social-cron).

**`[L2]` — Código bien, dato no poblado / no unido:**
- ⚪ `precio_m2_mediana_barrio` / `buena_oferta` / `barrio_score` / `barrio_yield` → **DIFERIDO** (sección inversores). Dato se calcula; cablear después.
- 🟡 Historial de precios: fincaraiz/metrocuadrado/habi OK; **falta Medellín Living** (sin scraper que dispare el trigger).
- 🟡 Cobertura de fotos por fuente (fincaraiz masked / mc) → verificar harness §3.
- 🟡 Barrios municipios externos (1 polígono).
- 🟡 `raw.catastro_medellin` sin geometría; `compraventas_orips` solo municipio.

**`[L3]` — Dato presente, render a confirmar:**
- ❓ USD en las 4 combos moneda/idioma (código correcto, falta ver píxel).
- ⚠️ `useTrm` sin fallback (resiliencia).
- Población (migr 0081) sin UI = dato huérfano.

---

## E. Plan de arreglo propuesto (NO ejecutado)

Priorizado por impacto en "salir a producción con todo funcionando":

| P | Fix | Capa | Archivo(s) | Esfuerzo |
|---|---|---|---|---|
| **P1** | Confirmar `validate`/`link_checker` corre en prod (`healthcheck §1`) + desplegar 2 bugs | L1 | `railway up --service social-cron` | S |
| **P1** | Agregar scraper **Medellín Living** (UPSERT a `raw.listings_premium` → trigger captura historial solo) | L2 | nuevo `scraping/medellinliving/` (molde `scraping/vrbo/`) | M |
| **P1** | Desplegar fix `barrio_id` espacial (65eeea3) | L1 | deploy | S |
| **P2** | Fallback TRM en localStorage (resiliencia USD) | L3 | `src/hooks/useTrm.ts` | S |
| **P2** | Verificar render 4 combos moneda/idioma en navegador | L3 | manual / e2e | S |
| **P3** | Panel barrio: reconfirmar seguridad/tráfico/POIs no-null en prod | L2 | harness + `barrios.py` | M |
| **Diferido** | Cablear métricas inversor (mediana/buena_oferta/score) | L2 | `listings.py` + UI | — (sección inversores) |

---

## Apéndice — comandos de verificación (prod, públicos)

```bash
API="https://medellinsocial-api.up.railway.app/api/v1"
curl -s "$API/trm"                                   # TRM vivo + vigencia
curl -s "$API/listings?limit=2" | jq '.total'        # volumen servido
curl -s "$API/listings?limit=200" | jq -r \
  '.listings | {sin_foto:(map(select(.foto_principal==null))|length), \
   sin_dias:(map(select(.dias_en_mercado==null))|length), \
   sin_mediana:(map(select(.precio_m2_mediana_barrio==null))|length)}'
ID=$(curl -s "$API/listings?limit=1" | jq -r '.listings[0].id')
curl -s "$API/listings/$ID" | jq '.precio_historia|length'   # cobertura historial
```

Para lo que necesita DB directa (frescura cron, muertos, cobertura foto por fuente):
```bash
psql "postgresql://urbidata:urbidata007@yamabiko.proxy.rlwy.net:10109/urbidata" \
  -f scripts/healthcheck_prod.sql
```
