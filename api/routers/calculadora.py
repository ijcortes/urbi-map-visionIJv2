from __future__ import annotations

import json
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from api.limiter import limiter
from pydantic import BaseModel, Field

from api import parametros
from api.db import get_pool
from api.dependencies import get_optional_user, get_current_user

router = APIRouter()

# Opex como % del ingreso bruto anual (no del valor del inmueble — evita absurdos de escala).
# Incluye todo: predial proporcional, admin edificio, seguros, mantenimiento, vacancia.
_OPEX: dict[str, float] = {
    "airbnb":      0.38,  # comisión plataforma 3% + limpieza 5% + vacancia estacional 20% + suministros 10%
    "renta_media": 0.22,  # vacancia baja + admin parcial + predial + seguros + mant. variable
    "renta_larga": 0.28,  # admin edificio ~12% + predial ~5% + seguros ~2% + mant. ~4% + vacancia ~5%
}

# Etiqueta legible por tipo para mostrar en alertas/resumen
_OPEX_LABEL: dict[str, str] = {
    "airbnb":      "38% (plataforma + limpieza + vacancia + suministros)",
    "renta_media": "22% (admin + predial + seguros + mant. + vacancia)",
    "renta_larga": "28% (admin edificio + predial + seguros + mant. + vacancia)",
}

# LEFT JOIN barrios_airbnb_real to prefer real observed income over projected ADR×ocupacion.
# LEFT JOIN LATERAL raw.indices_precio_vivienda (fuente='dane') for latest DANE appreciation
# rate (col: variacion_anual_pct, anio/trimestre) — antes raw.ipvn_dane, fusionada 2026-08-23.
_SQL = """
    SELECT
        sc.nombre_barrio,
        sc.estado_precio,
        sc.precio_m2_venta_p50,
        sc.arriendo_p50,
        sc.score_corto,
        sc.categoria_corto,
        sc.score_mediano,
        sc.categoria_mediano,
        sc.score_largo,
        sc.categoria_largo,
        bm.adr_noche_cop,
        bm.ocupacion_airbnb_pct,
        bm.precio_renta_media_p50,
        bm.n_venta,
        bm.zona_turistica,
        bm.airbnb_n_listings,
        sl.var_anual_5anos_pct,
        bar.ingresos_anuales_p50_cop   AS ingreso_anual_airbnb_real_cop,
        bar.n_listings_airbnb          AS n_listings_airbnb_real,
        bar.adr_p50_cop                AS adr_real_noche_cop,
        ipvn.variacion_anual_pct       AS ipvn_variacion_anual,
        ctx.seguridad_score,
        ctx.liquidez_score
    FROM analytics.barrios_score_consolidado sc
    JOIN  analytics.barrios_mercado          bm   ON sc.barrio_id = bm.barrio_id
    LEFT JOIN analytics.score_largo_plazo    sl   ON sc.barrio_id = sl.barrio_id
    LEFT JOIN analytics.barrios_airbnb_real  bar  ON sc.barrio_id = bar.barrio_id
    LEFT JOIN analytics.barrios_contexto     ctx  ON sc.barrio_id = ctx.barrio_id
    LEFT JOIN LATERAL (
        SELECT variacion_anual_pct
        FROM raw.indices_precio_vivienda
        WHERE fuente = 'dane'
          AND anio = (SELECT MAX(anio) FROM raw.indices_precio_vivienda WHERE fuente = 'dane')
        ORDER BY trimestre DESC
        LIMIT 1
    ) ipvn ON TRUE
    WHERE sc.barrio_id = $1
"""


# ── Modelos ──────────────────────────────────────────────────────────────────

class SimulacionRequest(BaseModel):
    barrio_id: int
    presupuesto_cop: float = Field(gt=0)
    tipo_inversion: Literal["airbnb", "renta_larga", "renta_media"]
    perfil_riesgo: Literal["conservador", "moderado", "agresivo"] = "moderado"
    horizonte_anos: int = 5
    # Fine-grained expense overrides (when provided → skip flat OPEX)
    administracion_mes: Optional[float] = None
    vacancia_pct: Optional[float] = None
    mantenimiento_pct: Optional[float] = None
    seguro_pct: Optional[float] = None
    fee_plataforma_pct: Optional[float] = None
    predial_anual: Optional[float] = None
    retencion_fuente: bool = False
    # Credit
    con_credito: bool = False
    cuota_inicial_pct: float = 30.0
    tasa_anual_pct: float = 13.0
    plazo_anos: int = 15


