import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import mapboxgl, { Map as MapboxMap } from "mapbox-gl";
import { pointOnFeature } from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "@/lib/mapboxToken";
import { auth, MAP_STYLES } from "@/lib/auth";
import { barrioToNeighborhood, type ApiBarrio, type Neighborhood } from "@/lib/adapters";
import { useBarriosRaw, useScoreThresholds, useComunasMetrics, type ComunaMetrics } from "@/hooks/useBarrios";
import type { ApiListing } from "@/lib/adapters";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import type { MapTab } from "@/components/MapNavbar";
import { LoadingVeil } from "@/components/LoadingVeil";

type ViewportResponse = {
  mode: "clusters" | "points";
  zoom: number;
  clusters: { lng: number; lat: number; count: number; precio_promedio: number | null }[];
  listings: ApiListing[];
};
import {
  OPP_COLORS,
  PALETTE_EVENT,
  THRESHOLDS_EVENT,
  getActivePaletteId,
  setScoreThresholds,
  type ScorePaletteId,
} from "@/config/mapColors";
type Props = {
  onSelect: (n: Neighborhood) => void;
  selectedId: number | null;
  perfil?: string;
  risk?: string;
  mostrarOportunidades?: boolean;
  budgetRange?: [number, number] | null;
  onViewLevelChange?: (level: "comunas" | "barrios", comunaNombre: string | null, municipioFilter?: string | null, cdComuna?: number | null) => void;
  returnToComunasRef?: React.MutableRefObject<((speed?: number) => void) | null>;
  onGoToMLS?: (n: Neighborhood) => void;
  // Vista 2 — MLS
  mapView?: "zonas" | "listings";
  mlsBarrioId?: number | null;
  // Viewport loading (FIX 1): active map filters + callback with the points
  // currently in view (so map.tsx can resolve clicks → mini-popup).
  mlsTipoOp?: "venta" | "arriendo";
  mlsPrecioMin?: number | null;
  mlsPrecioMax?: number | null;
  mlsAmoblado?: boolean | null;
  mlsCdComuna?: number | null;
  mlsMunicipio?: string | null;
  // Remaining shared filters, now applied server-side in /viewport (FIX 1d follow-up).
  mlsFilters?: {
    habitaciones: number | null;
    banos: number | null;
    areaMin: number | null;
    areaMax: number | null;
    estrato: number[] | null;
    tipoInmueble: string[] | null;
    diasMercado: string | null;
    busqueda: string | null;
    amenidades: string[] | null;
    estadoInmueble: string | null;
    pisoMin: number | null;
  };
  onViewportListingsChange?: (listings: ApiListing[]) => void;
  onViewportLoadingChange?: (loading: boolean) => void;
  onAutoSelectBarrio?: (barrioId: number | null) => void;
  onAutoSelectComuna?: (cd: number | null, municipio: string | null, nombre: string | null) => void;
  highlightedListingId?: number | null;
  flyToListingRef?: React.MutableRefObject<((lat: number, lng: number, zoom?: number) => void) | null>;
  onListingClickFromMap?: (id: number, screenX: number, screenY: number) => void;
  onListingDoubleClickFromMap?: (id: number) => void;
  activeBarrioName?: string | null;
  activeTab?: MapTab;
  onBarrioClick?: (id: number, nombre: string, lat: number, lng: number, cdComuna: number | null, municipio: string | null) => void;
  flyToBarriosRef?: React.MutableRefObject<(() => void) | null>;
  cooperativeGestures?: boolean;
  // Pixels of UI (overlay bar/card) covering the bottom of the map container.
  // fitBounds/flyTo reserve this much extra bottom padding so the zoned
  // comuna/barrio still lands visually centered in what's actually visible.
  bottomInset?: number;
  // Camera tilt for the comunas-level view. Defaults to the 3D look (35°/-10°
  // desktop, flat on mobile). A short/wide container (e.g. the home hero
  // preview) has little vertical room to absorb the tilt's perspective
  // compression, which visually pushes the valley toward the bottom of the
  // box — pass 0/0 there to keep it flat and centered.
  pitch?: number;
  bearing?: number;
  // Encuadra el valle completo con fitBounds (responsivo a cualquier tamaño
  // de contenedor) en vez del center+zoom fijo pensado para la página /map
  // a pantalla completa.
  fitValle?: boolean;
  // Se dispara una vez cuando el mapa emitió "load" (capas listas). El deep-link
  // de comuna (/map?cd_comuna=...) espera esto para seleccionar la zona como un
  // click real post-load, evitando la carrera con los efectos gated por mapLoaded.
  onReady?: () => void;
};

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
// Valle de Aburrá completo (Barbosa → Caldas). Usado con fitBounds en vez de
// center+zoom fijo para que instancias pequeñas/responsivas (hero del home)
// encuadren el valle entero sea cual sea el tamaño real del contenedor —
// un zoom fijo asumía una caja alta como la de /map y en cajas cortas
// terminaba mostrando solo el norte, con el valle corrido hacia abajo.
// Home hero: encuadra Bello (extremo norte, lat 6.3623) ↔ La Estrella (extremo
// sur, lat 6.106) con padding SIMÉTRICO y mapa PLANO (pitch 0). Así ambos
// polígonos quedan a la misma distancia del borde → el valle queda centrado sea
// cual sea el alto de pantalla. Con tilt 3D, "misma distancia" es imposible
// (la perspectiva distorsiona), por eso el hero va plano.
// Encuadre del HERO (solo paths fitValle). Valle CENTRAL (~2x más cerca que el
// valle completo): el fit liga por alto → esta caja de lat ~0.13° deja el frame
// pegado a Medellín/Poblado/Laureles sin gutters enormes. Recorta Bello (norte)
// y La Estrella/Sabaneta (sur) a propósito — cuadro chico, pedido del usuario.
// El zoom sigue libre (scroll-in a calles). /map NO usa esto (fitValle=false).
const VALLE_BOUNDS: [[number, number], [number, number]] = [[-75.65, 6.150], [-75.54, 6.318]];
// Móvil/iPad: el crop central queda muy cerca en cajas chicas/altas (iPad en
// portrait es "desktop" por el breakpoint 768 pero su caja alta liga por alto →
// más zoom que un monitor ancho). <1024 cubre teléfono + iPad portrait → encuadra
// el valle completo. maxBounds también se ensancha o el fitBounds clampea al box
// chico y no alcanza a alejarse. iPad landscape queda con el crop desktop (subir
// el umbral si molesta). El zoom-in a calles sigue libre en ambos.
const VALLE_BOUNDS_WIDE: [[number, number], [number, number]] = [[-75.68, 6.106], [-75.51, 6.3623]];
function heroFit(): { bounds: [[number, number], [number, number]]; maxBounds: [[number, number], [number, number]] } {
  return (typeof window !== "undefined" && window.innerWidth < 1024)
    ? { bounds: VALLE_BOUNDS_WIDE, maxBounds: [[-75.71, 6.07], [-75.46, 6.42]] }
    : { bounds: VALLE_BOUNDS, maxBounds: [[-75.715, 6.128], [-75.475, 6.34]] };
}
// Zoom at which the polygon tier flips comuna → barrio (matches cluster→points). Knob.
const POLYGON_TIER_ZOOM = 13;       // clusters → puntos (listings distribuidos de la comuna)
const BARRIO_TIER_ZOOM = 15;        // puntos distribuidos → polígonos de barrio + auto-select barrio
// ponytail: dos umbrales a propósito. A 13 aparecen los listings distribuidos de toda
// la comuna; solo a 15 se baja a barrio (polígonos + narrow). Antes ambos caían en 13
// = "pasaba a barrio directamente" sin fase intermedia. Tunear 15 si el salto se siente.
// Synthetic barrio ids (non-API fallback) live at/above this — excluded from the layer.
const _REAL_ID_MAX = 800_000;

// Municipalities not included in map data
const _HIDDEN_MUNICIPIOS = ["CALDAS", "COPACABANA", "GIRARDOTA", "BARBOSA"];

// Fallback static files for municipio blocks — only fetched when API omits them
const MUNICIPIO_STATIC: Record<number, string> = {
  101: "/data/comunas_bello.geojson",
  102: "/data/comunas_envigado.geojson",
  103: "/data/comunas_itagui.geojson",
  104: "/data/comunas_sabaneta.geojson",
  105: "/data/comunas_la_estrella.geojson",
};

// Calcula los bounds de un feature de Mapbox
function featureBounds(feat: mapboxgl.MapboxGeoJSONFeature): mapboxgl.LngLatBounds {
  const bounds = new mapboxgl.LngLatBounds();
  const geom = feat.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat(1);
  for (const ring of rings) {
    for (const [lng, lat] of ring as [number, number][]) {
      bounds.extend([lng, lat]);
    }
  }
  return bounds;
}

function featureCentroid(feat: mapboxgl.MapboxGeoJSONFeature): [number, number] {
  const bounds = featureBounds(feat);
  const c = bounds.getCenter();
  return [c.lat, c.lng];
}

// ── Popup HTML for individual listing ───────────────────────────────────────

