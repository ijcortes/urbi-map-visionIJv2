from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from api.config import USD_TO_COP
from api.db import get_pool
from api.dependencies import get_optional_user, is_agente
from api.routers.listings import ListingFull, ListingsAllResponse
from api.services.personalizacion import PRESUPUESTO_MAX

router = APIRouter()

# Explicit whitelist: score_col is interpolated into SQL, so it MUST only
# ever be one of these three known column names. Never accept user input directly.
_PERFIL_SCORE = {
    "airbnb": "score_corto",
    "nomadas": "score_mediano",       # legacy alias — keep for existing sessions
    "mediano_plazo": "score_mediano", # canonical new name
    "largo_plazo": "score_largo",
    # frontend Goal values (renta-larga uses hyphen, valorizacion maps to long-term)
    "renta-larga": "score_largo",
    "valorizacion": "score_largo",
    # corrupted DB values — map to their closest intent
    "score_mediano": "score_mediano",
    "mixto": "score_corto",          # ambiguous → default corto (handled by max below)
}


def get_score_col(perfil: Optional[str]) -> str:
    """Return a safe, whitelisted column name for the given perfil.

    Callers must use this instead of interpolating perfil directly — the column
    name goes into raw SQL and the whitelist is the only injection guard.
    """
    return _PERFIL_SCORE.get(perfil or "", "score_corto")


_USD = USD_TO_COP

def _score_to_hex(score: Optional[int], perfil: Optional[str] = None) -> str:
    if score is None or score == 0:
        return "#00d4ff"
    # FIX 3: score_mediano distribution is p25=11, p50=18, p75=23, max=56 —
    # old thresholds (55/40/25) produced almost no green/teal. Calibrated to percentiles.
    if perfil in ("nomadas", "mediano_plazo"):
        if score >= 23: return "#10b981"   # top 25%
        if score >= 18: return "#2BBAA5"   # top 50%
        if score >= 11: return "#f59e0b"   # top 75%
        return "#ef4444"
    if perfil in ("largo_plazo", "renta-larga", "valorizacion"):
        # score_largo: p25=37, p50=42, p75=54, max=89
        if score >= 54: return "#10b981"
        if score >= 42: return "#2BBAA5"
        if score >= 37: return "#f59e0b"
        return "#ef4444"
    # Default (score_corto / no perfil / max score): p25=27, p50=28, p75=34, max=76
    if score >= 60:
        return "#10b981"
    if score >= 45:
        return "#2BBAA5"
    if score >= 30:
        return "#f59e0b"
    return "#ef4444"


# ── Models ────────────────────────────────────────────────────────────────────

class Scores(BaseModel):
    corto: Optional[int] = None
    cat_corto: Optional[str] = None
    mediano: Optional[int] = None
    cat_mediano: Optional[str] = None
    largo: Optional[int] = None
    cat_largo: Optional[str] = None
    perfil_recomendado: Optional[str] = None
    score_activo: Optional[int] = None


class Mercado(BaseModel):
    precio_m2_cop: Optional[int] = None
    precio_m2_usd: Optional[int] = None
    precio_venta_promedio: Optional[int] = None
    arriendo_p50_cop: Optional[int] = None
    yield_bruto_pct: Optional[float] = None
    anos_recupero: Optional[float] = None
    estado_precio: Optional[str] = None
    pbn_precio_justo: Optional[int] = None
    poi_precio_oferta: Optional[int] = None
    yield_renta_media_pct: Optional[float] = None
    precio_renta_media_p50: Optional[int] = None
    premium_vs_largo_pct: Optional[float] = None
    n_listings_renta_media: Optional[int] = None
    precio_accesible: Optional[bool] = None
    presupuesto_max: Optional[int] = None


class NomadaBreakdown(BaseModel):
    pts_yield: Optional[int] = None       # /25
    pts_nomada: Optional[int] = None      # /30
    pts_pbn: Optional[int] = None         # /18
    pts_seguridad: Optional[int] = None   # /12
    pts_verde: Optional[int] = None       # /10
    pts_equip: Optional[int] = None       # /5


class Airbnb(BaseModel):
    ocupacion_pct: Optional[float] = None
    ocupacion_p25_pct: Optional[float] = None
    ocupacion_p75_pct: Optional[float] = None
    adr_usd: Optional[float] = None
    adr_cop: Optional[int] = None
    yield_airbnb_pct: Optional[float] = None
    yield_airbnb_real_pct: Optional[float] = None
    n_listings: Optional[int] = None
    n_entire_home: Optional[int] = None
    n_private_room: Optional[int] = None
    n_superhosts: Optional[int] = None
    ingresos_anuales_p50_usd: Optional[float] = None
    ingresos_anuales_p50_cop: Optional[int] = None
    rating_promedio: Optional[float] = None
    reviews_promedio: Optional[float] = None
    diff_ocupacion_pct: Optional[float] = None
    diff_adr_cop: Optional[float] = None


class Amenidades(BaseModel):
    pct_wifi: Optional[float] = None
    pct_ac: Optional[float] = None
    pct_kitchen: Optional[float] = None
    pct_washer: Optional[float] = None
    score_equipamiento: Optional[int] = None
    n_listings_base: Optional[int] = None


class Seguridad(BaseModel):
    score: Optional[int] = None
    categoria: Optional[str] = None
    zona_turistica: Optional[bool] = None
    tendencia: Optional[str] = None
    nota: Optional[str] = None


