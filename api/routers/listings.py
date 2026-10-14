import asyncio
import hashlib
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from api.db import get_pool
from api.dependencies import get_current_user, get_optional_user, is_agente
from api.limiter import limiter
from api.services.asignador_service import asignar_intake
from api.services.intake_service import get_or_create_owner
from api.services.personalizacion import calcular_relevancia, get_match_label, PRESUPUESTO_MAX
from api.services.trm_service import cop_from_moneda, get_usd_rate, usd_from_cop

logger = logging.getLogger(__name__)

# tipo_inmueble scrapeado → enum intake_tipo_inmueble (apartamento|casa|local|oficina|lote|finca)
_INTAKE_TIPO = {
    "apartamento": "apartamento", "apartaestudio": "apartamento",
    "casa": "casa", "local": "local", "oficina": "oficina",
    "bodega": "local", "lote": "lote", "finca": "finca",
}

router = APIRouter()

# ── Segment / type normalisation ─────────────────────────────────────────────
# `segmento` splits the flat tipo_inmueble list into residential vs commercial.
# COMERCIAL is an explicit prefix list; RESIDENCIAL is its complement (so an
# unknown/NULL type never silently disappears from residential searches).
# ASSUMPTION: finca/lote/terreno are grouped with commercial (rural / land use).
_COMERCIAL_PREFIXES = (
    "local", "oficina", "bodega", "lote", "finca", "edificio", "consultorio",
    "parqueadero", "galpon", "galpón", "hotel", "terreno", "predio", "industrial",
)
_COMERCIAL_RE = "^(" + "|".join(_COMERCIAL_PREFIXES) + ")"
SEGMENTOS = ("residencial", "comercial", "todos")
_RENT_SALE = ("arriendo", "venta")


def _norm_tipo(t: Optional[str]) -> Optional[str]:
    """Lower-case + apartaestudio -> apartamento (studios are apartments with 0 rooms)."""
    if t is None:
        return None
    t = t.strip().lower()
    return "apartamento" if t == "apartaestudio" else t


def _norm_tipos(tipos: Optional[list[str]]) -> Optional[list[str]]:
    out: list[str] = []
    for t in tipos or []:
        n = _norm_tipo(t)
        if n and n not in out:
            out.append(n)
    return out or None


def _effective_segmento(segmento: Optional[str], tipo_operacion: Optional[str],
                        tipo_inmueble: Optional[list[str]]) -> Optional[str]:
    """None = no segment filter. Default 'residencial' for rent/sale searches
    unless the caller picked explicit property types or asked for 'todos'."""
    if segmento == "todos":
        return None
    if segmento in ("residencial", "comercial"):
        return segmento
    if tipo_operacion in _RENT_SALE and not tipo_inmueble:
        return "residencial"
    return None


def _finalize_row(d: dict, rate: float) -> dict:
    """Query-time normalisation shared by every listings endpoint:
    * precio_usd from the ONE shared TRM rate (rounded, not truncated);
    * apartaestudio -> apartamento with habitaciones 0;
    * url is the external source link; null for our own (fuente='propio')
      listings, whose staging `url` is just the internal listing id."""
    if d.get("precio_cop") is not None:
        d["precio_usd"] = usd_from_cop(d["precio_cop"], rate)
    if (d.get("tipo_inmueble") or "").strip().lower() == "apartaestudio":
        d["tipo_inmueble"] = "apartamento"
        d["habitaciones"] = 0
    if d.get("fuente") == "propio":
        d["url"] = None
    elif not d.get("url"):
        d["url"] = None
    return d


_FEATURED_TIERS_SQL = "'agente_premium', 'agencia_premium'"

_AMENIDADES_VARIANTS: dict[str, list[str]] = {
    "piscina":                ["Piscina"],
    "gimnasio":               ["Gimnasio"],
    "ascensor":               ["Ascensor", "Número de Ascensores 1", "Número de Ascensores 2",
                               "Número de Ascensores 3", "Número de Ascensores 4"],
    "balcon":                 ["Terraza/Balcón balcón"],
    "lavanderia":             ["Zona de lavanderia"],
    "conjunto_cerrado":       ["Conjunto cerrado"],
    "cocina_integral":        ["Cocina integral"],
    "aire_acondicionado":     ["Aire acondicionado", "Ventilación aire acondicionado"],
    "salon_comunal":          ["Salón  comunal"],
    "zona_ninos":             ["Zona para niños"],
    "parqueadero_visitantes": ["Parqueadero visitantes"],
    "vigilancia":             ["Vigilancia 24hrs", "Vigilancia"],
    "camaras":                ["Circuito cerrado de TV"],
    "transporte":             ["Cerca Transporte Público"],
    "zonas_verdes":           ["Zonas verdes"],
    "porteria":               ["Recepción Lobby"],
}


def _build_amenidades_sql(keys: list[str], base: int = 17) -> tuple[str, list]:
    """Returns (WHERE clauses string, extra positional args). Each key adds one AND EXISTS pair."""
    clauses: list[str] = []
    extra: list = []
    for key in keys:
        variants = _AMENIDADES_VARIANTS.get(key)
        if not variants:
            continue
        n = base + len(extra) + 1
        extra.append(variants)
        clauses.append(
            f"AND EXISTS (\n"
            f"    SELECT 1 FROM raw.listings_metrocuadrado _am\n"
            f"    WHERE _am.url = l.url AND _am.amenidades && ${n}::text[]\n"
            f")"
        )
    return "\n  ".join(clauses), extra


# In-process TTL cache for _expand_neighbors — barrios/geometry never change at runtime.
_NEIGHBORS_TTL = 60  # seconds
_NEIGHBORS_CACHE: dict[tuple, tuple] = {}


class ListingFull(BaseModel):
    id: int
    listing_uid: Optional[str] = None
    fuente: Optional[str] = None
    fuente_display: Optional[str] = None
    tipo_operacion: Optional[str] = None
    tipo_inmueble: Optional[str] = None
    precio_cop: Optional[int] = None
    precio_usd: Optional[int] = None
    area_m2: Optional[float] = None
    precio_m2: Optional[int] = None
    habitaciones: Optional[int] = None
    banos: Optional[float] = None
    direccion_raw: Optional[str] = None
    url: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    barrio_id: Optional[int] = None
    barrio_nombre: Optional[str] = None
    barrio_display: Optional[str] = None
    municipio: Optional[str] = None
    municipio_display: Optional[str] = None
    comuna_nombre: Optional[str] = None
    cd_comuna: Optional[int] = None
    buena_oferta: Optional[bool] = None
    pct_bajo_mediana: Optional[float] = None
    precio_m2_mediana_barrio: Optional[int] = None
    dias_en_mercado: Optional[int] = None
    fecha_publicacion: Optional[str] = None
    disponible_actualmente: Optional[bool] = None
    fecha_ultima_verificacion: Optional[datetime] = None
    estrato_real: Optional[int] = None
    uso_suelo_pot: Optional[str] = None
    estrato_manzana: Optional[int] = None
    amoblado: Optional[bool] = None
    verificado: Optional[bool] = None
    tier: Optional[str] = None
    favoritos_count: Optional[int] = None
    foto_principal: Optional[str] = None
    # Barrio context — always included (from analytics.barrios_contexto JOIN)
    barrio_score: Optional[float] = None   # ctx.score_corto
    barrio_yield: Optional[float] = None   # ctx.yield_bruto_pct
    # Personalization fields — populated when user is authenticated with a perfil
    relevancia_score: Optional[float] = None
    match_label: Optional[str] = None
    match_razones: Optional[list[str]] = None


class PrecioHistorialItem(BaseModel):
    precio: int
    fecha: str
    delta_pct: Optional[float] = None


class ListingDetail(ListingFull):
    descripcion: Optional[str] = None
    # Traducción offline bidireccional (raw.descripcion_traduccion): trad = texto en
    # el idioma opuesto a src_lang; el front elige source o trad según el idioma.
    descripcion_trad: Optional[str] = None
    descripcion_src_lang: Optional[str] = None
    arriendo_p50_barrio: Optional[int] = None
    yield_estimado: Optional[float] = None
    vistas: Optional[int] = None
    tour_url: Optional[str] = None   # tour 3D / 360 (Matterport, Kuula, …)
    video_url: Optional[str] = None
    precio_historia: Optional[list[PrecioHistorialItem]] = None
    # Free-tier descriptive fields
    fotos: Optional[list[str]] = None
    amenidades: Optional[list[str]] = None
    antiguedad: Optional[str] = None
    estado_inmueble: Optional[str] = None
    parqueaderos: Optional[int] = None
    piso: Optional[int] = None
    nombre_edificio: Optional[str] = None
    # Barrio context fields
    yield_bruto_pct: Optional[float] = None
    score_corto: Optional[float] = None
    score_mediano: Optional[float] = None
    score_largo: Optional[float] = None
    liquidez_score: Optional[float] = None
    indice_nomada: Optional[float] = None
    seguridad_score: Optional[float] = None
    var_anual_pct: Optional[float] = None
    # Barrio price range (p25/p75) — pro only
    precio_m2_p25: Optional[int] = None
    precio_m2_p75: Optional[int] = None
    arr_p25: Optional[int] = None
    arr_p75: Optional[int] = None
    # Zillow-style extras
    fecha_scraping: Optional[str] = None      # "Actualizado: ..."
    n_duplicados: Optional[int] = None        # "Publicado en N portales"
    precio_variable: Optional[bool] = None    # proyecto "Desde $X"
    precio_min_cluster: Optional[int] = None
    precio_max_cluster: Optional[int] = None
    tiempo_estimado_venta: Optional[str] = None  # barrio intel — gated
    avaluo_m2_catastro: Optional[int] = None     # avalúo catastral/m² (comuna) — gated


class ListingsAllResponse(BaseModel):
    total: int
    listings: list[ListingFull]
    barrios_incluidos: Optional[list[str]] = None
    radio_usado_metros: Optional[int] = None