function _fmtCOP(n: number): string {
  const m = Math.round(n / 1_000_000);
  return `$${m.toLocaleString("es-CO")}M`;
}

function _fmtM2(n: number): string {
  return `$${(n / 1_000_000).toFixed(1)}M/m²`;
}

function _scoreLabel(s: number): string {
  if (s >= 70) return "EXCELENTE";
  if (s >= 55) return "BUENO";
  if (s >= 40) return "MODERADO";
  return "BAJO";
}

function buildListingPopupHTML(
  props: Record<string, unknown>,
  barrio: ApiBarrio | undefined,
  _perfil?: string,
): string {
  const precio_cop   = (props.precio_cop   as number | null) ?? null;
  const precio_usd   = (props.precio_usd   as number | null) ?? null;
  const precio_m2    = (props.precio_m2    as number | null) ?? null;
  const mediana      = (props.precio_m2_mediana_barrio as number | null) ?? null;
  const area_m2      = (props.area_m2      as number | null) ?? null;
  const habitaciones = (props.habitaciones as number | null) ?? null;
  const banos        = (props.banos        as number | null) ?? null;
  const tipo_op      = (props.tipo_op      as string) ?? "venta";
  const tipo_inmueble= (props.tipo_inmueble as string) ?? "";
  const barrio_nombre= (props.barrio_nombre as string) ?? "";
  const fuente       = ((props.fuente      as string) ?? "").toLowerCase();
  const url          = (props.url          as string) ?? "";

  const tipoBg    = tipo_op === "arriendo" ? "#E7F4EC" : "#FCE8EA";
  const tipoColor = tipo_op === "arriendo" ? "#0F8A4F" : "#CE1126";
  const tipoBadge = `<span style="background:${tipoBg};color:${tipoColor};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.05em;">${tipo_op.toUpperCase()}</span>`;
  const inmBadge     = tipo_inmueble
    ? `<span style="background:rgba(26,18,8,.07);color:#5B5F5C;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:capitalize;">${tipo_inmueble}</span>`
    : "";

  const specs = [
    area_m2      ? `📐 ${area_m2}m²`        : null,
    habitaciones ? `🛏️ ${habitaciones}hab`  : null,
    banos        ? `🚿 ${banos}baños`        : null,
  ].filter(Boolean).join("&nbsp;&nbsp;");

  let badgeHTML = "";
  if (tipo_op === "venta" && precio_m2 && mediana && mediana > 0) {
    const diff = (precio_m2 - mediana) / mediana * 100;
    if (diff < -10)
      badgeHTML = `<div style="margin-top:8px;"><div style="color:#0A5C36;font-weight:700;font-size:12px;">🟢 BUENA OFERTA</div><div style="color:#6E726E;font-size:11px;">${Math.abs(diff).toFixed(0)}% bajo la mediana del barrio</div></div>`;
    else if (diff > 15)
      badgeHTML = `<div style="margin-top:8px;"><div style="color:#CE1126;font-weight:700;font-size:12px;">🔴 SOBRE PRECIO</div><div style="color:#6E726E;font-size:11px;">${diff.toFixed(0)}% sobre la mediana</div></div>`;
    else
      badgeHTML = `<div style="margin-top:8px;"><div style="color:#6E726E;font-weight:700;font-size:12px;">⚪ PRECIO JUSTO</div><div style="color:#6E726E;font-size:11px;">Dentro del rango del barrio</div></div>`;
  }

  let yieldHTML = "";
  if (tipo_op === "venta" && precio_cop && barrio?.mercado?.arriendo_p50_cop) {
    const y = barrio.mercado.arriendo_p50_cop * 12 / precio_cop * 100;
    if (y > 0 && y < 30)
      yieldHTML = `<div style="color:#6E726E;font-size:11px;">Yield estimado: <strong style="color:#111418;">${y.toFixed(1)}%</strong></div>`;
  }

  let scoreHTML = "";
  if (barrio?.scores?.score_activo != null) {
    const s = barrio.scores.score_activo;
    scoreHTML = `<div style="color:#6E726E;font-size:11px;">Score zona: <strong style="color:#0F8A4F;">${s}</strong> · ${_scoreLabel(s)}</div>`;
  }

  const sourceMap: Record<string, string> = {
    fincaraiz:      "Ver en Fincaraíz →",
    metrocuadrado:  "Ver en Metrocuadrado →",
    medellinliving: "Ver en MedellinLiving →",
  };
  const sourceLabel = sourceMap[fuente] ?? "Ver listado →";
  const waText  = encodeURIComponent(
    `Hola, estoy interesado en una propiedad en ${barrio_nombre} de ${precio_cop ? _fmtCOP(precio_cop) : "—"} COP. ¿Pueden ayudarme?`
  );
  const waUrl   = `https://wa.me/+573122502394?text=${waText}`;
  const btnBase = `cursor:pointer;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;border:1px solid;`;
  const btnSrc  = url
    ? `<button onclick="window.open('${url.replace(/'/g,"\\'")}','_blank')" style="${btnBase}background:transparent;border-color:#E5E0D5;color:#5B5F5C;">${sourceLabel}</button>`
    : "";
  const btnWa   = `<button onclick="window.open('${waUrl}','_blank')" style="${btnBase}background:#0A5C36;border-color:#0A5C36;color:#FFFFFF;">Agente 💬</button>`;

  return `
<div style="font-family:system-ui,sans-serif;min-width:220px;max-width:290px;color:#111418;">
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">${tipoBadge}${inmBadge}</div>
  <div data-i18n-skip style="color:#6E726E;font-size:11px;margin-bottom:8px;">${barrio_nombre}</div>
  ${precio_cop  ? `<div style="font-size:18px;font-weight:700;color:#111418;">${_fmtCOP(precio_cop)} COP</div>` : ""}
  ${precio_usd  ? `<div style="color:#6E726E;font-size:11px;margin-bottom:6px;">~${precio_usd >= 1000000 ? `$${(precio_usd/1000000).toFixed(1)}M` : `$${Math.round(precio_usd/1000)}k`} USD</div>` : ""}
  ${specs       ? `<div style="font-size:12px;color:#5B5F5C;margin:6px 0;">${specs}</div>` : ""}
  ${precio_m2 && tipo_op === "venta" ? `<div style="font-size:11px;color:#6E726E;">Precio/m²: <strong style="color:#111418;">${_fmtM2(precio_m2)}</strong></div>` : ""}
  ${mediana && tipo_op === "venta" ? `<div style="font-size:11px;color:#6E726E;">Mediana zona: <strong style="color:#111418;">${_fmtM2(mediana)}</strong></div>` : ""}
  ${badgeHTML}
  ${yieldHTML || scoreHTML ? `<div style="margin-top:6px;">${yieldHTML}${scoreHTML}</div>` : ""}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${btnSrc}${btnWa}</div>
</div>`;
}

