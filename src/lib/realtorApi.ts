import { apiFetch, getToken } from "@/lib/apiClient";
import { API_BASE_URL } from "@/config/api";
import type { ApiBarrio } from "@/lib/adapters";

// ── Enums — aligned with backend models (realtors.py / listing.py) ─────────────

export type EstadoListing  = "borrador" | "en_revision" | "publicado" | "rechazado" | "pausado" | "cerrado";
export type TipoInmueble   = "apartamento" | "casa" | "local" | "oficina" | "lote" | "finca";
export type Operacion      = "venta" | "arriendo";
export type EstadoAgent    = "pendiente" | "activo" | "rechazado" | "inactivo";
export type EstadoIntake   = "asignado" | "en_verificacion" | "aceptado";
export type ZonaNivel      = "barrio" | "comuna" | "municipio";

// ── Domain types ───────────────────────────────────────────────────────────────

export type ZonaPatrocinada = {
  codigo: string;
  nombre: string;
  nivel: ZonaNivel;
  tier: string | null;
};

export type PerfilAgente = {
  id: string;
  nombre: string;
  avatar?: string;
  bio?: string | null;
  estado: EstadoAgent;
  zonas_patrocinadas: ZonaPatrocinada[];
};

export type DueDiligence = {
  documentos_completos: boolean;
  faltantes: string[];
};

// Mínimos del listing borrador que el dashboard necesita para evaluar completitud
export type ListingDraft = {
  id: string;
  tipo_inmueble: TipoInmueble | null;
  operacion: Operacion | null;
  precio: number | null;
  municipio: string | null;
  barrio: string | null;
  geom_set: boolean;
  area_m2: number | null;
  titulo: string | null;
  habitaciones: number | null;
  banos: number | null;
  fotos_portada: number; // count of ListingMedia with es_portada=true
};

export type ItemAsignado = {
  id: string; // intake.id
  estado: EstadoIntake;
  tipo_inmueble: TipoInmueble;
  operacion: Operacion;
  precio_esperado: number;
  barrio: string;
  municipio: string;
  owner_nombre: string;
  declarado: {
    area_m2: number | null;
    habitaciones: number | null;
    banos: number | null;
    tiene_escritura: boolean | null;
    al_dia_predial: boolean | null;
    al_dia_administracion: boolean | null;
    tiene_hipoteca: boolean | null;
  };
  due_diligence: DueDiligence;
  listing?: ListingDraft | null; // borrador asociado (existe tras aceptar)
  created_at: string;
};

export type ItemPool = {
  id: string;
  tipo_inmueble: TipoInmueble;
  operacion: Operacion;
  precio_esperado: number;
  barrio: string;
  municipio: string;
  created_at: string;
};

export type MiListing = {
  id: string;
  titulo: string;
  tipo_inmueble: TipoInmueble;
  operacion: Operacion;
  precio: number;
  barrio: string;
  estado: EstadoListing;
  updated_at: string;
  vistas_total: number;
  vistas_30d: number;
};

// Inteligencia de barrio del realtor = mismo shape que el panel público de
// barrios (GET /barrios/:id) — sin gates FREE/PAGO, el agente ve todo.
export type InteligenciaBarrio = ApiBarrio;

export type RoiZona = {
  zona_codigo: string;
  zona_nombre: string;
  nivel: ZonaNivel;
  tier: string | null;
  precio_mensual: number;
  intakes_mes: number;
  tomados_mes: number;
  publicados_total: number;
  cerrados_total: number;
  costo_por_intake: number | null;
  vistas_30d: number;
};

export type Desempeno = {
  asignados_90d: number;
  aceptados_90d: number;
  tasa_aceptacion: number | null;       // 0–1
  mediana_horas_aceptar: number | null;
  vistas_30d: number;
  vistas_total: number;
  visitas_realizadas_90d: number;
  visitas_no_show_90d: number;
  show_rate: number | null;             // 0–1
  ofertas_90d: number;
  interesados_90d: number;
  // Diente del SLA (Zillow paso 3): grado de servicio por velocidad de respuesta.
  calificacion_servicio: {
    grado: string;                      // 'A' | 'B' | 'C' | 'D' | '—'
    nota: string;
    mediana_horas_respuesta: number | null;
    ranking: { posicion: number; total: number } | null;
  };
  zonas: RoiZona[];
};

