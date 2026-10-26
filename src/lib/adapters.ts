import type { Opportunity } from "@/data/marketActivity";

export type NomadaBreakdown = {
  pts_yield: number | null;
  pts_nomada: number | null;
  pts_pbn: number | null;
  pts_seguridad: number | null;
  pts_verde: number | null;
  pts_equip: number | null;
};

export type Neighborhood = {
  id: number;
  nombre: string;
  comuna: string;
  cd_comuna?: number | null;
  municipio: string;
  estrato: number;
  precio_m2: number;
  arriendo: number;
  yield: number | null;
  anos_recupero: number | null;
  dist_metro: number;
  dist_parque: number;
  dist_mall: number;
  n_venta: number;
  n_arriendo: number;
  lat: number;
  lng: number;
  score_activo?: number | null;
  estado_precio?: string | null;
  pbn_precio_justo?: number | null;
  oportunidad?: { detectada: boolean | null; tipo: string | null; descripcion: string | null } | null;
  liquidez_api?: { score: number | null; categoria: string | null; tiempo_estimado_venta: string | null } | null;
  score_salud?: number;
  categoria_salud?: string;
  n_remates_municipio?: number;
  remates_por_100?: number | null;
  n_cafes_500m?: number | null;
  n_coworking_1km?: number | null;
  n_gimnasios_1km?: number | null;
  n_yoga_1km?: number | null;
  indice_nomada?: number | null;
  yield_renta_media_pct?: number | null;
  precio_renta_media_p50?: number | null;
  nomada_breakdown?: NomadaBreakdown | null;
  zona_turistica?: boolean | null;
  seguridad_score?: number | null;
  seguridad_categoria?: string | null;
  seguridad_nota?: string | null;
  verde_pct?: number | null;
  verde_categoria?: string | null;
  trafico_nivel?: string | null;
  trafico_jam?: number | null;
  trafico_pico_am?: [number, number] | null;
  trafico_pico_pm?: [number, number] | null;
  uso_suelo_dominante?: string | null;
  uso_suelo_score?: number | null;
  // GAP fixes
  airbnb_data?: {
    ocupacion_pct: number | null;
    ocupacion_p25_pct: number | null;
    ocupacion_p75_pct: number | null;
    adr_cop: number | null;
    yield_airbnb_pct: number | null;
    yield_airbnb_real_pct: number | null;
    n_listings: number | null;
    n_entire_home: number | null;
    n_private_room: number | null;
    n_superhosts: number | null;
    ingresos_anuales_p50_cop: number | null;
    rating_promedio: number | null;
    reviews_promedio: number | null;
    diff_ocupacion_pct: number | null;
    diff_adr_cop: number | null;
  } | null;
  amenidades?: {
    pct_wifi: number | null;
    pct_ac: number | null;
    pct_kitchen: number | null;
    pct_washer: number | null;
    score_equipamiento: number | null;
    n_listings_base: number | null;
  } | null;
  valorizacion_api?: { var_anual_pct: number | null; proyeccion_3anos_pct: number | null; proyeccion_5anos_pct: number | null; tendencia: string | null } | null;
  seguridad_tendencia?: string | null;
  premium_vs_largo_pct?: number | null;
  catastro_comuna?: { total_predios: number | null; pct_apartamento: number | null; area_mediana_apto_m2: number | null; avaluo_m2: number | null; ratio_mercado_catastro: number | null; ratio_vs_ciudad: number | null } | null;
  mercado_real?: { anio_dato: number | null; n_transacciones_anual: number | null; valor_mediana_anual: number | null; var_anual_pct: number | null; ipvn_dane_pct: number | null; meses_inventario: number | null; clasificacion_mercado: string | null; ratio_cierre_pedido_pct: number | null } | null;
};
import {
  OPP_COLORS,
  getScoreColor,
  getScoreLabel,
} from "@/config/mapColors";

// ── Backend response shapes (mirrors api/routers/barrios.py) ──────────────────

