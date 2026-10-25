// Nombres legibles de las categorías de negocio (claves de public.tiendas.categoria).
export const CATEGORIA_LABELS: Record<string, string> = {
  brunch: 'Brunch',
  cena: 'Restaurante',
  gimnasios: 'Gimnasio',
  masajes_spa: 'Spa & Wellness',
  medicos: 'Salud',
  cafes: 'Café',
  bares: 'Bar',
  yoga: 'Yoga',
  dentistas: 'Dental',
  peluquerias: 'Estética',
  almuerzo: 'Almuerzo',
  estetica: 'Estética',
  panaderia: 'Panadería',
}

export const CATEGORIA_LABELS_EN: Record<string, string> = {
  brunch: 'Brunch',
  cena: 'Restaurant',
  gimnasios: 'Gym',
  masajes_spa: 'Spa & Wellness',
  medicos: 'Health',
  cafes: 'Café',
  bares: 'Bar',
  yoga: 'Yoga',
  dentistas: 'Dental',
  peluquerias: 'Beauty',
  almuerzo: 'Lunch',
  estetica: 'Beauty',
  panaderia: 'Bakery',
}

export function categoriaLabel(cat: string, lang: "es" | "en"): string {
  return (lang === "es" ? CATEGORIA_LABELS : CATEGORIA_LABELS_EN)[cat] ?? cat.replace(/_/g, " ")
}
