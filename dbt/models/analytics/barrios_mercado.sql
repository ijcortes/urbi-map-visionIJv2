{{
    config(
        materialized='table',
        schema='analytics'
    )
}}

with listings as (

    select * from {{ ref('stg_listings') }}

),

venta as (

    select
        barrio_id,
        count(*)                                                       as n_venta,
        avg(precio)                                                    as precio_venta_promedio,
        avg(area_m2)                                                   as area_promedio_m2,
        percentile_cont(0.25) within group (order by precio_m2)       as precio_venta_m2_p25,
        percentile_cont(0.50) within group (order by precio_m2)       as precio_venta_m2_p50,
        percentile_cont(0.75) within group (order by precio_m2)       as precio_venta_m2_p75,
        percentile_cont(0.50) within group (
            order by case when area_m2 > 0 then precio_venta_real / area_m2 else null end
        )                                                              as precio_m2_real_p50
    from listings
    where tipo_operacion = 'venta'
    group by barrio_id

),

arriendo as (

    select
        barrio_id,
        count(*)                                                       as n_arriendo,
        percentile_cont(0.25) within group (order by precio)          as precio_arriendo_p25,
        percentile_cont(0.50) within group (order by precio)          as precio_arriendo_p50,
        percentile_cont(0.75) within group (order by precio)          as precio_arriendo_p75,
        percentile_cont(0.50) within group (order by precio_arriendo_real) as arriendo_real_p50
    from listings
    where tipo_operacion = 'arriendo'
      and tipo_inmueble   = 'apartamento'
    group by barrio_id

),

-- Última snapshot semanal de AirROI por barrio
airbnb as (

    select distinct on (barrio_id)
        barrio_id,
        n_listings                  as airbnb_n_listings,
        ocupacion_pct               as ocupacion_airbnb_pct,
        adr_cop                     as adr_noche_cop,
        ingresos_anuales_estimados  as airbnb_ingresos_anuales
    from {{ source('airbnb', 'airbnb_barrios') }}
    where barrio_id is not null
    order by barrio_id, fecha_consulta desc

),

combined as (

    select
        coalesce(v.barrio_id, a.barrio_id)                            as barrio_id,

        -- Venta
        v.n_venta,
        round(v.precio_venta_promedio)                                as precio_venta_promedio,
        round(v.area_promedio_m2::numeric, 1)                         as area_promedio_m2,
        round(v.precio_venta_m2_p25::numeric, 0)                     as precio_venta_m2_p25,
        round(v.precio_venta_m2_p50::numeric, 0)                     as precio_venta_m2_p50,
        round(v.precio_venta_m2_p75::numeric, 0)                     as precio_venta_m2_p75,

        -- Arriendo apartamento
        a.n_arriendo,
        round(a.precio_arriendo_p25::numeric, 0)                     as precio_arriendo_p25,
        round(a.precio_arriendo_p50::numeric, 0)                     as precio_arriendo_p50,
        round(a.precio_arriendo_p75::numeric, 0)                     as precio_arriendo_p75,

        -- Métricas largo plazo
        -- años de arriendo para recuperar el capital (menor = mejor)
        case
            when v.precio_venta_promedio > 0 and a.precio_arriendo_p50 > 0
                then round(
                    (v.precio_venta_promedio / (a.precio_arriendo_p50 * 12))::numeric, 2
                )
            else null
        end                                                            as ratio_precio_arriendo,

        -- rentabilidad bruta anual estimada (%)
        case
            when v.precio_venta_promedio > 0 and a.precio_arriendo_p50 > 0
                then round(
                    ((a.precio_arriendo_p50 * 12) / v.precio_venta_promedio * 100)::numeric, 2
                )
            else null
        end                                                            as yield_bruto,

        -- Airbnb (short-term rental)
        ab.airbnb_n_listings,
        ab.ocupacion_airbnb_pct,
        ab.adr_noche_cop,

        -- yield_airbnb_pct = ADR * ocupación * 365 / valor_inmueble_promedio * 100
        -- Usa precio_venta_m2_p50 * area_promedio como proxy del valor del inmueble
        case
            when v.precio_venta_m2_p50 > 0
             and v.area_promedio_m2    > 0
             and ab.adr_noche_cop      > 0
             and ab.ocupacion_airbnb_pct > 0
                then round(
                    (
                        ab.adr_noche_cop
                        * (ab.ocupacion_airbnb_pct / 100.0)
                        * 365.0
                        / (v.precio_venta_m2_p50 * v.area_promedio_m2)
                        * 100
                    )::numeric, 2
                )
            else null
        end                                                            as yield_airbnb_pct,

        -- Métricas corregidas (descontando comisión inmobiliaria: -3% venta, -10% arriendo)
        v.precio_m2_real_p50,
        a.arriendo_real_p50,
        case
            when v.precio_m2_real_p50 > 0
             and v.area_promedio_m2   > 0
             and a.arriendo_real_p50  > 0
                then round(
                    (a.arriendo_real_p50 * 12.0
                     / (v.precio_m2_real_p50 * v.area_promedio_m2)
                     * 100)::numeric, 2
                )
            else null
        end                                                            as yield_real_pct

    from venta v
    full outer join arriendo a  on v.barrio_id = a.barrio_id
    left join      airbnb   ab  on coalesce(v.barrio_id, a.barrio_id) = ab.barrio_id

),

