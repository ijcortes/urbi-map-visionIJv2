import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import mapboxgl, { Map as MapboxMap } from "mapbox-gl";
import { pointOnFeature } from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "@/lib/mapboxToken";
import { isMobileWidth, isTabletWidth, MOBILE_QUERY } from "@/lib/breakpoints";
import { buildViewportParams, viewportCacheKey, type ListingQueryFilters } from "@/lib/listingParams";
import { usePriceFormat } from "@/hooks/usePriceFormat";
import type { Segmento } from "@/lib/segmento";
import { toast } from "sonner";
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
    segmento?: Segmento | null;
    ocultarDestacados?: boolean;
  };
  /** Hold viewport fetching (e.g. until the residential/commercial segment is chosen). */
  paused?: boolean;
  onViewportListingsChange?: (listings: ApiListing[]) => void;
  onViewportLoadingChange?: (loading: boolean) => void;
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
  return (typeof window !== "undefined" && isTabletWidth(window.innerWidth))
    ? { bounds: VALLE_BOUNDS_WIDE, maxBounds: [[-75.71, 6.07], [-75.46, 6.42]] }
    : { bounds: VALLE_BOUNDS, maxBounds: [[-75.715, 6.128], [-75.475, 6.34]] };
}
// Zoom at which the polygon tier flips comuna → barrio (matches cluster→points). Knob.
const POLYGON_TIER_ZOOM = 13;       // solo para encuadres (fitBounds maxZoom); el backend decide puntos vs clusters
// Barrios: visibles (hover/click) desde este zoom; antes se ocultaban hasta 15.
const BARRIO_MIN_ZOOM = 12;
const BARRIO_LABEL_MIN_ZOOM = 13.5;
// En vista listings el relleno de comuna cede el paso a los barrios a este zoom (zoom range, no visibility).
const COMUNA_FILL_MAX_ZOOM = BARRIO_MIN_ZOOM;
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

