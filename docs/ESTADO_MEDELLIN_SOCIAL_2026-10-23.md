# Estado Actual de Medellín Social

**Fecha:** 23 de octubre de 2026
**Enfoque:** Datos (principal) · Realtors · Suscripciones
**Propósito:** Fotografía ejecutiva, en lenguaje de negocio, de qué tenemos, qué usamos, qué falta y dónde estamos parados frente a los demás municipios.

---

## 1. Resumen ejecutivo

Medellín Social es una plataforma **viva y sólida en su núcleo**. Hoy el mapa muestra alrededor de **91.457 propiedades reales** de los 10 municipios del Valle de Aburrá, cada una con foto, barrio, y precio en pesos y en dólares. No es una maqueta ni un castillo de naipes.

Lo importante para entender el estado es esto: **los problemas que quedan no son "cosas rotas", son "campos vacíos" bien localizados** y datos que ya tenemos pero todavía no mostramos. Hay una diferencia grande entre "esto no funciona" y "esto todavía no lo estamos aprovechando" — casi todo lo pendiente es lo segundo.

Las tres ideas que resumen el documento:

1. **Datos:** la base (propiedades, fotos, precios, historial, puntos de interés) cubre **los 10 municipios por igual**. Pero las **capas ricas de contexto** (estrato, uso del suelo, avalúo, seguridad, calidad de vida) existen **casi solo para Medellín**. La diferencia con los otros municipios no es que Medellín tenga más propiedades — es que **cada propiedad en Medellín viene con mucho más contexto alrededor**.

2. **Realtors:** el sistema para agentes está **construido y conectado** de punta a punta (bandeja de clientes potenciales, panel de resultados, patrocinio de zonas, agenda, verificación). Pero todavía **no hay agentes reales operando en producción** y, sobre todo, **nada cobra dinero aún**: el pago está simulado.

3. **Suscripciones:** el modelo de negocio **cambió**. Ya no hay un "plan Pro" para usuarios; el mapa es **gratis para todos**. El dinero viene de los agentes que patrocinan zonas y de propiedades destacadas. La infraestructura para cobrar existe, pero **todavía no hay un cobro en vivo** y los pagos se van a mover a la plataforma GHL.

---

## 2. Estado de los datos *(sección principal)*

### 2.1 Cómo leer esta sección: los cuatro estados de un dato

Para no confundir "roto" con "pendiente", clasificamos cada dato en uno de cuatro estados:

| Estado | Qué significa | Ejemplo |
|---|---|---|
| 🟢 **Lo tenemos y lo usamos** | Está vivo en la plataforma, el usuario lo ve hoy. | Precio, foto, barrio, historial de precios. |
| 🟡 **Lo tenemos pero aún no lo mostramos** | El dato ya está recolectado y calculado; falta "enchufarlo" a una pantalla. Es decisión de momento, no una carencia. | Si una propiedad está bien o mal de precio; población por zona. |
| 🔵 **Identificado y contemplado, falta construir** | Sabemos de dónde sacarlo y está en la lista; aún no se ha construido. | Ingreso, pobreza y empleo por comuna. |
| 🔴 **Falta conseguir la fuente / completar cobertura** | No lo tenemos todavía porque depende de una fuente externa o de completar un mapa. | Seguridad en la mitad de los barrios; avalúo a nivel barrio. |

---

### 2.2 🟢 Datos que tenemos y SÍ usamos hoy

Todo lo siguiente está vivo en la plataforma en este momento:

| Dato | Qué ve el usuario | Cobertura |
|---|---|---|
| **Propiedades en venta y arriendo** | ~91.457 avisos reales en el mapa | Los 10 municipios del Valle de Aburrá |
| **Foto principal + galería** | Portada en el mapa y fotos al abrir el detalle | Mayoría de fuentes (ver nota de cobertura abajo) |
| **Precio en pesos y en dólares** | El precio se convierte solo según el idioma, con la tasa de cambio del día | Todas |
| **Barrio de cada propiedad** | El barrio exacto donde queda, no solo el municipio | Buena en Medellín; parcial en municipios pequeños |
| **Historial de precios** | Si el precio subió o bajó desde que se publicó | Principalmente Fincaraíz, Metrocuadrado y Habi |
| **Días en el mercado** | Hace cuánto está publicada la propiedad | **Todas las fuentes** (recién ampliado) |
| **Área, habitaciones, baños, antigüedad** | Las fichas técnicas del inmueble | Todas |
| **Estrato** | El estrato socioeconómico de la zona | Medellín (ver asimetría §2.6) |
| **Uso del suelo** | Para qué está destinada la zona según el ordenamiento de la ciudad | Solo Medellín |
| **Puntos de interés cercanos** | Colegios, metro, parques, hospitales, universidades, supermercados, farmacias, paraderos, gimnasios, estaciones de policía, etc. | Los 10 municipios |
| **Tráfico / congestión** | Qué tan congestionada es la zona | Zonas principales |
| **Precio por m² típico del barrio** | El valor de referencia de la zona | Donde hay suficientes avisos |
| **Nivel de zona (A/B/C/D)** | Clasificación de zonas usada para el negocio de patrocinio de agentes | 16 comunas de Medellín + 5 municipios satélite |