class Ingresos(BaseModel):
    mensual_cop: float
    anual_cop: float
    mensual_usd: float
    anual_usd: float


class Yields(BaseModel):
    bruto_pct: float
    neto_pct: Optional[float] = None  # None when sample too small (FIX 2)


class Recupero(BaseModel):
    bruto_anos: float
    neto_anos: Optional[float] = None  # None when yield_neto suppressed (FIX 2)


class PreciosCorregidos(BaseModel):
    precio_publicado_m2: float
    precio_real_estimado_m2: float
    arriendo_publicado: float
    arriendo_neto_propietario: float


class YieldsCorregidos(BaseModel):
    yield_bruto_publicado: float
    yield_real_estimado: float
    diferencia_pct: float


class Valorizacion(BaseModel):
    tasa_anual_pct: float
    fuente_tasa: str
    valor_3anos_cop: float
    valor_5anos_cop: float
    ganancia_5anos_cop: float
    retorno_total_5anos_cop: float


class FlujoCajaDesglose(BaseModel):
    ingreso_bruto: float
    vacancia: float
    ingreso_post_vacancia: float
    fee_plataforma: Optional[float] = None
    retencion: Optional[float] = None
    administracion: Optional[float] = None
    mantenimiento: Optional[float] = None
    seguro: Optional[float] = None
    predial: Optional[float] = None
    ingreso_neto: float
    cuota_credito: Optional[float] = None
    flujo_real: Optional[float] = None


class ComparativoModalidad(BaseModel):
    tipo: str
    label: str
    ingreso_mes: Optional[float] = None
    yield_neto_pct: Optional[float] = None
    recupero_anos: Optional[float] = None
    riesgo: str
    es_recomendada: bool = False