class Conectividad(BaseModel):
    dist_metro_km: Optional[float] = None
    dist_parque_km: Optional[float] = None
    dist_mall_km: Optional[float] = None
    n_cafes_500m: Optional[int] = None
    n_coworking_1km: Optional[int] = None
    n_gimnasios_1km: Optional[int] = None
    n_yoga_1km: Optional[int] = None
    indice_nomada: Optional[float] = None
    # Colegios cercanos + scores estilo Zillow (walk/transit)
    n_colegios_1km: Optional[int] = None
    dist_colegio_km: Optional[float] = None
    n_parques_inf_500m: Optional[int] = None
    n_canchas_1km: Optional[int] = None
    dist_encicla_km: Optional[float] = None
    n_policia_1km: Optional[int] = None
    dist_policia_km: Optional[float] = None
    n_bomberos_2km: Optional[int] = None
    avg_internet_mbps: Optional[float] = None
    n_tests_internet: Optional[int] = None
    # Puntaje Saber 11 promedio del MUNICIPIO (no hay dato por barrio/comuna)
    score_icfes_municipio: Optional[float] = None
    dist_obra_publica_km: Optional[float] = None
    nombre_obra_cercana: Optional[str] = None
    # dB promedio de día de la estación/sensor SIATA más cercano (red oficial + ciudadana)
    db_ruido_dia_cercano: Optional[float] = None
    dist_ruido_km: Optional[float] = None
    walk_score: Optional[int] = None
    transit_score: Optional[int] = None


class Verde(BaseModel):
    indice_verde_pct: Optional[float] = None
    categoria: Optional[str] = None
    score_verde: Optional[int] = None


class Trafico(BaseModel):
    nivel: Optional[str] = None            # bajo | medio | alto
    jam_prom: Optional[float] = None       # jamFactor HERE 0-10 (10=parado)
    pico_am_inicio: Optional[int] = None
    pico_am_fin: Optional[int] = None
    pico_pm_inicio: Optional[int] = None
    pico_pm_fin: Optional[int] = None


class Liquidez(BaseModel):
    score: Optional[int] = None
    categoria: Optional[str] = None
    tiempo_estimado_venta: Optional[str] = None
    nota_metodologia: Optional[str] = None


class Oportunidad(BaseModel):
    detectada: Optional[bool] = None
    tipo: Optional[str] = None
    descripcion: Optional[str] = None


class Valorizacion(BaseModel):
    var_anual_pct: Optional[float] = None
    proyeccion_3anos_pct: Optional[float] = None
    proyeccion_5anos_pct: Optional[float] = None
    tendencia: Optional[str] = None


# Mediana de (precio_m2_mercado / avaluo_m2_catastro) a nivel commune, Medellín 2026.
# Actualizar anualmente cuando se recargue catastro.
_CIUDAD_RATIO_MEDIANA: float = 58.8


class CatastroComuna(BaseModel):
    total_predios: Optional[int] = None
    pct_apartamento: Optional[float] = None
    area_mediana_apto_m2: Optional[int] = None
    avaluo_m2: Optional[int] = None
    ratio_mercado_catastro: Optional[float] = None
    ratio_vs_ciudad: Optional[float] = None


# Compraventas reales (SNR/ORIPS) a nivel MUNICIPIO — no hay geo/dirección en
# la fuente, así que no baja a barrio (ver memoria project_datos_huerfanos_techos_reales).
# n_transacciones/valor_mediana son del último año completo (excluye el año en
# curso, que llega parcial); umbral n>=30 para no mostrar medianas con muestra chica.
class MercadoReal(BaseModel):
    anio_dato: Optional[int] = None
    n_transacciones_anual: Optional[int] = None
    valor_mediana_anual: Optional[int] = None
    var_anual_pct: Optional[float] = None          # nominal, año vs año anterior
    ipvn_dane_pct: Optional[float] = None           # referencia externa (no aplicado como deflactor, solo contexto)
    meses_inventario: Optional[float] = None
    clasificacion_mercado: Optional[str] = None     # "comprador" | "balanceado" | "vendedor"
    ratio_cierre_pedido_pct: Optional[float] = None  # valor cerrado / mediana pedido activo — sin controlar mezcla tipo/tamaño


class BarrioResponse(BaseModel):
    barrio_id: int
    nombre: Optional[str] = None
    comuna: Optional[str] = None
    municipio: Optional[str] = None
    estrato: Optional[int] = None
    geometry: Optional[dict[str, Any]] = None
    color_hex: Optional[str] = None
    excluir_inversion: Optional[bool] = None
    uso_suelo_dominante: Optional[str] = None
    uso_suelo_score: Optional[int] = None
    scores: Scores
    mercado: Mercado
    airbnb: Airbnb
    seguridad: Seguridad
    conectividad: Conectividad
    verde: Verde
    trafico: Optional[Trafico] = None
    liquidez: Liquidez
    oportunidad: Oportunidad
    valorizacion: Valorizacion
    nomada_breakdown: Optional[NomadaBreakdown] = None
    n_remates_municipio: Optional[int] = None
    catastro_comuna: Optional[CatastroComuna] = None
    mercado_real: Optional[MercadoReal] = None
    amenidades: Optional[Amenidades] = None




# ── SQL ───────────────────────────────────────────────────────────────────────

_BARRIO_MAP_SQL = """
    SELECT
        b.id                                AS barrio_id,
        b.nombre,
        b.comuna,
        b.municipio,
        sl.estrato_barrio                   AS estrato,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(b.geometry, 0.0003)) AS geometry_raw,
        sc.score_corto,
        sc.categoria_corto                  AS cat_corto,
        sc.score_mediano,
        sc.categoria_mediano                AS cat_mediano,
        sc.score_largo,
        sc.categoria_largo                  AS cat_largo,
        sc.perfil_recomendado,
        bm.precio_venta_m2_p50              AS precio_m2_cop,
        bm.precio_arriendo_p50              AS arriendo_p50_cop,
        bm.yield_bruto                      AS yield_bruto_pct,
        bm.ratio_precio_arriendo            AS anos_recupero,
        bm.estado_precio,
        bm.pbn_precio_justo_m2              AS pbn_precio_justo,
        bm.poi_precio_oferta,
        b.excluir_inversion,
        b.uso_suelo_dominante,
        b.uso_suelo_score,
        op.oportunidad_detectada,
        op.tipo_oportunidad,
        op.descripcion_oportunidad,
        lq.liquidez_score,
        lq.categoria_liquidez,
        lq.tiempo_estimado_venta,
        poi.dist_metro_km,
        poi.dist_parque_km,
        poi.dist_mall_km,
        poi.n_cafes_500m,
        poi.n_coworking_1km,
        poi.n_gimnasios_1km,
        poi.n_yoga_1km,
        poi.indice_nomada,
        poi.n_colegios_1km,
        poi.dist_colegio_km,
        poi.n_parques_inf_500m,
        poi.n_canchas_1km,
        poi.dist_encicla_km,
        poi.n_policia_1km,
        poi.dist_policia_km,
        poi.n_bomberos_2km,
        poi.avg_internet_mbps,
        poi.n_tests_internet,
        poi.score_icfes_municipio,
        poi.dist_obra_publica_km,
        poi.nombre_obra_cercana,
        poi.db_ruido_dia_cercano,
        poi.dist_ruido_km,
        poi.walk_score,
        poi.transit_score
    FROM raw.barrios b
    LEFT JOIN analytics.barrios_score_consolidado sc  ON b.id = sc.barrio_id
    LEFT JOIN analytics.barrios_mercado           bm  ON b.id = bm.barrio_id
    LEFT JOIN analytics.barrios_pois_distancia    poi ON b.id = poi.barrio_id
    LEFT JOIN analytics.barrios_liquidez          lq  ON b.id = lq.barrio_id
    LEFT JOIN analytics.barrios_oportunidades     op  ON b.id = op.barrio_id
    LEFT JOIN analytics.score_largo_plazo         sl  ON b.id = sl.barrio_id
"""