> **Nota sobre fotos:** la gran mayoría de propiedades tiene foto. Hay una excepción conocida: los avisos de **renta corta** (apartamentos tipo Airbnb mensual) que hoy llegan con precio pero **sin foto ni algunos detalles** — un tema puntual de captura, no un problema general.

---

### 2.3 🟡 Datos que YA tenemos pero todavía NO mostramos

Estos datos **ya se calculan y están listos**. No se muestran todavía por decisión de momento — están "guardados para cuando toque".

- **Métricas de inversionista.** Ya sabemos calcular, para cada propiedad, si está **bien o mal de precio frente a su barrio** ("buena oferta" / "sobreprecio" / "cuánto por debajo del precio típico"), además de un puntaje y una estimación de rentabilidad de la zona. **Están reservadas para la futura sección de inversionistas** — se decidió recolectar el dato ahora y mostrarlo después. No es un error ni una urgencia; es algo contemplado.

- **Población por zona.** Ya cargamos la población de las 16 comunas de Medellín y de los 10 municipios del Valle de Aburrá. **Está cargada pero todavía no tiene pantalla** donde mostrarse.

---

### 2.4 🔵 Datos identificados y contemplados, pero que falta construir

- **Ingreso, pobreza, empleo y educación por comuna.** Existe una fuente oficial y confiable para Medellín (la Encuesta de Calidad de Vida de la ciudad). **Está identificada y en la lista**, pero se decidió **no construirla por ahora**: el **estrato** —que ya mostramos— cumple en buena medida ese mismo papel como señal del nivel socioeconómico de la zona, que es lo que la industria inmobiliaria colombiana usa en la práctica. Queda en el backlog para cuando haya un reporte específico de inversionistas que lo justifique. *Esta fuente, además, solo existe para Medellín, no para los otros municipios.*

---

### 2.5 🔴 Datos donde falta conseguir la fuente o completar cobertura

- **Seguridad por barrio.** Hoy tenemos puntaje de seguridad en aproximadamente **335 de 610 barrios**. En los demás falta porque **depende de una fuente de criminalidad actualizada** que hoy no está disponible (la conexión con la fuente oficial está vencida). Es dependencia externa, no un problema de la plataforma.

- **Avalúo / catastro a nivel barrio.** Hoy el dato de avalúo catastral solo llega a **nivel comuna** (grupos grandes de barrios), no al barrio individual, porque la fuente que tenemos no trae la ubicación exacta de cada predio. Bajarlo a nivel barrio requiere una fuente nueva con geometría real.

- **División fina de barrios en municipios externos.** Medellín está dividido en 271 barrios con fronteras precisas. En cambio, municipios como **Girardota, Caldas, Copacabana y Barbosa** prácticamente solo tienen el **contorno del municipio**, sin barrios internos — por eso las propiedades allí no siempre resuelven un barrio fino. Completarlo requiere conseguir esos mapas.

---

### 2.6 La asimetría entre Medellín y los demás municipios *(el punto central)*

Esta es la diferencia más importante de entender, y es exactamente lo que el usuario quería ver claro:

> **Las capas base cubren todos los municipios por igual. Las capas de contexto ricas existen casi solo para Medellín.**

Dicho de otra forma: **no es que Medellín tenga más propiedades** que los demás — es que **cada propiedad de Medellín viene rodeada de mucho más contexto** (estrato, uso del suelo, avalúo, seguridad, calidad de vida). En los otros municipios tenemos la propiedad y su precio, pero mucho menos de lo que hay "alrededor" de ella.

#### Matriz: qué dato existe en cada municipio

