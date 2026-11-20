"""Solicitudes de visita a un listing — POST público desde el drawer del mapa."""
import asyncio
import json
import logging
import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from api.db import get_pool
from api.dependencies import get_optional_user
from api.limiter import limiter
from api.utils import ghl_client

router = APIRouter()
log = logging.getLogger(__name__)

# Buzón interno para visitas de inmuebles SIN agente patrocinador de la zona.
RENTAL_INQUIRIES_TO = os.getenv("RENTAL_INQUIRIES_TO", "rentalinquiries@medellinsocial.com")


def _send_visita_email(req: "VisitaRequest", fecha: Optional[datetime]) -> None:
    """Envía la solicitud al buzón interno vía SMTP. Si SMTP no está configurado,
    solo loguea (la fila ya quedó en DB, así que no se pierde nada). Nunca lanza."""
    host = os.getenv("SMTP_HOST")
    if not host:
        log.warning("SMTP no configurado; visita sin agente NO enviada por email: %s", req.listing_url)
        return
    remitente = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "noreply@medellinsocial.com"
    cuando = fecha.strftime("%Y-%m-%d %H:%M") if fecha else "sin fecha propuesta"
    msg = EmailMessage()
    msg["Subject"] = " ".join(f"Nueva solicitud de visita — {req.listing_url}".split())  # no CR/LF
    msg["From"] = remitente
    msg["To"] = RENTAL_INQUIRIES_TO
    msg.set_content(
        f"Nueva solicitud de visita (inmueble sin agente de zona).\n\n"
        f"Inmueble: {req.listing_url}\n"
        f"Nombre:   {req.nombre or '—'}\n"
        f"Teléfono: {req.telefono or '—'}\n"
        f"Fecha:    {cuando}\n"
        f"Mensaje:  {req.mensaje or '—'}\n"
    )
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port, timeout=10) as srv:
            srv.starttls()
            user, pw = os.getenv("SMTP_USER"), os.getenv("SMTP_PASS")
            if user and pw:
                srv.login(user, pw)
            srv.send_message(msg)
        log.info("Visita sin agente enviada a %s (%s)", RENTAL_INQUIRIES_TO, req.listing_url)
    except Exception:  # noqa: BLE001 — email es best-effort; la fila ya está en DB
        log.exception("Falló envío de email de visita para %s", req.listing_url)


class VisitaRequest(BaseModel):
    listing_url: str = Field(min_length=1, max_length=600)
    nombre: Optional[str] = Field(None, max_length=120)
    telefono: Optional[str] = Field(None, max_length=30)
    fecha_visita: Optional[str] = None  # ISO datetime
    mensaje: Optional[str] = Field(None, max_length=1000)
    # True cuando el inmueble no tiene agente patrocinador de zona → va al buzón interno.
    sin_agente: bool = False
    # Calificación del lead (modelo Zillow paso 2) — todos opcionales: el form los
    # pide sin obligar para no frenar la conversión. Literal valida en el boundary.
    intencion: Optional[Literal["vivir", "invertir"]] = None
    presupuesto: Optional[Literal["<200M", "200-500M", "500-1000M", ">1000M"]] = None
    plazo: Optional[Literal["ya", "1-3m", "3-6m", "explorando"]] = None
    credito: Optional[Literal["contado", "aprobado", "en_tramite", "no"]] = None