export type EstadoVisita = "pendiente" | "confirmada" | "realizada" | "cancelada" | "no_asistio";
export type ResultadoVisita = "interesado" | "oferta" | "descartado";

// Calificación del lead (Zillow paso 2) — todos opcionales.
export type IntencionLead   = "vivir" | "invertir";
export type PresupuestoLead = "<200M" | "200-500M" | "500-1000M" | ">1000M";
export type PlazoLead       = "ya" | "1-3m" | "3-6m" | "explorando";
export type CreditoLead     = "contado" | "aprobado" | "en_tramite" | "no";

export type VisitaSolicitud = {
  id: string;
  listing_url: string;
  listing_titulo: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  fecha_visita: string | null;
  mensaje: string | null;
  estado: EstadoVisita;
  resultado: ResultadoVisita | null;
  created_at: string;
  es_pro: boolean;
  horas_pendiente: number | null; // horas sin responder; null si ya se atendió
  intencion: IntencionLead | null;
  presupuesto: PresupuestoLead | null;
  plazo: PlazoLead | null;
  credito: CreditoLead | null;
  calificado: boolean;
};

// Franja de disponibilidad semanal del agente (dia_semana 0=lunes..6=domingo).
export type Franja = { dia_semana: number; hora_inicio: string; hora_fin: string };

export type ListingPatch = {
  titulo?: string;
  descripcion?: string;
  precio?: number;
  area_m2?: number;
  habitaciones?: number;
  banos?: number;
  direccion_aprox?: string;
};

export type DDItemEstado = "pendiente" | "verificado" | "rechazado";

export type DDItem = {
  id: string;
  clave: string;
  declarado: boolean | string | null;
  estado: DDItemEstado;
  nota: string | null;
};

export type DDChecklist = {
  intake_id: string;
  items: DDItem[];
  completo: boolean;
};

export type Interesado = {
  nombre: string | null;
  email: string;
  listing_titulo: string;
  created_at: string;
};

export type Agenda = {
  visitas: VisitaSolicitud[];
  interesados: Interesado[];
};

// ── Business logic ─────────────────────────────────────────────────────────────

/** Evalúa si un listing borrador tiene los datos mínimos para enviar a revisión. */
export function datosMinimosCompletos(l: ListingDraft): { ok: boolean; faltan: string[] } {
  const faltan: string[] = [];
  if (!l.tipo_inmueble)              faltan.push("tipo de inmueble");
  if (!l.operacion)                  faltan.push("operación");
  if (!l.precio)                     faltan.push("precio");
  if (!l.geom_set)                   faltan.push("ubicación exacta");
  if (!l.barrio && !l.municipio)     faltan.push("barrio / municipio");
  if (!l.area_m2)                    faltan.push("área (m²)");
  if (!l.titulo)                     faltan.push("título del aviso");
  if (l.fotos_portada < 1)           faltan.push("foto de portada");
  if (l.tipo_inmueble === "apartamento" || l.tipo_inmueble === "casa") {
    if (!l.habitaciones)             faltan.push("habitaciones");
    if (!l.banos)                    faltan.push("baños");
  }
  return { ok: faltan.length === 0, faltan };
}

// ── API interface ──────────────────────────────────────────────────────────────

