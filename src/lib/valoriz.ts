// Valorización de vivienda usada — variación anual DANE (Medellín/Antioquia) 2015–2025.
// Fuente única: la consumen FloatingPanel (panel de barrio) y ListingDrawer (detalle).
// Antes estaba duplicada en FloatingPanel → movida acá para no divergir.
export const DANE_VARS = [11.9, 7.6, 7.8, 10.6, 8.7, 7.0, 7.1, 9.5, 15.9, 10.1, 8.3];
export const DANE_FIRST_YEAR = 2015; // DANE_VARS[0] = var 2015; último índice = 2025
export const VALORIZ_MULT: Record<number, number> = { 5: 1.15, 4: 1.05, 3: 1.0 };

export function valorizMult(estrato: number): number {
  return VALORIZ_MULT[estrato] ?? 0.9;
}

export function calcValorizStats(estrato: number) {
  const mult = valorizMult(estrato);
  // Crecimiento compuesto 2015→2025
  const acumulado = DANE_VARS.reduce(
    (acc, v) => (1 + acc / 100) * (1 + (v * mult) / 100) * 100 - 100,
    0,
  );
  const ultimoAnio = DANE_VARS[DANE_VARS.length - 1] * mult;
  const avg5 = DANE_VARS.slice(-5).reduce((s, v) => s + v, 0) / 5;
  const proj5 = (Math.pow(1 + (avg5 * mult) / 100, 5) - 1) * 100;
  return {
    acumulado: Math.round(acumulado),
    ultimoAnio: parseFloat(ultimoAnio.toFixed(1)),
    proj5: Math.round(proj5),
  };
}

export type ZonePoint = { year: number; precio: number };

// ponytail: fuente provisional = DANE (índice de valorización de zona). El plan es
// reemplazarla por el CIERRE DE VENTA REAL (escrituras SNR/ORIPS por zona) cuando el
// pipeline de cierres esté listo — misma forma de serie {year, precio}, solo cambia
// el origen del dato. Mientras tanto se etiqueta como "tendencia de la zona (DANE)".
//
// Serie de precio de la ZONA por año, anclada al precio actual y back-calculada con
// las variaciones DANE × multiplicador de estrato. Es un modelo de tendencia de la
// zona (DANE), NO el historial de ventas de un inmueble concreto — etiquetarlo así.
// Devuelve [{year, precio}] de DANE_FIRST_YEAR..último (11 puntos).
export function zonePriceTrend(currentPrice: number, estrato: number): ZonePoint[] {
  const mult = valorizMult(estrato);
  const n = DANE_VARS.length; // 11 → 2015..2025
  const precios: number[] = new Array(n);
  precios[n - 1] = currentPrice;
  // prev = cur / (1 + var_del_año_actual). DANE_VARS[i] = var del año (2015+i) vs anterior.
  for (let i = n - 1; i > 0; i--) {
    precios[i - 1] = precios[i] / (1 + (DANE_VARS[i] * mult) / 100);
  }
  return precios.map((p, i) => ({ year: DANE_FIRST_YEAR + i, precio: Math.round(p) }));
}
