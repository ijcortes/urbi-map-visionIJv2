export interface CategoriaTienda {
  key: string
  label: string
  labelEn: string
  emoji: string
}

export interface GrupoTiendas {
  key: string
  label: string
  labelEn: string
  emoji: string
  categorias: CategoriaTienda[]
}

export interface CategoriaEvento {
  key: string
  label: string
  labelEn: string
  emoji: string
}

export const GRUPOS_TIENDAS: GrupoTiendas[] = [
  {
    key: "gastronomia",
    label: "Gastronomía",
    labelEn: "Food & Drink",
    emoji: "🍽️",
    categorias: [
      { key: "brunch",        label: "Desayuno & Brunch",    labelEn: "Breakfast & Brunch",    emoji: "☕" },
      { key: "almuerzo",      label: "Almuerzos",            labelEn: "Lunch",                 emoji: "🍱" },
      { key: "cena",          label: "Cena & Restaurantes",  labelEn: "Dinner & Restaurants",  emoji: "🕯️" },
      { key: "bares",         label: "Bares & Pubs",         labelEn: "Bars & Pubs",           emoji: "🍺" },
      { key: "cafes",         label: "Cafés",                labelEn: "Cafés",                 emoji: "☕" },
      { key: "comida_rapida", label: "Comida Rápida",        labelEn: "Fast Food",             emoji: "🍕" },
      { key: "panaderia",     label: "Panaderías & Postres", labelEn: "Bakeries & Desserts",   emoji: "🥐" },
      { key: "asiatica",      label: "Comida Asiática",      labelEn: "Asian Food",            emoji: "🍜" },
    ],
  },
  {
    key: "salud",
    label: "Salud & Belleza",
    labelEn: "Health & Beauty",
    emoji: "💊",
    categorias: [
      { key: "medicos",      label: "Médicos & Clínicas",        labelEn: "Doctors & Clinics",    emoji: "🏥" },
      { key: "dentistas",    label: "Dentistas",                 labelEn: "Dentists",             emoji: "🦷" },
      { key: "dermatologia", label: "Dermatología & Estética",   labelEn: "Dermatology",          emoji: "✨" },
      { key: "fisioterapia", label: "Fisioterapia",              labelEn: "Physiotherapy",        emoji: "🦴" },
      { key: "masajes_spa",  label: "Masajes & Spa",             labelEn: "Massage & Spa",        emoji: "🧖" },
      { key: "peluquerias",  label: "Peluquerías & Barberías",   labelEn: "Hair & Barbers",       emoji: "✂️" },
      { key: "estetica",     label: "Estética & Uñas",           labelEn: "Beauty & Nails",       emoji: "💅" },
    ],
  },
  {
    key: "fitness",
    label: "Fitness",
    labelEn: "Fitness",
    emoji: "💪",
    categorias: [
      { key: "gimnasios", label: "Gimnasios & Crossfit", labelEn: "Gyms & Crossfit",  emoji: "🏋️" },
      { key: "yoga",      label: "Yoga & Pilates",       labelEn: "Yoga & Pilates",   emoji: "🧘" },
    ],
  },
  {
    key: "servicios_hogar",
    label: "Servicios del Hogar",
    labelEn: "Home Services",
    emoji: "🏠",
    categorias: [
      { key: "remodelaciones", label: "Remodelaciones",  labelEn: "Renovations",    emoji: "🔨" },
      { key: "plomeria",       label: "Plomería",        labelEn: "Plumbing",       emoji: "🔧" },
      { key: "electricistas",  label: "Electricistas",   labelEn: "Electricians",   emoji: "⚡" },
      { key: "mudanzas",       label: "Mudanzas",        labelEn: "Moving",         emoji: "📦" },
      { key: "cerrajeria",     label: "Cerrajería",      labelEn: "Locksmith",      emoji: "🔑" },
      { key: "jardineria",     label: "Jardinería",      labelEn: "Gardening",      emoji: "🌿" },
    ],
  },
  {
    key: "mas_servicios",
    label: "Más Servicios",
    labelEn: "More Services",
    emoji: "🏪",
    categorias: [
      { key: "bancos",              label: "Bancos & ATMs",         labelEn: "Banks & ATMs",         emoji: "🏦" },
      { key: "mascotas",            label: "Mascotas",              labelEn: "Pets",                 emoji: "🐾" },
      { key: "parqueaderos",        label: "Parqueaderos",          labelEn: "Parking",              emoji: "🅿️" },
      { key: "segunda_mano",        label: "Segunda Mano",          labelEn: "Second Hand",          emoji: "♻️" },
      { key: "agente_inmobiliario", label: "Agentes Inmobiliarios", labelEn: "Real Estate Agents",   emoji: "🏡" },
    ],
  },
]