| Capa de dato | Medellín | Bello · Itagüí · Envigado · Sabaneta · La Estrella | Girardota · Caldas · Copacabana · Barbosa |
|---|:---:|:---:|:---:|
| Propiedades (venta/arriendo) | ✅ | ✅ | ✅ |
| Foto, precio, pesos + dólares | ✅ | ✅ | ✅ |
| Historial de precios | ✅ | ✅ | ✅ |
| Días en el mercado | ✅ | ✅ | ✅ |
| Puntos de interés (colegios, metro, parques…) | ✅ | ✅ | ✅ |
| Precio por m² típico del barrio | ✅ | ✅ (donde hay avisos) | ⚠️ limitado |
| **Fronteras finas de barrio** | ✅ (271 barrios) | ⚠️ parcial (Bello 126, Itagüí 85) | ❌ solo el contorno del municipio |
| **Estrato por manzana** | ✅ | ❌ | ❌ |
| **Uso del suelo (ordenamiento)** | ✅ | ❌ | ❌ |
| **Avalúo / catastro** | ✅ (nivel comuna) | ❌ | ❌ |
| **Seguridad por barrio** | ⚠️ parcial (≈335/610 barrios) | ❌ | ❌ |
| **Ingreso / pobreza / empleo / educación** | 🔵 fuente existe, falta construir | ❌ no hay fuente | ❌ no hay fuente |
| **Nivel de zona A/B/C/D** | ✅ (16 comunas) | ✅ (5 municipios) | ❌ |
| Mercado real / compraventas | ✅ (nivel municipio) | ✅ (nivel municipio) | ✅ (nivel municipio) |
| Población | ✅ (por comuna) | ✅ (por municipio) | ✅ (por municipio) |

**Leyenda:** ✅ lo tenemos · ⚠️ parcial · ❌ no lo tenemos · 🔵 identificado, falta construir

#### Cómo leer la matriz

- **La parte de arriba de la tabla (base) es pareja:** cualquier propiedad, en cualquiera de los 10 municipios, tiene foto, precio, historial y puntos de interés.
- **La parte de abajo (contexto rico) se concentra en Medellín:** estrato, uso del suelo, avalúo, seguridad y calidad de vida son hoy, en la práctica, **datos de Medellín**.
- **Los 5 municipios satélite** (Bello, Itagüí, Envigado, Sabaneta, La Estrella) están en un punto intermedio: tienen división de barrios parcial y entran en la clasificación de zonas, pero no en las capas más finas.
- **Los 4 municipios externos** (Girardota, Caldas, Copacabana, Barbosa) son los más "ligeros": tienen las propiedades y su precio, pero casi nada de contexto.

**Esto es, textualmente, lo que falta por implementar y que ya está contemplado:** llevar las capas ricas de Medellín (estrato, uso del suelo, seguridad, calidad de vida, fronteras de barrio) a los demás municipios — lo cual depende, en cada caso, de conseguir la fuente de datos correspondiente para esos municipios, que no siempre existe públicamente.

---

## 3. Estado de los Realtors (agentes inmobiliarios)

### 3.1 Qué está construido y conectado

El sistema para agentes está **completo de punta a punta y conectado al backend real** (no es una maqueta). Un agente que entre a su panel encuentra funcionando:

- **Bandeja de clientes potenciales** (estilo Zillow): lista a la izquierda, detalle a la derecha, con el "siguiente paso recomendado" y una sola acción clara (aceptar / tomar / publicar).
- **Panel de resultados** orientado al cliente: "cómo te está yendo", resultados en tu zona pagada, e información del mercado de la zona.
- **Patrocinio de zonas**: el agente puede comprar la exclusividad de una comuna o un barrio (autogestionado).
- **Asignación automática** de prospectos: cuando un propietario publica, el sistema enruta ese prospecto al agente de la zona; si no hay, va a un "pool" del que cualquiera puede tomarlo.
- **Agenda y horario**: solicitudes de visita, disponibilidad semanal, y seguimiento de cómo terminó cada visita (interesado / oferta / descartado).
- **Verificación de agente** (sello "Agente Certificado", que solo pone un administrador, no se autoasigna).
- **Ficha de debida diligencia**: checklist para verificar una propiedad antes de publicarla.
- **Inteligencia de barrio**: datos de mercado de la zona que el agente paga.

### 3.2 La realidad honesta de hoy

A pesar de que todo lo anterior está construido, hay dos cosas que hay que decir con claridad:

