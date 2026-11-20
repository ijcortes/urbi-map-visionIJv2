# Engranajes: quién avisa a quién (2026-11-13)

Deducido del código (INSERT/UPDATE de estado en `api/`, emails existentes, crons). Regla: cada evento que cambia un estado debe (1) avisar a quien actúa después, (2) confirmar a quien lo disparó, (3) tener cierre. Estado: OK / ROTO / FALTA.

Hallazgo clave: `api/utils/email.py` YA tiene `notify_agente_aprobado`, `notify_agente_rechazado` y `notify_admin_new_agente`, pero **nadie las llama** (código muerto). Cablearlas = minutos.

## A. Realtor

| # | Evento | A quién hay que avisar | Hoy | Estado |
|---|---|---|---|---|
| A1 | Realtor se registra (`/agentes/registro`) | Admin (revisar) + realtor ("recibimos tu solicitud") | Solo GHL. `notify_admin_new_agente` existe sin llamar | ROTO |
| A2 | Admin aprueba | Realtor ("aprobado, siguiente: elige tu zona") + GHL etapa | Solo UPDATE. `notify_agente_aprobado` sin llamar | ROTO |
| A3 | Admin rechaza | Realtor (motivo) + GHL | Solo UPDATE. `notify_agente_rechazado` sin llamar | ROTO |
| A4 | Realtor aprobado sin zona | Realtor ("sin zona no recibes leads") | Nada | FALTA |
| A5 | Compra de zona (pago) | Realtor + admin | `/zonas/checkout` 501; solo admin asigna a mano | FALTA |
| A6 | Pago de plan | Realtor | Webhook Stripe OK + email OK; falta crear el checkout | FALTA (checkout) |
| A7 | Suscripción/zona vence | Realtor (aviso 7 días antes y al vencer) | Solo marca `vencida` por webhook; sin recordatorio | FALTA |
| A8 | Se le asigna un intake (dueño publica) | Realtor | Email con ventana 24h | OK |
| A9 | Intake vence 24h → pool | Realtor que perdió + los demás | Cron horario `sweep_asignados` mueve a pool; sin aviso | PARCIAL |
| A10 | Realtor acepta/rechaza intake | Dueño ("tu agente es X") | Nada | FALTA |

## B. Visita / lead de comprador (el engranaje del dinero)

| # | Evento | A quién | Hoy | Estado |
|---|---|---|---|---|
| B1 | Visitante pide visita | **Agente asignado** (listing o sponsor de zona) | Nada. Solo email a `rentalinquiries@` si NO hay agente | **ROTO (crítico)** |
| B2 | Idem | Visitante ("recibimos tu solicitud, te escribe X") | Nada | ROTO |
| B3 | Idem | GHL (Contact+nota+opp) | OK | OK |
| B4 | Agente no responde en N horas | Admin / reasignar | Nada | FALTA |
| B5 | Agente marca confirmada/realizada/resultado (`PATCH /realtor/visitas`) | Visitante (confirmación) + GHL etapa | Solo UPDATE | FALTA |
| B6 | Visita sin agente | Quién atiende `rentalinquiries@` | Solo email; sin asignación | PARCIAL |

## C. Propietario

| # | Evento | A quién | Hoy | Estado |
|---|---|---|---|---|
| C1 | Dueño publica | Admin | `_notify_admin_new_listing` | OK |
| C2 | Moderación aprueba/rechaza | Dueño | No vi aviso en `moderacion_service` | FALTA |
| C3 | Dueño solicita gestión a agente | Agente / dueño al responder | `_notify_agente_nueva_solicitud`, `_notify_propietario_respuesta` | OK |
| C4 | Dueño como Contact en GHL | — | No existe | FALTA |

## D. Negocio local

| # | Evento | A quién | Hoy | Estado |
|---|---|---|---|---|
| D1 | `/negocios/unirse` (lead) | Admin + negocio ("te contactamos") | GHL sí; email no; ninguna tabla lo consume | ROTO |
| D2 | Lead → tienda | Admin convierte | No hay puente ni vista admin | FALTA |
| D3 | `/mi-negocio` crea tienda inactiva | Admin | Aparece en `/tiendas/pendientes` pero sin aviso | PARCIAL |
| D4 | Admin aprueba/rechaza tienda | Dueño del negocio | `sync_tienda` a GHL; sin email | FALTA |
| D5 | Pago → `destacado` | Negocio | Sin planes de negocio, sin cobro | FALTA |
| D6 | Alta de deals | — | Solo sembrados | FALTA |
| D7 | Reporte "te vieron N" | Negocio (mensual) | Eventos existen, sin reporte ni cron | FALTA |

## E. Otros

| # | Evento | Hoy | Estado |
|---|---|---|---|
| E1 | Embajador/afiliado aplica → aprobación, código, comisión | Solo Contact+opp en GHL | FALTA |
| E2 | Pasante aplica | Solo DB | FALTA |
| E3 | Webhook GHL → sitio | 501 | FALTA |
| E4 | Comunidad: post aprobado/rechazado → autor | Solo UPDATE | FALTA |
| E5 | Email sin SMTP/Gmail configurado | Solo loguea, no falla | RIESGO: verificar env en prod |

## F. Rueda del dinero (quién paga qué)

1. Realtor paga **zona** (barrio/comuna, exclusiva) → recibe visitas e intakes de esa zona. Hoy: cobro no existe; admin asigna a mano.
2. Realtor/usuario paga **plan** (pro / agente) → Stripe webhook listo, falta crear checkout.
3. Negocio paga **destacado/plan** → no existe plan ni cobro.
4. Dueño paga **3% si cierra** (o "sin comisión": contradicción en docs) → sin tracking de cierre. Decidir modelo antes de promocionar.
5. Precios: $149 vs $59 en docs vs `planes.py` ($29 USD/79K COP pro). Definir cuál manda.

## G. Plan mínimo (que gire, no que sea ideal)

Principio: **el API envía emails transaccionales ya (util existe); GHL recibe tags/opps para seguimiento.** Sin depender de workflows de Talal para lo crítico.

| Prio | Qué | Gears | Tiempo |
|---|---|---|---|
| 1 | Email al agente + confirmación al visitante en `crear_visita` | B1, B2 | 1 h |
| 2 | Llamar los 3 `notify_*` muertos + email "bienvenida solicitud" | A1, A2, A3 | 1 h |
| 3 | Email al admin en lead de negocio, tienda nueva; email al dueño al aprobar tienda | D1, D3, D4 | 1.5 h |
| 4 | Cron diario (`Dockerfile.cron`) de recordatorios: visitas sin respuesta >24h → admin; suscripción/zona por vencer → realtor | B4, A7 | 3 h |
| 5 | Checkout Stripe de zona con metadata → `procesar_pago_zona` (webhook) | A5, A6 | 4–6 h |

Después: puente lead→tienda + vista admin (D2, 2 h), email al dueño en moderación (C2), aviso "elige tu zona" tras aprobar (A4), GHL stage updates al aprobar/rechazar (A2/A3), deals y destacado de pago (D5/D6).

Reglas del proyecto: todo en código committeado; cron en `Dockerfile.cron`; probar en DEV antes de prod. Falta verificar en DEV que el email realmente sale (E5).
