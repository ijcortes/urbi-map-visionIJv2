# ADR-0004 — GHL: salida construida, entrada/Contact/Payments bloqueados, rodeo = pull API

**Estado:** Parcial (bloqueada por contrato externo) · **Relacionado:** [GHL_CONTRATO_PROPUESTO.md](../GHL_CONTRATO_PROPUESTO.md), [GHL_ENDPOINTS_FUNNEL_STATUS.md](../GHL_ENDPOINTS_FUNNEL_STATUS.md)

## Contexto

La integración con **GoHighLevel (GHL)** es el CRM/pasarela del lado de ventas (Talal).
El contrato sobre qué objetos/campos se pueden crear en GHL **no está cerrado**, lo que
bloquea partes de la integración pero no toda.

## Decisión

Construir y dejar **vivo** lo que no depende del contrato abierto; dejar en **skeleton
(`NotImplementedError`)** lo bloqueado; y abrir un **rodeo** para el caso de uso crítico
(que Talal descubra leads nuevos).

**Vivo** (`api/utils/ghl_client.py`): `sync_listing`/`push_listing_to_ghl`,
`link_agency_to_listing`, `sync_tienda`, `sync_agency`, autenticación de webhooks.

**Bloqueado (skeleton)**: `find_or_create_contact` (→ tumba `push_agent`, `push_referidor`,
contacto del owner), `push_visita` (depende de Calendars/Appointments), `crear_checkout_session`
+ `cancelar_suscripcion` (GHL Payments), y el **receptor de webhooks** `ghl_webhook.py`
(sus 7 handlers lanzan 501).

**Rodeo vivo**: `api/routers/ghl_leads.py` — **pull API** con token (`X-API-Key` vs
`GHL_LEADS_TOKEN`, cerrado por defecto → 503). Expone `visita_solicitud`+`usuarios` para
que GHL/Talal haga *pull* de leads. No necesita Contacts/Appointments. Base legal Ley 1581
(el comprador inició el contacto).

## Consecuencias

- **+** El valor crítico (entrega de leads) fluye sin esperar el contrato.
- **−** Los `sync_agent`/`sync_referidor` en routers vivos (agency, afiliados, embajadores,
  suscripciones) son **no-op** (best-effort / `is_configured()`=false) hasta desbloquear Contact.
- **−** Pagos no fluyen por GHL todavía (ver [ADR-0007](adr-0007-pagos-via-ghl.md)).
- **Acción**: cerrar con Talal el JSON de `POST /contacts` y el payload de webhooks.
