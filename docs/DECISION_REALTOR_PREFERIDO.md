# Decisión pendiente: Realtor Preferido por barrio

Fuente: audios Firehouse (17-nov) + Fathom 17-nov. Transcripción automática, puede tener errores. Estado: **modelo decidido por Israel (20-nov)**, nada implementado.

## Problema
Hay muchos realtors para El Poblado y Laureles, no 1–2 por barrio. Cobrar un plan genérico deja plata en la mesa.

## Opciones
| Opción | Cómo funciona | Nota |
|---|---|---|
| A. Cupos pagos | 10 agentes por barrio pagan por entrar ($1,000 a $2,500–3,000). La página del barrio rota cuál se muestra. | Ingreso claro |
| B. Mérito | Puntos por responder rápido y cerrar más listings. | Más complejo |
| C. Tipo Google Ads | Cada agente pone presupuesto; gana el que más paga. | Estilo Zillow/"Silo" |

## Diseño propuesto
- Un solo producto "Preferred Realtor"; al comprar elige barrio y categoría, y eso lo etiqueta.
- Rotación: cada vista muestra el siguiente agente en orden (consulta a la DB).
- Postgres = fuente de verdad. GHL solo gestión de clientes, con sync diario como puente.
- Objeción de Israel: requiere endpoint nuevo; prefiere pago dentro de la página, no en GHL.

## Listings
- Listing orgánico = custom object en GHL con los mismos campos que la DB.
- Importar listing de otro portal con un botón (ya hay scraping).
- Edita solo quien lo subió directo; en listings importados, solo el realtor que más paga.
- Al inicio todos listan gratis para ganar tráfico.
- Hueco: Metrocuadrado no expone el contacto real del realtor. Idea: script que busque la dirección en otros portales (replicable a Bogotá/Panamá).

## Otros
- Pin de ubicación en vivo (punto azul) en el mapa: fácil.
- Fathom 17-nov: reducir overlay del mapa, cambiar amarillo del logo, simplificar Simulador, revisión manual de listings de realtors, servicio pago de registro de propiedad ($15–20).

## Decidido (20-nov, por mensaje de Israel, dictado)
- Opción A (cupos pagos). **Sin regla de tiempo de respuesta.**
- Cupos fijos iguales en todo: **4 por barrio y 8 por zona** (interpreto "Kona" = comuna/zona).
- Rotación: **secuencia fija en orden, repetitiva**, según cuántos realtors haya en el barrio.
- **Precio depende del barrio** (cupos iguales, precio distinto).
- Dueño que vende sin agente: **no se cobra nada** (sin 3%).
- Pagos: **Stripe a través de GHL** (interpreto "strike through DHL").
- Lanzamiento: **todos los barrios con al menos 1 realtor preferido, aunque no pague**.

## Por definir (para implementar)
1. Tabla de precios por barrio (o por tiers de barrio).
2. Quién es el realtor preferido gratis en barrios sin pagos: ¿asignado a mano por ustedes?
3. Cuando entra un pago en un barrio con uno gratis, ¿el gratis sale o comparte hasta 4?
4. Confirmar "Kona" = comuna y "Stripe vía GHL".
