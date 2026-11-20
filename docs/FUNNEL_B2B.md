# Funnel B2B — Medellín Social

Documento maestro del funnel. Explica qué es el funnel, qué trackeamos hoy, qué
falta, y la especificación de cada capa a medida que se construye. Se actualiza
capa por capa.

> **Regla de oro:** un funnel NO son conteos de eventos. Es un conjunto de
> **etapas** con **caída** entre cada una, que terminan en **plata**. Si no
> podés decir "de X que vieron, Y actuaron", no tenés funnel — tenés métricas sueltas.

---

## 1. Los dos funnels (no confundirlos)

### Funnel 1 — DEMANDA (lado consumidor) = el ACTIVO que vendemos
El viaje de la audiencia sobre una entidad (negocio / evento / deal / listing).
Es lo que le probamos a la empresa/realtor para que pague.

| # | Etapa | Qué significa | event_type | Estado |
|---|-------|---------------|-----------|--------|
| 1 | **Alcance** | la entidad se MOSTRÓ en pantalla (impresión viewable) | `impression` | ✅ **capa 1 (este doc)** |
| 2 | **Interés** | el usuario hizo click / abrió la entidad | `evento_view`, `negocio_view`, `listing_view`, `listing_preview` | ✅ en producción |
| 3 | **Intención** | acción de alto valor: WhatsApp, Maps, Web, guardar, "cómo llegar" | `*_wa_click`, `*_maps_click`, `*_save`, … | ❌ pendiente (capa 3) |
| 4 | **Lead** | pidió contacto / visita / reveló teléfono | `visit_request`, `contact`, … | 🟡 parcial (`visita_solicitud`) |
| 5 | **Conversión** | venta / visita real (offline) | — | manual / GHL |

**Métricas que salen de este funnel** (por entidad, categoría, barrio):
`tasa_interés = interés/alcance`, `tasa_intención = intención/interés`,
`tasa_lead = lead/intención`. Ahí se ve **dónde se cae** y dónde mejorar.

### Funnel 2 — VENTAS (cómo ganamos plata)
El viaje del negocio/realtor hasta pagar:

`Prospecto` (negocios/realtors en DB) → `Calificado` (su ficha recibe demanda) →
`Pitcheado` (le mostramos su data del Funnel 1) → `Cliente` (paga vía GHL) →
`Retenido / Expandido`.

