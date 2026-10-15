import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createGzip, createBrotliCompress, brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const STATIC_DIR = process.env.STATIC_DIR || join(__dirname, 'dist/client');
const PUBLIC_DIR = join(__dirname, 'public');

// ── Build id (git sha). Written to dist/client/version.json by vite.config.ts at build;
// falls back to Railway's runtime sha, then "dev". Sent on every response (X-Build-Id) and
// at /version so clients/ops can tell which deploy they are talking to.
function readBuild() {
  try {
    const v = JSON.parse(readFileSync(join(STATIC_DIR, 'version.json'), 'utf8'));
    if (v && v.build) return v;
  } catch { /* no file */ }
  return { build: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || process.env.VITE_BUILD_ID || 'dev', builtAt: null };
}
const BUILD = readBuild();
const STARTED_AT = new Date().toISOString();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const { default: app } = await import('./dist/server/server.js');

// Text formats compress ~80-90%. Binary formats are already compressed.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.geojson', '.svg', '.txt', '.xml']);

// ── Security headers ─────────────────────────────────────────────────────────
// API origin for connect-src: build-time VITE_API_URL is also a runtime var on Railway.
function originOf(u) {
  try { return new URL(u).origin; } catch { return null; }
}
const API_ORIGIN =
  originOf(process.env.API_ORIGIN || process.env.VITE_API_URL || '') ||
  'https://medellinsocial-api.up.railway.app';
// Public canonical origin (sitemap, robots, canonical links). Same value the build
// gets as VITE_SITE_URL.
const SITE_URL = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://medellinsocial.com').replace(/\/+$/, '');

// Indexable public pages (keep in sync with src/lib/seo.ts SITE_PAGES).
const SITEMAP_PATHS = [
  '/', '/map', '/planes', '/agentes', '/comunidad', '/vender', '/publicar', '/simulador',
  '/calculadora', '/comparador', '/real-estate', '/blog', '/stores', '/suscribirse',
  '/pasantias', '/afiliado', '/embajador', '/planes/listing-member', '/planes/featured-realtor',
  '/planes/hot-spot', '/planes/deal',
];
const ROBOTS_TXT = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /panel-x9k2',
  'Disallow: /admin',
  'Disallow: /perfil',
  'Disallow: /mis-propiedades',
  'Disallow: /solicitudes',
  'Disallow: /realtor/',
  'Disallow: /onboarding',
  'Disallow: /reset-password',
  'Disallow: /verify-email',
  'Disallow: /login/verificar',
  `Sitemap: ${SITE_URL}/sitemap.xml`,
  '',
].join('\n');
function sitemapXml() {
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${SITE_URL}${p === '/' ? '/' : p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// CSP violation reports (report-only policy): logged in one line each, capped so a
// noisy page or a hostile client cannot flood the logs.
const CSP_REPORT_MAX_BYTES = 16 * 1024;
const CSP_REPORTS_PER_MIN = 60;
let cspWindowStart = 0;
let cspInWindow = 0;
async function handleCspReport(req, res) {
  const now = Date.now();
  if (now - cspWindowStart > 60_000) { cspWindowStart = now; cspInWindow = 0; }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > CSP_REPORT_MAX_BYTES) break;
    chunks.push(c);
  }
  if (size <= CSP_REPORT_MAX_BYTES && ++cspInWindow <= CSP_REPORTS_PER_MIN) {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const reports = Array.isArray(body) ? body.map((r) => r.body || r) : [body['csp-report'] || body];
      for (const r of reports) {
        const directive = r['violated-directive'] || r.effectiveDirective || r['effective-directive'];
        const blocked = r['blocked-uri'] || r.blockedURL || r['blocked-url'];
        const doc = r['document-uri'] || r.documentURL || r['document-url'];
        console.warn(`[csp] ${directive} blocked=${String(blocked).slice(0, 200)} page=${String(doc).slice(0, 200)}`);
      }
    } catch { /* malformed report: ignore */ }
  }
  res.statusCode = 204;
  res.end();
}

const SENTRY_ORIGIN = 'https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io';
// Hosts allowed in <iframe> = src/lib/embed.ts EMBED_HOSTS (+ the embed URLs they rewrite to).
const FRAME_SRC = [
  "'self'", 'https://accounts.google.com',
  'https://my.matterport.com', 'https://matterport.com', 'https://kuula.co', 'https://cloudpano.com',
  'https://istaging.com', 'https://ricoh360.com', 'https://insta360.com', 'https://www.youtube.com',
  'https://www.youtube-nocookie.com', 'https://player.vimeo.com',
].join(' ');

// Full policy, ENFORCED (CSP_ENFORCE=0 falls back to report-only). Checked in a real browser
// with live map tiles, home, map, agentes, eventos, comparador and negocios: 0 violations.
// Inline scripts are required by TanStack Start hydration and the <html lang> bootstrap,
// hence 'unsafe-inline' (nonces would need SSR support); every other source is allow-listed.
const CSP_FULL = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mapbox.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${API_ORIGIN} https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://accounts.google.com ${SENTRY_ORIGIN}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  `frame-src ${FRAME_SRC}`,
  "media-src 'self' blob: https:",
  "manifest-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  'report-uri /csp-report',
].join('; ');
const CSP_ENFORCE = process.env.CSP_ENFORCE !== '0';
// Minimum always enforced, even in report-only mode: clickjacking / plugins / base-tag.
const CSP_MINIMUM = "frame-ancestors 'self'; object-src 'none'; base-uri 'self'";

