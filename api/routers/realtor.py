"""Dashboard del realtor — perfil, inbox (asignados+pool), listings, desempeño/ROI.

Consumido por src/lib/realtorApi.ts (httpApi). Vistas de listings salen de
public.user_events (event_type='listing_view', entity_id = listing.id::text | slug).
"""
from __future__ import annotations

import logging
from datetime import date, time as _time
from types import SimpleNamespace

from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from api.db import get_pool
from api.dependencies import get_current_user
from api.routers.barrios import BarrioResponse, _BARRIO_SQL, _build_response
from api.services.asignador_service import AsignadorError, sweep_asignados_vencidos, tomar_del_pool
from api.services.listing_service import TRANSICIONES_VALIDAS, datos_minimos_completos
from api.utils import ghl_client
from api.utils.storage import read_upload_bounded, upload_file

from api.services.trm_service import get_usd_rate

log = logging.getLogger(__name__)

router = APIRouter()

# claves del cuestionario que el dashboard muestra en "declarado"
_DECL_KEYS = ("tiene_escritura", "al_dia_predial", "al_dia_administracion", "tiene_hipoteca")

# ── Incentivos del realtor — parámetros de PRODUCTO (PLACEHOLDER, ajustar con negocio) ──
# NO son decisiones técnicas: definen el comportamiento que premiamos. Tunéalos acá.
# Pesos del puntaje de standing (0..1, deben sumar 1.0).
_PUNTAJE_PESOS = {"contribucion": 0.30, "velocidad": 0.30, "show_rate": 0.20, "aceptacion": 0.20}
_CONTRIB_CAP = 5             # cierres (12m) que topan el componente de contribución
_RANKING_MIN_ACTIVIDAD = 3   # actividad mínima (visitas resp + intakes + cierres, 90d/12m) para
                             # tener puntaje/ranking; por debajo → "datos insuficientes" (no inventamos señal)
# Reciprocidad: cierres reportados (12m) para desbloquear los comparables de cierre.
# Cuenta DISTINCT matrícula (anti-farm). Mitigación de integridad construida (punto
# medio): unlock instantáneo con autoreporte, pero comparables marcan verificado vs
# sin-verificar + dedup prioriza verificado → el cierre falso es inútil para engañar.
# Cold-start: con pocos cierres el gate abre una sala fina (crece con los reportes).
# Futuro: cruce SNR por matrícula (falta dato nivel-matrícula). Ver docs/FLUJO_REALTOR.md.
_COMPARABLES_MIN_CIERRES = 1

_ZONAS_SQL = """
    SELECT s.zona_codigo, s.zona_nivel::text AS nivel, s.tier, s.precio_mensual,
           CASE
             WHEN s.zona_nivel = 'comuna' THEN
               (SELECT INITCAP(LOWER(b2.comuna)) FROM raw.barrios b2
                JOIN analytics.barrios_cd bc ON bc.barrio_id = b2.id
                WHERE bc.cd_comuna::text = s.zona_codigo LIMIT 1)
             WHEN s.zona_nivel = 'barrio' THEN
               (SELECT INITCAP(LOWER(nombre)) FROM raw.barrios WHERE id::text = s.zona_codigo)
             ELSE s.zona_codigo
           END AS nombre
    FROM sponsorship s
    JOIN agency_member am ON am.agency_id = s.agency_id AND am.agent_id = $1
    WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
    ORDER BY s.precio_mensual DESC
"""

# vistas de un listing: eventos listing_view cuyo entity_id apunta al listing
_VISTAS_JOIN = "e.event_type = 'listing_view' AND e.entity_id IN (l.id::text, l.slug)"


async def _agent_del_usuario(user: dict, pool, exigir_activo: bool = True) -> SimpleNamespace:
    async with pool.acquire() as conn:
        # Determinista: si un usuario tuviera >1 fila agent, TODOS los endpoints
        # realtor deben resolver a la MISMA (si no, /pool/tomar escribe en una y
        # /asignados lee de otra → el lead tomado "desaparece"). Canónica = la
        # más vieja; activa gana sobre inactiva.
        row = await conn.fetchrow(
            "SELECT id, estado, usuario_id, nombre, foto_url, bio FROM agent "
            "WHERE usuario_id = $1 ORDER BY (estado = 'activo') DESC, created_at ASC LIMIT 1",
            user.get("id"),
        )
    if not row:
        raise HTTPException(status_code=403, detail="El usuario no es un agente")
    if exigir_activo and row["estado"] != "activo":
        raise HTTPException(status_code=403, detail="agente_no_activo")
    return SimpleNamespace(**dict(row))


