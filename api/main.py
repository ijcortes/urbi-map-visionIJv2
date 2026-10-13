import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from api.db import create_pool, close_pool, get_pool
from api import parametros
from api.cache import refresh_listings_cache, run_periodic_cache_refresh
from api.limiter import limiter
from api.routers import admin, admin_agentes, afiliados, agency, alertas, asignador, auth, barrios, business, calculadora, comparador, comunidad, comunidad_posts, comunas, embajadores, favoritos, ghl_leads, ghl_webhook, historial, intake, listings, listings_propios, moderacion, oportunidades, pasantias, realtor, stats, suscripciones, tracking, trm, usuario, visitas, zonas

# Sentry — only active when SENTRY_DSN is set (optional in local/test)
_SENTRY_DSN = os.getenv("SENTRY_DSN", "")
if _SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.asyncio import AsyncioIntegration

    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        integrations=[FastApiIntegration(), AsyncioIntegration()],
        traces_sample_rate=0.1,
        environment=os.getenv("RAILWAY_ENVIRONMENT", "development"),
        send_default_pii=False,
    )

logger = structlog.get_logger()

_IS_PROD = bool(os.getenv("RAILWAY_ENVIRONMENT")) and os.getenv("RAILWAY_ENVIRONMENT") != "development"

_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:8080",
    "http://localhost:8081",
    "http://localhost:8082",
]

_LOCAL_ORIGINS = [
    "https://urbidata.co",
    "https://www.urbidata.co",
    "https://medellinsocial.com",
    "https://www.medellinsocial.com",
]

def _build_origins() -> list[str]:
    extra = os.getenv("CORS_ORIGINS", "")
    extras = [o.strip() for o in extra.split(",") if o.strip()]
    return _LOCAL_ORIGINS + ([] if _IS_PROD else _DEV_ORIGINS) + extras


async def _connect_with_retry() -> None:
    for attempt in range(1, 11):
        try:
            await create_pool()
            return
        except Exception as exc:
            print(f"[DB] attempt {attempt}/10 failed: {exc}", flush=True)
            if attempt == 10:
                print("[DB] giving up after 10 attempts", flush=True)
                return
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _connect_with_retry()
    await parametros.load()
    pool = get_pool()
    # Reactivado 2026-08-21: raw.listings_metrocuadrado ya tiene las 90k filas
    # reales sincronizadas desde local (ver 0071). fincaraiz/premium/renta_media/
    # listings_propios/listing siguen vacías en prod — el rebuild reflejará eso
    # hasta que se sincronicen aparte.
    await refresh_listings_cache(pool)
    _refresh_task = asyncio.create_task(run_periodic_cache_refresh(pool))
    yield
    _refresh_task.cancel()
    await close_pool()


app = FastAPI(
    title="Medellin Social API",
    description="Motor de decisión de inversión inmobiliaria — Valle de Aburrá",
    version="1.0.0",
    lifespan=lifespan,
    # Swagger/OpenAPI exposed only outside production (set EXPOSE_DOCS=1 to override).
    docs_url=None if _IS_PROD and not os.getenv("EXPOSE_DOCS") else "/docs",
    redoc_url=None if _IS_PROD and not os.getenv("EXPOSE_DOCS") else "/redoc",
    openapi_url=None if _IS_PROD and not os.getenv("EXPOSE_DOCS") else "/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/health", include_in_schema=False)
async def health():
    # Railway healthcheckPath. Sin DB a propósito: responde apenas uvicorn
    # sirve. Si alembic/arranque falla (uvicorn nunca sube), da 502 y Railway
    # no reemplaza el deploy bueno — el fallo del 2026-10-04 no habría tumbado prod.
    return {"status": "ok"}


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    logger.info(
        "request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration=round(time.time() - start, 3),
    )
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Cheap hardening: headers only, no behavior change. HSTS is meaningful over
    # HTTPS (Railway edge); nosniff/Referrer-Policy apply to JSON, X-Frame-Options
    # protects the /admin SPA served from this app against clickjacking.
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
    return response

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_build_origins(),
    allow_origin_regex=r"https://.*\.(lovable\.app|lovableproject\.com|up\.railway\.app)$",
    # No cookie/session auth anywhere (Bearer JWT only, checked api/dependencies.py) —
    # allow_credentials=True bought nothing but let any subdomain of these shared,
    # publicly-registrable platforms make credentialed cross-origin calls.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,          prefix="/api/v1/auth",          tags=["auth"])
