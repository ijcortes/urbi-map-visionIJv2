# GHL — qué crear para Realtor Preferido

> Todos los precios son **EJEMPLO** (COP/mes por slot). Cambiar en la tabla `realtor_slot_precio` sin tocar código.
> Reglas: 4 slots por barrio, 8 por comuna, rotación en orden fijo, dueño sin agente no paga, cobro Stripe vía GHL.

## 1. Stripe + productos (Payments → Products)

| Producto GHL | Precio ejemplo |
|---|---|
| Slot barrio A | 400.000 |
| Slot barrio B | 280.000 |
| Slot barrio C | 200.000 |
| Slot barrio D | 120.000 |
| Slot comuna A / B / C / D | 2.000.000 / 1.400.000 / 1.000.000 / 600.000 |

Opción simple: **un Payment Link por producto** (recurrente mensual). Para que el sitio los use, crear un
**Order Form** que acepte query params `email`, `zona_nivel`, `zona_codigo`, `meses` y guardarlos como
campos ocultos. Su URL va en la variable de entorno `GHL_SLOT_CHECKOUT_URL` (DEV y PROD).

## 2. Custom fields (Contact)

`zona_nivel` (barrio|comuna) · `zona_codigo` · `meses` (número) · `pago_ref` (texto) · `slot_estado` · `slot_fecha_fin`.

## 3. Pipeline "Realtor Preferido"

Etapas: Interesado → Checkout enviado → Pagado/Activo → Por vencer → Vencido.

## 4. AI Automation Builder (workflows)

**WF-1 Pago aprobado → activar slot** (el crítico)
- Trigger: *Payment received* (Stripe, producto "Slot …").
- Acción 1: *Custom Webhook* `POST https://<API_PROD>/api/v1/webhook/ghl`
  - Header: `X-Webhook-Secret: <GHL_WEBHOOK_SECRET>`
  - Body JSON:
    ```json
    {"object_type":"realtor_slot","agent_email":"{{contact.email}}",
     "zona_nivel":"{{contact.zona_nivel}}","zona_codigo":"{{contact.zona_codigo}}",
     "meses":1,"pago_ref":"{{order.id}}"}
    ```
- Acción 2: mover oportunidad a *Pagado/Activo* + email de bienvenida.
- Respuestas: 200 ok · 404 realtor no registrado en urbi.co · 409 zona llena → crear tarea al equipo y avisar al realtor.
- Es idempotente por `pago_ref` (un reintento no duplica).

**WF-2 Renovación**: cada pago recurrente dispara el mismo WF-1 (el backend extiende `fecha_fin` 30 días).

**WF-3 Por vencer**: 5 días antes de `slot_fecha_fin` → email/WhatsApp "tu lugar en {{zona}} vence".

**WF-4 Vencido**: pago fallido (Stripe) → mover a *Vencido* + mensaje de recuperación. El slot vence solo por fecha.

## 5. AI Agent Studio — agente "Asesor de Realtors"

- Rol: contesta a realtors interesados (WhatsApp/web chat): qué es el lugar preferido, cuántos slots hay, precio de su zona, cómo funciona la rotación.
- Herramienta sugerida: consulta `GET /api/v1/realtor-preferido/zona?zona_nivel=…&zona_codigo=…` (cupos y precio) y envía el link de checkout.
- Regla dura del prompt: no prometer posición, no inventar precios (usar los de la API), derivar a humano si piden descuento.

## 6. Ask AI

Usos: resumir conversaciones por oportunidad, redactar el recordatorio de vencimiento y responder preguntas del equipo ("¿qué zonas se vencen esta semana?").

## 7. Variables de entorno

| Var | Valor |
|---|---|
| `GHL_WEBHOOK_SECRET` | ya existe |
| `GHL_SLOT_CHECKOUT_URL` | URL del Order Form (paso 1) |

## 8. Arranque (todo barrio con ≥1 preferido)

Admin: `POST /api/v1/realtor-preferido/admin/asignar` con `tipo:"gratis"`. Ver faltantes: `GET /admin/cobertura`.
Un pagador desplaza al gratis solo cuando la zona está llena.

## Lo único que falta: conectar GHL (checklist final)

1. Env backend: `GHL_SLOT_CHECKOUT_URL` (Order Form + Stripe), `GHL_WEBHOOK_SECRET`. Sin el link, la landing muestra "pago próximamente".
2. Env front: `VITE_GHL_EXTRA_HOSTS` si el checkout está en un dominio propio.
3. Workflow GHL tras el pago: POST `/api/v1/webhook/ghl` con `object_type: "realtor_slot"`, header `X-Webhook-Secret`, y `pago_ref`, email, zona, meses. Luego agregar el tag **Preferred** al contacto.
4. Rama 409/404 del webhook: tarea + reembolso manual.
5. Marcar el realtor de la casa: `POST /api/v1/realtor-preferido/admin/casa` `{agent_id}` (el cron siembra 1 gratis por barrio).
6. Reemplazar los precios de ejemplo en `realtor_slot_precio` (`es_ejemplo=TRUE`).

Flujo: landing → `/checkout` → GHL/Stripe → webhook → slot activo → cron diario (`realtor_slots`) vence, sincroniza tier y avisa.
