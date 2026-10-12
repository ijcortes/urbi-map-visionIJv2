{{
    config(
        materialized='table',
        schema='staging'
    )
}}

/*
  Unifica raw.listings_fincaraiz + raw.listings_metrocuadrado
  + raw.listings_premium + raw.listings_renta_media.

  Deduplicación por dos vías:
    A) Con coordenadas → cluster geoespacial ROUND(lat,3)×ROUND(lon,3) ≈ 111m²
       + mismas características físicas (tipo_op, tipo_inm, hab, área±5m²).
    B) Sin coordenadas → dedup_hash o clave sintética por barrio+características.

  El mejor listing del cluster (tier: agencia_premium > renta_media > standard)
  gana. Se conservan precio_min/max del cluster y flag precio_variable.
*/

with todas_fuentes as (

    -- ── FincaRaíz: coords disponibles (centroide barrio o extraídas de scraper) ─
    select
        id::text || '_fc'      as listing_uid,
        'fincaraiz'            as fuente,
        'standard'             as tier,
        tipo_operacion,
        tipo_inmueble,
        precio                 as precio_cop,
        null::bigint           as precio_usd,
        area_m2,
        habitaciones,
        banos::numeric         as banos,
        barrio_raw,
        barrio_id,
        direccion_raw,
        lat::double precision,
        lon::double precision,
        geom,
        url,
        fotos,
        fecha_scraping,
        dedup_hash,
        estrato_real,
        null::boolean   as amoblado,      -- fincaraiz no trae este campo
        antiguedad,
        amenidades,
        null::boolean   as verificado,
        administracion
    from {{ source('fincaraiz', 'listings_fincaraiz') }}
    where activo = true
      and url_activa is not false   -- validate_listings_urls marca URL muerta = FALSE; NULL = sin revisar = mostrar
      and precio > 0
      and area_m2 > 0

    union all

    -- ── Habi: iBuyer, cobertura nacional filtrada a Valle de Aburrá en el scraper ──
    select
        id::text || '_habi'    as listing_uid,
        'habi'                 as fuente,
        'standard'             as tier,
        tipo_operacion,
        tipo_inmueble,
        precio::bigint          as precio_cop,
        null::bigint           as precio_usd,
        area_m2,
        habitaciones,
        banos::numeric         as banos,
        barrio_raw,
        barrio_id,
        direccion_raw,
        lat::double precision,
        lon::double precision,
        geom,
        url,
        fotos,
        fecha_scraping,
        dedup_hash,
        estrato_real,
        null::boolean   as amoblado,      -- habi no trae este campo
        antiguedad::text,
        amenidades,
        null::boolean   as verificado,
        administracion
    from {{ source('habi', 'listings_habi') }}
    where activo = true
      and precio > 0
      and area_m2 > 0

    union all

    -- ── MetroCuadrado: lat/lon y geom ya poblados ────────────────────────────
    select
        id::text || '_mq'      as listing_uid,
        'metrocuadrado'        as fuente,
        'standard'             as tier,
        tipo_operacion,
        tipo_inmueble,
        precio                 as precio_cop,
        null::bigint           as precio_usd,
        area_m2,
        habitaciones,
        banos::numeric         as banos,
        barrio_raw,
        barrio_id,
        direccion_raw,
        lat,
        lon,
        geom,
        url,
        fotos,
        fecha_scraping,
        dedup_hash,
        coalesce(estrato_real, estrato) as estrato_real,
        null::boolean   as amoblado,      -- metrocuadrado no trae este campo
        antiguedad,
        amenidades,
        null::boolean   as verificado,
        administracion
    from {{ source('metrocuadrado', 'listings_metrocuadrado') }}
    where activo = true
      and url_activa is not false   -- validate_listings_urls marca URL muerta = FALSE; NULL = sin revisar = mostrar
      and precio > 0
      and area_m2 > 0

    union all

    -- ── Premium: agencias y portales adicionales ─────────────────────────────
    select
        id::text || '_pr'                  as listing_uid,
        fuente,
        coalesce(fuente_tipo, 'standard')  as tier,
        tipo_operacion,
        tipo_inmueble,
        precio_cop,
        precio_usd,
        area_m2,
        habitaciones,
        banos,
        barrio_raw,
        barrio_id,
        direccion_raw,
        lat::double precision,
        lon::double precision,
        geom,
        url,
        fotos,
        fecha_scraping,
        dedup_hash,
        null::integer as estrato_real,
        amoblado,
        null::text      as antiguedad,    -- premium no trae este campo
        amenidades,
        null::boolean   as verificado,
        null::numeric   as administracion -- premium no trae este campo
    from {{ source('premium', 'listings_premium') }}
    where precio_cop > 0
      and area_m2 > 0

    union all

    -- ── Renta media: arriendo mensual nómadas — geom calculado en vuelo ───────
    select
        id::text || '_rm'      as listing_uid,
        fuente,
        'renta_media'          as tier,
        'arriendo'             as tipo_operacion,
        'apartamento'          as tipo_inmueble,
        precio_mes_cop         as precio_cop,
        null::bigint           as precio_usd,
        area_m2,
        habitaciones,
        banos,
        barrio_raw,
        barrio_id,
        null::text             as direccion_raw,
        lat::double precision,
        lon::double precision,
        case
            when lat is not null and lon is not null
            then st_setsrid(st_makepoint(lon::float, lat::float), 4326)
        end                    as geom,
        url,
        null::text[]           as fotos,
        fecha_scraping,
        dedup_hash,
        null::integer          as estrato_real,
        amoblado,
        null::text              as antiguedad,  -- renta_media no trae este campo
        amenidades,
        null::boolean           as verificado,
        null::numeric           as administracion -- renta_media no trae este campo
    from {{ source('renta_media', 'listings_renta_media') }}
    where precio_mes_cop > 0
      and area_m2 > 0

),

