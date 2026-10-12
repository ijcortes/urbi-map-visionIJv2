"""Subscription management — Pro and Agente plans."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from pydantic import BaseModel

from api.config.planes import PLANES
from api.db import get_pool
from api.dependencies import get_current_user
from api.utils.email import ADMIN_EMAIL, _wrap, send_email
from api.utils import ghl_client, stripe_client

router = APIRouter()
log = logging.getLogger(__name__)

_FRONTEND_URL = os.getenv("FRONTEND_URL", "https://medellin.social")
_ADMIN_WHATSAPP = os.getenv("ADMIN_WHATSAPP", "")


# ── GET /planes ────────────────────────────────────────────────────────────────

@router.get("/planes")
async def get_planes(moneda: str = "COP"):
    """Public. Returns plan list. ?moneda=COP|USD toggles displayed price."""
    moneda = moneda.upper()
    if moneda not in ("COP", "USD"):
        moneda = "COP"

    result = []
    for key, p in PLANES.items():
        result.append({
            "id": key,
            "nombre": p["nombre"],
            "descripcion": p["descripcion"],
            "precio": p["precio_usd"] if moneda == "USD" else p["precio_cop"],
            "moneda": moneda,
            "precio_cop": p["precio_cop"],
            "precio_usd": p["precio_usd"],
            "features": p["features"],
            "requiere_verificacion": p.get("requiere_verificacion", False),
            "pago_disponible": bool(p.get("stripe_price_id_usd")) if moneda == "USD" else False,
        })
    return {"planes": result, "moneda": moneda}


# ── POST /iniciar ──────────────────────────────────────────────────────────────

@router.post("/iniciar")
async def iniciar_suscripcion(
    plan:   str = Form(...),
    moneda: str = Form("COP"),
    current_user: dict = Depends(get_current_user),
):
    if plan not in PLANES:
        raise HTTPException(400, "Plan inválido")
    moneda = moneda.upper()
    if moneda not in ("COP", "USD"):
        raise HTTPException(400, "Moneda inválida")

    pool = get_pool()
    user_id = current_user["id"]

    # Agente plan: require verification first
    if plan == "agente":
        agente = await pool.fetchrow(
            "SELECT id FROM agent WHERE usuario_id = $1 AND estado = 'activo'",
            user_id,
        )
        if not agente:
            return {"requiere_verificacion": True, "redirect": "/agentes/registro"}

    success_url = f"{_FRONTEND_URL}/suscripcion/exito?plan={plan}"
    cancel_url  = f"{_FRONTEND_URL}/suscripcion/cancelada?plan={plan}"

    checkout_url: Optional[str] = None

    if moneda == "USD":
        checkout_url = await stripe_client.crear_checkout_session(
            usuario_id=user_id,
            email=current_user["email"],
            plan=plan,
            success_url=success_url,
            cancel_url=cancel_url,
        )

    if not checkout_url:
        # Payment gateway not yet configured — manual flow
        plan_nombre = PLANES[plan]["nombre"]
        precio = PLANES[plan]["precio_cop"] if moneda == "COP" else PLANES[plan]["precio_usd"]
        precio_fmt = f"${precio:,} {moneda}"
        return {
            "checkout_url": None,
            "modo_manual": True,
            "mensaje": f"Para activar {plan_nombre} ({precio_fmt}/mes), contacta a nuestro equipo.",
            "whatsapp": _ADMIN_WHATSAPP,
            "admin_email": ADMIN_EMAIL,
        }

    # Create pending subscription record
    await pool.execute(
        """
        INSERT INTO public.suscripciones_usuario (usuario_id, plan, estado, moneda, precio)
        VALUES ($1, $2, 'pendiente', $3, $4)
        ON CONFLICT (usuario_id, plan) DO UPDATE
          SET estado = 'pendiente', moneda = EXCLUDED.moneda, precio = EXCLUDED.precio,
              updated_at = NOW()
        """,
        user_id, plan, moneda,
        PLANES[plan]["precio_cop"] if moneda == "COP" else PLANES[plan]["precio_usd"],
    )

    return {"checkout_url": checkout_url}


# ── POST /agente/registro ───────────────────────────────────────────────────────

class AgenteRegistroIn(BaseModel):
    nombre: str
    telefono: str


@router.post("/agente/registro")
async def registro_agente(
    body: AgenteRegistroIn,
    current_user: dict = Depends(get_current_user),
):
    """Aplicación de agente independiente: crea `agent` en estado 'pendiente'
    para que el admin lo revise (admin_agentes.py aprobar/rechazar). La
    agency 'independiente' se crea sola, más tarde, la primera vez que se le
    asigna una zona (zona_sponsor_service.get_or_create_agency) — no acá."""
    if not body.nombre.strip() or not body.telefono.strip():
        raise HTTPException(400, "Nombre y teléfono son obligatorios")

    pool = get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO agent (usuario_id, email, nombre, telefono)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE
          SET usuario_id = EXCLUDED.usuario_id,
              nombre = CASE WHEN agent.estado = 'pendiente' THEN EXCLUDED.nombre ELSE agent.nombre END,
              telefono = CASE WHEN agent.estado = 'pendiente' THEN EXCLUDED.telefono ELSE agent.telefono END
        RETURNING id, estado
        """,
        current_user["id"], current_user["email"], body.nombre.strip(), body.telefono.strip(),
    )
    # Realtor nuevo → GHL (Contact). Best-effort: hoy sync_agent levanta
    # (stub sin contrato) → se loguea y sigue, igual que afiliados/embajadores.
    try:
        await ghl_client.sync_agent(row["id"])
    except Exception:
        log.exception("sync_agent(%s) falló", row["id"])  # best-effort, no bloquea el registro
    return {"id": str(row["id"]), "estado": row["estado"]}