_BARRIO_SQL = """
    SELECT
        b.id                                AS barrio_id,
        b.nombre,
        b.comuna,
        b.municipio,
        sl.estrato_barrio                   AS estrato,
        ST_AsGeoJSON(b.geometry)            AS geometry_raw,
        -- scores
        sc.score_corto,
        sc.categoria_corto                  AS cat_corto,
        sc.score_mediano,
        sc.categoria_mediano                AS cat_mediano,
        sc.score_largo,
        sc.categoria_largo                  AS cat_largo,
        sc.perfil_recomendado,
        -- mercado
        bm.precio_venta_m2_p50              AS precio_m2_cop,
        bm.precio_venta_promedio,
        bm.precio_arriendo_p50              AS arriendo_p50_cop,
        bm.yield_bruto                      AS yield_bruto_pct,
        bm.ratio_precio_arriendo            AS anos_recupero,
        bm.estado_precio,
        bm.pbn_precio_justo_m2              AS pbn_precio_justo,
        bm.poi_precio_oferta,
        -- airbnb
        bm.ocupacion_airbnb_pct,
        bm.adr_noche_cop,
        bm.airbnb_n_listings                AS n_listings_airbnb,
        bm.yield_airbnb_pct,
        -- seguridad
        seg.score_seguridad_residente       AS score_seguridad,
        seg.categoria_seguridad,
        bm.zona_turistica,
        seg.tendencia                       AS tendencia_seguridad,
        seg.nota_seguridad,
        -- conectividad / pois
        poi.dist_metro_km,
        poi.dist_parque_km,
        poi.dist_mall_km,
        poi.n_cafes_500m,
        poi.n_coworking_1km,
        poi.n_gimnasios_1km,
        poi.n_yoga_1km,
        poi.indice_nomada,
        poi.n_colegios_1km,
        poi.dist_colegio_km,
        poi.n_parques_inf_500m,
        poi.n_canchas_1km,
        poi.dist_encicla_km,
        poi.n_policia_1km,
        poi.dist_policia_km,
        poi.n_bomberos_2km,
        poi.avg_internet_mbps,
        poi.n_tests_internet,
        poi.score_icfes_municipio,
        poi.dist_obra_publica_km,
        poi.nombre_obra_cercana,
        poi.db_ruido_dia_cercano,
        poi.dist_ruido_km,
        poi.walk_score,
        poi.transit_score,
        -- verde
        vd.indice_verde_pct,
        vd.categoria_verde,
        vd.score_verde,
        -- trafico (HERE Flow, campaña estática — NULL si el barrio no fue muestreado)
        tp.nivel_trafico,
        tp.jam_prom,
        tp.pico_am_inicio,
        tp.pico_am_fin,
        tp.pico_pm_inicio,
        tp.pico_pm_fin,
        -- liquidez
        lq.liquidez_score,
        lq.categoria_liquidez,
        lq.tiempo_estimado_venta,
        lq.nota_metodologia,
        -- zona
        b.excluir_inversion,
        b.uso_suelo_dominante,
        b.uso_suelo_score,
        -- oportunidad
        op.oportunidad_detectada,
        op.tipo_oportunidad,
        op.descripcion_oportunidad,
        -- valorizacion
        sl.var_anual_5anos_pct              AS var_anual_pct,
        pv.proyeccion_3anos_pct,
        pv.proyeccion_5anos_pct,
        sl.tendencia_valorizacion,
        -- renta media (nómadas)
        bm.yield_renta_media_pct,
        bm.precio_renta_media_p50,
        bm.premium_vs_largo_pct,
        bm.n_listings_renta_media,
        -- nomada score breakdown
        sm.yield_medio_score                AS pts_yield_nomada,
        sm.nomada_score                     AS pts_nomada,
        sm.pbn_score                        AS pts_pbn_nomada,
        sm.seg_medio_score                  AS pts_seg_nomada,
        sm.pts_verde                        AS pts_verde_nomada,
        sm.pts_equip                        AS pts_equip_nomada,
        -- airbnb real (solo Medellín; NULL para otros municipios)
        ab.n_entire_home,
        ab.n_private_room,
        ab.n_superhosts,
        ab.ocupacion_p25_pct,
        ab.ocupacion_p75_pct,
        ab.ingresos_anuales_p50_usd,
        ab.ingresos_anuales_p50_cop,
        ab.yield_airbnb_real_pct,
        ab.rating_promedio,
        ab.reviews_promedio,
        ab.diff_ocupacion_pct,
        ab.diff_adr_cop,
        -- amenidades (solo Medellín; NULL para otros municipios)
        am.pct_wifi,
        am.pct_ac,
        am.pct_kitchen,
        am.pct_washer,
        am.score_equipamiento,
        am.n_listings                       AS am_n_listings,
        -- catastro comunal (solo Medellín; NULL para otros municipios)
        cat.total_predios                   AS cat_total_predios,
        cat.pct_apartamento                 AS cat_pct_apartamento,
        cat.area_mediana_apto_m2            AS cat_area_mediana_m2,
        cat.avaluo_m2                       AS cat_avaluo_m2,
        -- mercado real (compraventas SNR/ORIPS) a nivel municipio
        mr.anio_dato,
        mr.n_transacciones_anual,
        mr.valor_mediana_anual,
        mr.var_anual_pct                    AS mr_var_anual_pct,
        mr.ipvn_dane_pct,
        mr.meses_inventario,
        mr.clasificacion_mercado,
        mr.ratio_cierre_pedido_pct
    FROM raw.barrios b
    LEFT JOIN analytics.barrios_score_consolidado sc  ON b.id = sc.barrio_id
    LEFT JOIN analytics.barrios_mercado           bm  ON b.id = bm.barrio_id
    LEFT JOIN analytics.barrios_seguridad         seg ON b.id = seg.barrio_id
    LEFT JOIN analytics.barrios_pois_distancia    poi ON b.id = poi.barrio_id
    LEFT JOIN analytics.barrios_verde             vd  ON b.id = vd.barrio_id
    LEFT JOIN analytics.barrios_trafico_perfil    tp  ON b.id = tp.barrio_id
    LEFT JOIN analytics.barrios_liquidez          lq  ON b.id = lq.barrio_id
    LEFT JOIN analytics.barrios_oportunidades     op  ON b.id = op.barrio_id
    -- estrato_barrio (score_largo_plazo): mode estrato of listings in barrio — used for filters + projections join
    -- estrato_sistema (proyecciones_valorizacion): same 1-6 scale, different name — always equal to estrato_barrio
    -- estrato_real (raw.listings_*): per-listing estrato from scraper — used only in listings display
    LEFT JOIN analytics.score_largo_plazo         sl  ON b.id = sl.barrio_id
    LEFT JOIN analytics.proyecciones_valorizacion pv  ON sl.estrato_barrio = pv.estrato_sistema
    LEFT JOIN analytics.score_mediano_plazo       sm  ON b.id = sm.barrio_id
    LEFT JOIN analytics.barrios_airbnb_real       ab  ON b.id = ab.barrio_id
    LEFT JOIN analytics.barrios_amenities         am  ON b.id = am.barrio_id
    LEFT JOIN analytics.catastro_comunas_stats cat
           ON UPPER(TRIM(b.comuna)) = cat.comuna
    LEFT JOIN LATERAL (
        WITH ultimo AS (
            SELECT anio, n_transacciones, valor_mediana
            FROM analytics.compraventas_municipio_stats cs
            WHERE cs.municipio = UPPER(b.municipio)
              AND cs.anio IS NOT NULL
              AND cs.anio < EXTRACT(YEAR FROM CURRENT_DATE)::int
              AND cs.n_transacciones >= 30
            ORDER BY cs.anio DESC
            LIMIT 1
        ),
        previo AS (
            SELECT cs2.valor_mediana
            FROM analytics.compraventas_municipio_stats cs2, ultimo u
            WHERE cs2.municipio = UPPER(b.municipio)
              AND cs2.anio = u.anio - 1
              AND cs2.n_transacciones >= 30
        ),
        dane AS (
            SELECT ipv.variacion_anual_pct
            FROM raw.indices_precio_vivienda ipv, ultimo u
            WHERE ipv.fuente = 'dane' AND ipv.anio = u.anio
            ORDER BY ipv.trimestre DESC
            LIMIT 1
        ),
        inventario AS (
            SELECT COUNT(*)::float AS n_activo
            FROM staging.stg_listings_unificado sl2
            JOIN raw.barrios b2 ON b2.id = sl2.barrio_id
            WHERE UPPER(b2.municipio) = UPPER(b.municipio)
              AND sl2.tipo_operacion = 'venta'
        ),
        pedido AS (
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sl3.precio_cop) AS asking_mediana
            FROM staging.stg_listings_unificado sl3
            JOIN raw.barrios b3 ON b3.id = sl3.barrio_id
            WHERE UPPER(b3.municipio) = UPPER(b.municipio)
              AND sl3.tipo_operacion = 'venta' AND sl3.precio_cop > 0
        )
        SELECT
            u.anio                                                       AS anio_dato,
            u.n_transacciones                                            AS n_transacciones_anual,
            u.valor_mediana                                              AS valor_mediana_anual,
            CASE WHEN p.valor_mediana > 0
                 THEN ROUND(((u.valor_mediana - p.valor_mediana)::numeric / p.valor_mediana) * 100, 1)
            END                                                          AS var_anual_pct,
            d.variacion_anual_pct                                        AS ipvn_dane_pct,
            CASE WHEN u.n_transacciones > 0
                 THEN ROUND((i.n_activo / (u.n_transacciones / 12.0))::numeric, 1)
            END                                                          AS meses_inventario,
            CASE
                WHEN u.n_transacciones = 0 OR i.n_activo IS NULL THEN NULL
                WHEN (i.n_activo / (u.n_transacciones / 12.0)) < 3 THEN 'vendedor'
                WHEN (i.n_activo / (u.n_transacciones / 12.0)) <= 6 THEN 'balanceado'
                ELSE 'comprador'
            END                                                          AS clasificacion_mercado,
            CASE WHEN pe.asking_mediana > 0
                 THEN ROUND(((u.valor_mediana::numeric / pe.asking_mediana::numeric) * 100)::numeric, 1)
            END                                                          AS ratio_cierre_pedido_pct
        FROM ultimo u
        LEFT JOIN previo p ON TRUE
        LEFT JOIN dane d ON TRUE
        LEFT JOIN inventario i ON TRUE
        LEFT JOIN pedido pe ON TRUE
    ) mr ON TRUE
"""