app.include_router(barrios.router,       prefix="/api/v1/barrios",        tags=["barrios"])
app.include_router(listings.router,      prefix="/api/v1/listings",       tags=["listings"])
app.include_router(calculadora.router,   prefix="/api/v1/calculadora",    tags=["calculadora"])
app.include_router(oportunidades.router, prefix="/api/v1/oportunidades",  tags=["oportunidades"])
app.include_router(usuario.router,       prefix="/api/v1/usuario",        tags=["usuario"])
app.include_router(favoritos.router,     prefix="/api/v1/favoritos",      tags=["favoritos"])
app.include_router(historial.router,     prefix="/api/v1/historial",      tags=["historial"])
app.include_router(stats.router,         prefix="/api/v1/stats",           tags=["stats"])
app.include_router(trm.router,           prefix="/api/v1/trm",             tags=["trm"])
app.include_router(tracking.router,      prefix="/api/v1/track",           tags=["tracking"])
app.include_router(admin.router,         prefix="/api/v1/admin",           tags=["admin"])
app.include_router(comunidad.router,     prefix="/api/v1/comunidad",        tags=["comunidad"])
app.include_router(comunidad_posts.router, prefix="/api/v1/comunidad/posts", tags=["comunidad-posts"])
app.include_router(comunas.router,       prefix="/api/v1/comunas",           tags=["comunas"])
app.include_router(business.router,      prefix="/api/v1/business",          tags=["business"])
app.include_router(embajadores.router,   prefix="/api/v1/embajadores",       tags=["embajadores"])
app.include_router(afiliados.router,     prefix="/api/v1/afiliados",         tags=["afiliados"])
app.include_router(pasantias.router,     prefix="/api/v1/pasantias",         tags=["pasantias"])
app.include_router(listings_propios.router,  prefix="/api/v1/listings-propios",   tags=["listings-propios"])
app.include_router(suscripciones.router,    prefix="/api/v1/suscripciones",       tags=["suscripciones"])
app.include_router(alertas.router,          prefix="/api/v1/alertas",              tags=["alertas"])
app.include_router(comparador.router,       prefix="/api/v1/comparador",           tags=["comparador"])
app.include_router(intake.router,           prefix="/api/v1",                      tags=["realtor-intake"])
app.include_router(moderacion.router,       prefix="/api/v1/admin",                tags=["realtor-moderacion"])
app.include_router(admin_agentes.router,    prefix="/api/v1/admin",                tags=["realtor-admin-agentes"])
app.include_router(asignador.router,        prefix="/api/v1",                      tags=["realtor-asignador"])
app.include_router(realtor.router,          prefix="/api/v1/realtor",              tags=["realtor-dashboard"])
app.include_router(agency.router,           prefix="/api/v1/agency",               tags=["agency-dashboard"])
app.include_router(visitas.router,          prefix="/api/v1/visitas",              tags=["visitas"])
app.include_router(zonas.router,            prefix="/api/v1/zonas",                tags=["zonas"])
app.include_router(ghl_webhook.router,       prefix="/api/v1/webhook",              tags=["ghl-webhook"])
app.include_router(ghl_leads.router,         prefix="/api/v1/ghl",                  tags=["ghl-leads"])


@app.get("/", tags=["meta"])
async def root():
    return {"status": "ok"}


# ── Admin panel (SPA) ─────────────────────────────────────────────────────────
_ADMIN_DIST = Path(__file__).parent / "admin_dist"

if _ADMIN_DIST.exists():
    _ADMIN_ASSETS = _ADMIN_DIST / "assets"
    if _ADMIN_ASSETS.exists():
        app.mount("/admin/assets", StaticFiles(directory=str(_ADMIN_ASSETS)), name="admin-assets")

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/{full_path:path}", include_in_schema=False)
    async def serve_admin(full_path: str = ""):
        return FileResponse(str(_ADMIN_DIST / "index.html"))


@app.get("/health", tags=["meta"])
async def health():
    try:
        pool = get_pool()
        db_ok = pool is not None
    except RuntimeError:
        db_ok = False
    return {"status": "ok", "version": "1.0.0", "db": db_ok}
