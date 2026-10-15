import { Name } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { isMobileWidth } from "@/lib/breakpoints";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Link } from "@tanstack/react-router";
import { MAPBOX_TOKEN } from "@/lib/mapboxToken";
import { ArrowDown, X } from "@/lib/icons";
import { BarrioChoiceModal } from "@/components/BarrioChoiceModal";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";

// Comuna geometry served from static files (mirrors MapView.MUNICIPIO_STATIC)
const COMUNA_STATIC = [
  "/data/comunas_medellin.geojson",
  "/data/comunas_bello.geojson",
  "/data/comunas_envigado.geojson",
  "/data/comunas_itagui.geojson",
  "/data/comunas_la_estrella.geojson",
  "/data/comunas_sabaneta.geojson",
];

// Paleta Medellín Social sobre papel #FAF8F3 — verde→teal→ámbar→coral (bueno→bajo)
function scoreToColor(score: number | null | undefined): string {
  if (score == null) return "#CFCabb";        // sin datos → gris papel apagado
  if (score >= 70) return "#0A5C36";           // tealDeep — top
  if (score >= 50) return "#0F8A4F";           // teal marca
  if (score >= 30) return "#E8A33D";           // ámbar cálido
  return "#CE1126";                            // coral marca (no rojo chillón)
}

type ComunaMetric = {
  score_promedio: number | null;
  has_data: boolean;
};

type ClickedBarrio = { nombre: string; municipio: string };