# ── List-path variant: sin el LATERAL de mercado_real ────────────────────────
# El choropleth (~600 barrios, en cada carga del mapa vía useBarrios) NO consume
# mercado_real — solo el drawer lo pinta, vía get_barrio(id). El LATERAL real
# recomputa la mediana de compraventas del municipio por CADA barrio (N+1 dentro
# del SQL), así que en la lista se reemplaza por un stub NULL (mercado_real → None).
_MR_STUB = (
    "    LEFT JOIN LATERAL (\n"
    "        SELECT NULL::int AS anio_dato, NULL::bigint AS n_transacciones_anual,\n"
    "               NULL::bigint AS valor_mediana_anual, NULL::numeric AS var_anual_pct,\n"
    "               NULL::numeric AS ipvn_dane_pct, NULL::numeric AS meses_inventario,\n"
    "               NULL::text AS clasificacion_mercado, NULL::numeric AS ratio_cierre_pedido_pct\n"
    "    ) mr ON TRUE"
)
_lat_start = _BARRIO_SQL.index("    LEFT JOIN LATERAL (")
_lat_end = _BARRIO_SQL.index(") mr ON TRUE", _lat_start) + len(") mr ON TRUE")
_BARRIO_LIST_SQL = _BARRIO_SQL[:_lat_start] + _MR_STUB + _BARRIO_SQL[_lat_end:]
assert "compraventas_municipio_stats" not in _BARRIO_LIST_SQL, \
    "barrios: el LATERAL de mercado_real no se stubbeó (¿cambió _BARRIO_SQL?)"


