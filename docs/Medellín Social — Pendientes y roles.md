# Medellín Social — Pendientes y roles (23 oct 2026)

## Datos: mostrar lo que ya tenemos

1. Mostrar escuelas, transporte y demás puntos de interés en los listings de los otros municipios.
2. Mostrar métricas de inversionista: buena oferta / sobreprecio, puntaje y rentabilidad. Empezar simple: "15% bajo el precio del barrio".
3. Mostrar el valor estimado de arriendo (construido, oculto).
4. Activar alertas de rebaja de precio y búsquedas guardadas (construidas, ocultas).
5. Mostrar la población por zona.

## Datos: revisar implementación (los datos existen)

6. Tráfico y prospectos por zona.
7. Conexión vencida de la fuente de seguridad.
8. Calidad de colegios (ICFES).

## Datos: construir o conseguir

9. Detector de duplicados: cercanía (\~100 m) + características (área ±3%, habitaciones, baños, estrato, precio ±5%) + hash perceptual de fotos. Agrupar en vez de borrar ("visto en 3 portales").
10. Seguridad, estrato y uso del suelo para otros municipios: planos del POT de Itagüí y Envigado, derecho de petición (Ley 1712), DANE, datos.gov.co, geoportal del Área Metropolitana.
11. Matrícula inmobiliaria como campo obligatorio solo en listings nuevos y cierres (no llenar los existentes).
12. Precio de cierre reportado por el realtor.
13. Valor estimado de venta por propiedad.
14. Índice de precios por barrio en el tiempo.
15. Temperatura del mercado (comprador vs. vendedor).
16. Análisis de la cuota de administración frente a edificios parecidos.
17. Valorización por obras públicas cercanas.
18. Permisos de obra (curadurías urbanas).
19. Ir apagando el scraping gradualmente, a medida que los listings propios alcancen para sostener las métricas.
20. Zonas de riesgo (baja prioridad): información neutral en el detalle de la propiedad, sin alertas en el mapa.

## Realtors

21. Revisar y terminar la base de realtors y sus incentivos.
22. Perfil público del agente con reseñas y ventas verificadas (incentivo para reportar el precio de cierre).
23. Medir y premiar el tiempo de respuesta.
24. Calificación de prospectos por intención real.
25. Fotos profesionales, plano y recorrido 3D como servicio premium.

## Documento

26. Limpiar el documento de estado antes de socializarlo (sobre todo lo de realtors "completo").

## Movilidad en el detalle de propiedad

27. Tráfico y transporte público: mostrar ambos siempre y ordenar según el parqueadero (con garaje → tráfico primero; sin garaje → transporte primero), mejor señal que un umbral de precio. Y en vez del "nivel de congestión" abstracto, mostrar el tiempo en carro en hora pico hasta puntos clave (El Poblado, Centro). **Hecho (rama feat/market-intel-public-gate):** reorder por parqueadero + tiempos vía HERE Routing API v8 por zona (pico AM). Dato estático estilo campaña; falta re-correr periódicamente y explorar franja PM / más destinos.

---

## Qué ve cada quien en Medellín Social

> **Actualizado (To-do §2, 26 oct):** seguridad del barrio y tiempos de recorrido pasan a ser **públicos** (antes se percibían como de agente). La **valorización/proyecciones** pasan a ser **solo de realtor** (antes figuraban para el inversionista). Historial de precios y temperatura del mercado quedan como estaban.

**Usuario — gratis, sin registro.** Lo que necesita para decidir sobre una propiedad: si está cara o barata frente al barrio, arriendo estimado, comparador de listings, puntos de interés, **seguridad del barrio**, **tiempos de recorrido** e historial de precios. Objetivo: atraer tráfico y generar confianza; ese tráfico es lo que se le vende al realtor.

**Inversionista — gratis, con registro.** Rentabilidad estimada, índice de precios del barrio y temperatura del mercado. No paga, pero al registrarse deja sus datos e intereses: cada registro es un prospecto calificado que va directo al realtor de la zona.

**Realtor — en su panel, incluido en lo que paga.** Inteligencia para vender más: **valorización y proyecciones**, cuántos compradores e inversionistas buscan en su zona y qué buscan, prospectos calificados de los registros, comparables para fijar precios, tendencias de la zona y perfil público con ventas verificadas. No paga por datos sueltos: compra más clientes y más cierres.
