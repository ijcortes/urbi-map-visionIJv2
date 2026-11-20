# Reporte: journeys por persona + GHL + conversión

Fecha: 2026-11-13. Método: llamadas reales a `ghl_client` (9 contactos test, tag `test-integracion`) verificadas con GET en GHL + revisión read-only del sitio en producción. No se enviaron formularios en prod.

## 1. Estado en GHL (verificado)

| Persona | Punto de captura | ¿Llega a GHL hoy? | Tags |
|---|---|---|---|
| Realtor | /agentes/registro, suscripciones | Sí (Contact+tag) | agent, agent-{estado} |
| Embajador (barrio guía) | /embajador | Sí | referidor, referidor-embajador |
| Afiliado | /afiliado | Sí | referidor, referidor-afiliado |
| Extranjero / Local (comprador, arrendatario) | Drawer "agendar visita" | Sí, + nota con intención/presupuesto/crédito | visita-solicitada |
| Negocio | /negocios/unirse (`leads_negocio`) | **No** (solo DB) | — |
| Pasante EAFIT | /pasantias | **No** | — |
| Newsletter / registro | /suscribirse, /register | **No** | — |
| Propietario (vender/publicar) | /vender, /publicar | Solo listing; **sin Contact del dueño** | — |
| Reclamo de listing, alerta de precio, solicitud a agente | listings/alertas | **No** | — |

Los 9 contactos test quedaron con 1 nota cada uno (los 5 "No" se simularon a mano para validar el formato; en la app real no ocurre).

**Brecha clave: no existe ningún pipeline/oportunidad en GHL** (`/opportunities/pipelines` → vacío). Hoy solo hay Contacts. "Oportunidades" requiere: (a) que Talal/Israel creen pipelines y stages en GHL, (b) agregar `/opportunities/` a la allowlist del cliente.

## 2. Qué falta (priorizado)

### Datos → GHL (≈ 1 día total)
1. Crear pipelines en GHL (Realtors, Negocios, Compradores/Visitas, Embajadores) — 30 min, es del lado GHL.
2. Cablear los 5 puntos sin sync (negocio, pasantía, suscripción/registro, reclamo, solicitud-agente) con `upsert_contact` + tag de origen — 2–3 h.
3. Crear oportunidad por evento de alto valor (visita, aplicación de negocio, realtor pago) — 2 h tras el paso 1.
4. Tags de segmentación faltantes: `extranjero` vs `local` (derivable de teléfono/idioma/país), `propietario`, `negocio-local`, `pasante`.
5. Recortar scopes del token a los usados y rotarlo.

### UX / psicología / conversión (cambios chicos, alto impacto)

**Realtor** — la home no le habla.
- Agregar una banda "¿Eres agente? Recibe compradores de tu zona" bajo el hero, enlazando a /agentes. 1 h.
- /agentes/registro pide solo nombre + WhatsApp (bien, baja fricción), pero está en inglés y sin prueba de valor: poner "X visitas pedidas este mes en tu comuna" y precio ($149/mes Listing Member) visible antes del form.
- Cambiar el CTA a algo concreto: "Ver cuántos leads hay en mi barrio".

**Negocio** — no entiende que es marketing para él.
- /negocios y /local-business dan 404 en prod: el negocio no tiene landing. Redirigir /negocios → pitch propio. 
- Mensaje: "Tu negocio en el mapa del barrio donde viven tus clientes" + ejemplo visual de ficha + precio.
- Prueba social: contador de vecinos suscritos (+1,200) y visitas al barrio.

**Extranjero** — idioma mezclado EN/ES, cifras inconsistentes (100K+ vs 54K+ propiedades).
- Selector de idioma visible en header; unificar cifras en una constante.
- Sección "Comprando desde el exterior": proceso, costos, seguridad, WhatsApp en inglés.
- Capturar país/idioma en el form de visita (hoy no se guarda → no se puede segmentar en GHL).

**Local** — buena entrada (/suscribirse), pero /vender usa "3% comisión solo si cerrás" y MISION_VISION dice "sin comisión de cierre": **contradicción de modelo** que hay que resolver antes de promocionar.

**Embajador / barrio guía** — mejor pitch del sitio ("Aplica ahora" claro). Falta: qué gana exactamente (monto/beneficio) arriba del fold y confirmación posterior ("te escribimos en 24 h").

**Transversal**
- Popup de tutorial tapa el hero en la primera visita: diferirlo o hacerlo opcional.
- Home con un solo mensaje (barrio + suscribirse) → agregar selector "Soy: vecino · agente · negocio · inversionista desde el exterior" que dirija a cada landing. Es el cambio de mayor impacto con menos esfuerzo (≈ 2 h).

## 3. Pendiente para confirmar
- ¿Cableo los 5 puntos sin sync ahora? (cambia código de auth/business/pasantias).
- Borrar los 9 contactos `test-integracion` (+ los de la prueba anterior) en GHL.
- Nada se ha empujado a `origin` ni a la org.
