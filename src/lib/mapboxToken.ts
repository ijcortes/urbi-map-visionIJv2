// Mapbox PUBLIC token (pk.*). Safe to ship in the client bundle, but it MUST
// come from the environment (VITE_MAPBOX_TOKEN, Dockerfile build arg).
// No literal fallback: a missing token must fail loudly (MapView shows tokenError).
export const MAPBOX_TOKEN: string = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? "";

if (!MAPBOX_TOKEN && typeof console !== "undefined") {
  console.error("[mapbox] VITE_MAPBOX_TOKEN is not set: the map cannot load. Set it at build time.");
}