# Uses pre-computed cache tables (refreshed hourly) instead of per-request CTEs.
# analytics.barrios_medianas  replaces: med CTE (PERCENTILE_CONT full scan)
# analytics.barrios_contexto  replaces: bctx CTE (6 analytics table JOINs)
# analytics.barrios_cd        replaces: barrio_cd CTE (catastro JOIN)
# analytics.listings_georef   replaces: 3 LEFT JOINs (lm/lf/lp) + COALESCE lat/lon filter
_LISTINGS_SQL_TMPL = """
WITH lraw AS (
    SELECT ('x'||substr(md5(url),1,8))::bit(32)::int AS id,
           listing_uid,
           fuente, tier, tipo_operacion, tipo_inmueble,
           precio_cop                                  AS precio,
           area_m2, NULLIF(habitaciones, -1) AS habitaciones, banos,
           direccion_raw, barrio_raw, barrio_id, url, fecha_scraping,
           lat, lon,
           CASE
               WHEN precio_m2 > 0 AND precio_m2 < 2147483647 THEN precio_m2::int
               WHEN area_m2 > 0 AND precio_cop::float8 / area_m2 < 2147483647
                    THEN ROUND(precio_cop::float8 / area_m2)::int
               ELSE NULL
           END AS pm2,
           fotos[1] AS foto_principal,
           amoblado,
           COALESCE(verificado, FALSE) AS verificado,
           nombre_edificio
    FROM staging.stg_listings_unificado
    WHERE (precio_cop >= 500000 OR (tipo_operacion = 'arriendo' AND precio_cop >= 150000))
      AND lat IS NOT NULL AND lat != 0 AND lon IS NOT NULL AND lon != 0
      AND url IS NOT NULL  -- id is md5(url): a NULL url yields id NULL and a 500 on the whole response
      AND NOT (tipo_operacion = 'arriendo' AND precio_cop > 50000000)
      AND NOT (tipo_operacion = 'venta'    AND precio_cop > 50000000000)
)
SELECT
    l.id,
    l.listing_uid,
    l.fuente,
    CASE
        WHEN l.tier IN ('agente_premium', 'agencia_premium') THEN 'agente_verificado'
        WHEN l.fuente = 'propio' AND _lp_owner.owner_plan IN ('pro', 'agente') THEN 'propio_pro'
        WHEN l.fuente = 'propio' THEN 'propio'
        ELSE l.fuente
    END AS fuente_display,
    l.tier,
    l.tipo_operacion,
    l.tipo_inmueble,
    l.precio::bigint            AS precio_cop,
    NULL::bigint                AS precio_usd,  -- filled in Python from the shared TRM
    l.area_m2::float8,
    l.pm2                       AS precio_m2,
    l.habitaciones,
    l.banos::float8,
    l.direccion_raw,
    l.url,
    l.lat,
    l.lon,
    l.barrio_id,
    b.nombre                           AS barrio_nombre,
    INITCAP(LOWER(b.nombre))           AS barrio_display,
    b.municipio                        AS municipio,
    INITCAP(LOWER(b.municipio))        AS municipio_display,
    INITCAP(LOWER(b.comuna)) AS comuna_nombre,
    bc.cd_comuna AS cd_comuna,
    CASE
        WHEN l.tipo_operacion = 'venta'
             AND l.pm2 IS NOT NULL AND l.pm2 > 0
             AND m.m2_mediana > 0
             AND (m.m2_mediana - l.pm2)::float8 / m.m2_mediana > 0.10
        THEN TRUE
        WHEN l.tipo_operacion = 'arriendo'
             AND l.precio > 0
             AND m.arr_mediana > 0
             AND (m.arr_mediana - l.precio)::float8 / m.arr_mediana > 0.10
        THEN TRUE
        ELSE FALSE
    END AS buena_oferta,
    CASE
        WHEN l.tipo_operacion = 'venta'
             AND l.pm2 IS NOT NULL AND l.pm2 > 0
             AND m.m2_mediana > 0
        THEN round(((m.m2_mediana - l.pm2)::float8 / m.m2_mediana * 100)::numeric, 1)::float8
        WHEN l.tipo_operacion = 'arriendo'
             AND l.precio > 0 AND m.arr_mediana > 0
        THEN round(((m.arr_mediana - l.precio)::float8 / m.arr_mediana * 100)::numeric, 1)::float8
        ELSE NULL
    END AS pct_bajo_mediana,
    m.m2_mediana::int             AS precio_m2_mediana_barrio,
    g.url_activa                  AS disponible_actualmente,
    (CURRENT_DATE - _lm.fecha_primera_vez::date)::int
                                  AS dias_en_mercado,
    NULL::timestamp               AS fecha_ultima_verificacion,
    ctx.yield_bruto_pct,
    ctx.yield_bruto_pct              AS barrio_yield,
    ctx.n_listings_airbnb,
    ctx.score_corto,
    ctx.score_corto                  AS barrio_score,
    ctx.score_mediano,
    ctx.score_largo,
    ctx.liquidez_score,
    ctx.indice_nomada,
    ctx.seguridad_score,
    ctx.var_anual_pct,
    ctx.pct_wifi,
    g.estrato_real,
    g.uso_suelo_pot,
    g.estrato_manzana,
    l.amoblado,
    l.verificado,
    COALESCE(_fav.favoritos_count, 0) AS favoritos_count,
    COALESCE(mm.portada_r2, l.foto_principal) AS foto_principal,
    l.nombre_edificio
FROM lraw l
LEFT JOIN raw.barrios b                ON b.id = l.barrio_id
LEFT JOIN analytics.listings_georef g  ON g.url = l.url
LEFT JOIN raw.listing_media_mirror mm ON mm.url = l.url AND mm.activa
LEFT JOIN analytics.barrios_medianas m ON m.barrio_id = l.barrio_id
               AND m.tipo_inmueble IS NOT DISTINCT FROM l.tipo_inmueble
LEFT JOIN analytics.barrios_cd bc     ON bc.barrio_id = b.id
LEFT JOIN analytics.barrios_contexto ctx ON ctx.barrio_id = l.barrio_id
LEFT JOIN raw.listings_metrocuadrado _lm ON _lm.url = l.url AND l.fuente = 'metrocuadrado'
LEFT JOIN (
    SELECT url, COUNT(*)::int AS favoritos_count
    FROM raw.favoritos_listings GROUP BY url
) _fav ON _fav.url = l.url
LEFT JOIN (
    -- Modelo unificado (migr 0053): staging.url = listing.id::text → owner → usuario.
    SELECT lo.id::text AS lp_url, u.plan AS owner_plan
    FROM public.listing lo
    JOIN public.owner o ON o.id = lo.owner_id
    JOIN public.usuarios u ON u.id = o.usuario_id
) _lp_owner ON _lp_owner.lp_url = l.url AND l.fuente = 'propio'
WHERE ($1::text    IS NULL OR UPPER(b.municipio) = UPPER($1))
  AND ($2::int[]   IS NULL OR l.barrio_id = ANY($2))
  AND ($3::text    IS NULL OR l.tipo_operacion = $3)
  AND ($4::text[]  IS NULL OR EXISTS (
      SELECT 1 FROM unnest($4::text[]) _ti WHERE LOWER(l.tipo_inmueble) LIKE '%' || LOWER(_ti) || '%'
  ))
  AND ($5::bigint  IS NULL OR l.precio >= $5)
  AND ($6::bigint  IS NULL OR l.precio <= $6)
  AND ($7::float8  IS NULL OR l.area_m2 >= $7)
  AND ($8::int     IS NULL OR (CASE WHEN $8 >= 4 THEN l.habitaciones >= $8 ELSE l.habitaciones = $8 END))
  AND ($9::boolean IS NOT TRUE OR l.fuente = 'medellinliving')
  AND ($10::float8 IS NULL OR l.area_m2 <= $10)
  AND ($11::float8 IS NULL OR (CASE WHEN $11 >= 4 THEN l.banos >= $11 ELSE l.banos = $11 END))
  AND ($12::int    IS NULL OR bc.cd_comuna = $12)
  AND ($13::int    IS NULL OR (g.estrato_real = $13 AND g.estrato_real BETWEEN 1 AND 6))
  AND ($14::text   IS NULL OR EXISTS (
      SELECT 1 FROM raw.listings_metrocuadrado _lmc
      WHERE _lmc.url = l.url
        AND _lmc.raw_data::text LIKE '%tiempoConstruido:' || $14 || '%'
  ))
  AND ($15::boolean IS NULL OR l.amoblado = $15)
  AND ($16::text   IS NULL OR ($16 = 'comercial') = (lower(coalesce(l.tipo_inmueble, '')) ~ '__COMERCIAL_RE__'))
  AND ($17::boolean IS NOT TRUE OR NOT COALESCE(
        l.tier IN ('agente_premium', 'agencia_premium')
        OR (l.fuente = 'propio' AND _lp_owner.owner_plan IN ('pro', 'agente')), FALSE))
  {amenidades_filter}
ORDER BY
    CASE WHEN $9::boolean IS TRUE THEN 0
         WHEN l.barrio_id = ANY(COALESCE($2, ARRAY[]::int[])) THEN 1
         ELSE 2 END,
    -- Pro / agente verificado primero dentro de cada zona (visibilidad pagada).
    CASE WHEN l.tier IN ('agente_premium', 'agencia_premium')
              OR (l.fuente = 'propio' AND _lp_owner.owner_plan IN ('pro', 'agente'))
         THEN 0 ELSE 1 END,
    -- Casadolcecasa siempre primero dentro del bloque premium (socio top).
    CASE WHEN l.fuente = 'casadolcecasa' THEN 0 ELSE 1 END,
    CASE WHEN l.fuente = 'medellinliving' THEN 0 ELSE 1 END,
    -- Orden por PRECIO TOTAL, no precio/m²: un lote enorme (768k/m² pero 40B
    -- totales) no debe aparecer entre los "más baratos".
    l.precio ASC NULLS LAST
""".replace("__COMERCIAL_RE__", _COMERCIAL_RE)
_LISTINGS_SQL = _LISTINGS_SQL_TMPL.format(amenidades_filter="")

# ── Fast path "toda la ciudad" ────────────────────────────────────────────────
# Sin filtro de zona, el query base joinea ~54K filas antes del ORDER BY+LIMIT
# (≈1.5s). Aquí aplicamos los filtros de columnas de stg + pre-orden por
# (prioridad pagada, precio/m²) y LIMIT 700 candidatos ANTES de los joins pesados,
# así solo se joinean ~700 filas (≈0.15s). Seguro: solo ~300 listings prioritarios
# (propio/agente_premium/agencia_premium — incl. casadolcecasa), el top-500 real
# siempre cabe en 700 candidatos.
# Solo aplica cuando NO hay filtros del lado del join (estrato/antiguedad/amenidades).
_ALLCITY_CTE_CLOSE = (
    "      AND NOT (tipo_operacion = 'venta'    AND precio_cop > 50000000000)\n)"
)
_ALLCITY_CTE_REPLACEMENT = """      AND NOT (tipo_operacion = 'venta'    AND precio_cop > 50000000000)
      AND ($3::text    IS NULL OR tipo_operacion = $3)
      AND ($4::text[]  IS NULL OR EXISTS (
          SELECT 1 FROM unnest($4::text[]) _ti WHERE LOWER(tipo_inmueble) LIKE '%' || LOWER(_ti) || '%'
      ))
      AND ($5::bigint  IS NULL OR precio_cop >= $5)
      AND ($6::bigint  IS NULL OR precio_cop <= $6)
      AND ($7::float8  IS NULL OR area_m2 >= $7)
      AND ($10::float8 IS NULL OR area_m2 <= $10)
      AND ($8::int     IS NULL OR (CASE WHEN $8 >= 4 THEN NULLIF(habitaciones, -1) >= $8 ELSE NULLIF(habitaciones, -1) = $8 END))
      AND ($11::float8 IS NULL OR (CASE WHEN $11 >= 4 THEN banos >= $11 ELSE banos = $11 END))
      AND ($15::boolean IS NULL OR amoblado = $15)
      AND ($16::text   IS NULL OR ($16 = 'comercial') = (lower(coalesce(tipo_inmueble, '')) ~ '__COMERCIAL_RE__'))
    ORDER BY CASE WHEN tier IN ('agente_premium', 'agencia_premium') OR fuente = 'propio' THEN 0 ELSE 1 END,
             CASE WHEN fuente = 'medellinliving' THEN 0 ELSE 1 END,
             precio_cop ASC NULLS LAST
    LIMIT 700
)"""
assert _ALLCITY_CTE_CLOSE in _LISTINGS_SQL_TMPL, "CTE close string drifted — revisar _LISTINGS_SQL_TMPL"
_LISTINGS_ALLCITY_SQL = _LISTINGS_SQL_TMPL.replace(
    _ALLCITY_CTE_CLOSE,
    _ALLCITY_CTE_REPLACEMENT.replace("__COMERCIAL_RE__", _COMERCIAL_RE), 1
).format(amenidades_filter="")

_COUNT_SQL_TMPL = """
WITH lraw AS (
    SELECT fuente, tipo_operacion, tipo_inmueble,
           precio_cop AS precio, area_m2,
           NULLIF(habitaciones, -1) AS habitaciones,
           banos, barrio_id, url, amoblado, tier
    FROM staging.stg_listings_unificado
    WHERE (precio_cop >= 500000 OR (tipo_operacion = 'arriendo' AND precio_cop >= 150000))
      AND lat IS NOT NULL AND lat != 0 AND lon IS NOT NULL AND lon != 0
      AND url IS NOT NULL  -- id is md5(url): a NULL url yields id NULL and a 500 on the whole response
      AND NOT (tipo_operacion = 'arriendo' AND precio_cop > 50000000)
      AND NOT (tipo_operacion = 'venta'    AND precio_cop > 50000000000)
)
SELECT COUNT(*)
FROM lraw l
LEFT JOIN raw.barrios b               ON b.id = l.barrio_id
LEFT JOIN analytics.listings_georef g ON g.url = l.url
LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
LEFT JOIN (
    SELECT lo.id::text AS lp_url, u.plan AS owner_plan
    FROM public.listing lo
    JOIN public.owner o ON o.id = lo.owner_id
    JOIN public.usuarios u ON u.id = o.usuario_id
) _lp_owner ON _lp_owner.lp_url = l.url AND l.fuente = 'propio'
WHERE ($1::text   IS NULL OR UPPER(b.municipio) = UPPER($1))
  AND ($2::int[]  IS NULL OR l.barrio_id = ANY($2))
  AND ($3::text   IS NULL OR l.tipo_operacion = $3)
  AND ($4::text[] IS NULL OR EXISTS (
      SELECT 1 FROM unnest($4::text[]) _ti WHERE LOWER(l.tipo_inmueble) LIKE '%' || LOWER(_ti) || '%'
  ))
  AND ($5::bigint IS NULL OR l.precio >= $5)
  AND ($6::bigint IS NULL OR l.precio <= $6)
  AND ($7::float8 IS NULL OR l.area_m2 >= $7)
  AND ($8::int    IS NULL OR l.habitaciones = $8)
  AND ($9::boolean IS NOT TRUE OR l.fuente = 'medellinliving')
  AND ($10::float8 IS NULL OR l.area_m2 <= $10)
  AND ($11::float8 IS NULL OR (CASE WHEN $11 >= 4 THEN l.banos >= $11 ELSE l.banos = $11 END))
  AND ($12::int    IS NULL OR bc.cd_comuna = $12)
  AND ($13::int    IS NULL OR (g.estrato_real = $13 AND g.estrato_real BETWEEN 1 AND 6))
  AND ($14::text   IS NULL OR EXISTS (
      SELECT 1 FROM raw.listings_metrocuadrado _lmc
      WHERE _lmc.url = l.url
        AND _lmc.raw_data::text LIKE '%tiempoConstruido:' || $14 || '%'
  ))
  AND ($15::boolean IS NULL OR l.amoblado = $15)
  AND ($16::text   IS NULL OR ($16 = 'comercial') = (lower(coalesce(l.tipo_inmueble, '')) ~ '__COMERCIAL_RE__'))
  AND ($17::boolean IS NOT TRUE OR NOT COALESCE(
        l.tier IN ('agente_premium', 'agencia_premium')
        OR (l.fuente = 'propio' AND _lp_owner.owner_plan IN ('pro', 'agente')), FALSE))
  {amenidades_filter}
""".replace("__COMERCIAL_RE__", _COMERCIAL_RE)
_COUNT_SQL = _COUNT_SQL_TMPL.format(amenidades_filter="")

