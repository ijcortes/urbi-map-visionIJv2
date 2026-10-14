import os
from datetime import datetime, timezone
from typing import Optional

import bcrypt
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from api.db import get_pool
from api.dependencies import get_current_user
from api.limiter import limiter
from api.utils import ghl_client

router = APIRouter()

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL")
if not ADMIN_EMAIL:
    raise RuntimeError("ADMIN_EMAIL env var requerida")


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Admin = the seeded ADMIN_EMAIL account AND its email proven (email_verificado).

    Fails closed: ADMIN_EMAIL is mandatory at import, the row must already exist
    (get_current_user needs a real usuarios row), and /auth/register refuses
    ADMIN_EMAIL, so the row can only be created by proving inbox ownership
    (Google sign-in or magic link), which also sets email_verificado.
    """
    admin_email = (ADMIN_EMAIL or "").strip().lower()
    if (
        not admin_email
        or (user.get("email") or "").strip().lower() != admin_email
        or user.get("email_verificado") is not True
    ):
        raise HTTPException(status_code=403, detail="No autorizado")
    return user


# ── Seguridad: audit log (capa 2) + re-auth por password (capa 3) ─────────────
# Capa 1 es require_admin arriba. Rate limit (@limiter.limit, capa extra) va
# por endpoint mutante. admin_agentes.py y moderacion.py importan _audit y
# _verify_admin_password de aquí — mismo patrón que ya usan para require_admin.

async def _audit(pool, admin: dict, accion: str, entidad: str, entidad_id: str | None,
                  detalle: dict | None, request: Request) -> None:
    """Escribe una fila inmutable en admin_audit_log. Nunca bloquea la acción principal."""
    try:
        import json
        await pool.execute(
            """INSERT INTO admin_audit_log (admin_email, accion, entidad, entidad_id, detalle, ip)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            admin["email"], accion, entidad, entidad_id,
            json.dumps(detalle) if detalle is not None else None,
            request.client.host if request.client else None,
        )
    except Exception:
        pass  # el audit log nunca debe tumbar la acción que audita


async def _verify_admin_password(pool, admin: dict, password: str) -> None:
    """Re-auth: exige la contraseña del admin de nuevo antes de una acción crítica.

    403, no 401: el admin YA está autenticado, solo falló un paso extra. apiFetch
    (frontend) trata cualquier 401 como sesión expirada y desloguea — 401 aquí
    convertiría un typo de contraseña en un logout forzoso.
    """
    row = await pool.fetchrow("SELECT password_hash FROM usuarios WHERE id = $1", admin["id"])
    if not row or not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        raise HTTPException(status_code=403, detail="Contraseña incorrecta")


def _hace_cuanto(dt: datetime) -> str:
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    diff = now - dt
    seconds = int(diff.total_seconds())
    if seconds < 60:
        return "hace un momento"
    if seconds < 3600:
        m = seconds // 60
        return f"hace {m} minuto{'s' if m != 1 else ''}"
    if seconds < 86400:
        h = seconds // 3600
        return f"hace {h} hora{'s' if h != 1 else ''}"
    d = seconds // 86400
    return f"hace {d} día{'s' if d != 1 else ''}"


# ── Audit log (solo lectura, append-only) ─────────────────────────────────────

