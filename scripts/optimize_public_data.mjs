#!/usr/bin/env node
// Shrinks public/data/*.geojson and *.json without visible change:
//  - GeoJSON coordinates rounded to 6 decimals (~0.11 m) and consecutive duplicate
//    vertices dropped (rings keep >= 4 points so they stay valid).
//  - JSON re-serialised compactly; barrios_stats.json lat/lng rounded to 6 decimals.
// Idempotent. Originals are recoverable from git history.
// Usage: node scripts/optimize_public_data.mjs [dir=public/data]
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || "public/data";
const r6 = (n) => Math.round(n * 1e6) / 1e6;

function simplifyLine(line, min) {
  const out = [];
  for (const [x, y, ...rest] of line) {
    const p = [r6(x), r6(y), ...rest];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out.length >= min ? out : line.map(([x, y, ...rest]) => [r6(x), r6(y), ...rest]);
}
function walk(coords, type, depth) {
  // depth 1 = array of positions (line / ring)
  if (depth === 1) return simplifyLine(coords, type.endsWith("Polygon") ? 4 : 2);
  return coords.map((c) => walk(c, type, depth - 1));
}
const DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
function geom(g) {
  if (!g) return g;
  if (g.type === "GeometryCollection") return { ...g, geometries: g.geometries.map(geom) };
  const d = DEPTH[g.type];
  if (d === 0) return { ...g, coordinates: g.coordinates.map(r6) };
  return { ...g, coordinates: walk(g.coordinates, g.type, d) };
}

for (const f of readdirSync(dir)) {
  const p = join(dir, f);
  const before = statSync(p).size;
  if (f.endsWith(".geojson")) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j.features) j.features = j.features.map((ft) => ({ ...ft, geometry: geom(ft.geometry) }));
    writeFileSync(p, JSON.stringify(j));
  } else if (f.endsWith(".json")) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (f === "barrios_stats.json" && Array.isArray(j)) {
      for (const b of j) for (const k of ["lat", "lng"]) if (typeof b[k] === "number") b[k] = r6(b[k]);
    }
    writeFileSync(p, JSON.stringify(j));
  } else continue;
  console.log(f, before, "->", statSync(p).size);
}