export interface RealtorDashboardApi {
  /** GET /api/v1/realtor/me */
  getPerfil(): Promise<PerfilAgente>;
  /** PATCH /api/v1/realtor/me — edita bio */
  editarPerfil(bio: string): Promise<void>;
  /** POST /api/v1/realtor/me/foto (multipart) — foto de perfil */
  subirFotoPerfil(file: File): Promise<void>;
  /** GET /api/v1/realtor/asignados */
  getAsignados(): Promise<ItemAsignado[]>;
  /** GET /api/v1/realtor/pool */
  getPool(): Promise<ItemPool[]>;
  /** POST /api/v1/realtor/pool/:id/tomar */
  tomarDelPool(id: string): Promise<void>;
  /** POST /api/v1/intake/:id/aceptar — crea listing borrador + checklist DD */
  aceptarAsignado(intakeId: string): Promise<void>;
  /** GET /api/v1/realtor/listings */
  getMisListings(): Promise<MiListing[]>;
  /** POST /api/v1/realtor/asignados/:id/publicar  (borrador → en_revision) */
  publicarAsignado(intakeId: string): Promise<void>;
  /** GET /api/v1/realtor/desempeno */
  getDesempeno(): Promise<Desempeno>;
  /** GET /api/v1/realtor/agenda */
  getAgenda(): Promise<Agenda>;
  /** PATCH /api/v1/realtor/visitas/:id */
  actualizarVisita(id: string, estado: Exclude<EstadoVisita, "pendiente">, resultado?: ResultadoVisita): Promise<void>;
  /** GET /api/v1/realtor/inteligencia/:codigo */
  getInteligenciaBarrio(zonaCodigo: string, nivel?: ZonaNivel): Promise<InteligenciaBarrio>;
  /** GET/PUT /api/v1/realtor/disponibilidad */
  getDisponibilidad(): Promise<Franja[]>;
  putDisponibilidad(franjas: Franja[]): Promise<void>;
  /** GET /api/v1/intake/:id/due-diligence */
  getDueDiligence(intakeId: string): Promise<DDChecklist>;
  /** POST /api/v1/due-diligence/:itemId/verificar */
  verificarDDItem(itemId: string, estado: "verificado" | "rechazado", nota?: string): Promise<void>;
  /** PATCH /api/v1/realtor/listings/:id */
  actualizarListing(listingId: string, campos: ListingPatch): Promise<void>;
  /** POST /api/v1/realtor/listings/:id/fotos (multipart) */
  subirFotosListing(listingId: string, files: File[]): Promise<void>;
}

// ── Mock ───────────────────────────────────────────────────────────────────────

const _d = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const _BARRIO_STATS: Record<string, { nombre: string; precioM2: number; arriendo: number; adr: number; seg: number }> = {
  "el-poblado": { nombre: "El Poblado", precioM2: 8_500_000, arriendo: 2_600_000, adr: 320_000, seg: 78 },
  "laureles":   { nombre: "Laureles",   precioM2: 6_800_000, arriendo: 1_900_000, adr: 240_000, seg: 71 },
};

function _mockBarrio(zonaCodigo: string): ApiBarrio {
  const s = _BARRIO_STATS[zonaCodigo] ?? { nombre: zonaCodigo, precioM2: 5_500_000, arriendo: 1_500_000, adr: 180_000, seg: 55 };
  return {
    barrio_id: 0, nombre: s.nombre, comuna: null, municipio: "Medellín", estrato: 4,
    geometry: null, color_hex: "#0F8A4F", excluir_inversion: false,
    scores: { corto: s.seg, cat_corto: null, mediano: s.seg - 5, cat_mediano: null, largo: s.seg - 10, cat_largo: null, perfil_recomendado: null, score_activo: s.seg },
    mercado: {
      precio_m2_cop: s.precioM2, precio_m2_usd: Math.round(s.precioM2 / 4100), precio_venta_promedio: null,
      arriendo_p50_cop: s.arriendo, yield_bruto_pct: 6.2, anos_recupero: 16, estado_precio: null,
      pbn_precio_justo: null, poi_precio_oferta: null,
      yield_renta_media_pct: 7.5, precio_renta_media_p50: Math.round(s.arriendo * 1.6), premium_vs_largo_pct: 60,
      n_listings_renta_media: 40, precio_accesible: null, presupuesto_max: null,
    },
    airbnb: {
      ocupacion_pct: 62, ocupacion_p25_pct: null, ocupacion_p75_pct: null, adr_usd: Math.round(s.adr / 4100),
      adr_cop: s.adr, yield_airbnb_pct: 9.1, yield_airbnb_real_pct: null, n_listings: 120,
      n_entire_home: null, n_private_room: null, n_superhosts: null,
      ingresos_anuales_p50_usd: null, ingresos_anuales_p50_cop: null, rating_promedio: null, reviews_promedio: null,
      diff_ocupacion_pct: null, diff_adr_cop: null,
    },
    seguridad: { score: s.seg, categoria: s.seg >= 70 ? "Segura" : "Moderada", zona_turistica: null, tendencia: "estable", nota: null },
    conectividad: { dist_metro_km: 1.2, dist_parque_km: 0.5, dist_mall_km: 1.0, n_cafes_500m: 8, n_coworking_1km: 3, n_gimnasios_1km: 5, n_yoga_1km: 2, indice_nomada: null, n_colegios_1km: 4, dist_colegio_km: 0.6, walk_score: 68, transit_score: 55 },
    verde: { indice_verde_pct: null, categoria: null, score_verde: null },
    liquidez: { score: s.seg, categoria: s.seg >= 70 ? "Alta" : "Media", tiempo_estimado_venta: s.seg >= 70 ? "2-4 meses" : "4-8 meses", nota_metodologia: null },
    oportunidad: { detectada: false, tipo: null, descripcion: null },
    valorizacion: { var_anual_pct: 5.4, proyeccion_3anos_pct: 17, proyeccion_5anos_pct: 30, tendencia: "alza" },
  };
}

