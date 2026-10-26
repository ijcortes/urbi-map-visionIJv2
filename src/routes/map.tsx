import { seo } from "@/lib/seo";
import { createFileRoute } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { API_ENDPOINTS } from "@/config/api";
import { useTarget, type Target } from "@/contexts/TargetContext";
import { ProfileChipMobile } from "@/components/Navbar";
import type { MapTab } from "@/components/MapNavbar";
import { ComunidadNavbar } from "@/components/comunidad/ComunidadNavbar";
import { BarrioProvider } from "@/components/comunidad/BarrioContext";
import { SegmentGate } from "@/components/SegmentGate";
import { getStoredSegmento, setStoredSegmento, pruneTiposForSegmento, mapTourReady, type Segmento } from "@/lib/segmento";
import { MapFilterBar, EMPTY_SHARED_FILTERS, TAB_TIPO_OP, type SharedFilters } from "@/components/MapFilterBar";
import { MapView } from "@/components/MapView";
import { OpportunitiesPanel } from "@/components/OpportunitiesPanel";
import type { Neighborhood } from "@/lib/adapters";
import type { ApiListing } from "@/lib/adapters";
import { auth } from "@/lib/auth";
import { track } from "@/lib/tracking";
import { useListings, useBarriosRaw, type ListingsApiFilters } from "@/hooks/useBarrios";
import { geoSelectionForBarrio } from "@/lib/listingParams";
import { barrioToNeighborhood, barrioToOption, type BarrioOption } from "@/lib/adapters";
import { useMemo } from "react";
import { ListingMiniPopup } from "@/components/ListingMiniPopup";
import { ListingPopup } from "@/components/listing-popup/ListingPopup";
import { ComparadorBadge } from "@/components/ComparadorBadge";
import { MapTourModal } from "@/components/MapTourModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { List, Map as MapIcon } from "@/lib/icons";
import { AnimatePresence } from "framer-motion";

// Heavy panels load on demand (own chunks) instead of inside the map route chunk.
const FloatingPanel = lazy(() => import("@/components/FloatingPanel").then((m) => ({ default: m.FloatingPanel })));
const MLSPanel = lazy(() => import("@/components/MLSPanel").then((m) => ({ default: m.MLSPanel })));
const ListingDrawer = lazy(() => import("@/components/ListingDrawer").then((m) => ({ default: m.ListingDrawer })));

export const Route = createFileRoute("/map")({
  head: () => seo({ title: "Mapa de inmuebles y barrios · Medellín Social", description: "Explora apartamentos, casas y locales en venta y arriendo en Medellín y el Valle de Aburrá, con precios por barrio, seguridad y rentabilidad.", path: "/map" }),
  component: MapPage,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
});

// Zillow-style popup rollout flag — false restores the old ListingMiniPopup.
const NEW_POPUP = true;

const GOAL_TO_PERFIL: Record<string, string> = {
  airbnb: "airbnb",
  "renta-larga": "largo_plazo",
  valorizacion: "largo_plazo",
  mediano_plazo: "mediano_plazo",
  nomadas: "mediano_plazo",
};

type ComunaBarrioItem = {
  barrio_id: number;
  nombre: string;
  lat: number | null;
  lon: number | null;
  precio_m2_cop: number | null;
  arriendo_cop: number | null;
  yield_pct: number | null;
};

// ─── Map page ──────────────────────────────────────────────────────────────────
function MapPage() {
  return (
    <BarrioProvider>
      <MapPageInner />
    </BarrioProvider>
  );
}

const TAB_TO_TARGET: Record<MapTab, Target | null> = {
  buy:        "buyer",
  rent:       "renter",
  sell:       "seller",
  agent:      null,
  simulator:  null,
  comparador: null,
};