@router.get("/audit-log")
async def audit_log(
    limit: int = Query(100, ge=1, le=500),
    admin: dict = Depends(require_admin),
):
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT id, admin_email, accion, entidad, entidad_id, detalle, ip, created_at "
        "FROM admin_audit_log ORDER BY created_at DESC LIMIT $1",
        limit,
    )
    import json
    return {
        "entradas": [
            {
                "id": r["id"],
                "admin_email": r["admin_email"],
                "accion": r["accion"],
                "entidad": r["entidad"],
                "entidad_id": r["entidad_id"],
                "detalle": json.loads(r["detalle"]) if r["detalle"] else None,
                "ip": r["ip"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "hace_cuanto": _hace_cuanto(r["created_at"]) if r["created_at"] else "",
            }
            for r in rows
        ]
    }


# ── Endpoint 1: Dashboard ─────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(admin: dict = Depends(require_admin)):
    pool = get_pool()

    # Usuarios totals
    total_usuarios = await pool.fetchval("SELECT COUNT(*) FROM usuarios")
    activos_7 = await pool.fetchval(
        "SELECT COUNT(DISTINCT usuario_id) FROM historial WHERE created_at > NOW() - INTERVAL '7 days'"
    )
    activos_30 = await pool.fetchval(
        "SELECT COUNT(DISTINCT usuario_id) FROM historial WHERE created_at > NOW() - INTERVAL '30 days'"
    )
    nuevos_hoy = await pool.fetchval(
        "SELECT COUNT(*) FROM usuarios WHERE created_at > NOW() - INTERVAL '1 day'"
    )
    nuevos_7 = await pool.fetchval(
        "SELECT COUNT(*) FROM usuarios WHERE created_at > NOW() - INTERVAL '7 days'"
    )
    nuevos_30 = await pool.fetchval(
        "SELECT COUNT(*) FROM usuarios WHERE created_at > NOW() - INTERVAL '30 days'"
    )

    # Perfiles — objetivo
    objetivo_rows = await pool.fetch(
        "SELECT objetivo, COUNT(*) AS n FROM perfil_inversor WHERE objetivo IS NOT NULL GROUP BY objetivo"
    )
    por_objetivo = {"airbnb": 0, "nomadas": 0, "mediano_plazo": 0, "largo_plazo": 0, "mixto": 0}
    for r in objetivo_rows:
        k = r["objetivo"]
        if k in por_objetivo:
            por_objetivo[k] = int(r["n"])

    # Perfiles — riesgo (column may be perfil_riesgo OR riesgo depending on migration)
    try:
        riesgo_rows = await pool.fetch(
            "SELECT perfil_riesgo, COUNT(*) AS n FROM perfil_inversor WHERE perfil_riesgo IS NOT NULL GROUP BY perfil_riesgo"
        )
    except Exception:
        riesgo_rows = await pool.fetch(
            "SELECT riesgo AS perfil_riesgo, COUNT(*) AS n FROM perfil_inversor WHERE riesgo IS NOT NULL GROUP BY riesgo"
        )
    por_riesgo = {"conservador": 0, "moderado": 0, "agresivo": 0}
    for r in riesgo_rows:
        k = r["perfil_riesgo"]
        if k in por_riesgo:
            por_riesgo[k] = int(r["n"])

    # Perfiles — presupuesto
    try:
        pres_rows = await pool.fetch(
            """
            SELECT
                CASE
                    WHEN presupuesto_max_cop < 200000000 THEN 'menos_200M'
                    WHEN presupuesto_max_cop < 500000000 THEN '200M_500M'
                    WHEN presupuesto_max_cop < 1000000000 THEN '500M_1000M'
                    ELSE 'mas_1000M'
                END AS rango,
                COUNT(*) AS n
            FROM perfil_inversor
            WHERE presupuesto_max_cop IS NOT NULL
            GROUP BY rango
            """
        )
    except Exception:
        pres_rows = await pool.fetch(
            """
            SELECT
                CASE
                    WHEN presupuesto_max < 200000000 THEN 'menos_200M'
                    WHEN presupuesto_max < 500000000 THEN '200M_500M'
                    WHEN presupuesto_max < 1000000000 THEN '500M_1000M'
                    ELSE 'mas_1000M'
                END AS rango,
                COUNT(*) AS n
            FROM perfil_inversor
            WHERE presupuesto_max IS NOT NULL
            GROUP BY rango
            """
        )
    por_presupuesto = {"menos_200M": 0, "200M_500M": 0, "500M_1000M": 0, "mas_1000M": 0}
    for r in pres_rows:
        k = r["rango"]
        if k in por_presupuesto:
            por_presupuesto[k] = int(r["n"])

    # Comportamiento
    total_sims = await pool.fetchval("SELECT COUNT(*) FROM historial WHERE tipo = 'simulacion'") or 0
    total_comps = await pool.fetchval("SELECT COUNT(*) FROM historial WHERE tipo = 'comparacion'") or 0
    total_vistas = await pool.fetchval("SELECT COUNT(*) FROM historial WHERE tipo = 'vista_barrio'") or 0
    total_favs = await pool.fetchval("SELECT COUNT(*) FROM favoritos") or 0

    top_barrios_rows = await pool.fetch(
        """
        SELECT b.id AS barrio_id, b.nombre, b.municipio, COUNT(*) AS visitas
        FROM historial h
        JOIN raw.barrios b ON h.barrio_id = b.id
        WHERE h.tipo = 'vista_barrio'
        GROUP BY b.id, b.nombre, b.municipio
        ORDER BY visitas DESC
        LIMIT 10
        """
    )
    barrios_top10 = [
        {"barrio_id": r["barrio_id"], "nombre": r["nombre"],
         "municipio": r["municipio"], "visitas": int(r["visitas"])}
        for r in top_barrios_rows
    ]

    muni_rows = await pool.fetch(
        """
        SELECT b.municipio, COUNT(*) AS visitas
        FROM historial h
        JOIN raw.barrios b ON h.barrio_id = b.id
        WHERE h.tipo = 'vista_barrio'
        GROUP BY b.municipio
        ORDER BY visitas DESC
        LIMIT 5
        """
    )
    municipios_top5 = [{"municipio": r["municipio"], "visitas": int(r["visitas"])} for r in muni_rows]

    obj_top = await pool.fetchrow(
        "SELECT objetivo FROM perfil_inversor WHERE objetivo IS NOT NULL GROUP BY objetivo ORDER BY COUNT(*) DESC LIMIT 1"
    )
    objetivo_mas_comun = obj_top["objetivo"] if obj_top else None

    fav_top = await pool.fetchrow(
        """
        SELECT b.nombre
        FROM favoritos f
        JOIN raw.barrios b ON f.barrio_id = b.id
        GROUP BY b.nombre
        ORDER BY COUNT(*) DESC
        LIMIT 1
        """
    )
    barrio_mas_fav = fav_top["nombre"] if fav_top else None

    reg_rows = await pool.fetch(
        """
        SELECT DATE(created_at) AS fecha, COUNT(*) AS count
        FROM usuarios
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY fecha
        ORDER BY fecha
        """
    )
    registros_por_dia = [{"fecha": str(r["fecha"]), "count": int(r["count"])} for r in reg_rows]

    act_rows = await pool.fetch(
        """
        SELECT DATE(created_at) AS fecha, COUNT(*) AS acciones
        FROM historial
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY fecha
        ORDER BY fecha
        """
    )
    actividad_por_dia = [{"fecha": str(r["fecha"]), "acciones": int(r["acciones"])} for r in act_rows]

    # Negocio: realtors, listings, suscripciones.
    ag_rows = await pool.fetch("SELECT estado::text AS e, COUNT(*) AS n FROM agent GROUP BY estado")
    realtors = {"pendiente": 0, "activo": 0, "rechazado": 0, "inactivo": 0}
    for r in ag_rows:
        realtors[r["e"]] = int(r["n"])
    lst_rows = await pool.fetch("SELECT estado::text AS e, COUNT(*) AS n FROM listing GROUP BY estado")
    listings = {}
    for r in lst_rows:
        listings[r["e"]] = int(r["n"])
    sub_rows = await pool.fetch("SELECT plan, COUNT(*) AS n FROM usuarios WHERE plan IS NOT NULL AND plan <> 'free' GROUP BY plan")
    suscripciones = {r["plan"]: int(r["n"]) for r in sub_rows}
    sponsorships_activos = await pool.fetchval(
        "SELECT COUNT(*) FROM sponsorship WHERE estado = 'activa' AND CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin"
    ) or 0

    return {
        "negocio": {
            "realtors": realtors,
            "listings": listings,
            "suscripciones": suscripciones,
            "sponsorships_activos": int(sponsorships_activos),
        },
        "usuarios": {
            "total": int(total_usuarios),
            "activos_7dias": int(activos_7 or 0),
            "activos_30dias": int(activos_30 or 0),
            "nuevos_hoy": int(nuevos_hoy),
            "nuevos_7dias": int(nuevos_7),
            "nuevos_30dias": int(nuevos_30),
        },
        "perfiles": {
            "por_objetivo": por_objetivo,
            "por_riesgo": por_riesgo,
            "por_presupuesto": por_presupuesto,
            "por_idioma": {"es": 0, "en": 0},
        },
        "comportamiento": {
            "total_simulaciones": int(total_sims),
            "total_comparaciones": int(total_comps),
            "total_vistas_barrio": int(total_vistas),
            "total_favoritos": int(total_favs),
            "barrios_top10": barrios_top10,
            "municipios_top5": municipios_top5,
            "objetivo_mas_comun": objetivo_mas_comun,
            "barrio_mas_favoriteado": barrio_mas_fav,
        },
        "registros_por_dia": registros_por_dia,
        "actividad_por_dia": actividad_por_dia,
    }


# ── Endpoint 2: Lista usuarios ────────────────────────────────────────────────

@router.get("/usuarios")
async def list_usuarios(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    objetivo: Optional[str] = Query(None),
    perfil_riesgo: Optional[str] = Query(None),
    order_by: str = Query("created_at"),
    admin: dict = Depends(require_admin),
):
    pool = get_pool()
    offset = (page - 1) * limit

    where_parts = ["1=1"]
    params: list = []

    if search:
        params.append(f"%{search}%")
        where_parts.append(f"(u.nombre ILIKE ${len(params)} OR u.email ILIKE ${len(params)})")

    if objetivo:
        params.append(objetivo)
        where_parts.append(f"p.objetivo = ${len(params)}")

    if perfil_riesgo:
        params.append(perfil_riesgo)
        where_parts.append(f"p.perfil_riesgo = ${len(params)}")

    order_map = {
        "created_at": "u.created_at",
        "last_login": "u.last_login",
        "actividad": "ultima_actividad",
    }
    order_col = order_map.get(order_by, "u.created_at")

    where_clause = " AND ".join(where_parts)

    total_query = f"""
        SELECT COUNT(DISTINCT u.id)
        FROM usuarios u
        LEFT JOIN perfil_inversor p ON p.usuario_id = u.id
        WHERE {where_clause}
    """
    total = await pool.fetchval(total_query, *params) or 0

    params_paged = params + [limit, offset]
    rows = await pool.fetch(
        f"""
        SELECT
            u.id,
            u.nombre,
            u.email,
            u.plan,
            u.activo,
            u.created_at,
            u.last_login,
            EXTRACT(DAY FROM NOW() - u.created_at)::int AS dias_desde_registro,
            p.presupuesto,
            p.objetivo,
            p.perfil_riesgo AS perfil_riesgo,
            COUNT(DISTINCT h.id) AS total_acciones,
            COUNT(DISTINCT CASE WHEN h.tipo = 'vista_barrio' THEN h.id END) AS barrios_visitados,
            COUNT(DISTINCT CASE WHEN h.tipo = 'simulacion' THEN h.id END) AS simulaciones,
            COUNT(DISTINCT CASE WHEN h.tipo = 'comparacion' THEN h.id END) AS comparaciones,
            COUNT(DISTINCT f.id) AS favoritos,
            MAX(h.created_at) AS ultima_actividad
        FROM usuarios u
        LEFT JOIN perfil_inversor p ON p.usuario_id = u.id
        LEFT JOIN historial h ON h.usuario_id = u.id
        LEFT JOIN favoritos f ON f.usuario_id = u.id
        WHERE {where_clause}
        GROUP BY u.id, u.nombre, u.email, u.plan, u.activo, u.created_at, u.last_login,
                 p.presupuesto, p.objetivo, p.perfil_riesgo
        ORDER BY {order_col} DESC NULLS LAST
        LIMIT ${len(params_paged) - 1} OFFSET ${len(params_paged)}
        """,
        *params_paged,
    )

    import math
    usuarios = []
    for r in rows:
        usuarios.append({
            "id": r["id"],
            "nombre": r["nombre"],
            "email": r["email"],
            "plan": r["plan"],
            "activo": r["activo"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "last_login": r["last_login"].isoformat() if r["last_login"] else None,
            "dias_desde_registro": r["dias_desde_registro"],
            "perfil": {
                "presupuesto": r["presupuesto"],
                "objetivo": r["objetivo"],
                "perfil_riesgo": r["perfil_riesgo"],
            },
            "stats": {
                "barrios_visitados": int(r["barrios_visitados"] or 0),
                "simulaciones": int(r["simulaciones"] or 0),
                "comparaciones": int(r["comparaciones"] or 0),
                "favoritos": int(r["favoritos"] or 0),
                "ultima_actividad": r["ultima_actividad"].isoformat() if r["ultima_actividad"] else None,
            },
        })

    return {
        "total": int(total),
        "page": page,
        "pages": math.ceil(int(total) / limit) if total else 1,
        "usuarios": usuarios,
    }


# ── Endpoint 3: Detalle usuario ───────────────────────────────────────────────

@router.get("/usuarios/{usuario_id}")
async def detalle_usuario(usuario_id: int, admin: dict = Depends(require_admin)):
    pool = get_pool()

    user_row = await pool.fetchrow(
        "SELECT id, nombre, apellido, email, created_at, last_login, activo FROM usuarios WHERE id = $1",
        usuario_id,
    )
    if user_row is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    perfil_row = await pool.fetchrow(
        "SELECT * FROM perfil_inversor WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1",
        usuario_id,
    )

    # Stats agregados
    stats_row = await pool.fetchrow(
        """
        SELECT
            COUNT(*) AS total_acciones,
            COUNT(DISTINCT barrio_id) FILTER (WHERE barrio_id IS NOT NULL) AS barrios_unicos,
            COUNT(DISTINCT DATE(created_at)) AS dias_activo
        FROM historial
        WHERE usuario_id = $1
        """,
        usuario_id,
    )

    muni_rows = await pool.fetch(
        """
        SELECT DISTINCT b.municipio
        FROM historial h
        JOIN raw.barrios b ON h.barrio_id = b.id
        WHERE h.usuario_id = $1
        """,
        usuario_id,
    )
    municipios = [r["municipio"] for r in muni_rows]

    # Favoritos
    fav_rows = await pool.fetch(
        """
        SELECT b.nombre AS barrio, b.municipio, f.nota, f.created_at
        FROM favoritos f
        JOIN raw.barrios b ON f.barrio_id = b.id
        WHERE f.usuario_id = $1
        ORDER BY f.created_at DESC
        """,
        usuario_id,
    )
    favoritos = [
        {
            "barrio": r["barrio"],
            "municipio": r["municipio"],
            "nota": r["nota"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in fav_rows
    ]

    # Historial reciente
    hist_rows = await pool.fetch(
        """
        SELECT h.tipo, h.metadata, h.created_at,
               b.nombre AS barrio_nombre, b.municipio
        FROM historial h
        LEFT JOIN raw.barrios b ON h.barrio_id = b.id
        WHERE h.usuario_id = $1
        ORDER BY h.created_at DESC
        LIMIT 50
        """,
        usuario_id,
    )
    historial = [
        {
            "tipo": r["tipo"],
            "barrio": r["barrio_nombre"],
            "municipio": r["municipio"],
            "metadata": dict(r["metadata"]) if r["metadata"] else {},
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in hist_rows
    ]

    # Simulaciones
    sim_rows = await pool.fetch(
        """
        SELECT b.nombre AS barrio,
               (h.metadata->>'presupuesto_cop')::bigint AS presupuesto_cop,
               h.metadata->>'tipo_inversion' AS tipo_inversion,
               h.created_at
        FROM historial h
        LEFT JOIN raw.barrios b ON h.barrio_id = b.id
        WHERE h.usuario_id = $1 AND h.tipo = 'simulacion'
        ORDER BY h.created_at DESC
        LIMIT 20
        """,
        usuario_id,
    )
    simulaciones = [
        {
            "barrio": r["barrio"],
            "presupuesto_cop": r["presupuesto_cop"],
            "tipo_inversion": r["tipo_inversion"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in sim_rows
    ]

    # Top 5 barrios por visitas
    top5_rows = await pool.fetch(
        """
        SELECT b.nombre, b.municipio, COUNT(*) AS visitas
        FROM historial h
        JOIN raw.barrios b ON h.barrio_id = b.id
        WHERE h.usuario_id = $1 AND h.tipo = 'vista_barrio'
        GROUP BY b.nombre, b.municipio
        ORDER BY visitas DESC
        LIMIT 5
        """,
        usuario_id,
    )
    barrios_top5 = [
        {"nombre": r["nombre"], "municipio": r["municipio"], "visitas": int(r["visitas"])}
        for r in top5_rows
    ]

    # Actividad por día (4 semanas)
    act_rows = await pool.fetch(
        """
        SELECT DATE(created_at) AS fecha, COUNT(*) AS acciones
        FROM historial
        WHERE usuario_id = $1 AND created_at > NOW() - INTERVAL '28 days'
        GROUP BY fecha
        ORDER BY fecha
        """,
        usuario_id,
    )
    actividad_por_dia = [
        {"fecha": str(r["fecha"]), "acciones": int(r["acciones"])}
        for r in act_rows
    ]

    dias = int(stats_row["dias_activo"] or 0)
    total_acc = int(stats_row["total_acciones"] or 0)
    total_sesiones = max(1, dias) if dias else 0

    return {
        "usuario": {
            "id": user_row["id"],
            "nombre": user_row["nombre"],
            "apellido": user_row["apellido"],
            "email": user_row["email"],
            "created_at": user_row["created_at"].isoformat() if user_row["created_at"] else None,
            "last_login": user_row["last_login"].isoformat() if user_row["last_login"] else None,
            "activo": user_row["activo"],
        },
        "perfil": dict(perfil_row) if perfil_row else {},
        "stats": {
            "total_sesiones": total_sesiones,
            "total_acciones": total_acc,
            "barrios_unicos_visitados": int(stats_row["barrios_unicos"] or 0),
            "municipios_explorados": municipios,
            "dias_activo": dias,
        },
        "favoritos": favoritos,
        "historial_reciente": historial,
        "simulaciones": simulaciones,
        "barrios_top5": barrios_top5,
        "actividad_por_dia": actividad_por_dia,
    }


# ── Editar usuario: plan (dar/quitar acceso Pro/Agente) + activo ──────────────

class UsuarioPatch(BaseModel):
    plan: Optional[str] = None     # free | pro | agente
    activo: Optional[bool] = None
    password: Optional[str] = None  # re-auth: requerido si se cambia plan o activo


@router.patch("/usuarios/{usuario_id}")
@limiter.limit("30/minute")
async def editar_usuario(request: Request, usuario_id: int, body: UsuarioPatch = Body(...), admin: dict = Depends(require_admin)):
    if body.plan is not None and body.plan not in ("free", "pro", "agente"):
        raise HTTPException(status_code=400, detail="plan inválido (free|pro|agente)")
    sets: list[str] = []
    params: list = []
    if body.plan is not None:
        params.append(body.plan)
        sets.append(f"plan = ${len(params)}")
    if body.activo is not None:
        params.append(body.activo)
        sets.append(f"activo = ${len(params)}")
    if not sets:
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    pool = get_pool()
    if body.plan is not None or body.activo is not None:
        if not body.password:
            raise HTTPException(status_code=403, detail="Confirma tu contraseña para cambiar plan o estado")
        await _verify_admin_password(pool, admin, body.password)
    params.append(usuario_id)
    row = await pool.fetchrow(
        f"UPDATE usuarios SET {', '.join(sets)} WHERE id = ${len(params)} "
        "RETURNING id, email, plan, activo",
        *params,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    await _audit(pool, admin, "editar_usuario", "usuario", str(usuario_id),
                 {"plan": body.plan, "activo": body.activo}, request)
    return {"id": row["id"], "email": row["email"], "plan": row["plan"], "activo": row["activo"]}


# ── Endpoint 4: Feed actividad ────────────────────────────────────────────────

@router.get("/actividad")
async def actividad_feed(
    limit: int = Query(50, ge=1, le=200),
    tipo: Optional[str] = Query(None),
    usuario_id: Optional[int] = Query(None),
    admin: dict = Depends(require_admin),
):
    pool = get_pool()

    where_parts = ["1=1"]
    params: list = []

    if tipo:
        params.append(tipo)
        where_parts.append(f"h.tipo = ${len(params)}")
    if usuario_id:
        params.append(usuario_id)
        where_parts.append(f"h.usuario_id = ${len(params)}")

    where_clause = " AND ".join(where_parts)
    params.append(limit)

    rows = await pool.fetch(
        f"""
        SELECT
            h.id,
            h.tipo,
            h.metadata,
            h.created_at,
            u.nombre AS usuario_nombre,
            u.email AS usuario_email,
            b.nombre AS barrio_nombre,
            b.municipio
        FROM historial h
        JOIN usuarios u ON h.usuario_id = u.id
        LEFT JOIN raw.barrios b ON h.barrio_id = b.id
        WHERE {where_clause}
        ORDER BY h.created_at DESC
        LIMIT ${len(params)}
        """,
        *params,
    )

    actividad = []
    for r in rows:
        actividad.append({
            "id": r["id"],
            "usuario_nombre": r["usuario_nombre"],
            "usuario_email": r["usuario_email"],
            "tipo": r["tipo"],
            "barrio": r["barrio_nombre"],
            "municipio": r["municipio"],
            "metadata": dict(r["metadata"]) if r["metadata"] else {},
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "hace_cuanto": _hace_cuanto(r["created_at"]) if r["created_at"] else "",
        })

    return {"actividad": actividad}


# ── Endpoint 5: Métricas barrios ──────────────────────────────────────────────

@router.get("/barrios/stats")
async def barrios_stats(admin: dict = Depends(require_admin)):
    pool = get_pool()

    rows = await pool.fetch(
        """
        SELECT
            b.nombre,
            b.municipio,
            COUNT(DISTINCT h.id) FILTER (WHERE h.tipo = 'vista_barrio') AS visitas,
            COUNT(DISTINCT f.id) AS favoritos,
            COUNT(DISTINCT h.id) FILTER (WHERE h.tipo = 'simulacion') AS simulaciones
        FROM raw.barrios b
        LEFT JOIN historial h ON h.barrio_id = b.id
        LEFT JOIN favoritos f ON f.barrio_id = b.id
        GROUP BY b.id, b.nombre, b.municipio
        HAVING COUNT(DISTINCT h.id) > 0 OR COUNT(DISTINCT f.id) > 0
        ORDER BY (COUNT(DISTINCT h.id) + COUNT(DISTINCT f.id) * 3) DESC
        LIMIT 50
        """
    )

    barrios = []
    for r in rows:
        visitas = int(r["visitas"] or 0)
        favs = int(r["favoritos"] or 0)
        sims = int(r["simulaciones"] or 0)
        barrios.append({
            "nombre": r["nombre"],
            "municipio": r["municipio"],
            "visitas": visitas,
            "favoritos": favs,
            "simulaciones": sims,
            "score_engagement": visitas + favs * 3 + sims * 2,
        })

    return {"barrios": barrios}


# ── Endpoint 6: Leads ─────────────────────────────────────────────────────────

class LeadUpdate(BaseModel):
    estado: Optional[str] = None
    asignado_a: Optional[str] = None
    notas: Optional[str] = None


@router.get("/leads")
async def list_leads(admin: dict = Depends(require_admin)):
    pool = get_pool()

    try:
        rows = await pool.fetch(
            """
            SELECT
                l.id            AS lead_id,
                l.estado,
                l.asignado_a,
                l.notas,
                l.created_at    AS lead_created_at,
                u.id            AS usuario_id,
                u.nombre,
                u.apellido,
                u.email,
                p.presupuesto,
                p.objetivo,
                p.perfil_riesgo,
                p.n_unidades,
                p.tipo_gestion,
                p.target_inquilino,
                p.amoblado,
                p.tipo_pago,
                p.horizonte_inversion,
                p.primera_propiedad,
                p.wants_agent
            FROM leads l
            JOIN usuarios u ON u.id = l.usuario_id
            LEFT JOIN perfil_inversor p ON p.usuario_id = l.usuario_id
            ORDER BY l.created_at DESC
            """
        )
    except Exception:
        return {"leads": [], "total": 0, "detail": "migration 0002 not yet applied"}

    leads = []
    for r in rows:
        leads.append({
            "lead_id": r["lead_id"],
            "estado": r["estado"],
            "asignado_a": r["asignado_a"],
            "notas": r["notas"],
            "registrado": _hace_cuanto(r["lead_created_at"]) if r["lead_created_at"] else "",
            "usuario": {
                "id": r["usuario_id"],
                "nombre": f'{r["nombre"] or ""} {r["apellido"] or ""}'.strip(),
                "email": r["email"],
            },
            "perfil": {
                "presupuesto": r["presupuesto"],
                "objetivo": r["objetivo"],
                "perfil_riesgo": r["perfil_riesgo"],
                "n_unidades": r["n_unidades"],
                "tipo_gestion": r["tipo_gestion"],
                "target_inquilino": r["target_inquilino"],
                "amoblado": r["amoblado"],
                "tipo_pago": r["tipo_pago"],
                "horizonte_inversion": r["horizonte_inversion"],
                "primera_propiedad": r["primera_propiedad"],
                "wants_agent": r["wants_agent"],
            },
        })

    return {"leads": leads, "total": len(leads)}


@router.put("/leads/{lead_id}")
@limiter.limit("30/minute")
async def update_lead(
    request: Request,
    lead_id: int,
    body: LeadUpdate = Body(...),
    admin: dict = Depends(require_admin),
):
    pool = get_pool()

    row = await pool.fetchrow("SELECT id FROM leads WHERE id = $1", lead_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    updates = []
    params: list = []
    idx = 1
    if body.estado is not None:
        updates.append(f"estado = ${idx}")
        params.append(body.estado)
        idx += 1
    if body.asignado_a is not None:
        updates.append(f"asignado_a = ${idx}")
        params.append(body.asignado_a)
        idx += 1
    if body.notas is not None:
        updates.append(f"notas = ${idx}")
        params.append(body.notas)
        idx += 1

    if not updates:
        return {"detail": "Sin cambios"}

    params.append(lead_id)
    updated = await pool.fetchrow(
        f"UPDATE leads SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
        *params,
    )
    await _audit(pool, admin, "editar_lead", "lead", str(lead_id),
                 {"estado": body.estado, "asignado_a": body.asignado_a}, request)
    return dict(updated)


# ── Eventos destacados ("pagan por aparecer arriba") ──────────────────────────

@router.get("/eventos")
async def list_eventos_admin(admin: dict = Depends(require_admin)):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT e.id, e.titulo, e.categoria, e.fecha_inicio, e.destacado, e.gratuito,
               e.destacado_nivel, e.destacado_zona_codigo, e.barrio_id,
               b.nombre AS barrio_nombre
        FROM eventos e
        LEFT JOIN raw.barrios b ON e.barrio_id = b.id
        WHERE e.activo = true AND e.fecha_inicio > NOW()
        ORDER BY e.destacado DESC, e.fecha_inicio ASC
        LIMIT 200
        """
    )
    return {
        "eventos": [
            {
                "id": r["id"],
                "titulo": r["titulo"],
                "categoria": r["categoria"],
                "fecha_inicio": r["fecha_inicio"].isoformat() if r["fecha_inicio"] else None,
                "destacado": r["destacado"],
                "destacado_nivel": r["destacado_nivel"],
                "destacado_zona_codigo": r["destacado_zona_codigo"],
                "barrio_id": r["barrio_id"],
                "gratuito": r["gratuito"],
                "barrio": r["barrio_nombre"],
            }
            for r in rows
        ]
    }


_NIVELES_DESTACADO = ("barrio", "comuna", "ciudad")

# Comunas reales de Medellín son 1-16 (analytics.barrios_cd). Los otros municipios del
# Valle de Aburrá no tienen comunas — se tratan como "comuna" propia con un pseudo-código
# 101-105, mismo esquema que ya usa comunidad.py (_MUNICIPIO_TOTAL_COUNTS_QUERY) y
# comunas.py para colorear el mapa. Así "comuna" cubre los 10 municipios, no solo Medellín.
_MUNICIPIO_A_PSEUDO_COMUNA = {
    "BELLO": "101", "ENVIGADO": "102", "ITAGUI": "103", "SABANETA": "104", "LA ESTRELLA": "105",
    "CALDAS": "106", "COPACABANA": "107", "GIRARDOTA": "108", "BARBOSA": "109",
}
_PSEUDO_COMUNA_A_MUNICIPIO = {v: k for k, v in _MUNICIPIO_A_PSEUDO_COMUNA.items()}


class DestacadoPatch(BaseModel):
    destacado: Optional[bool] = None
    destacado_nivel: Optional[str] = None          # barrio | comuna | ciudad
    destacado_zona_codigo: Optional[str] = None    # qué barrio/comuna — si no se manda, se usa la propia del item


@router.get("/destacados-catalogo")
async def destacados_catalogo(admin: dict = Depends(require_admin)):
    """Comunas (16 de Medellín + 5 municipios como pseudo-comuna) y TODOS los barrios
    del Valle de Aburrá, para elegir en qué zona destacar un negocio o evento."""
    pool = get_pool()
    comunas_medellin = await pool.fetch(
        "SELECT DISTINCT bc.cd_comuna, INITCAP(LOWER(b.comuna)) AS nombre "
        "FROM analytics.barrios_cd bc JOIN raw.barrios b ON b.id = bc.barrio_id "
        "WHERE b.municipio = 'MEDELLIN' AND bc.cd_comuna IS NOT NULL ORDER BY bc.cd_comuna"
    )
    barrios = await pool.fetch(
        "SELECT id, INITCAP(LOWER(nombre)) AS nombre, municipio FROM raw.barrios "
        "WHERE municipio IN ('MEDELLIN','BELLO','ENVIGADO','ITAGUI','SABANETA','LA ESTRELLA',"
        "'GIRARDOTA','CALDAS','COPACABANA','BARBOSA') ORDER BY municipio, nombre"
    )
    comunas = [{"codigo": str(r["cd_comuna"]), "nombre": f'Medellín · {r["nombre"]}'} for r in comunas_medellin]
    comunas += [{"codigo": c, "nombre": m.title()} for m, c in _MUNICIPIO_A_PSEUDO_COMUNA.items()]
    return {
        "comunas": comunas,
        "barrios": [{"id": r["id"], "nombre": r["nombre"], "municipio": r["municipio"]} for r in barrios],
    }


async def _validar_zona_codigo(pool, nivel: str, codigo: str) -> bool:
    if nivel == "barrio":
        return bool(await pool.fetchval("SELECT 1 FROM raw.barrios WHERE id = $1", int(codigo)) if codigo.isdigit() else False)
    if nivel == "comuna":
        if codigo in _PSEUDO_COMUNA_A_MUNICIPIO:
            return True
        return bool(await pool.fetchval("SELECT 1 FROM analytics.barrios_cd WHERE cd_comuna::text = $1 LIMIT 1", codigo))
    return False


async def _resolve_own_zona_codigo(pool, tabla: str, item_id: int, nivel: str) -> Optional[str]:
    """Zona por defecto cuando el admin no elige una explícita: la propia ubicación del item.
    barrio → su barrio_id. comuna → su cd_comuna real (Medellín) o el pseudo-código de su municipio."""
    row = await pool.fetchrow(f"SELECT t.barrio_id, b.municipio FROM {tabla} t LEFT JOIN raw.barrios b ON b.id = t.barrio_id WHERE t.id = $1", item_id)
    if not row or row["barrio_id"] is None:
        return None
    if nivel == "barrio":
        return str(row["barrio_id"])
    if nivel == "comuna":
        if row["municipio"] in _MUNICIPIO_A_PSEUDO_COMUNA:
            return _MUNICIPIO_A_PSEUDO_COMUNA[row["municipio"]]
        cd = await pool.fetchval("SELECT cd_comuna FROM analytics.barrios_cd WHERE barrio_id = $1", row["barrio_id"])
        return str(cd) if cd is not None else None
    return None


async def _build_destacado_sets(pool, tabla: str, item_id: int, body: "DestacadoPatch") -> tuple[list[str], list]:
    """SET clauses compartidos por eventos y tiendas para el patch de destacado con alcance."""
    if body.destacado_nivel is not None and body.destacado_nivel not in _NIVELES_DESTACADO:
        raise HTTPException(status_code=400, detail="destacado_nivel debe ser barrio, comuna o ciudad")
    sets: list[str] = []
    params: list = []
    if body.destacado is not None:
        params.append(body.destacado)
        sets.append(f"destacado = ${len(params)}")
        if not body.destacado:
            sets.append("destacado_nivel = NULL")
            sets.append("destacado_zona_codigo = NULL")
    if body.destacado is not False and body.destacado_nivel is not None:
        params.append(body.destacado_nivel)
        sets.append(f"destacado_nivel = ${len(params)}")
        if body.destacado_nivel == "ciudad":
            sets.append("destacado_zona_codigo = NULL")
        else:
            zona = body.destacado_zona_codigo
            if zona is not None:
                if not await _validar_zona_codigo(pool, body.destacado_nivel, zona):
                    raise HTTPException(status_code=400, detail=f"Zona inválida para nivel {body.destacado_nivel}")
            else:
                zona = await _resolve_own_zona_codigo(pool, tabla, item_id, body.destacado_nivel)
            if zona is None:
                raise HTTPException(status_code=400, detail=f"Sin barrio asignado — no se puede destacar por {body.destacado_nivel}")
            params.append(zona)
            sets.append(f"destacado_zona_codigo = ${len(params)}")
    if not sets:
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    return sets, params


@router.patch("/eventos/{evento_id}")
@limiter.limit("30/minute")
async def editar_evento(request: Request, evento_id: int, body: DestacadoPatch = Body(...), admin: dict = Depends(require_admin)):
    pool = get_pool()
    sets, params = await _build_destacado_sets(pool, "eventos", evento_id, body)
    params.append(evento_id)
    row = await pool.fetchrow(
        f"UPDATE eventos SET {', '.join(sets)}, updated_at = NOW() WHERE id = ${len(params)} "
        "RETURNING id, destacado, destacado_nivel, destacado_zona_codigo",
        *params,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    await _audit(pool, admin, "editar_evento", "evento", str(evento_id),
                 {"destacado": row["destacado"], "nivel": row["destacado_nivel"], "zona": row["destacado_zona_codigo"]}, request)
    return dict(row)


# ── Eventos subidos por usuario, pendientes de aprobación ──────────────────────

@router.get("/eventos/pendientes")
async def list_eventos_pendientes(admin: dict = Depends(require_admin)):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT e.id, e.titulo, e.categoria, e.fecha_inicio, e.descripcion,
               e.organizador, e.barrio_id, b.nombre AS barrio_nombre,
               e.url_externo, e.foto_url,
               u.email AS subido_por_email, e.created_at
        FROM eventos e
        LEFT JOIN raw.barrios b ON e.barrio_id = b.id
        LEFT JOIN usuarios u ON u.id = e.subido_por
        WHERE e.activo = false AND e.subido_por IS NOT NULL
        ORDER BY e.created_at ASC
        """
    )
    return [
        {
            "id": r["id"], "titulo": r["titulo"], "categoria": r["categoria"],
            "fecha_inicio": r["fecha_inicio"].isoformat() if r["fecha_inicio"] else None,
            "descripcion": r["descripcion"], "organizador": r["organizador"],
            "barrio": r["barrio_nombre"], "url_externo": r["url_externo"], "foto_url": r["foto_url"],
            "subido_por_email": r["subido_por_email"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


@router.post("/eventos/{evento_id}/aprobar")
@limiter.limit("30/minute")
async def aprobar_evento(request: Request, evento_id: int, admin: dict = Depends(require_admin)):
    pool = get_pool()
    row = await pool.fetchrow(
        "UPDATE eventos SET activo = true, updated_at = NOW() WHERE id = $1 AND activo = false RETURNING id",
        evento_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evento no encontrado o ya activo")
    await _audit(pool, admin, "aprobar_evento", "evento", str(evento_id), None, request)
    return {"id": evento_id, "activo": True}


# ── Posts de comunidad (blog) subidos por vecinos, pendientes de aprobación ─────

@router.get("/posts/pendientes")
async def list_posts_pendientes(admin: dict = Depends(require_admin)):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT p.id, p.autor_nombre, p.autor_email, p.autor_handle,
               p.titulo, p.cuerpo, p.imagen_url, p.enlace_url,
               p.barrio_id, b.nombre AS barrio_nombre, p.municipio, p.categoria,
               p.created_at
        FROM public.comunidad_post p
        LEFT JOIN raw.barrios b ON p.barrio_id = b.id
        WHERE p.estado = 'pendiente'
        ORDER BY p.created_at ASC
        """
    )
    return [
        {
            "id": r["id"], "autor_nombre": r["autor_nombre"], "autor_email": r["autor_email"],
            "autor_handle": r["autor_handle"], "titulo": r["titulo"], "cuerpo": r["cuerpo"],
            "imagen_url": r["imagen_url"], "enlace_url": r["enlace_url"],
            "barrio_id": r["barrio_id"], "barrio": r["barrio_nombre"],
            "municipio": r["municipio"], "categoria": r["categoria"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


@router.post("/posts/{post_id}/aprobar")
@limiter.limit("30/minute")
async def aprobar_post(request: Request, post_id: int, admin: dict = Depends(require_admin)):
    pool = get_pool()
    row = await pool.fetchrow(
        "UPDATE public.comunidad_post SET estado = 'aprobado' WHERE id = $1 AND estado = 'pendiente' RETURNING id",
        post_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Post no encontrado o ya procesado")
    await _audit(pool, admin, "aprobar_post", "comunidad_post", str(post_id), None, request)
    return {"id": post_id, "estado": "aprobado"}


@router.post("/posts/{post_id}/rechazar")
@limiter.limit("30/minute")
async def rechazar_post(request: Request, post_id: int, admin: dict = Depends(require_admin)):
    pool = get_pool()
    row = await pool.fetchrow(
        "UPDATE public.comunidad_post SET estado = 'rechazado' WHERE id = $1 AND estado = 'pendiente' RETURNING id",
        post_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Post no encontrado o ya procesado")
    await _audit(pool, admin, "rechazar_post", "comunidad_post", str(post_id), None, request)
    return {"id": post_id, "estado": "rechazado"}


# ── Negocios locales (tiendas) — destacados con alcance ────────────────────────

@router.get("/tiendas")
async def list_tiendas_admin(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    destacado: Optional[bool] = Query(None),
    admin: dict = Depends(require_admin),
):
    pool = get_pool()
    offset = (page - 1) * limit

    where_parts = ["t.activo = true"]
    params: list = []
    if search:
        params.append(f"%{search}%")
        where_parts.append(f"t.nombre ILIKE ${len(params)}")
    if destacado is not None:
        params.append(destacado)
        where_parts.append(f"t.destacado = ${len(params)}")
    where_clause = " AND ".join(where_parts)

    total = await pool.fetchval(f"SELECT COUNT(*) FROM tiendas t WHERE {where_clause}", *params) or 0

    params_paged = params + [limit, offset]
    rows = await pool.fetch(
        f"""
        SELECT t.id, t.nombre, t.categoria, t.destacado, t.destacado_nivel, t.destacado_zona_codigo,
               t.barrio_id, b.nombre AS barrio_nombre, b.municipio
        FROM tiendas t
        LEFT JOIN raw.barrios b ON t.barrio_id = b.id
        WHERE {where_clause}
        ORDER BY t.destacado DESC, t.nombre ASC
        LIMIT ${len(params_paged) - 1} OFFSET ${len(params_paged)}
        """,
        *params_paged,
    )
    import math
    return {
        "total": int(total),
        "page": page,
        "pages": math.ceil(int(total) / limit) if total else 1,
        "tiendas": [
            {
                "id": r["id"], "nombre": r["nombre"], "categoria": r["categoria"],
                "destacado": r["destacado"], "destacado_nivel": r["destacado_nivel"],
                "destacado_zona_codigo": r["destacado_zona_codigo"],
                "barrio_id": r["barrio_id"], "barrio": r["barrio_nombre"], "municipio": r["municipio"],
            }
            for r in rows
        ],
    }


@router.patch("/tiendas/{tienda_id}")
@limiter.limit("30/minute")
async def editar_tienda(request: Request, tienda_id: int, body: DestacadoPatch = Body(...), admin: dict = Depends(require_admin)):
    pool = get_pool()
    sets, params = await _build_destacado_sets(pool, "tiendas", tienda_id, body)
    params.append(tienda_id)
    row = await pool.fetchrow(
        f"UPDATE tiendas SET {', '.join(sets)}, updated_at = NOW() WHERE id = ${len(params)} "
        "RETURNING id, destacado, destacado_nivel, destacado_zona_codigo",
        *params,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Negocio no encontrado")
    await _audit(pool, admin, "editar_tienda", "tienda", str(tienda_id),
                 {"destacado": row["destacado"], "nivel": row["destacado_nivel"], "zona": row["destacado_zona_codigo"]}, request)
    await ghl_client.sync_tienda(tienda_id)
    return dict(row)


# ── Negocios subidos por su dueño, pendientes de aprobación ────────────────────

@router.get("/tiendas/pendientes")
async def list_tiendas_pendientes(admin: dict = Depends(require_admin)):
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT t.id, t.nombre, t.categoria, t.descripcion, t.direccion,
               t.telefono, t.whatsapp, t.instagram, t.website, t.foto_url,
               t.barrio_id, b.nombre AS barrio_nombre,
               u.email AS subido_por_email, t.created_at
        FROM tiendas t
        LEFT JOIN raw.barrios b ON t.barrio_id = b.id
        LEFT JOIN usuarios u ON u.id = t.subido_por
        WHERE t.activo = false AND t.subido_por IS NOT NULL
        ORDER BY t.created_at ASC
        """
    )
    return [
        {
            "id": r["id"], "nombre": r["nombre"], "categoria": r["categoria"],
            "descripcion": r["descripcion"], "direccion": r["direccion"],
            "telefono": r["telefono"], "whatsapp": r["whatsapp"],
            "instagram": r["instagram"], "website": r["website"], "foto_url": r["foto_url"],
            "barrio": r["barrio_nombre"], "subido_por_email": r["subido_por_email"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


@router.post("/tiendas/{tienda_id}/aprobar")
@limiter.limit("30/minute")
async def aprobar_tienda(request: Request, tienda_id: int, admin: dict = Depends(require_admin)):
    pool = get_pool()
    row = await pool.fetchrow(
        "UPDATE tiendas SET activo = true, updated_at = NOW() WHERE id = $1 AND activo = false RETURNING id",
        tienda_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Negocio no encontrado o ya activo")
    await _audit(pool, admin, "aprobar_tienda", "tienda", str(tienda_id), None, request)
    await ghl_client.sync_tienda(tienda_id)
    return {"id": tienda_id, "activo": True}


# ── SMTP Test ──────────────────────────────────────────────────────────────────

class TestEmailRequest(BaseModel):
    to: Optional[str] = None  # defaults to ADMIN_EMAIL


@router.post("/test-email", status_code=200)
async def test_email(
    req: TestEmailRequest = Body(default=TestEmailRequest()),
    admin: dict = Depends(require_admin),
):
    """Send a test email to verify SMTP config. Defaults to ADMIN_EMAIL."""
    from api.utils.email import send_email, ADMIN_EMAIL
    target = req.to or ADMIN_EMAIL
    await send_email(
        target,
        "Test SMTP · Medellín Social",
        "<p>SMTP funciona correctamente desde Medellín Social.</p>",
    )
    return {"ok": True, "sent_to": target}


# ── Listing link health ────────────────────────────────────────────────────────

@router.get("/link-health/summary")
async def link_health_summary(admin: dict = Depends(require_admin)):
    """Counts per source/status + age of the oldest check (staleness of the checker)."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT fuente, url_status, COUNT(*)::int AS n, MIN(last_checked_at) AS oldest_check
             FROM public.listing_link_health GROUP BY fuente, url_status ORDER BY fuente, url_status""")
    oldest = await pool.fetchval("SELECT MIN(last_checked_at) FROM public.listing_link_health")
    never = await pool.fetchval("SELECT COUNT(*)::int FROM public.listing_link_health WHERE last_checked_at IS NULL")
    pending = await pool.fetchval("SELECT COUNT(*)::int FROM public.listing_link_health WHERE url_status='pending_review'")
    now = datetime.now(timezone.utc)
    by_source: dict = {}
    for r in rows:
        d = by_source.setdefault(r["fuente"], {"statuses": {}, "oldest_check_age_hours": None})
        d["statuses"][r["url_status"]] = r["n"]
        if r["oldest_check"]:
            age = round((now - r["oldest_check"]).total_seconds() / 3600, 1)
            if d["oldest_check_age_hours"] is None or age > d["oldest_check_age_hours"]:
                d["oldest_check_age_hours"] = age
    return {
        "by_source": by_source,
        "oldest_check_age_hours": round((now - oldest).total_seconds() / 3600, 1) if oldest else None,
        "never_checked": never or 0,
        "pending_review": pending or 0,
    }