// Mutable so tomarDelPool can remove rows optimistically
let _pool: ItemPool[] = [
  { id: "pool-1", tipo_inmueble: "apartamento", operacion: "venta",    precio_esperado: 280_000_000, barrio: "Sabaneta Centro",  municipio: "Sabaneta",  created_at: "2026-07-08T10:00:00Z" },
  { id: "pool-2", tipo_inmueble: "casa",        operacion: "arriendo", precio_esperado:   3_800_000, barrio: "Belén Rincón",     municipio: "Medellín",  created_at: "2026-07-07T14:30:00Z" },
  { id: "pool-3", tipo_inmueble: "local",       operacion: "arriendo", precio_esperado:   4_200_000, barrio: "El Centro",        municipio: "Medellín",  created_at: "2026-07-06T09:15:00Z" },
  { id: "pool-4", tipo_inmueble: "apartamento", operacion: "venta",    precio_esperado: 195_000_000, barrio: "Itagüí Centro",    municipio: "Itagüí",    created_at: "2026-07-05T16:00:00Z" },
];

const mockApi: RealtorDashboardApi = {
  async getPerfil() {
    await _d(500);
    return {
      id: "agent-demo-1",
      nombre: "Valentina Restrepo",
      estado: "activo",
      zonas_patrocinadas: [
        { codigo: "el-poblado", nombre: "El Poblado", nivel: "barrio", tier: "barrio" },
        { codigo: "laureles",   nombre: "Laureles",   nivel: "barrio", tier: "barrio" },
      ],
    };
  },

  async getAsignados() {
    await _d(600);
    return [
      // ── Caso 0: recién asignado → "Aceptar" (el lead nuevo de Zillow) ────────
      {
        id: "intake-0",
        estado: "asignado",
        tipo_inmueble: "apartamento",
        operacion: "venta",
        precio_esperado: 450_000_000,
        barrio: "El Poblado",
        municipio: "Medellín",
        owner_nombre: "Lucía Fernández",
        declarado: { area_m2: 95, habitaciones: 3, banos: 2, tiene_escritura: true, al_dia_predial: true, al_dia_administracion: true, tiene_hipoteca: null },
        due_diligence: { documentos_completos: false, faltantes: [] },
        listing: null,
        created_at: "2026-07-11T16:00:00Z",
      },
      // ── Caso 1: due diligence OK + listing completo → "Publicar" ────────────
      {
        id: "intake-1",
        estado: "aceptado",
        tipo_inmueble: "apartamento",
        operacion: "venta",
        precio_esperado: 620_000_000,
        barrio: "El Poblado",
        municipio: "Medellín",
        owner_nombre: "Carlos Mejía",
        declarado: { area_m2: 78, habitaciones: 3, banos: 2, tiene_escritura: true, al_dia_predial: true, al_dia_administracion: true, tiene_hipoteca: false },
        due_diligence: { documentos_completos: true, faltantes: [] },
        listing: {
          id: "listing-draft-1",
          tipo_inmueble: "apartamento",
          operacion: "venta",
          precio: 620_000_000,
          municipio: "Medellín",
          barrio: "El Poblado",
          geom_set: true,
          area_m2: 78,
          titulo: "Apartamento moderno en El Poblado con vista a la ciudad",
          habitaciones: 3,
          banos: 2,
          fotos_portada: 2,
        },
        created_at: "2026-07-05T09:00:00Z",
      },
      // ── Caso 2: due diligence OK + listing sin foto portada → "Completar ficha" ──
      {
        id: "intake-2",
        estado: "aceptado",
        tipo_inmueble: "casa",
        operacion: "venta",
        precio_esperado: 890_000_000,
        barrio: "Laureles",
        municipio: "Medellín",
        owner_nombre: "Marcela Torres",
        declarado: { area_m2: 140, habitaciones: 4, banos: 3, tiene_escritura: true, al_dia_predial: true, al_dia_administracion: null, tiene_hipoteca: false },
        due_diligence: { documentos_completos: true, faltantes: [] },
        listing: {
          id: "listing-draft-2",
          tipo_inmueble: "casa",
          operacion: "venta",
          precio: 890_000_000,
          municipio: "Medellín",
          barrio: "Laureles",
          geom_set: true,
          area_m2: 140,
          titulo: "Casa esquinera en Laureles — 4 hab",
          habitaciones: 4,
          banos: 3,
          fotos_portada: 0,   // ← sin foto de portada
        },
        created_at: "2026-07-06T11:00:00Z",
      },
      // ── Caso 3: documentos incompletos → "Revisar" ───────────────────────────
      {
        id: "intake-3",
        estado: "en_verificacion",
        tipo_inmueble: "apartamento",
        operacion: "arriendo",
        precio_esperado: 3_200_000,
        barrio: "Envigado Centro",
        municipio: "Envigado",
        owner_nombre: "Juan Esteban Ríos",
        declarado: { area_m2: 62, habitaciones: 2, banos: 2, tiene_escritura: false, al_dia_predial: true, al_dia_administracion: false, tiene_hipoteca: null },
        due_diligence: { documentos_completos: false, faltantes: ["escritura", "paz y salvo administración"] },
        created_at: "2026-07-07T15:00:00Z",
      },
    ];
  },

  async getPool() {
    await _d(600);
    return [..._pool];
  },

  async tomarDelPool(id) {
    await _d(400);
    _pool = _pool.filter((p) => p.id !== id);
  },

  async aceptarAsignado(_intakeId) {
    await _d(500);
    // ponytail: mock no-op; real impl POST /intake/:id/aceptar
  },

  async getMisListings() {
    await _d(600);
    return [
      { id: "l-1", titulo: "Apartamento moderno en El Poblado",   tipo_inmueble: "apartamento", operacion: "venta",    precio: 620_000_000, barrio: "El Poblado",  estado: "publicado",   updated_at: "2026-07-01T08:00:00Z", vistas_total: 1240, vistas_30d: 312 },
      { id: "l-2", titulo: "Casa esquinera Laureles — 4 hab",      tipo_inmueble: "casa",        operacion: "venta",    precio: 890_000_000, barrio: "Laureles",    estado: "en_revision", updated_at: "2026-07-04T10:00:00Z", vistas_total: 0,    vistas_30d: 0 },
      { id: "l-3", titulo: "Apartamento arriendo El Estadio",       tipo_inmueble: "apartamento", operacion: "arriendo", precio:   2_800_000, barrio: "El Estadio",  estado: "borrador",    updated_at: "2026-07-08T09:00:00Z", vistas_total: 0,    vistas_30d: 0 },
      { id: "l-4", titulo: "Local comercial Belén",                 tipo_inmueble: "local",       operacion: "arriendo", precio:   3_500_000, barrio: "Belén",       estado: "rechazado",   updated_at: "2026-06-28T14:00:00Z", vistas_total: 85,   vistas_30d: 4 },
      { id: "l-5", titulo: "Oficina zona financiera El Poblado",    tipo_inmueble: "oficina",     operacion: "venta",    precio: 320_000_000, barrio: "El Poblado",  estado: "cerrado",     updated_at: "2026-06-15T11:00:00Z", vistas_total: 2100, vistas_30d: 12 },
    ];
  },

  async publicarAsignado(_intakeId) {
    await _d(500);
    // ponytail: mock no-op; real impl POSTs intake → listing borrador → en_revision
  },

  async getDesempeno() {
    await _d(500);
    return {
      asignados_90d: 12,
      aceptados_90d: 10,
      tasa_aceptacion: 0.833,
      mediana_horas_aceptar: 3.5,
      visitas_realizadas_90d: 6,
      visitas_no_show_90d: 2,
      show_rate: 0.75,
      ofertas_90d: 2,
      interesados_90d: 3,
      calificacion_servicio: {
        grado: "B", nota: "Respondes bien",
        mediana_horas_respuesta: 6.2, ranking: { posicion: 3, total: 8 },
      },
      vistas_30d: 328,
      vistas_total: 3425,
      zonas: [
        {
          zona_codigo: "el-poblado", zona_nombre: "El Poblado", nivel: "barrio", tier: "barrio",
          precio_mensual: 200_000, intakes_mes: 9, tomados_mes: 7,
          publicados_total: 5, cerrados_total: 2, costo_por_intake: 22_222, vistas_30d: 290,
        },
        {
          zona_codigo: "laureles", zona_nombre: "Laureles", nivel: "barrio", tier: "barrio",
          precio_mensual: 200_000, intakes_mes: 4, tomados_mes: 3,
          publicados_total: 2, cerrados_total: 0, costo_por_intake: 50_000, vistas_30d: 38,
        },
      ],
    };
  },

  async getAgenda() {
    await _d(500);
    return {
      visitas: [
        { id: "v-1", listing_url: "l-1", listing_titulo: "Apartamento moderno en El Poblado", nombre: "Andrés Gómez",  telefono: "3001234567", email: "andres@example.com", fecha_visita: "2026-07-17T15:00:00Z", mensaje: "Viernes 17 jul a las 10:00 AM", estado: "pendiente",  resultado: null, created_at: "2026-07-15T09:00:00Z", es_pro: true, horas_pendiente: 9, intencion: "invertir", presupuesto: "500-1000M", plazo: "ya", credito: "aprobado", calificado: true },
        { id: "v-2", listing_url: "l-1", listing_titulo: "Apartamento moderno en El Poblado", nombre: "Sara Vélez",    telefono: null,         email: "sara@example.com",   fecha_visita: "2026-07-18T19:30:00Z", mensaje: null,                          estado: "confirmada", resultado: null, created_at: "2026-07-14T12:00:00Z", es_pro: false, horas_pendiente: null, intencion: null, presupuesto: null, plazo: null, credito: null, calificado: false },
        { id: "v-3", listing_url: "l-5", listing_titulo: "Oficina zona financiera El Poblado", nombre: "Camilo Ruiz",  telefono: "3017654321", email: null,                 fecha_visita: null,                    mensaje: "¿Se puede ver este fin de semana?", estado: "realizada", resultado: "interesado", created_at: "2026-07-08T16:00:00Z", es_pro: false, horas_pendiente: null, intencion: "vivir", presupuesto: "200-500M", plazo: "3-6m", credito: "en_tramite", calificado: true },
      ],
      interesados: [
        { nombre: "Laura Martínez", email: "laura@example.com",  listing_titulo: "Apartamento moderno en El Poblado", created_at: "2026-07-14T18:00:00Z" },
        { nombre: null,             email: "pedro@example.com",  listing_titulo: "Casa esquinera Laureles — 4 hab",   created_at: "2026-07-13T10:00:00Z" },
      ],
    } satisfies Agenda;
  },

  async actualizarVisita(_id, _estado, _resultado) {
    await _d(300);
  },

  async getDueDiligence(intakeId) {
    await _d(400);
    return {
      intake_id: intakeId,
      items: [
        { id: "dd-1", clave: "tiene_escritura",        declarado: true,  estado: "verificado", nota: null },
        { id: "dd-2", clave: "al_dia_predial",         declarado: true,  estado: "pendiente",  nota: null },
        { id: "dd-3", clave: "al_dia_administracion",  declarado: false, estado: "pendiente",  nota: null },
        { id: "dd-4", clave: "tiene_hipoteca",         declarado: null,  estado: "pendiente",  nota: null },
      ],
      completo: false,
    } satisfies DDChecklist;
  },

  async verificarDDItem(_itemId, _estado, _nota) {
    await _d(300);
  },

  async actualizarListing(_listingId, _campos) {
    await _d(300);
  },

  async editarPerfil(_bio) {
    await _d(300);
  },

  async subirFotoPerfil(_file) {
    await _d(500);
  },

  async subirFotosListing(_listingId, _files) {
    await _d(500);
  },

  async getInteligenciaBarrio(zonaCodigo) {
    await _d(500);
    return _mockBarrio(zonaCodigo);
  },

  async getDisponibilidad() {
    await _d(300);
    return [
      { dia_semana: 1, hora_inicio: "09:00", hora_fin: "18:00" },
      { dia_semana: 3, hora_inicio: "09:00", hora_fin: "18:00" },
    ];
  },
  async putDisponibilidad(_franjas) {
    await _d(300);
  },
};

