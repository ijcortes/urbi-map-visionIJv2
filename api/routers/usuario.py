import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, field_validator

from api.db import get_pool
from api.dependencies import get_current_user
from api.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class OnboardingRequest(BaseModel):
    presupuesto: Optional[str] = None
    presupuesto_min_cop: Optional[int] = None
    presupuesto_max_cop: Optional[int] = None
    objetivo: Optional[str] = None
    perfil_riesgo: Optional[str] = None
    # Extended onboarding fields
    tipo_usuario: Optional[str] = None
    n_unidades: Optional[str] = None
    tipo_gestion: Optional[str] = None
    target_inquilino: Optional[str] = None
    amoblado: Optional[str] = None
    tipo_pago: Optional[str] = None
    horizonte_inversion: Optional[str] = None
    primera_propiedad: Optional[bool] = None
    wants_agent: Optional[bool] = None


class MapConfigRequest(BaseModel):
    zoom_default: Optional[float] = None
    centro_lat: Optional[float] = None
    centro_lng: Optional[float] = None
    capas_visibles: Optional[list[str]] = None
    score_display: Optional[str] = None        # corto/mediano/largo/recomendado
    mostrar_oportunidades: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_presupuesto(text: str) -> tuple[Optional[int], Optional[int]]:
    """Parse '$200M-$500M COP' → (200_000_000, 500_000_000). Best-effort."""
    import re
    nums = re.findall(r"\d+", text.replace(".", "").replace(",", ""))
    if len(nums) >= 2:
        return int(nums[0]) * 1_000_000, int(nums[1]) * 1_000_000
    if len(nums) == 1:
        v = int(nums[0]) * 1_000_000
        return v, v
    return None, None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/perfil")
@limiter.limit("100/minute")
async def get_perfil(request: Request, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM perfil_inversor WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1",
        current_user["id"],
    )
    if row is None:
        return {}
    return dict(row)


@router.post("/onboarding", status_code=201)
@limiter.limit("30/minute")
async def onboarding(request: Request, req: OnboardingRequest, current_user: dict = Depends(get_current_user)):
    pool = get_pool()

    pmin = req.presupuesto_min_cop
    pmax = req.presupuesto_max_cop
    if req.presupuesto and (pmin is None or pmax is None):
        pmin, pmax = _parse_presupuesto(req.presupuesto)

    # Base INSERT — always works, pre- and post-migration
    row = await pool.fetchrow(
        """
        INSERT INTO perfil_inversor
            (usuario_id, presupuesto, presupuesto_min_cop, presupuesto_max_cop, objetivo, perfil_riesgo)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (usuario_id) DO UPDATE SET
            presupuesto         = EXCLUDED.presupuesto,
            presupuesto_min_cop = EXCLUDED.presupuesto_min_cop,
            presupuesto_max_cop = EXCLUDED.presupuesto_max_cop,
            objetivo            = EXCLUDED.objetivo,
            perfil_riesgo       = EXCLUDED.perfil_riesgo,
            updated_at          = NOW()
        RETURNING *
        """,
        current_user["id"], req.presupuesto, pmin, pmax, req.objetivo, req.perfil_riesgo,
    )

    # Extended fields — only available after migration 0002; silently skipped if not yet applied
    try:
        await pool.execute(
            """
            UPDATE perfil_inversor SET
                tipo_usuario             = $2,
                n_unidades               = $3,
                tipo_gestion             = $4,
                target_inquilino         = $5,
                amoblado                 = $6,
                tipo_pago                = $7,
                horizonte_inversion      = $8,
                primera_propiedad        = $9,
                wants_agent              = $10,
                onboarding_completado_at = NOW()
            WHERE usuario_id = $1
            """,
            current_user["id"],
            req.tipo_usuario, req.n_unidades, req.tipo_gestion, req.target_inquilino,
            req.amoblado, req.tipo_pago, req.horizonte_inversion,
            req.primera_propiedad, req.wants_agent,
        )
        if req.wants_agent:
            await pool.execute(
                "INSERT INTO leads (usuario_id) VALUES ($1) ON CONFLICT (usuario_id) DO NOTHING",
                current_user["id"],
            )
    except Exception:
        pass  # migration 0002 not yet applied in this environment

    return dict(row)


@router.put("/perfil")
@limiter.limit("30/minute")
async def update_perfil(request: Request, req: OnboardingRequest, current_user: dict = Depends(get_current_user)):
    return await onboarding(request, req, current_user)