-- #3 To-do: tasa de "precio justo" POR ESTRATO. Antes era 0,6%/mes fijo (= 7,2%
-- anual bruto), que marcaba ~68% de los barrios como SOBRE porque el yield real
-- cae con el estrato (estratos 4-6 rinden ~0,33%/mes, no 0,6%). Ahora el benchmark
-- de cada barrio = rendimiento mensual MEDIANO real de su estrato → NORMAL = precio
-- típico de su estrato; SOBRE/BAJO = outliers dentro del estrato. Auto-calibra en
-- cada run. Estrato por intersección de área con raw.estratos_manzana (igual que
-- score_largo_plazo, sin ciclo: ambos leen el raw, no este modelo).
estrato_barrio as (
    select
        b.id as barrio_id,
        (
            select em.estrato
            from raw.estratos_manzana em
            where em.geometry is not null
              and ST_Intersects(b.geometry, em.geometry)
            order by ST_Area(ST_Intersection(b.geometry, em.geometry)) desc
            limit 1
        ) as estrato
    from {{ source('geo', 'barrios') }} b
),

estrato_rate as (
    select
        eb.estrato,
        percentile_cont(0.5) within group (
            order by c.precio_arriendo_p50 * 100.0 / nullif(c.precio_venta_promedio, 0)
        )::numeric as rate_pct
    from combined c
    join estrato_barrio eb on eb.barrio_id = c.barrio_id
    where c.precio_arriendo_p50 > 0 and c.precio_venta_promedio > 0
    group by eb.estrato
),

global_rate as (
    -- mediana de mercado global — fallback para barrios sin estrato (satélites:
    -- raw.estratos_manzana es solo Medellín). Mejor que el 0,6 fijo histórico.
    select percentile_cont(0.5) within group (
               order by c.precio_arriendo_p50 * 100.0 / nullif(c.precio_venta_promedio, 0)
           )::numeric as rate_pct
    from combined c
    where c.precio_arriendo_p50 > 0 and c.precio_venta_promedio > 0
),

barrio_rate as (
    -- rate mensual % del estrato del barrio; si no hay estrato (satélite / sin
    -- cobertura) cae a la mediana global; último recurso 0,6 (regla general).
    select eb.barrio_id,
           coalesce(er.rate_pct, (select rate_pct from global_rate), 0.6) as rate_pct
    from estrato_barrio eb
    left join estrato_rate er on er.estrato = eb.estrato
)

