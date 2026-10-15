# ALL-ISSUES — status after branch `fix/all-issues` (2026-10-14)

Source: `ALL-ISSUES.pdf` (272 rows: 120 FIXED, 72 OPEN, 18 NEEDS DECISION, 16 NEEDS OWNER ACTION,
32 NOT VERIFIED, 14 INFO). This branch = `fix/prod-readiness` (32 commits, all 120 FIXED rows) +
the commits below. Every OPEN row was handled; rows that need a person are listed at the end.

Verification on this branch: `tsc` clean · vitest 192/192 · `vite build` OK · pytest 230 passed
(84 DB-only tests deselected) · migrations 0111/0112 up/down/up on Postgres 16 / PostGIS 3.4 ·
new serving SQL, stale rule, soft dedup, quality job run on PostGIS fixtures · local production
build checked in a real browser (real Mapbox tiles, enforced CSP: 0 violations) · eslint
non-formatting errors 22 → 19.

## OPEN → fixed

| Area | IDs | What changed |
|---|---|---|
| Security-Auth | SEA-07 | Email throttles + per-account login lockout counted in Postgres (`throttle_hits`), not per process |
| | SEA-09 | Legacy (pre-jti) blacklist rows stored as sha256; migration 0111 rewrites existing rows |
| | SEA-12 | CORS wildcard regex only via `CORS_ORIGIN_REGEX`; prod default none |
| | SEA-13 | 422 handler drops the echoed `input` |
| | SEA-14 | Stripe webhook: event-id idempotency (`stripe_events`), bad signature → 400 |
| | SEA-15 | `GHL_LEADS_TOKEN` accepts "old,new" for rotation; optional `GHL_LEADS_ALLOWED_IPS` |
| | SEA-16 | Intake detail: explicit column list |
| | SEA-17 | Phone code: 5 wrong attempts burn the code |
| | SEA-19 | Audit log uses trusted-proxy IP; `/admin/test-email` only to admin/self |
| | SEA-20 | Length caps on review comments and post URLs |
| | SEA-21 | Opt-in HttpOnly cookie sessions (`AUTH_COOKIE_MODE` / `VITE_AUTH_COOKIE_MODE`) with CSRF guard — see owner list |
| | SEA-22 | Optional `ADMIN_ALLOWED_IPS`, `ADMIN_REQUIRE_DB_ROLE` (+ `usuarios.rol`), re-auth no longer 500s for password-less admin |
| Backend/API | API-13 | Visita no longer calls the unimplemented GHL push on every request |
| | API-14 | First-time GHL push failures kept in `ghl_push_failures` |
| | API-19 | `usuarios.rol` created (migration 0111) |
| | API-20 | Emails masked in logs |
| | API-21 | `tipo_operacion` / `tipo_inmueble` lower-cased in serving + dbt |
| Currency | CUR-16 | Barrio `precio_m2_usd` / `adr_usd` and comparador use the shared TRM |
| Data & Scraping | DAT-01 | Plausibility bounds in serving (raw untouched); counted at scrape time |
| | DAT-02, DAT-23 | `last_seen_at` + `scrape_runs` coverage + stale rule (2 complete full passes, 30 % brake); MC/Habi daily, full passes Sundays |
| | DAT-04, DAT-13 | Barrio = polygon, else nearest within 300 m; MC sets `barrio_id` at insert |
| | DAT-05 | Valle check against barrio polygons (Rionegro/Guarne rejected) |
| | DAT-06 | `dedup_fincaraiz.py` marks `duplicado_de`, never DELETEs |
| | DAT-07 | Cross-portal dedup: DBSCAN 40 m + ~5 % price bucket |
| | DAT-08 | Stacked coordinates spread ≤45 m + `geo_aproximada` flag |
| | DAT-10, DAT-11, DAT-12 | `destacado`, `anunciante_tipo`, `moneda`, `precio_incluye_admin`, `area_tipo` captured (FincaRaíz fields checked live) |
| | DAT-14 | No-photo pins ordered last |
| | DAT-16, DAT-18, DAT-20, DAT-26 | Retry/backoff, non-zero exit on truncation / >20 % unparseable, 3-old-pages stop rule, coverage vs total, FincaRaíz full pass up to 600 pages |
| | DAT-17 | robots.txt honoured (all scraped paths allowed), identifying User-Agent |
| | DAT-19 | Fixture tests for FincaRaíz/Metrocuadrado normalizers; one shared dedup hash |
| | DAT-21, DAT-22 | Airflow DAGs unscheduled unless `AIRFLOW_SCHEDULES_ENABLED=1`; nightly `data_quality_check.py` with Sentry/webhook alerts |
| | DAT-24 | Paid-API ledger + monthly caps (AirROI, Google Places) |
| | DAT-27 | Habi seller e-mail/phone no longer stored (existing values cleared on refresh) |
| | DAT-28 | Legacy `migrate_fotos_s3.py` (public-read ACL) removed |
| Link Health | LNK-12 | `activo` on premium / renta_media; serving honours it |
| Language | LNG-13 | Property age parsed + rendered per language |
| | LNG-14 | All toasts translated (incl. a map error toast that was English-only) |
| | LNG-16 | One price label per variant |
| | LNG-17 | `useT()` + documented policy (dictionary for static copy, `useT` for code-built text, `<Name>`, enum tables); scan test enforces it. Not a rewrite of every page to keys |
| | LNG-20 | `<Name>` keeps API names out of the dictionary |
| | LNG-21 | Language-aware aria-labels / alts |
| | LNG-22 | 126 phrases; scan test now covers dashboards, publicar, admin, home, simulador, comparador, … |
| | LNG-24 | `{es,en}` tables for API enum codes |
| Map | MAP-07 | Keep API comuna when GeoJSON lacks the barrio |
| | MAP-09 | Barrio polygons loaded into the source once |
| | MAP-14 | Mobile: no terrain/fog/antialias, no tap delay, min zoom fits the valley on 360 px |
| Mobile | MOB-05..09 | Map ignores touches under drawer, popup capped under header, pill overlap fixed, icon buttons labelled, dead popup builder removed |
| Caching/SEO | CAC-04 | 2 min client staleness, refetch on focus, expiring viewport dedupe, API max-age 60 + SWR |
| | CAC-07 | Per-route title/description/canonical/OG, private pages noindex, `robots.txt` + `sitemap.xml` |
| | CAC-08 | OG image rebranded to Medellín Social |
| | CAC-09 | `/csp-report` endpoint (logged, capped) |
| Performance | PER-02 | FloatingPanel / MLSPanel / ListingDrawer lazy (map chunk 258 → 113 kB) |
| | PER-03 | Fill-only icon SVGs (entry 915 → 661 kB) |
| XSS | XSS-03 | Full CSP enforced after a real-browser pass (`CSP_ENFORCE=0` = report-only) |
| Secrets/Infra | SEI-11 | Cron jobs run as non-root `app` user |
| | SEI-13 | No hard-coded prod API host fallback |
| | SEI-05 (code part) | Mapbox token removed from `.lovable/plan.md` |
| Deps | DEP-02, DEP-03 | vitest 5, TanStack Start/Router updates, unused Cloudflare plugin chain removed: npm audit 30 → 10 |

