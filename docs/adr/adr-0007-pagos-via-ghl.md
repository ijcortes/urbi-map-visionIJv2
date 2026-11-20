# ADR-0007 — Pagos simulados hoy; cobro real se migra a GHL, no a Stripe

**Estado:** Decidida, migración pendiente · **Relacionado:** [ARCHITECTURE §9](../ARCHITECTURE.md#9-modelo-de-negocio), [ADR-0004](adr-0004-ghl-bloqueado-pull.md)

## Contexto

Se construyó una pasarela Stripe completa (`api/utils/stripe_client.py` + `suscripciones.py`
+ `api/config/planes.py` con planes "pro" $29 / "agente" $59) y un checkout de zona
patrocinada (`zonas.py` + `zona_sponsor_service.py`). Pero: (a) no hay agentes reales en
producción todavía, y (b) comercialmente se decidió centralizar el cobro en **GoHighLevel**
(el CRM de ventas), no en Stripe.

## Decisión

**Pagos apagados / simulados** hasta migrar el cobro a GHL:
- `zonas.py /checkout` devuelve `{"modo":"simulado"}` si no hay `STRIPE_SECRET_KEY`.
- `suscripciones.py /iniciar` cae a `modo_manual` (WhatsApp/email "contacta al equipo").
- Las landings `/planes/*` venden **manual** (mailto/WhatsApp), sin checkout.
- El checkout real será **hosted en GHL** (`src/config/ghl.ts`), pero `crear_checkout_session`
  en `ghl_client.py` sigue en skeleton → bloqueado por [ADR-0004](adr-0004-ghl-bloqueado-pull.md).

## Consecuencias

- **−** `stripe_client.py` + planes "pro"/"agente" + rutas `/suscripcion/exito`·`/cancelada`
  son **código vivo pero huérfano de funnel** — residuo del modelo pre-pivot (el plan-Pro de
  usuario murió el 29-jun-2026; "agente $59" lo reemplazó el patrocinio de zona). Marcar
  legacy; limpiar cuando GHL Payments esté cableado o si se descarta Stripe definitivamente.
- **−** Ningún peso cambia de manos hoy; la monetización está construida pero inerte.
- **Acción**: desbloquear GHL Payments (contrato), o decidir revivir Stripe. Hasta entonces,
  no ampliar ninguna de las dos pasarelas.