class SimulacionResponse(BaseModel):
    barrio: str
    presupuesto_cop: float
    presupuesto_usd: float
    area_comprable_m2: float
    tipo_inversion: str

    ingresos: Ingresos
    yields: Yields
    recupero: Recupero
    valorizacion: Valorizacion

    score_oportunidad: int
    rating_oportunidad: str
    estado_precio: str | None

    precios: PreciosCorregidos
    yields_corregidos: YieldsCorregidos

    resumen: str
    alertas: list[str]
    datos_insuficientes: bool = False

    # Zona quality — the barrio's score for this investment type (separate from yield rating)
    zona_score: Optional[int] = None
    zona_categoria: Optional[str] = None
    seguridad_score: Optional[int] = None
    liquidez_score: Optional[int] = None

    # New fine-grained simulation fields
    flujo_caja_desglose: Optional[FlujoCajaDesglose] = None
    comparativo_modalidades: Optional[list[ComparativoModalidad]] = None
    cuota_credito_mes: Optional[float] = None
    flujo_con_credito: Optional[float] = None
    recomendacion_modalidad: Optional[str] = None
    proyeccion_anual: Optional[list[dict]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _r2(v: float) -> float:
    return round(v, 2)


def _rating(score: int) -> str:
    if score >= 80:
        return "EXCELENTE"
    if score >= 60:
        return "BUENA OPORTUNIDAD"
    if score >= 40:
        return "MODERADA"
    return "NO RECOMENDADA"


# FIX 2: yield-based rating — separates "rentabilidad" from "zona" quality.
_YIELD_THRESHOLDS: dict[str, dict[str, float]] = {
    "airbnb":      {"excelente": 10.0, "buena": 7.0, "moderada": 4.0},
    "renta_media": {"excelente":  8.0, "buena": 5.0, "moderada": 3.0},
    "renta_larga": {"excelente":  7.0, "buena": 5.0, "moderada": 3.0},
}


def _rating_por_yield(yield_neto_pct: Optional[float], tipo_inversion: str) -> str:
    if yield_neto_pct is None:
        return "SIN DATOS"
    u = _YIELD_THRESHOLDS.get(tipo_inversion, _YIELD_THRESHOLDS["renta_larga"])
    if yield_neto_pct >= u["excelente"]:
        return "EXCELENTE"
    if yield_neto_pct >= u["buena"]:
        return "BUENA OPORTUNIDAD"
    if yield_neto_pct >= u["moderada"]:
        return "MODERADA"
    return "NO RECOMENDADA"


def _resolve_var_anual(data: dict, alertas: list[str]) -> tuple[float, str]:
    """
    Cascade: score_largo_plazo → raw.ipvn_dane → raw.parametros_sistema → 10.1
    Returns (var_anual, fuente_label).
    """
    # 1) Barrio-specific 5-year IPVN estimate (from score_largo_plazo)
    v = data.get("var_anual_5anos_pct")
    if v is not None:
        return float(v), "IPVN estrato"

    # 2) Latest DANE national figure (joined from raw.ipvn_dane)
    ipvn = data.get("ipvn_variacion_anual")
    if ipvn is not None:
        return float(ipvn), "IPVN DANE (nacional)"

    # 3) Stored parameter (daily-updated from raw.ipvn_dane via DAG)
    stored = parametros.get("VAR_ANUAL_DANE")
    if stored != 10.1:
        alertas.append(
            "Valorización basada en dato DANE almacenado — sin IPVN específico para este barrio"
        )
        return stored, "DANE almacenado"

    # 4) Hardcoded fallback
    alertas.append(
        "Tasa de valorización estimada (10.1%) — sin datos IPVN para este barrio"
    )
    return 10.1, "estimado"


def calcular(
    presupuesto: float,
    tipo: str,
    data: dict,
    alertas: list[str],
) -> tuple[float, float]:
    """
    Devuelve (ingreso_mensual, score_val).
    Raises ValueError si faltan datos críticos.
    Appends data-quality alertas in place.
    """
    if tipo == "airbnb":
        ingreso_anual_real = data.get("ingreso_anual_airbnb_real_cop")
        adr = float(data.get("adr_noche_cop") or 0)
        ocupacion = float(data.get("ocupacion_airbnb_pct") or 0)
        n_listings_real = int(data.get("n_listings_airbnb_real") or 0)
        adr_real = float(data.get("adr_real_noche_cop") or 0)

        # FIX 1: require ≥10 real listings to trust the P50
        # FIX 3: discard real data if observed ADR > 2× estimated ADR (outlier signal)
        real_data_confiable = (
            bool(ingreso_anual_real)
            and n_listings_real >= 10
            and (not adr or not adr_real or adr_real <= adr * 2)
        )

        if real_data_confiable:
            ingreso_mensual = float(ingreso_anual_real) / 12
            alertas.append("Ingreso Airbnb basado en datos reales del barrio (mediana P50)")
        elif adr and ocupacion:
            ingreso_mensual = adr * (ocupacion / 100.0) * 30
            if ingreso_anual_real and not real_data_confiable:
                alertas.append(
                    f"Ingreso estimado con ADR×ocupación — muestra real insuficiente "
                    f"({n_listings_real} listings)"
                )
        else:
            raise ValueError(
                "Este barrio no tiene datos Airbnb suficientes (sin ADR ni ingresos reales). "
                "Prueba con renta_larga o elige un barrio con actividad turística "
                "(Poblado, Laureles, Envigado)."
            )

        if data.get("zona_turistica") is False:
            alertas.append(
                "Barrio no clasificado como zona turística — demanda Airbnb puede ser menor"
            )
        alertas.append("Considera gestión profesional para Airbnb")
        score_val = float(data.get("score_corto") or 0)

    elif tipo == "renta_larga":
        arriendo = data.get("arriendo_p50")
        if not arriendo:
            raise ValueError("Sin datos de arriendo para este barrio")
        ingreso_mensual = float(arriendo)
        score_val = float(data.get("score_largo") or 0)

    else:  # renta_media
        renta_media = data.get("precio_renta_media_p50")
        arriendo = data.get("arriendo_p50")
        if renta_media:
            ingreso_mensual = float(renta_media)
        elif arriendo:
            ingreso_mensual = float(arriendo) * 1.4
            alertas.append(
                "Precio renta media estimado — sin datos directos, se usó arriendo × 1.4"
            )
        else:
            raise ValueError("Sin datos de renta para este barrio")
        score_val = float(data.get("score_mediano") or 0)

    return ingreso_mensual, score_val


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/simular", response_model=SimulacionResponse)
@limiter.limit("60/minute")
async def simular(request: Request, req: SimulacionRequest, current_user: Optional[dict] = Depends(get_optional_user)):
    pool = get_pool()
    row = await pool.fetchrow(_SQL, req.barrio_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Barrio {req.barrio_id} no encontrado")

    data = dict(row)
    alertas: list[str] = []

    precio_m2 = float(data.get("precio_m2_venta_p50") or 0)
    if not precio_m2:
        raise HTTPException(
            status_code=400,
            detail="Este barrio no tiene suficientes datos de precio para simular. Prueba con El Poblado, Laureles o Estadio.",
        )

    # Fix #4: flag before simulation, not after
    datos_insuficientes = (data.get("n_venta") or 0) < 5
    if datos_insuficientes:
        alertas.insert(0, (
            "⚠️ DATOS INSUFICIENTES — menos de 5 transacciones de venta registradas en este barrio. "
            "Los precios son poco representativos; usa los resultados como referencia aproximada."
        ))

    try:
        ingreso_mensual, score_val = calcular(
            req.presupuesto_cop, req.tipo_inversion, data, alertas
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    var_anual, fuente_tasa = _resolve_var_anual(data, alertas)

    presupuesto = req.presupuesto_cop
    area_m2 = round(presupuesto / precio_m2, 1)
    ingreso_mensual = round(ingreso_mensual)

    # Financial params from DB (not hardcoded)
    tca = parametros.get("USD_TO_COP")

    ingreso_anual = ingreso_mensual * 12
    yield_bruto = _r2(ingreso_anual / presupuesto * 100)

    # ── Fine-grained expense calc vs flat OPEX ───────────────────────────────
    _VAC_DEFAULTS = {"airbnb": 25.0, "renta_media": 15.0, "renta_larga": 5.0}
    _MANT_DEFAULTS = {"airbnb": 1.5, "renta_media": 1.0, "renta_larga": 1.0}

    has_fine_grained = any(
        v is not None for v in [
            req.vacancia_pct, req.administracion_mes, req.mantenimiento_pct,
            req.seguro_pct, req.predial_anual,
        ]
    )

    desglose_val: Optional[FlujoCajaDesglose] = None
    cuota_credito_val: Optional[float] = None
    flujo_con_credito_val: Optional[float] = None

    if has_fine_grained:
        vacancia_pct = req.vacancia_pct if req.vacancia_pct is not None else _VAC_DEFAULTS[req.tipo_inversion]
        vacancia = vacancia_pct / 100
        ingreso_post_vac = ingreso_mensual * (1 - vacancia)

        fee = 0.0
        if req.tipo_inversion == "airbnb":
            fee_pct = (req.fee_plataforma_pct if req.fee_plataforma_pct is not None else 15.0) / 100
            fee = ingreso_post_vac * fee_pct

        retencion = 0.0
        if req.retencion_fuente and ingreso_post_vac > 1_300_000:
            retencion = ingreso_post_vac * 0.035

        admin = req.administracion_mes or 0.0
        mant_pct = req.mantenimiento_pct if req.mantenimiento_pct is not None else _MANT_DEFAULTS[req.tipo_inversion]
        mant = presupuesto * mant_pct / 100 / 12
        seguro_pct = req.seguro_pct if req.seguro_pct is not None else 0.3
        seguro = presupuesto * seguro_pct / 100 / 12
        predial_anual = req.predial_anual if req.predial_anual is not None else presupuesto * 0.005
        predial = predial_anual / 12

        ingreso_neto_mes = ingreso_post_vac - fee - retencion - admin - mant - seguro - predial
        ingreso_neto_anual = ingreso_neto_mes * 12

        desglose_val = FlujoCajaDesglose(
            ingreso_bruto=float(ingreso_mensual),
            vacancia=-round(ingreso_mensual * vacancia),
            ingreso_post_vacancia=round(ingreso_post_vac),
            fee_plataforma=-round(fee) if fee > 0 else None,
            retencion=-round(retencion) if retencion > 0 else None,
            administracion=-round(admin) if admin > 0 else None,
            mantenimiento=-round(mant) if mant > 0 else None,
            seguro=-round(seguro) if seguro > 0 else None,
            predial=-round(predial) if predial > 0 else None,
            ingreso_neto=round(ingreso_neto_mes),
        )
    else:
        opex_rate = _OPEX[req.tipo_inversion]
        ingreso_neto_anual = ingreso_anual * (1 - opex_rate)

    # ── Credit calculation (new explicit params) ──────────────────────────────
    if req.con_credito:
        cuota_ini = req.cuota_inicial_pct / 100
        valor_credito = presupuesto * (1 - cuota_ini)
        tasa_mensual = req.tasa_anual_pct / 100 / 12
        plazo_meses = req.plazo_anos * 12
        if tasa_mensual > 0:
            cuota_credito_val = round(valor_credito * tasa_mensual / (1 - (1 + tasa_mensual) ** -plazo_meses))
        else:
            cuota_credito_val = round(valor_credito / plazo_meses)
        ingreso_neto_mes_for_flujo = round(ingreso_neto_anual / 12)
        flujo_con_credito_val = ingreso_neto_mes_for_flujo - cuota_credito_val
        if desglose_val:
            desglose_val.cuota_credito = -cuota_credito_val
            desglose_val.flujo_real = flujo_con_credito_val

    yield_neto_raw = _r2(ingreso_neto_anual / presupuesto * 100)

    # FIX 2: yield >25% signals unreliable income data — suppress the number rather
    # than display a figure that can't be trusted. datos_insuficientes is set True.
    _YIELD_CEILING = 25.0
    if yield_neto_raw > _YIELD_CEILING:
        yield_neto: Optional[float] = None
        recupero_neto: Optional[float] = None
        datos_insuficientes = True
        alertas.insert(0,
            "⚠️ DATO INSUFICIENTE — yield calculado supera el 25%, señal de muestra muy pequeña. "
            "Los ingresos estimados no son confiables para este barrio y tipo de inversión."
        )
    else:
        yield_neto = yield_neto_raw
        recupero_neto = _r2(presupuesto / ingreso_neto_anual) if ingreso_neto_anual > 0 else 999.0

    # Corrección inmobiliaria: -3% precio venta, -10% arriendo
    precio_real_m2 = round(precio_m2 * 0.97)
    arriendo_neto = (
        round(ingreso_mensual * 0.90)
        if req.tipo_inversion in ("renta_larga", "renta_media")
        else ingreso_mensual
    )
    yield_real = _r2(arriendo_neto * 12 / presupuesto * 100)

    recupero_bruto = _r2(presupuesto / ingreso_anual)

    valor_3 = round(presupuesto * (1 + var_anual / 100) ** 3)
    valor_5 = round(presupuesto * (1 + var_anual / 100) ** 5)
    ganancia_5 = valor_5 - presupuesto
    retorno_total_5 = ganancia_5 + round(ingreso_neto_anual * 5)

    score_op = int(score_val)
    # FIX 2: rating_oportunidad is yield-based; zona_score/zona_categoria is the barrio score
    rating = _rating_por_yield(yield_neto, req.tipo_inversion)
    # Map tipo_inversion → categoria column for zone context
    _zona_col = {"airbnb": "categoria_corto", "renta_media": "categoria_mediano", "renta_larga": "categoria_largo"}
    zona_categoria_val: Optional[str] = data.get(_zona_col.get(req.tipo_inversion, "categoria_corto"))

    barrio_nombre = data.get("nombre_barrio") or f"Barrio {req.barrio_id}"
    tipo_label = {
        "airbnb": "Airbnb",
        "renta_larga": "arriendo largo",
        "renta_media": "renta media",
    }[req.tipo_inversion]
    resumen = (
        f"Con ${presupuesto/1_000_000:.0f}M en {barrio_nombre.title()} para {tipo_label}, "
        f"puedes comprar ~{area_m2}m² con ingreso estimado de "
        f"${ingreso_mensual/1_000_000:.1f}M/mes. "
        f"Yield neto {f'{yield_neto}%' if yield_neto is not None else 'no disponible (muestra insuficiente)'}. "
        f"En 5 años tu propiedad valdría ~${valor_5/1_000_000:.0f}M "
        f"más ${round(ingreso_neto_anual * 5 / 1_000_000, 0):.0f}M en ingresos netos "
        f"= retorno total de ${retorno_total_5/1_000_000:.0f}M."
    )

    # ── Comparativo 3 modalidades ─────────────────────────────────────────────
    _TIPO_LABELS = {"airbnb": "Airbnb", "renta_media": "Nómadas", "renta_larga": "Renta larga"}
    _TIPO_RIESGO = {"airbnb": "Medio", "renta_media": "Bajo", "renta_larga": "Bajo"}
    comparativo_list: list[ComparativoModalidad] = []
    mejor_yield = -1.0
    mejor_tipo = req.tipo_inversion
    for tipo_c in ["airbnb", "renta_media", "renta_larga"]:
        try:
            ing_c, _ = calcular(presupuesto, tipo_c, data, [])
            ing_neto_c = ing_c * 12 * (1 - _OPEX[tipo_c])
            yn_c = round(ing_neto_c / presupuesto * 100, 1) if ing_neto_c > 0 else 0.0
            rec_c = round(presupuesto / ing_neto_c, 1) if ing_neto_c > 0 else None
            if yn_c > mejor_yield:
                mejor_yield = yn_c
                mejor_tipo = tipo_c
            comparativo_list.append(ComparativoModalidad(
                tipo=tipo_c,
                label=_TIPO_LABELS[tipo_c],
                ingreso_mes=round(ing_c),
                yield_neto_pct=yn_c,
                recupero_anos=rec_c,
                riesgo=_TIPO_RIESGO[tipo_c],
                es_recomendada=False,
            ))
        except Exception:
            comparativo_list.append(ComparativoModalidad(
                tipo=tipo_c, label=_TIPO_LABELS[tipo_c],
                riesgo=_TIPO_RIESGO[tipo_c],
            ))
    for cm in comparativo_list:
        cm.es_recomendada = (cm.tipo == mejor_tipo)
    recomendacion = _TIPO_LABELS.get(mejor_tipo, "")

    # ── Proyección anual ──────────────────────────────────────────────────────
    horizonte_val = max(1, min(req.horizonte_anos, 30))
    proyeccion_list: list[dict] = []
    for a in range(1, horizonte_val + 1):
        val_a = round(presupuesto * (1 + var_anual / 100) ** a)
        ing_a = round(ingreso_neto_anual * a)
        roi_a = round((val_a - presupuesto + ing_a) / presupuesto * 100, 1)
        proyeccion_list.append({"año": a, "valor_inmueble": val_a, "ingresos_acumulados": ing_a, "roi_pct": roi_a})

    if current_user:
        try:
            meta = json.dumps({"tipo_inversion": req.tipo_inversion, "presupuesto_cop": req.presupuesto_cop})
            await pool.execute(
                "INSERT INTO historial (usuario_id, tipo, barrio_id, metadata) VALUES ($1, $2, $3, $4::jsonb)",
                current_user["id"], "simulacion", req.barrio_id, meta,
            )
        except Exception:
            pass  # historial failure must not break simulacion

    return SimulacionResponse(
        barrio=barrio_nombre,
        presupuesto_cop=presupuesto,
        presupuesto_usd=round(presupuesto / tca),
        area_comprable_m2=area_m2,
        tipo_inversion=req.tipo_inversion,
        ingresos=Ingresos(
            mensual_cop=float(ingreso_mensual),
            anual_cop=float(ingreso_anual),
            mensual_usd=round(ingreso_mensual / tca),
            anual_usd=round(ingreso_anual / tca),
        ),
        yields=Yields(
            bruto_pct=yield_bruto,
            neto_pct=yield_neto,
        ),
        recupero=Recupero(
            bruto_anos=recupero_bruto,
            neto_anos=recupero_neto,
        ),
        valorizacion=Valorizacion(
            tasa_anual_pct=var_anual,
            fuente_tasa=fuente_tasa,
            valor_3anos_cop=float(valor_3),
            valor_5anos_cop=float(valor_5),
            ganancia_5anos_cop=float(ganancia_5),
            retorno_total_5anos_cop=float(retorno_total_5),
        ),
        score_oportunidad=score_op,
        rating_oportunidad=rating,
        zona_score=score_op,
        zona_categoria=zona_categoria_val,
        estado_precio=data.get("estado_precio"),
        precios=PreciosCorregidos(
            precio_publicado_m2=float(precio_m2),
            precio_real_estimado_m2=float(precio_real_m2),
            arriendo_publicado=float(ingreso_mensual),
            arriendo_neto_propietario=float(arriendo_neto),
        ),
        yields_corregidos=YieldsCorregidos(
            yield_bruto_publicado=yield_bruto,
            yield_real_estimado=yield_real,
            diferencia_pct=_r2(yield_bruto - yield_real),
        ),
        resumen=resumen,
        alertas=alertas,
        datos_insuficientes=datos_insuficientes,
        seguridad_score=data.get("seguridad_score"),
        liquidez_score=data.get("liquidez_score"),
        flujo_caja_desglose=desglose_val,
        comparativo_modalidades=comparativo_list,
        cuota_credito_mes=float(cuota_credito_val) if cuota_credito_val is not None else None,
        flujo_con_credito=float(flujo_con_credito_val) if flujo_con_credito_val is not None else None,
        recomendacion_modalidad=recomendacion,
        proyeccion_anual=proyeccion_list,
    )


# ── New endpoints ─────────────────────────────────────────────────────────────

_LISTING_SIMUL_SQL = """
    SELECT
        ('x'||substr(md5(l.url),1,8))::bit(32)::int AS id,
        l.precio_cop::bigint AS precio,
        l.barrio_id,
        l.area_m2::float8,
        l.administracion::float8,
        l.tipo_inmueble,
        l.tipo_operacion,
        g.uso_suelo_pot,
        g.estrato_manzana
    FROM staging.stg_listings_unificado l
    LEFT JOIN analytics.listings_georef g ON g.url = l.url
    WHERE ('x'||substr(md5(l.url),1,8))::bit(32)::int = $1::bigint
    LIMIT 1
"""

# Categorías POT donde un listing residencial/inversión es anómalo —
# señal de calidad de dato a verificar, no una prohibición legal (no tenemos
# el mapeo jurídico de qué usos permite cada categoría de mixtura).
_POT_FLAG = {"Uso Dotacional", "Espacio Público Existente", "Espacio Público Proyectado"}

_BARRIO_NAME_SQL = """
    SELECT nombre, municipio FROM raw.barrios WHERE id = $1
"""

_ALTERNATIVAS_SQL = """
    SELECT
        ('x'||substr(md5(l.url),1,8))::bit(32)::int AS id,
        l.tipo_inmueble,
        l.precio_cop::bigint AS precio,
        l.area_m2::float8,
        l.habitaciones,
        l.banos::float8,
        (l.fotos)[1] AS foto,
        b.id AS barrio_id,
        b.nombre AS barrio_nombre,
        b.municipio,
        ctx.yield_bruto_pct,
        ctx.indice_nomada,
        ctx.seguridad_score
    FROM staging.stg_listings_unificado l
    JOIN raw.barrios b ON b.id = l.barrio_id
    LEFT JOIN analytics.barrios_contexto ctx ON ctx.barrio_id = l.barrio_id
    WHERE l.tipo_operacion = 'venta'
      AND l.precio_cop > 0
      AND l.precio_cop <= $1
      AND ctx.yield_bruto_pct IS NOT NULL
      AND l.fotos IS NOT NULL AND array_length(l.fotos, 1) > 0
      AND ('x'||substr(md5(l.url),1,8))::bit(32)::int != $2::bigint
    ORDER BY ctx.yield_bruto_pct DESC NULLS LAST
    LIMIT 25
"""


@router.get("/listing-simulador-data")
async def listing_simulador_data(
    listing_id: int = Query(...),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    lid = listing_id
    pool = get_pool()
    row = await pool.fetchrow(_LISTING_SIMUL_SQL, lid)
    if row is None:
        raise HTTPException(status_code=404, detail="Listing no encontrado")
    d = dict(row)
    barrio_row = await pool.fetchrow(_BARRIO_NAME_SQL, d["barrio_id"])
    return {
        "id": d["id"],
        "precio": d["precio"],
        "barrio_id": d["barrio_id"],
        "barrio_nombre": barrio_row["nombre"] if barrio_row else None,
        "municipio": barrio_row["municipio"] if barrio_row else None,
        "area_m2": d["area_m2"],
        "administracion": d["administracion"],
        "tipo_inmueble": d["tipo_inmueble"],
        "tipo_operacion": d["tipo_operacion"],
        "uso_suelo_pot": d["uso_suelo_pot"],
        "estrato_manzana": d["estrato_manzana"],
        "uso_suelo_flag": d["uso_suelo_pot"] in _POT_FLAG if d["uso_suelo_pot"] else False,
    }


@router.get("/alternativas")
async def simulador_alternativas(
    presupuesto_max: float = Query(..., gt=0),
    tipo_inversion: Literal["airbnb", "renta_larga", "renta_media"] = Query(...),
    listing_id: Optional[int] = Query(None),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    pool = get_pool()
    exclude_id = listing_id if listing_id is not None else -999999
    rows = await pool.fetch(_ALTERNATIVAS_SQL, presupuesto_max * 1.1, exclude_id)

    tipo_opex = _OPEX[tipo_inversion]
    result = []
    for r in rows:
        d = dict(r)
        yb = d.get("yield_bruto_pct")
        yn = round(yb * (1 - tipo_opex), 1) if yb else None
        rec = round(100 / yn, 1) if yn and yn > 0 else None

        # Apply tipo_inversion filter
        nomada = d.get("indice_nomada") or 0
        seguridad = d.get("seguridad_score") or 0
        if tipo_inversion == "airbnb" and nomada < 30:
            continue
        if tipo_inversion == "renta_media" and nomada < 15:
            continue
        if tipo_inversion == "renta_larga" and seguridad < 30:
            continue

        result.append({
            "id": d["id"],
            "tipo_inmueble": d.get("tipo_inmueble"),
            "precio": d["precio"],
            "area_m2": d.get("area_m2"),
            "habitaciones": d.get("habitaciones"),
            "banos": d.get("banos"),
            "foto": d.get("foto"),
            "barrio_id": d["barrio_id"],
            "barrio_nombre": d["barrio_nombre"],
            "municipio": d["municipio"],
            "yield_bruto_pct": yb,
            "yield_neto_pct": yn,
            "recupero_anos": rec,
        })
        if len(result) >= 5:
            break

    return result


# ─── Historial de simulaciones ────────────────────────────────────────────────

class SimulacionHistorialCreate(BaseModel):
    listing_id: Optional[int] = None
    barrio_id: Optional[int] = None
    presupuesto: Optional[float] = None
    tipo_inversion: Optional[str] = None
    horizonte_anos: Optional[int] = None
    con_credito: Optional[bool] = None
    params: Optional[Dict[str, Any]] = None
    resultados: Optional[Dict[str, Any]] = None


@router.post("/historial", status_code=201)
async def guardar_simulacion(
    body: SimulacionHistorialCreate,
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO public.simulaciones_historial
            (usuario_id, listing_id, barrio_id, presupuesto, tipo_inversion,
             horizonte_anos, con_credito, params, resultados)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
        RETURNING id, listing_id, barrio_id, presupuesto, tipo_inversion,
                  horizonte_anos, con_credito, params, resultados, fecha_creacion
        """,
        current_user["id"], body.listing_id, body.barrio_id,
        body.presupuesto, body.tipo_inversion, body.horizonte_anos,
        body.con_credito,
        json.dumps(body.params) if body.params else None,
        json.dumps(body.resultados) if body.resultados else None,
    )
    return dict(row)


@router.get("/historial")
async def listar_simulaciones(current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT s.id, s.listing_id, s.barrio_id, s.presupuesto, s.tipo_inversion,
               s.horizonte_anos, s.con_credito, s.params, s.resultados,
               s.fecha_creacion,
               b.nombre AS barrio_nombre
        FROM public.simulaciones_historial s
        LEFT JOIN raw.barrios b ON b.id = s.barrio_id
        WHERE s.usuario_id = $1
        ORDER BY s.fecha_creacion DESC
        LIMIT 20
        """,
        current_user["id"],
    )
    return [dict(r) for r in rows]


@router.delete("/historial/{sim_id}", status_code=204)
async def eliminar_simulacion(
    sim_id: int,
    current_user: dict = Depends(get_current_user),
):
    pool = get_pool()
    await pool.execute(
        "DELETE FROM public.simulaciones_historial WHERE id = $1 AND usuario_id = $2",
        sim_id, current_user["id"],
    )
