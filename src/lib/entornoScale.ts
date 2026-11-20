// Calibración POR MÉTRICA del entorno: el color/arco (ratio 0-1, 1=mejor) sale del
// PERCENTIL real de la métrica en Medellín, no de un tope inventado. Cada métrica
// tiene su propia distribución — ej. la mediana de cobertura verde es 2.4% y p90=11.7%,
// así que 3% es MEJOR que la mitad de los barrios (ámbar), no "malo/rojo".
//
// anchors = [p10, p50, p90] de la distribución real (query DB 2026-11-11, barrios de
// Medellín). dir 'low' = menos es mejor (distancias, ruido).
// ponytail: anchors hardcodeados — si cambia la distribución de fondo hay que recomputar;
// lo ideal sería que el backend mande los percentiles con el response.
export const ESCALE = {
  verde:    { a: [0, 2.4, 11.7],     dir: "high" },
  ruido:    { a: [55.6, 65.6, 69.4], dir: "low" },
  internet: { a: [235, 285, 323],    dir: "high" },
  metro:    { a: [0.41, 1.37, 2.88], dir: "low" },
  parque:   { a: [0.05, 0.19, 0.48], dir: "low" },
  mall:     { a: [0.27, 0.95, 2.92], dir: "low" },
  canchas:  { a: [11, 23, 38],       dir: "high" },
  policiaN: { a: [0, 1, 4],          dir: "high" },
  policiaD: { a: [0.26, 0.71, 1.51], dir: "low" },
  bomberos: { a: [0, 1, 2],          dir: "high" },
  encicla:  { a: [0.23, 1.04, 3.08], dir: "low" },
} as const;

export type EscaleKey = keyof typeof ESCALE;

// Posición percentil-ish del valor en la distribución: p10→~0.1, p50→0.5, p90→~0.9,
// lineal a tramos entre anchors. Para dir 'low' se invierte (valor bajo = bueno = ratio alto).
export function scaleRatio(v: number, key: EscaleKey): number {
  const { a, dir } = ESCALE[key];
  const [p10, p50, p90] = a;
  let pos: number;
  if (v <= p10) pos = 0.08;
  else if (v >= p90) pos = 0.95;
  else if (v <= p50) pos = 0.1 + 0.4 * (v - p10) / Math.max(1e-9, p50 - p10);
  else pos = 0.5 + 0.4 * (v - p50) / Math.max(1e-9, p90 - p50);
  return dir === "low" ? 1 - pos : pos;
}
