"""Lead pull API para GHL — Talal conecta GHL a ESTOS endpoints (HTTP action /
workflow programado) para descubrir y traer los leads de visita calificados.

Dirección = salida por PULL: nosotros exponemos el shape, Talal lo mapea del
lado GHL. Por eso NO está bloqueado por el contrato de Talal (a diferencia de
`push_visita_to_ghl`, que sí necesita la API de Appointments) — resuelve la
pregunta abierta de §5 del contrato: "no hay forma de descubrir leads nuevos".

Auth: token estático compartido con Talal en el header `X-API-Key`, comparado
con `GHL_LEADS_TOKEN` vía `hmac.compare_digest`. Expone PII (nombre/tel/email)
→ cerrado por defecto: sin token en el entorno = 503, nunca abierto.

Base legal (Ley 1581): el comprador envió la solicitud de visita activamente
(consentimiento para ser contactado por el lead) — postura distinta al harvest
de agencias scrapeadas; aquí el titular inició el contacto.
"""
from __future__ import annotations

import hmac
import os
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from api.db import get_pool

router = APIRouter()

# estados válidos (espejo del CHECK de visita_solicitud, migr 0056)
_ESTADOS = {"pendiente", "confirmada", "realizada", "cancelada", "no_asistio"}

_LEAD_SELECT = """
    SELECT v.id::text AS id, v.created_at, v.estado,
           v.nombre, v.telefono, u.email,
           v.listing_url, v.fecha_visita, v.mensaje, v.agent_id::text AS agent_id,
           v.intencion, v.presupuesto, v.plazo, v.credito,
           CASE WHEN v.estado = 'pendiente'
                THEN ROUND(EXTRACT(EPOCH FROM (NOW() - v.created_at)) / 3600.0)::int
                ELSE NULL END AS horas_sin_responder
    FROM public.visita_solicitud v
    LEFT JOIN public.usuarios u ON u.id = v.usuario_id
"""


def require_ghl_token(x_api_key: str | None = Header(default=None)) -> None:
    """Cerrado por defecto: sin GHL_LEADS_TOKEN en el entorno → 503."""
    token = os.getenv("GHL_LEADS_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Lead API no configurada (falta GHL_LEADS_TOKEN)")
    if not x_api_key or not hmac.compare_digest(x_api_key, token):
        raise HTTPException(status_code=401, detail="token inválido")


def _lead(r) -> dict:
    """Shape plano que Talal mapea a campos/custom fields de GHL."""
    return {
        "id": r["id"],
        "created_at": r["created_at"].isoformat(),
        "estado": r["estado"],
        "nombre": r["nombre"],
        "telefono": r["telefono"],
        "email": r["email"],
        "listing_url": r["listing_url"],          # id interno / slug / url externa del inmueble
        "fecha_visita": r["fecha_visita"].isoformat() if r["fecha_visita"] else None,
        "mensaje": r["mensaje"],
        "agent_id": r["agent_id"],
        # Calificación del lead (Zillow paso 2) — plano para mapear en GHL.
        "intencion": r["intencion"],              # vivir | invertir
        "presupuesto": r["presupuesto"],          # <200M | 200-500M | 500-1000M | >1000M
        "plazo": r["plazo"],                      # ya | 1-3m | 3-6m | explorando
        "credito": r["credito"],                  # contado | aprobado | en_tramite | no
        "calificado": any(r[k] for k in ("intencion", "presupuesto", "plazo", "credito")),
        "sla_horas_sin_responder": r["horas_sin_responder"],
    }


@router.get("/leads", dependencies=[Depends(require_ghl_token)])
async def listar_leads(
    since: str | None = Query(default=None, description="ISO 8601; solo leads creados después"),
    estado: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    pool=Depends(get_pool),
):
    """Descubrimiento/polling: Talal lo llama en un workflow programado con
    `since` = el `created_at` del último lead que ya trajo."""
    desde = None
    if since:
        try:
            desde = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="since inválido (ISO 8601)")
    if estado is not None and estado not in _ESTADOS:
        raise HTTPException(status_code=400, detail=f"estado inválido (válidos: {sorted(_ESTADOS)})")

    rows = await pool.fetch(
        _LEAD_SELECT + """
        WHERE ($1::timestamptz IS NULL OR v.created_at > $1)
          AND ($2::text IS NULL OR v.estado = $2)
        ORDER BY v.created_at DESC
        LIMIT $3
        """,
        desde, estado, limit,
    )
    return {"count": len(rows), "leads": [_lead(r) for r in rows]}


@router.get("/leads/{visita_id}", dependencies=[Depends(require_ghl_token)])
async def obtener_lead(visita_id: str, pool=Depends(get_pool)):
    """GET por ID — para re-sincronizar un lead puntual desde GHL."""
    row = await pool.fetchrow(_LEAD_SELECT + " WHERE v.id = $1", visita_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return _lead(row)