// ── HTTP — api/routers/realtor.py ──────────────────────────────────────────────

const httpApi: RealtorDashboardApi = {
  getPerfil:            ()     => apiFetch<PerfilAgente>       (`${API_BASE_URL}/realtor/me`),
  getAsignados:         ()     => apiFetch<ItemAsignado[]>     (`${API_BASE_URL}/realtor/asignados`),
  getPool:              ()     => apiFetch<ItemPool[]>         (`${API_BASE_URL}/realtor/pool`),
  tomarDelPool:         (id)   => apiFetch<void>               (`${API_BASE_URL}/realtor/pool/${id}/tomar`,         { method: "POST" }),
  aceptarAsignado:      (id)   => apiFetch<void>               (`${API_BASE_URL}/intake/${id}/aceptar`,             { method: "POST" }),
  getMisListings:       ()     => apiFetch<MiListing[]>        (`${API_BASE_URL}/realtor/listings`),
  publicarAsignado:     (id)   => apiFetch<void>               (`${API_BASE_URL}/realtor/asignados/${id}/publicar`, { method: "POST" }),
  getDesempeno:         ()     => apiFetch<Desempeno>          (`${API_BASE_URL}/realtor/desempeno`),
  getAgenda:            ()     => apiFetch<Agenda>             (`${API_BASE_URL}/realtor/agenda`),
  actualizarVisita:     (id, estado, resultado) => apiFetch<void>(`${API_BASE_URL}/realtor/visitas/${id}`, { method: "PATCH", body: JSON.stringify({ estado, resultado }) }),
  getInteligenciaBarrio:(code, nivel) => apiFetch<InteligenciaBarrio> (`${API_BASE_URL}/realtor/inteligencia/${code}${nivel ? `?nivel=${nivel}` : ""}`),
  getDisponibilidad:    ()     => apiFetch<Franja[]>          (`${API_BASE_URL}/realtor/disponibilidad`),
  putDisponibilidad:    (fr)   => apiFetch<void>              (`${API_BASE_URL}/realtor/disponibilidad`, { method: "PUT", body: JSON.stringify(fr) }),
  getDueDiligence:      (id)   => apiFetch<DDChecklist>        (`${API_BASE_URL}/intake/${id}/due-diligence`),
  verificarDDItem:      (id, estado, nota) => apiFetch<void>   (`${API_BASE_URL}/due-diligence/${id}/verificar`, { method: "POST", body: JSON.stringify({ estado, nota }) }),
  actualizarListing:    (id, campos) => apiFetch<void>         (`${API_BASE_URL}/realtor/listings/${id}`, { method: "PATCH", body: JSON.stringify(campos) }),
  editarPerfil:         (bio)  => apiFetch<void>               (`${API_BASE_URL}/realtor/me`, { method: "PATCH", body: JSON.stringify({ bio }) }),
  async subirFotoPerfil(file) {
    // multipart — no puede pasar por apiFetch (fuerza Content-Type JSON)
    const fd = new FormData();
    fd.append("foto", file);
    const t = getToken();
    const res = await fetch(`${API_BASE_URL}/realtor/me/foto`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { detail?: string }).detail ?? `Error ${res.status}`);
    }
  },
  async subirFotosListing(id, files) {
    // multipart — no puede pasar por apiFetch (fuerza Content-Type JSON)
    const fd = new FormData();
    for (const f of files) fd.append("fotos", f);
    const t = getToken();
    const res = await fetch(`${API_BASE_URL}/realtor/listings/${id}/fotos`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { detail?: string }).detail ?? `Error ${res.status}`);
    }
  },
};

// Backend real por defecto. Mock solo si VITE_REALTOR_USE_MOCK="true" explícito.
export const realtorApi: RealtorDashboardApi =
  import.meta.env.VITE_REALTOR_USE_MOCK === "true" ? mockApi : httpApi;
