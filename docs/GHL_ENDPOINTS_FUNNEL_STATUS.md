# GHL — Inventario de endpoints + qué falta para el funnel completo

_Generado 2026-10-26. Vista centrada en endpoints/wiring (complementa
`GHL_CONTRATO_PROPUESTO.md`, que es la vista por entidad)._

## ⚠️ Estado real hoy (lo más importante)

**Ninguna credencial GHL está configurada — ni en PROD ni en DEV:**
`GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `GHL_LEADS_TOKEN`
→ **todas ausentes** (verificado 2026-10-26 contra Railway `Social-api` en ambos
entornos).

Consecuencia:
- `ghl_client.is_configured()` = `False` en **ambos entornos desplegados (prod/DEV)**
  → **todo el outbound que está "construido y funcionando" (listing/tienda/agency) hoy
  es un no-op** (retorna `None`, no manda nada). _(En `.env` local SÍ hay creds → ahí
  `is_configured()` llega al stub y levanta; por eso los call sites envuelven en
  try/except. Pero local no sirve tráfico real.)_
- Webhook inbound → **503** (sin `GHL_WEBHOOK_SECRET`).
- Lead PULL → **503** (sin `GHL_LEADS_TOKEN`).

> **Nada fluye hacia o desde GHL hoy.** El código existe; el interruptor (cuenta +
> credenciales) no. Ese es el verdadero "lo que aún no está en GHL".

Leyenda de estado del código:
- 🟢 **Listo** — funciona apenas haya credenciales (no bloqueado por Talal).
- 🟡 **Stub** — `NotImplementedError`/501 a propósito; bloqueado por contrato de Talal.

---

## A. Endpoints HTTP que NOSOTROS exponemos para que GHL los llame (entrante)

| Método + ruta | Para qué | Estado | Gate |
|---|---|---|---|
| `POST /api/v1/webhook/ghl` | Receptor de webhooks GHL→nosotros (7 entidades: listing, deal, evento, tienda, referidor, agent, visita) | 🟡 Auth del header **lista**; los 7 handlers `_upsert_*_from_ghl` devuelven **501** | `GHL_WEBHOOK_SECRET` (sin él → 503) |
| `GET /api/v1/ghl/leads` | Lead PULL — descubrimiento/polling de leads de visita calificados (`?since=&estado=&limit=`) | 🟢 **Construido y listo** (no bloqueado) | `GHL_LEADS_TOKEN` via `X-API-Key` (sin él → 503) |
| `GET /api/v1/ghl/leads/{visita_id}` | Re-sync de un lead puntual por ID | 🟢 **Construido y listo** | igual que arriba |

Archivos: `api/routers/ghl_webhook.py`, `api/routers/ghl_leads.py`.

---

## B. Llamadas que NOSOTROS hacemos a la API de GHL (saliente — `api/utils/ghl_client.py`)

No son endpoints nuestros; son los pushes contra `services.leadconnectorhq.com`.

| Función | Objeto GHL / endpoint GHL | Estado | Disparado desde (call site) |
|---|---|---|---|
| `sync_listing` / `push_listing_to_ghl` | Custom Object `real_estate_listing` — `POST/PUT /objects/.../records` | 🟢 Listo (inerte sin creds) | `realtor.py` (×3), `listings_propios.py` (×3), `moderacion_service.py` (×2), `intake_service.py` |
| `sync_tienda` / `push_tienda_to_ghl` | Business — `POST /businesses/` + `PUT /objects/business/records` | 🟢 Listo (inerte) | `admin.py` (×2) |
| `sync_agency` / `push_agency_to_ghl` | Business — `/businesses/` | 🟢 Listo (inerte) | vía `link_agency_to_listing` |
| `link_agency_to_listing` | Association Agency→Listing — `POST /associations/relations` | 🟢 Listo (inerte) | `intake_service.py` |
| `find_or_create_contact` | Contact — `POST /contacts` | 🟡 Stub | — (lo necesitan agent/owner/referidor) |
| `push_agent_to_ghl` / `sync_agent` | Contact (Agent=Contact ✅ confirmado) | 🟡 Stub (falta JSON de `/contacts` de Talal) | `suscripciones.py` (alta realtor), `agency.py` (aceptar invitación) |
| `push_referidor_to_ghl` / `sync_referidor` | Contact (afiliado/embajador) | 🟡 Stub | `afiliados.py`, `embajadores.py` |
| `push_visita_to_ghl` / `sync_visita` | Appointment / Calendar del agente | 🟡 Stub (falta API Calendars) | — (hoy el lead va por PULL, no push) |
| `push_evento_to_ghl` | Custom Object Event | 🟡 Stub | — |
| `push_deal_to_ghl` | Deal/Convenio | 🟡 Stub | — |
| `crear_checkout_session` / `cancelar_suscripcion` | GHL Payments (reemplazo de Stripe) | 🟡 Stub | `suscripciones.py` (aún en Stripe/Wompi) |

Infra de sync lista: `ghl_object_mapping` (migr 0082/0083, acepta
listing/tienda/evento/deal/agent/owner/agency) + `ghl_push_failures` (reintentos).
Falta agregar `referidor` al CHECK cuando se implemente §6.

---

## B-bis. El funnel como flujo (lead → venta) y dónde entra GHL

Puerta de entrada (front door) y recorrido:

1. **Captura del lead** → `POST /api/v1/visitas` (modal "Agendar visita") escribe
   `visita_solicitud`. **Este es el origen del lead** — hoy NO se empuja a GHL
   (`push_visita_to_ghl` es stub); en su lugar GHL lo trae por el **lead PULL**
   (`GET /api/v1/ghl/leads`). 🟢 listo, apagado por falta de `GHL_LEADS_TOKEN`.
2. **Registro web / lead de marketing** → Contact en GHL (§5). 🟡 depende de
   `find_or_create_contact` (stub) + Workflow "Contact Created".
3. **Inventario que acompaña al lead**: listing (🟢), su agente (agent→Contact, 🟡),
   su agencia (agency→Business, 🟢 pero ver gap abajo), tienda (🟢).
4. **Cierre/venta y comisión**: Deal/Convenio (🟡) + Referral del afiliado/embajador (🟡).

> **Gap de funnel (no solo de inventario):** `sync_agency` **no tiene trigger propio** —
> solo se dispara dentro de `link_agency_to_listing`. Una agencia **sin listings nunca
> llega a GHL**. Si el funnel necesita la agencia como entidad independiente, falta
> cablear `sync_agency` en el alta/edición de agencia.

---

## C. Qué falta para que el funnel esté COMPLETO

### 0. Prerrequisitos de cuenta — **bloquean TODO** (ni lo ya construido corre)
1. **Email de la cuenta GHL** para conectar el sub-account — sin definir.
2. **`GHL_PRIVATE_TOKEN` + `GHL_LOCATION_ID`** en prod y DEV — hoy ausentes en ambos.
   Sin esto, listing/tienda/agency siguen inertes aunque estén "listos".
3. **`GHL_WEBHOOK_SECRET`** — desbloquea de un golpe **todo el inbound** (7 entidades)
   + login unificado. Es la pieza más barata/alto-impacto.
4. **`GHL_LEADS_TOKEN`** — enciende el lead PULL (ya construido) para que Talal lo conecte.
5. **≥1 Workflow en GHL** por entidad (trigger record created/updated → webhook a
   nuestra API) — ninguno existe del lado GHL.

### 1. Inbound (GHL → nosotros) — framework listo, 7 handlers en 501
Falta de Talal: firma real del webhook (header+algoritmo) y un payload de ejemplo por
entidad para mapear los campos. Con eso se implementan `verificar_webhook` +
`_upsert_*_from_ghl`. Entidades: listing, deal, evento, tienda, referidor, agent, visita.

### 2. Contact (Agent / Owner / Referidor) — tipo confirmado, falta payload
`Agent=Contact`, `Owner=Contact` ✅ y `POST /contacts` probado (201) 2026-10-03.
**Falta recibir el JSON de Postman de Talal** para implementar `find_or_create_contact`
→ desbloquea agent/owner/referidor de salida de una vez. + picklists de `agent_status`.

### 3. Pagos (suscripciones) → GHL Payments
Decidido reemplazar Stripe/Wompi por GHL. Falta: price/product ID por plan,
API de checkout, esquema de webhook de pago, y confirmar que GHL procesa COP/PSE/Nequi.
Hoy el cobro sigue en Stripe/Wompi.

### 4. Entidades aún sin contrato confirmado (siguen siendo propuesta)
Eventos (payload + picklist category/audience), Deal/Convenio (deal_type, bilingüe,
category), Hotspot (¿Business o Custom Object?), Referral/Affiliate Manager
(¿API?, campos, sub-account vs Contact central, quién genera el `codigo`), Visita
(toda la API de Calendars/Appointments por agente).

---

## Orden sugerido para completar
1. **Cuenta + las 4 env vars (§0)** — enciende lo ya construido: outbound
   listing/tienda/agency + lead PULL. Sin tocar código.
2. **Firma del webhook** — desbloquea las 7 entidades inbound + login unificado.
3. **JSON de `POST /contacts`** — enciende agent/owner/referidor de salida.
4. Resto por prioridad de negocio: Referral/Affiliate → Deal → Hotspot → Eventos → Pagos.