def _f(row: dict, key: str) -> Optional[float]:
    v = row.get(key)
    return float(v) if v is not None else None


def _i(row: dict, key: str) -> Optional[int]:
    v = row.get(key)
    return int(v) if v is not None else None


def _build_response(row: dict, score_col: str = "score_corto", perfil: Optional[str] = None, perfil_dict: Optional[dict] = None, use_max_score: bool = False) -> BarrioResponse:
    raw_geo = row.get("geometry_raw")
    geometry = json.loads(raw_geo) if raw_geo else None

    precio_m2_cop = _f(row, "precio_m2_cop")
    adr_cop = _f(row, "adr_noche_cop")

    precio_accesible: Optional[bool] = None
    presupuesto_max_val: Optional[int] = None
    if perfil_dict and perfil_dict.get("presupuesto"):
        pmax = PRESUPUESTO_MAX.get(perfil_dict["presupuesto"])
        if pmax:
            presupuesto_max_val = pmax if pmax < 9_999_999_999 else None
            precio_accesible = (precio_m2_cop or 0) * 40 <= pmax

    score_map = {
        "score_corto": _i(row, "score_corto"),
        "score_mediano": _i(row, "score_mediano"),
        "score_largo": _i(row, "score_largo"),
    }
    # FIX 1: when no perfil is active, show each barrio's best potential score
    # instead of always defaulting to score_corto (Airbnb).
    if use_max_score:
        available = [s for s in score_map.values() if s is not None]
        score_activo = max(available) if available else None
    else:
        score_activo = score_map.get(score_col)
    excluir = bool(row.get("excluir_inversion"))
    color_hex = "#6b7280" if excluir else _score_to_hex(score_activo, perfil)

    return BarrioResponse(
        barrio_id=row["barrio_id"],
        nombre=row.get("nombre"),
        comuna=row.get("comuna"),
        municipio=row.get("municipio"),
        estrato=row.get("estrato"),
        geometry=geometry,
        color_hex=color_hex,
        excluir_inversion=excluir,
        uso_suelo_dominante=row.get("uso_suelo_dominante"),
        uso_suelo_score=row.get("uso_suelo_score"),
        scores=Scores(
            corto=_i(row, "score_corto"),
            cat_corto=row.get("cat_corto"),
            mediano=_i(row, "score_mediano"),
            cat_mediano=row.get("cat_mediano"),
            largo=_i(row, "score_largo"),
            cat_largo=row.get("cat_largo"),
            perfil_recomendado=row.get("perfil_recomendado"),
            score_activo=score_activo,
        ),
        mercado=Mercado(
            precio_m2_cop=int(precio_m2_cop) if precio_m2_cop else None,
            precio_m2_usd=int(precio_m2_cop / _USD) if precio_m2_cop else None,
            precio_venta_promedio=_i(row, "precio_venta_promedio"),
            arriendo_p50_cop=_i(row, "arriendo_p50_cop"),
            yield_bruto_pct=_f(row, "yield_bruto_pct"),
            anos_recupero=_f(row, "anos_recupero"),
            estado_precio=row.get("estado_precio"),
            pbn_precio_justo=_i(row, "pbn_precio_justo"),
            poi_precio_oferta=_i(row, "poi_precio_oferta"),
            yield_renta_media_pct=_f(row, "yield_renta_media_pct"),
            precio_renta_media_p50=_i(row, "precio_renta_media_p50"),
            premium_vs_largo_pct=_f(row, "premium_vs_largo_pct"),
            n_listings_renta_media=_i(row, "n_listings_renta_media"),
            precio_accesible=precio_accesible,
            presupuesto_max=presupuesto_max_val,
        ),
        airbnb=Airbnb(
            ocupacion_pct=_f(row, "ocupacion_airbnb_pct"),
            ocupacion_p25_pct=_f(row, "ocupacion_p25_pct"),
            ocupacion_p75_pct=_f(row, "ocupacion_p75_pct"),
            adr_usd=round(adr_cop / _USD, 2) if adr_cop else None,
            adr_cop=int(adr_cop) if adr_cop else None,
            yield_airbnb_pct=_f(row, "yield_airbnb_pct"),
            yield_airbnb_real_pct=_f(row, "yield_airbnb_real_pct"),
            n_listings=_i(row, "n_listings_airbnb"),
            n_entire_home=_i(row, "n_entire_home"),
            n_private_room=_i(row, "n_private_room"),
            n_superhosts=_i(row, "n_superhosts"),
            ingresos_anuales_p50_usd=_f(row, "ingresos_anuales_p50_usd"),
            ingresos_anuales_p50_cop=_i(row, "ingresos_anuales_p50_cop"),
            rating_promedio=_f(row, "rating_promedio"),
            reviews_promedio=_f(row, "reviews_promedio"),
            diff_ocupacion_pct=_f(row, "diff_ocupacion_pct"),
            diff_adr_cop=_f(row, "diff_adr_cop"),
        ),
        seguridad=Seguridad(
            score=_i(row, "score_seguridad"),
            categoria=row.get("categoria_seguridad"),
            zona_turistica=row.get("zona_turistica"),
            tendencia=row.get("tendencia_seguridad"),
            nota=row.get("nota_seguridad"),
        ),
        conectividad=Conectividad(
            dist_metro_km=_f(row, "dist_metro_km"),
            dist_parque_km=_f(row, "dist_parque_km"),
            dist_mall_km=_f(row, "dist_mall_km"),
            n_cafes_500m=_i(row, "n_cafes_500m"),
            n_coworking_1km=_i(row, "n_coworking_1km"),
            n_gimnasios_1km=_i(row, "n_gimnasios_1km"),
            n_yoga_1km=_i(row, "n_yoga_1km"),
            indice_nomada=_f(row, "indice_nomada"),
            n_colegios_1km=_i(row, "n_colegios_1km"),
            dist_colegio_km=_f(row, "dist_colegio_km"),
            n_parques_inf_500m=_i(row, "n_parques_inf_500m"),
            n_canchas_1km=_i(row, "n_canchas_1km"),
            dist_encicla_km=_f(row, "dist_encicla_km"),
            n_policia_1km=_i(row, "n_policia_1km"),
            dist_policia_km=_f(row, "dist_policia_km"),
            n_bomberos_2km=_i(row, "n_bomberos_2km"),
            avg_internet_mbps=_f(row, "avg_internet_mbps"),
            n_tests_internet=_i(row, "n_tests_internet"),
            score_icfes_municipio=_f(row, "score_icfes_municipio"),
            dist_obra_publica_km=_f(row, "dist_obra_publica_km"),
            nombre_obra_cercana=row.get("nombre_obra_cercana"),
            db_ruido_dia_cercano=_f(row, "db_ruido_dia_cercano"),
            dist_ruido_km=_f(row, "dist_ruido_km"),
            walk_score=_i(row, "walk_score"),
            transit_score=_i(row, "transit_score"),
        ),
        verde=Verde(
            indice_verde_pct=_f(row, "indice_verde_pct"),
            categoria=row.get("categoria_verde"),
            score_verde=_i(row, "score_verde"),
        ),
        trafico=_build_trafico(row),
        liquidez=Liquidez(
            score=_i(row, "liquidez_score"),
            categoria=row.get("categoria_liquidez"),
            tiempo_estimado_venta=row.get("tiempo_estimado_venta"),
            nota_metodologia=row.get("nota_metodologia"),
        ),
        oportunidad=Oportunidad(
            detectada=row.get("oportunidad_detectada"),
            tipo=row.get("tipo_oportunidad"),
            descripcion=row.get("descripcion_oportunidad"),
        ),
        valorizacion=Valorizacion(
            var_anual_pct=_f(row, "var_anual_pct"),
            proyeccion_3anos_pct=_f(row, "proyeccion_3anos_pct"),
            proyeccion_5anos_pct=_f(row, "proyeccion_5anos_pct"),
            tendencia=row.get("tendencia_valorizacion"),
        ),
        nomada_breakdown=NomadaBreakdown(
            pts_yield=_i(row, "pts_yield_nomada"),
            pts_nomada=_i(row, "pts_nomada"),
            pts_pbn=_i(row, "pts_pbn_nomada"),
            pts_seguridad=_i(row, "pts_seg_nomada"),
            pts_verde=_i(row, "pts_verde_nomada"),
            pts_equip=_i(row, "pts_equip_nomada"),
        ) if row.get("pts_yield_nomada") is not None else None,
        n_remates_municipio=_i(row, "n_remates_municipio"),
        catastro_comuna=_build_catastro(row, precio_m2_cop),
        mercado_real=_build_mercado_real(row),
        amenidades=_build_amenidades(row),
    )


