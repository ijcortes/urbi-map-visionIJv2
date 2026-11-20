# Mapa de procesos y cableado faltante (2026-11-13)

Base: lectura de código (api/routers, services) + docs/FLUJO_REALTOR.md, FUNNEL_B2B.md. Lo marcado "no vi" = no lo encontré en el código; verificar antes de darlo por inexistente.

## 1. Realtor

| Paso | Qué pasa hoy | Estado |
|---|---|---|
| Registro | `/agentes/registro` → `agent` en `pendiente` (exige login + email verificado). Push a GHL (Contact + opp "new"). | OK |
| Aprobación | Admin aprueba a mano en `admin_agentes` (`pendiente→activo`). Re-auth con password. | OK, manual |
| Pago del plan | `suscripciones/iniciar` → Stripe/GHL checkout **NotImplemented**. | FALTA |
| Compra de zona | `/zonas/checkout` devuelve 501 con pasarela; solo simulado en dev. Único camino real: admin asigna zona a mano (`POST /admin/agentes/{id}/zonas`). | FALTA (cobro) |
| Publicar listing | Agente activo: `listing.agent_id = él`, sale publicado. | OK |
| Listing de un dueño | Dueño publica → `en_revision` + `intake`. `asignar_intake` lo da al dueño de la agencia con sponsorship activo más antiguo en ese barrio; si no hay → pool. Timeout 24h → vuelve al pool. | OK |
| Quién es dueño de qué propiedad | `listing.agent_id` (o `intake.agent_id` hasta aceptar). Visitas: `listing.agent_id` → sponsor de la zona → buzón rentalinquiries@. | OK |
| Moderación | `moderacion_service` aprobar/rechazar + log. | OK |

**Huecos reales:**
1. Pago → activación → zona no está conectado. Sin eso, "agente paga" = admin manual.
2. Sin sponsor en la zona, todo cae al pool/buzón: el realtor que no compró zona no recibe leads, y nadie le avisa por qué (no vi notificación de "lead nuevo en tu zona").
3. GHL → sitio (webhook/leads inbound) sigue 501: el cambio de etapa en GHL no activa nada en la web.
4. El dueño (propietario) no llega como Contact a GHL.

## 2. Negocio local (marketing)

| Paso | Qué pasa hoy | Estado |
|---|---|---|
| Entrada A: `/negocios/unirse` | Inserta `leads_negocio` + ahora Contact/opp en GHL. **Nada más consume esa tabla** (sin admin, sin conversión a tienda). | Callejón sin salida |
| Entrada B: `POST /negocios/mi-negocio` (logueado) | Crea `tiendas` con `activo=false` → admin `/tiendas/pendientes` → aprobar → `activo=true` + `sync_tienda` a GHL. | OK |
| Qué negocio se muestra | `tiendas` con `activo=true`, filtrado por `barrio_id` (directorio, hotspots, deals). Orden/visibilidad por `destacado`. | OK |
| Deals/ofertas | Solo sembrados en migración 0011. No hay endpoint para que el dueño cree uno. | FALTA |
| Destacado / plan de pago | `plan_tipo` se guarda en el lead pero no hay cobro ni flag que se active al pagar. | FALTA |
| Prueba de valor (Funnel 1) | `user_events` impresiones/clicks existen; sin dashboard para el negocio. | FALTA |

**Huecos:** (1) puente lead→tienda (hoy admin tendría que copiar a mano), (2) cobro → `destacado`, (3) alta de deals por el dueño, (4) reporte "te vieron N personas" que es lo que vende el plan.

## 3. Otras personas

| Persona | Hoy | Falta |
|---|---|---|
| Embajador / Afiliado | `aplicacion_referidor` + Contact y opp en GHL | No vi aprobación, código de referido ni atribución/comisión. |
| Pasante EAFIT | Aplica, solo DB | Sin GHL, sin flujo de revisión. |
| Comprador/arrendatario (local o extranjero) | Visita → Contact + nota + opp, ruteada al agente | No se guarda país/idioma; sin seguimiento de resultado. |
| Propietario | Publica, sale intake | Sin Contact; no recibe aviso de quién lo tomó (no vi). |
| Suscriptor/newsletter, alertas, reclamos | Solo DB | Sin GHL (pospuesto por ti). |

## 4. Conclusión: cómo hacerlo

**Regla:** el sitio decide *quién es dueño de qué* (DB); GHL maneja cobro, mensajes y seguimiento. Un solo punto de verdad por dato.

Orden recomendado (cada uno cierra un flujo completo):
1. **Cobro realtor → activa plan + zona** (bloquea ingresos). Dos opciones: Stripe directo (ya hay `procesar_pago_zona` listo para el webhook, solo falta crear el checkout con metadata) o GHL payments (esperar contrato de Talal). Recomiendo Stripe para zona: el código ya está; GHL solo recibe el contacto.
2. **Webhook GHL → sitio** (Talal: secreto, firma, payloads). Con eso GHL puede marcar "pagado/aprobado" y la web activa.
3. **Puente lead_negocio → tienda**: botón admin "Convertir en negocio" que crea la `tiendas` (activo=false) y la liga al lead. ~2 h.
4. **Aviso al realtor** cuando se le asigna un intake/visita (email/WhatsApp vía workflow GHL con tag). ~2 h + workflow.
5. **Negocio: cobro → `destacado` + alta de deals + reporte Funnel 1.** Se hace después de 1–3.

Workflows GHL (a definir con Talal, disparados por tag/opp): bienvenida realtor, lead de zona asignado, negocio nuevo, visita solicitada, embajador aprobado.
