# Resumen ejecutivo — Protección de datos (Colombia)

Qué cumplimos, qué falta y qué riesgos cubre el sistema de consentimiento y la
política de privacidad. Marco: **Ley Estatutaria 1581 de 2012**, **Decreto 1377 de
2013** y **Decreto Único 1074 de 2015 (cap. 25)**. Autoridad: **SIC**.

> ⚠️ Este resumen y la política son un borrador técnico completo y conforme a la
> norma. **No reemplaza la validación de un abogado colombiano habilitado** antes
> de publicar en producción. No podemos garantizar "cero demandas"; sí dejamos la
> postura de cumplimiento correcta y defendible.

---

## 1. Lo que YA cumple el sistema

- **Autorización previa, expresa e informada** (art. 9 Ley 1581): checkbox
  obligatorio en `/register` y `/suscribirse`; la cuenta no se crea sin aceptar
  (rechazo 422 en backend). Google Sign-In honra el mismo checkbox.
- **Prueba de la autorización** (art. 9 + Decreto 1377 art. 5): se guarda
  `habeas_data_aceptado`, `habeas_data_fecha` y `habeas_data_version` por usuario
  (migración 0121). La versión se sube en `api/legal.py` cuando cambie el texto.
- **Política de Tratamiento completa** (Decreto 1377 art. 13): publicada en
  `/politica-privacidad` con identificación del responsable, finalidades, datos
  recolectados, derechos, canal y procedimiento, menores, transferencias y vigencia.
- **Finalidades específicas** incluyendo lo que el funnel realmente hace: analítica
  de comportamiento, perfilado de interés, y compartir **insights agregados** (no
  datos individuales) con socios comerciales. Sin esto, el funnel sería ilegal.
- **Derechos del titular** (art. 8): conocer, actualizar, rectificar, revocar,
  suprimir, pedir prueba, acceso gratuito — con canal `privacidad@medellinsocial.com`.
- **Consentimiento por canal**: email (`newsletter_activo`) y WhatsApp
  (`consent_whatsapp`) separados y opcionales.
- **Menores (art. 7):** la plataforma declara ser para mayores de 18 y no recolecta
  conscientemente datos de menores.

## 2. Lo que DEBE hacer el negocio (bloqueantes para producción)

1. **Completar los datos registrales** del responsable en `/politica-privacidad`
   (razón social, NIT, domicilio, teléfono) — marcados `[POR COMPLETAR]`. No se
   pueden inventar.
2. **Validación por abogado** de datos personales habilitado en Colombia.
3. **Evaluar registro RNBD ante la SIC.** Obligatorio si los activos de la empresa
   superan **100.000 UVT** (~COP $5.2B en 2026) **o** si se tratan datos de menores
   o sensibles (sin importar tamaño). Hoy no recolectamos sensibles ni menores → el
   disparador probable es solo el umbral de activos. Confirmar con el contador.
4. **Habilitar el canal real** `privacidad@medellinsocial.com` (buzón monitoreado):
   consultas se responden en **10 días hábiles** (art. 14), reclamos en **15 días
   hábiles** (art. 15).

## 3. Puntos sensibles (riesgo alto si se omiten)

- **Transferencia internacional a EE. UU. (GHL)** — art. 26. Enviar datos a GoHighLevel
  (email/WhatsApp/CRM) es transferencia internacional. Debe estar **declarada en la
  política** (lo está) y amparada por el consentimiento. No activar envíos por GHL sin
  esto + el contrato con Talal (hoy el push a GHL sigue bloqueado por contrato).
- **Marketing por WhatsApp** — requiere opt-in previo (`consent_whatsapp`, ya se
  captura) **más** las reglas de Meta: plantillas pre-aprobadas y ventana de 24h. No
  enviar marketing a quien no dio el opt-in.
- **Consentimiento no se fabrica**: el endpoint anónimo `/suscribirse` NO sella
  habeas_data sobre una cuenta ya existente (sería una autorización falsa, peor que no
  tenerla en una auditoría). Solo lo sella en el alta nueva o logueado.

## 4. Dónde vive cada cosa (para mantenimiento)

| Qué | Dónde |
|---|---|
| Texto legal de la política | `src/routes/politica-privacidad.tsx` |
| Versión del consentimiento | `api/legal.py` → `HABEAS_DATA_VERSION` |
| Captura + validación backend | `api/routers/auth.py`, `api/routers/usuario.py` |
| Columnas de consentimiento | migración `0121_consentimiento_datos.py` (`usuarios`) |
| Checkbox UI | `src/components/ConsentFields.tsx` |

**Al cambiar el texto legal:** subir `HABEAS_DATA_VERSION` para que los
consentimientos nuevos queden ligados a la versión vigente (los viejos conservan la suya).
