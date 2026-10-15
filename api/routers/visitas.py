"""Solicitudes de visita a un listing — POST público desde el drawer del mapa."""
import asyncio
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
    # Sin agente de zona → notificar al buzón interno (fuera del event loop; best-effort).
    if req.sin_agente:
        await asyncio.to_thread(_send_visita_email, req, fecha)
    # GHL recibe las visitas por PULL (/api/v1/ghl/leads). El push a un
    # Appointment (ghl_client.push_visita_to_ghl) sigue sin contrato de Talal;
    # no se llama aquí para no loguear un stack trace por cada solicitud.
    return {"id": str(row["id"]), "estado": "pendiente"}