def _build_mercado_real(row: dict) -> Optional[MercadoReal]:
    if row.get("anio_dato") is None:
        return None
    return MercadoReal(
        anio_dato=_i(row, "anio_dato"),
        n_transacciones_anual=_i(row, "n_transacciones_anual"),
        valor_mediana_anual=_i(row, "valor_mediana_anual"),
        var_anual_pct=_f(row, "mr_var_anual_pct"),
        ipvn_dane_pct=_f(row, "ipvn_dane_pct"),
        meses_inventario=_f(row, "meses_inventario"),
        clasificacion_mercado=row.get("clasificacion_mercado"),
        ratio_cierre_pedido_pct=_f(row, "ratio_cierre_pedido_pct"),
    )


def _build_catastro(row: dict, precio_m2_cop: Optional[float]) -> Optional[CatastroComuna]:
    total = _i(row, "cat_total_predios")
    if total is None:
        return None
    avaluo = _i(row, "cat_avaluo_m2")
    ratio = (
        round(float(precio_m2_cop) / avaluo, 1)
        if avaluo and avaluo > 0 and precio_m2_cop
        else None
    )
    ratio_vs_ciudad = (
        round(ratio / _CIUDAD_RATIO_MEDIANA, 2)
        if ratio is not None
        else None
    )
    return CatastroComuna(
        total_predios=total,
        pct_apartamento=_f(row, "cat_pct_apartamento"),
        area_mediana_apto_m2=_i(row, "cat_area_mediana_m2"),
        avaluo_m2=avaluo,
        ratio_mercado_catastro=ratio,
        ratio_vs_ciudad=ratio_vs_ciudad,
    )


def _build_trafico(row: dict) -> Optional[Trafico]:
    nivel = row.get("nivel_trafico")
    if nivel is None:
        return None
    return Trafico(
        nivel=nivel,
        jam_prom=_f(row, "jam_prom"),
        pico_am_inicio=_i(row, "pico_am_inicio"),
        pico_am_fin=_i(row, "pico_am_fin"),
        pico_pm_inicio=_i(row, "pico_pm_inicio"),
        pico_pm_fin=_i(row, "pico_pm_fin"),
    )


