{{
    config(
        materialized='table',
        schema='analytics'
    )
}}

/*
  Enriquecimiento de listings con datos catastrales de Medellín.

  El catastro (raw.catastro_medellin, filtrado cd_vig_pred='S') solo tiene
  granularidad de COMUNA, no de barrio. Se agrega avalúo por m² a nivel comuna
  y se une con listings a través de raw.barrios.comuna → catastro.ds_comuna.

  Usa solo predios actualmente vigentes (cd_vig_pred='S'), excluyendo
  históricos/demolidos/subdivididos. raw.catastro_medellin_vigente se fusionó
  2026-08-23 dentro de raw.catastro_medellin (columna cd_vig_pred) — antes
  era su propia tabla íntegramente 'S', ahora hay que filtrar explícito.

  ratio_mercado_catastro = precio_m2_listing / avaluo_m2_catastro_comuna
    > 3.0  → SOBRE_CATASTRO (zona premium / especulación)
    1.5-3.0 → RANGO_NORMAL
    < 1.5  → CERCANO_CATASTRO (oportunidad)

  Solo aplica a Medellín. Listings de otros municipios: ratio = NULL.
*/

with catastro_por_comuna as (
    select
        ds_comuna,
        cd_comuna,
        count(*)                                            as n_predios_catastro,
        avg(vl_avaluo_total)                                as avaluo_total_prom,
        -- mediana del avalúo/m² (antes avg, sesgado por casas grandes).
        percentile_cont(0.5) within group (
            order by vl_avaluo_total / nm_ar_constru
        )                                                   as avaluo_m2_construccion,
        percentile_cont(0.5) within group (
            order by
                case when nm_ar_constru > 0
                     then vl_avaluo_total / nm_ar_constru
                     else null
                end
        )                                                   as avaluo_m2_mediana,
        avg(nm_ar_constru)                                  as area_construccion_prom
    from raw.catastro_medellin
    where cd_vig_pred = 'S'
      and cd_ind_ru_ur = 'U'
      and vl_avaluo_total > 0
      -- SOLO viviendas reales: área 30–400 m², sin parqueaderos (70k filas) ni
      -- matrices de edificio entero / lotes, que hundían el avalúo/m² ~40x. Ver
      -- To-do §1 y scripts/load_catastro_medellin_vigente.py (mismo filtro, sync).
      and nm_ar_constru between 30 and 400
      and ds_uso_tipo ilike '%residencial%'
      and ds_uso_tipo not ilike '%parqueadero%'
      and ds_uso_tipo not ilike '%lote%'
    group by ds_comuna, cd_comuna
),

listings_base as (
    select
        lu.listing_uid,
        lu.fuente,
        lu.tier,
        lu.tipo_operacion,
        lu.tipo_inmueble,
        lu.precio_cop,
        lu.precio_m2,
        lu.area_m2,
        lu.habitaciones,
        lu.banos,
        lu.barrio_raw,
        lu.barrio_id,
        lu.lat,
        lu.lon,
        lu.geom,
        lu.url,
        lu.n_duplicados,
        lu.precio_variable,
        lu.fecha_scraping
    from {{ ref('stg_listings_unificado') }} lu
    where lu.tipo_inmueble in ('apartamento', 'casa')
),

-- Unir barrios con su nombre de comuna para el join catastral
listings_con_barrio as (
    select
        lb.*,
        b.comuna                                            as barrio_comuna,
        b.municipio                                         as barrio_municipio
    from listings_base lb
    left join raw.barrios b on b.id = lb.barrio_id
),

enriched as (
    select
        lcb.listing_uid,
        lcb.fuente,
        lcb.tier,
        lcb.tipo_operacion,
        lcb.tipo_inmueble,
        lcb.precio_cop,
        lcb.precio_m2,
        lcb.area_m2,
        lcb.habitaciones,
        lcb.banos,
        lcb.barrio_raw,
        lcb.barrio_id,
        lcb.barrio_comuna,
        lcb.lat,
        lcb.lon,
        lcb.geom,
        lcb.url,
        lcb.n_duplicados,
        lcb.precio_variable,
        lcb.fecha_scraping,

        -- Datos catastrales de la comuna
        cat.cd_comuna,
        cat.n_predios_catastro,
        cat.avaluo_m2_construccion                          as avaluo_m2_catastro,
        cat.avaluo_m2_mediana                               as avaluo_m2_catastro_mediana,
        cat.area_construccion_prom,

        -- Nivel de referencia catastral usado
        case
            when cat.avaluo_m2_construccion is not null then 'comuna'
            else null
        end                                                 as catastro_nivel,

        -- Ratio mercado / catastro (solo venta — arriendo no es comparable)
        case
            when lcb.tipo_operacion = 'venta'
             and cat.avaluo_m2_construccion > 0
             and lcb.precio_m2 is not null
            then round(
                (lcb.precio_m2 / cat.avaluo_m2_construccion)::numeric,
                2
            )
            else null
        end                                                 as ratio_mercado_catastro,

        -- Clasificación del ratio (solo venta)
        case
            when lcb.tipo_operacion != 'venta'
              or lcb.precio_m2 is null
              or cat.avaluo_m2_construccion is null
            then null
            when lcb.precio_m2 / cat.avaluo_m2_construccion > 3.0
            then 'SOBRE_CATASTRO'
            when lcb.precio_m2 / cat.avaluo_m2_construccion < 1.5
            then 'CERCANO_CATASTRO'
            else 'RANGO_NORMAL'
        end                                                 as categoria_precio_catastro

    from listings_con_barrio lcb
    left join catastro_por_comuna cat
           on upper(cat.ds_comuna) = upper(lcb.barrio_comuna)
          and lcb.barrio_municipio ilike '%medellin%'
)

select * from enriched