export const CATEGORIAS_TIENDAS: CategoriaTienda[] = GRUPOS_TIENDAS.flatMap((g) => g.categorias)

export const CATEGORIAS_TIENDAS_MAP = Object.fromEntries(
  CATEGORIAS_TIENDAS.map((c) => [c.key, c])
) as Record<string, CategoriaTienda>

export const GRUPOS_TIENDAS_MAP = Object.fromEntries(
  GRUPOS_TIENDAS.map((g) => [g.key, g])
) as Record<string, GrupoTiendas>

export const CATEGORIA_LABELS: Record<string, string> = {
  brunch: 'Brunch', cena: 'Restaurante', gimnasios: 'Gimnasio',
  masajes_spa: 'Spa & Wellness', medicos: 'Salud', cafes: 'Café',
  bares: 'Bar', yoga: 'Yoga', dentistas: 'Dental', peluquerias: 'Estética',
  almuerzo: 'Almuerzo', estetica: 'Estética', panaderia: 'Panadería',
  asiatica: 'Asiática', comida_rapida: 'Rápida', fisioterapia: 'Fisio',
  dermatologia: 'Dermatología',
  bancos: 'Banco', cerrajeria: 'Cerrajería', electricistas: 'Electricista',
  jardineria: 'Jardinería', mascotas: 'Mascotas', mudanzas: 'Mudanzas',
  parqueaderos: 'Parqueadero', remodelaciones: 'Remodelación',
}

/** Nombre legible de una categoría de negocio (clave de public.tiendas.categoria). */
export function categoriaNegocioLabel(cat: string, lang: 'es' | 'en'): string {
  const c = CATEGORIAS_TIENDAS_MAP[cat]
  if (c) return lang === 'en' ? c.labelEn : c.label
  return CATEGORIA_LABELS[cat] ?? cat.replace(/_/g, ' ')
}

export const CATEGORIA_COLORS: Record<string, string> = {
  bares: '#111418', brunch: '#F3F0E8', cafes: '#c8a96e', cena: '#2d1b0e',
  gimnasios: '#0F8A4F', masajes_spa: '#d4a5c9', medicos: '#E6ECF7',
  dentistas: '#E6ECF7', peluquerias: '#FCE8EA', yoga: '#E7F4EC',
  fisioterapia: '#FFF6D6', dermatologia: '#FCE8EA', estetica: '#FCE8EA',
  almuerzo: '#FFF6D6', panaderia: '#FFF6D6', comida_rapida: '#fbe9e7',
  bancos: '#E6ECF7', cerrajeria: '#F3F0E8', electricistas: '#FFF6D6',
  jardineria: '#E7F4EC', mascotas: '#FCE8EA', mudanzas: '#F3F0E8',
  parqueaderos: '#E6ECF7', remodelaciones: '#FFF6D6',
}

export const CATEGORIA_EMOJI: Record<string, string> = {
  bares: '🍺', brunch: '☕', cafes: '☕', cena: '🍽️', gimnasios: '💪',
  masajes_spa: '🧖', medicos: '🏥', dentistas: '🦷', peluquerias: '✂️',
  yoga: '🧘', fisioterapia: '🦴', dermatologia: '✨', estetica: '💅',
  almuerzo: '🍱', panaderia: '🥐', comida_rapida: '🍕', asiatica: '🍜',
  bancos: '🏦', cerrajeria: '🔑', electricistas: '💡', jardineria: '🌱',
  mascotas: '🐾', mudanzas: '📦', parqueaderos: '🅿️', remodelaciones: '🛠️',
}

export const CATEGORIAS_EVENTOS: CategoriaEvento[] = [
  { key: "networking",  label: "Networking",  labelEn: "Networking",   emoji: "🤝" },
  { key: "happy_hour",  label: "Happy Hour",  labelEn: "Happy Hour",   emoji: "🍹" },
  { key: "musica",      label: "Música",      labelEn: "Music",        emoji: "🎵" },
  { key: "deporte",     label: "Deporte",     labelEn: "Sports",       emoji: "🏃" },
  { key: "gastronomia", label: "Gastronomía", labelEn: "Food & Drink", emoji: "🍽️" },
  { key: "cultura",     label: "Cultura",     labelEn: "Culture",      emoji: "🎨" },
  { key: "bienestar",   label: "Bienestar",   labelEn: "Wellness",     emoji: "🧘" },
  { key: "tech",        label: "Tech",        labelEn: "Tech",         emoji: "💻" },
  { key: "social",      label: "Social",      labelEn: "Social",       emoji: "👥" },
]

export const CATEGORIAS_EVENTOS_MAP = Object.fromEntries(
  CATEGORIAS_EVENTOS.map((c) => [c.key, c])
) as Record<string, CategoriaEvento>
