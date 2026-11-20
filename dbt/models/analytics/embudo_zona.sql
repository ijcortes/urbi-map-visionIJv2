{{
    config(
        materialized='view',
        schema='analytics'
    )
}}

/*
  #7 Embudo de prospectos por ZONA (barrio), últimos 30 días.

  Fuentes (arquitectura aditiva: user_events = stream de analytics; las tablas
  de dominio siguen siendo fuente de verdad de su etapa):
    - vistas_mapa       = user_events 'listing_preview'  (popup en el mapa)
    - aperturas_detalle = user_events 'listing_view'     (abrir el drawer → /vista)
    - favoritos         = raw.favoritos_listings          (lista guardada)
    - visitas_agendadas = public.visita_solicitud         (= prospecto ruteado al realtor)

  El barrio se resuelve por url→staging cuando el evento no trae barrio_id
  (p.ej. /vista inserta listing_view sin barrio_id). Contacto (WhatsApp) NO está:
  va al teléfono del propio aviso, no a nuestro realtor — se agregará si se captura
  server-side. Vista (no tabla) para que el panel la lea siempre fresca.
*/

with eventos as (
    select
        coalesce(e.barrio_id, sl.barrio_id) as barrio_id,
        e.event_type
    from public.user_events e
    left join staging.stg_listings_unificado sl on sl.url = e.entity_id
    where e.created_at > now() - interval '30 days'
      and e.event_type in ('listing_preview', 'listing_view')
),

agg_eventos as (
    select
        barrio_id,
        count(*) filter (where event_type = 'listing_preview') as vistas_mapa,
        count(*) filter (where event_type = 'listing_view')    as aperturas_detalle
    from eventos
    where barrio_id is not null
    group by barrio_id
),

favoritos as (
    select barrio_id, count(*) as n
    from raw.favoritos_listings
    where created_at > now() - interval '30 days' and barrio_id is not null
    group by barrio_id
),

visitas as (
    select sl.barrio_id, count(*) as n
    from public.visita_solicitud v
    join staging.stg_listings_unificado sl on sl.url = v.listing_url
    where v.created_at > now() - interval '30 days' and sl.barrio_id is not null
    group by sl.barrio_id
)

select
    b.id                            as barrio_id,
    b.nombre                        as barrio,
    b.comuna,
    b.municipio,
    coalesce(ev.vistas_mapa, 0)        as vistas_mapa,
    coalesce(ev.aperturas_detalle, 0)  as aperturas_detalle,
    coalesce(f.n, 0)                   as favoritos,
    coalesce(v.n, 0)                   as visitas_agendadas
from raw.barrios b
left join agg_eventos ev on ev.barrio_id = b.id
left join favoritos   f  on f.barrio_id  = b.id
left join visitas     v  on v.barrio_id  = b.id
where coalesce(ev.vistas_mapa, 0) + coalesce(ev.aperturas_detalle, 0)
    + coalesce(f.n, 0) + coalesce(v.n, 0) > 0