export function MapView({
  onSelect,
  selectedId,
  perfil,
  risk,
  mostrarOportunidades = false,
  budgetRange,
  onViewLevelChange,
  returnToComunasRef,
  onGoToMLS,
  mapView = "zonas",
  mlsBarrioId,
  mlsTipoOp,
  mlsPrecioMin,
  mlsPrecioMax,
  mlsAmoblado,
  mlsCdComuna,
  mlsMunicipio,
  mlsFilters,
  onViewportListingsChange,
  onViewportLoadingChange,
  onAutoSelectBarrio,
  onAutoSelectComuna,
  highlightedListingId,
  flyToListingRef,
  onListingClickFromMap,
  onListingDoubleClickFromMap,
  activeBarrioName,
  activeTab,
  onBarrioClick,
  flyToBarriosRef,
  cooperativeGestures = false,
  bottomInset = 0,
  pitch,
  bearing,
  fitValle = false,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapLoadedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const isMobile = useIsMobile();
  const [legendOpen, setLegendOpen] = useState(false);
  const [showVolverValle, setShowVolverValle] = useState(false);  // /map: botón "Volver al Valle" al drillear
  const staticFeaturesRef = useRef<GeoJSON.Feature[] | null>(null);
  // In-flight guard: mapLoaded + comunasMetrics can both change on initial
  // load, firing the effect below twice before the first fetch resolves and
  // sets staticFeaturesRef — without this, every comunas_*.geojson (up to
  // ~1.1MB each) was fetched twice.
  const staticFeaturesPromiseRef = useRef<Promise<GeoJSON.Feature[]> | null>(null);
  const barriosRef = useRef<ApiBarrio[]>([]);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const mlsLastFlyToRef = useRef<number | null>(null);
  const zoneFlyRef = useRef<string | null>(null);  // last comuna/municipio flown-to
  const lastAutoBarrioRef = useRef<number | null>(null);  // camera-auto-selected barrio
  const lastAutoComunaRef = useRef<string | null>(null);  // camera-auto-selected comuna/muni key
  const flattenSkipRef = useRef(false);  // skip listings-toggle pitch easeTo when a zone fit drives it
  const pendingFlyRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);  // deep-link flyTo que llegó antes del "load" del mapa
  const lastViewportQueryRef = useRef("");  // dedup identical viewport fetches
  const pulseRafRef = useRef<number | null>(null);  // animación de pulso de markers Pro
  const tokenError = !MAPBOX_TOKEN || MAPBOX_TOKEN.includes("REPLACE_ME");
  const isMobileRef = useRef(typeof window !== "undefined" && window.innerWidth < 768);

  // Nivel de vista actual — ref para acceso dentro de closures de Mapbox
  const viewLevelRef = useRef<"comunas" | "barrios">("comunas");
  const activeComunaRef = useRef<{ cd: number; nombre: string; municipioFilter?: string | null } | null>(null);
  const selectedComunaIdRef = useRef<number | null>(null);  // comuna con contorno resaltado (nivel barrio)
  const lastComunaBoundsRef = useRef<mapboxgl.LngLatBounds | null>(null);  // última comuna clickeada — flyToBarrios entra ahí, no al centro fijo de la ciudad
  const enteringBarriosRef = useRef(false);  // true mientras el fitBounds propio de entrar a nivel barrio está animando — evita que su propio zoomend dispare el auto-revert

  // Refs estables para callbacks (evita stale closures)
  const onViewLevelChangeRef = useRef(onViewLevelChange);
  useEffect(() => { onViewLevelChangeRef.current = onViewLevelChange; }, [onViewLevelChange]);

  const onGoToMLSRef = useRef(onGoToMLS);
  useEffect(() => { onGoToMLSRef.current = onGoToMLS; }, [onGoToMLS]);

  const onListingClickFromMapRef = useRef(onListingClickFromMap);
  useEffect(() => { onListingClickFromMapRef.current = onListingClickFromMap; }, [onListingClickFromMap]);
  const onListingDoubleClickFromMapRef = useRef(onListingDoubleClickFromMap);
  useEffect(() => { onListingDoubleClickFromMapRef.current = onListingDoubleClickFromMap; }, [onListingDoubleClickFromMap]);
  const onViewportListingsChangeRef = useRef(onViewportListingsChange);
  useEffect(() => { onViewportListingsChangeRef.current = onViewportListingsChange; }, [onViewportListingsChange]);
  const onViewportLoadingChangeRef = useRef(onViewportLoadingChange);
  useEffect(() => { onViewportLoadingChangeRef.current = onViewportLoadingChange; }, [onViewportLoadingChange]);
  const onAutoSelectBarrioRef = useRef(onAutoSelectBarrio);
  useEffect(() => { onAutoSelectBarrioRef.current = onAutoSelectBarrio; }, [onAutoSelectBarrio]);
  const onAutoSelectComunaRef = useRef(onAutoSelectComuna);
  useEffect(() => { onAutoSelectComunaRef.current = onAutoSelectComuna; }, [onAutoSelectComuna]);
  const onBarrioClickRef = useRef(onBarrioClick);
  useEffect(() => { onBarrioClickRef.current = onBarrioClick; }, [onBarrioClick]);
  const bottomInsetRef = useRef(bottomInset);
  useEffect(() => { bottomInsetRef.current = bottomInset; }, [bottomInset]);
  const pitchRef = useRef(pitch);
  useEffect(() => { pitchRef.current = pitch; }, [pitch]);
  const bearingRef = useRef(bearing);
  useEffect(() => { bearingRef.current = bearing; }, [bearing]);
  const fitValleRef = useRef(fitValle);
  useEffect(() => { fitValleRef.current = fitValle; }, [fitValle]);


  const riskRef = useRef(risk);
  const [scorePalette, setScorePalette] = useState<ScorePaletteId>(() => getActivePaletteId(risk));
  const [thresholdVersion, setThresholdVersion] = useState(0);

  useEffect(() => {
    const onPalette = () => setScorePalette(getActivePaletteId(riskRef.current));
    const onThresholds = () => setThresholdVersion((v) => v + 1);
    window.addEventListener(PALETTE_EVENT, onPalette);
    window.addEventListener(THRESHOLDS_EVENT, onThresholds);
    return () => {
      window.removeEventListener(PALETTE_EVENT, onPalette);
      window.removeEventListener(THRESHOLDS_EVENT, onThresholds);
    };
  }, []);

  const { data: thresholdsData } = useScoreThresholds();
  useEffect(() => {
    if (thresholdsData) setScoreThresholds(thresholdsData);
  }, [thresholdsData]);

  const { data: barriosRaw } = useBarriosRaw(perfil);

  useEffect(() => {
    if (barriosRaw?.length) barriosRef.current = barriosRaw;
  }, [barriosRaw]);

  const { data: comunasMetrics } = useComunasMetrics(perfil);

  // ── Helpers de navegación ────────────────────────────────────────────────────

  function switchToComunas(map: MapboxMap, speed = 0.9) {
    map.setLayoutProperty("comunas-fill",  "visibility", "visible");
    map.setLayoutProperty("comunas-line",  "visibility", "visible");
    map.setLayoutProperty("comunas-label", "visibility", "visible");
    // Idempotente: oculta también los polígonos de barrio, sin importar quién
    // llame esto (toggle de mapView, botón volver, o el auto-revert por zoom-out).
    for (const id of ["barrios-mls-fill", "barrios-mls-line", "barrios-mls-label"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    }
    if (fitValleRef.current) {
      map.fitBounds(heroFit().bounds, { padding: 28, pitch: 0, bearing: 0, speed });
    } else {
      map.flyTo({
        center: [-75.5812, 6.2442], zoom: 11.5,
        pitch: pitchRef.current ?? (isMobileRef.current ? 0 : 35),
        bearing: bearingRef.current ?? (isMobileRef.current ? 0 : -10),
        speed,
      });
    }
    viewLevelRef.current = "comunas";
    activeComunaRef.current = null;
    if (selectedComunaIdRef.current != null) {
      map.setFeatureState({ source: "comunas", id: selectedComunaIdRef.current }, { selected: false });
      selectedComunaIdRef.current = null;
    }
    lastComunaBoundsRef.current = null;
    onViewLevelChangeRef.current?.("comunas", null);
  }

  function switchToBarrios(
    map: MapboxMap,
    cd: number,
    nombre: string,
    bounds: mapboxgl.LngLatBounds,
    municipioFilter?: string | null,
    skipFit = false,
  ) {
    // Fit the WHOLE zone in cluster tier (maxZoom < POLYGON_TIER_ZOOM) so the camera
    // derives the comuna/municipio (not a single barrio) and shows it all.
    // pitch/bearing 0 in the SAME move: the initial view is 3D-tilted and the first
    // click would otherwise race the listings flatten-easeTo → off-center.
    flattenSkipRef.current = true;   // this fitBounds already flattens — don't let the toggle race it
    map.setTerrain(null);
    enteringBarriosRef.current = true;
    setTimeout(() => { enteringBarriosRef.current = false; }, 600);
    // skipFit: el usuario YA está haciendo zoom hacia la comuna (drill por zoom en
    // vista zonas) — no re-encuadrar (lo sacaría de su zoom); solo aplanar el pitch.
    if (skipFit) {
      if (map.getPitch() !== 0 || map.getBearing() !== 0) {
        map.easeTo({ pitch: 0, bearing: 0, duration: 200 });
      }
    } else {
      map.fitBounds(bounds, {
        padding: { top: 40, bottom: 40 + bottomInsetRef.current, left: 40, right: 40 },
        maxZoom: POLYGON_TIER_ZOOM - 1, pitch: 0, bearing: 0, duration: 450,
      });
    }
    viewLevelRef.current = "barrios";
    activeComunaRef.current = { cd, nombre, municipioFilter };
    onViewLevelChangeRef.current?.("barrios", nombre, municipioFilter ?? null, municipioFilter ? null : cd);
  }

  // Exponer goToComunas al padre via ref
  useEffect(() => {
    if (!returnToComunasRef) return;
    returnToComunasRef.current = (speed) => {
      const map = mapRef.current;
      if (map && mapLoadedRef.current) switchToComunas(map, speed);
    };
  });

  // Exponer flyToBarrios al padre via ref
  useEffect(() => {
    if (!flyToBarriosRef) return;
    flyToBarriosRef.current = () => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;

      // Poblar source con polígonos de barrio (normalmente solo se hace en mapView=listings)
      const src = map.getSource("barrios-mls") as mapboxgl.GeoJSONSource | undefined;
      if (src) {
        const feats = barriosRef.current
          .filter((b) => b.geometry && b.barrio_id < _REAL_ID_MAX)
          .map((b) => ({
            type: "Feature" as const,
            id: b.barrio_id,
            geometry: b.geometry as GeoJSON.Geometry,
            properties: { barrio_id: b.barrio_id, nombre: b.nombre ?? "", cd_comuna: b.cd_comuna ?? null },
          }));
        src.setData({ type: "FeatureCollection", features: feats } as GeoJSON.FeatureCollection);
      }

      // Mostrar capas de barrio, ocultar fill de comunas
      const setVis = (id: string, v: "visible" | "none") => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
      };
      setVis("barrios-mls-fill", "visible");
      setVis("barrios-mls-line", "visible");
      setVis("barrios-mls-label", "visible");
      setVis("comunas-fill", "none");
      setVis("comunas-label", "none");

      // Entra a la comuna ya clickeada (si hay una) — antes volaba siempre al
      // centro fijo de la ciudad, ignorando cuál comuna se había elegido.
      enteringBarriosRef.current = true;
      setTimeout(() => { enteringBarriosRef.current = false; }, 950);
      const bounds = lastComunaBoundsRef.current;
      if (bounds) {
        map.fitBounds(bounds, {
          padding: { top: 40, bottom: 40 + bottomInsetRef.current, left: 40, right: 40 },
          maxZoom: POLYGON_TIER_ZOOM - 1, duration: 800,
        });
      } else {
        map.flyTo({ center: [-75.5812, 6.2442], zoom: POLYGON_TIER_ZOOM + 0.5, duration: 800 });
      }
    };
  });

  // ── Inicialización del mapa ──────────────────────────────────────────────────

  useEffect(() => {
    if (tokenError || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const styleId = auth.get()?.mapStyle ?? "monochrome";
    const isMobile = window.innerWidth < 768;
    isMobileRef.current = isMobile;
    const initPitch = pitchRef.current ?? (isMobile ? 0 : 35);
    const initBearing = bearingRef.current ?? (isMobile ? 0 : -10);
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLES[styleId]?.url ?? "mapbox://styles/mapbox/streets-v12",
      // fitValle (home hero): fitBounds 10 municipios Valle de Aburrá, plano y simétrico → el
      // valle queda centrado. El
      // container ya NO usa min-h-screen, así fitBounds mide la caja real y no
      // recorta el sur. Se re-encuadra en 'load' con el tamaño ya asentado.
      ...(fitValleRef.current
        ? {
            bounds: heroFit().bounds,
            fitBoundsOptions: { padding: 28, pitch: 0, bearing: 0 },
          }
        : { center: [-75.5812, 6.2442] as [number, number], zoom: 10 }),
      minZoom: fitValleRef.current ? 10 : 11,
      // Box de paneo. Hero (fitValle): pegado al fit del valle CENTRAL → la vista
      // encuadrada va ~[-75.677,-75.513]×[6.161,6.307]; el box queda justo por
      // fuera → casi sin paneo (cuadro chico), pero el zoom-in sigue libre.
      // /map: box al Valle + margen chico → no te alejas a las montañas del este.
      maxBounds: fitValleRef.current
        ? heroFit().maxBounds
        : [[-75.71, 6.07], [-75.46, 6.42]],
      pitch: initPitch,
      bearing: initBearing,
      antialias: true,
      cooperativeGestures,
      // Atribución la re-agregamos abajo en modo compacto (ver addControl).
      attributionControl: false,
    });
    mapRef.current = map;

    if (isMobile) {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
    }

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");
    // Atribución compacta: solo una ⓘ que expande al tocar (colapsa "OpenStreetMap ·
    // Improve this map"). Mapbox/OSM exigen mostrarla — compact es el mínimo permitido.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current!);
    requestAnimationFrame(() => map.resize());

    map.on("load", () => {
      map.resize();
      // Re-encuadra con el tamaño REAL del contenedor (el fitBounds del
      // constructor corre antes de que el layout flex asiente → recorta el sur).
      if (fitValleRef.current) {
        map.fitBounds(VALLE_BOUNDS, { padding: 28, pitch: 0, bearing: 0, animate: false });
      }
      mapLoadedRef.current = true;
      setMapLoaded(true);

      // Flush de un flyTo deep-link que llegó antes del load (ver flyToListingRef).
      if (pendingFlyRef.current) {
        const { lat, lng, zoom } = pendingFlyRef.current;
        pendingFlyRef.current = null;
        flattenSkipRef.current = true;
        map.flyTo({ center: [lng, lat], zoom, pitch: 0, speed: 0.9 });
      }

      // Señal al padre: mapa cargado. El deep-link de comuna espera esto para
      // seleccionar la zona como un click real (efectos gated por mapLoaded ya
      // re-corren tras el re-render). onReady corre después de agregar las capas
      // (mismo callback) porque React aplica el setState tras retornar de aquí.
      onReady?.();

      // ── Limpiar POIs del mapa base ────────────────────────────────────────
      const baseStyle = map.getStyle();
      if (baseStyle?.layers) {
        for (const layer of baseStyle.layers) {
          const srcLayer = (layer as Record<string, unknown>)["source-layer"] as string | undefined;
          if (layer.type === "symbol") {
            const layout = (layer as mapboxgl.SymbolLayer).layout;
            const lid = layer.id.toLowerCase();
            const hide =
              (layout && "icon-image" in layout) ||
              lid.includes("road") ||
              lid.includes("street") ||
              lid.includes("transit") ||
              lid.includes("poi") ||
              lid.includes("airport") ||
              lid.includes("ferry") ||
              // "settlement-major/minor/subdivision-label" (place_label source-layer)
              // duplicate our own comuna/barrio name overlay — e.g. base map's
              // "Bello" sits under our "BELLO" comuna label.
              lid.includes("settlement");
            if (hide) map.setLayoutProperty(layer.id, "visibility", "none");
          }
          if (layer.type === "background") {
            map.setPaintProperty(layer.id, "background-color", "#FAF8F3");
          }
          if (layer.type === "fill" && srcLayer === "water") {
            map.setPaintProperty(layer.id, "fill-color", "#C9D6EE");
          }
          if (layer.type === "line" && srcLayer === "waterway") {
            map.setPaintProperty(layer.id, "line-color", "#C9D6EE");
          }
          if (layer.type === "fill" && srcLayer === "building") {
            map.setPaintProperty(layer.id, "fill-color", "#F3F0E8");
            map.setPaintProperty(layer.id, "fill-opacity", 0.45);
          }
        }
      }

      // ── CAPA 1: Comunas (vista inicial) ───────────────────────────────────
      map.addSource("comunas", { type: "geojson", data: EMPTY_FC });
      // Fuente de puntos aparte para el label: un símbolo por polígono grande
      // (como una comuna) se repite una vez por cada tile interno que genera
      // el source GeoJSON al hacer zoom si el label lee del mismo source que
      // el fill — de ahí el nombre duplicado al acercar. Un Point centrado
      // (turf.pointOnFeature, cae dentro del polígono) vive en un solo tile
      // siempre, sin importar el zoom.
      map.addSource("comunas-labels", { type: "geojson", data: EMPTY_FC });

      map.addLayer({
        id: "comunas-fill",
        type: "fill",
        source: "comunas",
        paint: {
          "fill-color": "#DAB33C",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false], 0.45,
            0.25,
          ],
        },
      });

      map.addLayer({
        id: "comunas-line",
        type: "line",
        source: "comunas",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#CE1126", "#003893"],
          "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.95, 0.6],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3.5, 2],
        },
      });

      map.addLayer({
        id: "comunas-label",
        type: "symbol",
        source: "comunas-labels",
        layout: {
          "text-field": ["get", "nombre"],
          "text-size": isMobile ? 10 : 13,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-letter-spacing": 0.08,
          "text-transform": "uppercase",
          // Sin offset por defecto (vista zonas/home): en municipios chicos y
          // pegados (Sabaneta/Itagüí) un offset grande empuja el nombre fuera
          // de su polígono y cae sobre el vecino. El toggle de mapView sube el
          // offset solo en vista listings, donde hay que esquivar la burbuja
          // con el número de conteo en la misma coordenada.
          "text-anchor": "center",
          "text-offset": [0, 0],
        },
        paint: {
          "text-color": "#111418",
          "text-halo-color": "#FAF8F3",
          "text-halo-width": 2,
        },
      });

      // ── Hover: Comunas ─────────────────────────────────────────────────────
      let hoverComunaId: number | null = null;
      const comunaPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: "urbi-dark-tip" });

      map.on("mousemove", "comunas-fill", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const id = f.id as number;
        if (hoverComunaId !== null && hoverComunaId !== id) {
          map.setFeatureState({ source: "comunas", id: hoverComunaId }, { hover: false });
        }
        hoverComunaId = id;
        map.setFeatureState({ source: "comunas", id }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
        const nombre = f.properties?.nombre ?? "";
        comunaPopup
          .setLngLat(e.lngLat)
          .setHTML(`<span data-i18n-skip>${nombre}</span>`)
          .addTo(map);
      });

      map.on("mouseleave", "comunas-fill", () => {
        if (hoverComunaId !== null) {
          map.setFeatureState({ source: "comunas", id: hoverComunaId }, { hover: false });
        }
        hoverComunaId = null;
        map.getCanvas().style.cursor = "";
        comunaPopup.remove();
      });

      map.on("click", "comunas-fill", (e) => {
        if (!e.features?.length) return;
        // Si el click también cae sobre una burbuja de cluster, cede el paso al handler
        // de "listings-mls-clusters" (zoom hacia el cluster) — ambos listeners disparan
        // sobre el mismo click de mapbox, y la burbuja debe ganar sobre el drill-down.
        if (map.queryRenderedFeatures(e.point, { layers: ["listings-mls-clusters"] }).length) return;
        const f = e.features[0];
        const cd = f.properties?.cd_comuna as number;
        const nombre = (f.properties?.nombre ?? "").toString();
        const isMunicipio = f.properties?.is_municipio === true;
        // queryRenderedFeatures clips geometry to the tile under the cursor → use the
        // full source feature (by nombre) so we fit the WHOLE zone, not a fragment.
        const full = staticFeaturesRef.current?.find((sf) => (sf.properties?.nombre ?? "") === nombre);
        const bounds = featureBounds((full ?? f) as mapboxgl.MapboxGeoJSONFeature);
        // Resalta el contorno de la comuna clickeada — usa f.id (no `cd`, que es
        // undefined en municipios) para calzar con la key que usa el hover arriba.
        const featureId = f.id as number;
        if (selectedComunaIdRef.current != null && selectedComunaIdRef.current !== featureId) {
          map.setFeatureState({ source: "comunas", id: selectedComunaIdRef.current }, { selected: false });
        }
        map.setFeatureState({ source: "comunas", id: featureId }, { selected: true });
        selectedComunaIdRef.current = featureId;
        lastComunaBoundsRef.current = bounds;
        switchToBarrios(map, cd, nombre, bounds, isMunicipio ? nombre : null);
      });

      // ── CAPA BARRIOS (FIX 1c): polígonos de barrio, tier alto (zoom >= 13) ───
      map.addSource("barrios-mls", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "barrios-mls-fill",
        type: "fill",
        source: "barrios-mls",
        layout: { visibility: "none" },
        paint: {
          // CAMBIO 3: barrio sin relleno (fill-opacity 0, queryable para hit-test);
          // barrio activo = relleno muy tenue. knobs.
          "fill-color": "#003893",
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.10, 0],
        },
      });
      map.addLayer({
        id: "barrios-mls-line",
        type: "line",
        source: "barrios-mls",
        layout: { visibility: "none" },
        paint: {
          // borde fino y suave; activo algo más marcado. knobs.
          "line-color": "#003893",
          "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.7, 0.4],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 1],
        },
      });
      // Etiqueta con el nombre del barrio sobre el polígono (tier alto).
      map.addLayer({
        id: "barrios-mls-label",
        type: "symbol",
        source: "barrios-mls",
        layout: {
          visibility: "none",
          "text-field": ["get", "nombre"],
          "text-size": isMobile ? 9 : 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.05,
        },
        paint: {
          "text-color": "#111418",
          "text-halo-color": "#FAF8F3",
          "text-halo-width": 1.5,
        },
      });
      let hoverBarrioId: number | null = null;
      map.on("mousemove", "barrios-mls-fill", (e) => {
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = "pointer";
        const id = e.features[0].id as number;
        if (hoverBarrioId !== null && hoverBarrioId !== id) {
          map.setFeatureState({ source: "barrios-mls", id: hoverBarrioId }, { hover: false });
        }
        hoverBarrioId = id;
        map.setFeatureState({ source: "barrios-mls", id }, { hover: true });
      });
      map.on("mouseleave", "barrios-mls-fill", () => {
        map.getCanvas().style.cursor = "";
        if (hoverBarrioId !== null) map.setFeatureState({ source: "barrios-mls", id: hoverBarrioId }, { hover: false });
        hoverBarrioId = null;
      });
      // Click en barrio → dirigir el mapa allí (la derivación por cámara lo selecciona).
      map.on("click", "barrios-mls-fill", (e) => {
        if (!e.features?.length) return;
        map.fitBounds(featureBounds(e.features[0]), {
          padding: { top: 60, bottom: 60 + bottomInsetRef.current, left: 60, right: 60 },
          maxZoom: 15, duration: 400,
        });
        const feat = e.features[0];
        const barrioId = typeof feat.id === "number" ? feat.id : Number(feat.id);
        const nombre = (feat.properties?.nombre as string | null) ?? "";
        const cdComunaRaw = feat.properties?.cd_comuna;
        const cdComuna = cdComunaRaw != null ? Number(cdComunaRaw) : null;
        const municipio = activeComunaRef.current?.municipioFilter ?? null;
        if (!isNaN(barrioId) && nombre) {
          const [lat, lng] = featureCentroid(feat);
          onBarrioClickRef.current?.(barrioId, nombre, lat, lng, cdComuna, municipio);
        }
      });

      // ── CAPA MLS: listings del barrio seleccionado (Vista 2) ─────────────────
      // Server-side clustering (FIX 1): cluster:false — clusters/points come
      // pre-aggregated from /listings/viewport. Cluster features carry a `count`.
      map.addSource("listings-mls", {
        type: "geojson",
        data: EMPTY_FC,
      });

      map.addLayer({
        id: "listings-mls-clusters",
        type: "circle",
        source: "listings-mls",
        filter: ["has", "count"],
        layout: { visibility: "none" },
        paint: {
          // Thresholds sized for comuna/municipio-level counts (hundreds to ~20k),
          // not the old per-grid-cell counts (single/double digits).
          "circle-color": ["step", ["get", "count"], "#0F8A4F", 1000, "#0A5C36", 8000, "#111418"],
          "circle-radius": ["step", ["get", "count"], 20, 1000, 30, 8000, 40],
          "circle-opacity": 0.88,
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(29,158,117,0.3)",
        },
      });

      map.addLayer({
        id: "listings-mls-cluster-count",
        type: "symbol",
        source: "listings-mls",
        filter: ["has", "count"],
        layout: {
          visibility: "none",
          "text-field": ["get", "count"],
          "text-size": 12,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        },
        paint: { "text-color": "#ffffff" },
      });

      // Halo de pulso DEBAJO de los markers Pro/agente — animado por rAF (ver abajo).
      // Radio y opacidad se sobreescriben cada frame; estos valores son solo el estado inicial.
      map.addLayer({
        id: "listings-mls-pulse",
        type: "circle",
        source: "listings-mls",
        filter: ["all",
          ["!", ["has", "count"]],
          ["match", ["get", "fuente_display"], ["propio_pro", "agente_verificado"], true, false],
        ],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 12,
          // Filtro ya restringe a destacados (propio_pro/agente_verificado) → dorado fijo.
          "circle-color": "#FCD116",
          "circle-opacity": 0.4,
          "circle-stroke-width": 0,
        },
      });

      map.addLayer({
        id: "listings-mls-unclustered",
        type: "circle",
        source: "listings-mls",
        filter: ["!", ["has", "count"]],
        layout: {
          visibility: "none",
          // z-order: los de pago (Pro/agente) SIEMPRE encima → nunca tapados por otros.
          "circle-sort-key": [
            "case",
            ["==", ["get", "fuente_display"], "agente_verificado"], 2,
            ["==", ["get", "fuente_display"], "propio_pro"],        2,
            0,
          ],
        },
        paint: {
          "circle-radius": [
            "case",
            ["boolean", ["feature-state", "highlighted"], false], 12,
            // Pro / agente verificado → marker más grande (más visible)
            ["==", ["get", "fuente_display"], "agente_verificado"], 11,
            ["==", ["get", "fuente_display"], "propio_pro"],        11,
            8,
          ],
          "circle-color": [
            "case",
            // Destacado (agente verificado / propietario Pro / socio premium) → dorado
            ["match", ["get", "fuente_display"], ["agente_verificado", "propio_pro"], true, false], "#FCD116",
            // Propietario Free → gris cálido
            ["==", ["get", "fuente_display"], "propio"],            "#6E726E",
            // FC/MC → color por tipo de inmueble
            ["==", ["get", "tipo_inmueble"], "apartamento"],        "#0F8A4F",
            ["==", ["get", "tipo_inmueble"], "casa"],               "#CE1126",
            ["==", ["get", "tipo_inmueble"], "casa_lote"],          "#CE1126",
            ["==", ["get", "tipo_inmueble"], "finca"],              "#CE1126",
            ["==", ["get", "tipo_inmueble"], "apartaestudio"],      "#C2410C",
            ["==", ["get", "tipo_inmueble"], "lote"],               "#8A6A00",
            ["==", ["get", "tipo_inmueble"], "local"],              "#1F5BC6",
            ["==", ["get", "tipo_inmueble"], "oficina"],            "#6D4AA8",
            ["==", ["get", "tipo_inmueble"], "bodega"],             "#6E726E",
            ["==", ["get", "tipo_inmueble"], "consultorio"],        "#6E726E",
            "#0F8A4F",
          ],
          "circle-stroke-width": [
            "case",
            ["boolean", ["feature-state", "highlighted"], false], 3,
            2,
          ],
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });

      // Click en burbuja de cluster → siempre acercar zoom hacia ese punto (funciona
      // igual en desktop y móvil, donde el tap se traduce a "click"). El drill-down a
      // comuna/municipio queda a cargo del click directo sobre "comunas-fill" (abajo),
      // que solo se dispara cuando el click no cae sobre una burbuja.
      map.on("click", "listings-mls-clusters", (e) => {
        if (!e.features?.length) return;
        const center = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center, zoom: Math.min(map.getZoom() + 2, 16) });
      });

      // Click en punto individual → mini popup (debounced to distinguish dblclick)
      let _pendingClick: ReturnType<typeof setTimeout> | null = null;
      map.on("click", "listings-mls-unclustered", (e) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties as Record<string, unknown>;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
        while (Math.abs(e.lngLat.lng - coords[0]) > 180) {
          coords[0] += e.lngLat.lng > coords[0] ? 360 : -360;
        }
        const point = map.project(coords);
        if (_pendingClick !== null) return;
        _pendingClick = setTimeout(() => {
          _pendingClick = null;
          onListingClickFromMapRef.current?.(props.id as number, point.x, point.y);
        }, 220);
      });

      // Doble click en punto → abrir drawer directo
      map.on("dblclick", "listings-mls-unclustered", (e) => {
        e.preventDefault();
        if (_pendingClick !== null) { clearTimeout(_pendingClick); _pendingClick = null; }
        if (!e.features?.length) return;
        const props = e.features[0].properties as Record<string, unknown>;
        onListingDoubleClickFromMapRef.current?.(props.id as number);
      });

      map.on("mouseenter", "listings-mls-clusters",    () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "listings-mls-clusters",    () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "listings-mls-unclustered", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "listings-mls-unclustered", () => { map.getCanvas().style.cursor = ""; });

      // Source starts empty — useEffect([comunasMetrics]) loads static GeoJSON + enriches with API metrics.

      // ── Terreno 3D ────────────────────────────────────────────────────────────
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
      map.setFog({
        color: "#FAF8F3",
        "high-color": "#d4c9b8",
        "horizon-blend": 0.08,
        "space-color": "#FAF8F3",
        "star-intensity": 0,
      });

      // Pulso de markers Pro/agente: halo que crece y se desvanece en loop (~1.4s).
      // Solo animamos cuando la capa está visible (tier de puntos) para no gastar frames.
      const PULSE_MS = 1400;
      const animatePulse = (ts: number) => {
        pulseRafRef.current = requestAnimationFrame(animatePulse);
        if (!map.getLayer("listings-mls-pulse")) return;
        if (map.getLayoutProperty("listings-mls-pulse", "visibility") === "none") return;
        const t = (ts % PULSE_MS) / PULSE_MS;            // 0 → 1
        map.setPaintProperty("listings-mls-pulse", "circle-radius", 10 + 22 * t);
        map.setPaintProperty("listings-mls-pulse", "circle-opacity", 0.45 * (1 - t));
      };
      pulseRafRef.current = requestAnimationFrame(animatePulse);
    });

    return () => {
      ro.disconnect();
      if (pulseRafRef.current !== null) cancelAnimationFrame(pulseRafRef.current);
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Poblar capa comunas: geometría oficial estática + métricas de la API ──────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const source = map.getSource("comunas") as mapboxgl.GeoJSONSource | undefined;
    const labelSource = map.getSource("comunas-labels") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const enrichAndRender = (features: GeoJSON.Feature[]) => {
      const enriched = features.map((feat) => {
        const cd = feat.properties?.cd_comuna as number | null;
        const m: ComunaMetrics | undefined = cd != null ? comunasMetrics?.[String(cd)] : undefined;
        return {
          ...feat,
          id: cd ?? feat.id,
          properties: m
            ? { ...feat.properties, ...m }
            : { ...feat.properties, has_data: false },
        };
      });
      source.setData({ type: "FeatureCollection", features: enriched } as GeoJSON.FeatureCollection);
      if (labelSource) {
        const labelPoints = features.map((feat) => ({
          type: "Feature" as const,
          id: (feat.properties?.cd_comuna as number | null) ?? feat.id,
          geometry: pointOnFeature(feat as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>).geometry,
          properties: { nombre: (feat.properties?.nombre as string) ?? "" },
        }));
        labelSource.setData({ type: "FeatureCollection", features: labelPoints } as GeoJSON.FeatureCollection);
      }
    };

    if (staticFeaturesRef.current) {
      enrichAndRender(staticFeaturesRef.current);
      return;
    }

    // Primera carga — fetch archivos GeoJSON estáticos oficiales. Reuse an
    // in-flight fetch instead of starting a second one (see promise ref above).
    if (!staticFeaturesPromiseRef.current) {
      const staticFiles = [
        "/data/comunas_medellin.geojson",
        ...Object.values(MUNICIPIO_STATIC),
      ];
      staticFeaturesPromiseRef.current = Promise.all(
        staticFiles.map((f) =>
          fetch(f).then((r) => r.json()).catch(() => ({ type: "FeatureCollection", features: [] }))
        )
      ).then((results: { features: GeoJSON.Feature[] }[]) => {
        const features = results.flatMap((fc) => (fc.features ?? []) as GeoJSON.Feature[]);
        staticFeaturesRef.current = features;
        return features;
      });
    }
    staticFeaturesPromiseRef.current.then(enrichAndRender);
  }, [comunasMetrics, mapLoaded]);

  // ── Vista 1 ↔ Vista 2: toggle capas (solo depende de mapView) ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const mlsLayers = ["listings-mls-clusters", "listings-mls-cluster-count", "listings-mls-pulse", "listings-mls-unclustered"] as const;

    if (mapView === "listings") {
      // Polygons stay as context — the polygon-tier effect (FIX 1c) toggles
      // comuna vs barrio by zoom. Just show the listing dots here.
      for (const id of mlsLayers) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
      }
      // Vista listings muestra la burbuja de conteo en la misma coordenada del
      // polígono → sube el nombre sobre la burbuja para que no se tapen.
      if (map.getLayer("comunas-label")) {
        map.setLayoutProperty("comunas-label", "text-anchor", "bottom");
        map.setLayoutProperty("comunas-label", "text-offset", [0, -2.4]);
      }
      map.setTerrain(null);
      // Skip the flatten easeTo when a zone fitBounds is already driving the camera
      // (it would interrupt the fit mid-flight → zone ends off-center).
      if (flattenSkipRef.current) flattenSkipRef.current = false;
      else map.easeTo({ pitch: 0, duration: 500 });
    } else {
      // Vista 1: ocultar MLS layers + barrio polygons, volver a comunas
      flattenSkipRef.current = false;  // no dejar un skip colgado de un flyTo en listings
      mlsLastFlyToRef.current = null;
      for (const id of [...mlsLayers, "barrios-mls-fill", "barrios-mls-line", "barrios-mls-label"]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      }
      (map.getSource("listings-mls") as mapboxgl.GeoJSONSource)?.setData(EMPTY_FC);
      if (map.getLayer("comunas-label")) {
        map.setLayoutProperty("comunas-label", "text-anchor", "center");
        map.setLayoutProperty("comunas-label", "text-offset", [0, 0]);
      }
      // restore comuna line (tier may have made it tenue)
      if (map.getLayer("comunas-line")) {
        map.setPaintProperty("comunas-line", "line-width", 2);
        map.setPaintProperty("comunas-line", "line-opacity", 0.6);
      }
      if (map.getSource("mapbox-dem")) {
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
      }
      switchToComunas(map);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapView]);

  // ── Vista 1 (zonas): zoom-out en nivel barrio vuelve a comunas ──────────────
  // El toggle de arriba solo corre al cambiar `mapView` (una vez, en Home nunca
  // cambia) — sin esto, una vez entrado a barrios (flyToBarriosRef o el click
  // directo en una comuna) no había manera de volver: el zoom-out no hacía nada.
  const RETURN_TO_COMUNAS_ZOOM = 11.8;
  const VOLVER_VALLE_ZOOM = 12.5;  // drilleado más allá del overview de comuna → ofrece volver al valle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || mapView !== "zonas") return;
    const onZoomEnd = () => {
      const z = map.getZoom();
      if (
        viewLevelRef.current === "barrios" &&
        !enteringBarriosRef.current &&
        z < RETURN_TO_COMUNAS_ZOOM
      ) {
        switchToComunas(map);
      } else if (
        // Drill por zoom: acercarse a una comuna en vista zonas = entrar a ella
        // (igual que el clic) → vista listings + polígonos de barrio al pasar a
        // BARRIO_TIER_ZOOM. Sin esto, hacer zoom en zonas nunca mostraba barrios.
        viewLevelRef.current === "comunas" &&
        !enteringBarriosRef.current &&
        z >= POLYGON_TIER_ZOOM
      ) {
        const c = map.project(map.getCenter());
        const feats = map.queryRenderedFeatures([c.x, c.y], { layers: ["comunas-fill"] });
        if (feats.length) {
          const f = feats[0];
          const isMuni = f.properties?.is_municipio === true;
          const cd = isMuni ? null : (f.properties?.cd_comuna as number);
          const nombre = (f.properties?.nombre ?? "").toString();
          // queryRenderedFeatures recorta la geometría al tile bajo el centro → usa el
          // feature completo (por nombre) para encuadrar/estado toda la zona.
          const full = staticFeaturesRef.current?.find((sf) => (sf.properties?.nombre ?? "") === nombre);
          const bounds = featureBounds((full ?? f) as mapboxgl.MapboxGeoJSONFeature);
          const featureId = f.id as number;
          if (selectedComunaIdRef.current != null && selectedComunaIdRef.current !== featureId) {
            map.setFeatureState({ source: "comunas", id: selectedComunaIdRef.current }, { selected: false });
          }
          map.setFeatureState({ source: "comunas", id: featureId }, { selected: true });
          selectedComunaIdRef.current = featureId;
          lastComunaBoundsRef.current = bounds;
          switchToBarrios(map, cd as number, nombre, bounds, isMuni ? nombre : null, true);
        }
      }
      setShowVolverValle(z > VOLVER_VALLE_ZOOM);
    };
    map.on("zoomend", onZoomEnd);
    return () => { map.off("zoomend", onZoomEnd); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapView, mapLoaded]);

  // ── Vista 2: actualizar datos GeoJSON cuando llegan listings ────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || mapView !== "listings") return;

    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const loadViewport = async () => {
      const b = map.getBounds();
      if (!b) return;
      const params = new URLSearchParams({
        min_lng: String(b.getWest()),
        min_lat: String(b.getSouth()),
        max_lng: String(b.getEast()),
        max_lat: String(b.getNorth()),
        zoom: String(Math.round(map.getZoom())),
      });
      if (mlsTipoOp) params.set("tipo_operacion", mlsTipoOp);
      if (mlsPrecioMin != null) params.set("precio_min", String(mlsPrecioMin));
      if (mlsPrecioMax != null) params.set("precio_max", String(mlsPrecioMax));
      if (mlsAmoblado != null) params.set("amoblado", String(mlsAmoblado));
      // Geographic selection — backend ignores bbox when a zone is active.
      if (mlsBarrioId != null) params.set("barrio_id", String(mlsBarrioId));
      if (mlsCdComuna != null) params.set("cd_comuna", String(mlsCdComuna));
      if (mlsMunicipio) params.set("municipio", mlsMunicipio);
      // Remaining shared filters — server-side WHERE in /viewport.
      const f = mlsFilters;
      if (f?.habitaciones != null) params.set("habitaciones", String(f.habitaciones));
      if (f?.banos != null) params.set("banos", String(f.banos));
      if (f?.areaMin != null) params.set("area_min", String(f.areaMin));
      if (f?.areaMax != null) params.set("area_max", String(f.areaMax));
      if (f?.estrato?.length) for (const e of f.estrato) params.append("estrato", String(e));
      if (f?.tipoInmueble?.length) for (const t of f.tipoInmueble) params.append("tipo_inmueble", t);
      if (f?.diasMercado) params.set("dias_mercado", f.diasMercado);
      if (f?.busqueda?.trim()) params.set("busqueda", f.busqueda.trim());
      if (f?.amenidades?.length) for (const a of f.amenidades) params.append("amenidades", a);
      if (f?.estadoInmueble) params.set("estado_inmueble", f.estadoInmueble);
      if (f?.pisoMin != null) params.set("piso_min", String(f.pisoMin));
      // Dedup: with a zone active the backend ignores bbox, so panning within the
      // zone returns identical data — skip the refetch (key excludes bbox then).
      // Zoom only matters as clusters-vs-points mode (backend flips at
      // POLYGON_TIER_ZOOM) — a raw zoom number here meant a fly-through
      // animation crossing zoom 11→12→13 fired a fresh fetch at every integer
      // step even though clusters-mode data is identical the whole way, which
      // is what made a single comuna click cascade into 4-7 sequential requests.
      const hasGeo = mlsBarrioId != null || mlsCdComuna != null || !!mlsMunicipio;
      const filterKey = `${f?.habitaciones}|${f?.banos}|${f?.areaMin}|${f?.areaMax}|${f?.estrato?.join(",")}|${f?.tipoInmueble?.join(",")}|${f?.diasMercado}|${f?.busqueda}|${f?.amenidades?.join(",")}|${f?.estadoInmueble}|${f?.pisoMin}`;
      const zoomMode = map.getZoom() >= POLYGON_TIER_ZOOM ? "points" : "clusters";
      const dedupKey = hasGeo
        ? `${zoomMode}|${mlsBarrioId}|${mlsCdComuna}|${mlsMunicipio}|${mlsTipoOp}|${mlsPrecioMin}|${mlsPrecioMax}|${mlsAmoblado}|${filterKey}`
        : params.toString();
      if (dedupKey === lastViewportQueryRef.current) return;
      lastViewportQueryRef.current = dedupKey;
      onViewportLoadingChangeRef.current?.(true);
      try {
        const res = await apiFetch<ViewportResponse>(`${API_ENDPOINTS.allListings}/viewport?${params}`);
        if (cancelled) return;
        const src = map.getSource("listings-mls") as mapboxgl.GeoJSONSource | undefined;
        if (!src) return;
        if (res.mode === "clusters") {
          // CAMBIO 4A: clusters mode also returns a capped panel list → feed the panel.
          onViewportListingsChangeRef.current?.(res.listings ?? []);
          src.setData({
            type: "FeatureCollection",
            features: res.clusters.map((c) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
              properties: { count: c.count, precio_promedio: c.precio_promedio },
            })),
          } as GeoJSON.FeatureCollection);
        } else {
          const pts = res.listings.filter((l) => l.lat != null && l.lon != null);
          onViewportListingsChangeRef.current?.(pts);
          src.setData({
            type: "FeatureCollection",
            features: pts.map((l) => ({
              type: "Feature" as const,
              id: l.id,
              geometry: { type: "Point" as const, coordinates: [l.lon!, l.lat!] },
              properties: {
                id: l.id,
                tipo_op: l.tipo_operacion ?? "venta",
                tipo_inmueble: l.tipo_inmueble ?? "",
                fuente_display: l.fuente_display ?? l.fuente ?? "",
                tier: l.tier ?? "",
              },
            })),
          } as unknown as GeoJSON.FeatureCollection);
        }
      } catch { /* transient fetch error — keep current dots */ }
      // Always clear: guarding on !cancelled could leave the spinner stuck true if
      // a superseded fetch is followed by a dedup early-return. A newer inflight
      // fetch re-sets true anyway.
      finally { onViewportLoadingChangeRef.current?.(false); }
    };

    const onMove = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(loadViewport, 150);
    };

    map.on("moveend", onMove);
    map.on("zoomend", onMove);
    loadViewport();

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      map.off("moveend", onMove);
      map.off("zoomend", onMove);
    };
  // mapLoaded en deps: mismo race que FIX 1c (ver ~l.1336) y el toggle de vista.
  // Deep-link a listings (?cd_comuna/?municipio) pone mapView="listings" en mount,
  // ANTES del evento "load" → este efecto salía por !mapLoadedRef y NO re-corría
  // (mapLoadedRef es ref, no dispara efecto) → loadViewport nunca se llamaba → sin puntos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapView, mapLoaded, mlsBarrioId, mlsCdComuna, mlsMunicipio, mlsTipoOp, mlsPrecioMin, mlsPrecioMax, mlsAmoblado,
      mlsFilters?.habitaciones, mlsFilters?.banos, mlsFilters?.areaMin, mlsFilters?.areaMax,
      mlsFilters?.estrato?.join(","), mlsFilters?.tipoInmueble?.join(","), mlsFilters?.diasMercado, mlsFilters?.busqueda,
      mlsFilters?.amenidades?.join(",")]);

  // ── FIX 1c: polígono tier (comuna↔barrio por zoom) + auto-select por cámara ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || mapView !== "listings") return;

    // Poblar polígonos de barrio desde barriosRaw (ids reales 1-945, con geometry).
    const src = map.getSource("barrios-mls") as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      const feats = (barriosRaw ?? [])
        .filter((b) => b.geometry && b.barrio_id < _REAL_ID_MAX)
        .map((b) => ({
          type: "Feature" as const,
          id: b.barrio_id,
          geometry: b.geometry as GeoJSON.Geometry,
          properties: { barrio_id: b.barrio_id, nombre: b.nombre ?? "", cd_comuna: b.cd_comuna ?? null },
        }));
      src.setData({ type: "FeatureCollection", features: feats } as GeoJSON.FeatureCollection);
    }

    const setVis = (id: string, v: "visible" | "none") => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    };
    const applyTier = () => {
      const hi = map.getZoom() >= BARRIO_TIER_ZOOM;
      setVis("comunas-fill",  hi ? "none" : "visible");
      setVis("comunas-label", hi ? "none" : "visible");
      setVis("comunas-line",  "visible");
      if (map.getLayer("comunas-line")) {
        map.setPaintProperty("comunas-line", "line-width",   hi ? 0.8 : 2);
        map.setPaintProperty("comunas-line", "line-opacity", hi ? 0.35 : 0.6);
      }
      setVis("barrios-mls-fill",  hi ? "visible" : "none");
      setVis("barrios-mls-line",  hi ? "visible" : "none");
      setVis("barrios-mls-label", hi ? "visible" : "none");
    };

    // FIX 1d — free navigation: zone derived from the camera on every move (no
    // lock). zoom<TIER → comuna under center; zoom>=TIER → barrio under center.
    const clearBarrioSel = () => {
      if (lastAutoBarrioRef.current != null) {
        map.setFeatureState({ source: "barrios-mls", id: lastAutoBarrioRef.current }, { selected: false });
        lastAutoBarrioRef.current = null;
      }
    };
    const autoSelect = () => {
      const c = map.project(map.getCenter());
      if (map.getZoom() < BARRIO_TIER_ZOOM) {
        if (lastAutoBarrioRef.current != null) { clearBarrioSel(); onAutoSelectBarrioRef.current?.(null); }
        const cfeats = map.queryRenderedFeatures([c.x, c.y], { layers: ["comunas-fill"] });
        const f = cfeats.length ? cfeats[0].properties : undefined;
        const isMuni = f?.is_municipio === true;
        const cd = isMuni ? null : ((f?.cd_comuna as number) ?? null);
        const muni = isMuni ? ((f?.nombre as string) ?? null) : null;
        const nombre = (f?.nombre as string) ?? null;
        const key = isMuni ? `m:${muni}` : cd != null ? `c:${cd}` : null;
        if (key !== lastAutoComunaRef.current) {
          lastAutoComunaRef.current = key;
          onAutoSelectComunaRef.current?.(cd, muni, nombre);
        }
        return;
      }
      // barrio under center (zoom >= TIER)
      lastAutoComunaRef.current = null;
      const feats = map.queryRenderedFeatures([c.x, c.y], { layers: ["barrios-mls-fill"] });
      const bid = feats.length ? (feats[0].id as number) : null;
      if (bid != null && bid !== lastAutoBarrioRef.current) {
        clearBarrioSel();
        map.setFeatureState({ source: "barrios-mls", id: bid }, { selected: true });
        lastAutoBarrioRef.current = bid;
        onAutoSelectBarrioRef.current?.(bid);
      }
    };

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onMove = () => {
      applyTier();                       // tier visual is immediate
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(autoSelect, 180);   // derive on every move (gesture or fly-to)
    };

    applyTier();
    map.on("moveend", onMove);
    map.on("zoomend", onMove);
    return () => {
      if (debounce) clearTimeout(debounce);
      map.off("moveend", onMove);
      map.off("zoomend", onMove);
    };
  // mapLoaded en deps: la geometría de barrios ahora llega rápido (API 168KB, ya no
  // 10.5MB de geojson estáticos). En conexiones rápidas barriosRaw gana la carrera al
  // evento "load" del mapa → este efecto salía por !mapLoadedRef y NO re-corría
  // (barriosRaw/mapView estables) → barrios-mls vacío → sin polígonos al hacer zoom.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapView, barriosRaw, mapLoaded]);

  // ── Highlight listing seleccionado ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource("listings-mls")) return;
    map.removeFeatureState({ source: "listings-mls" });
    if (highlightedListingId != null) {
      map.setFeatureState(
        { source: "listings-mls", id: highlightedListingId },
        { highlighted: true },
      );
    }
  }, [highlightedListingId]);

  // ── Opacidad diferenciada por barrio activo ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !map.getLayer("listings-mls-unclustered")) return;
    if (activeBarrioName) {
      map.setPaintProperty("listings-mls-unclustered", "circle-opacity", [
        "case",
        ["==", ["get", "barrio_nombre"], activeBarrioName], 0.9,
        0.2,
      ]);
      map.setPaintProperty("listings-mls-clusters", "circle-opacity", 0.3);
    } else {
      map.setPaintProperty("listings-mls-unclustered", "circle-opacity", 0.9);
      map.setPaintProperty("listings-mls-clusters", "circle-opacity", 0.88);
    }
  }, [activeBarrioName]);

  // ── Exponer flyTo al padre ───────────────────────────────────────────────────
  useEffect(() => {
    if (!flyToListingRef) return;
    flyToListingRef.current = (lat: number, lng: number, zoom = 16) => {
      const map = mapRef.current;
      // Deep-link (botón "Listings" del home) dispara esto en el mount, antes de
      // que el mapa emita "load" → sin cola el flyTo se perdía y nunca hacía zoom.
      if (!map || !mapLoadedRef.current) { pendingFlyRef.current = { lat, lng, zoom }; return; }
      // Flatten as part of the fly: navigating zonas→barrio sets mapView="listings"
      // in the same handler, and that effect's pitch easeTo would otherwise interrupt
      // this flyTo mid-flight → camera froze below POLYGON_TIER_ZOOM → autoSelect fell
      // back to the comuna (mlsBarrio cleared). flattenSkipRef tells it to stand down.
      flattenSkipRef.current = true;
      map.flyTo({ center: [lng, lat], zoom, pitch: 0, speed: 0.9 });
    };
  });


  // ── Markers de oportunidades ─────────────────────────────────────────────────
  function addOpportunityMarkers(map: MapboxMap) {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    barriosRef.current.forEach((b) => {
      const opp = b.oportunidad;
      if (!opp.detectada) return;
      const nb = barrioToNeighborhood(b);
      const color = OPP_COLORS[opp.tipo as keyof typeof OPP_COLORS] ?? "#FFF6D6";
      const el = document.createElement("div");
      el.className = "opp-pulse-dot";
      el.style.setProperty("--opp-color", color);
      el.title = `${opp.tipo ?? ""} — ${opp.descripcion ?? ""}`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        map.flyTo({ center: [nb.lng, nb.lat], zoom: 14.5, speed: 0.8 });
        onSelect(nb);
      });
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([nb.lng, nb.lat]).addTo(map);
      markersRef.current.push(marker);
    });
  }

  if (tokenError) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-background px-6 text-center">
        <div className="max-w-md rounded-xl border border-border bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">Token de Mapbox requerido</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Configura el secreto{" "}
            <code className="rounded bg-background/60 px-1.5 py-0.5 text-xs">MAPBOX_PUBLIC_TOKEN</code>{" "}
            en Lovable Cloud para cargar el mapa de Medellín.
          </p>
        </div>
      </div>
    );
  }

  const LEGEND_ITEMS = [
    { color: "#0F8A4F", label: "Apto" },
    { color: "#CE1126", label: "Casa" },
    { color: "#C2410C", label: "Aptaestudio" },
    { color: "#8A6A00", label: "Lote" },
    { color: "#1F5BC6", label: "Local" },
    { color: "#6D4AA8", label: "Oficina" },
    { color: "#6E726E", label: "Bodega" },
  ];

  const legendPanel = (
    <div data-tour="legend" style={{
      background: "#FFFFFF", border: "1px solid #E5E0D5",
      borderRadius: 14, padding: "12px 14px", width: 200,
      boxShadow: "0 8px 24px rgba(26,18,8,0.12)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6E726E" }}>
          Tipo de inmueble
        </span>
        <button
          onClick={() => setLegendOpen(false)}
          aria-label="Cerrar leyenda"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6E726E", display: "flex", padding: 0, lineHeight: 1, fontSize: 15 }}
        >
          ×
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 10px" }}>
        {LEGEND_ITEMS.map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#111418" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0, boxShadow: `0 0 0 2px ${color}22` }} />
            {label}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid #F0EADF", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#111418" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FCD116", display: "inline-block", flexShrink: 0, boxShadow: "0 0 0 2px #ffc92833" }} />
        Premium
      </div>
    </div>
  );

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Loading veil — claro (matchea el mapa cargado, no un void negro), fade-out
          al estar listo. z-[1] → bajo el navbar/filtros (chrome queda visible). */}
      <LoadingVeil label="el mapa" show={!mapLoaded} className="absolute z-[1]" />

      {/* Leyenda tipos de inmueble — pill que despliega la card (desktop + móvil) */}
      {mapView === "listings" && (
        <div style={{ position: "absolute", bottom: 40, left: 16, zIndex: 10 }}>
          {legendOpen ? (
            legendPanel
          ) : (
            <button
              onClick={() => setLegendOpen(true)}
              data-tour="legend"
              aria-label="Ver leyenda de tipos"
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "#FFFFFF", border: "1px solid #E5E0D5",
                borderRadius: 999, padding: "7px 13px", fontSize: 12, fontWeight: 500, color: "#111418",
                boxShadow: "0 4px 14px rgba(26,18,8,0.1)", cursor: "pointer",
              }}
            >
              <span style={{ display: "inline-flex", gap: 3 }}>
                {["#0F8A4F", "#CE1126", "#1F5BC6"].map((c) => (
                  <span key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block" }} />
                ))}
              </span>
              Tipos
            </button>
          )}
        </div>
      )}

      {/* Volver al Valle — /map, cuando drilleas más allá del overview de comuna.
          Reusa switchToComunas (overview valle + reset de capas/selección). */}
      {mapView === "zonas" && !fitValle && showVolverValle && (
        <button
          onClick={() => { const m = mapRef.current; if (m) switchToComunas(m); }}
          className="absolute right-4 top-[108px] z-20 flex items-center gap-2 rounded-lg border border-white/10 bg-background/80 px-3 py-2 text-sm font-medium text-foreground backdrop-blur-md transition hover:bg-background/95"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M8 2v5m0 0 2.5-2.5M8 7 5.5 4.5M3 10a5 5 0 1 0 10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Volver al Valle
        </button>
      )}

    </>
  );
}