select
    c.barrio_id,
    b.nombre                                                           as barrio_nombre,
    b.comuna,
    b.municipio,
    c.n_venta,
    c.precio_venta_promedio,
    c.area_promedio_m2,
    c.precio_venta_m2_p25,
    c.precio_venta_m2_p50,
    c.precio_venta_m2_p75,
    c.n_arriendo,
    c.precio_arriendo_p25,
    c.precio_arriendo_p50,
    c.precio_arriendo_p75,
    c.ratio_precio_arriendo,
    c.yield_bruto,
    c.airbnb_n_listings,
    c.ocupacion_airbnb_pct,
    c.adr_noche_cop,
    c.yield_airbnb_pct,

    -- PBN / PMN / POI: valor total del inmueble implícito en el arriendo de zona
    -- PBN = (arriendo_p50 * 100) / rate_pct_del_estrato  (ver CTE barrio_rate; antes 0,6 fijo)
    ROUND((c.precio_arriendo_p50 * 100.0 / br.rate_pct))                      AS pbn_precio_justo,
    ROUND((c.precio_arriendo_p50 * 100.0 / br.rate_pct) * 0.97)               AS pmn_neto,
    ROUND((c.precio_arriendo_p50 * 100.0 / br.rate_pct) * 0.97 * 0.85)        AS poi_precio_oferta,

    -- PBN normalizado a m² para comparar con precio_venta_m2_p50
    ROUND(
        (c.precio_arriendo_p50 * 100.0 / br.rate_pct)
        / NULLIF(c.area_promedio_m2, 0)
    )                                                                  AS pbn_precio_justo_m2,

    -- Opción A: comparación en totales (precio_venta_promedio vs PBN)
    -- positivo = mercado caro vs fundamentales; negativo = oportunidad
    ROUND(
        ((c.precio_venta_promedio - (c.precio_arriendo_p50 * 100.0 / br.rate_pct))
        / NULLIF((c.precio_arriendo_p50 * 100.0 / br.rate_pct), 0)) * 100, 1
    )                                                                  AS diferencia_total_pct,

    -- Opción B: comparación por m² (precio_venta_m2_p50 vs PBN/m²)
    ROUND(
        ((c.precio_venta_m2_p50 - (c.precio_arriendo_p50 * 100.0 / br.rate_pct) / NULLIF(c.area_promedio_m2, 0))
        / NULLIF((c.precio_arriendo_p50 * 100.0 / br.rate_pct) / NULLIF(c.area_promedio_m2, 0), 0)) * 100, 1
    )                                                                  AS diferencia_m2_pct,

    CASE
        WHEN c.precio_venta_promedio > (c.precio_arriendo_p50 * 100.0 / br.rate_pct) * 1.10 THEN 'SOBRE'
        WHEN c.precio_venta_promedio < (c.precio_arriendo_p50 * 100.0 / br.rate_pct) * 0.90 THEN 'BAJO'
        ELSE 'NORMAL'
    END                                                                AS estado_precio,

    -- Seguridad (residente = señal principal; transito = contexto)
    bs.score_seguridad_residente                                       AS score_seguridad,
    bs.categoria_seguridad                                             AS categoria_seguridad,
    bs.zona_turistica                                                  AS zona_turistica,
    bs.nota_seguridad                                                  AS nota_seguridad,
    bs.tendencia                                                       AS tendencia_seguridad,
    bs.score_seguridad_transito                                        AS score_seguridad_transito,

    -- Renta media (nómadas digitales — fuentes externas: Flatio, Homads, AirROI mensual)
    rm.precio_renta_media_p50,
    rm.precio_renta_media_usd,

    -- yield_renta_media_pct = (renta_media_p50 * 12) / precio_venta_promedio * 100
    -- n >= 3 required: p50 from 1-2 listings is statistically unreliable
    case
        when c.precio_venta_promedio > 0
         and rm.precio_renta_media_p50 > 0
         and rm.n_listings_renta_media >= 3
            then round(
                (rm.precio_renta_media_p50 * 12.0 / c.precio_venta_promedio * 100)::numeric, 2
            )
        else null
    end                                                                    as yield_renta_media_pct,

    -- yield_renta_media_airbnb_pct: yield real de listings Airbnb segmentados (7-29 días avg stay)
    -- COALESCE: si existe dato real del portal usa ese, sino queda null
    rs_media.yield_pct                                                     as yield_renta_media_airbnb_pct,
    rs_media.n_listings                                                    as n_listings_renta_media_airbnb,
    rs_media.ocupacion_p50                                                 as ocupacion_renta_media_airbnb_pct,
    rs_media.adr_p50_usd                                                   as adr_renta_media_airbnb_usd,

    -- n_listings_renta_media: total listings nomad (todas las fuentes) con barrio_id asignado
    rm.n_listings_renta_media,

    -- premium_vs_largo_pct: cuánto más cara es renta media vs arriendo tradicional (upside del inversor)
    case
        when rm.precio_renta_media_p50 > 0
         and c.precio_arriendo_p50 > 0
         and rm.n_listings_renta_media >= 3
            then round(
                ((rm.precio_renta_media_p50 / c.precio_arriendo_p50) - 1.0) * 100,
                1
            )
        else null
    end                                                                    as premium_vs_largo_pct,

    -- Corrección inmobiliaria (-3% venta, -10% arriendo)
    round(c.precio_m2_real_p50::numeric, 0)                               as precio_m2_real_p50,
    round(c.arriendo_real_p50::numeric, 0)                                as arriendo_real_p50,
    c.yield_real_pct,

    now()                                                                  as calculado_en

from combined c
left join barrio_rate                            br       on c.barrio_id = br.barrio_id
left join {{ source('geo', 'barrios') }}         b        on c.barrio_id = b.id
left join {{ ref('barrios_seguridad') }}         bs       on c.barrio_id = bs.barrio_id
left join {{ ref('barrios_renta_media') }}       rm       on c.barrio_id = rm.barrio_id
left join {{ ref('barrios_renta_segmentada') }}  rs_media on c.barrio_id = rs_media.barrio_id
                                                          and rs_media.tipo_renta = 'renta_media'
where c.barrio_id is not null
