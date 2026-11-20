# Medellín Social — To-do

Oct 26, 2026 · @Eduard Manuel Giraldo Martínez

Lo que falta según el estado de funciones del 26 de octubre. El cobro real queda aparte por ahora.

## 1. Errores de datos (urgente)

- [x] Verificar las unidades del avalúo catastral y recalcular la relación mercado/catastro (la mediana de 58,8 no es creíble; lo esperado es entre 1,5 y 3). Probar con cinco predios. — **Bug hallado y arreglado** (rama, commit ad26d51): el agregado por comuna metía 70k parqueaderos y matrices de edificio entero (área de miles de m²) → avalúo/m² ~40x chico → ratio ~109 al grano real. Fix en los 2 sitios (loader `catastro_comunas_stats` + dbt `listings_vs_catastro`): solo viviendas 30–400 m², sin parqueadero/lote, mediana. Ratio baja a **~3,8 en El Poblado** (muestra robusta). **No llega a 1,5–3**: residual por catastro genuinamente bajo (vivienda "progresivo") + ruido del p50 de mercado en comunas pobres (n=4–14) → ver §3. Umbrales SOBRE/NORMAL (3,0/1,5) a recalibrar en §3 (el catastro de Medellín va ~5–8x bajo mercado; casi todo cae SOBRE_CATASTRO).
- [x] Probar una alerta de principio a fin. Si la notificación no llega, ocultar el botón hasta que funcione. — **Probado (26 oct)**: el matching DB funciona (dry-run halla 124 coincidencias), pero el envío NO llega: `api/utils/email` cae en `[EMAIL STUB]` (sin `SMTP_USER/PASS` ni Gmail API configurado → imprime, no envía) y el social-cron no está redeployado. **Botón OCULTO** (`ALERTAS_NOTIFIER_READY=false`). Reactivar cuando: (1) transporte real de email configurado, (2) social-cron redeployado, (3) una alerta de prueba llegue de verdad.

## 2. Niveles de acceso

- [x] Seguridad: pasar de solo agentes a gratis para todos. — Quitado `seguridad_score` de `_REALTOR_FIELDS` (listings.py); el panel de barrio ya la mostraba a todos. Ahora pública en ambas superficies.
- [x] Tiempos de recorrido: pasar de solo agentes a gratis para todos. — **El ítem estaba stale**: los tiempos (tiempo_poblado/centro) ya eran públicos en todos lados (GettingAround del drawer y TraficoSection del panel, sin gate). Nada que cambiar.
- [x] Valorización y proyecciones: se quedan solo para agentes. — Gate en `ValorizacionSection` (FloatingPanel) con `useIsAgente`: la proyección (3/5 años + tendencia) se bloquea para no-agentes; el histórico (último año, acumulado desde 2015) queda público. La proyección se computa client-side (fallback por estrato), así que el gate efectivo es el del front, no el backend. **Pendiente §9**: si un anónimo colorea el mapa por el perfil "valorización" (score largo plazo), ¿cuenta como "ver valorización"? Decisión de §9, no pre-decidida.
- [x] Actualizar el documento "Qué ve cada quien" (decía que el inversionista registrado ve la valorización). — Hecho en `Pendientes y roles.md`: seguridad+tiempos→usuario, valorización→realtor.

## 3. Revisión de métricas y supuestos

- [x] Precio justo: revisar cuántos barrios salen como sobreprecio, normal y oportunidad con la regla del 0,6% mensual. Si los barrios caros salen casi todos en sobreprecio, ajustar la tasa por estrato. — **Confirmado y arreglado** (commit 6c6fcc4). El 0,6% fijo marcaba 68% SOBRE (estratos 4/5/6 = 100% SOBRE) porque el yield real cae con el estrato (~0,33%/mes en altos). Ahora `estado_precio` usa el rendimiento mediano REAL de cada estrato como benchmark (CTEs en `barrios_mercado.sql`, auto-calibra; satélites sin estrato → mediana global). Distribución: SOBRE 404→180, NORMAL 137→201, BAJO 49→209. Rebuilt en DEV (barrios_mercado+ → 11 modelos).
- [x] Valorización: investigar una fuente para los factores por estrato (×0,90 a ×1,15). Mientras tanto, rotular la proyección como estimación. — Rotulada "Estimación (no tasación) — proyección basada en DANE IPVN, ajustada por estrato" (commit d9d4c47). Fuente de factores: pendiente investigar (sigue siendo heurístico DANE+estrato). La proyección además quedó solo-agentes (§2).
- [x] Datos de la SNR (cierres por zona): dejar visibles con la nota "basado en valores de escritura, puede estar por debajo del precio real". — Nota agregada en drawer y panel (commit d9d4c47).
- [x] Rotular el arriendo estimado (mediana del barrio) y el valor de mercado (estimado con precios publicados). — Ya estaban: "Renta típica del barrio · mediana" y "Estimado con precios publicados, no de cierre".
- [ ] (Pendiente, derivado de §1) Recalibrar umbrales categoría catastro (SOBRE/NORMAL/CERCANO 3,0/1,5): el catastro de Medellín va ~5-8x bajo mercado → casi todo cae SOBRE_CATASTRO. Mismo tipo de ajuste que el precio justo.

## 4. Ajustes técnicos