export type ApiBarrio = {
  barrio_id: number;
  nombre: string | null;
  comuna: string | null;
  municipio: string | null;
  estrato: number | null;
  cd_comuna?: number | null;
  geometry: { type: string; coordinates: unknown } | null;
  color_hex: string | null;
  excluir_inversion: boolean | null;
  uso_suelo_dominante?: string | null;
  uso_suelo_score?: number | null;
  n_remates_municipio?: number | null;
  scores: {
    corto: number | null;
    cat_corto: string | null;
    mediano: number | null;
    cat_mediano: string | null;
    largo: number | null;
    cat_largo: string | null;
    perfil_recomendado: string | null;
    score_activo: number | null;
  };
  mercado: {
    precio_m2_cop: number | null;
    precio_m2_usd: number | null;
    precio_venta_promedio: number | null;
    arriendo_p50_cop: number | null;
    yield_bruto_pct: number | null;
    anos_recupero: number | null;
    estado_precio: string | null;
    pbn_precio_justo: number | null;
    poi_precio_oferta: number | null;
    yield_renta_media_pct: number | null;
    precio_renta_media_p50: number | null;
    premium_vs_largo_pct: number | null;
    n_listings_renta_media: number | null;
    precio_accesible: boolean | null;
    presupuesto_max: number | null;
  };
  nomada_breakdown?: NomadaBreakdown | null;
  airbnb: {
    ocupacion_pct: number | null;
    ocupacion_p25_pct: number | null;
    ocupacion_p75_pct: number | null;
    adr_usd: number | null;
    adr_cop: number | null;
    yield_airbnb_pct: number | null;
    yield_airbnb_real_pct: number | null;
    n_listings: number | null;
    n_entire_home: number | null;
    n_private_room: number | null;
    n_superhosts: number | null;
    ingresos_anuales_p50_usd: number | null;
    ingresos_anuales_p50_cop: number | null;
    rating_promedio: number | null;
    reviews_promedio: number | null;
    diff_ocupacion_pct: number | null;
    diff_adr_cop: number | null;
  };
  amenidades?: {
    pct_wifi: number | null;
    pct_ac: number | null;
    pct_kitchen: number | null;
    pct_washer: number | null;
    score_equipamiento: number | null;
    n_listings_base: number | null;
  } | null;
  seguridad: {
    score: number | null;
    categoria: string | null;
    zona_turistica: boolean | null;
    tendencia: string | null;
    nota: string | null;
  };
  conectividad: {
    dist_metro_km: number | null;
    dist_parque_km: number | null;
    dist_mall_km: number | null;
    n_cafes_500m: number | null;
    n_coworking_1km: number | null;
    n_gimnasios_1km: number | null;
    n_yoga_1km: number | null;
    indice_nomada: number | null;
    n_colegios_1km: number | null;
    dist_colegio_km: number | null;
    walk_score: number | null;
    transit_score: number | null;
  };
  verde: {
    indice_verde_pct: number | null;
    categoria: string | null;
    score_verde: number | null;
  };
  trafico?: {
    nivel: string | null;
    jam_prom: number | null;
    pico_am_inicio: number | null;
    pico_am_fin: number | null;
    pico_pm_inicio: number | null;
    pico_pm_fin: number | null;
  } | null;
  liquidez: {
    score: number | null;
    categoria: string | null;
    tiempo_estimado_venta: string | null;
    nota_metodologia: string | null;
  };
  oportunidad: {
    detectada: boolean | null;
    tipo: string | null;
    descripcion: string | null;
  };
  valorizacion: {
    var_anual_pct: number | null;
    proyeccion_3anos_pct: number | null;
    proyeccion_5anos_pct: number | null;
    tendencia: string | null;
  };
  catastro_comuna?: {
    total_predios: number | null;
    pct_apartamento: number | null;
    area_mediana_apto_m2: number | null;
    avaluo_m2: number | null;
    ratio_mercado_catastro: number | null;
    ratio_vs_ciudad: number | null;
  } | null;
  mercado_real?: {
    anio_dato: number | null;
    n_transacciones_anual: number | null;
    valor_mediana_anual: number | null;
    var_anual_pct: number | null;
    ipvn_dane_pct: number | null;
    meses_inventario: number | null;
    clasificacion_mercado: string | null;
    ratio_cierre_pedido_pct: number | null;
  } | null;
};

export type ApiListingAgente = {
  nombre: string;
  telefono: string;
  foto_url?: string | null;
  email?: string | null;
  zona_nivel: string; // 'barrio' | 'comuna'
};

export type ApiListingAgentes = {
  comuna?: ApiListingAgente | null; // patrocinio caro → tarjeta principal
  barrio?: ApiListingAgente | null; // patrocinio barato → tarjeta secundaria
};

export type SimilarListing = {
  id: number;
  url: string;
  precio_cop?: number | null;
  area_m2?: number | null;
  habitaciones?: number | null;
  banos?: number | null;
  barrio_nombre?: string | null;
  dias_en_mercado?: number | null;
  foto_principal?: string | null;
  tipo_inmueble?: string | null;
};