_BARRIO_CTX_KEYS = (
    "score_corto", "score_mediano", "score_largo",
    "yield_bruto_pct", "liquidez_score", "indice_nomada",
    "seguridad_score", "var_anual_pct",
    "n_listings_airbnb", "pct_wifi",
)

# Inteligencia de mercado/barrio — activo monetizable, solo agentes (is_agente).
# Datos del inmueble (precio, specs, fotos, descripción, historial, estrato,
# amenidades, dias_en_mercado) son públicos y NO se tocan. El shape no cambia:
# los campos siguen existiendo, van null para el público.
_MARKET_INTEL_FIELDS = (
    "buena_oferta", "pct_bajo_mediana",
    "liquidez_score", "seguridad_score",
    "score_corto", "score_mediano", "score_largo",
    "var_anual_pct", "precio_m2_mediana_barrio",
    "precio_m2_p25", "precio_m2_p75", "arr_p25", "arr_p75",
    "arriendo_p50_barrio", "yield_estimado", "yield_bruto_pct",
    "indice_nomada", "barrio_score", "barrio_yield",
    "tiempo_estimado_venta", "avaluo_m2_catastro",
)


def _gate_market_fields(row_d: dict, agente: bool) -> dict:
    """Único punto de gate server-side de inteligencia de mercado."""
    if not agente:
        for f in _MARKET_INTEL_FIELDS:
            if f in row_d:
                row_d[f] = None
    return row_d

_NEARBY_BARRIOS_SQL = """
    SELECT b.id, b.nombre
    FROM raw.barrios b, raw.barrios base
    WHERE base.id = $1
      AND b.id != base.id
      AND b.municipio = base.municipio
      AND ST_DWithin(
          b.geometry::geography,
          base.geometry::geography,
          $2
      )
    ORDER BY ST_Distance(b.geometry::geography, base.geometry::geography)
    LIMIT 8
"""

_LISTINGS_COUNT_BY_IDS = """
    SELECT COUNT(*)::bigint
    FROM staging.stg_listings_unificado l
    WHERE (l.precio_cop >= 500000 OR (l.tipo_operacion = 'arriendo' AND l.precio_cop >= 150000))
      AND NOT (l.tipo_operacion = 'arriendo' AND l.precio_cop > 50000000)
      AND NOT (l.tipo_operacion = 'venta'    AND l.precio_cop > 50000000000)
      AND l.barrio_id = ANY($1::int[])
"""

_PREMIUM_COUNT_BY_IDS = """
    SELECT COUNT(*)
    FROM raw.listings_premium lp
    JOIN raw.barrios b ON b.id = lp.barrio_id
    WHERE lp.barrio_id = ANY($1::int[])
      AND lp.lat IS NOT NULL AND lp.lat != 0
"""


def _get_prefiltros(perfil: dict) -> dict:
    filtros: dict = {}
    objetivo = perfil.get("objetivo", "")

    if objetivo == "airbnb":
        filtros["tipo_operacion"] = "venta"
        filtros["tipo_inmueble_pref"] = "apartamento"
    elif objetivo == "mediano_plazo":
        target = perfil.get("target_inquilino")
        if target == "ejecutivo":
            filtros["min_seguridad"] = 60
    elif objetivo in ("renta_larga", "largo_plazo"):
        filtros["tipo_operacion"] = "venta"
        horizonte = perfil.get("horizonte_inversion")
        pago = perfil.get("tipo_pago")
        if horizonte == "5" and pago == "credito":
            filtros["min_yield"] = 6.0
        if horizonte == "20+":
            filtros["prefer_estado_precio"] = "BAJO"

    pmax = PRESUPUESTO_MAX.get(perfil.get("presupuesto", ""))
    if pmax and pmax < 9_999_999_999:
        filtros["precio_max_soft"] = pmax

    return filtros


async def _expand_neighbors(
    pool: Any,
    barrio_id: int,
    radios: tuple[int, ...] = (0, 500, 1000),
    min_listings: int = 1,
    only_premium: bool = False,
) -> tuple[list[int], list[str], int]:
    """Cascade-expand barrio → neighbors until min_listings reached.
    Results cached for _NEIGHBORS_TTL seconds — barrio geometry is static at runtime.
    """
    cache_key = (barrio_id, only_premium)
    cached = _NEIGHBORS_CACHE.get(cache_key)
    if cached is not None:
        result, ts = cached
        if time.time() - ts < _NEIGHBORS_TTL:
            return result  # type: ignore[return-value]

    if only_premium:
        min_listings = 1

    ids = [barrio_id]
    names: list[str] = []

    base = await pool.fetchrow("SELECT nombre FROM raw.barrios WHERE id = $1", barrio_id)
    if base:
        names = [base["nombre"]]

    count_sql = _PREMIUM_COUNT_BY_IDS if only_premium else _LISTINGS_COUNT_BY_IDS

    for radio in radios:
        count = await pool.fetchval(count_sql, ids)
        if (count or 0) >= min_listings:
            result = (ids, names, radio if radio == 0 else radios[radios.index(radio) - 1])
            _NEIGHBORS_CACHE[cache_key] = (result, time.time())
            return result
        if radio == 0:
            continue
        nearby = await pool.fetch(_NEARBY_BARRIOS_SQL, barrio_id, float(radio))
        ids = [barrio_id] + [r["id"] for r in nearby]
        names = [names[0]] + [r["nombre"] for r in nearby]

    result = (ids, names, radios[-1])
    _NEIGHBORS_CACHE[cache_key] = (result, time.time())
    return result


async def _count_and_fetch(
    pool: Any, args: tuple, fetch_limit: int, fetch_offset: int,
    count_sql: str | None = None,
    listings_sql: str | None = None,
) -> tuple:
    """Run COUNT + LISTINGS concurrently. Returns (count, rows)."""
    csql = count_sql if count_sql is not None else _COUNT_SQL
    lsql = (listings_sql if listings_sql is not None else _LISTINGS_SQL) + f" LIMIT {fetch_limit} OFFSET {fetch_offset}"
    count, rows = await asyncio.gather(
        pool.fetchval(csql, *args),
        pool.fetch(lsql, *args),
    )
    return count or 0, rows