# Prospecto (#7): resuelve el realtor patrocinador de la zona del inmueble a partir
# del listing_url (staging → barrio_id/comuna → sponsorship vigente). Prioriza
# patrocinio de comuna sobre barrio y al owner de la agencia. Mismo criterio que
# _LISTING_AGENT_ID_SQL (listings.py, slots de visita) pero keyando por url.
_VISITA_ZONA_AGENT_SQL = """
WITH lz AS (
    SELECT l.barrio_id, bc.cd_comuna
    FROM staging.stg_listings_unificado l
    LEFT JOIN analytics.barrios_cd bc ON bc.barrio_id = l.barrio_id
    WHERE l.url = $1
    LIMIT 1
)
SELECT a.id
FROM sponsorship s
JOIN agency_member am ON am.agency_id = s.agency_id
JOIN agent a ON a.id = am.agent_id AND a.estado = 'activo'
JOIN lz ON ((s.zona_nivel = 'barrio' AND s.zona_codigo = lz.barrio_id::text)
         OR (s.zona_nivel = 'comuna' AND s.zona_codigo = lz.cd_comuna::text))
WHERE s.estado = 'activa' AND CURRENT_DATE BETWEEN s.fecha_inicio AND s.fecha_fin
ORDER BY CASE WHEN s.zona_nivel = 'comuna' THEN 0 ELSE 1 END,
         CASE WHEN am.rol::text = 'owner' THEN 0 ELSE 1 END, s.fecha_inicio
LIMIT 1
"""


@router.post("", status_code=201)
@limiter.limit("5/minute")
async def crear_visita(
    request: Request,
    req: VisitaRequest = Body(...),
    user: Optional[dict] = Depends(get_optional_user),
    pool=Depends(get_pool),
):
    fecha = None
    if req.fecha_visita:
        try:
            fecha = datetime.fromisoformat(req.fecha_visita.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="fecha_visita inválida (ISO 8601)")
    async with pool.acquire() as conn:
        # Auto-populate agent_id if listing.id::text matches the url (new listing model)
        agent_id = await conn.fetchval(
            "SELECT agent_id FROM listing WHERE id::text = $1",
            req.listing_url,
        )
        # Prospecto (#7): si no es un listing propio, rutear al realtor PATROCINADOR
        # de la zona del inmueble (barrio → comuna). Así una visita sobre un aviso
        # scrapeado en zona patrocinada igual aterriza en el realtor que paga la zona
        # — sin esto el agent_id quedaba NULL y la visita no le llegaba a nadie.
        if agent_id is None:
            agent_id = await conn.fetchval(_VISITA_ZONA_AGENT_SQL, req.listing_url)
        row = await conn.fetchrow(
            """
            INSERT INTO visita_solicitud
                (listing_url, usuario_id, nombre, telefono, fecha_visita, mensaje, agent_id,
                 intencion, presupuesto, plazo, credito)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
            """,
            req.listing_url,
            user["id"] if user else None,
            req.nombre or (user or {}).get("nombre"),
            req.telefono,
            fecha,
            req.mensaje,
            agent_id,
            req.intencion,
            req.presupuesto,
            req.plazo,
            req.credito,
        )
        # Lead (capa 4 del funnel): la visita agendada es la señal de lead más
        # fuerte. event_type='visit_request' (no termina en _click/_save → no se
        # confunde con Intención). Ver docs/FUNNEL_B2B.md.
        try:
            await conn.execute(
                """INSERT INTO public.user_events
                       (usuario_id, session_id, event_type, entity_type, entity_id, metadata)
                   VALUES ($1, $2, 'visit_request', 'listing', $3, $4::jsonb)""",
                user["id"] if user else None,
                f"visit-{row['id']}",
                req.listing_url,
                json.dumps({"intencion": req.intencion} if req.intencion else {}),
            )
        except Exception:
            log.warning("visit_request event insert falló (listing=%s)", req.listing_url, exc_info=True)
    # Sin agente de zona → notificar al buzón interno (fuera del event loop; best-effort).
    if req.sin_agente:
        await asyncio.to_thread(_send_visita_email, req, fecha)
    # Push best-effort a GHL como Contact (+ nota). Las visitas también salen por
    # PULL (/api/v1/ghl/leads); un fallo aquí queda en ghl_push_failures y no
    # rompe la solicitud.
    try:
        await ghl_client.sync_visita(row["id"])
    except Exception:
        log.exception("sync_visita(%s) falló", row["id"])
    return {"id": str(row["id"]), "estado": "pendiente"}