def _build_amenidades(row: dict) -> Optional[Amenidades]:
    score = _i(row, "score_equipamiento")
    n = _i(row, "am_n_listings")
    if score is None and n is None:
        return None
    return Amenidades(
        pct_wifi=_f(row, "pct_wifi"),
        pct_ac=_f(row, "pct_ac"),
        pct_kitchen=_f(row, "pct_kitchen"),
        pct_washer=_f(row, "pct_washer"),
        score_equipamiento=score,
        n_listings_base=n,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[BarrioResponse])
async def list_barrios(
    response: Response,
    perfil: Optional[str] = Query(default=None, description="airbnb | mediano_plazo | largo_plazo"),
    score_min: int = Query(default=0, ge=0, le=100),
    municipio: Optional[str] = Query(default=None),
    estrato: Optional[int] = Query(default=None),
    fields: str = Query(default="full", description="map | full"),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    pool = get_pool()

    effective_perfil = perfil
    perfil_full: Optional[dict] = None
    if not effective_perfil and current_user:
        prow = await pool.fetchrow(
            """SELECT objetivo, perfil_riesgo, presupuesto, n_unidades, tipo_gestion,
                      target_inquilino, amoblado, tipo_pago, horizonte_inversion
               FROM perfil_inversor WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1""",
            current_user["id"],
        )
        if prow and prow["objetivo"]:
            effective_perfil = prow["objetivo"]
            perfil_full = dict(prow)
    elif current_user and effective_perfil:
        prow = await pool.fetchrow(
            """SELECT objetivo, perfil_riesgo, presupuesto, n_unidades, tipo_gestion,
                      target_inquilino, amoblado, tipo_pago, horizonte_inversion
               FROM perfil_inversor WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1""",
            current_user["id"],
        )
        if prow:
            perfil_full = dict(prow)

    score_col = get_score_col(effective_perfil)
    base_sql = _BARRIO_MAP_SQL if fields == "map" else _BARRIO_LIST_SQL

    sql = base_sql + f"""
        WHERE ($1::text IS NULL OR upper(b.municipio) = upper($1))
          AND ($2::int  IS NULL OR sl.estrato_barrio = $2)
          AND (sc.{score_col} IS NULL OR sc.{score_col} >= $3)
        ORDER BY sc.{score_col} DESC NULLS LAST
    """
    rows = await pool.fetch(sql, municipio, estrato, score_min)
    use_max = not effective_perfil
    # Browser cache: polygons/scores change hourly at most. `private` when the
    # response is personalized (logged-in user's perfil), `public` otherwise so
    # the shared CDN/proxy can serve anonymous map loads.
    response.headers["Cache-Control"] = "private, max-age=120" if current_user else "public, max-age=300"
    return [_build_response(dict(r), score_col, effective_perfil, perfil_full, use_max_score=use_max) for r in rows]


# ── Lightweight selector endpoints ───────────────────────────────────────────

class ComunaItem(BaseModel):
    key: str
    label: str
    municipio: str
    n_barrios: int


class BarrioComunaItem(BaseModel):
    id: int
    nombre: str
    municipio: str
    comuna: Optional[str] = None
    yield_bruto_pct: Optional[float] = None
    precio_m2_cop: Optional[int] = None


@router.get("/comunas", response_model=list[ComunaItem])
async def list_comunas():
    pool = get_pool()
    rows = await pool.fetch("""
        SELECT
            COALESCE(b.comuna, b.municipio) AS key,
            COALESCE(b.comuna, b.municipio) AS label,
            b.municipio,
            COUNT(*)::int AS n_barrios
        FROM raw.barrios b
        WHERE b.excluir_inversion = FALSE
        GROUP BY b.comuna, b.municipio
        ORDER BY b.municipio, label
    """)
    return [ComunaItem(**dict(r)) for r in rows]


@router.get("/por-comuna/{key}", response_model=list[BarrioComunaItem])
async def list_barrios_por_comuna(key: str):
    pool = get_pool()
    rows = await pool.fetch("""
        SELECT
            b.id,
            b.nombre,
            b.municipio,
            b.comuna,
            bm.yield_bruto         AS yield_bruto_pct,
            bm.precio_venta_m2_p50 AS precio_m2_cop
        FROM raw.barrios b
        LEFT JOIN analytics.barrios_mercado bm ON b.id = bm.barrio_id
        WHERE (b.comuna = $1 OR b.municipio = $1)
          AND b.excluir_inversion = FALSE
        ORDER BY b.nombre
    """, key)
    return [BarrioComunaItem(**dict(r)) for r in rows]


class BarrioInfo(BaseModel):
    id: int
    nombre: str
    municipio: str
    comuna: Optional[str] = None


@router.get("/{barrio_id}/info", response_model=BarrioInfo)
async def get_barrio_info(barrio_id: int):
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT id, nombre, municipio, comuna FROM raw.barrios WHERE id = $1",
        barrio_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Barrio {barrio_id} no encontrado")
    return BarrioInfo(**dict(row))


@router.get("/comparar", response_model=list[BarrioResponse])
async def comparar_barrios(
    ids: str = Query(description="IDs separados por coma: 1,2,3 (máx 3)"),
    perfil: Optional[str] = Query(default=None, description="airbnb | mediano_plazo | largo_plazo"),
):
    id_list = [int(x.strip()) for x in ids.split(",") if x.strip().isdigit()][:3]
    if not id_list:
        raise HTTPException(status_code=400, detail="Parámetro ids inválido")

    score_col = get_score_col(perfil)
    pool = get_pool()
    sql = _BARRIO_SQL + " WHERE b.id = ANY($1::int[])"
    rows = await pool.fetch(sql, id_list)
    return [_build_response(dict(r), score_col, perfil) for r in rows]


@router.get("/{barrio_id}", response_model=BarrioResponse)
async def get_barrio(
    barrio_id: int,
    perfil: Optional[str] = Query(default=None, description="airbnb | mediano_plazo | largo_plazo"),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    score_col = get_score_col(perfil)
    pool = get_pool()
    sql = _BARRIO_SQL + " WHERE b.id = $1"
    try:
        row = await pool.fetchrow(sql, barrio_id, timeout=15.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Datos temporalmente no disponibles")
    if row is None:
        raise HTTPException(status_code=404, detail=f"Barrio {barrio_id} no encontrado")
    return _build_response(dict(row), score_col, perfil)


_BARRIO_COUNT_SQL = """
SELECT COUNT(*) FROM staging.stg_listings_unificado l
JOIN analytics.listings_georef g ON g.url = l.url
WHERE l.barrio_id = $1
  AND l.precio_cop >= 500000
  AND NOT (l.tipo_operacion = 'arriendo' AND l.precio_cop > 50000000)
  AND NOT (l.tipo_operacion = 'venta'    AND l.precio_cop > 50000000000)
  AND ($2::text   IS NULL OR l.tipo_operacion = $2)
  AND ($3::bigint IS NULL OR l.precio_cop >= $3)
  AND ($4::bigint IS NULL OR l.precio_cop <= $4)
  AND ($5::float8 IS NULL OR l.area_m2 >= $5)
  AND ($6::int    IS NULL OR l.habitaciones = $6)
"""

_BARRIO_LISTINGS_SQL = """
WITH med AS (
    SELECT precio_venta_m2_p50 AS m2_mediana,
           precio_arriendo_p50 AS arr_mediana
    FROM analytics.barrios_mercado
    WHERE barrio_id = $1
),
lraw AS (
    SELECT ('x'||substr(md5(url),1,8))::bit(32)::int AS id,
           listing_uid,
           fuente, tier, tipo_operacion, tipo_inmueble,
           precio_cop                                  AS precio,
           area_m2, habitaciones, banos,
           direccion_raw, barrio_raw, barrio_id, url, fecha_scraping,
           NULL::int  AS dias_en_mercado,
           NULL::date AS fecha_publicacion,
           CASE
               WHEN precio_m2 > 0 AND precio_m2 < 2147483647 THEN precio_m2::int
               WHEN area_m2 > 0 THEN ROUND(precio_cop::float8 / area_m2)::int
               ELSE NULL
           END AS pm2
    FROM staging.stg_listings_unificado
    WHERE precio_cop >= 500000 AND barrio_id = $1
      AND NOT (tipo_operacion = 'arriendo' AND precio_cop > 50000000)
      AND NOT (tipo_operacion = 'venta'    AND precio_cop > 50000000000)
)
SELECT
    l.id,
    l.listing_uid,
    l.fuente,
    l.tier,
    l.tipo_operacion,
    l.tipo_inmueble,
    l.precio::bigint              AS precio_cop,
    (l.precio / {usd})::bigint    AS precio_usd,
    l.area_m2::float8,
    l.pm2                         AS precio_m2,
    l.habitaciones,
    l.banos::float8,
    l.direccion_raw,
    l.url,
    g.lat,
    g.lon,
    l.barrio_id,
    b.nombre                      AS barrio_nombre,
    b.municipio                   AS municipio,
    NULL::int                     AS cd_comuna,
    CASE
        WHEN l.tipo_operacion = 'venta'
             AND l.pm2 IS NOT NULL AND l.pm2 > 0
             AND med.m2_mediana > 0
             AND (med.m2_mediana - l.pm2)::float8 / med.m2_mediana > 0.10
        THEN TRUE
        WHEN l.tipo_operacion = 'arriendo'
             AND l.precio > 0
             AND med.arr_mediana > 0
             AND (med.arr_mediana - l.precio)::float8 / med.arr_mediana > 0.10
        THEN TRUE
        ELSE FALSE
    END AS buena_oferta,
    CASE
        WHEN l.tipo_operacion = 'venta'
             AND l.pm2 IS NOT NULL AND l.pm2 > 0
             AND med.m2_mediana > 0
        THEN round(((med.m2_mediana - l.pm2)::float8 / med.m2_mediana * 100)::numeric, 1)::float8
        WHEN l.tipo_operacion = 'arriendo'
             AND l.precio > 0 AND med.arr_mediana > 0
        THEN round(((med.arr_mediana - l.precio)::float8 / med.arr_mediana * 100)::numeric, 1)::float8
        ELSE NULL
    END AS pct_bajo_mediana,
    med.m2_mediana::int           AS precio_m2_mediana_barrio,
    g.url_activa                  AS disponible_actualmente,
    g.estrato_real,
    l.dias_en_mercado,
    l.fecha_publicacion::text     AS fecha_publicacion,
    NULL::timestamp               AS fecha_ultima_verificacion,
    NULL::float8                  AS relevancia_score,
    NULL::text                    AS match_label,
    NULL::text[]                  AS match_razones
FROM lraw l
CROSS JOIN med
JOIN raw.barrios b                ON b.id = l.barrio_id
JOIN analytics.listings_georef g  ON g.url = l.url
WHERE ($2::text   IS NULL OR l.tipo_operacion = $2)
  AND ($3::bigint IS NULL OR l.precio >= $3)
  AND ($4::bigint IS NULL OR l.precio <= $4)
  AND ($5::float8 IS NULL OR l.area_m2 >= $5)
  AND ($6::int    IS NULL OR l.habitaciones = $6)
ORDER BY
    CASE WHEN l.fuente = 'medellinliving' THEN 0 ELSE 1 END,
    l.pm2 ASC NULLS LAST
""".format(usd=int(USD_TO_COP))


@router.get("/{barrio_id}/listings", response_model=ListingsAllResponse)
async def get_barrio_listings(
    barrio_id: int,
    tipo_operacion: Optional[str] = Query(default=None),
    precio_min: Optional[int] = Query(default=None),
    precio_max: Optional[int] = Query(default=None),
    area_min: Optional[float] = Query(default=None),
    habitaciones: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    pool = get_pool()
    args = (barrio_id, tipo_operacion, precio_min, precio_max, area_min, habitaciones)

    total = await pool.fetchval(_BARRIO_COUNT_SQL, *args)
    rows = await pool.fetch(
        _BARRIO_LISTINGS_SQL + f" LIMIT {limit} OFFSET {offset}",
        *args,
    )

    _agente = is_agente(current_user)
    items: list[ListingFull] = []
    for r in rows:
        d = dict(r)
        if not _agente:
            d["buena_oferta"] = None
            d["pct_bajo_mediana"] = None
        items.append(ListingFull(**d))

    return ListingsAllResponse(total=total or 0, listings=items)
