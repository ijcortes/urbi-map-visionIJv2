## Wire up your Mapbox token

Embed your public Mapbox token directly in the client (it's a `pk.*` key — safe to ship) and remove the now-unneeded server roundtrip.

### Changes
1. **`src/lib/mapboxToken.ts`** — set `MAPBOX_TOKEN` to your token:
   `<VITE_MAPBOX_TOKEN — set in Railway, never committed>`
2. **`src/components/MapView.tsx`** — revert to importing `MAPBOX_TOKEN` directly, drop the `useState`/`getMapboxToken()` effect, keep the existing fallback error UI for safety.
3. **`src/server/mapbox.functions.ts`** — delete (no longer used).

After this, the dark Medellín map renders immediately on `/map`.