-- ── PASO A: Con coordenadas — dedup geoespacial ───────────────────────────────
-- Celdas de ~111m × ~110m (ROUND a 3 decimales en Medellín lat 6.2°).
-- Dentro de cada celda: mismo tipo_op + tipo_inm + hab + área±5m² = mismo inmueble.
con_geo as (
    select
        listing_uid, fuente, tier,
        tipo_operacion, tipo_inmueble,
        precio_cop, precio_usd,
        area_m2, habitaciones, banos,
        barrio_raw, barrio_id,
        direccion_raw, lat, lon, geom,
        url, fotos, fecha_scraping, estrato_real,
        amoblado, antiguedad, amenidades, verificado, administracion,

        min(precio_cop) over (partition by
            round(lat::numeric, 3),
            round(lon::numeric, 3),
            tipo_operacion,
            tipo_inmueble,
            habitaciones,
            (round(area_m2::numeric / 5) * 5)
        ) as precio_min_cluster,

        max(precio_cop) over (partition by
            round(lat::numeric, 3),
            round(lon::numeric, 3),
            tipo_operacion,
            tipo_inmueble,
            habitaciones,
            (round(area_m2::numeric / 5) * 5)
        ) as precio_max_cluster,

        count(*) over (partition by
            round(lat::numeric, 3),
            round(lon::numeric, 3),
            tipo_operacion,
            tipo_inmueble,
            habitaciones,
            (round(area_m2::numeric / 5) * 5)
        ) as n_duplicados,

        row_number() over (
            partition by
                round(lat::numeric, 3),
                round(lon::numeric, 3),
                tipo_operacion,
                tipo_inmueble,
                habitaciones,
                (round(area_m2::numeric / 5) * 5)
            order by
                case tier
                    when 'agencia_premium' then 1
                    when 'renta_media'     then 2
                    when 'standard'        then 3
                    else                        4
                end,
                fecha_scraping desc nulls last
        ) as _rn

    from todas_fuentes
    where geom is not null
),

-- ── PASO B: Sin coordenadas — dedup por hash o clave sintética ───────────────
sin_geo as (
    select
        listing_uid, fuente, tier,
        tipo_operacion, tipo_inmueble,
        precio_cop, precio_usd,
        area_m2, habitaciones, banos,
        barrio_raw, barrio_id,
        direccion_raw, lat, lon, geom,
        url, fotos, fecha_scraping, estrato_real,
        amoblado, antiguedad, amenidades, verificado, administracion,

        precio_cop as precio_min_cluster,
        precio_cop as precio_max_cluster,

        count(*) over (partition by
            coalesce(
                dedup_hash,
                coalesce(barrio_id::text, barrio_raw, 'x') || '|' ||
                coalesce(tipo_operacion, '?') || '|' ||
                coalesce(tipo_inmueble, '?')  || '|' ||
                coalesce(habitaciones::text, '?') || '|' ||
                (round(area_m2::numeric / 5) * 5)::text
            )
        ) as n_duplicados,

        row_number() over (
            partition by
                coalesce(
                    dedup_hash,
                    coalesce(barrio_id::text, barrio_raw, 'x') || '|' ||
                    coalesce(tipo_operacion, '?') || '|' ||
                    coalesce(tipo_inmueble, '?')  || '|' ||
                    coalesce(habitaciones::text, '?') || '|' ||
                    (round(area_m2::numeric / 5) * 5)::text
                )
            order by
                case tier
                    when 'agencia_premium' then 1
                    when 'renta_media'     then 2
                    when 'standard'        then 3
                    else                        4
                end,
                fecha_scraping desc nulls last
        ) as _rn

    from todas_fuentes
    where geom is null
)

-- ── RESULTADO FINAL ───────────────────────────────────────────────────────────
select
    listing_uid,
    fuente,
    tier,
    tipo_operacion,
    tipo_inmueble,
    precio_cop,
    precio_usd,
    precio_min_cluster,
    precio_max_cluster,
    case
        when n_duplicados > 1
         and precio_min_cluster is distinct from precio_max_cluster
        then true else false
    end                                         as precio_variable,
    area_m2,
    case when area_m2 > 0 then precio_cop / area_m2 end as precio_m2,
    habitaciones,
    banos,
    barrio_raw,
    barrio_id,
    direccion_raw,
    lat,
    lon,
    geom,
    url,
    fotos,
    fecha_scraping,
    n_duplicados,
    estrato_real,
    amoblado,
    antiguedad,
    amenidades,
    verificado,
    administracion
from con_geo
where _rn = 1

union all

select
    listing_uid,
    fuente,
    tier,
    tipo_operacion,
    tipo_inmueble,
    precio_cop,
    precio_usd,
    precio_min_cluster,
    precio_max_cluster,
    false                                       as precio_variable,
    area_m2,
    case when area_m2 > 0 then precio_cop / area_m2 end as precio_m2,
    habitaciones,
    banos,
    barrio_raw,
    barrio_id,
    direccion_raw,
    lat,
    lon,
    geom,
    url,
    fotos,
    fecha_scraping,
    n_duplicados,
    estrato_real,
    amoblado,
    antiguedad,
    amenidades,
    verificado,
    administracion
from sin_geo
where _rn = 1