// Popup HTML builder lives in @/lib/listingPopupHtml (pure, lang/currency-aware).

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
  paused = false,
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
  const selectedBarrioRef = useRef<number | null>(null);  // barrio con relleno de selección (explícito: click/búsqueda)
  const flattenSkipRef = useRef(false);  // skip listings-toggle pitch easeTo when a zone fit drives it
  const pendingFlyRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);  // deep-link flyTo que llegó antes del "load" del mapa
  const lastViewportQueryRef = useRef("");  // dedup identical viewport fetches
  const { currency: priceCurrency, trm: priceTrm } = usePriceFormat();
  const priceCurrencyRef = useRef(priceCurrency);
  const priceTrmRef = useRef(priceTrm);
  priceCurrencyRef.current = priceCurrency;
  priceTrmRef.current = priceTrm;
  const pendingClickCleanupRef = useRef<(() => void) | null>(null);  // limpia el timer de 220ms del click
  const pulseRafRef = useRef<number | null>(null);  // animación de pulso de markers Pro
  const tokenError = !MAPBOX_TOKEN || MAPBOX_TOKEN.includes("REPLACE_ME");
  const isMobileRef = useRef(typeof window !== "undefined" && isMobileWidth(window.innerWidth));

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
    const isMobile = isMobileWidth(window.innerWidth);
    isMobileRef.current = isMobile;
    // Keep the ref in sync on rotate/resize (was read once at mount).
    const mql = window.matchMedia(MOBILE_QUERY);
    const onMql = () => { isMobileRef.current = mql.matches; };
    mql.addEventListener("change", onMql);
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

      // ── CAPA BARRIOS: polígonos con hover/click desde BARRIO_MIN_ZOOM ─────────
      // Se controla con minzoom (no con toggles de visibility por cámara): en vista
      // listings las capas quedan visibles y Mapbox las muestra solo desde ese zoom.
      map.addSource("barrios-mls", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "barrios-mls-fill",
        type: "fill",
        source: "barrios-mls",
        minzoom: BARRIO_MIN_ZOOM,
        layout: { visibility: "none" },
        paint: {
          // Relleno visible al hover y al seleccionar; base > 0 para que el hit-test funcione.
          "fill-color": "#003893",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false], 0.28,
            ["boolean", ["feature-state", "selected"], false], 0.14,
            0.02,
          ],
        },
      });
      map.addLayer({
        id: "barrios-mls-line",
        type: "line",
        source: "barrios-mls",
        minzoom: BARRIO_MIN_ZOOM,
        layout: { visibility: "none" },
        paint: {
          "line-color": "#003893",
          "line-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false], 0.9,
            ["boolean", ["feature-state", "selected"], false], 0.7,
            0.4,
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false], 2.5,
            ["boolean", ["feature-state", "selected"], false], 2.5,
            1,
          ],
        },
      });
      // Etiqueta con el nombre del barrio (a zooms bajos el nombre sale en el tooltip de hover).
      map.addLayer({
        id: "barrios-mls-label",
        type: "symbol",
        source: "barrios-mls",
        minzoom: BARRIO_LABEL_MIN_ZOOM,
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
      const barrioPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: "urbi-dark-tip" });
      const showBarrioTip = (lngLat: mapboxgl.LngLat, nombre: string) => {
        const el = document.createElement("span");
        el.setAttribute("data-i18n-skip", "");
        el.textContent = nombre;
        barrioPopup.setLngLat(lngLat).setDOMContent(el).addTo(map);
      };
      map.on("mousemove", "barrios-mls-fill", (e) => {
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = "pointer";
        const id = e.features[0].id as number;
        if (hoverBarrioId !== null && hoverBarrioId !== id) {
          map.setFeatureState({ source: "barrios-mls", id: hoverBarrioId }, { hover: false });
        }
        hoverBarrioId = id;
        map.setFeatureState({ source: "barrios-mls", id }, { hover: true });
        const nombre = (e.features[0].properties?.nombre as string | undefined) ?? "";
        if (nombre) showBarrioTip(e.lngLat, nombre);
      });
      map.on("mouseleave", "barrios-mls-fill", () => {
        map.getCanvas().style.cursor = "";
        if (hoverBarrioId !== null) map.setFeatureState({ source: "barrios-mls", id: hoverBarrioId }, { hover: false });
        hoverBarrioId = null;
        barrioPopup.remove();
      });
      // Click en barrio = selección explícita del usuario (el padre fija el barrio).
      map.on("click", "barrios-mls-fill", (e) => {
        if (!e.features?.length) return;
        // Un punto de listing encima gana sobre el polígono.
        if (map.queryRenderedFeatures(e.point, { layers: ["listings-mls-unclustered", "listings-mls-clusters"] }).length) return;
        const feat = e.features[0];
        map.fitBounds(featureBounds(feat), {
          padding: { top: 60, bottom: 60 + bottomInsetRef.current, left: 60, right: 60 },
          maxZoom: 15, duration: 400,
        });
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
      pendingClickCleanupRef.current = () => { if (_pendingClick !== null) { clearTimeout(_pendingClick); _pendingClick = null; } };
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
      const PULSE_FRAME_MS = 80; // ~12 fps: setPaintProperty re-evaluates style, don't do it per frame
      let lastPulsePaint = 0;
      const animatePulse = (ts: number) => {
        pulseRafRef.current = requestAnimationFrame(animatePulse);
        if (ts - lastPulsePaint < PULSE_FRAME_MS) return;
        if (typeof document !== "undefined" && document.hidden) return;
        if (!map.getLayer("listings-mls-pulse")) return;
        if (map.getLayoutProperty("listings-mls-pulse", "visibility") === "none") return;
        lastPulsePaint = ts;
        const t = (ts % PULSE_MS) / PULSE_MS;            // 0 → 1
        map.setPaintProperty("listings-mls-pulse", "circle-radius", 10 + 22 * t);
        map.setPaintProperty("listings-mls-pulse", "circle-opacity", 0.45 * (1 - t));
      };
      pulseRafRef.current = requestAnimationFrame(animatePulse);
    });

    return () => {
      ro.disconnect();
      mql.removeEventListener("change", onMql);
      pendingClickCleanupRef.current?.();
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

  // ── Vista 1 (zonas): botón "Volver al Valle" ────────────────────────────────
  // La cámara ya NO cambia la zona/filtros: ni el zoom-in entra a una comuna (drill por
  // zoom) ni el zoom-out sale de ella. Solo un click/búsqueda explícito cambia la zona;
  // el botón "Volver" (o "Toda la ciudad") la limpia.
  const VOLVER_VALLE_ZOOM = 12.5;  // drilleado más allá del overview de comuna → ofrece volver al valle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || mapView !== "zonas") return;
    const onZoomEnd = () => { setShowVolverValle(map.getZoom() > VOLVER_VALLE_ZOOM); };
    map.on("zoomend", onZoomEnd);
    return () => { map.off("zoomend", onZoomEnd); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapView, mapLoaded]);

  // ── Vista 2: actualizar datos GeoJSON cuando llegan listings ────────────────
  // Pins at every zoom: the backend returns thinned points at zoom 10-12, all points at
  // >= 13 and clusters only below 10. No frontend zoom gate. Scope = viewport bbox plus
  // the sidebar filters; a zone is applied ONLY when the user explicitly picked one.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || mapView !== "listings" || paused) return;

    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;                       // request id: only the newest response may write
    let ctrl: AbortController | null = null;
    let inFlight = false;

    const loadViewport = async () => {
      const b = map.getBounds();
      if (!b) return;
      const zone = { barrioId: mlsBarrioId, cdComuna: mlsCdComuna, municipio: mlsMunicipio };
      const params = buildViewportParams({
        bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        zoom: map.getZoom(),
        zone,
        filters: {
          tipoOp: mlsTipoOp,
          precioMin: mlsPrecioMin,
          precioMax: mlsPrecioMax,
          amoblado: mlsAmoblado,
          ...mlsFilters,
        } as ListingQueryFilters,
        price: { currency: priceCurrencyRef.current, trm: priceTrmRef.current },
      });
      const key = viewportCacheKey(params, zone);
      if (key === lastViewportQueryRef.current) return;
      lastViewportQueryRef.current = key;

      ctrl?.abort();
      ctrl = new AbortController();
      const myCtrl = ctrl;
      const mySeq = ++seq;
      inFlight = true;
      onViewportLoadingChangeRef.current?.(true);
      try {
        const res = await apiFetch<ViewportResponse>(`${API_ENDPOINTS.allListings}/viewport?${params}`, { signal: myCtrl.signal });
        if (cancelled || mySeq !== seq) return;   // stale response: a newer request owns the map
        const src = map.getSource("listings-mls") as mapboxgl.GeoJSONSource | undefined;
        if (!src) return;
        if (res.mode === "clusters") {
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
        inFlight = false;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;   // superseded; owner handles state
        // Real failure: allow the identical query to be retried and tell the user.
        if (mySeq === seq) {
          lastViewportQueryRef.current = "";
          inFlight = false;
          if (!cancelled) toast.error("Could not load listings. Move the map or change a filter to retry.");
        }
      } finally {
        if (!cancelled && mySeq === seq) onViewportLoadingChangeRef.current?.(false);
      }
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
      if (inFlight) {
        // Aborted before it landed: the next effect run must be able to refetch the same key.
        ctrl?.abort();
        lastViewportQueryRef.current = "";
      }
      onViewportLoadingChangeRef.current?.(false);
      map.off("moveend", onMove);
      map.off("zoomend", onMove);
    };
  // mapLoaded en deps: deep-link a listings pone mapView="listings" ANTES del evento "load".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapView, mapLoaded, paused, mlsBarrioId, mlsCdComuna, mlsMunicipio, mlsTipoOp, mlsPrecioMin, mlsPrecioMax, mlsAmoblado,
      mlsFilters?.habitaciones, mlsFilters?.banos, mlsFilters?.areaMin, mlsFilters?.areaMax,
      mlsFilters?.estrato?.join(","), mlsFilters?.tipoInmueble?.join(","), mlsFilters?.diasMercado, mlsFilters?.busqueda,
      mlsFilters?.amenidades?.join(","), mlsFilters?.estadoInmueble, mlsFilters?.pisoMin,
      mlsFilters?.segmento, mlsFilters?.ocultarDestacados, priceCurrency, priceTrm]);

  // ── Polígonos de barrio: fuente cargada una vez; capas por zoom range ──────
  // NINGUNA derivación por cámara: mover/zoomear el mapa no cambia zona ni filtros.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const src = map.getSource("barrios-mls") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const feats = (barriosRaw ?? [])
      .filter((b) => b.geometry && b.barrio_id < _REAL_ID_MAX)
      .map((b) => ({
        type: "Feature" as const,
        id: b.barrio_id,
        geometry: b.geometry as GeoJSON.Geometry,
        properties: { barrio_id: b.barrio_id, nombre: b.nombre ?? "", cd_comuna: b.cd_comuna ?? null },
      }));
    src.setData({ type: "FeatureCollection", features: feats } as GeoJSON.FeatureCollection);
  }, [barriosRaw, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const setVis = (id: string, v: "visible" | "none") => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    };
    if (mapView !== "listings") return;
    // Barrios visibles (zoom range via minzoom de la capa); comuna fill cede a barrios.
    for (const id of ["barrios-mls-fill", "barrios-mls-line", "barrios-mls-label"]) setVis(id, "visible");
    if (map.getLayer("comunas-fill")) map.setLayerZoomRange("comunas-fill", 0, COMUNA_FILL_MAX_ZOOM);
    if (map.getLayer("comunas-label")) map.setLayerZoomRange("comunas-label", 0, COMUNA_FILL_MAX_ZOOM);
    setVis("comunas-line", "visible");
    if (map.getLayer("comunas-line")) {
      map.setPaintProperty("comunas-line", "line-width", ["interpolate", ["linear"], ["zoom"], 11, 2, 14, 0.8]);
      map.setPaintProperty("comunas-line", "line-opacity", ["interpolate", ["linear"], ["zoom"], 11, 0.6, 14, 0.35]);
    }
    return () => {
      if (map.getLayer("comunas-fill")) map.setLayerZoomRange("comunas-fill", 0, 24);
      if (map.getLayer("comunas-label")) map.setLayerZoomRange("comunas-label", 0, 24);
    };
  }, [mapView, mapLoaded]);

  // Barrio seleccionado (explícito) → relleno de selección.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !map.getSource("barrios-mls")) return;
    if (selectedBarrioRef.current != null) {
      map.setFeatureState({ source: "barrios-mls", id: selectedBarrioRef.current }, { selected: false });
      selectedBarrioRef.current = null;
    }
    if (mlsBarrioId != null) {
      map.setFeatureState({ source: "barrios-mls", id: mlsBarrioId }, { selected: true });
      selectedBarrioRef.current = mlsBarrioId;
    }
  }, [mlsBarrioId, mapLoaded, mapView, barriosRaw]);

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
          <h2 className="font-display text-lg font-semibold">Mapbox token required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Set{" "}
            <code className="rounded bg-background/60 px-1.5 py-0.5 text-xs">VITE_MAPBOX_TOKEN</code>{" "}
            at build time to load the map.
          </p>
        </div>
      </div>
    );
  }

  const ALL_LEGEND_ITEMS = [
    { color: "#0F8A4F", label: "Apto", seg: "residencial" },
    { color: "#CE1126", label: "Casa", seg: "residencial" },
    { color: "#8A6A00", label: "Lote", seg: "comercial" },
    { color: "#1F5BC6", label: "Local", seg: "comercial" },
    { color: "#6D4AA8", label: "Oficina", seg: "comercial" },
    { color: "#6E726E", label: "Bodega", seg: "comercial" },
  ];
  // Segment-aware: only list the types the active segment can actually show.
  const LEGEND_ITEMS = ALL_LEGEND_ITEMS.filter(
    (i) => !mlsFilters?.segmento || i.seg === mlsFilters.segmento,
  );

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