- [~] Índice verde: calcular con el área real de cada parque en OpenStreetMap, no 5.000 m² fijos. — **Diferido** (decisión 26 oct): es un estimado de sub-score secundario, no vale el build (raw.pois es POINT/centroide; "área real" = re-ingerir polígonos OSM + reescribir modelo + re-run DEV/prod). El 5.000 m² fijo se queda; es suficiente para un estimado.
- [x] Seguridad en municipios satélite: revisar la regla de +5 puntos por estación de policía cerca (puede estar al revés). — **Revisado: NO está invertido.** `barrios_seguridad.sql` suma +5 SÓLO a scores estimados de satélites con policía <1 km (dirección = más seguro, defendible por disuasión); nunca aplica a comunas de Medellín con dato oficial. Sin cambio.
- [ ] "Publicado en N portales": comparar fotos (hash perceptual) para no juntar apartamentos distintos del mismo edificio. — (#9) Excluido por ahora (build grande).
- [x] Tiempos de recorrido: re-correr HERE periódicamente y explorar la franja de la tarde y más destinos. — **Prod estaba VACÍO** (el script nunca corrió en prod → tiempos no funcionaban). Poblé prod (25 zonas, HERE Routing v8, pico AM). DEV ya estaba fresco. **PM + más destinos = feature futura** (columnas nuevas + migración + API + frontend).
- [~] Confirmar en producción el perfil público del agente (tasas y sello "responde rápido"). — **Diferido**: ya desplegado (código+migr en prod) pero es data-conditional → invisible hasta que onboarden agentes con leads (prod tiene 0). Verificar cuando haya dato real.

## 5. Por construir (sin prioridad definida)

- [ ] Seguridad, estrato y uso del suelo para los otros municipios.
- [ ] Cuota de administración comparada con edificios parecidos.
- [ ] Permisos de obra (curadurías).
- [ ] Matrícula inmobiliaria obligatoria en listings nuevos y cierres.
- [ ] Fotos profesionales, plano y recorrido 3D como servicio premium.
- [ ] Plan para apagar el scraping de forma gradual.
- [ ] Zonas de riesgo como información neutral en el detalle.

## 6. Negocio y operación

- [ ] Medir el tráfico: búsquedas, visitas y prospectos por barrio y comuna (lo primero que preguntará un agente antes de pagar).
- [ ] Legal: términos de uso, política de datos personales (Ley 1581) y revisar el riesgo por scraping de fotos.
- [ ] Monitoreo de fuentes: alerta cuando una fuente se cae o se desactualiza.
- [ ] SEO: páginas por barrio para atraer tráfico desde Google.
- [ ] Calidad: pruebas en celular y velocidad de carga del mapa.

## 7. Medición de tráfico (ampliar lo que ya existe: vistas y favoritos por inmueble)

- [ ] Clics salientes a cada portal (Fincaraíz, Metrocuadrado, etc.): cuántas visitas les mandamos al mes. Sirve para negociar acuerdos con ellos.
- [ ] Búsquedas y vistas por barrio y comuna: el dato central para vender la zona al agente.
- [ ] Embudo por inmueble: vista en el mapa, apertura del detalle, favorito, contacto, visita agendada.
- [ ] Qué filtros usa la gente (precio, habitaciones, tipo) por zona: qué buscan y no encuentran.
- [ ] Origen del tráfico (Google, redes, directo) y páginas por barrio más visitadas.
- [ ] Panel del agente: mostrarle estas métricas de su zona y de sus inmuebles.
- [ ] Reporte mensual por portal y por zona, listo para mostrar a agentes y a Panamá.

## 8. Fotos y scraping

- [ ] Avisos scrapeados: mostrar solo datos, sin fotos, con botón "ver fotos en el portal".
- [ ] Botón "¿Es tuyo este aviso? Reclamalo" para que el agente suba sus propias fotos con autorización.
- [ ] Scraping con perfil bajo: respetar robots.txt y baja frecuencia.
- [ ] Proceso de retiro en 24 horas.
- [ ] Consultar un abogado de propiedad intelectual antes de lanzar.

## 9. Decisiones pendientes

- [ ] Color del mapa por score: quién lo ve (sin fecha).
- [ ] Activar el cobro real con los primeros agentes (aparte por ahora).
- [ ] Limpiar el documento de estado antes de socializarlo.

## 10. Pendientes de la lista anterior (23 oct) no cubiertos arriba

De los 27 puntos de "Pendientes y roles". La mayoría ya está arriba o hecha en la rama `feat/market-intel-public-gate`. Sin cubrir en este To-do:

- [ ] **#7 Conexión vencida de la fuente de seguridad** — bloqueado por certificado vencido de medata (externo). El monitoreo de fuentes (§6) lo avisaría, pero falta reconectar o reemplazar la fuente.
- [ ] **#8 Calidad de colegios (ICFES)** — diferido: métrica floja + fuente bloqueada. Se decidió dar "N colegios a ≤1 km" vía los POIs del detalle (#1) en vez del puntaje ICFES. Reactivar solo si aparece una fuente limpia.

Ya hechas y **desplegadas a main + prod** (merge Oct-23 + recompute dbt/catastro + HERE prod 26 oct): #1 POIs otros municipios · #2 cara/barata gratis · #3 arriendo rotulado · #5 población · #11 matrícula obligatoria (publicar + cierre) · #12 precio de cierre · #13 valor estimado de venta · #14 serie de precios por barrio · #15 temperatura del mercado · #17 obras cercanas (nombre + etapa) · #21 base de realtors e incentivos · #22 perfil público + reseñas · #23 tiempo de respuesta + tasas estilo Zillow + conversión · #24 calificación de prospectos · #27 movilidad (reorder por parqueadero + tiempos HERE, prod poblado).