# ── GET /mi-plan ───────────────────────────────────────────────────────────────

@router.get("/mi-plan")
async def mi_plan(current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    user_id = current_user["id"]

    plan_actual = current_user.get("plan") or "free"

    sub = await pool.fetchrow(
        """
        SELECT plan, estado, moneda, precio, fecha_inicio, fecha_fin,
               cancelacion_solicitada, stripe_subscription_id
        FROM public.suscripciones_usuario
        WHERE usuario_id = $1 AND estado = 'activa'
        ORDER BY fecha_creacion DESC
        LIMIT 1
        """,
        user_id,
    )

    features = PLANES.get(plan_actual, {}).get("features", []) if plan_actual != "free" else [
        "Listings del MLS",
        "Mapa interactivo",
        "Filtros básicos",
        "Barrios de Medellín",
    ]

    return {
        "plan": plan_actual,
        "estado": sub["estado"] if sub else ("activa" if plan_actual != "free" else "free"),
        "fecha_fin": sub["fecha_fin"].isoformat() if sub and sub["fecha_fin"] else None,
        "cancelacion_solicitada": sub["cancelacion_solicitada"] if sub else False,
        "features": features,
        "precio": sub["precio"] if sub else None,
        "moneda": sub["moneda"] if sub else None,
    }


# ── POST /cancelar ─────────────────────────────────────────────────────────────

@router.post("/cancelar")
async def cancelar_suscripcion(current_user: dict = Depends(get_current_user)):
    pool = get_pool()
    user_id = current_user["id"]

    sub = await pool.fetchrow(
        """
        SELECT id, stripe_subscription_id
        FROM public.suscripciones_usuario
        WHERE usuario_id = $1 AND estado = 'activa'
        ORDER BY fecha_creacion DESC LIMIT 1
        """,
        user_id,
    )
    if not sub:
        raise HTTPException(404, "Sin suscripción activa")

    if sub["stripe_subscription_id"]:
        await stripe_client.cancelar_suscripcion(sub["stripe_subscription_id"])

    await pool.execute(
        """
        UPDATE public.suscripciones_usuario
        SET cancelacion_solicitada = true, updated_at = NOW()
        WHERE id = $1
        """,
        sub["id"],
    )
    return {"ok": True, "mensaje": "Tu plan seguirá activo hasta el final del período de facturación."}


# ── POST /webhook/stripe ───────────────────────────────────────────────────────

@router.post("/webhook/stripe", include_in_schema=False)
async def webhook_stripe(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe_client.verificar_webhook(payload, sig)
    except ValueError:
        raise HTTPException(400, "Webhook inválido")

    etype = event["type"]
    data  = event["data"]["object"]

    if etype == "checkout.session.completed":
        meta       = data.get("metadata", {})
        usuario_id = int(meta.get("usuario_id", 0))
        plan       = meta.get("plan", "")
        stripe_sub = data.get("subscription")
        customer   = data.get("customer")
        if usuario_id and plan:
            await _activar_plan(usuario_id, plan, "USD",
                                stripe_sub_id=stripe_sub,
                                stripe_customer_id=customer)

    elif etype == "invoice.payment_succeeded":
        stripe_sub = data.get("subscription")
        if stripe_sub:
            await _renovar_suscripcion(stripe_sub_id=stripe_sub)

    elif etype in ("invoice.payment_failed", "customer.subscription.deleted"):
        stripe_sub = data.get("id") if etype == "customer.subscription.deleted" else data.get("subscription")
        if stripe_sub:
            await _marcar_vencida(stripe_sub_id=stripe_sub)

    return {"received": True}


# ── DB helpers ─────────────────────────────────────────────────────────────────

async def _activar_plan(
    usuario_id: int,
    plan: str,
    moneda: str,
    stripe_sub_id: Optional[str] = None,
    stripe_customer_id: Optional[str] = None,
    ghl_sub_id: Optional[str] = None,
) -> None:
    pool = get_pool()
    now = datetime.now(timezone.utc)
    fecha_fin = now + timedelta(days=31)

    await pool.execute(
        """
        INSERT INTO public.suscripciones_usuario
            (usuario_id, plan, estado, moneda, precio,
             stripe_subscription_id, stripe_customer_id,
             ghl_subscription_id,
             fecha_inicio, fecha_fin)
        VALUES ($1, $2, 'activa', $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (usuario_id, plan) DO UPDATE
          SET estado = 'activa',
              stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, suscripciones_usuario.stripe_subscription_id),
              stripe_customer_id     = COALESCE(EXCLUDED.stripe_customer_id, suscripciones_usuario.stripe_customer_id),
              ghl_subscription_id    = COALESCE(EXCLUDED.ghl_subscription_id, suscripciones_usuario.ghl_subscription_id),
              fecha_inicio = COALESCE(suscripciones_usuario.fecha_inicio, EXCLUDED.fecha_inicio),
              fecha_fin    = EXCLUDED.fecha_fin,
              cancelacion_solicitada = false,
              updated_at = NOW()
        """,
        usuario_id, plan, moneda,
        PLANES[plan]["precio_cop"] if moneda == "COP" else PLANES[plan]["precio_usd"],
        stripe_sub_id, stripe_customer_id,
        ghl_sub_id,
        now, fecha_fin,
    )
    # Promote plan on usuario
    await pool.execute(
        "UPDATE public.usuarios SET plan = $1 WHERE id = $2 AND (plan IS NULL OR plan = 'free' OR plan != 'agente' OR $1 = 'agente')",
        plan, usuario_id,
    )
    # Notify user
    user = await pool.fetchrow("SELECT email, nombre FROM public.usuarios WHERE id = $1", usuario_id)
    if user:
        await _email_bienvenida_plan(user["email"], user["nombre"], plan)


async def _renovar_suscripcion(stripe_sub_id: str) -> None:
    pool = get_pool()
    now = datetime.now(timezone.utc)
    fecha_fin = now + timedelta(days=31)
    await pool.execute(
        """
        UPDATE public.suscripciones_usuario
        SET fecha_fin = $1, estado = 'activa', updated_at = NOW()
        WHERE stripe_subscription_id = $2
        """,
        fecha_fin, stripe_sub_id,
    )


async def _marcar_vencida(stripe_sub_id: str) -> None:
    pool = get_pool()
    row = await pool.fetchrow(
        "UPDATE public.suscripciones_usuario SET estado = 'vencida', updated_at = NOW() WHERE stripe_subscription_id = $1 RETURNING usuario_id",
        stripe_sub_id,
    )
    if row:
        await pool.execute(
            "UPDATE public.usuarios SET plan = 'free' WHERE id = $1", row["usuario_id"]
        )


async def _email_bienvenida_plan(email: str, nombre: str, plan: str) -> None:
    plan_data = PLANES[plan]
    features_html = "".join(
        f'<li style="padding:3px 0;color:#1A1208">{f}</li>'
        for f in plan_data["features"][:5]
    )
    html = _wrap(f"""
      <h3 style="color:#1D9E75">¡Bienvenido a {plan_data['nombre']}!</h3>
      <p style="font-size:14px;color:#1A1208">Hola <strong>{nombre}</strong>,</p>
      <p style="font-size:14px;color:#1A1208;margin-bottom:12px">
        Tu suscripción está activa. Ahora tienes acceso a:
      </p>
      <ul style="padding-left:18px;margin-bottom:16px">
        {features_html}
        <li style="padding:3px 0;color:#62736d">y más…</li>
      </ul>
      <a href="{_FRONTEND_URL}/map"
         style="display:inline-block;background:#1D9E75;color:#fff;padding:10px 22px;border-radius:6px;font-weight:700;text-decoration:none;font-size:13px">
        Ir al MLS →
      </a>
    """)
    await send_email(email, f"¡Tu plan {plan_data['nombre']} está activo!", html)
