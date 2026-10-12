import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createGzip, createBrotliCompress, constants } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const STATIC_DIR = join(__dirname, 'dist/client');
const PUBLIC_DIR = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

const { default: app } = await import('./dist/server/server.js');

// Text formats compress ~80-90% (geojson especially — repetitive coordinate
// text). Binary formats (images, fonts, .pbf tiles) are already compressed —
// gzipping them again wastes CPU for no size gain, so only compress these.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.geojson', '.svg']);

function tryServeStatic(pathname, req, res) {
  // Try dist/client first, then public/ as fallback for data files
  let filePath = join(STATIC_DIR, pathname);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(PUBLIC_DIR, pathname);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  }

  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  if (pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (pathname.startsWith('/data/')) {
    // Not immutable (files change on redeploy) — 1h fresh window matches the API's
    // hourly refresh; stale-while-revalidate serves instantly for up to a day while
    // refetching in the background, so repeat map loads don't re-pay these bytes.
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';
  const source = createReadStream(filePath);
  if (COMPRESSIBLE.has(ext) && acceptEncoding.includes('br')) {
    res.setHeader('Content-Encoding', 'br');
    // Brotli quality 4 (not the default 11): ~95% of the compression at a fraction
    // of the CPU. q11 on a 2MB geojson stalled TTFB 2–3.5s PER request (compressed
    // on every hit, never cached); q4 drops that to ~150ms. Same for JS bundles.
    source.pipe(createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })).pipe(res);
  } else if (COMPRESSIBLE.has(ext) && acceptEncoding.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    source.pipe(createGzip()).pipe(res);
  } else {
    source.pipe(res);
  }
  return true;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  if (tryServeStatic(url.pathname, req, res)) return;

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

    res.statusCode = response.status;
    for (const [k, v] of response.headers.entries()) {
      res.setHeader(k, v);
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
    }
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on port ${PORT}`);
});