@router.get("", response_model=ListingsAllResponse)
@limiter.limit("120/minute")
async def get_all_listings(
    request: Request,
    municipio: Optional[str] = Query(default=None),
    barrio_id: Optional[int] = Query(default=None),
    only_premium: bool = Query(default=False),
    tipo_operacion: Optional[str] = Query(default=None),
    tipo_inmueble: Optional[list[str]] = Query(default=None),
    precio_min: Optional[int] = Query(default=None),
    precio_max: Optional[int] = Query(default=None),
    area_min: Optional[float] = Query(default=None),
    habitaciones: Optional[int] = Query(default=None),
    area_max: Optional[float] = Query(default=None),
    banos: Optional[float] = Query(default=None),
    cd_comuna: Optional[int] = Query(default=None),
    estrato_real: Optional[int] = Query(default=None),
    antiguedad: Optional[str] = Query(default=None),
    amoblado: Optional[bool] = Query(default=None),
    amenidades: Optional[list[str]] = Query(default=None),
    segmento: Optional[str] = Query(default=None, pattern="^(residencial|comercial|todos)$"),
    ocultar_destacados: bool = Query(default=False),
    moneda: str = Query(default="COP", pattern="^(COP|USD)$"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    if estrato_real is not None and estrato_real not in (1, 2, 3, 4, 5, 6):
        raise HTTPException(status_code=422, detail="estrato_real must be 1–6")

    pool = get_pool()
    rate = await get_usd_rate()
    precio_min = cop_from_moneda(precio_min, moneda, rate)
    precio_max = cop_from_moneda(precio_max, moneda, rate)

    # Neighbor expansion when barrio_id is given
    barrio_ids: Optional[list[int]] = None
    barrios_incluidos: Optional[list[str]] = None
    radio_usado: Optional[int] = None

    if barrio_id is not None:
        barrio_ids, barrios_incluidos, radio_usado = await _expand_neighbors(
            pool, barrio_id, only_premium=only_premium
        )

    # Fetch investor profile if authenticated
    perfil_dict: Optional[dict] = None
    if current_user:
        try:
            prow = await pool.fetchrow(
                """SELECT objetivo, perfil_riesgo, presupuesto, n_unidades, tipo_gestion,
                          target_inquilino, amoblado, tipo_pago, horizonte_inversion
                   FROM perfil_inversor
                   WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1""",
                current_user["id"],
            )
            if prow and prow["objetivo"]:
                perfil_dict = dict(prow)
        except Exception:
            pass

    am_clauses, am_extra = _build_amenidades_sql(amenidades or [])
    _eff_count_sql    = _COUNT_SQL_TMPL.format(amenidades_filter=am_clauses)
    _eff_listings_sql = _LISTINGS_SQL_TMPL.format(amenidades_filter=am_clauses)
    tipo_inmueble_arg = _norm_tipos(tipo_inmueble)

    def _args(tipo_op: Optional[str]) -> tuple:
        seg = _effective_segmento(segmento, tipo_op or tipo_operacion, tipo_inmueble_arg)
        return (municipio, barrio_ids, tipo_op, tipo_inmueble_arg,
                precio_min, precio_max, area_min, habitaciones, only_premium,
                area_max, banos, cd_comuna, estrato_real, antiguedad, amoblado,
                seg, ocultar_destacados) + tuple(am_extra)

    # Unified venta+arriendo path: 2 parallel fetches → balanced results, 1 HTTP round-trip.
    # Only applies when: no tipo_operacion filter, barrio selected, no premium, no personalization, page 0.
    if (tipo_operacion is None and barrio_id is not None
            and not only_premium and not perfil_dict and offset == 0):
        half = max(1, limit // 2)
        (total_v, rows_v), (total_a, rows_a) = await asyncio.gather(
            _count_and_fetch(pool, _args("venta"),    half, 0, _eff_count_sql, _eff_listings_sql),
            _count_and_fetch(pool, _args("arriendo"), half, 0, _eff_count_sql, _eff_listings_sql),
        )
        rows = list(rows_v) + list(rows_a)
        total = (total_v or 0) + (total_a or 0)
    else:
        # Single tipo_operacion (or premium / personalized / paginated):
        # run COUNT + LISTINGS in parallel — halves sequential overhead.
        args = _args(tipo_operacion)
        if perfil_dict:
            fetch_limit = min(500, max(limit * 3, 200))
            fetch_offset = 0
        else:
            fetch_limit = limit
            fetch_offset = offset
        # Fast path "toda la ciudad": sin zona ni filtros del lado del join, y
        # página 0 → limita candidatos antes de los joins pesados (~10x más rápido).
        allcity_fast = (
            municipio is None and barrio_ids is None and cd_comuna is None
            and estrato_real is None and antiguedad is None and not amenidades
            and not only_premium and not perfil_dict and fetch_offset == 0
            and not ocultar_destacados
        )
        listings_sql = _LISTINGS_ALLCITY_SQL if allcity_fast else _eff_listings_sql
        total, rows = await asyncio.gather(
            pool.fetchval(_eff_count_sql, *args),
            pool.fetch(listings_sql + f" LIMIT {fetch_limit} OFFSET {fetch_offset}", *args),
        )
        total = total or 0

    _is_agente = is_agente(current_user)
    items: list[ListingFull] = []
    for r in rows:
        row_d = dict(r)
        # Extraer ctx de barrio ANTES del gate — la personalización lo necesita
        # (comportamiento idéntico al actual para usuarios públicos).
        barrio_ctx = {k: row_d.get(k) for k in _BARRIO_CTX_KEYS} if perfil_dict else None
        _gate_market_fields(row_d, _is_agente)
        _finalize_row(row_d, rate)
        if perfil_dict:
            score, razones = calcular_relevancia(row_d, barrio_ctx, perfil_dict)

            # Apply prefiltro penalties (soft — bias sort, don't hard-remove)
            prefiltros = _get_prefiltros(perfil_dict)
            if "tipo_operacion" in prefiltros:
                if row_d.get("tipo_operacion") != prefiltros["tipo_operacion"]:
                    score = round(score * 0.3, 1)
            if "min_yield" in prefiltros:
                if float(barrio_ctx.get("yield_bruto_pct") or 0) < prefiltros["min_yield"]:
                    score = round(score * 0.7, 1)
            if "min_seguridad" in prefiltros:
                if float(barrio_ctx.get("seguridad_score") or 0) < prefiltros["min_seguridad"]:
                    score = round(score * 0.8, 1)

            row_d["relevancia_score"] = score
            row_d["match_label"] = get_match_label(score)
            row_d["match_razones"] = razones
        items.append(ListingFull(**row_d))

    if perfil_dict:
        items.sort(key=lambda x: x.relevancia_score or 0.0, reverse=True)
        items = items[offset: offset + limit]

    return ListingsAllResponse(
        total=total,
        listings=items,
        barrios_incluidos=barrios_incluidos,
        radio_usado_metros=radio_usado,
    )


_LISTING_BY_ID_SQL = """
WITH listing AS (
    SELECT ('x'||substr(md5(url),1,8))::bit(32)::int AS id,
           listing_uid,
           fuente, tier, tipo_operacion, tipo_inmueble,
           precio_cop, area_m2, NULLIF(habitaciones, -1) AS habitaciones, banos,
           direccion_raw, barrio_id, url, fotos, amenidades,
           amoblado, COALESCE(verificado, FALSE) AS verificado,
           fecha_scraping, n_duplicados,
           precio_variable, precio_min_cluster, precio_max_cluster,
           nombre_edificio,
           NULL::date AS fecha_publicacion,
           CASE
               WHEN precio_m2 > 0 AND precio_m2 < 2147483647 THEN precio_m2::int
               WHEN area_m2 > 0 THEN ROUND(precio_cop::float8 / area_m2)::int
               ELSE NULL
           END AS pm2
    FROM staging.stg_listings_unificado
    WHERE ('x'||substr(md5(url),1,8))::bit(32)::int = $1
),
p_range AS (
    SELECT
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY precio_cop::float/NULLIF(area_m2,0))
            FILTER (WHERE tipo_operacion='venta' AND area_m2>0
                    AND precio_cop::float/area_m2 BETWEEN 500000 AND 50000000) AS m2_p25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY precio_cop::float/NULLIF(area_m2,0))
            FILTER (WHERE tipo_operacion='venta' AND area_m2>0
                    AND precio_cop::float/area_m2 BETWEEN 500000 AND 50000000) AS m2_p75,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY precio_cop::float)
            FILTER (WHERE tipo_operacion='arriendo'
                    AND precio_cop BETWEEN 300000 AND 50000000) AS arr_p25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY precio_cop::float)
            FILTER (WHERE tipo_operacion='arriendo'
                    AND precio_cop BETWEEN 300000 AND 50000000) AS arr_p75
    FROM staging.stg_listings_unificado
    WHERE barrio_id  = (SELECT barrio_id FROM listing)
      AND tipo_inmueble IS NOT DISTINCT FROM (SELECT tipo_inmueble FROM listing)
      AND precio_cop > 0
)
SELECT
    l.id,
    l.listing_uid,
    l.fuente,
    CASE
        WHEN l.tier IN ('agente_premium', 'agencia_premium') THEN 'agente_verificado'
        WHEN l.fuente = 'propio' AND _lp_owner.owner_plan IN ('pro', 'agente') THEN 'propio_pro'
        WHEN l.fuente = 'propio' THEN 'propio'
        ELSE l.fuente
    END AS fuente_display,
    l.tier,
    l.tipo_operacion,
    l.tipo_inmueble,
    l.precio_cop::bigint,
    NULL::bigint AS precio_usd,  -- filled in Python from the shared TRM
    l.area_m2::float8,
    l.pm2 AS precio_m2,
    l.habitaciones,
    l.banos::float8,
    l.direccion_raw,
    l.url,
    g.lat,
    g.lon,
    g.url_activa AS disponible_actualmente,
    g.estrato_real,
    g.uso_suelo_pot,
    g.estrato_manzana,
    l.barrio_id,
    b.nombre                           AS barrio_nombre,
    INITCAP(LOWER(b.nombre))           AS barrio_display,
    b.municipio,
    INITCAP(LOWER(b.municipio))        AS municipio_display,
    INITCAP(LOWER(b.comuna)) AS comuna_nombre,
    bc.cd_comuna,
    m.m2_mediana::int AS precio_m2_mediana_barrio,
    m.arr_mediana::int AS arriendo_p50_barrio,
    CASE
        WHEN l.tipo_operacion = 'venta'
             AND l.pm2 IS NOT NULL AND l.pm2 > 0 AND m.m2_mediana > 0
        THEN round(((m.m2_mediana - l.pm2)::float8 / m.m2_mediana * 100)::numeric, 1)::float8
        WHEN l.tipo_operacion = 'arriendo'
             AND l.precio_cop > 0 AND m.arr_mediana > 0
        THEN round(((m.arr_mediana - l.precio_cop)::float8 / m.arr_mediana * 100)::numeric, 1)::float8
        ELSE NULL
    END AS pct_bajo_mediana,
    CASE
        WHEN l.tipo_operacion = 'venta'
             AND l.pm2 IS NOT NULL AND l.pm2 > 0 AND m.m2_mediana > 0
             AND (m.m2_mediana - l.pm2)::float8 / m.m2_mediana > 0.10 THEN TRUE
        WHEN l.tipo_operacion = 'arriendo'
             AND l.precio_cop > 0 AND m.arr_mediana > 0
             AND (m.arr_mediana - l.precio_cop)::float8 / m.arr_mediana > 0.10 THEN TRUE
        ELSE FALSE
    END AS buena_oferta,
    CASE
        WHEN l.tipo_operacion = 'venta' AND l.precio_cop > 0 AND m.arr_mediana > 0
        THEN round(((m.arr_mediana * 12)::float8 / l.precio_cop * 100)::numeric, 2)::float8
        ELSE NULL
    END AS yield_estimado,
    COALESCE(lm.descripcion, lf.descripcion, lp.descripcion) AS descripcion,
    dt.descripcion_trad                AS descripcion_trad,
    dt.src_lang                        AS descripcion_src_lang,
    (CURRENT_DATE - lm.fecha_primera_vez::date)::int
                                       AS dias_en_mercado,
    l.fecha_publicacion::text,
    NULL::timestamp AS fecha_ultima_verificacion,
    ctx.yield_bruto_pct,
    ctx.score_corto,
    ctx.score_mediano,
    ctx.score_largo,
    ctx.liquidez_score,
    ctx.indice_nomada,
    ctx.seguridad_score,
    ctx.var_anual_pct,
    COALESCE(_fav.favoritos_count, 0)  AS favoritos_count,
    COALESCE(_vistas.vistas, 0)        AS vistas,
    lm.raw_data->>'tiempoConstruido'   AS antiguedad,
    l.amenidades                       AS amenidades,
    lm.raw_data->>'mestadoinmueble'    AS estado_inmueble,
    CASE WHEN lm.raw_data->>'nroGarajes' ~ '^\d+$'
         THEN (lm.raw_data->>'nroGarajes')::int END AS parqueaderos,
    CASE WHEN lm.raw_data->>'nroPiso' ~ '^\d+$'
         THEN (lm.raw_data->>'nroPiso')::int END    AS piso,
    COALESCE(mm.fotos_r2, l.fotos, lp.fotos) AS fotos,
    pr.m2_p25::int  AS precio_m2_p25,
    pr.m2_p75::int  AS precio_m2_p75,
    pr.arr_p25::int AS arr_p25,
    pr.arr_p75::int AS arr_p75,
    l.amoblado,
    l.verificado,
    l.fecha_scraping::date::text       AS fecha_scraping,
    l.n_duplicados::int                AS n_duplicados,
    l.precio_variable,
    l.precio_min_cluster::bigint       AS precio_min_cluster,
    l.precio_max_cluster::bigint       AS precio_max_cluster,
    liq.tiempo_estimado_venta,
    cat.avaluo_m2_catastro::bigint     AS avaluo_m2_catastro,
    _lp_owner.tour_url,
    _lp_owner.video_url,
    COALESCE(_lp_owner.nombre_edificio, l.nombre_edificio) AS nombre_edificio
FROM listing l
JOIN raw.barrios b ON b.id = l.barrio_id
JOIN analytics.listings_georef g ON g.url = l.url
LEFT JOIN analytics.barrios_medianas m
    ON m.barrio_id = l.barrio_id
    AND m.tipo_inmueble IS NOT DISTINCT FROM l.tipo_inmueble
LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
LEFT JOIN analytics.barrios_contexto ctx ON ctx.barrio_id = l.barrio_id
LEFT JOIN analytics.barrios_liquidez liq ON liq.barrio_id = l.barrio_id
-- Espejo R2: galería redimensionada (webp) — prioridad sobre el CDN original.
LEFT JOIN raw.listing_media_mirror mm ON mm.url = l.url AND mm.activa
-- Avalúo catastral (Medellín) — agregado por comuna en listings_vs_catastro.
LEFT JOIN (
    SELECT cd_comuna, MAX(avaluo_m2_catastro) AS avaluo_m2_catastro
    FROM analytics.listings_vs_catastro
    WHERE avaluo_m2_catastro > 0
    GROUP BY cd_comuna
) cat ON cat.cd_comuna = bc.cd_comuna
LEFT JOIN raw.listings_metrocuadrado lm ON lm.url = l.url AND l.fuente = 'metrocuadrado'
LEFT JOIN raw.listings_fincaraiz lf ON lf.url = l.url AND l.fuente = 'fincaraiz'
LEFT JOIN raw.listings_premium lp ON lp.url = l.url
LEFT JOIN raw.descripcion_traduccion dt ON dt.url = l.url
-- Query de listing único (LIMIT 1): correlacionar por l.url en vez de agregar
-- toda la tabla y unir 1 fila (era GROUP BY sobre user_events/favoritos_listings
-- completas en cada apertura del drawer).
LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS favoritos_count
    FROM raw.favoritos_listings WHERE url = l.url
) _fav ON TRUE
LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS vistas
    FROM public.user_events
    WHERE event_type = 'listing_view' AND entity_type = 'listing'
      AND entity_id = l.url
) _vistas ON TRUE
LEFT JOIN (
    SELECT lo.id::text AS lp_url, u.plan AS owner_plan, lo.tour_url, lo.video_url, lo.nombre_edificio
    FROM public.listing lo
    JOIN public.owner o ON o.id = lo.owner_id
    JOIN public.usuarios u ON u.id = o.usuario_id
) _lp_owner ON _lp_owner.lp_url = l.url AND l.fuente = 'propio'
CROSS JOIN p_range pr
LIMIT 1
"""


_PRECIO_HISTORIA_SQL = """
SELECT precio_nuevo AS precio, fecha_cambio::text AS fecha,
       round(((precio_nuevo - precio_anterior)::float8 / NULLIF(precio_anterior, 0) * 100)::numeric, 1)::float8 AS delta_pct
FROM raw.listings_precio_historial
WHERE listing_url = $1
ORDER BY fecha_cambio ASC
"""


# ── Viewport-based loading (server-side clustering) ──────────────────────────
class ViewportCluster(BaseModel):
    lng: float
    lat: float
    count: int
    precio_promedio: Optional[int] = None


# Trimmed map/card tier — only the fields MapView dots + MLSPanel cards consume.
# Full detail (fotos, descripción, amenidades, yields) is fetched per-id at drawer open.
class ViewportListing(BaseModel):
    id: int
    lat: Optional[float] = None
    lon: Optional[float] = None
    tipo_operacion: Optional[str] = None
    tipo_inmueble: Optional[str] = None
    precio_cop: Optional[int] = None
    precio_usd: Optional[int] = None
    area_m2: Optional[float] = None
    precio_m2: Optional[int] = None
    habitaciones: Optional[int] = None
    banos: Optional[float] = None
    foto_principal: Optional[str] = None
    fuente: Optional[str] = None
    fuente_display: Optional[str] = None
    tier: Optional[str] = None
    estrato_real: Optional[int] = None
    barrio_id: Optional[int] = None
    barrio_nombre: Optional[str] = None
    municipio: Optional[str] = None
    url: Optional[str] = None
    direccion_raw: Optional[str] = None


class ViewportResponse(BaseModel):
    mode: str          # "clusters" | "points"
    zoom: int
    thinned: bool = False   # True when points are grid-thinned (zoom < _VIEWPORT_FULL_POINTS_ZOOM)
    clusters: list[ViewportCluster] = []
    listings: list[ViewportListing] = []


# Below this zoom we aggregate into comuna/municipio bubbles; at/above it we return
# real points (lowered 13 -> 10 so pins show when zoomed out; the map's min zoom is ~11).
_VIEWPORT_CLUSTER_MAX_ZOOM = 10
# From this zoom up we return every point (up to the cap); between CLUSTER_MAX and
# this value the points are grid-thinned (one per screen cell) to keep payload small.
_VIEWPORT_FULL_POINTS_ZOOM = 13
# Safety cap on individual points returned for one viewport.
_VIEWPORT_POINTS_CAP = 3000
# Cap on grid-thinned points (zoomed-out view).
_VIEWPORT_THIN_CAP = 1500
# Approx. screen size of one pin cell, in px, used to size the thinning grid.
_VIEWPORT_THIN_CELL_PX = 28


def _thin_cell_deg(zoom: int) -> float:
    """Degrees covered by ~_VIEWPORT_THIN_CELL_PX pixels at `zoom` (512px world tiles)."""
    return 360.0 * _VIEWPORT_THIN_CELL_PX / (512.0 * (2 ** zoom))
# Cap on the panel list returned alongside clusters at low zoom (CAMBIO 4A).
_VIEWPORT_PANEL_CAP = 200

# Params (shared by both SQLs): $1-$4 bbox (NULLable — nulled when a zone is
# active so the whole zone shows), $5 tipo_op, $6 precio_min, $7 precio_max,
# $8 barrio_ids int[] (neighbor-expanded), $9 cd_comuna, $10 municipio,
# $11 amoblado, $12 habitaciones (>=), $13 banos (>=), $14 area_min, $15 area_max,
# $16 estrato int[], $17 tipo_inmueble text[] (substring, OR), $18 dias_mercado bucket,
# $19 busqueda (ILIKE direccion), $20 amenidades ILIKE patterns text[] (OR match,
# strict on NULL), $21 estado_inmueble ("Nuevo"|"Usado", metrocuadrado only),
# $22 piso_min (>=, metrocuadrado only), $23 segmento ('residencial'|'comercial'|NULL),
# $24 ocultar_destacados. The thinned-points SQL adds $25 = grid cell size (deg).
# Clusters group by comuna/municipio — no extra param needed.

# dias_en_mercado only exists for metrocuadrado listings (fecha_primera_vez).
# Dedupe on url first (url is not unique in the raw table) so the LEFT JOIN can't
# inflate cluster COUNT/AVG. MIN = earliest sighting = most days on market.
_VIEWPORT_DM_JOIN = (
    "LEFT JOIN (SELECT url, MIN(fecha_primera_vez) AS fecha_primera_vez\n"
    "           FROM raw.listings_metrocuadrado GROUP BY url) _dm\n"
    "       ON _dm.url = l.url AND l.fuente = 'metrocuadrado'"
)

# Shared $12-$19 filter block. NULLIF(habitaciones,-1) normalises the sentinel.
# dias buckets replicate the old client-side semantics (NULL → 999 = "old").
_VIEWPORT_EXTRA_WHERE = """\
  AND ($12::int    IS NULL OR NULLIF(l.habitaciones, -1) >= $12)
  AND ($13::float8 IS NULL OR l.banos >= $13)
  AND ($14::float8 IS NULL OR l.area_m2 >= $14)
  AND ($15::float8 IS NULL OR l.area_m2 <= $15)
  AND ($16::int[]  IS NULL OR g.estrato_real = ANY($16))
  AND ($17::text[] IS NULL OR EXISTS (
        SELECT 1 FROM unnest($17::text[]) _ti WHERE lower(l.tipo_inmueble) LIKE _ti || '%'))
  AND ($18::text   IS NULL OR CASE $18
        WHEN 'nuevo'    THEN COALESCE((CURRENT_DATE - _dm.fecha_primera_vez::date), 999) < 7
        WHEN 'reciente' THEN COALESCE((CURRENT_DATE - _dm.fecha_primera_vez::date), 999) < 30
        WHEN 'demorado' THEN COALESCE((CURRENT_DATE - _dm.fecha_primera_vez::date), 999) >= 90
        WHEN 'mas30'    THEN COALESCE((CURRENT_DATE - _dm.fecha_primera_vez::date), 999) >= 30
        WHEN 'mas60'    THEN COALESCE((CURRENT_DATE - _dm.fecha_primera_vez::date), 999) >= 60
        ELSE TRUE END)
  AND ($19::text   IS NULL OR l.direccion_raw ILIKE '%' || $19 || '%')
  AND ($20::text[] IS NULL OR EXISTS (
        SELECT 1 FROM unnest(l.amenidades) _a WHERE _a ILIKE ANY($20)))
  AND ($21::text   IS NULL OR EXISTS (
        SELECT 1 FROM raw.listings_metrocuadrado _ei
        WHERE _ei.url = l.url AND _ei.raw_data->>'mestadoinmueble' = $21))
  AND ($22::int    IS NULL OR EXISTS (
        SELECT 1 FROM raw.listings_metrocuadrado _pi
        WHERE _pi.url = l.url AND _pi.raw_data->>'nroPiso' ~ '^\d+$'
          AND (_pi.raw_data->>'nroPiso')::int >= $22))
  AND ($23::text   IS NULL OR ($23 = 'comercial') = (lower(coalesce(l.tipo_inmueble, '')) ~ '__COMERCIAL_RE__'))
  AND ($24::boolean IS NOT TRUE OR NOT COALESCE((__FEATURED__), FALSE))
""".replace("__COMERCIAL_RE__", _COMERCIAL_RE)

# UI amenity key → substring patterns matched (ILIKE, OR) against the source
# amenidades labels. Stems avoid accent/variant mismatches across fuentes
# (metrocuadrado vs fincaraiz use different vocab; MC has ~3k noisy tokens).
# Heuristic — tune the stems if a label slips through. `amoblado` is NOT here:
# it stays its own boolean param ($11), split out by the frontend.
_AMENIDAD_PATTERNS: dict[str, list[str]] = {
    "cocina_integral":        ["cocina integral"],
    "aire_acondicionado":     ["aire acondicionado", "a/c", "climatiz"],
    "balcon":                 ["balcón", "balcon", "terraza"],
    "lavanderia":             ["lavander"],
    "ascensor":               ["ascensor"],
    "conjunto_cerrado":       ["conjunto cerrado"],
    "salon_comunal":          ["comunal"],
    "gimnasio":               ["gimnas"],
    "piscina":                ["piscina"],
    "parqueadero_visitantes": ["parqueadero visitant"],
    "porteria":               ["portería", "porteria", "recepci"],
    "vigilancia":             ["vigilanc"],
    "camaras":                ["circuito cerrado", "cámara", "camara", "cctv"],
    "zonas_verdes":           ["verde"],
    "zona_ninos":             ["niñ", "nin", "infantil"],
    "transporte":             ["transporte", "público cercano", "publico cercano"],
}


def _amenidad_like_patterns(keys: Optional[list[str]]) -> Optional[list[str]]:
    """Flatten selected UI keys → ['%stem%', ...] (OR match). None if empty."""
    if not keys:
        return None
    pats = [f"%{p}%" for k in keys for p in _AMENIDAD_PATTERNS.get(k, [])]
    return pats or None

# Grouped by comuna (Medellín) / municipio (rest of the metro) instead of a lat/lon
# grid. The map's min zoom is 11, and at zoom 11-12 the whole Valle de Aburrá (and
# its ~600 barrios-with-listings) fits in one viewport — so barrio-level grouping
# doesn't reduce the bubble count at all (measured: 602 barrio-groups vs 25
# comuna-groups in view at that zoom). Comuna/municipio is the tier that actually
# gives few, non-overlapping bubbles at "muy alejado" zoom; individual listing pins
# still appear once zoom flips to "points" mode (>= _VIEWPORT_CLUSTER_MAX_ZOOM).
# Two-level aggregate: first collapse to one row per barrio (dedupes its geometry so
# ST_Collect below isn't skewed toward whichever barrio happens to have more
# listings), then group those into comuna/municipio bubbles centered on the
# collected shape.
_VIEWPORT_CLUSTERS_SQL = """
WITH per_barrio AS (
    SELECT
        COALESCE(bc.cd_comuna::text, b.municipio) AS grp,
        b.id                                      AS barrio_id,
        b.geometry,
        COUNT(*)                                  AS n,
        SUM(l.precio_cop)                         AS sum_precio
    FROM staging.stg_listings_unificado l
    JOIN analytics.listings_georef g  ON g.url = l.url
    JOIN raw.barrios b                ON b.id = l.barrio_id
    LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
    {dm_join}
    WHERE (l.precio_cop >= 500000 OR (l.tipo_operacion = 'arriendo' AND l.precio_cop >= 150000))
      AND NOT (l.tipo_operacion = 'arriendo' AND l.precio_cop > 50000000)
      AND NOT (l.tipo_operacion = 'venta'    AND l.precio_cop > 50000000000)
      AND ($1::float8 IS NULL OR g.lon >= $1)
      AND ($2::float8 IS NULL OR g.lat >= $2)
      AND ($3::float8 IS NULL OR g.lon <= $3)
      AND ($4::float8 IS NULL OR g.lat <= $4)
      AND ($5::text   IS NULL OR l.tipo_operacion = $5)
      AND ($6::bigint IS NULL OR l.precio_cop >= $6)
      AND ($7::bigint IS NULL OR l.precio_cop <= $7)
      AND ($8::int[]  IS NULL OR l.barrio_id = ANY($8))
      AND ($9::int    IS NULL OR bc.cd_comuna = $9)
      AND ($10::text  IS NULL OR UPPER(b.municipio) = UPPER($10))
      AND ($11::boolean IS NULL OR l.amoblado = $11)
    {extra_where}
    GROUP BY grp, b.id
)
SELECT
    SUM(n)::int                                      AS count,
    ST_X(ST_Centroid(ST_Collect(geometry)))::float8   AS lng,
    ST_Y(ST_Centroid(ST_Collect(geometry)))::float8   AS lat,
    ROUND(SUM(sum_precio)::numeric / SUM(n))::bigint  AS precio_promedio
FROM per_barrio
GROUP BY grp
""".format(dm_join=_VIEWPORT_DM_JOIN, extra_where=_VIEWPORT_EXTRA_WHERE.replace(
    "__FEATURED__", "l.tier IN ('agente_premium', 'agencia_premium') OR l.fuente = 'propio'"))

# Points: shared body (no ORDER BY) so the normal and the grid-thinned variants
# select exactly the same columns/filters.
_VIEWPORT_POINTS_BODY = """
WITH lraw AS (
    SELECT ('x'||substr(md5(url),1,8))::bit(32)::int AS id,
           fuente, tier, tipo_operacion, tipo_inmueble,
           precio_cop AS precio, area_m2, precio_m2, NULLIF(habitaciones, -1) AS habitaciones,
           banos, direccion_raw, barrio_id, url, fecha_scraping, amoblado, amenidades, fotos[1] AS foto_principal,
           lat, lon
    FROM staging.stg_listings_unificado
    WHERE (precio_cop >= 500000 OR (tipo_operacion = 'arriendo' AND precio_cop >= 150000))
      AND lat IS NOT NULL AND lat != 0 AND lon IS NOT NULL AND lon != 0
      AND url IS NOT NULL  -- id is md5(url): a NULL url yields id NULL and a 500 on the whole response
      AND NOT (tipo_operacion = 'arriendo' AND precio_cop > 50000000)
      AND NOT (tipo_operacion = 'venta'    AND precio_cop > 50000000000)
)
SELECT
    l.id, l.fuente,
    CASE
        WHEN l.tier IN ('agente_premium', 'agencia_premium') THEN 'agente_verificado'
        WHEN l.fuente = 'propio' AND _lp.owner_plan IN ('pro','agente') THEN 'propio_pro'
        WHEN l.fuente = 'propio' THEN 'propio'
        ELSE l.fuente
    END                          AS fuente_display,
    l.tier, l.tipo_operacion, l.tipo_inmueble,
    CASE WHEN l.tier IN ('agente_premium', 'agencia_premium')
              OR (l.fuente = 'propio' AND _lp.owner_plan IN ('pro','agente'))
         THEN 0 ELSE 1 END       AS _prio,
    l.precio::bigint             AS precio_cop,
    NULL::bigint                 AS precio_usd,  -- filled in Python from the shared TRM
    l.area_m2::float8, round(l.precio_m2)::bigint AS precio_m2, l.habitaciones, l.banos::float8,
    l.direccion_raw, l.url, l.foto_principal,
    l.lat, l.lon, l.barrio_id,
    b.nombre                     AS barrio_nombre,
    b.municipio                  AS municipio,
    g.estrato_real
FROM lraw l
LEFT JOIN analytics.listings_georef g  ON g.url = l.url
LEFT JOIN raw.barrios b                ON b.id = l.barrio_id
LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
{dm_join}
LEFT JOIN (
    SELECT lo.id::text AS lp_url, u.plan AS owner_plan
    FROM public.listing lo
    JOIN public.owner o ON o.id = lo.owner_id
    JOIN public.usuarios u ON u.id = o.usuario_id
) _lp ON _lp.lp_url = l.url AND l.fuente = 'propio'
WHERE ($1::float8 IS NULL OR l.lon >= $1)
  AND ($2::float8 IS NULL OR l.lat >= $2)
  AND ($3::float8 IS NULL OR l.lon <= $3)
  AND ($4::float8 IS NULL OR l.lat <= $4)
  AND ($5::text   IS NULL OR l.tipo_operacion = $5)
  AND ($6::bigint IS NULL OR l.precio >= $6)
  AND ($7::bigint IS NULL OR l.precio <= $7)
  AND ($8::int[]  IS NULL OR l.barrio_id = ANY($8))
  AND ($9::int    IS NULL OR bc.cd_comuna = $9)
  AND ($10::text  IS NULL OR UPPER(b.municipio) = UPPER($10))
  AND ($11::boolean IS NULL OR l.amoblado = $11)
{extra_where}
""".format(dm_join=_VIEWPORT_DM_JOIN, extra_where=_VIEWPORT_EXTRA_WHERE.replace(
    "__FEATURED__",
    "l.tier IN ('agente_premium', 'agencia_premium') "
    "OR (l.fuente = 'propio' AND _lp.owner_plan IN ('pro','agente'))"))

_VIEWPORT_POINTS_SQL = _VIEWPORT_POINTS_BODY + """
ORDER BY
    CASE WHEN l.tier IN ('agente_premium', 'agencia_premium')
              OR (l.fuente = 'propio' AND _lp.owner_plan IN ('pro','agente'))
         THEN 0 ELSE 1 END,
    CASE WHEN l.fuente = 'casadolcecasa' THEN 0 ELSE 1 END,
    -- Round-robin por tipo: el cap de 3000 llenaba con los más recientes y en comunas
    -- densas (Poblado) los apartamentos tienen el fecha_scraping más nuevo → el mapa
    -- solo mostraba aptos aunque hay miles de oficinas/casas/locales. Interleavear por
    -- tipo (1º de cada tipo, 2º de cada tipo, ...) garantiza variedad dentro del cap.
    -- Determinista (tiebreak url) para no romper el ETag/caché.
    ROW_NUMBER() OVER (PARTITION BY lower(l.tipo_inmueble)
                       ORDER BY l.fecha_scraping DESC NULLS LAST, l.url),
    l.fecha_scraping DESC NULLS LAST, l.url
"""

# Zoomed-out variant: keep ONE point per grid cell (cell ~28px on screen), featured
# first, then a deterministic hash order so a cap cuts evenly across the map instead
# of eating one corner. Deterministic -> stable ETag/cache.
_VIEWPORT_POINTS_THIN_SQL = """
SELECT * FROM (
    SELECT t.*, ROW_NUMBER() OVER (
        PARTITION BY floor(t.lat / $25::float8), floor(t.lon / $25::float8)
        ORDER BY t._prio, t.url) AS _cell_rn
    FROM (""" + _VIEWPORT_POINTS_BODY + """) t
) c
WHERE c._cell_rn = 1
ORDER BY c._prio, ('x' || substr(md5(c.url), 1, 8))::bit(32)::int, c.url
"""


@router.get("/viewport", response_model=ViewportResponse)
@limiter.limit("120/minute")
async def get_listings_viewport(
    request: Request,
    min_lng: float = Query(...),
    min_lat: float = Query(...),
    max_lng: float = Query(...),
    max_lat: float = Query(...),
    zoom: int = Query(..., ge=0, le=22),
    tipo_operacion: Optional[str] = Query(default=None),
    precio_min: Optional[int] = Query(default=None),
    precio_max: Optional[int] = Query(default=None),
    barrio_id: Optional[int] = Query(default=None),
    cd_comuna: Optional[int] = Query(default=None),
    municipio: Optional[str] = Query(default=None),
    amoblado: Optional[bool] = Query(default=None),
    habitaciones: Optional[int] = Query(default=None),
    banos: Optional[float] = Query(default=None),
    area_min: Optional[float] = Query(default=None),
    area_max: Optional[float] = Query(default=None),
    estrato: Optional[list[int]] = Query(default=None),
    tipo_inmueble: Optional[list[str]] = Query(default=None),
    dias_mercado: Optional[str] = Query(default=None),
    busqueda: Optional[str] = Query(default=None),
    amenidades: Optional[list[str]] = Query(default=None),
    estado_inmueble: Optional[str] = Query(default=None),
    piso_min: Optional[int] = Query(default=None),
    segmento: Optional[str] = Query(default=None, pattern="^(residencial|comercial|todos)$"),
    ocultar_destacados: bool = Query(default=False),
    moneda: str = Query(default="COP", pattern="^(COP|USD)$"),
    zona_completa: bool = Query(default=False),
    compact: bool = Query(default=False),
):
    """Listings within the map viewport.
    zoom >= 13: every point (cap 3000). 10 <= zoom < 13: real points, grid-thinned
    (one per ~28px cell, cap 1500, `thinned=true`). zoom < 10: comuna/municipio
    clusters (+ a 200-row panel list).
    The viewport bbox and the zone filter (barrio_id / cd_comuna / municipio) are
    INDEPENDENT: both apply. Pass zona_completa=true to explicitly drop the bbox and
    get the whole zone. precio_min/max are interpreted in `moneda` (COP|USD, converted
    with the shared TRM rate). compact=true drops only direccion_raw (cards/popups need photo/barrio/municipio).

    Response is identical for all users (no auth-gated fields) → cacheable public.
    """
    pool = get_pool()
    rate = await get_usd_rate()
    precio_min = cop_from_moneda(precio_min, moneda, rate)
    precio_max = cop_from_moneda(precio_max, moneda, rate)
    barrio_ids: Optional[list[int]] = None
    if barrio_id is not None:
        barrio_ids, _, _ = await _expand_neighbors(pool, barrio_id)
    has_geo = barrio_ids is not None or cd_comuna is not None or municipio is not None
    bbox = (None, None, None, None) if (has_geo and zona_completa) else (min_lng, min_lat, max_lng, max_lat)
    # estrato [] → None so the ANY() guard short-circuits instead of matching nothing.
    estrato_arg = estrato if estrato else None
    tipo_inmueble_arg = _norm_tipos(tipo_inmueble)
    seg = _effective_segmento(segmento, tipo_operacion, tipo_inmueble_arg)
    args = (
        *bbox, tipo_operacion, precio_min, precio_max, barrio_ids, cd_comuna, municipio, amoblado,
        habitaciones, banos, area_min, area_max, estrato_arg, tipo_inmueble_arg,
        (dias_mercado or None), (busqueda.strip() if busqueda and busqueda.strip() else None),
        _amenidad_like_patterns(amenidades),
        estado_inmueble, piso_min, seg, ocultar_destacados,
    )

    def _vl(r) -> ViewportListing:
        d = _finalize_row(dict(r), rate)
        d.pop("_prio", None)
        d.pop("_cell_rn", None)
        if compact:
            # Only direccion_raw is safe to drop: cards/popups/MLSPanel/barrio filter all
            # consume foto_principal, barrio_nombre and municipio.
            d["direccion_raw"] = None
        return ViewportListing(**d)

    if zoom >= _VIEWPORT_FULL_POINTS_ZOOM:
        rows = await pool.fetch(_VIEWPORT_POINTS_SQL + f" LIMIT {_VIEWPORT_POINTS_CAP}", *args)
        result = ViewportResponse(mode="points", zoom=zoom, listings=[_vl(r) for r in rows])
    elif zoom >= _VIEWPORT_CLUSTER_MAX_ZOOM:
        rows = await pool.fetch(
            _VIEWPORT_POINTS_THIN_SQL + f" LIMIT {_VIEWPORT_THIN_CAP}", *args, _thin_cell_deg(zoom))
        result = ViewportResponse(mode="points", zoom=zoom, thinned=True, listings=[_vl(r) for r in rows])
    else:
        # CAMBIO 4A: also return a capped, premium-first panel list for the same bbox/zone.
        clusters, plist = await asyncio.gather(
            pool.fetch(_VIEWPORT_CLUSTERS_SQL, *args),
            pool.fetch(_VIEWPORT_POINTS_SQL + f" LIMIT {_VIEWPORT_PANEL_CAP}", *args),
        )
        result = ViewportResponse(
            mode="clusters", zoom=zoom,
            clusters=[ViewportCluster(**dict(r)) for r in clusters],
            listings=[_vl(r) for r in plist],
        )

    # Public HTTP caching: ETag over the body + 5-min TTL (cache.py rebuilds hourly).
    body = result.model_dump_json()
    etag = 'W/"' + hashlib.md5(body.encode()).hexdigest() + '"'
    headers = {"Cache-Control": "public, max-age=300", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    # Send the already-serialized body directly — no json.loads + JSONResponse
    # re-serialize (that triple-work dominated latency on big point responses).
    return Response(content=body, media_type="application/json", headers=headers)


class SocioListing(BaseModel):
    id: int
    url: str
    tipo_operacion: Optional[str] = None
    tipo_inmueble: Optional[str] = None
    precio_cop: Optional[int] = None
    area_m2: Optional[float] = None
    habitaciones: Optional[int] = None
    banos: Optional[int] = None
    barrio: Optional[str] = None
    foto_principal: Optional[str] = None


_SOCIO_CASADOLCECASA_SQL = """
SELECT id, url, tipo_operacion, tipo_inmueble,
       precio::bigint AS precio_cop, area_m2::float8,
       habitaciones, banos,
       COALESCE(barrio_raw, municipio_raw) AS barrio,
       fotos[1] AS foto_principal
FROM raw.listings_casadolcecasa
WHERE activo AND precio > 0 AND area_m2 > 0
ORDER BY fecha_scraping DESC
LIMIT $1
"""


@router.get("/socio-casadolcecasa", response_model=list[SocioListing])
@limiter.limit("60/minute")
async def get_socio_casadolcecasa(request: Request, limit: int = Query(default=6, ge=1, le=12)):
    """Listings del socio patrocinado Casa Dolce Casa, para el home."""
    pool = get_pool()
    rows = await pool.fetch(_SOCIO_CASADOLCECASA_SQL, limit)
    return [SocioListing(**dict(r)) for r in rows]


class AgenteDirectorio(BaseModel):
    id: str
    nombre: str
    foto_url: Optional[str] = None
    telefono: str
    email: str
    zonas: list[str] = []
    agencia_nombre: Optional[str] = None
    agencia_verificada: bool = False
    rating_promedio: Optional[float] = None  # None = sin reseñas (nunca 0 falso)
    n_resenas: int = 0


# zonas = nombres de comuna/barrio con sponsorship VIGENTE (fecha activa hoy) del
# agente — mismo criterio que _LISTING_AGENTE_SQL. Solo comuna/barrio (municipio
# no tiene un caso de uso real todavía). agencia_verificada viene de agency.verificada
# (flag real que ya mantiene el sistema, no inventado). rating_promedio/n_resenas
# de agent_review — pre-agregados en su propio CTE porque unirlos crudo al de sp
# (otro 1-a-muchos) infla el array_agg de zonas por producto cartesiano.
_AGENTES_DIRECTORIO_SQL = """
WITH sp AS (
    SELECT am.agent_id,
           CASE s.zona_nivel
             WHEN 'comuna' THEN (SELECT b.comuna FROM raw.barrios b
                                  JOIN analytics.barrios_cd bc ON bc.barrio_id = b.id
                                  WHERE bc.cd_comuna = s.zona_codigo::int LIMIT 1)
             WHEN 'barrio' THEN (SELECT nombre FROM raw.barrios WHERE id = s.zona_codigo::int)
             ELSE NULL
           END AS zona_nombre
    FROM sponsorship s
    JOIN agency_member am ON am.agency_id = s.agency_id
    WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
),
rev AS (
    SELECT agent_id,
           ROUND(AVG(calificacion)::numeric, 1)::float8 AS rating_promedio,
           COUNT(*)::int AS n_resenas
    FROM agent_review
    GROUP BY agent_id
)
SELECT a.id::text, a.nombre, a.foto_url, a.telefono, a.email,
       COALESCE(array_agg(DISTINCT sp.zona_nombre) FILTER (WHERE sp.zona_nombre IS NOT NULL), '{}') AS zonas,
       agcy.agencia_nombre, COALESCE(agcy.agencia_verificada, false) AS agencia_verificada,
       rev.rating_promedio, COALESCE(rev.n_resenas, 0) AS n_resenas
FROM agent a
LEFT JOIN sp  ON sp.agent_id = a.id
LEFT JOIN rev ON rev.agent_id = a.id
LEFT JOIN LATERAL (
    SELECT ag.nombre AS agencia_nombre, ag.verificada AS agencia_verificada
    FROM agency_member am2 JOIN agency ag ON ag.id = am2.agency_id
    WHERE am2.agent_id = a.id LIMIT 1
) agcy ON true
WHERE a.estado = 'activo'
GROUP BY a.id, a.nombre, a.foto_url, a.telefono, a.email,
         agcy.agencia_nombre, agcy.agencia_verificada, rev.rating_promedio, rev.n_resenas
ORDER BY a.nombre
"""


@router.get("/agentes", response_model=list[AgenteDirectorio])
@limiter.limit("60/minute")
async def get_agentes_directorio(request: Request):
    """Directorio público de agentes activos, para /agentes ('Encuentra un agente')."""
    pool = get_pool()
    rows = await pool.fetch(_AGENTES_DIRECTORIO_SQL)
    return [AgenteDirectorio(**dict(r)) for r in rows]


# ── Perfil público de un agente (tipo Zillow) ─────────────────────────────────
# Self-descrito (bio, foto) + auto-agregado de su actividad IN-PLATFORM: listings
# activos + cerrados (sus "cierres"), zonas, reseñas. NO expone email (contacto va
# por WhatsApp con el teléfono). Cierres = listing.estado='cerrado' del propio
# agente — self-marcado, no verificado-MLS (no existe ese feed acá). Vacío hasta
# que agentes registrados creen/cierren listings in-platform.
# mostrar_exacto: no devolvemos geom ni dirección exacta — solo barrio/municipio,
# así el mostrar_exacto=false se respeta por omisión.
class AgentePerfilListing(BaseModel):
    id: str
    slug: Optional[str] = None
    titulo: Optional[str] = None
    precio: Optional[float] = None
    moneda: str = "COP"
    operacion: Optional[str] = None
    tipo_inmueble: Optional[str] = None
    area_m2: Optional[float] = None
    habitaciones: Optional[int] = None
    banos: Optional[int] = None
    municipio: Optional[str] = None
    barrio: Optional[str] = None
    foto_portada: Optional[str] = None


class AgentePerfilResena(BaseModel):
    calificacion: int
    comentario: Optional[str] = None
    autor: str = "Usuario"
    created_at: Optional[datetime] = None


class AgentePerfilZona(BaseModel):
    nivel: str
    nombre: Optional[str] = None


class AgentePerfil(BaseModel):
    id: str
    nombre: str
    foto_url: Optional[str] = None
    bio: Optional[str] = None
    telefono: Optional[str] = None  # para link WhatsApp; email nunca se expone
    agencia_nombre: Optional[str] = None
    agencia_verificada: bool = False
    miembro_desde: Optional[datetime] = None
    rating_promedio: Optional[float] = None
    n_resenas: int = 0
    zonas: list[AgentePerfilZona] = []
    activos: list[AgentePerfilListing] = []
    cierres: list[AgentePerfilListing] = []
    n_activos: int = 0
    n_cierres: int = 0
    precio_min: Optional[float] = None
    precio_max: Optional[float] = None
    resenas: list[AgentePerfilResena] = []


_AGENTE_PERFIL_SQL = """
SELECT a.id::text, a.nombre, a.foto_url, a.bio, a.telefono, a.created_at AS miembro_desde,
       agcy.agencia_nombre, COALESCE(agcy.agencia_verificada, false) AS agencia_verificada,
       rev.rating_promedio, COALESCE(rev.n_resenas, 0) AS n_resenas
FROM agent a
LEFT JOIN LATERAL (
    SELECT ag.nombre AS agencia_nombre, ag.verificada AS agencia_verificada
    FROM agency_member am JOIN agency ag ON ag.id = am.agency_id
    WHERE am.agent_id = a.id LIMIT 1
) agcy ON true
LEFT JOIN (
    SELECT agent_id, ROUND(AVG(calificacion)::numeric, 1)::float8 AS rating_promedio,
           COUNT(*)::int AS n_resenas
    FROM agent_review GROUP BY agent_id
) rev ON rev.agent_id = a.id
WHERE a.id = $1 AND a.estado = 'activo'
"""

_AGENTE_PERFIL_LISTINGS_SQL = """
SELECT l.id::text, l.slug, l.titulo, l.precio::float8 AS precio, l.moneda,
       l.operacion::text AS operacion, l.tipo_inmueble::text AS tipo_inmueble,
       l.area_m2::float8 AS area_m2, l.habitaciones, l.banos,
       l.municipio, l.barrio, l.estado::text AS estado,
       (SELECT url FROM listing_media m WHERE m.listing_id = l.id AND m.es_portada LIMIT 1) AS foto_portada
FROM listing l
WHERE l.agent_id = $1 AND l.estado IN ('publicado', 'cerrado')
ORDER BY l.updated_at DESC
"""

_AGENTE_PERFIL_ZONAS_SQL = """
SELECT DISTINCT s.zona_nivel::text AS nivel,
       CASE s.zona_nivel
         WHEN 'comuna' THEN (SELECT b.comuna FROM raw.barrios b
                              JOIN analytics.barrios_cd bc ON bc.barrio_id = b.id
                              WHERE bc.cd_comuna = s.zona_codigo::int LIMIT 1)
         WHEN 'barrio' THEN (SELECT nombre FROM raw.barrios WHERE id = s.zona_codigo::int)
         ELSE NULL
       END AS nombre
FROM sponsorship s
JOIN agency_member am ON am.agency_id = s.agency_id AND am.agent_id = $1
WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
"""

_AGENTE_PERFIL_RESENAS_SQL = """
SELECT r.calificacion, r.comentario, r.created_at,
       COALESCE(NULLIF(split_part(u.nombre, ' ', 1), ''), 'Usuario') AS autor
FROM agent_review r
LEFT JOIN public.usuarios u ON u.id = r.user_id
WHERE r.agent_id = $1
ORDER BY r.created_at DESC
LIMIT 20
"""


@router.get("/agentes/{agent_id}", response_model=AgentePerfil)
@limiter.limit("60/minute")
async def get_agente_perfil(request: Request, agent_id: str):
    """Perfil público de un agente: bio/foto + su actividad in-platform + reseñas."""
    pool = get_pool()
    base = await pool.fetchrow(_AGENTE_PERFIL_SQL, agent_id)
    if not base:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    listings = await pool.fetch(_AGENTE_PERFIL_LISTINGS_SQL, agent_id)
    zonas = await pool.fetch(_AGENTE_PERFIL_ZONAS_SQL, agent_id)
    resenas = await pool.fetch(_AGENTE_PERFIL_RESENAS_SQL, agent_id)

    activos, cierres, precios = [], [], []
    for r in listings:
        item = AgentePerfilListing(**{k: r[k] for k in r.keys() if k != "estado"})
        if r["precio"] is not None:
            precios.append(r["precio"])
        (cierres if r["estado"] == "cerrado" else activos).append(item)

    return AgentePerfil(
        id=base["id"], nombre=base["nombre"], foto_url=base["foto_url"], bio=base["bio"],
        telefono=base["telefono"], agencia_nombre=base["agencia_nombre"],
        agencia_verificada=base["agencia_verificada"], miembro_desde=base["miembro_desde"],
        rating_promedio=base["rating_promedio"], n_resenas=base["n_resenas"],
        zonas=[AgentePerfilZona(nivel=z["nivel"], nombre=z["nombre"]) for z in zonas
               if z["nombre"]],
        activos=activos, cierres=cierres, n_activos=len(activos), n_cierres=len(cierres),
        precio_min=min(precios) if precios else None,
        precio_max=max(precios) if precios else None,
        resenas=[AgentePerfilResena(**dict(r)) for r in resenas],
    )


class ResenaIn(BaseModel):
    calificacion: int = Field(ge=1, le=5)
    comentario: Optional[str] = None


@router.post("/agentes/{agent_id}/resenas", status_code=201)
@limiter.limit("10/minute")
async def crear_resena_agente(request: Request, agent_id: str, body: ResenaIn, current_user: dict = Depends(get_current_user)):
    """Deja/actualiza tu reseña de un agente. Login-gated: un usuario, una
    reseña por agente (UNIQUE agent_id+user_id) — es el piso anti-spam, sin
    cola de moderación (ponytail: agregar si aparece abuso)."""
    pool = get_pool()
    agente = await pool.fetchval("SELECT 1 FROM agent WHERE id = $1 AND estado = 'activo'", agent_id)
    if not agente:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    await pool.execute(
        """INSERT INTO agent_review (agent_id, user_id, calificacion, comentario)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_id, user_id)
           DO UPDATE SET calificacion = EXCLUDED.calificacion,
                         comentario = EXCLUDED.comentario,
                         created_at = now()""",
        agent_id, current_user["id"], body.calificacion, body.comentario,
    )
    return {"ok": True}


@router.get("/{listing_id}", response_model=ListingDetail)
@limiter.limit("100/minute")
async def get_listing_by_id(
    request: Request,
    listing_id: int,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    pool = get_pool()
    row = await pool.fetchrow(_LISTING_BY_ID_SQL, listing_id)
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    row_d = dict(row)
    historia = await pool.fetch(_PRECIO_HISTORIA_SQL, row_d.get("url") or "")  # before url is nulled for 'propio'
    _finalize_row(row_d, await get_usd_rate())
    row_d["precio_historia"] = [dict(h) for h in historia] if historia else []
    # Inteligencia de mercado/barrio — solo agentes; el front solo decide UI.
    _gate_market_fields(row_d, is_agente(current_user))
    return ListingDetail(**row_d)


# Realtores de contacto = agentes de las agencias que patrocinan la zona del
# inmueble. Devolvemos AMBOS niveles: el de comuna es el patrocinio caro ($1k) →
# tarjeta principal; el de barrio ($200) → tarjeta secundaria menos llamativa.
# Dentro de cada nivel, preferimos owner de la agencia sobre agente. Público;
# cada nivel es null si esa zona no está patrocinada.
class ListingAgente(BaseModel):
    nombre: str
    telefono: str
    foto_url: Optional[str] = None
    email: Optional[str] = None
    zona_nivel: str  # 'barrio' | 'comuna'


class ListingAgentes(BaseModel):
    comuna: Optional[ListingAgente] = None
    barrio: Optional[ListingAgente] = None


_LISTING_AGENTE_SQL = """
WITH lz AS (
    SELECT l.barrio_id, bc.cd_comuna
    FROM staging.stg_listings_unificado l
    LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
    WHERE ('x'||substr(md5(l.url),1,8))::bit(32)::int = $1
    LIMIT 1
),
ranked AS (
    SELECT a.nombre, a.telefono, a.foto_url, a.email, s.zona_nivel::text AS zona_nivel,
           ROW_NUMBER() OVER (
               PARTITION BY s.zona_nivel
               ORDER BY CASE WHEN am.rol::text = 'owner' THEN 0 ELSE 1 END, s.fecha_inicio
           ) AS rn
    FROM sponsorship s
    JOIN agency_member am ON am.agency_id = s.agency_id
    JOIN agent a ON a.id = am.agent_id AND a.estado = 'activo'
    JOIN lz ON (
        (s.zona_nivel = 'barrio' AND s.zona_codigo = lz.barrio_id::text)
        OR (s.zona_nivel = 'comuna' AND s.zona_codigo = lz.cd_comuna::text)
    )
    WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
)
SELECT nombre, telefono, foto_url, email, zona_nivel FROM ranked WHERE rn = 1
"""


@router.get("/{listing_id}/agente", response_model=ListingAgentes)
@limiter.limit("100/minute")
async def get_listing_agente(request: Request, listing_id: int):
    pool = get_pool()
    rows = await pool.fetch(_LISTING_AGENTE_SQL, listing_id)
    out = ListingAgentes()
    for r in rows:
        ag = ListingAgente(**dict(r))
        if ag.zona_nivel == "comuna":
            out.comuna = ag
        else:
            out.barrio = ag
    return out


class SimilarListing(BaseModel):
    id: int
    url: str
    precio_cop: Optional[int] = None
    area_m2: Optional[float] = None
    habitaciones: Optional[int] = None
    banos: Optional[float] = None
    barrio_nombre: Optional[str] = None
    dias_en_mercado: Optional[int] = None
    foto_principal: Optional[str] = None
    tipo_inmueble: Optional[str] = None


_SIMILARES_SQL = """
WITH ref AS (
    SELECT l.barrio_id, l.tipo_inmueble, l.precio_cop, l.tipo_operacion, l.url,
           bc.cd_comuna
    FROM staging.stg_listings_unificado l
    LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
    WHERE ('x'||substr(md5(l.url),1,8))::bit(32)::int = $1
    LIMIT 1
),
barrio_matches AS (
    SELECT ('x'||substr(md5(l.url),1,8))::bit(32)::int AS id,
           l.url, l.precio_cop, l.area_m2,
           NULLIF(l.habitaciones, -1) AS habitaciones, l.banos,
           b.nombre AS barrio_nombre,
           NULL::int AS dias_en_mercado,
           COALESCE(l.fotos[1], lp.fotos[1]) AS foto_principal,
           l.tipo_inmueble,
           1 AS scope_priority
    FROM staging.stg_listings_unificado l
    JOIN raw.barrios b ON b.id = l.barrio_id
    JOIN analytics.listings_georef g ON g.url = l.url
    LEFT JOIN raw.listings_premium lp ON lp.url = l.url
    JOIN ref r ON r.barrio_id = l.barrio_id
    WHERE l.url <> (SELECT url FROM ref)
      AND l.tipo_operacion = (SELECT tipo_operacion FROM ref)
      AND l.tipo_inmueble  IS NOT DISTINCT FROM (SELECT tipo_inmueble FROM ref)
      AND l.precio_cop BETWEEN (SELECT precio_cop FROM ref) * 0.80
                            AND (SELECT precio_cop FROM ref) * 1.20
),
comuna_matches AS (
    SELECT ('x'||substr(md5(l.url),1,8))::bit(32)::int AS id,
           l.url, l.precio_cop, l.area_m2,
           NULLIF(l.habitaciones, -1) AS habitaciones, l.banos,
           b.nombre AS barrio_nombre,
           NULL::int AS dias_en_mercado,
           COALESCE(l.fotos[1], lp.fotos[1]) AS foto_principal,
           l.tipo_inmueble,
           2 AS scope_priority
    FROM staging.stg_listings_unificado l
    JOIN raw.barrios b ON b.id = l.barrio_id
    JOIN analytics.listings_georef g ON g.url = l.url
    LEFT JOIN analytics.barrios_cd bc2 ON bc2.barrio_id = l.barrio_id
    LEFT JOIN raw.listings_premium lp ON lp.url = l.url
    JOIN ref r ON r.cd_comuna = bc2.cd_comuna AND r.cd_comuna IS NOT NULL
    WHERE l.url <> (SELECT url FROM ref)
      AND l.barrio_id <> (SELECT barrio_id FROM ref)
      AND l.tipo_operacion = (SELECT tipo_operacion FROM ref)
      AND l.tipo_inmueble  IS NOT DISTINCT FROM (SELECT tipo_inmueble FROM ref)
      AND l.precio_cop BETWEEN (SELECT precio_cop FROM ref) * 0.80
                            AND (SELECT precio_cop FROM ref) * 1.20
),
combined AS (
    SELECT * FROM barrio_matches
    UNION ALL
    SELECT cm.* FROM comuna_matches cm
    WHERE (SELECT COUNT(*) FROM barrio_matches) < 2
)
SELECT DISTINCT ON (id) id, url, precio_cop, area_m2, habitaciones,
       banos, barrio_nombre, dias_en_mercado, foto_principal, tipo_inmueble
FROM combined
ORDER BY id, scope_priority ASC, dias_en_mercado ASC NULLS LAST
LIMIT 4
"""


@router.get("/{listing_id}/similares", response_model=list[SimilarListing])
@limiter.limit("60/minute")
async def get_similares(request: Request, listing_id: int):
    pool = get_pool()
    rows = await pool.fetch(_SIMILARES_SQL, listing_id)
    return [SimilarListing(**dict(r)) for r in rows]


# ── Slots de visita disponibles (horario del agente de zona, sin Google) ──────
_LISTING_AGENT_ID_SQL = """
WITH lz AS (
    SELECT l.barrio_id, bc.cd_comuna
    FROM staging.stg_listings_unificado l
    LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
    WHERE ('x'||substr(md5(l.url),1,8))::bit(32)::int = $1 LIMIT 1
)
SELECT a.id AS agent_id
FROM sponsorship s
JOIN agency_member am ON am.agency_id = s.agency_id
JOIN agent a ON a.id = am.agent_id AND a.estado = 'activo'
JOIN lz ON ((s.zona_nivel = 'barrio' AND s.zona_codigo = lz.barrio_id::text)
         OR (s.zona_nivel = 'comuna' AND s.zona_codigo = lz.cd_comuna::text))
WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
ORDER BY CASE WHEN s.zona_nivel = 'comuna' THEN 0 ELSE 1 END,
         CASE WHEN am.rol::text = 'owner' THEN 0 ELSE 1 END, s.fecha_inicio
LIMIT 1
"""

_AGENT_BOOKED_SQL = """
SELECT v.fecha_visita
FROM visita_solicitud v
LEFT JOIN staging.stg_listings_unificado s ON s.url = v.listing_url
LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = s.barrio_id
WHERE v.fecha_visita IS NOT NULL AND v.estado IN ('pendiente', 'confirmada')
  AND EXISTS (
    SELECT 1 FROM sponsorship sp
    JOIN agency_member am ON am.agency_id = sp.agency_id AND am.agent_id = $1
    WHERE sp.estado = 'activa' AND CURRENT_DATE BETWEEN sp.fecha_inicio AND sp.fecha_fin
      AND ((sp.zona_nivel = 'barrio' AND sp.zona_codigo = s.barrio_id::text)
        OR (sp.zona_nivel = 'comuna' AND sp.zona_codigo = bc.cd_comuna::text)))
"""

_BOGOTA = timezone(timedelta(hours=-5))  # Colombia, sin DST


def _fmt_hora(h: int, m: int) -> str:
    ampm = "AM" if h < 12 else "PM"
    hh = h % 12 or 12
    return f"{hh}:{m:02d} {ampm}"


@router.get("/{listing_id}/slots")
@limiter.limit("60/minute")
async def get_slots(request: Request, listing_id: int):
    """Slots de visita para el agente de zona del listing: su horario semanal menos
    los ya reservados. Sin agente/sin horario → slots vacío (el front usa fallback)."""
    pool = get_pool()
    agent_id = await pool.fetchval(_LISTING_AGENT_ID_SQL, listing_id)
    if not agent_id:
        return {"has_agent": False, "configured": False, "slots": {}}
    franjas = await pool.fetch(
        "SELECT dia_semana, hora_inicio, hora_fin FROM agent_disponibilidad WHERE agent_id = $1",
        agent_id,
    )
    if not franjas:
        return {"has_agent": True, "configured": False, "slots": {}}

    booked = set()
    for r in await pool.fetch(_AGENT_BOOKED_SQL, agent_id):
        b = r["fecha_visita"].astimezone(_BOGOTA)
        booked.add((b.date(), b.hour, b.minute))

    by_dow: dict[int, list] = {}
    for f in franjas:
        by_dow.setdefault(f["dia_semana"], []).append((f["hora_inicio"], f["hora_fin"]))

    now = datetime.now(_BOGOTA)
    slots: dict[str, list[str]] = {}
    for i in range(14):
        d = (now + timedelta(days=i)).date()
        for (ini, fin) in by_dow.get(d.weekday(), []):
            h, m = ini.hour, ini.minute
            horas: list[str] = []
            while (h, m) < (fin.hour, fin.minute):
                dt = datetime(d.year, d.month, d.day, h, m, tzinfo=_BOGOTA)
                if dt > now + timedelta(hours=2) and (d, h, m) not in booked:
                    horas.append(_fmt_hora(h, m))
                m += 30
                if m >= 60:
                    m, h = 0, h + 1
            if horas:
                slots.setdefault(d.isoformat(), []).extend(horas)
    return {"has_agent": True, "configured": True, "slots": slots}


class VistaPayload(BaseModel):
    ip_hash: Optional[str] = None


@router.post("/{listing_id}/vista")
@limiter.limit("60/minute")
async def registrar_vista(
    listing_id: int,
    request: Request,
    payload: Optional[VistaPayload] = None,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    pool = get_pool()
    url_row = await pool.fetchrow(
        """SELECT url FROM staging.stg_listings_unificado
           WHERE ('x'||substr(md5(url),1,8))::bit(32)::int = $1
           LIMIT 1""",
        listing_id,
    )
    if not url_row:
        return {"ok": False, "vistas": 0}

    listing_url: str = url_row["url"]
    usuario_id: Optional[int] = current_user["id"] if current_user else None

    ip_raw = request.headers.get("X-Forwarded-For", request.client.host if request.client else "")
    ip_hash = hashlib.sha256(ip_raw.encode()).hexdigest()[:16] if ip_raw else None

    session_id = f"anon-{ip_hash or 'unknown'}"

    try:
        await pool.execute(
            """INSERT INTO public.user_events
                   (usuario_id, session_id, event_type, entity_type, entity_id)
               VALUES ($1, $2, 'listing_view', 'listing', $3)""",
            usuario_id,
            session_id,
            listing_url,
        )
    except Exception:
        pass

    vistas = await pool.fetchval(
        """SELECT COUNT(*)::int FROM public.user_events
           WHERE event_type = 'listing_view' AND entity_type = 'listing' AND entity_id = $1""",
        listing_url,
    )
    return {"ok": True, "vistas": vistas or 0}


# ── Reclama tu inmueble (claim your home) ────────────────────────────────────
class ReclamarRequest(BaseModel):
    nombre: str
    telefono: str
    email: Optional[str] = None
    matricula_declarada: Optional[str] = None
    mensaje: Optional[str] = None


@router.post("/{listing_id}/reclamar", status_code=201)
@limiter.limit("10/minute")
async def reclamar_listing(
    listing_id: int,
    request: Request,
    req: ReclamarRequest,
    current_user: dict = Depends(get_current_user),
):
    """Un dueño/agente reclama un listing YA scrapeado (sin dueño en el sistema).
    El reclamo se guarda y enruta como LEAD al realtor de zona (intake/asignador);
    el realtor verifica la propiedad al trabajar el lead — no hay gate de admin."""
    if not req.nombre.strip() or not req.telefono.strip():
        raise HTTPException(400, "Nombre y teléfono son obligatorios")

    pool = get_pool()
    # Reverse-lookup desde el hash int (mismo patrón que /vista) — trae lo que
    # el intake necesita para asignar zona.
    row = await pool.fetchrow(
        """SELECT url, fuente, lat, lon, tipo_operacion, tipo_inmueble,
                  barrio_id, precio_cop, area_m2, habitaciones, banos
           FROM staging.stg_listings_unificado
           WHERE ('x'||substr(md5(url),1,8))::bit(32)::int = $1
           LIMIT 1""",
        listing_id,
    )
    if not row:
        raise HTTPException(404, "Listing no encontrado")
    if (row["fuente"] or "") == "propio":
        raise HTTPException(400, "Este inmueble ya tiene dueño en la plataforma")

    listing_url = row["url"]
    # Idempotente: unique(listing_url, usuario_id) → re-submit no duplica.
    inserted = await pool.fetchrow(
        """
        INSERT INTO listing_reclamo
            (usuario_id, listing_url, fuente, nombre_contacto, telefono,
             email_contacto, matricula_declarada, mensaje)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (listing_url, usuario_id) DO NOTHING
        RETURNING id
        """,
        current_user["id"], listing_url, row["fuente"],
        req.nombre.strip(), req.telefono.strip(),
        (req.email or "").strip() or None,
        (req.matricula_declarada or "").strip() or None,
        (req.mensaje or "").strip() or None,
    )
    if inserted is None:
        existing = await pool.fetchval(
            "SELECT estado FROM listing_reclamo WHERE listing_url=$1 AND usuario_id=$2",
            listing_url, current_user["id"],
        )
        return {"ok": True, "estado": existing or "pendiente", "ya_reclamado": True}

    # Enruta el reclamo como lead al realtor de zona (reusa intake/asignador del
    # flujo owner-publish). El realtor verifica la propiedad trabajando el lead.
    # Falla suave: si la asignación revienta, el reclamo YA quedó guardado.
    operacion = "arriendo" if (row["tipo_operacion"] or "") == "arriendo" else "venta"
    tipo_intake = _INTAKE_TIPO.get((row["tipo_inmueble"] or "").lower(), "apartamento")
    if row["lat"] is not None and row["lon"] is not None:
        try:
            owner_id = await get_or_create_owner(current_user, pool)
            barrio_id = row["barrio_id"]
            zona_codigo = str(barrio_id) if barrio_id is not None else None
            barrio_nom = municipio_nom = None
            if barrio_id is not None:
                brow = await pool.fetchrow(
                    "SELECT nombre, municipio FROM raw.barrios WHERE id = $1", barrio_id
                )
                if brow:
                    barrio_nom, municipio_nom = brow["nombre"], brow["municipio"]
            intake_id = str(uuid.uuid4())
            hab = int(row["habitaciones"]) if row["habitaciones"] is not None else None
            ban = int(row["banos"]) if row["banos"] is not None else None
            declaraciones = {"origen": "reclamo", "listing_url": listing_url,
                             "matricula_declarada": (req.matricula_declarada or "").strip() or None}
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO intake (
                        id, owner_id, listing_id, estado, operacion, tipo_inmueble,
                        geom, municipio, barrio, zona_nivel, zona_codigo,
                        direccion_aprox, precio_esperado, area_m2, habitaciones,
                        banos, declaraciones
                    ) VALUES (
                        $1, $2, NULL, 'nuevo', $3, $4,
                        ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, 'barrio', $9,
                        $10, $11, $12, $13, $14, $15::jsonb
                    )
                    """,
                    intake_id, owner_id, operacion, tipo_intake,
                    row["lon"], row["lat"], municipio_nom, barrio_nom, zona_codigo,
                    (req.mensaje or "").strip() or None, row["precio_cop"],
                    row["area_m2"], hab, ban,
                    json.dumps(declaraciones),
                )
            await asignar_intake(
                SimpleNamespace(
                    id=intake_id, estado="nuevo", agent_id=None,
                    zona_codigo=zona_codigo, geom=f"POINT({row['lon']} {row['lat']})",
                ),
                pool,
            )
        except Exception:
            logger.exception("reclamar_listing: intake/asignación falló para %s", listing_url)

    return {"ok": True, "estado": "pendiente"}