export type ApiListing = {
  id: number;
  fuente?: string | null;
  fuente_display?: string | null;
  tipo_operacion?: string | null;
  tipo_inmueble?: string | null;
  precio_cop?: number | null;
  precio_usd?: number | null;
  area_m2?: number | null;
  precio_m2?: number | null;
  precio_m2_mediana_barrio?: number | null;
  habitaciones?: number | null;
  banos?: number | null;
  direccion_raw?: string | null;
  url?: string | null;
  /** Stable favorites key (== raw url; for own listings the internal id, where `url` is null). */
  fav_key?: string | null;
  fecha_scraping?: string | null;
  buena_oferta?: boolean | null;
  pct_bajo_mediana?: number | null;
  dias_en_mercado?: number | null;
  fecha_publicacion?: string | null;
  lat?: number | null;
  lon?: number | null;
  barrio_id?: number | null;
  barrio_nombre?: string | null;
  barrio_display?: string | null;
  municipio?: string | null;
  municipio_display?: string | null;
  comuna_nombre?: string | null;
  cd_comuna?: number | null;
  tier?: string | null;
  estrato_real?: number | null;
  uso_suelo_pot?: string | null;
  estrato_manzana?: number | null;
  amoblado?: boolean | null;
  // Modelo unificado: due diligence del asesor. Publica primero (false), sello al verificar.
  verificado?: boolean | null;
  // URL availability — present after validate_listings_urls.py has run
  disponible_actualmente?: boolean | null;
  // Original-link health from the API: url is already null when gone/pending_review/error
  link_status?: "unknown" | "ok" | "redirected" | "pending_review" | "gone" | "error" | null;
  fecha_ultima_verificacion?: string | null;
  favoritos_count?: number | null;
  foto_principal?: string | null;
  // Barrio context — always included (from analytics.barrios_contexto JOIN)
  barrio_score?: number | null;  // ctx.score_corto
  barrio_yield?: number | null;  // ctx.yield_bruto_pct
  // Personalization — present when user is authenticated with a perfil
  relevancia_score?: number | null;
  match_label?: string | null;
  match_razones?: string[] | null;
};

export type ApiListingDetail = ApiListing & {
  estrato_real?: number | null;
  descripcion?: string | null;
  // Traducción offline bidireccional (raw.descripcion_traduccion):
  descripcion_trad?: string | null;      // texto en el idioma opuesto a src
  descripcion_src_lang?: string | null;  // 'es' | 'en' — idioma del source
  tour_url?: string | null;   // tour 3D/360 (Matterport, Kuula…)
  video_url?: string | null;  // video (YouTube, Vimeo)
  arriendo_p50_barrio?: number | null;
  yield_estimado?: number | null;
  // Free-tier descriptive fields
  fotos?: string[] | null;
  amenidades?: string[] | null;
  antiguedad?: string | null;
  estado_inmueble?: string | null;
  parqueaderos?: number | null;
  piso?: number | null;
  nombre_edificio?: string | null;
  vistas?: number | null;
  precio_historia?: { precio: number; fecha: string; delta_pct?: number | null }[] | null;
  // Barrio context (paid tier)
  yield_bruto_pct?: number | null;
  score_corto?: number | null;
  score_mediano?: number | null;
  score_largo?: number | null;
  liquidez_score?: number | null;
  indice_nomada?: number | null;
  seguridad_score?: number | null;
  var_anual_pct?: number | null;
  // Barrio price range — pro only
  precio_m2_p25?: number | null;
  precio_m2_p75?: number | null;
  arr_p25?: number | null;
  arr_p75?: number | null;
  // Zillow-style extras
  n_duplicados?: number | null;
  precio_variable?: boolean | null;
  precio_min_cluster?: number | null;
  precio_max_cluster?: number | null;
  tiempo_estimado_venta?: string | null; // barrio intel — gated server-side
  avaluo_m2_catastro?: number | null;    // avalúo catastral/m² (comuna) — gated
};

export type ApiListingsResponse = {
  total: number;
  listings: ApiListing[];
  barrios_incluidos?: string[] | null;
  radio_usado_metros?: number | null;
};