## NOT VERIFIED → verified here

| ID | Result |
|---|---|
| LNG-14 | Toast strings checked; missing ones translated |
| XSS-04 | No `target=_blank` / `window.open` without noopener |
| XSS-05 | App never builds URLs from forwarded headers |
| SEA-24 | Test: every admin route depends on `require_admin` |
| SEI-07 | 1,111 base64 blobs in history decoded: no secrets |
| SEI-08 | `social:` DB user uses the same (already listed) password — rotate both users |
| SEI-09 | Metrocuadrado key is public (in metrocuadrado.com HTML); Habi key not found in public homepage bundles |
| OPS-06 / UNT-01 | Real tiles work; a rejected token now shows an error + reload instead of an endless veil |
| UNT-09 (partial) | 375 px: valley fits, layout checked; against the old live API only |

## Still needs a person (cannot be done in code)

**Decisions (Ken/Edward/Talal):** SEA-03 agent contact gating · PRD-1 Ciudad del Río comuna · PRD-2
finca/lote = commercial · PRD-3 150k / 500k price floors · PRD-4/API-15 GHL webhook signing +
payload contract · PRD-7/API-12 push leads to GHL? · PRD-6 auto-retire · CUR-15 EUR · MAP-17/19
defaults · MAP-18 curated polygons · PER-11 orphan routes · SEA-29 grandfather unverified accounts ·
SEI-06 history rewrite · DAT-25/29/30 scraping legality + strategy (counsel).

**Owner actions:** rotate AirROI key + DB password (both `urbidata` and `social`), restrict the Mapbox
token by URL · create/verify the admin account before deploy · Railway vars (see
`railway.env.example`, now also `SITE_URL`/`VITE_SITE_URL`, optional cookie/IP settings) · healthcheck
`/healthz` · confirm `alembic upgrade head` runs (0111, 0112) · `ENABLE_SIMULATED_PAYMENTS` unset ·
GHL secret · membership links · SEA-21: serve the API as `api.medellinsocial.com`, then turn on
cookie mode.

**Staging checks:** Google sign-in, GHL checkout, outbound e-mail, Railway deploy, R2 bucket policy,
live headers, DB-backed IDOR test, link-checker markers and portal reaction, cron image build.

**Remaining npm audit (10):** all inside `lovable-tagger` → Tailwind 3 (dev-only; `braces` has no
fixed version upstream) + one low esbuild advisory. Not shipped to users.