@router.get("/me")
async def perfil(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    agent = await _agent_del_usuario(user, pool, exigir_activo=False)
    async with pool.acquire() as conn:
        zonas = await conn.fetch(_ZONAS_SQL, agent.id)
    return {
        "id": str(agent.id),
        "nombre": agent.nombre,
        "avatar": agent.foto_url,
        "bio": agent.bio,
        "estado": str(agent.estado),
        "zonas_patrocinadas": [
            {"codigo": z["zona_codigo"], "nombre": z["nombre"],
             "nivel": z["nivel"], "tier": z["tier"]}
            for z in zonas
        ],
    }


class PerfilPatchRequest(BaseModel):
    bio: str | None = Field(default=None, max_length=2000)


@router.patch("/me")
async def editar_perfil(
    req: PerfilPatchRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Edita el perfil público del agente (por ahora solo bio)."""
    agent = await _agent_del_usuario(user, pool, exigir_activo=False)
    if req.bio is None:
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE agent SET bio = $2, updated_at = NOW() WHERE id = $1",
            agent.id, req.bio.strip() or None,
        )
    return {"id": str(agent.id), "bio": req.bio.strip() or None}


@router.post("/me/foto", status_code=201)
async def subir_foto_perfil(
    foto: UploadFile,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Sube la foto de perfil del agente a R2 y la fija en agent.foto_url."""
    agent = await _agent_del_usuario(user, pool, exigir_activo=False)
    if not (foto.filename and foto.size):
        raise HTTPException(status_code=400, detail="Foto inválida")
    url = await upload_file(await read_upload_bounded(foto), foto.filename, folder="agentes")
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE agent SET foto_url = $2, updated_at = NOW() WHERE id = $1",
            agent.id, url,
        )
    return {"id": str(agent.id), "foto_url": url}


@router.get("/asignados")
async def asignados(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    agent = await _agent_del_usuario(user, pool)
    await sweep_asignados_vencidos(pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT i.id::text AS id, i.estado::text AS estado,
                   i.tipo_inmueble::text AS tipo_inmueble, i.operacion::text AS operacion,
                   i.precio_esperado, i.area_m2, i.habitaciones, i.banos,
                   i.declaraciones, i.created_at,
                   COALESCE(i.barrio, b.nombre, '') AS barrio,
                   COALESCE(i.municipio, '')        AS municipio,
                   o.nombre AS owner_nombre,
                   l.id::text AS l_id, l.estado::text AS l_estado,
                   l.tipo_inmueble::text AS l_tipo, l.operacion::text AS l_op,
                   l.precio AS l_precio, l.municipio AS l_municipio, l.barrio AS l_barrio,
                   (l.geom IS NOT NULL) AS l_geom_set, l.area_m2 AS l_area,
                   l.titulo AS l_titulo, l.habitaciones AS l_hab, l.banos AS l_banos,
                   (SELECT COUNT(*) FROM listing_media m
                     WHERE m.listing_id = l.id AND m.es_portada) AS l_fotos_portada
            FROM intake i
            JOIN owner o ON o.id = i.owner_id
            LEFT JOIN listing l ON l.id = i.listing_id
            LEFT JOIN raw.barrios b ON b.id::text = i.zona_codigo
            WHERE i.agent_id = $1
              AND (i.estado IN ('asignado', 'en_verificacion')
                   OR (i.estado = 'aceptado'
                       AND (l.estado IS NULL OR l.estado IN ('borrador', 'rechazado')
                            OR l.verificado = FALSE)))
            ORDER BY i.created_at DESC
            """,
            agent.id,
        )
        dd_rows = await conn.fetch(
            """
            SELECT intake_id::text AS intake_id,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes,
                   COALESCE(ARRAY_AGG(clave) FILTER (WHERE estado = 'pendiente'), '{}') AS faltantes
            FROM due_diligence_item
            WHERE intake_id = ANY($1::uuid[])
            GROUP BY intake_id
            """,
            [r["id"] for r in rows],
        )
    dd = {r["intake_id"]: r for r in dd_rows}

    out = []
    for r in rows:
        decl = r["declaraciones"] or {}
        if isinstance(decl, str):
            import json
            decl = json.loads(decl)
        d = dd.get(r["id"])
        out.append({
            "id": r["id"],
            "estado": r["estado"],
            "tipo_inmueble": r["tipo_inmueble"],
            "operacion": r["operacion"],
            "precio_esperado": float(r["precio_esperado"] or 0),
            "barrio": r["barrio"],
            "municipio": r["municipio"],
            "owner_nombre": r["owner_nombre"],
            "declarado": {
                "area_m2": float(r["area_m2"]) if r["area_m2"] is not None else None,
                "habitaciones": r["habitaciones"],
                "banos": r["banos"],
                **{k: decl.get(k) for k in _DECL_KEYS},
            },
            "due_diligence": {
                "documentos_completos": bool(d and d["total"] > 0 and d["pendientes"] == 0),
                "faltantes": list(d["faltantes"]) if d else [],
            },
            "listing": {
                "id": r["l_id"],
                "tipo_inmueble": r["l_tipo"],
                "operacion": r["l_op"],
                "precio": float(r["l_precio"]) if r["l_precio"] is not None else None,
                "municipio": r["l_municipio"],
                "barrio": r["l_barrio"],
                "geom_set": bool(r["l_geom_set"]),
                "area_m2": float(r["l_area"]) if r["l_area"] is not None else None,
                "titulo": r["l_titulo"],
                "habitaciones": r["l_hab"],
                "banos": r["l_banos"],
                "fotos_portada": int(r["l_fotos_portada"] or 0),
            } if r["l_id"] else None,
            "created_at": r["created_at"].isoformat(),
        })
    return out


@router.get("/pool")
async def pool_abierto(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    await _agent_del_usuario(user, pool)
    await sweep_asignados_vencidos(pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT i.id::text AS id, i.tipo_inmueble::text AS tipo_inmueble,
                   i.operacion::text AS operacion, i.precio_esperado,
                   COALESCE(i.barrio, b.nombre, '') AS barrio,
                   COALESCE(i.municipio, '') AS municipio, i.created_at
            FROM intake i
            LEFT JOIN raw.barrios b ON b.id::text = i.zona_codigo
            WHERE i.estado = 'en_pool'
            ORDER BY i.created_at ASC
            """
        )
    return [
        {**dict(r), "precio_esperado": float(r["precio_esperado"] or 0),
         "created_at": r["created_at"].isoformat()}
        for r in rows
    ]


@router.post("/pool/{intake_id}/tomar")
async def tomar(intake_id: str, user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    agent = await _agent_del_usuario(user, pool)
    try:
        return await tomar_del_pool(intake_id, agent, pool)
    except AsignadorError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/listings")
async def mis_listings(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT l.id::text AS id, COALESCE(l.titulo, '(sin título)') AS titulo,
                   l.tipo_inmueble::text AS tipo_inmueble, l.operacion::text AS operacion,
                   l.precio, COALESCE(l.barrio, '') AS barrio, l.estado::text AS estado,
                   l.updated_at,
                   COALESCE(v.total, 0) AS vistas_total, COALESCE(v.v30, 0) AS vistas_30d
            FROM listing l
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE e.created_at > NOW() - INTERVAL '30 days') AS v30
                FROM public.user_events e
                WHERE {_VISTAS_JOIN}
            ) v ON TRUE
            WHERE l.agent_id = $1
            ORDER BY l.updated_at DESC
            """,
            agent.id,
        )
    return [
        {**dict(r), "precio": float(r["precio"] or 0),
         "updated_at": r["updated_at"].isoformat()}
        for r in rows
    ]


class ListingPatchRequest(BaseModel):
    titulo: str | None = None
    descripcion: str | None = None
    precio: float | None = None
    area_m2: float | None = None
    habitaciones: int | None = None
    banos: int | None = None
    direccion_aprox: str | None = None
    # Ficha completa (reclamar/editar todo): ubicación + resto de campos
    lat: float | None = None
    lon: float | None = None
    tipo_inmueble: str | None = None
    estrato: int | None = None
    parqueaderos: int | None = None
    antiguedad_anios: int | None = None
    nombre_edificio: str | None = None
    administracion: float | None = None
    amenidades: list[str] | None = None


@router.patch("/listings/{listing_id}")
async def editar_listing(
    listing_id: str,
    req: ListingPatchRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Edita la ficha de un listing propio (campos básicos + ubicación, no el estado)."""
    agent = await _agent_del_usuario(user, pool)
    data = req.model_dump()
    # Ubicación va aparte: 'listing' guarda geom (Point), no columnas lat/lon.
    lat = data.pop("lat", None)
    lon = data.pop("lon", None)
    campos = {k: v for k, v in data.items() if v is not None}
    if "precio" in campos and campos["precio"] <= 0:
        raise HTTPException(status_code=400, detail="Precio inválido")

    set_parts = [f"{k} = ${i + 3}" for i, k in enumerate(campos)]
    valores = list(campos.values())
    if lat is not None and lon is not None:
        n = len(valores)
        set_parts.append(f"geom = ST_SetSRID(ST_MakePoint(${n + 3}, ${n + 4}), 4326)")
        valores.extend([lon, lat])  # MakePoint(x=lon, y=lat)
    if not set_parts:
        raise HTTPException(status_code=400, detail="Nada que actualizar")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"UPDATE listing SET {', '.join(set_parts)}, updated_at = NOW() "
            "WHERE id = $1 AND agent_id = $2 RETURNING id",
            listing_id, agent.id, *valores,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Listing no encontrado o no es tuyo")
    await ghl_client.sync_listing(listing_id)
    actualizado = sorted(campos) + (["ubicacion"] if lat is not None and lon is not None else [])
    return {"id": listing_id, "actualizado": actualizado}


class CerrarListingRequest(BaseModel):
    precio_cierre: float = Field(..., gt=0)
    fecha_cierre: date | None = None            # default: hoy (CURRENT_DATE)
    matricula_inmobiliaria: str | None = None   # llave ORIP — si no vino al publicar
    cedula_catastral: str | None = None         # llave catastro


@router.post("/listings/{listing_id}/cerrar")
async def cerrar_listing(
    listing_id: str,
    req: CerrarListingRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Marca un listing propio como vendido/cerrado y graba el evento de
    propiedad (precio de cierre + llaves ORIP/catastro) en el ledger durable
    `propiedad_evento`. El listing es efímero; el evento sobrevive a su muerte.

    Precio autoreportado por el realtor → queda verificado=false hasta cruzarlo
    con compraventas_orips (SNR). Reusa TRANSICIONES_VALIDAS: solo publicado o
    pausado pueden pasar a cerrado.
    """
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        async with conn.transaction():
            lst = await conn.fetchrow(
                "SELECT estado::text AS estado, matricula_inmobiliaria, cedula_catastral "
                "FROM listing WHERE id = $1 AND agent_id = $2 FOR UPDATE",
                listing_id, agent.id,
            )
            if not lst:
                raise HTTPException(status_code=404, detail="Listing no encontrado o no es tuyo")
            if "cerrado" not in TRANSICIONES_VALIDAS.get(lst["estado"], frozenset()):
                raise HTTPException(status_code=409, detail=f"No se puede cerrar desde '{lst['estado']}'")

            # llaves: las del request mandan; si no, las que ya tenía el listing
            matricula = (req.matricula_inmobiliaria or lst["matricula_inmobiliaria"] or "").strip() or None
            catastral = (req.cedula_catastral or lst["cedula_catastral"] or "").strip() or None
            # #11: matrícula obligatoria en cierres (llave del evento de propiedad durable).
            if not matricula:
                raise HTTPException(status_code=400, detail="La matrícula inmobiliaria es obligatoria para reportar el cierre")

            await conn.execute(
                "UPDATE listing SET estado = 'cerrado', "
                "matricula_inmobiliaria = COALESCE($2, matricula_inmobiliaria), "
                "cedula_catastral = COALESCE($3, cedula_catastral), "
                "updated_at = NOW() WHERE id = $1",
                listing_id, matricula, catastral,
            )
            # #23 conversión real: atribuir la venta al lead que la originó — de las
            # visitas del agente sobre este listing, la que llegó a oferta (o la más
            # reciente). NULL si la venta no vino de un lead de la plataforma, para no
            # inflar la tasa con cierres off-platform.
            lead_id = await conn.fetchval(
                "SELECT id FROM visita_solicitud "
                "WHERE agent_id = $1 AND listing_url = $2 "
                "ORDER BY (resultado = 'oferta') DESC NULLS LAST, created_at DESC LIMIT 1",
                agent.id, listing_id,
            )
            await conn.execute(
                "INSERT INTO propiedad_evento "
                "(matricula_inmobiliaria, cedula_catastral, listing_id, tipo_evento, "
                " precio, fecha, agent_id, visita_solicitud_id) "
                "VALUES ($1, $2, $3, 'venta', $4, COALESCE($5, CURRENT_DATE), $6, $7)",
                matricula, catastral, listing_id, req.precio_cierre, req.fecha_cierre, agent.id, lead_id,
            )
    # Conversión (capa 5 del funnel): el cierre real. Best-effort y FUERA de la
    # transacción del cierre para no arriesgarlo. from_lead=True si la venta se
    # atribuyó a un lead de la plataforma (no infla la tasa con cierres off-platform).
    # Ver docs/FUNNEL_B2B.md.
    try:
        import json
        await pool.execute(
            """INSERT INTO public.user_events
                   (usuario_id, session_id, event_type, entity_type, entity_id, metadata)
               VALUES (NULL, $1, 'conversion', 'listing', $2, $3::jsonb)""",
            f"cerrar-{listing_id}",
            listing_id,
            json.dumps({"from_lead": lead_id is not None, "precio_cierre": req.precio_cierre}, default=str),
        )
    except Exception:
        log.warning("conversion event insert falló (listing=%s)", listing_id, exc_info=True)
    await ghl_client.sync_listing(listing_id)
    return {"id": listing_id, "estado": "cerrado", "precio_cierre": req.precio_cierre}


# Comparables de CIERRE: NO expone matrícula / dirección / agente / listing_id de
# otros — solo precio/fecha/zona/tipo/área/$m2. listing_id del ledger solo sirve
# para el JOIN de zona/tipo, no se devuelve.
# Dedup por matrícula (una propiedad = un cierre; si hay autoreportado + verificado
# de la misma, gana el verificado). Verificados primero: un cierre falso queda
# abajo y marcado "sin verificar" → no engaña a nadie y solo ensucia el bucket
# descartable. (SNR cross flipearía verificado=true cuando exista el dato.)
_COMPARABLES_SQL = """
    SELECT precio, fecha, verificado, moneda, area_m2, barrio, tipo_inmueble, operacion, precio_m2
    FROM (
        SELECT DISTINCT ON (pe.matricula_inmobiliaria)
               pe.precio, pe.fecha, pe.verificado, pe.moneda,
               l.area_m2, l.barrio, l.tipo_inmueble::text AS tipo_inmueble,
               l.operacion::text AS operacion,
               CASE WHEN l.area_m2 IS NOT NULL AND l.area_m2 > 0
                    THEN ROUND(pe.precio / l.area_m2) END AS precio_m2
        FROM public.propiedad_evento pe
        JOIN public.listing l ON l.id = pe.listing_id
        WHERE pe.tipo_evento = 'venta'
          AND pe.matricula_inmobiliaria IS NOT NULL
          AND pe.fecha > CURRENT_DATE - make_interval(months => $1)
          AND ($2::int  IS NULL OR l.barrio_id = $2)
          AND ($3::text IS NULL OR l.tipo_inmueble::text = $3)
          AND ($4::text IS NULL OR l.operacion::text = $4)
        ORDER BY pe.matricula_inmobiliaria, pe.verificado DESC, pe.fecha DESC
    ) d
    ORDER BY d.verificado DESC, d.fecha DESC
    LIMIT 50
"""


@router.get("/comparables")
async def comparables_cierre(
    barrio_id: int | None = Query(default=None),
    tipo_inmueble: str | None = Query(default=None),
    operacion: str | None = Query(default=None),
    meses: int = Query(default=12, ge=1, le=60),
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Comparables de precio de CIERRE (no de aviso) — el dato más valioso para
    tasar. Reciprocidad estilo MLS: solo los ve quien contribuye (reportó cierres).
    Ese gate ES el incentivo para teclear el cierre. NO expone matrícula/dirección/
    agente de otros (solo precio/fecha/zona/tipo/área/$m2)."""
    agent = await _agent_del_usuario(user, pool)
    # DISTINCT matrícula: reportar la misma matrícula N veces NO farmea el unlock
    # (una propiedad se vende una vez). Anti-abuso barato del gate autoreportado.
    cierres = int(await pool.fetchval(
        "SELECT count(DISTINCT matricula_inmobiliaria) FROM public.propiedad_evento "
        "WHERE agent_id = $1 AND tipo_evento = 'venta' "
        "AND matricula_inmobiliaria IS NOT NULL "
        "AND fecha > CURRENT_DATE - INTERVAL '12 months'",
        agent.id,
    ) or 0)
    if cierres < _COMPARABLES_MIN_CIERRES:
        return {
            "acceso": False,
            "cierres_reportados": cierres,
            "cierres_necesarios": _COMPARABLES_MIN_CIERRES,
            "motivo": (f"Reporta al menos {_COMPARABLES_MIN_CIERRES} cierre en los últimos 12 meses "
                       "para desbloquear los comparables de cierre. Contribuyes, accedes."),
            "comparables": [],
        }
    rows = await pool.fetch(_COMPARABLES_SQL, meses, barrio_id, tipo_inmueble, operacion)
    n_verif = sum(1 for r in rows if r["verificado"])
    return {
        "acceso": True,
        "cierres_reportados": cierres,
        "verificados": n_verif,
        "autoreportados": len(rows) - n_verif,
        "comparables": [
            {
                "precio": float(r["precio"]) if r["precio"] is not None else None,
                "precio_m2": int(r["precio_m2"]) if r["precio_m2"] is not None else None,
                "moneda": r["moneda"],
                "fecha": r["fecha"].isoformat(),
                "area_m2": float(r["area_m2"]) if r["area_m2"] is not None else None,
                "barrio": r["barrio"],
                "tipo_inmueble": r["tipo_inmueble"],
                "operacion": r["operacion"],
                "verificado": r["verificado"],
            }
            for r in rows
        ],
    }


@router.post("/listings/{listing_id}/fotos", status_code=201)
async def subir_fotos(
    listing_id: str,
    fotos: list[UploadFile],
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Sube fotos del listing a R2. La primera foto del listing queda de portada."""
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        own = await conn.fetchval(
            "SELECT 1 FROM listing WHERE id = $1 AND agent_id = $2", listing_id, agent.id
        )
        if not own:
            raise HTTPException(status_code=404, detail="Listing no encontrado o no es tuyo")
        existentes = await conn.fetchval(
            "SELECT COUNT(*) FROM listing_media WHERE listing_id = $1", listing_id
        )
        urls = []
        for i, f in enumerate(fotos):
            if not (f.filename and f.size):
                continue
            url = await upload_file(await read_upload_bounded(f), f.filename, folder="listings")
            await conn.execute(
                "INSERT INTO listing_media (listing_id, url, orden, es_portada) "
                "VALUES ($1, $2, $3, $4)",
                listing_id, url, existentes + i, existentes + i == 0,
            )
            urls.append(url)
    if not urls:
        raise HTTPException(status_code=400, detail="Ninguna foto válida")
    return {"id": listing_id, "fotos": urls}


@router.post("/asignados/{intake_id}/publicar")
async def publicar(intake_id: str, user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Manda el borrador del listing asignado a revisión (borrador → en_revision)."""
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT i.agent_id, i.listing_id, l.estado::text AS l_estado,
                   l.tipo_inmueble::text AS tipo_inmueble, l.operacion::text AS operacion,
                   l.precio, (l.geom IS NOT NULL) AS geom, l.barrio, l.municipio,
                   l.area_m2, l.titulo, l.habitaciones, l.banos,
                   (SELECT COUNT(*) FROM listing_media m
                     WHERE m.listing_id = l.id AND m.es_portada) AS fotos_portada
            FROM intake i LEFT JOIN listing l ON l.id = i.listing_id WHERE i.id = $1
            """,
            intake_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Intake no encontrado")
        if row["agent_id"] != agent.id:
            raise HTTPException(status_code=403, detail="Solo el realtor asignado puede publicar")
        if not row["listing_id"]:
            raise HTTPException(status_code=409, detail="El intake no tiene listing (acéptalo primero)")
        if row["l_estado"] not in ("borrador", "rechazado"):
            raise HTTPException(status_code=409, detail=f"El listing está en estado '{row['l_estado']}'")
        # Guardia server-side: ningún listing incompleto pasa a revisión aunque
        # el request salte el front (espejo de datosMinimosCompletos).
        chk = datos_minimos_completos(SimpleNamespace(**dict(row)))
        if not chk["ok"]:
            raise HTTPException(status_code=409, detail="Faltan datos mínimos: " + ", ".join(chk["faltan"]))
        await conn.execute(
            "UPDATE listing SET estado = 'en_revision', updated_at = NOW() WHERE id = $1",
            row["listing_id"],
        )
    await ghl_client.sync_listing(str(row["listing_id"]))
    return {"listing_id": str(row["listing_id"]), "estado": "en_revision"}


def _grado_servicio(med_horas: float | None) -> tuple[str, str]:
    """Grado de servicio por velocidad de respuesta a visitas (Zillow paso 3:
    lead frío vale nada). El número ya se medía (métrica muerta); esto le da
    standing visible al agente — el diente del SLA."""
    if med_horas is None:
        return ("—", "Aún sin visitas respondidas para calificarte")
    if med_horas <= 4:
        return ("A", "Respondes muy rápido — los leads llegan calientes")
    if med_horas <= 12:
        return ("B", "Respondes bien")
    if med_horas <= 24:
        return ("C", "Puedes responder más rápido")
    return ("D", "Respondes lento — los leads se enfrían antes de que llames")


def _componente_velocidad(resp_med: float | None) -> float:
    """0..100 por mediana de horas de respuesta. None (sin visitas respondidas) = 0."""
    if resp_med is None:
        return 0.0
    if resp_med <= 4:
        return 100.0
    if resp_med <= 12:
        return 75.0
    if resp_med <= 24:
        return 50.0
    return 25.0


def _puntaje_standing(row) -> int:
    """Puntaje 0..100 del agente a partir de sus 4 componentes. Pesos en
    _PUNTAJE_PESOS (decisión de producto). Solo se llama para agentes con
    actividad >= umbral — no se infla con ceros."""
    contrib = min(int(row["cierres"]), _CONTRIB_CAP) / _CONTRIB_CAP * 100.0
    vel = _componente_velocidad(float(row["resp_med"]) if row["resp_med"] is not None else None)
    show = float(row["show_rate"] or 0) * 100.0
    acep = float(row["aceptacion"] or 0) * 100.0
    p = (_PUNTAJE_PESOS["contribucion"] * contrib
         + _PUNTAJE_PESOS["velocidad"] * vel
         + _PUNTAJE_PESOS["show_rate"] * show
         + _PUNTAJE_PESOS["aceptacion"] * acep)
    return round(p)


# Componentes por agente activo (scope agent_id, comparable entre agentes).
# `actividad` = visitas respondidas 90d + intakes 90d + cierres 12m → umbral de
# "¿hay suficiente para rankear?". Pocos agentes → subqueries OK.
# ponytail: fan-out de subqueries sobre TODOS los agentes activos en cada
# /desempeno. Techo: a decenas de agentes sigue barato; materializar/cachear
# (tabla analytics o cache 5min) cuando sean cientos.
_STANDING_COMPONENTS_SQL = """
    SELECT a.id::text AS agent_id,
      (SELECT count(DISTINCT pe.matricula_inmobiliaria) FROM public.propiedad_evento pe
         WHERE pe.agent_id = a.id AND pe.tipo_evento = 'venta'
           AND pe.matricula_inmobiliaria IS NOT NULL
           AND pe.fecha > CURRENT_DATE - INTERVAL '12 months')                       AS cierres,
      (SELECT percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (v.updated_at - v.created_at)) / 3600.0)
         FROM public.visita_solicitud v
         WHERE v.agent_id = a.id AND v.estado <> 'pendiente'
           AND v.created_at > NOW() - INTERVAL '90 days')                            AS resp_med,
      (SELECT count(*) FILTER (WHERE v.estado = 'realizada')::numeric
              / NULLIF(count(*) FILTER (WHERE v.estado IN ('realizada','no_asistio')), 0)
         FROM public.visita_solicitud v
         WHERE v.agent_id = a.id AND v.created_at > NOW() - INTERVAL '90 days')       AS show_rate,
      (SELECT count(*) FILTER (WHERE estado IN ('en_verificacion','aceptado') OR listing_id IS NOT NULL)::numeric
              / NULLIF(count(*), 0)
         FROM public.intake WHERE agent_id = a.id
           AND created_at > NOW() - INTERVAL '90 days')                              AS aceptacion,
      (SELECT count(*) FROM public.visita_solicitud v WHERE v.agent_id = a.id
           AND v.estado <> 'pendiente' AND v.created_at > NOW() - INTERVAL '90 days')
      + (SELECT count(*) FROM public.intake WHERE agent_id = a.id
           AND created_at > NOW() - INTERVAL '90 days')
      + (SELECT count(DISTINCT pe.matricula_inmobiliaria) FROM public.propiedad_evento pe
           WHERE pe.agent_id = a.id AND pe.tipo_evento = 'venta'
             AND pe.matricula_inmobiliaria IS NOT NULL
             AND pe.fecha > CURRENT_DATE - INTERVAL '12 months')
                                                                                     AS actividad
    FROM public.agent a
    WHERE a.estado = 'activo'
"""


def _standing_de(rows, agent_id: str) -> dict:
    """Arma el bloque standing para `agent_id` a partir de los componentes de
    TODOS los agentes activos. Degrada honesto: sin actividad suficiente →
    puntaje/ranking None (no inventamos un 'puesto 3 de 8' sobre ceros)."""
    me = next((r for r in rows if r["agent_id"] == agent_id), None)
    cierres = int(me["cierres"]) if me else 0
    actividad = int(me["actividad"]) if me else 0
    if not me or actividad < _RANKING_MIN_ACTIVIDAD:
        return {
            "puntaje": None,
            "cierres_reportados_12m": cierres,
            "ranking": None,
            "nota": "Datos insuficientes para tu puntaje y ranking — trabaja leads y reporta cierres.",
        }
    puntaje = _puntaje_standing(me)
    qualifying = [r for r in rows if int(r["actividad"]) >= _RANKING_MIN_ACTIVIDAD]
    ranking = None
    if len(qualifying) >= 2:
        ranked = sorted(qualifying, key=_puntaje_standing, reverse=True)
        posicion = next(i for i, r in enumerate(ranked, 1) if r["agent_id"] == agent_id)
        ranking = {"posicion": posicion, "total": len(ranked)}
    return {
        "puntaje": puntaje,
        "cierres_reportados_12m": cierres,
        "ranking": ranking,
        "nota": "Reportar cierres y responder rápido sube tu puntaje.",
    }


@router.get("/desempeno")
async def desempeno(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Métricas estilo Zillow (tasa de aceptación, velocidad) + ROI por zona patrocinada."""
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        resp = await conn.fetchrow(
            """
            SELECT COUNT(*) AS asignados,
                   COUNT(*) FILTER (WHERE estado IN ('en_verificacion', 'aceptado')
                                    OR listing_id IS NOT NULL) AS aceptados,
                   -- ponytail: updated_at como proxy de fecha de aceptación;
                   -- columna accepted_at si se necesita precisión
                   percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600.0
                   ) FILTER (WHERE estado = 'aceptado') AS mediana_horas
            FROM intake
            WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '90 days'
            """,
            agent.id,
        )
        vistas = await conn.fetchrow(
            f"""
            SELECT COUNT(*) FILTER (WHERE e.created_at > NOW() - INTERVAL '30 days') AS v30,
                   COUNT(*) AS total
            FROM public.user_events e
            JOIN listing l ON {_VISTAS_JOIN}
            WHERE l.agent_id = $1
            """,
            agent.id,
        )
        # CRM nivel 1: show rate y desenlaces, últimos 90 días
        visitas_stats = await conn.fetchrow(
            _MIS_URLS_CTE + """
            SELECT COUNT(*) FILTER (WHERE v.estado = 'realizada')  AS realizadas,
                   COUNT(*) FILTER (WHERE v.estado = 'no_asistio') AS no_shows,
                   COUNT(*) FILTER (WHERE v.resultado = 'oferta')     AS ofertas,
                   COUNT(*) FILTER (WHERE v.resultado = 'interesado') AS interesados,
                   -- Diente SLA (paso 3): mediana de horas en responder la visita.
                   -- Mismo scope que show_rate (mis_urls = listings propios); las
                   -- visitas de zona patrocinada no entran aquí, igual que show_rate.
                   -- ponytail: updated_at como proxy de 1ra respuesta (no hay
                   -- responded_at); sobreestima si la visita cambió de estado >1 vez.
                   percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (v.updated_at - v.created_at)) / 3600.0
                   ) FILTER (WHERE v.estado <> 'pendiente') AS mediana_resp_horas
            FROM visita_solicitud v
            JOIN mis_urls m ON m.url = v.listing_url
            WHERE v.created_at > NOW() - INTERVAL '90 days'
            """,
            agent.id, user.get("id"),
        )
        # Standing/ranking (incentivo): componentes de TODOS los agentes activos,
        # puntaje+ranking se arma en Python (pesos en _PUNTAJE_PESOS).
        standing_rows = await conn.fetch(_STANDING_COMPONENTS_SQL)
        zonas = await conn.fetch(_ZONAS_SQL, agent.id)

        roi = []
        for z in zonas:
            # intake.zona_codigo siempre es barrio_id::text; una zona comuna
            # agrega todos los barrios que la componen
            if z["nivel"] == "comuna":
                codigos = [
                    r["id"] for r in await conn.fetch(
                        "SELECT id::text AS id FROM raw.barrios WHERE comuna = $1",
                        z["zona_codigo"],
                    )
                ]
            elif z["nivel"] == "municipio":
                codigos = [
                    r["id"] for r in await conn.fetch(
                        "SELECT id::text AS id FROM raw.barrios WHERE UPPER(municipio) = UPPER($1)",
                        z["zona_codigo"],
                    )
                ]
            else:
                codigos = [z["zona_codigo"]]

            mes = await conn.fetchrow(
                """
                SELECT COUNT(*) AS intakes_mes,
                       COUNT(*) FILTER (WHERE agent_id = $2) AS tomados_mes
                FROM intake
                WHERE zona_codigo = ANY($1) AND created_at >= date_trunc('month', NOW())
                """,
                codigos, agent.id,
            )
            estados = await conn.fetchrow(
                """
                SELECT COUNT(*) FILTER (WHERE l.estado = 'publicado') AS publicados,
                       COUNT(*) FILTER (WHERE l.estado = 'cerrado')   AS cerrados
                FROM intake i JOIN listing l ON l.id = i.listing_id
                WHERE i.zona_codigo = ANY($1) AND i.agent_id = $2
                """,
                codigos, agent.id,
            )
            vistas_zona = await conn.fetchval(
                f"""
                SELECT COUNT(*)
                FROM public.user_events e
                JOIN listing l ON {_VISTAS_JOIN}
                JOIN intake i ON i.listing_id = l.id
                WHERE i.zona_codigo = ANY($1) AND l.agent_id = $2
                  AND e.created_at > NOW() - INTERVAL '30 days'
                """,
                codigos, agent.id,
            )
            precio = float(z["precio_mensual"] or 0)
            n = int(mes["intakes_mes"])
            roi.append({
                "zona_codigo": z["zona_codigo"],
                "zona_nombre": z["nombre"],
                "nivel": z["nivel"],
                "tier": z["tier"],
                "precio_mensual": precio,
                "intakes_mes": n,
                "tomados_mes": int(mes["tomados_mes"]),
                "publicados_total": int(estados["publicados"]),
                "cerrados_total": int(estados["cerrados"]),
                "costo_por_intake": round(precio / n) if n > 0 and precio > 0 else None,
                "vistas_30d": int(vistas_zona or 0),
            })

    asignados_n = int(resp["asignados"])
    aceptados_n = int(resp["aceptados"])
    mi_med = float(visitas_stats["mediana_resp_horas"]) if visitas_stats["mediana_resp_horas"] is not None else None
    grado, grado_nota = _grado_servicio(mi_med)
    return {
        "asignados_90d": asignados_n,
        "aceptados_90d": aceptados_n,
        "tasa_aceptacion": round(aceptados_n / asignados_n, 3) if asignados_n else None,
        "mediana_horas_aceptar": round(float(resp["mediana_horas"]), 1)
            if resp["mediana_horas"] is not None else None,
        "calificacion_servicio": {
            "grado": grado,
            "nota": grado_nota,
            "mediana_horas_respuesta": round(mi_med, 1) if mi_med is not None else None,
            # Leaderboard cross-agente diferido: hoy ningún agente tiene volumen de
            # visitas respondidas con key compartida (agent_id NULL en scrapeados).
            # El grado ya es el standing visible; el ranking se activa con volumen.
            "ranking": None,
        },
        "vistas_30d": int(vistas["v30"]),
        "vistas_total": int(vistas["total"]),
        "visitas_realizadas_90d": int(visitas_stats["realizadas"]),
        "visitas_no_show_90d": int(visitas_stats["no_shows"]),
        "show_rate": round(
            int(visitas_stats["realizadas"]) / (int(visitas_stats["realizadas"]) + int(visitas_stats["no_shows"])), 3
        ) if (int(visitas_stats["realizadas"]) + int(visitas_stats["no_shows"])) > 0 else None,
        "ofertas_90d": int(visitas_stats["ofertas"]),
        "interesados_90d": int(visitas_stats["interesados"]),
        "standing": _standing_de(standing_rows, str(agent.id)),
        "zonas": roi,
    }


# ── Embudo de demanda por zona patrocinada (vistas→detalle→favoritos→visitas) ──
# Mismo cálculo que el modelo dbt analytics.embudo_zona pero INLINE (no depende de que
# la vista exista en el env) y acotado a las zonas que patrocina el realtor.
class EmbudoZonaItem(BaseModel):
    zona_codigo: str
    zona_nombre: str
    nivel: str
    vistas_mapa: int
    aperturas_detalle: int
    favoritos: int
    visitas: int


class EmbudoResponse(BaseModel):
    vistas_mapa: int
    aperturas_detalle: int
    favoritos: int
    visitas: int
    zonas: list[EmbudoZonaItem]


_EMBUDO_SQL = (
    "WITH zonas AS (" + _ZONAS_SQL + "),\n"
    """
    zona_barrios AS (
        SELECT z.zona_codigo, z.nombre, z.nivel, b.id AS barrio_id
        FROM zonas z JOIN raw.barrios b ON z.nivel = 'barrio' AND b.id::text = z.zona_codigo
        UNION
        SELECT z.zona_codigo, z.nombre, z.nivel, bc.barrio_id
        FROM zonas z JOIN analytics.barrios_cd bc ON z.nivel = 'comuna' AND bc.cd_comuna::text = z.zona_codigo
    ),
    ev AS (
        SELECT COALESCE(e.barrio_id, sl.barrio_id) AS barrio_id, e.event_type
        FROM public.user_events e
        LEFT JOIN staging.stg_listings_unificado sl ON sl.url = e.entity_id
        WHERE e.created_at > now() - interval '30 days'
          AND e.event_type IN ('listing_preview', 'listing_view')
    ),
    ev_agg AS (
        SELECT barrio_id,
               count(*) FILTER (WHERE event_type = 'listing_preview') AS vistas_mapa,
               count(*) FILTER (WHERE event_type = 'listing_view')    AS aperturas_detalle
        FROM ev WHERE barrio_id IS NOT NULL GROUP BY barrio_id
    ),
    fav AS (
        SELECT barrio_id, count(*) n FROM raw.favoritos_listings
        WHERE created_at > now() - interval '30 days' AND barrio_id IS NOT NULL GROUP BY barrio_id
    ),
    vis AS (
        SELECT sl.barrio_id, count(*) n
        FROM public.visita_solicitud v
        JOIN staging.stg_listings_unificado sl ON sl.url = v.listing_url
        WHERE v.created_at > now() - interval '30 days' AND sl.barrio_id IS NOT NULL GROUP BY sl.barrio_id
    )
    SELECT zb.zona_codigo, zb.nombre AS zona_nombre, zb.nivel,
           COALESCE(SUM(ea.vistas_mapa), 0)::int       AS vistas_mapa,
           COALESCE(SUM(ea.aperturas_detalle), 0)::int AS aperturas_detalle,
           COALESCE(SUM(f.n), 0)::int                  AS favoritos,
           COALESCE(SUM(vv.n), 0)::int                 AS visitas
    FROM zona_barrios zb
    LEFT JOIN ev_agg ea ON ea.barrio_id = zb.barrio_id
    LEFT JOIN fav    f  ON f.barrio_id  = zb.barrio_id
    LEFT JOIN vis    vv ON vv.barrio_id = zb.barrio_id
    GROUP BY zb.zona_codigo, zb.nombre, zb.nivel
    ORDER BY vistas_mapa DESC
    """
)


@router.get("/embudo", response_model=EmbudoResponse)
async def embudo(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Embudo de demanda (30d) de las zonas que patrocina el realtor:
    vistas en mapa → aperturas de detalle → favoritos → visitas agendadas."""
    agent = await _agent_del_usuario(user, pool, exigir_activo=False)
    rows = await pool.fetch(_EMBUDO_SQL, agent.id)
    zonas = [EmbudoZonaItem(**dict(r)) for r in rows]
    return EmbudoResponse(
        vistas_mapa=sum(z.vistas_mapa for z in zonas),
        aperturas_detalle=sum(z.aperturas_detalle for z in zonas),
        favoritos=sum(z.favoritos for z in zonas),
        visitas=sum(z.visitas for z in zonas),
        zonas=zonas,
    )


# urls que identifican los listings del agente en user_events/favoritos/visitas:
# listing nuevo → id::text y slug; listings_propios (portal viejo, mismo usuario) → id::text
_MIS_URLS_CTE = """
    WITH mis_urls AS (
        SELECT l.id::text AS url, COALESCE(l.titulo, initcap(l.tipo_inmueble::text) || ' en ' || COALESCE(l.barrio, l.municipio, '')) AS titulo
        FROM listing l WHERE l.agent_id = $1
        UNION ALL
        SELECT l.slug, COALESCE(l.titulo, initcap(l.tipo_inmueble::text) || ' en ' || COALESCE(l.barrio, l.municipio, ''))
        FROM listing l WHERE l.agent_id = $1
        UNION ALL
        SELECT lp.id::text, initcap(lp.tipo_inmueble) || ' en ' || COALESCE(b.nombre, '')
        FROM public.listings_propios lp
        JOIN public.agentes ag ON ag.id = lp.agente_id
        LEFT JOIN raw.barrios b ON b.id = lp.barrio_id
        WHERE ag.usuario_id = $2
    )
"""


@router.get("/agenda")
async def agenda(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    """Panel de agenda: solicitudes de visita + usuarios interesados (favoritos)."""
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        # Una visita llega al realtor si (a) es de un listing propio, o (b) es de
        # un listing scrapeado en una zona (barrio/comuna) que su agencia patrocina.
        visitas = await conn.fetch(
            _MIS_URLS_CTE + """
            SELECT v.id::text AS id, v.listing_url,
                   COALESCE(m.titulo,
                            initcap(s.tipo_inmueble::text) || ' en ' || COALESCE(b.nombre, s.barrio_raw, 'la zona')
                   ) AS listing_titulo,
                   COALESCE(v.nombre, u.nombre, 'Visitante') AS nombre,
                   v.telefono, u.email,
                   v.fecha_visita, v.mensaje, v.estado, v.resultado, v.created_at,
                   -- Calificación del lead (Zillow paso 2): el agente ve con quién habla.
                   v.intencion, v.presupuesto, v.plazo, v.credito,
                   (v.presupuesto IS NOT NULL OR v.plazo IS NOT NULL
                    OR v.credito IS NOT NULL OR v.intencion IS NOT NULL) AS calificado,
                   -- Horas que lleva pendiente (para SLA). NULL si ya respondida.
                   CASE WHEN v.estado = 'pendiente'
                        THEN ROUND(EXTRACT(EPOCH FROM (NOW() - v.created_at)) / 3600.0)::int
                        ELSE NULL END AS horas_pendiente,
                   -- Lead de visibilidad pagada (agente premium u owner Pro) → hot lead.
                   (COALESCE(s.tier = 'agente_premium', false)
                    OR EXISTS (SELECT 1 FROM public.listing lo
                               JOIN public.owner ow2 ON ow2.id = lo.owner_id
                               JOIN public.usuarios ow ON ow.id = ow2.usuario_id
                               WHERE lo.id::text = v.listing_url
                                 AND ow.plan IN ('pro', 'agente'))
                   ) AS es_pro
            FROM visita_solicitud v
            LEFT JOIN mis_urls m ON m.url = v.listing_url
            LEFT JOIN staging.stg_listings_unificado s ON s.url = v.listing_url
            LEFT JOIN raw.barrios b ON b.id = s.barrio_id
            LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = s.barrio_id
            LEFT JOIN public.usuarios u ON u.id = v.usuario_id
            WHERE m.url IS NOT NULL
               OR EXISTS (
                    SELECT 1 FROM sponsorship sp
                    JOIN agency_member am ON am.agency_id = sp.agency_id AND am.agent_id = $1
                    WHERE sp.estado = 'activa' AND CURRENT_DATE BETWEEN sp.fecha_inicio AND sp.fecha_fin
                      AND ((sp.zona_nivel = 'barrio' AND sp.zona_codigo = s.barrio_id::text)
                        OR (sp.zona_nivel = 'comuna' AND sp.zona_codigo = bc.cd_comuna::text))
               )
            ORDER BY CASE v.estado WHEN 'pendiente' THEN 0 WHEN 'confirmada' THEN 1 ELSE 2 END,
                     es_pro DESC,
                     calificado DESC,
                     v.fecha_visita ASC NULLS LAST, v.created_at DESC
            LIMIT 100
            """,
            agent.id, user.get("id"),
        )
        interesados = await conn.fetch(
            _MIS_URLS_CTE + """
            SELECT u.nombre, u.email, f.created_at, m.titulo AS listing_titulo
            FROM public.favoritos f
            JOIN mis_urls m ON m.url = f.listing_uid
            JOIN public.usuarios u ON u.id = f.usuario_id
            ORDER BY f.created_at DESC
            LIMIT 50
            """,
            agent.id, user.get("id"),
        )
    return {
        "visitas": [
            {**dict(v),
             "fecha_visita": v["fecha_visita"].isoformat() if v["fecha_visita"] else None,
             "created_at": v["created_at"].isoformat()}
            for v in visitas
        ],
        "interesados": [
            {**dict(i), "created_at": i["created_at"].isoformat()}
            for i in interesados
        ],
    }


class EstadoVisitaRequest(BaseModel):
    estado: str  # 'confirmada' | 'realizada' | 'cancelada' | 'no_asistio'
    resultado: str | None = None  # 'interesado' | 'oferta' | 'descartado' (solo con realizada)


@router.patch("/visitas/{visita_id}")
async def actualizar_visita(
    visita_id: str,
    req: EstadoVisitaRequest,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    if req.estado not in ("confirmada", "realizada", "cancelada", "no_asistio"):
        raise HTTPException(status_code=400, detail="Estado inválido")
    if req.resultado is not None:
        if req.resultado not in ("interesado", "oferta", "descartado"):
            raise HTTPException(status_code=400, detail="Resultado inválido")
        if req.estado != "realizada":
            raise HTTPException(status_code=400, detail="El resultado solo aplica a visitas realizadas")
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            _MIS_URLS_CTE + """
            UPDATE visita_solicitud v SET estado = $3, resultado = COALESCE($5, v.resultado), updated_at = NOW()
            WHERE v.id = $4 AND (
                v.listing_url IN (SELECT url FROM mis_urls)
                OR EXISTS (
                    SELECT 1
                    FROM staging.stg_listings_unificado s
                    LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = s.barrio_id
                    JOIN sponsorship sp ON sp.estado = 'activa'
                         AND CURRENT_DATE BETWEEN sp.fecha_inicio AND sp.fecha_fin
                         AND ((sp.zona_nivel = 'barrio' AND sp.zona_codigo = s.barrio_id::text)
                           OR (sp.zona_nivel = 'comuna' AND sp.zona_codigo = bc.cd_comuna::text))
                    JOIN agency_member am ON am.agency_id = sp.agency_id AND am.agent_id = $1
                    WHERE s.url = v.listing_url
                )
            )
            RETURNING v.id
            """,
            agent.id, user.get("id"), req.estado, visita_id, req.resultado,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Visita no encontrada o no es tuya")
    return {"id": visita_id, "estado": req.estado, "resultado": req.resultado}


# zona_codigo llega en 2 namespaces que colisionan si se adivinan por string:
# barrio_id (patrocinio barrio, $200/mes) y cd_comuna (patrocinio comuna,
# tier principal $1k/mes — ambos son enteros pequeños, ej. "11" es a la vez
# un barrio_id real y el cd_comuna de El Poblado). `nivel` (de
# ZonaPatrocinada/sponsorship) desambigua cuál es. Para comuna no hay una
# fila de barrio única: se usa como representativa la que tenga más datos
# de mercado (bm.precio_venta_m2_p50 poblado).
_ZONA_A_BARRIO_SQL = """
    SELECT b.id
    FROM raw.barrios b
    LEFT JOIN analytics.barrios_cd     bc ON bc.barrio_id = b.id
    LEFT JOIN analytics.barrios_mercado bm ON bm.barrio_id = b.id
    WHERE CASE WHEN $2 = 'comuna' THEN bc.cd_comuna::text = $1
               ELSE b.id::text = $1
                    OR LOWER(b.nombre) = LOWER(REPLACE($1, '-', ' '))
                    -- municipios fuera de Medellín: el listing suele guardar
                    -- "{municipio} {barrio}" (ej. "Envigado Centro" vs. barrio "CENTRO")
                    OR LOWER(b.municipio || ' ' || b.nombre) = LOWER(REPLACE($1, '-', ' '))
          END
    ORDER BY (bm.precio_venta_m2_p50 IS NOT NULL) DESC, b.nombre
    LIMIT 1
"""


@router.get("/inteligencia/{zona_codigo}", response_model=BarrioResponse)
async def inteligencia(
    zona_codigo: str,
    nivel: str | None = None,
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    """Inteligencia de mercado completa de la zona — solo realtors autenticados.

    Reusa la misma consulta que el panel público de barrios (_BARRIO_SQL):
    renta corta/media/larga, yield, seguridad, liquidez, conectividad,
    valorización, catastro — una sola fuente de verdad, sin duplicar campos.
    """
    await _agent_del_usuario(user, pool)
    barrio_id = await pool.fetchval(_ZONA_A_BARRIO_SQL, zona_codigo, nivel)
    if barrio_id is None:
        raise HTTPException(status_code=404, detail=f"Zona '{zona_codigo}' no encontrada")
    row = await pool.fetchrow(_BARRIO_SQL + " WHERE b.id = $1", barrio_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Zona '{zona_codigo}' no encontrada")
    return _build_response(dict(row), usd_rate=await get_usd_rate())


# ── Disponibilidad semanal del agente (para slots de visita, sin Google) ──────
class Franja(BaseModel):
    dia_semana: int = Field(ge=0, le=6)   # 0=lunes .. 6=domingo
    hora_inicio: str = Field(pattern=r"^\d{2}:\d{2}$")
    hora_fin: str = Field(pattern=r"^\d{2}:\d{2}$")


@router.get("/disponibilidad")
async def get_disponibilidad(user: dict = Depends(get_current_user), pool=Depends(get_pool)):
    agent = await _agent_del_usuario(user, pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT dia_semana, to_char(hora_inicio,'HH24:MI') AS hora_inicio, "
            "to_char(hora_fin,'HH24:MI') AS hora_fin FROM agent_disponibilidad "
            "WHERE agent_id = $1 ORDER BY dia_semana, hora_inicio",
            agent.id,
        )
    return [dict(r) for r in rows]


@router.put("/disponibilidad")
async def put_disponibilidad(
    franjas: list[Franja] = Body(...),
    user: dict = Depends(get_current_user),
    pool=Depends(get_pool),
):
    agent = await _agent_del_usuario(user, pool)
    for f in franjas:
        if f.hora_fin <= f.hora_inicio:
            raise HTTPException(400, f"Franja inválida (día {f.dia_semana}): fin debe ser > inicio")
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM agent_disponibilidad WHERE agent_id = $1", agent.id)
            for f in franjas:
                hi, mi = map(int, f.hora_inicio.split(":"))
                hf, mf = map(int, f.hora_fin.split(":"))
                await conn.execute(
                    "INSERT INTO agent_disponibilidad (agent_id, dia_semana, hora_inicio, hora_fin) "
                    "VALUES ($1, $2, $3, $4)",
                    agent.id, f.dia_semana, _time(hi, mi), _time(hf, mf),
                )
    return {"ok": True, "franjas": len(franjas)}