export type ApiOportunidad = {
  barrio_id: number;
  nombre_barrio: string | null;
  comuna: string | null;
  municipio: string | null;
  tipo_oportunidad: string | null;
  descripcion_oportunidad: string | null;
  score_relevante: number | null;
  liquidez_score: number | null;
  categoria_liquidez: string | null;
  tiempo_estimado_venta: string | null;
  estado_precio: string | null;
  yield_bruto_pct: number | null;
};

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function centroid(geometry: ApiBarrio["geometry"]): [number, number] {
  if (!geometry) return [-75.58, 6.24];
  const g = geometry as { type: string; coordinates: number[][][] | number[][][][] };
  if (g.type === "Point") {
    const c = g.coordinates as unknown as number[];
    return [c[0], c[1]];
  }
  const ring: number[][] =
    g.type === "Polygon"
      ? (g.coordinates as number[][][])[0]
      : g.type === "MultiPolygon"
        ? ((g.coordinates as number[][][][])[0]?.[0] ?? [])
        : [];
  if (!ring.length) return [-75.58, 6.24];
  const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  return [lng, lat];
}

export type BarrioOption = {
  id: number;
  nombre: string;
  municipio: string;
  comuna: string | null;
  lat: number;
  lng: number;
  cd_comuna: number | null;
  /** Sector buscado por su nombre popular: "Ciudad del Río (Colombia)". */
  displayName?: string;
};

