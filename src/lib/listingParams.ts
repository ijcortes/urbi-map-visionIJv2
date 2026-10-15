import { appendPriceParams } from "@/lib/adapters";
import type { Segmento } from "@/lib/segmento";

/** Filter state that is sent to /listings and /listings/viewport. */
export type ListingQueryFilters = {
  tipoOp?: "venta" | "arriendo" | null;
  precioMin?: number | null;
  precioMax?: number | null;
  amoblado?: boolean | null;
  habitaciones?: number | null;
  banos?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  estrato?: number[] | null;
  tipoInmueble?: string[] | null;
  diasMercado?: string | null;
  busqueda?: string | null;
  amenidades?: string[] | null;
  estadoInmueble?: string | null;
  pisoMin?: number | null;
  segmento?: Segmento | "todos" | null;
  ocultarDestacados?: boolean | null;
};

export type ZoneSelection = {
  barrioId?: number | null;
  cdComuna?: number | null;
  municipio?: string | null;
};

/** True only when the user explicitly picked a zone (click / search / deep link). */
export function hasExplicitZone(z: ZoneSelection): boolean {
  return z.barrioId != null || z.cdComuna != null || !!z.municipio;
}

export function appendSegmentParams(
  params: URLSearchParams,
  f: Pick<ListingQueryFilters, "segmento" | "ocultarDestacados">,
): void {
  if (f.segmento) params.set("segmento", f.segmento);
  if (f.ocultarDestacados) params.set("ocultar_destacados", "true");
}

/** Zone params. zona_completa is sent ONLY for an explicit zone (drops bbox server-side). */
export function appendZoneParams(params: URLSearchParams, z: ZoneSelection): void {
  if (z.barrioId != null) params.set("barrio_id", String(z.barrioId));
  if (z.cdComuna != null) params.set("cd_comuna", String(z.cdComuna));
  if (z.municipio) params.set("municipio", z.municipio);
  if (hasExplicitZone(z)) params.set("zona_completa", "true");
}

export function appendFilterParams(
  params: URLSearchParams,
  f: ListingQueryFilters,
  price?: { currency?: "COP" | "USD"; trm?: number | null; supportsMoneda?: boolean },
): void {
  if (f.tipoOp) params.set("tipo_operacion", f.tipoOp);
  appendPriceParams(params, f.precioMin, f.precioMax, price);
  if (f.amoblado != null) params.set("amoblado", String(f.amoblado));
  if (f.habitaciones != null) params.set("habitaciones", String(f.habitaciones));
  if (f.banos != null) params.set("banos", String(f.banos));
  if (f.areaMin != null) params.set("area_min", String(f.areaMin));
  if (f.areaMax != null) params.set("area_max", String(f.areaMax));
  if (f.estrato?.length) for (const e of f.estrato) params.append("estrato", String(e));
  if (f.tipoInmueble?.length) for (const t of f.tipoInmueble) params.append("tipo_inmueble", t);
  if (f.diasMercado) params.set("dias_mercado", f.diasMercado);
  if (f.busqueda?.trim()) params.set("busqueda", f.busqueda.trim());
  if (f.amenidades?.length) for (const a of f.amenidades) params.append("amenidades", a);
  if (f.estadoInmueble) params.set("estado_inmueble", f.estadoInmueble);
  if (f.pisoMin != null) params.set("piso_min", String(f.pisoMin));
  appendSegmentParams(params, f);
}

export type Bounds = { west: number; south: number; east: number; north: number };

/** Round to ~110 m (3 decimals) so tiny pans produce identical params / cache keys. */
export function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// NOTE: never send compact=true here. The viewport response feeds MLSPanel cards, map popups
// and the barrio-name filter, which all need foto_principal/barrio_nombre/municipio.
export function buildViewportParams(args: {
  bounds: Bounds;
  zoom: number;
  filters: ListingQueryFilters;
  zone: ZoneSelection;
  price?: { currency?: "COP" | "USD"; trm?: number | null; supportsMoneda?: boolean };
}): URLSearchParams {
  const { bounds: b, zoom, filters, zone, price } = args;
  const params = new URLSearchParams({
    min_lng: String(roundCoord(b.west)),
    min_lat: String(roundCoord(b.south)),
    max_lng: String(roundCoord(b.east)),
    max_lat: String(roundCoord(b.north)),
    zoom: String(Math.floor(zoom)),
  });
  appendFilterParams(params, filters, price);
  appendZoneParams(params, zone);
  return params;
}

/**
 * Cache/dedup key. With an explicit zone the bbox is irrelevant (zona_completa) so
 * it is excluded; otherwise it is the full (rounded) param string. Every filter that
 * changes the result, incl. segmento / ocultar_destacados / moneda, is in the params.
 */
export function viewportCacheKey(params: URLSearchParams, zone: ZoneSelection): string {
  if (!hasExplicitZone(zone)) return params.toString();
  const p = new URLSearchParams(params);
  for (const k of ["min_lng", "min_lat", "max_lng", "max_lat"]) p.delete(k);
  return p.toString();
}

export interface GeoSelection {
  activeComuna: string | null;
  activeComunaCd: number | null;
  activeMunicipio: string | null;
}

/**
 * A barrio click/navigation REPLACES the whole geographic selection: the municipality /
 * comuna are derived from the barrio itself so a stale one (e.g. Envigado, left from an
 * earlier pick) can never be intersected with the new barrio by the backend.
 * Medellín barrios carry cd_comuna -> comuna selection; other municipalities -> municipio.
 */
export function geoSelectionForBarrio(b: { cd_comuna?: number | null; comuna?: string | null; municipio?: string | null }): GeoSelection {
  if (b.cd_comuna != null) {
    return { activeComuna: b.comuna || null, activeComunaCd: b.cd_comuna, activeMunicipio: null };
  }
  return { activeComuna: null, activeComunaCd: null, activeMunicipio: b.municipio || null };
}