**La conexión que crea el valor:** el Funnel 1 es el combustible del Funnel 2.
Cerramos un negocio mostrándole su propio Funnel 1 ("340 personas te vieron,
85 dieron click a WhatsApp — por $199/mes te damos el slot destacado").

---

## 2. Arquitectura de datos

```
  Frontend (track / impressions)        ┌─────────────────────┐
  ──────────────────────────────►  RAW  │   user_events       │  (particionada x mes)
                                         │  event_type, entity │
                                         │  usuario_id, barrio │
                                         └──────────┬──────────┘
                                                    │ cron (rollup — capa futura)
                                                    ▼
                                         ┌─────────────────────┐
                                         │  métricas agregadas │  (funnel_daily, …)
                                         │  por entidad / día  │  ← lo que lee el dashboard
                                         └─────────────────────┘
```

- **Fuente única (raw):** `public.user_events`. TODO evento (impression, view,
  acción, lead) vive acá, con `usuario_id` (NULL = sesión anónima), `session_id`,
  `entity_type`, `entity_id`, `barrio_id`, `metadata` (jsonb, p.ej. `categoria`).
- **Agregados (rollup):** tablas de métricas por entidad/día que computa el cron,
  para que el dashboard no escanee el raw. Se construyen cuando haya ≥2 capas que
  cruzar (no antes — YAGNI).

**Atribución honesta:** `usuario_id` distingue **sesión autenticada vs anónima**,
NO suscriptor vs no-suscriptor (los leads de `/suscribirse` no tienen contraseña →
nunca loguean → siempre anónimos). `session_id` es por pestaña. Los números son
**sesiones / engagements, no personas únicas**. No vender "N personas" como único.

---

## 3. Qué se trackea HOY (inventario)

| event_type | De dónde | Etapa |
|---|---|---|
| `page_view` | `__root.tsx` (toda ruta) | navegación (no de funnel) |
| `listing_preview` | `map.tsx` (popup mapa) | Interés — `metadata: {tipo_inmueble, operacion}` |
| `listing_view` | backend `listings.py` (detalle) | Interés — `metadata: {tipo_inmueble, operacion}` + barrio_id |
| `evento_view` | `EventCard` (click) | Interés — `metadata: {categoria}` |
| `negocio_view` | `BusinessCard` (click) | Interés — `metadata: {categoria}` |
| `impression` | `lib/impressions.ts` (viewable) — comunidad + **listings (`MLSPanel`)** + **deals (`index`/`barrio`)** | **Alcance — capa 1** |
| `search_no_results` | backend `listings.py` (búsqueda localizada+filtros → 0) | **Demanda insatisfecha** — `metadata: {filtros}` |
| `negocio_wa_click` / `negocio_maps_click` / `negocio_web_click` | `BusinessCard` (botones) | **Intención — capa 3** — `metadata: {categoria}` |
| `listing_save` | `ListingDrawer` (favorito) | **Intención — capa 3** — `metadata: {tipo_inmueble, operacion}` |
| `visit_request` | backend `visitas.py` (POST /visitas) | **Lead — capa 4** — `metadata: {intencion}` |
| `listing_contact_wa` | `ListingDrawer` (botón Contactar) | **Lead — capa 4** — `metadata: {tipo_inmueble, operacion}` |
| `conversion` | backend `realtor.py` (`/listings/{id}/cerrar`) | **Conversión — capa 5** — `metadata: {from_lead, precio_cierre}` |

**Esquema canónico de Interés (capa 2):** `event_type = '{entidad}_view'`,
`entity_type ∈ {evento, negocio, listing}`, `entity_id` = id numérico (comunidad)
o url (listing), `barrio_id`, y `metadata` con la **dimensión clave** de la entidad:
`categoria` (evento/negocio) · `tipo_inmueble` + `operacion` (listing). Así el funnel
corta el Interés por la dimensión que le importa a cada tipo de socio B2B.

Cómputo de perfiles: `run_analytics_usuarios.py` (cron 7am) → `user_interests`
(top_barrios, categorias_eventos_top, categorias_tiendas_top, intent scores).
Lectura agregada: `GET /api/v1/admin/funnel`.

---

## 4. CAPA 1 — ALCANCE (impresiones)

### Qué es
Una entidad cuenta como **alcance** cuando entró al viewport **≥50% visible
durante ≥1s continuo** (impresión *viewable*, estilo IAB). No cuenta cargarse en
el DOM ni el scroll rápido de paso.

### Cómo funciona (captura) — `src/lib/impressions.ts`
1. `IntersectionObserver` observa cada tarjeta (`useImpression(payload)` → ref).
2. Al cumplir ≥50% por ≥1s → se registra la impresión.
3. **Dedupe por sesión:** cada entidad cuenta **1 vez por sesión** (`Set` de
   `tipo:id`). Scroll arriba/abajo no infla; tras contar, se deja de observar.

### Cómo se guarda
- **Batch:** las impresiones nuevas se acumulan y se mandan juntas cada ~4s, y al
  ocultar/cerrar la pestaña (`visibilitychange`/`pagehide`, con `keepalive`). Un
  request = muchas tarjetas, no uno por tarjeta.
- **Endpoint:** `POST /api/v1/track/impressions` (`{session_id, events[]}`, tope
  100/lote) → `pool.executemany` INSERT en `user_events` con
  `event_type='impression'`, `usuario_id` resuelto del token, `metadata={categoria}`.

### Cómo se ve
- Los datos caen en `user_events` igual que todo → `GET /api/v1/admin/funnel`
  devuelve `funnel_demanda`: por `entity_type`, `alcance` (impresiones) e `interés`
  (views) + `tasa_interes = interés/alcance`.
- Dashboard visual = capa posterior (como se acordó, el dashboard es después).

### Dónde está instrumentado (capa 1)
`EventCard` (Featured + Mini) y `BusinessCard` (Directory + List). Listings y deals
siguen el mismo patrón en capas siguientes.

### Techo / deuda
`ponytail:` una fila por impresión (deduped/sesión) en `user_events`. Si el volumen
domina, mover impresiones a tabla dedicada particionada + rollup diario.

---

## 4c. CAPA 2 — INTERÉS (normalización)

El evento ya existía (`*_view`), pero sin dimensiones no se podía cortar el funnel.
La capa 2 **normaliza** todos los `*_view` al esquema canónico (ver §3):

- `evento_view` / `negocio_view`: ya traen `metadata.categoria`.
- `listing_preview` (map.tsx) + `listing_view` (backend): ahora traen
  `metadata.{tipo_inmueble, operacion}` + `barrio_id`. **Revive
  `user_interests.tipo_inmueble_top`** (el cron lee `metadata.tipo_inmueble`, que
  nunca se mandaba → estaba muerto) y da dimensiones al funnel inmobiliario.
- **Lectura:** `GET /admin/funnel` → `categorias_eventos`, `categorias_negocios`,
  `interes_listings` (por tipo_inmueble/operacion), todo partido auth/anon.

**Deals:** se saltan en capa 2 a propósito — las tarjetas de deal son estáticas (sin
click natural), un `deal_view` sería señal falsa. Su señal es Alcance (capa 1, pend
instrumentar) + `redeem_click` (Intención, capa 3).

**Listings y Alcance:** las tarjetas de listing aún no emiten `impression` (capa 1
instrumentó comunidad). Hasta entonces el funnel de listings tiene Interés sin Alcance.

## 4d. CAPA 3 — INTENCIÓN (acciones)

La señal que convierte "vistas" en funnel con tasas: el usuario **actúa**.
Convención: eventos que terminan en `_click` o `_save`.

- **Negocio:** `negocio_wa_click`, `negocio_maps_click`, `negocio_web_click`
  (`BusinessCard`, botones WhatsApp/Maps/Web). Click a WhatsApp = el negocio recibe
  un lead — la señal más vendible del Funnel 1.
- **Listing:** `listing_save` (`ListingDrawer`, favorito; solo al marcar, no al quitar).
- **Lectura:** `GET /admin/funnel` → `funnel_demanda` ahora trae `intencion` +
  `tasa_intencion = intención/interés` por tipo de entidad.

**Diferido a capa 4 (Lead):** `listing_wa_click` / contactar agente / agendar visita
son **contacto** (el usuario entrega intención de lead), van con `visita_solicitud`.
**Eventos:** su única acción es el click saliente al ticket/info, que ya es
`evento_view` (funnel de 2 etapas: alcance→salida). **Deals:** sin acción aún
(`redeem_click` cuando exista la affordance).

## 4e. CAPA 4 — LEAD (contacto)

El usuario entrega intención de lead a un realtor/agente — la etapa de más valor
(el realtor es el wallet). Convención: NO terminan en `_click`/`_save` (para no
confundirse con Intención).

- **`visit_request`** (backend `visitas.py`, al crear `visita_solicitud`): la señal
  de lead más fuerte — agendó visita y dejó teléfono. Se emite junto al INSERT de la
  visita, con `metadata.intencion` (comprar/invertir/arrendar).
- **`listing_contact_wa`** (`ListingDrawer`, botón "Contactar" → WhatsApp al agente):
  contacto directo. Cablea `onContactWa` por `RealtorColumn` → cards (igual que
  `onSchedule`), para llevar las dimensiones del listing (`tipo_inmueble`, `operacion`).
- **Lectura:** `GET /admin/funnel` → `funnel_demanda.lead` + `tasa_lead` (lead/interés).

`phone_reveal`: no hay UI de revelar teléfono (el contacto es vía WhatsApp), no aplica.

## 4f. CAPA 5 — CONVERSIÓN (cierre)

El outcome final: el lead se volvió una venta. Es **offline** (no hay click de
usuario), se captura cuando el realtor cierra el negocio.

- **`conversion`** (backend `realtor.py`, `POST /listings/{id}/cerrar`): al marcar un
  listing propio como vendido/cerrado. Se emite junto al evento durable
  `propiedad_evento`, con `metadata.from_lead` (True si la venta se atribuyó a un lead
  de la plataforma — `visita_solicitud` con oferta/más reciente; así `tasa_conversion`
  no se infla con cierres off-platform) y `precio_cierre`. Best-effort, fuera de la
  transacción del cierre.
- **Lectura:** `GET /admin/funnel` → `funnel_demanda.conversion` + `tasa_conversion =
  conversión/lead` (la métrica de plata).

**Cobertura:** hoy la conversión se captura para **listings propios** (los que el
realtor cierra en la app). La conversión de avisos scrapeados / cierres marcados en
GHL depende del sync GHL→plataforma (bloqueado por contrato). El `resultado` de
`visita_solicitud` (oferta/interesado) existe pero aún no tiene endpoint de escritura
in-app (vive en GHL); cuando lo tenga, es otra fuente de conversión.

## 5. Roadmap por capas

- [x] **Capa 1 — Alcance** (impresiones viewable, batch) — comunidad (evento/negocio)
- [x] **Capa 2 — Interés** (normalizado: `*_view` con dimensión canónica; revive `tipo_inmueble_top`)
- [x] **Capa 3 — Intención** (negocio `wa/maps/web_click` + `listing_save`; funnel con `tasa_intencion`)
- [x] **Capa 4 — Lead** (`visit_request` + `listing_contact_wa`; funnel con `tasa_lead`)
- [x] **Capa 5 — Conversión** (`conversion` al cerrar listing propio; funnel con `tasa_conversion`)
- [x] **Alcance en listings + deals** (`MLSPanel` ListingCard + deal cards en `index`/`barrio`)
- [x] **Demanda insatisfecha** (`search_no_results` + `GET /admin/demanda-insatisfecha`)
- [x] **Logging de fallos** (los emits de user_events ya no tragan la excepción; `log.warning` con `exc_info`)
- [ ] **Pendientes menores:** `deal_redeem_click` (deals estáticos, sin affordance);
  conversión de avisos scrapeados / `visita_solicitud.resultado` (vía GHL, bloqueado)
- [ ] **Rollup** (`funnel_daily` por entidad/día vía cron) + dashboard — diferido (no se necesita aún)