export function barrioToOption(b: ApiBarrio): BarrioOption {
  const [lng, lat] = centroid(b.geometry);
  return {
    id: b.barrio_id,
    nombre: b.nombre ?? "—",
    municipio: b.municipio ?? "—",
    comuna: b.comuna ?? null,
    lat,
    lng,
    cd_comuna: b.cd_comuna ?? null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function scoreLabel(score: number | null, perfil?: string, risk?: string): string {
  return getScoreLabel(score, perfil, risk);
}

// ── Converters ────────────────────────────────────────────────────────────────

export function barrioToNeighborhood(b: ApiBarrio): Neighborhood {
  const [lng, lat] = centroid(b.geometry);
  return {
    id: b.barrio_id,
    nombre: (b.nombre ?? "").toUpperCase(),
    comuna: b.comuna ?? "",
    cd_comuna: b.cd_comuna ?? null,
    municipio: b.municipio ?? "Medellín",
    estrato: b.estrato ?? 3,
    precio_m2: b.mercado.precio_m2_cop ?? 5_000_000,
    arriendo: b.mercado.arriendo_p50_cop ?? 2_000_000,
    yield: b.mercado.yield_bruto_pct ?? null,
    anos_recupero: b.mercado.anos_recupero ?? null,
    dist_metro: b.conectividad.dist_metro_km ?? 1,
    dist_parque: b.conectividad.dist_parque_km ?? 0.5,
    dist_mall: b.conectividad.dist_mall_km ?? 1.5,
    n_venta: 0,
    n_arriendo: 0,
    lat,
    lng,
    score_activo: b.scores.score_activo,
    estado_precio: b.mercado.estado_precio,
    oportunidad: b.oportunidad,
    n_cafes_500m: b.conectividad.n_cafes_500m,
    n_coworking_1km: b.conectividad.n_coworking_1km,
    n_gimnasios_1km: b.conectividad.n_gimnasios_1km,
    n_yoga_1km: b.conectividad.n_yoga_1km,
    indice_nomada: b.conectividad.indice_nomada,
    pbn_precio_justo: b.mercado.pbn_precio_justo,
    yield_renta_media_pct: b.mercado.yield_renta_media_pct,
    precio_renta_media_p50: b.mercado.precio_renta_media_p50,
    nomada_breakdown: b.nomada_breakdown ?? null,
    liquidez_api: b.liquidez
      ? { score: b.liquidez.score, categoria: b.liquidez.categoria, tiempo_estimado_venta: b.liquidez.tiempo_estimado_venta }
      : null,
    zona_turistica: b.seguridad?.zona_turistica ?? null,
    seguridad_score: b.seguridad?.score ?? null,
    seguridad_categoria: b.seguridad?.categoria ?? null,
    seguridad_nota: b.seguridad?.nota ?? null,
    seguridad_tendencia: b.seguridad?.tendencia ?? null,
    verde_pct: b.verde?.indice_verde_pct ?? null,
    verde_categoria: b.verde?.categoria ?? null,
    trafico_nivel: b.trafico?.nivel ?? null,
    trafico_jam: b.trafico?.jam_prom ?? null,
    trafico_pico_am: b.trafico?.pico_am_inicio != null && b.trafico?.pico_am_fin != null
      ? [b.trafico.pico_am_inicio, b.trafico.pico_am_fin] : null,
    trafico_pico_pm: b.trafico?.pico_pm_inicio != null && b.trafico?.pico_pm_fin != null
      ? [b.trafico.pico_pm_inicio, b.trafico.pico_pm_fin] : null,
    uso_suelo_dominante: b.uso_suelo_dominante ?? null,
    uso_suelo_score: b.uso_suelo_score ?? null,
    n_remates_municipio: b.n_remates_municipio ?? undefined,
    airbnb_data: (b.airbnb?.n_listings != null || b.airbnb?.ocupacion_pct != null)
      ? {
          ocupacion_pct: b.airbnb.ocupacion_pct,
          ocupacion_p25_pct: b.airbnb.ocupacion_p25_pct,
          ocupacion_p75_pct: b.airbnb.ocupacion_p75_pct,
          adr_cop: b.airbnb.adr_cop,
          yield_airbnb_pct: b.airbnb.yield_airbnb_pct,
          yield_airbnb_real_pct: b.airbnb.yield_airbnb_real_pct,
          n_listings: b.airbnb.n_listings,
          n_entire_home: b.airbnb.n_entire_home,
          n_private_room: b.airbnb.n_private_room,
          n_superhosts: b.airbnb.n_superhosts,
          ingresos_anuales_p50_cop: b.airbnb.ingresos_anuales_p50_cop,
          rating_promedio: b.airbnb.rating_promedio,
          reviews_promedio: b.airbnb.reviews_promedio,
          diff_ocupacion_pct: b.airbnb.diff_ocupacion_pct,
          diff_adr_cop: b.airbnb.diff_adr_cop,
        }
      : null,
    amenidades: b.amenidades ?? null,
    valorizacion_api: (b.valorizacion?.var_anual_pct != null || b.valorizacion?.proyeccion_5anos_pct != null)
      ? b.valorizacion
      : null,
    premium_vs_largo_pct: b.mercado.premium_vs_largo_pct ?? null,
    catastro_comuna: b.catastro_comuna ?? null,
    mercado_real: b.mercado_real ?? null,
  };
}

const OPP_EMOJIS: Record<string, string> = {
  "PRECIO BAJO MERCADO": "🎯",
  "ALTO RENDIMIENTO": "📈",
  "INVERSIÓN SEGURA": "🛡️",
};

export function apiOportunidadToOpportunity(o: ApiOportunidad): Opportunity {
  const tipo = (o.tipo_oportunidad ?? "ALTO RENDIMIENTO").toUpperCase() as Opportunity["tipo"];
  return {
    barrio_id: o.barrio_id,
    barrio: (o.nombre_barrio ?? "").toUpperCase(),
    tipo,
    descripcion: o.descripcion_oportunidad ?? "",
    score: o.score_relevante ?? 50,
    liquidez: (o.categoria_liquidez ?? "MEDIA") as Opportunity["liquidez"],
    color: OPP_COLORS[tipo as keyof typeof OPP_COLORS] ?? "#0077B6",
    emoji: OPP_EMOJIS[tipo] ?? "📊",
  };
}

export function parseBudgetCop(budget?: string | null): [number, number] | null {
  if (!budget) return null;
  const M = 1_000_000;
  if (budget === "<200") return [0, 200 * M];
  if (budget === "200-500") return [200 * M, 500 * M];
  if (budget === "500-1000") return [500 * M, 1_000 * M];
  if (budget === ">1000") return [1_000 * M, Infinity];
  return null;
}


// ── Price filter params ─────────────────────────────────────────────────────
// Filter state is canonical COP. The API takes `moneda` (COP|USD) + precio_min /
// precio_max in that currency. Until the deployed backend is known to support
// `moneda` (VITE_API_SUPPORTS_MONEDA=true) we send COP-converted values, which
// both old and new backends interpret correctly (new ones default moneda=COP).
// Backend now supports moneda/segmento/ocultar_destacados/zona_completa/compact: default ON,
// set VITE_API_SUPPORTS_MONEDA=false to opt out.
const SUPPORTS_MONEDA = import.meta.env.VITE_API_SUPPORTS_MONEDA !== "false";

export function appendPriceParams(
  params: URLSearchParams,
  minCop: number | null | undefined,
  maxCop: number | null | undefined,
  opts: { currency?: "COP" | "USD"; trm?: number | null; supportsMoneda?: boolean } = {},
): void {
  const supports = opts.supportsMoneda ?? SUPPORTS_MONEDA;
  const useUsd = supports && opts.currency === "USD" && !!opts.trm && opts.trm > 0;
  const conv = (v: number) => (useUsd ? Math.round(v / (opts.trm as number)) : Math.round(v));
  if (minCop != null) params.set("precio_min", String(conv(minCop)));
  if (maxCop != null) params.set("precio_max", String(conv(maxCop)));
  if (supports && (minCop != null || maxCop != null)) params.set("moneda", useUsd ? "USD" : "COP");
}