export function LandingMapHeader({
  flyToRef,
  hideOverlay = false,
}: {
  flyToRef?: React.MutableRefObject<((lat: number, lon: number, zoom?: number) => void) | null>
  hideOverlay?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const hoveredIdRef = useRef<number | string | undefined>(undefined);

  const [clicked, setClicked] = useState<ClickedBarrio | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [tooltip, setTooltip] = useState<{ nombre: string; municipio: string; x: number; y: number } | null>(null);
  const [mapActive, setMapActive] = useState(false);
  const lastTapRef = useRef(0);

  // Deactivate map when user taps outside the map container (mobile only)
  useEffect(() => {
    if (!isMobileWidth(window.innerWidth)) return;
    const onOutsideTap = (e: TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setMapActive(false);
      }
    };
    document.addEventListener("touchstart", onOutsideTap, { passive: true });
    return () => document.removeEventListener("touchstart", onOutsideTap);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-75.5812, 6.2442],
      zoom: 12,
      minZoom: 10.5,          // no zoom-out más allá del Valle de Aburrá
      maxBounds: [[-75.72, 6.05], [-75.42, 6.45]],
      pitch: 55,
      bearing: -30,
      interactive: true,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", async () => {
      // Terrain DEM for 3D mountain relief
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 0.8 });

      // Base map limpio estilo /map: fondo papel, agua/edificios apagados,
      // calles y POIs ocultos para que manden las comunas.
      map.getStyle().layers.forEach((layer) => {
        const lid = layer.id.toLowerCase();
        const srcLayer = (layer as Record<string, unknown>)["source-layer"] as string | undefined;
        const isStreet =
          lid.includes("road") || lid.includes("street") || lid.includes("bridge") ||
          lid.includes("tunnel") || lid.includes("transit") || lid.includes("path") ||
          lid.includes("pedestrian") || lid.includes("ferry") || lid.includes("motorway");

        if (layer.type === "symbol" || isStreet) {
          map.setLayoutProperty(layer.id, "visibility", "none");     // etiquetas + calles fuera
        } else if (layer.type === "background") {
          map.setPaintProperty(layer.id, "background-color", "#FAF8F3");
        } else if (layer.type === "fill" && srcLayer === "water") {
          map.setPaintProperty(layer.id, "fill-color", "#C9D6EE");
        } else if (layer.type === "line" && srcLayer === "waterway") {
          map.setPaintProperty(layer.id, "line-color", "#C9D6EE");
        } else if (layer.type === "fill" && srcLayer === "building") {
          map.setPaintProperty(layer.id, "fill-color", "#F3F0E8");
          map.setPaintProperty(layer.id, "fill-opacity", 0.4);
        } else if (layer.type === "fill" && srcLayer === "landuse") {
          map.setPaintProperty(layer.id, "fill-opacity", 0.3);
        }
      });

      try {
        const [staticFCs, metrics] = await Promise.all([
          Promise.all(
            COMUNA_STATIC.map((f) =>
              fetch(f).then((r) => r.json()).catch(() => ({ type: "FeatureCollection", features: [] })),
            ),
          ) as Promise<GeoJSON.FeatureCollection[]>,
          apiFetch<{ metrics: Record<string, ComunaMetric> }>(API_ENDPOINTS.comunasGeoJSON)
            .then((r) => r.metrics)
            .catch(() => ({} as Record<string, ComunaMetric>)),
        ]);

        // Merge comuna geometries, color by score_promedio from API metrics
        const features: GeoJSON.Feature[] = [];
        for (const fc of staticFCs) {
          for (const f of fc.features ?? []) {
            const cd = f.properties?.cd_comuna;
            const m = cd != null ? metrics[String(cd)] : undefined;
            const color = scoreToColor(m?.score_promedio);
            const hasData = m?.has_data ? 1 : 0;
            features.push({
              ...f,
              properties: { ...f.properties, color_hex: color, has_data: hasData },
            });
          }
        }

        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        map.addSource("comunas-landing", {
          type: "geojson",
          data: geojson,
          generateId: true,
        });

        // Insert below the first symbol layer so base-style labels/POIs render on top
        const firstSymbolId = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

        // Fill
        map.addLayer({
          id: "comunas-landing-fill",
          type: "fill",
          source: "comunas-landing",
          paint: {
            "fill-color": ["get", "color_hex"],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 0.88,
              ["==", ["get", "has_data"], 1], 0.62,
              0.15,
            ],
          },
        }, firstSymbolId);

        // Outline
        map.addLayer({
          id: "comunas-landing-outline",
          type: "line",
          source: "comunas-landing",
          paint: {
            "line-color": [
              "case",
              ["boolean", ["feature-state", "hover"], false], "#ffffff",
              "#000000",
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 1.5,
              0.3,
            ],
            "line-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false], 0.9,
              0.45,
            ],
          },
        }, firstSymbolId);

      } catch (err) {
        console.error("[LandingMapHeader] failed to load data", err);
      }
    });

    // Hover
    map.on("mousemove", "comunas-landing-fill", (e) => {
      if (!e.features?.length) return;
      const f = e.features[0];

      if (hoveredIdRef.current !== undefined) {
        map.setFeatureState(
          { source: "comunas-landing", id: hoveredIdRef.current },
          { hover: false },
        );
      }
      hoveredIdRef.current = f.id as number | string;
      map.setFeatureState(
        { source: "comunas-landing", id: hoveredIdRef.current },
        { hover: true },
      );

      const rect = containerRef.current?.getBoundingClientRect();
      const x = e.point.x;
      const y = e.point.y;
      const tooltipW = 160;
      const clampedX = Math.min(x + 12, (rect?.width ?? 9999) - tooltipW - 8);

      setTooltip({
        nombre: f.properties?.nombre ?? "",
        municipio: f.properties?.municipio ?? "",
        x: clampedX,
        y: Math.max(8, y - 52),
      });
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", "comunas-landing-fill", () => {
      if (hoveredIdRef.current !== undefined) {
        map.setFeatureState(
          { source: "comunas-landing", id: hoveredIdRef.current },
          { hover: false },
        );
      }
      hoveredIdRef.current = undefined;
      setTooltip(null);
      map.getCanvas().style.cursor = "";
    });

    map.on("click", "comunas-landing-fill", (e) => {
      if (!e.features?.length) return;
      const f = e.features[0];
      setClicked({
        nombre: f.properties?.nombre ?? "este barrio",
        municipio: f.properties?.municipio ?? "",
      });
    });

    if (flyToRef) {
      flyToRef.current = (lat, lon, zoom = 13) => {
        map.stop();
        map.flyTo({ center: [lon, lat], zoom, pitch: 50, duration: 1800, essential: true });
      };
    }

    return () => {
      if (flyToRef) flyToRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Map wrapper — 40vh on mobile, 55vh on sm+ */}
      <div
        className="landing-map-wrapper relative w-full overflow-hidden"
        style={{ height: "60svh", minHeight: "320px" }}
      >
        {/* Mapbox container */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Mobile overlay — transparent blocker; double-tap activates map interaction */}
        <div
          className="absolute inset-0 md:hidden"
          style={{ zIndex: 10, pointerEvents: mapActive ? "none" : "auto", background: "transparent" }}
          onTouchEnd={(e) => {
            const now = Date.now();
            if (now - lastTapRef.current < 300) {
              setMapActive(true);
              e.preventDefault();
            }
            lastTapRef.current = now;
          }}
        />

        {/* Toast — shown while map is active on mobile */}
        {mapActive && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-black/75 px-4 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm md:hidden">
            Mapa activado · Toca fuera para desactivar
          </div>
        )}

        {/* Bottom fade into page background */}
        {!hideOverlay && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
            style={{
              height: "130px",
              background: "linear-gradient(to bottom, transparent, #0B0D12)",
            }}
          />
        )}

        {/* Text overlay — top center */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center pt-10 text-center${hideOverlay ? ' hidden' : ''}`}>
          <h1
            className="font-display text-2xl font-bold text-white sm:text-4xl lg:text-5xl xl:text-6xl"
            style={{
              textShadow: "0 2px 28px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.7)",
            }}
          >
            Bienvenido al Valle de Aburrá
          </h1>
          <p
            className="mt-2 text-sm font-medium text-white/75 sm:text-base lg:text-lg"
            style={{ textShadow: "0 2px 14px rgba(0,0,0,0.95)" }}
          >
            Medellín y comunidades cercanas
          </p>
        </div>

        {/* Legend — bottom right */}
        {!hideOverlay && <div className="absolute bottom-[54px] right-3 z-20 hidden rounded-lg border border-white/15 bg-black/65 px-3 py-2 text-[11px] text-white backdrop-blur-sm sm:block">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0F8A4F]" />
              Alto potencial
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0F8A4F]" />
              Bueno
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#F2B807]" />
              Moderado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#CE1126]" />
              Bajo
            </span>
          </div>
        </div>}

        {/* Badge — bottom left */}
        {!hideOverlay && (
          <div className="absolute bottom-[54px] left-3 z-20 hidden rounded-full border border-white/15 bg-black/65 px-3 py-1.5 text-[11px] font-medium text-white/80 backdrop-blur-sm sm:flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            488 barrios analizados · Datos en vivo
          </div>
        )}

        {/* Scroll indicator — bottom center */}
        {!hideOverlay && (
          <div className="pointer-events-none absolute bottom-6 inset-x-0 z-20 flex flex-col items-center gap-0.5">
            <span
              className="text-[10px] font-semibold uppercase tracking-widest text-white/45"
              style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
            >
              Desplaza para explorar
            </span>
            <ArrowDown className="h-3.5 w-3.5 animate-bounce text-white/40" />
          </div>
        )}

        {/* Hover tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-30 rounded-lg border border-white/20 bg-black/85 px-3 py-1.5 text-xs text-white shadow-xl backdrop-blur-sm"
            style={{ left: tooltip.x, top: tooltip.y, minWidth: "120px" }}
          >
            <div className="font-semibold leading-tight"><Name>{tooltip.nombre}</Name></div>
            <div className="mt-0.5 text-white/55">{tooltip.municipio}</div>
          </div>
        )}

        {/* Choice modal */}
        {!hideOverlay && clicked && !showPaywall && (
          <BarrioChoiceModal
            barrio={clicked}
            onClose={() => setClicked(null)}
            onComunidad={() => {
              const slug = clicked.nombre
                .toLowerCase()
                .normalize("NFD")
                .replace(/[̀-ͯ]/g, "")
                .replace(/\s+/g, "-");
              window.location.href = `/${slug}`;
            }}
            onInversiones={() => setShowPaywall(true)}
          />
        )}

        {/* Paywall modal */}
        {!hideOverlay && clicked && showPaywall && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => { setClicked(null); setShowPaywall(false); }}
          >
            <div
              className="relative mx-4 w-full max-w-sm rounded-2xl border border-white/20 bg-[#0d1117] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="absolute right-3 top-3 rounded-md p-1 text-white/40 transition hover:text-white"
                onClick={() => { setClicked(null); setShowPaywall(false); }}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="text-[10px] font-bold uppercase tracking-widest text-primary">
                {clicked.municipio}
              </div>
              <h3 className="mt-1 font-display text-xl font-bold text-white">
                {clicked.nombre
                  .toLowerCase()
                  .split(" ")
                  .map((w) => w[0]?.toUpperCase() + w.slice(1))
                  .join(" ")}
              </h3>
              <p className="mt-1 text-sm text-white/50">Datos de inversión completos</p>

              <div className="mt-4 space-y-2">
                {[
                  "Precio/m² y arriendo real",
                  "Yield Airbnb con datos reales",
                  "Score de inversión personalizado",
                  "Conexión con agentes certificados",
                  "Simulador de retorno",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-white/80">
                    <span className="text-[#0F8A4F]">✅</span>
                    {item}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <Link
                  to="/register"
                  className="flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 glow-cyan"
                  onClick={() => { setClicked(null); setShowPaywall(false); localStorage.setItem("registro_origen", "mls"); }}
                >
                  Crear cuenta — Gratis →
                </Link>
                <Link
                  to="/login"
                  className="flex items-center justify-center rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
                  onClick={() => { setClicked(null); setShowPaywall(false); }}
                >
                  Ya tengo cuenta — Iniciar sesión
                </Link>
              </div>

              <p className="mt-4 text-center text-[11px] text-white/30">
                Acceso gratuito incluye perfil básico. Datos premium desde $5 USD/mes
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