function MapPageInner() {
  const { setTarget } = useTarget();
  // Header ahora es ComunidadNavbar completo (masthead con logo fluido +
  // nav + ticker) — alto variable por viewport, no un número fijo como
  // antes. Se mide en vivo y se publica como --map-header-h para que
  // MapFilterBar/MapTourModal/el botón "Buscar en el Valle" (que viven en
  // otros archivos) posicionen relativo a eso en vez de un top hardcodeado.
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--map-header-h", `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [activeTab, setActiveTab] = useState<MapTab>(() => {
    if (typeof window === "undefined") return "buy";
    const op = new URLSearchParams(window.location.search).get("tipo_operacion");
    return op === "arriendo" ? "rent" : "buy";
  });
  const [sharedFilters, setSharedFilters] = useState<SharedFilters>(() => {
    const op = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("tipo_operacion")
      : null;
    return { ...EMPTY_SHARED_FILTERS, tipoOp: op === "arriendo" ? "arriendo" : "venta" };
  });
  // Segment gate: residential/commercial is chosen BEFORE any result. "pending" until the
  // persisted choice is read on the client (no SSR flash), "open" = ask, "done" = chosen.
  const [segmentoGate, setSegmentoGate] = useState<"pending" | "open" | "done">("pending");
  useEffect(() => {
    const stored = getStoredSegmento();
    if (stored) {
      setSharedFilters((f) => ({ ...f, segmento: stored, tipoInmueble: pruneTiposForSegmento(f.tipoInmueble, stored) }));
      setSegmentoGate("done");
    } else {
      setSegmentoGate("open");
    }
  }, []);
  const [selected, setSelected] = useState<Neighborhood | null>(null);
  const [mostrarOportunidades, setMostrarOportunidades] = useState(
    () => auth.get()?.mostrarOportunidades ?? false
  );
  const [perfil, setPerfil] = useState<string | undefined>(
    () => GOAL_TO_PERFIL[auth.get()?.goal ?? ""] as string | undefined,
  );
  const [risk, setRisk] = useState<string | undefined>(() => auth.get()?.risk as string | undefined);

  // Vista 1 / Vista 2 toggle
  const [mapView, setMapView] = useState<"zonas" | "listings">("zonas");
  const [mlsBarrio, setMlsBarrio] = useState<Neighborhood | null>(null);
  const [highlightedListingId, setHighlightedListingId] = useState<number | null>(null);
  const hoverPinRef = useRef<((p: { lat: number; lng: number } | null) => void) | null>(null);
  const [activeBarrioInComune, setActiveBarrioInComune] = useState<string | null>(null);
  const flyToListingRef = useRef<((lat: number, lng: number, zoom?: number) => void) | null>(null);
  // Deep-link comuna/municipio (botón "Listings" del home) parseado en el mount;
  // se aplica vía handleComunaSelect cuando ya cargaron los barrios Y el mapa (ver efecto abajo).
  const deepLinkComunaRef = useRef<{ cd: number | null; municipio: string | null; nombre: string | null } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // Llegada por deep-link (botón "Listings" del home) → no abrir el tour de
  // onboarding: su demo mueve la cámara al centro de la ciudad y tapa la comuna
  // pedida. El tour sigue apareciendo en una visita normal a /map.
  const [isDeepLink] = useState(() => {
    if (typeof window === "undefined") return false;
    const p = new URLSearchParams(window.location.search);
    return !!(p.get("cd_comuna") || p.get("municipio"));
  });

  // Listing detail modal
  const [listingDetailId, setListingDetailId] = useState<number | null>(null);
  const [drawerMounted, setDrawerMounted] = useState(false);
  useEffect(() => {
    if (listingDetailId != null) setDrawerMounted(true);
  }, [listingDetailId]);

  // Mini popup (single-click on card or map point)
  const [miniPopupData, setMiniPopupData] = useState<{ listing: ApiListing; x: number; y: number } | null>(null);

  // Listings currently rendered as map dots via viewport loading (FIX 1) — used
  // to resolve a map-point click into the listing for the mini-popup/drawer.
  const [viewportListings, setViewportListings] = useState<ApiListing[]>([]);
  const [viewportLoading, setViewportLoading] = useState(false);

  const [globalSearch, setGlobalSearch] = useState(false);

  // Mobile: Zillow-style toggle between two FULL-SCREEN views (map ⟷ list).
  // Desktop ignores it — map + right panel show together. Full-screen map means the
  // screen center IS the real center, so camera auto-select (FIX 1d) needs no offset.
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<"map" | "list">("map");

  // Count active filters for hint banner
  const activeFilterCount = [
    sharedFilters.precioMax, sharedFilters.precioMin,
    sharedFilters.habitaciones, sharedFilters.tipoInmueble,
    sharedFilters.areaMin, sharedFilters.areaMax,
    sharedFilters.banos, sharedFilters.antiguedad,
    sharedFilters.busqueda,
  ].filter((v) => v !== null).length;

  // API-level filters derived from sharedFilters — trigger refetch when changed
  const apiFilters = useMemo<ListingsApiFilters>(() => ({
    area_min:     sharedFilters.areaMin,
    area_max:     sharedFilters.areaMax,
    banos:        sharedFilters.banos,
    antiguedad:   sharedFilters.antiguedad,
    amenidades:   sharedFilters.amenidades,
    amoblado:     sharedFilters.amoblado,
    precio_min:   sharedFilters.precioMin,
    precio_max:   sharedFilters.precioMax,
    habitaciones: sharedFilters.habitaciones,
    tipo_inmueble: sharedFilters.tipoInmueble,
    segmento:     sharedFilters.segmento,
    ocultar_destacados: sharedFilters.ocultarDestacados,
  }), [sharedFilters.segmento, sharedFilters.ocultarDestacados, sharedFilters.areaMin, sharedFilters.areaMax, sharedFilters.banos, sharedFilters.antiguedad,
       sharedFilters.amenidades, sharedFilters.amoblado, sharedFilters.precioMin, sharedFilters.precioMax,
       sharedFilters.habitaciones, sharedFilters.tipoInmueble]);

  // Remaining shared filters applied server-side in /viewport (map + panel single source).
  const mlsFilters = useMemo(() => ({
    habitaciones:   sharedFilters.habitaciones,
    banos:          sharedFilters.banos,
    areaMin:        sharedFilters.areaMin,
    areaMax:        sharedFilters.areaMax,
    estrato:        sharedFilters.estrato,
    tipoInmueble:   sharedFilters.tipoInmueble,
    diasMercado:    sharedFilters.diasMercado,
    busqueda:       sharedFilters.busqueda,
    amenidades:     sharedFilters.amenidades,
    estadoInmueble: sharedFilters.estadoInmueble,
    pisoMin:        sharedFilters.pisoMin,
    segmento:       sharedFilters.segmento,
    ocultarDestacados: sharedFilters.ocultarDestacados,
  }), [sharedFilters.segmento, sharedFilters.ocultarDestacados, sharedFilters.habitaciones, sharedFilters.banos, sharedFilters.areaMin, sharedFilters.areaMax,
       sharedFilters.estrato, sharedFilters.tipoInmueble, sharedFilters.diasMercado, sharedFilters.busqueda,
       sharedFilters.amenidades, sharedFilters.estadoInmueble, sharedFilters.pisoMin]);

  // Pass tipoOp to backend so it returns the correct type (not a mixed 50/50 split).
  // undefined when "todos" so backend does the balanced venta+arriendo fetch.
  const mlsTipoOp = sharedFilters.tipoOp !== "todos" ? sharedFilters.tipoOp : undefined;
  const { data: mlsData, isLoading: mlsIsLoading } = useListings(mlsBarrio?.id ?? null, 500, 0, mlsTipoOp, false, apiFilters);
  const mlsListings: ApiListing[] = useMemo(() => mlsData?.listings ?? [], [mlsData]);
  const mlsRadio = mlsData?.radio_usado_metros ?? null;
  const mlsBarriosIncluidos = mlsData?.barrios_incluidos ?? null;

  // Global Valle search ("Toda la ciudad"). Solo la LISTA lo consume (el mapa usa
  // clusters aparte). La lista pinta 30 y crece por scroll → 200 alcanza de sobra
  // y el payload baja ~2.5x (carga más rápido en red real).
  const { data: globalData, isLoading: globalIsLoading } = useListings(
    null, 200, 0, mlsTipoOp, false, apiFilters,
    undefined, undefined, globalSearch,
  );

  // Premium-expansion fetch — fires when premium filter is active to find nearby premium
  const [premiumExpand, setPremiumExpand] = useState(false);
  const { data: premiumData, isLoading: premiumIsLoading } = useListings(
    premiumExpand ? (mlsBarrio?.id ?? null) : null,
    500,
    0,
    undefined,
    true,
  );
  const premiumExpanded: ApiListing[] = useMemo(() => premiumData?.listings ?? [], [premiumData]);
  const premiumRadio = premiumData?.radio_usado_metros ?? null;
  const premiumBarriosIncluidos = premiumData?.barrios_incluidos ?? null;

  // All barrios for the municipality selector in MLSPanel
  const { data: barriosRaw } = useBarriosRaw(perfil);
  const allBarrioOptions = useMemo<BarrioOption[]>(
    () => (barriosRaw ?? []).map(barrioToOption),
    [barriosRaw],
  );

  // Drill-down state
  const [viewLevel, setViewLevel] = useState<"comunas" | "barrios">("comunas");
  const [activeComuna, setActiveComuna] = useState<string | null>(null);
  const [activeComunaCd, setActiveComunaCd] = useState<number | null>(null);
  const [activeMunicipio, setActiveMunicipio] = useState<string | null>(null);
  const returnToComunasRef = useRef<((speed?: number) => void) | null>(null);
  const [comunaBarriosList, setComunaBarriosList] = useState<ComunaBarrioItem[]>([]);

  useEffect(() => {
    if (!activeComunaCd) { setComunaBarriosList([]); return; }
    fetch(API_ENDPOINTS.comunasBarriosByCd(activeComunaCd))
      .then(r => r.ok ? r.json() : [])
      .then(data => setComunaBarriosList(Array.isArray(data) ? data : []))
      .catch(() => setComunaBarriosList([]));
  }, [activeComunaCd]);

  // Camera-derived commune filter forwarded to MapView's viewport fetch.
  // Con "Toda la ciudad" (globalSearch) no se filtra por comuna: se ve toda la ciudad.
  const cdComunaQuery = globalSearch
    ? undefined
    : (mlsBarrio == null && !activeMunicipio ? (activeComunaCd ?? undefined) : undefined);

  // FIX 1d: single source of truth — the panel mirrors exactly the viewport the
  // map shows (clusters mode returns a capped list, points mode the points).
  const mergedListings = globalSearch ? (globalData?.listings ?? []) : viewportListings;
  const mergedLoading  = globalSearch ? globalIsLoading : (mlsBarrio ? mlsIsLoading : viewportLoading);
  // Conteo real del backend (COUNT(*)), no el length de la página capada (200/500) — evita
  // mostrar "200" como si fuera el total cuando hay más resultados sin cargar.
  const realTotal = globalSearch ? globalData?.total : (mlsBarrio ? mlsData?.total : undefined);
  const mlsTotal = realTotal ?? mergedListings.length;

  // Panel zone label — real barrio > active commune > active municipality > Medellín default
  const activePanelName = activeComuna ?? activeMunicipio;
  const panelBarrio: Neighborhood | null = mlsBarrio ?? (globalSearch ? {
    id: -1,
    nombre: "Valle de Aburrá",
    comuna: "Valle de Aburrá",
    municipio: "MEDELLÍN",
    estrato: 0,
    precio_m2: 0, arriendo: 0, yield: 0, anos_recupero: 0,
    dist_metro: 0, dist_parque: 0, dist_mall: 0,
    n_venta: 0, n_arriendo: 0,
    lat: 6.2442, lng: -75.5812,
  } : activePanelName ? {
    id: -1,
    nombre: activePanelName,
    comuna: activePanelName,
    municipio: activeMunicipio ?? "MEDELLÍN",
    estrato: 0,
    precio_m2: 0, arriendo: 0, yield: 0, anos_recupero: 0,
    dist_metro: 0, dist_parque: 0, dist_mall: 0,
    n_venta: 0, n_arriendo: 0,
    lat: 6.2442, lng: -75.5812,
  } : {
    id: -1,
    nombre: "Medellín",
    comuna: "Medellín",
    municipio: "MEDELLÍN",
    estrato: 0,
    precio_m2: 0, arriendo: 0, yield: 0, anos_recupero: 0,
    dist_metro: 0, dist_parque: 0, dist_mall: 0,
    n_venta: 0, n_arriendo: 0,
    lat: 6.2442, lng: -75.5812,
  });

  // Read ?listing=X from URL on mount → open modal automatically
  // Read ?lat=X&lng=Y&zoom=Z → fly to position once map loads
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lid = params.get("listing");
    if (lid) {
      const id = Number(lid);
      if (!Number.isNaN(id)) setListingDetailId(id);
    }
    // ?cd_comuna=N (Medellín) o ?municipio=X (Valle) → entrar directo a los listings
    // de esa comuna (botón "Listings" del mapa del home). Se difiere a un efecto que
    // espera los barrios y luego llama handleComunaSelect — la MISMA vía que un click
    // en el filtro, así se selecciona la comuna y cargan sus listings (no sólo el fly).
    const cdComunaParam = params.get("cd_comuna");
    const municipioParam = params.get("municipio");
    if (cdComunaParam || municipioParam) {
      deepLinkComunaRef.current = {
        cd: municipioParam ? null : Number(cdComunaParam),
        municipio: municipioParam,
        nombre: params.get("nombre"),
      };
      return; // handleComunaSelect hace scope + fly + fetch; no duplicar el fly de lat/lng
    }
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    const zoom = Number(params.get("zoom") ?? "14");
    if (lat && lng) {
      flyToListingRef.current?.(lat, lng, zoom); // queda en cola si el mapa aún no cargó
    }
  }, []);

  // Aplica el deep-link de comuna una vez cargados los barrios Y el mapa. Esperar
  // a mapReady hace que la selección corra como un click real post-load: los
  // efectos gated por mapLoaded (capas de puntos, fly de cámara) corren normal.
  // Sin esto, seleccionar pre-load dejaba la carrera sin puntos y sin zoom.
  useEffect(() => {
    const dl = deepLinkComunaRef.current;
    if (!dl || !mapReady || allBarrioOptions.length === 0) return;
    deepLinkComunaRef.current = null;
    handleComunaSelect(dl.cd, dl.nombre, dl.municipio);
  }, [mapReady, allBarrioOptions]);

  useEffect(() => {
    const sync = () => setMostrarOportunidades(auth.get()?.mostrarOportunidades ?? false);
    window.addEventListener("medellin-social:user", sync);
    return () => window.removeEventListener("medellin-social:user", sync);
  }, []);

  useEffect(() => {
    const onPerfilUpdated = () => {
      setPerfil(GOAL_TO_PERFIL[auth.get()?.goal ?? ""] as string | undefined);
      setRisk(auth.get()?.risk as string | undefined);
    };
    window.addEventListener("perfil-updated", onPerfilUpdated);
    return () => window.removeEventListener("perfil-updated", onPerfilUpdated);
  }, []);

  useEffect(() => {
    const onOpenDrawer = (e: Event) => {
      const id = (e as CustomEvent<{ id: number }>).detail?.id;
      if (id) openListingDetail(id);
    };
    window.addEventListener("open-listing-drawer", onOpenDrawer);
    return () => window.removeEventListener("open-listing-drawer", onOpenDrawer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openListingDetail(id: number) {
    setListingDetailId(id);
    window.history.pushState({}, "", `/map?listing=${id}`);
  }

  function closeListingDetail() {
    setListingDetailId(null);
    setMiniPopupData(null);
    window.history.pushState({}, "", "/map");
  }

  function handleViewLevelChange(level: "comunas" | "barrios", comunaNombre: string | null, municipioFilter?: string | null, cdComuna?: number | null) {
    // Drilling into a zone by camera click exits "toda la ciudad" mode — else
    // globalSearch stays true and cdComunaQuery/mergedListings ignore the comuna.
    setGlobalSearch(false);
    setViewLevel(level);
    if (level === "comunas") {
      setActiveComuna(null);
      setActiveComunaCd(null);
      setActiveMunicipio(null);
      setSelected(null);
    } else if (level === "barrios" && (comunaNombre || cdComuna)) {
      if (municipioFilter) {
        // Non-Medellín municipality block → filter by municipio
        setActiveMunicipio(municipioFilter);
        setActiveComuna(null);
        setActiveComunaCd(null);
      } else {
        // Medellín commune → filter by cd_comuna (reliable int) + name for display
        setActiveComuna(comunaNombre);
        setActiveComunaCd(cdComuna ?? null);
        setActiveMunicipio(null);
      }
      setMlsBarrio(null);
      setMapView("listings");
    }
  }

  function handleBack() {
    returnToComunasRef.current?.();
  }

  // Guía del mapa, paso "Volver a comunas" — a diferencia del botón real
  // (solo resetea estado), acá también se pide el zoom-out lento de cámara
  // para que se vea "limpio como al empezar". Escalonado: primero arranca el
  // zoom-out (lento) y solo después quita la lista/panel, para que ambos se
  // sientan lentos en vez de un corte instantáneo.
  const backToComunasTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleTourBackToComunas() {
    if (backToComunasTimerRef.current) clearTimeout(backToComunasTimerRef.current);
    closeListingDetail();
    returnToComunasRef.current?.(0.3);
    backToComunasTimerRef.current = setTimeout(() => {
      handleBackToZonas();
      backToComunasTimerRef.current = null;
    }, 1500);
  }
  // Si el usuario navega (adelante/atrás) antes de que dispare, cancela el
  // reset pendiente — si no, revienta el estado que el paso actual ya armó.
  function cancelTourBackToComunas() {
    if (backToComunasTimerRef.current) {
      clearTimeout(backToComunasTimerRef.current);
      backToComunasTimerRef.current = null;
    }
  }

  // Tab click — switches target, resets filters, handles SELL/AGENT special cases
  function handleTabChange(tab: MapTab) {
    setActiveTab(tab);
    const tipoOp = TAB_TIPO_OP[tab];
    setSharedFilters((f) => ({ ...EMPTY_SHARED_FILTERS, segmento: f.segmento, tipoOp }));
    const t = TAB_TO_TARGET[tab];
    if (t) setTarget(t);
    if (tab === "sell") { setMapView("zonas"); setMlsBarrio(null); setGlobalSearch(false); }
  }

  function handleFiltersChange(partial: Partial<SharedFilters>) {
    if (partial.segmento) {
      const seg = partial.segmento;
      setStoredSegmento(seg);
      setSharedFilters((f) => ({ ...f, ...partial, tipoInmueble: pruneTiposForSegmento(f.tipoInmueble, seg) }));
      return;
    }
    setSharedFilters((f) => ({ ...f, ...partial }));
  }

  function handleChooseSegmento(seg: Segmento) {
    handleFiltersChange({ segmento: seg });
    setSegmentoGate("done");
  }

  function handleResetFilters() {
    setSharedFilters((f) => ({ ...EMPTY_SHARED_FILTERS, segmento: f.segmento, tipoOp: TAB_TIPO_OP[activeTab] }));
  }

  // Called from barrio popup "Ver inversiones"
  function handleGoToMLS(barrio: Neighborhood) {
    const resolvedId = (barrio as Neighborhood & { barrio_id?: number }).barrio_id ?? barrio.id;
    if (!resolvedId) return;
    setSelected(null);
    setMlsBarrio({ ...barrio, id: resolvedId });
    setMapView("listings");
    setActiveBarrioInComune(null);
  }

  // A barrio selection replaces the whole zone (no stale municipio/comuna).
  function applyGeoSelection(g: ReturnType<typeof geoSelectionForBarrio>) {
    setActiveComuna(g.activeComuna);
    setActiveComunaCd(g.activeComunaCd);
    setActiveMunicipio(g.activeMunicipio);
    setViewLevel("barrios");
  }

  // Called from MLSPanel all-barrios selector
  function handleBarrioNavigate(opt: BarrioOption) {
    applyGeoSelection(geoSelectionForBarrio({ cd_comuna: opt.cd_comuna, comuna: opt.comuna, municipio: opt.municipio }));
    const apiBarrio = barriosRaw?.find((b) => b.barrio_id === opt.id);
    // Sector buscado por su nombre popular → "Ciudad del Río (Colombia)" (barrioSearch).
    const display = opt.displayName;
    if (apiBarrio) {
      const n = barrioToNeighborhood(apiBarrio);
      setMlsBarrio(display ? { ...n, nombre: display } : n);
    } else {
      setMlsBarrio({
        id: opt.id, nombre: display ?? opt.nombre, comuna: opt.comuna ?? opt.nombre,
        municipio: opt.municipio.toUpperCase(), estrato: 3,
        precio_m2: 0, arriendo: 0, yield: 0, anos_recupero: 0,
        dist_metro: 0, dist_parque: 0, dist_mall: 0, n_venta: 0, n_arriendo: 0,
        lat: opt.lat, lng: opt.lng, cd_comuna: opt.cd_comuna,
      });
    }
    setMapView("listings");
    setSelected(null);
    setActiveBarrioInComune(null);
    flyToListingRef.current?.(opt.lat, opt.lng);
  }

  // Called from MLSPanel "← Volver" and Navbar breadcrumb
  function handleBackToZonas() {
    setMapView("zonas");
    setMobileView("map");
    setMlsBarrio(null);
    setGlobalSearch(false);
    setActiveComuna(null);
    setActiveComunaCd(null);
    setActiveMunicipio(null);
    setViewLevel("comunas");
    setHighlightedListingId(null);
    setActiveBarrioInComune(null);
  }

  function handleBackToCommune() {
    setMlsBarrio(null);
  }

  // Cascader Zona (filter bar): null = toda la ciudad; cd = activar comuna + volar.
  function handleComunaSelect(cd: number | null, nombre: string | null, municipio?: string | null) {
    if (cd == null && !municipio) {
      setActiveComuna(null);
      setActiveComunaCd(null);
      setActiveMunicipio(null);
      setMlsBarrio(null);
      setActiveBarrioInComune(null);
      setGlobalSearch(true);
      setMapView("listings");
      return;
    }
    if (municipio) {
      handleViewLevelChange("barrios", nombre, municipio, null);
      setGlobalSearch(false);
      const barrios = allBarrioOptions.filter((o) => o.municipio?.toUpperCase() === municipio.toUpperCase());
      if (barrios.length > 0) {
        const lat = barrios.reduce((s, o) => s + o.lat, 0) / barrios.length;
        const lng = barrios.reduce((s, o) => s + o.lng, 0) / barrios.length;
        // Zoom bajo POLYGON_TIER_ZOOM (13) para no caer en auto-select de barrio.
        flyToListingRef.current?.(lat, lng, 12);
      }
      return;
    }
    handleViewLevelChange("barrios", nombre, null, cd);
    setGlobalSearch(false);
    // Volar al centroide de la comuna (promedio de sus barrios).
    const barriosDeComuna = allBarrioOptions.filter((o) => o.cd_comuna === cd);
    if (barriosDeComuna.length > 0) {
      const lat = barriosDeComuna.reduce((s, o) => s + o.lat, 0) / barriosDeComuna.length;
      const lng = barriosDeComuna.reduce((s, o) => s + o.lng, 0) / barriosDeComuna.length;
      // Zoom bajo POLYGON_TIER_ZOOM (13) para no caer en auto-select de barrio.
      flyToListingRef.current?.(lat, lng, 12);
    }
  }

  function handleSelectBarrioInComune(barrioId: number) {
    const item = comunaBarriosList.find(b => b.barrio_id === barrioId);
    if (!item) return;
    setMlsBarrio({
      id: item.barrio_id,
      nombre: item.nombre,
      comuna: activeComuna ?? item.nombre,
      municipio: "MEDELLÍN",
      estrato: 0,
      precio_m2: item.precio_m2_cop ?? 0,
      arriendo: item.arriendo_cop ?? 0,
      yield: item.yield_pct ?? 0,
      anos_recupero: 0,
      dist_metro: 0, dist_parque: 0, dist_mall: 0,
      n_venta: 0, n_arriendo: 0,
      lat: item.lat ?? 6.2442,
      lng: item.lon ?? -75.5812,
    });
    if (item.lat && item.lon) flyToListingRef.current?.(item.lat, item.lon);
  }

  function handleBarrioFilter(barrioNombre: string | null) {
    setActiveBarrioInComune(barrioNombre);
    if (barrioNombre) {
      const first = mergedListings.find((l) => l.barrio_nombre === barrioNombre && l.lat && l.lon);
      if (first?.lat && first?.lon) flyToListingRef.current?.(first.lat, first.lon);
    }
  }

  // Card click in MLSPanel → flyTo + highlight + show mini popup
  function handleListingSelect(listing: ApiListing, screenX: number, screenY: number) {
    setHighlightedListingId(listing.id ?? null);
    if (listing.lat && listing.lon) {
      flyToListingRef.current?.(listing.lat, listing.lon);
    }
    track('listing_view', { entity_type: 'listing', entity_id: listing.url ?? undefined, barrio_id: listing.barrio_id ?? undefined });
    setMiniPopupData({ listing, x: screenX, y: screenY });
  }

  // Single click on map point → show mini popup
  function handleListingClickFromMap(id: number, screenX: number, screenY: number) {
    setHighlightedListingId(id);
    const listing = viewportListings.find((l) => l.id === id) ?? mergedListings.find((l) => l.id === id);
    if (!listing) return;
    track('listing_view', { entity_type: 'listing', entity_id: listing.url ?? undefined, barrio_id: listing.barrio_id ?? undefined });
    setMiniPopupData({ listing, x: screenX, y: screenY });
  }

  // Double click on map point → open drawer directly
  function handleListingDoubleClickFromMap(id: number) {
    setHighlightedListingId(id);
    setMiniPopupData(null);
    const listing = viewportListings.find((l) => l.id === id) ?? mergedListings.find((l) => l.id === id);
    if (listing) track('listing_view', { entity_type: 'listing', entity_id: listing.url ?? undefined, barrio_id: listing.barrio_id ?? undefined });
    openListingDetail(id);
  }


  // Explicit barrio click on the map polygon (the camera never selects a zone).
  function handleMapBarrioClick(barrioId: number) {
    const b = (barriosRaw ?? []).find((x) => x.barrio_id === barrioId);
    if (!b) return;
    setGlobalSearch(false);
    const n = barrioToNeighborhood(b);
    applyGeoSelection(geoSelectionForBarrio(n));
    setMlsBarrio(n);
    setMapView("listings");
    setSelected(null);
    setActiveBarrioInComune(null);
  }

  return (
    <div className="relative h-dvh w-full max-w-full overflow-hidden bg-background">
      <div className="absolute inset-0 z-0" data-tour="map-canvas">
        <MapView
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          perfil={perfil}
          risk={risk}
          mostrarOportunidades={mostrarOportunidades}
          onViewLevelChange={handleViewLevelChange}
          returnToComunasRef={returnToComunasRef}
          onGoToMLS={handleGoToMLS}
          mapView={mapView}
          mlsBarrioId={mlsBarrio?.id ?? null}
          mlsTipoOp={mlsTipoOp}
          mlsPrecioMin={sharedFilters.precioMin}
          mlsPrecioMax={sharedFilters.precioMax}
          mlsAmoblado={sharedFilters.amoblado}
          mlsCdComuna={cdComunaQuery ?? null}
          mlsMunicipio={activeMunicipio}
          mlsFilters={mlsFilters}
          onViewportListingsChange={setViewportListings}
          onViewportLoadingChange={setViewportLoading}
          onBarrioClick={handleMapBarrioClick}
          paused={segmentoGate !== "done"}
          onReady={() => setMapReady(true)}
          highlightedListingId={highlightedListingId}
          hoverPinRef={hoverPinRef}
          flyToListingRef={flyToListingRef}
          onListingClickFromMap={handleListingClickFromMap}
          onListingDoubleClickFromMap={handleListingDoubleClickFromMap}
          activeBarrioName={activeBarrioInComune}
          activeTab={activeTab}
        />
      </div>

      {/* Gradiente superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[108px] bg-gradient-to-b from-background/40 to-transparent" />

      {/* Botón volver a comunas — solo en vista de barrios y cuando no estamos en listings */}
      {viewLevel === "barrios" && mapView === "zonas" && (
        <button
          onClick={handleBack}
          className="absolute left-4 top-[calc(var(--map-header-h,53px)+56px)] z-20 flex items-center gap-2 rounded-lg border border-white/10 bg-background/80 px-3 py-2 text-sm font-medium text-foreground backdrop-blur-md transition hover:bg-background/95"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {activeComuna ?? "Comunas"}
        </button>
      )}

      {/* ponytail: MLS-navbar quitado temporal (Comprar/Arrendar, cuenta, M²/FT²)
          al traer ComunidadNavbar como plantilla — se reintegra en el siguiente paso.
          z-index propio: el canvas del mapa (absolute, z-0) pinta por encima de
          elementos static sin esto — el ticker quedaba tapado. */}
      <div ref={headerRef} style={{ position: "relative", zIndex: 41 }}>
        <ComunidadNavbar compact hideTicker />
      </div>
      <MapFilterBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        filters={sharedFilters}
        onFiltersChange={handleFiltersChange}
        onResetAll={handleResetFilters}
        allBarrios={allBarrioOptions}
        onBarrioNavigate={handleBarrioNavigate}
        onBarrioClear={() => { setMlsBarrio(null); setMapView("zonas"); setGlobalSearch(false); }}
        onSearchAll={() => { setGlobalSearch(true); setMapView("listings"); }}
        hasActiveScope={!!mlsBarrio || !!activePanelName}
        activeComunaCd={activeComunaCd}
        activeMunicipio={activeMunicipio}
        onComunaSelect={handleComunaSelect}
      />
      <ProfileChipMobile />
      {segmentoGate === "open" && <SegmentGate onChoose={handleChooseSegmento} />}

      {/* Buscar en el Valle — filtros activos pero sin barrio/zona seleccionada */}
      {activeFilterCount > 0 && !mlsBarrio && !globalSearch && activeTab !== "agent" && (
        <button
          onClick={() => { setGlobalSearch(true); setMapView("listings"); }}
          style={{
            // Mobile: the "Tutorial de la página" pill sits on this row (right side) — go one row lower.
            position: "absolute", top: isMobile ? "calc(var(--map-header-h, 53px) + 98px)" : "calc(var(--map-header-h, 53px) + 56px)", left: "50%", transform: "translateX(-50%)",
            zIndex: 24, background: "#1e3a5f", color: "#FAF8F3",
            borderRadius: 8, padding: "6px 16px", fontSize: 12, fontWeight: 600,
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          }}
        >
          Buscar en el Valle de Aburrá →
        </button>
      )}

      {/* Vista 1: paneles normales */}
      {mapView === "zonas" && (
        <>
          <Suspense fallback={null}>
            <FloatingPanel selected={selected} onClear={() => setSelected(null)} onSelect={setSelected} onGoToMLS={handleGoToMLS} />
          </Suspense>
          <OpportunitiesPanel onSelect={setSelected} perfil={perfil} mostrarOportunidades={mostrarOportunidades} />
        </>
      )}

      {/* Vista 2: panel de listings — desktop siempre; móvil solo en vista 'list'.
          AnimatePresence acá (no solo dentro de MLSPanel) para que el exit
          realmente juegue: al vivir en un && del padre, sin esto React
          desmonta el panel entero antes de que su animación interna corra. */}
      <AnimatePresence>
        {mapView === "listings" && panelBarrio && (!isMobile || mobileView === "list") && (
        <Suspense key="mls-panel" fallback={null}>
        <MLSPanel
          barrio={panelBarrio}
          listings={mergedListings}
          total={realTotal}
          isLoading={mergedLoading}
          onBack={handleBackToZonas}
          onListingSelect={handleListingSelect}
          onListingHover={(l) => hoverPinRef.current?.(l?.lat && l?.lon ? { lat: l.lat, lng: l.lon } : null)}
          highlightedListingId={highlightedListingId}
          activeBarrioName={activeBarrioInComune}
          onBarrioFilter={handleBarrioFilter}
          allBarrios={allBarrioOptions}
          onBarrioNavigate={handleBarrioNavigate}
          radioUsadoMetros={mlsRadio}
          barriosIncluidos={mlsBarriosIncluidos}
          premiumExpanded={premiumExpanded}
          premiumIsLoading={premiumIsLoading}
          premiumRadio={premiumRadio}
          premiumBarriosIncluidos={premiumBarriosIncluidos}
          onPremiumExpand={setPremiumExpand}
          externalFilters={sharedFilters}
          onClearFilters={handleResetFilters}
          activeComuna={activeComuna}
          activeMunicipio={activeMunicipio}
          comunaBarrios={comunaBarriosList}
          onBackToComuna={handleBackToCommune}
          onSelectBarrioInComune={handleSelectBarrioInComune}
        />
        </Suspense>
        )}
      </AnimatePresence>

      {/* Toggle mapa ⟷ lista (solo móvil, en modo listings) — estilo Zillow */}
      {isMobile && mapView === "listings" && panelBarrio && (
        <button
          onClick={() => setMobileView((v) => (v === "map" ? "list" : "map"))}
          data-tour="mobile-toggle-view"
          className="fixed left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
          style={{ bottom: 24, background: "#111418" }}
        >
          {mobileView === "map"
            ? (<><List size={16} /> Lista</>)
            : (<><MapIcon size={16} /> Mapa</>)}
        </button>
      )}

      {/* Mini popup — single click on card or map point */}
      {miniPopupData && (NEW_POPUP ? (
        <ListingPopup
          listing={miniPopupData.listing}
          onClose={() => setMiniPopupData(null)}
          onViewMore={(id) => {
            setMiniPopupData(null);
            openListingDetail(id);
          }}
        />
      ) : (
        <ListingMiniPopup
          listing={miniPopupData.listing}
          x={miniPopupData.x}
          y={miniPopupData.y}
          onClose={() => setMiniPopupData(null)}
          onViewMore={(id) => {
            setMiniPopupData(null);
            openListingDetail(id);
          }}
        />
      ))}

      {/* Listing detail drawer — slide-in (desktop) / bottom sheet (mobile) */}
      {/* Mounted from the first open on (keeps its close animation afterwards). */}
      {(listingDetailId != null || drawerMounted) && (
        <Suspense fallback={null}>
          <ListingDrawer listingId={listingDetailId} onClose={closeListingDetail} />
        </Suspense>
      )}

      {/* Comparador floating badge */}
      <ComparadorBadge />

      <MapTourModal
        isMobile={isMobile}
        dataReady={mapTourReady(segmentoGate, allBarrioOptions.length > 0, isDeepLink)}
        activeComunaName={activeComuna ? activeComuna.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null}
        onDemoZoom={() => {
          flyToListingRef.current?.(6.2442, -75.5812, 14.5);
          setTimeout(() => flyToListingRef.current?.(6.2442, -75.5812, 11.5), 1600);
        }}
        onZoomToBarrio={() => {
          const barrio = allBarrioOptions.find((o) => o.cd_comuna === activeComunaCd);
          if (barrio) flyToListingRef.current?.(barrio.lat, barrio.lng, 14.5);
        }}
        onCloseListingDetail={closeListingDetail}
        onBackToComunas={handleTourBackToComunas}
        onCancelBackToComunas={cancelTourBackToComunas}
        onSelectLaureles={() => {
          const laureles = allBarrioOptions.find((o) => o.comuna?.toLowerCase().includes("laureles"));
          if (laureles?.cd_comuna != null) handleComunaSelect(laureles.cd_comuna, laureles.comuna);
        }}
        onShowMobileList={() => setMobileView("list")}
        onShowMobileMap={() => setMobileView("map")}
      />
    </div>
  );
}