function baseHeaders(res) {
  res.setHeader('X-Build-Id', BUILD.build);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); // Google sign-in popup
  if (CSP_ENFORCE) {
    res.setHeader('Content-Security-Policy', CSP_FULL);
  } else {
    res.setHeader('Content-Security-Policy', CSP_MINIMUM);
    res.setHeader('Content-Security-Policy-Report-Only', CSP_FULL);
  }
}

// ── Compression ──────────────────────────────────────────────────────────────
function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}

// Immutable/static payloads are compressed once per (file, mtime, encoding) and kept in
// memory, so big chunks (mapbox-gl) and geojson cost CPU only on the first hit. Brotli q5.
const compCache = new Map();
const COMP_CACHE_MAX_BYTES = 64 * 1024 * 1024;
let compCacheBytes = 0;
async function compressedFile(filePath, st, enc) {
  const key = `${filePath}|${st.mtimeMs}|${st.size}|${enc}`;
  const hit = compCache.get(key);
  if (hit) return hit;
  const raw = await readFile(filePath);
  const buf = enc === 'br'
    ? await brotliAsync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
    : await gzipAsync(raw, { level: 6 });
  if (compCacheBytes + buf.length < COMP_CACHE_MAX_BYTES) {
    compCache.set(key, buf);
    compCacheBytes += buf.length;
  }
  return buf;
}

function resolveStatic(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  for (const root of [STATIC_DIR, PUBLIC_DIR]) {
    const filePath = join(root, decoded);
    if (filePath !== root && !filePath.startsWith(root + sep)) continue; // path traversal guard
    if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  }
  return null;
}

function cacheControlFor(pathname, ext) {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'; // content-hashed filenames
  if (pathname.startsWith('/data/')) return 'public, max-age=300, stale-while-revalidate=600'; // revalidated via ETag
  if (ext === '.html') return 'no-cache';
  if (pathname === '/version.json') return 'no-store';
  // Unhashed public files (favicon, og-image, brand images, robots, sitemap): 1 day, then revalidate.
  return 'public, max-age=86400, stale-while-revalidate=604800';
}

async function tryServeStatic(pathname, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const filePath = resolveStatic(pathname);
  if (!filePath) return false;

  const st = statSync(filePath);
  const ext = extname(filePath);
  const compress = COMPRESSIBLE.has(ext) ? pickEncoding(req) : null;
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${compress ? '-' + compress : ''}"`;

  baseHeaders(res);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', cacheControlFor(pathname, ext));
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  if (COMPRESSIBLE.has(ext)) res.setHeader('Vary', 'Accept-Encoding');

  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return true;
  }

  if (compress) {
    const buf = await compressedFile(filePath, st, compress);
    res.setHeader('Content-Encoding', compress);
    res.setHeader('Content-Length', buf.length);
    res.end(req.method === 'HEAD' ? undefined : buf);
  } else {
    res.setHeader('Content-Length', st.size);
    if (req.method === 'HEAD') res.end();
    else createReadStream(filePath).pipe(res);
  }
  return true;
}

function sendJson(res, status, body, cache = 'no-store') {
  baseHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

const COMPRESSIBLE_TYPE = /^(text\/|application\/(json|javascript|xml|geo\+json)|image\/svg)/;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // Liveness/readiness. Cheap: no SSR work, no DB. Deliberately not in railway.toml (that file is
  // shared by 3 services); point the web service's healthcheck path at /healthz in the dashboard.
  if (url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, build: BUILD.build, uptime_s: Math.round(process.uptime()) });
  }
  if (url.pathname === '/version') {
    return sendJson(res, 200, { build: BUILD.build, builtAt: BUILD.builtAt, startedAt: STARTED_AT });
  }
  if (url.pathname === '/csp-report' && req.method === 'POST') {
    return handleCspReport(req, res);
  }
  if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') {
    baseHeaders(res);
    const robots = url.pathname === '/robots.txt';
    res.setHeader('Content-Type', robots ? MIME['.txt'] : MIME['.xml']);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(robots ? ROBOTS_TXT : sitemapXml());
  }

  try {
    if (await tryServeStatic(url.pathname, req, res)) return;
  } catch (err) {
    console.error('static error:', err);
    if (!res.headersSent) { res.statusCode = 500; res.end('Internal Server Error'); }
    return;
  }

  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }

    const init = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req);
      init.duplex = 'half';
    }

    const response = await app.fetch(new Request(`http://localhost${req.url}`, init));

    baseHeaders(res);
    res.statusCode = response.status;
    for (const [k, v] of response.headers.entries()) {
      // Node merges these itself; a duplicate set-cookie must stay multi-valued
      if (k === 'set-cookie') continue;
      res.setHeader(k, v);
    }
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader('Set-Cookie', cookies);

    // SSR HTML must always revalidate so a deploy is picked up on the next navigation
    // (hashed /assets/* stay immutable; a stale HTML would point at deleted chunks).
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('text/html') && !response.headers.has('cache-control')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    res.setHeader('X-Build-Id', BUILD.build);

    const enc = COMPRESSIBLE_TYPE.test(ct) && !response.headers.has('content-encoding') ? pickEncoding(req) : null;
    if (enc && response.body) {
      res.setHeader('Content-Encoding', enc);
      res.setHeader('Vary', 'Accept-Encoding');
      res.removeHeader('Content-Length');
      // Streaming SSR: flush after each chunk so first bytes still go out early.
      const z = enc === 'br'
        ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
        : createGzip({ level: 6 });
      z.pipe(res);
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          z.write(value);
          z.flush();
        }
      } finally {
        reader.releaseLock();
        z.end();
      }
      return;
    }

    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    res.end();
  } catch (err) {
    console.error('SSR error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    } else {
      res.end();
    }
  }
}).listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`Listening on port ${PORT} (build ${BUILD.build})`);
});