1. **No hay agentes reales operando en producción todavía.** Las cuentas de agente que existen son de prueba; en el entorno real esas tablas están vacías. El sistema está listo y esperando usuarios.

2. **Nada cobra dinero aún.** Este es el punto más importante: la compra de zonas es hoy un **checkout simulado**, los enlaces de pago están **vacíos**, y aunque existe la plomería para cobrar con Wompi, **no está conectada**. En la práctica, **ningún peso cambia de manos todavía en el flujo de agentes**. Encender el cobro real es la prioridad número uno de esta área.

---

## 4. Estado de las Suscripciones / Monetización

### 4.1 El cambio de modelo (importante)

El modelo de negocio **cambió** respecto a lo que se diseñó al principio. Ya **no existe un "plan Pro" de pago para usuarios normales**. La decisión actual es:

> **El mapa y los datos son gratis para todos los usuarios.** El dinero viene de los agentes inmobiliarios, no de los usuarios finales.

*(La versión vieja —planes "Pro" y "Agente" con mensualidad para usuarios— quedó reemplazada. Si en algún documento antiguo aparecen esos precios, están desactualizados.)*

### 4.2 De dónde viene (vendrá) el dinero: tres fuentes

| Fuente | Qué es | Precio |
|---|---|---|
| **Agentes patrocinando zona** *(principal)* | Un agente compra la exclusividad de una zona y se vuelve el contacto recomendado de todas las propiedades ahí | **Comuna: USD $1.000/mes** · **Barrio: USD $200/mes** |
| **Propiedad Destacada** | Pago único por resaltar una propiedad, con recomendación de precio, analítica y posicionamiento para compradores en dólares | **USD $1.000 pago único** |
| **Comisión de cierre** | No se cobra | — |

### 4.3 La realidad honesta de hoy

- La **infraestructura técnica para cobrar existe** (sistema de suscripciones, integración con pasarelas de pago construida).
- **Pero no hay un mecanismo de cobro vivo todavía.** Como se dijo en la sección de agentes, los pagos están simulados.
- Además, se decidió que **los pagos se van a manejar en la plataforma GHL** (el sistema de gestión comercial que se usará), no directamente con las pasarelas construidas. **Esa migración está pendiente.**

En resumen: **la máquina de cobrar está construida pero apagada**, y el interruptor definitivo vivirá en GHL.

---

## 5. Qué falta por implementar (consolidado)

Ordenado por impacto para "salir a operar de verdad":

| Prioridad | Qué falta | Estado |
|---|---|---|
| **1** | **Encender el cobro real** (patrocinio de zonas + propiedad destacada). Hoy está simulado. | Construido, apagado |
| **2** | **Mover los pagos a GHL** y dejar un único sistema de cobro. | Decidido, pendiente |
| **3** | **Completar la seguridad por barrio** (hoy la mitad de los barrios). Depende de conseguir la fuente de criminalidad. | Falta fuente |
| **4** | **Mostrar las métricas de inversionista** (buena oferta / sobreprecio / rentabilidad). Ya se calculan. | Listo, por mostrar |
| **5** | **Mostrar la población por zona.** Ya está cargada. | Listo, por mostrar |
| **6** | **Llevar las capas ricas de Medellín a los demás municipios** (estrato, uso del suelo, fronteras de barrio). Depende de conseguir las fuentes por municipio. | Contemplado, falta fuente |
| **7** | **Construir ingreso/pobreza/empleo por comuna** (Encuesta de Calidad de Vida). | En backlog |
| **8** | **Completar datos de renta corta** (hoy llegan con precio pero sin foto). | Tema puntual |

---

## 6. Conclusión

Medellín Social tiene una **base de datos de propiedades fuerte y pareja** en los 10 municipios, y un **sistema de agentes completamente construido**. Las dos brechas más importantes no son técnicas de fondo, son de **activación y de completitud**:

1. **Activación:** encender el cobro — todo está listo menos el interruptor de dinero.
2. **Completitud:** llevar el contexto rico que hoy tiene Medellín (estrato, seguridad, uso del suelo, calidad de vida) al resto del Valle de Aburrá — lo cual depende, municipio por municipio, de conseguir las fuentes de datos, que no siempre existen públicamente.

Todo lo demás pendiente es **"dato que ya tenemos y falta mostrar"**, no "dato roto" — que es una posición cómoda desde la cual avanzar.