@router.get("/configuracion_mapa")
@limiter.limit("100/minute")
async def get_map_config(request: Request, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM configuracion_mapa WHERE usuario_id = $1", current_user["id"]
    )
    if row is None:
        return {
            "usuario_id": current_user["id"],
            "zoom_default": 12,
            "centro_lat": 6.2442,
            "centro_lng": -75.5812,
            "capas_visibles": ["scores"],
            "score_display": "recomendado",
            "mostrar_oportunidades": False,
        }
    return dict(row)


@router.put("/configuracion_mapa")
@limiter.limit("30/minute")
async def update_map_config(request: Request, req: MapConfigRequest, current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO configuracion_mapa
            (usuario_id, zoom_default, centro_lat, centro_lng, capas_visibles, score_display, mostrar_oportunidades)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (usuario_id) DO UPDATE SET
            zoom_default          = COALESCE($2, configuracion_mapa.zoom_default),
            centro_lat            = COALESCE($3, configuracion_mapa.centro_lat),
            centro_lng            = COALESCE($4, configuracion_mapa.centro_lng),
            capas_visibles        = COALESCE($5, configuracion_mapa.capas_visibles),
            score_display         = COALESCE($6, configuracion_mapa.score_display),
            mostrar_oportunidades = COALESCE($7, configuracion_mapa.mostrar_oportunidades),
            updated_at            = NOW()
        RETURNING *
        """,
        current_user["id"],
        req.zoom_default, req.centro_lat, req.centro_lng,
        req.capas_visibles, req.score_display, req.mostrar_oportunidades,
    )
    return dict(row)


# ── Newsletter / Suscribirse ──────────────────────────────────────────────────

class SuscribirseIn(BaseModel):
    nombre: str
    apellido: Optional[str] = None
    email: EmailStr
    barrio_id: Optional[int] = None
    intereses: Optional[str] = None
    newsletter_activo: bool = True

    @field_validator("email")
    @classmethod
    def _normalizar_email(cls, v: str) -> str:
        return v.strip().lower()


class SuscribirseOut(BaseModel):
    # Uniform on purpose: no `nuevo` / `usuario_id` (account-existence oracle).
    success: bool


@router.post("/suscribirse", response_model=SuscribirseOut)
@limiter.limit("5/minute")
async def suscribirse(request: Request, body: SuscribirseIn, pool=Depends(get_pool)):
    try:
        # Hash up front on every call so new-vs-existing email cost the same time.
        import bcrypt
        import secrets
        hashed = bcrypt.hashpw(secrets.token_urlsafe(16).encode(), bcrypt.gensalt()).decode()
        existing = await pool.fetchrow(
            "SELECT id FROM public.usuarios WHERE email = $1", body.email
        )
        if existing:
            await pool.execute(
                """
                UPDATE public.usuarios SET
                    newsletter_activo    = $2,
                    newsletter_barrio_id = COALESCE($3, newsletter_barrio_id),
                    newsletter_intereses = CASE WHEN $4::text IS NOT NULL
                                               THEN ARRAY[$4::text]
                                               ELSE newsletter_intereses END,
                    fecha_suscripcion    = COALESCE(fecha_suscripcion, NOW()),
                    -- fill-only: este endpoint es público/sin auth, no debe pisar
                    -- nombre/apellido de una cuenta ya existente (overwrite anónimo).
                    nombre               = COALESCE(nombre, $5),
                    apellido             = COALESCE(apellido, $6)
                WHERE id = $1
                """,
                existing["id"], body.newsletter_activo, body.barrio_id,
                body.intereses, body.nombre, body.apellido,
            )
            return SuscribirseOut(success=True)

        row = await pool.fetchrow(
            """
            INSERT INTO public.usuarios
                (email, password_hash, nombre, apellido, rol,
                 newsletter_activo, newsletter_barrio_id, newsletter_intereses, fecha_suscripcion)
            VALUES ($1, $2, $3, $4, 'usuario', $5, $6,
                    CASE WHEN $7::text IS NOT NULL THEN ARRAY[$7::text] ELSE NULL END,
                    NOW())
            RETURNING id
            """,
            body.email, hashed, body.nombre, body.apellido,
            body.newsletter_activo, body.barrio_id, body.intereses,
        )
        return SuscribirseOut(success=True)
    except Exception:
        logger.exception("Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno del servidor")
