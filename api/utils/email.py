"""Simple email sender — Gmail API (OAuth2) if configured, else plain SMTP.

send_email() tries api.utils.gmail_api first (see that module for its env
vars: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN /
GMAIL_SENDER). Falls back to SMTP below when Gmail API isn't configured.

SMTP env vars:
  SMTP_HOST   — default: smtp.gmail.com
  SMTP_PORT   — default: 587
  SMTP_USER   — Gmail address used to send
  SMTP_PASS   — Gmail app password
  EMAIL_FROM  — display name + address, default = SMTP_USER
  ADMIN_EMAIL — Eduard/Ken notification address
"""
from __future__ import annotations

import os
import smtplib
import asyncio
from api.utils.pii import mask_email
from html import escape as _html_escape
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

_SMTP_HOST  = os.getenv("SMTP_HOST", "smtp.gmail.com")
_SMTP_PORT  = int(os.getenv("SMTP_PORT", "587"))
_SMTP_USER  = os.getenv("SMTP_USER", "")
_SMTP_PASS  = os.getenv("SMTP_PASS", "")
_FROM       = os.getenv("EMAIL_FROM", _SMTP_USER)
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "edwardgiraldo101@gmail.com")


def esc(value: object) -> str:
    """HTML-escape a user-controlled value before it is interpolated into an
    email template (text nodes AND double-quoted attributes). Every user field
    must go through this: the templates are sent from the platform's own
    sender, so unescaped input would be a phishing relay."""
    return _html_escape("" if value is None else str(value), quote=True)


def safe_url(url: object) -> str:
    """Escaped URL for href attributes; anything that is not http(s) becomes '#'."""
    u = ("" if url is None else str(url)).strip()
    if not u.lower().startswith(("http://", "https://")):
        return "#"
    return _html_escape(u, quote=True)


def _one_line(value: str) -> str:
    return " ".join(str(value).replace("\r", " ").replace("\n", " ").split())


def _send_sync(to: str, subject: str, html: str) -> None:
    if not _SMTP_USER or not _SMTP_PASS:
        # Dev fallback: print to stdout so the feature doesn't break
        print(f"[EMAIL STUB] To={mask_email(to)} Subject={subject}")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = _FROM
    msg["To"]      = to
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(_SMTP_USER, _SMTP_PASS)
        server.sendmail(_FROM, [to], msg.as_string())


async def send_email(to: str, subject: str, html: str) -> None:
    from api.utils.gmail_api import is_configured, send_via_gmail_api

    subject = _one_line(subject)  # user data in subjects must not inject headers
    to = _one_line(to)

    if is_configured():
        await send_via_gmail_api(to, subject, html)
        return

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_sync, to, subject, html)


# ── Templates ─────────────────────────────────────────────────────────────────

def _wrap(body: str) -> str:
    return f"""
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#14201d">
      <div style="background:#1D9E75;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0;font-family:Georgia,serif">Medellín Social</h2>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e9e4d8;border-top:none;border-radius:0 0 8px 8px">
        {body}
      </div>
      <p style="font-size:11px;color:#999;text-align:center;margin-top:16px">
        Medellín Social · Valle de Aburrá, Colombia
      </p>
    </div>
    """


async def notify_admin_new_agente(nombre: str, cedula: str, email: str, telefono: str, admin_url: str) -> None:
    nombre_h = esc(nombre)
    cedula_h = esc(cedula)
    email_h = esc(email)
    telefono_h = esc(telefono)
    admin_url_h = safe_url(admin_url)
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Nueva solicitud de agente</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px;color:#62736d;width:140px">Nombre</td><td style="padding:6px;font-weight:600">{nombre_h}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Cédula</td><td style="padding:6px">{cedula_h}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Email</td><td style="padding:6px">{email_h}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Teléfono</td><td style="padding:6px">{telefono_h}</td></tr>
      </table>
      <div style="margin-top:20px">
        <a href="{admin_url_h}" style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
          Ver en panel admin
        </a>
      </div>
    """)
    await send_email(ADMIN_EMAIL, f"Nueva solicitud de agente — {nombre}", html)


async def notify_admin_reclamo(
    nombre: str, telefono: str, email: str, matricula: str,
    listing_url: str, mensaje: str,
) -> None:
    nombre_h = esc(nombre)
    telefono_h = esc(telefono)
    email_h = esc(email)
    matricula_h = esc(matricula)
    mensaje_h = esc(mensaje)
    listing_url_h = safe_url(listing_url)
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Alguien reclama un inmueble</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px;color:#62736d;width:140px">Nombre</td><td style="padding:6px;font-weight:600">{nombre_h}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Teléfono</td><td style="padding:6px">{telefono_h}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Email</td><td style="padding:6px">{email_h}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Matrícula</td><td style="padding:6px">{(matricula_h or '—')}</td></tr>
        <tr><td style="padding:6px;color:#62736d">Mensaje</td><td style="padding:6px">{(mensaje_h or '—')}</td></tr>
      </table>
      <div style="margin-top:16px">
        <a href="{listing_url_h}" style="color:#1D9E75">Ver listing reclamado →</a>
      </div>
      <p style="margin-top:12px;color:#62736d;font-size:13px">Verifica la propiedad antes de aprobar.</p>
    """)
    await send_email(ADMIN_EMAIL, f"Reclamo de inmueble — {nombre}", html)


async def notify_agente_aprobado(email: str, nombre: str, dashboard_url: str) -> None:
    nombre_h = esc(nombre)
    dashboard_url_h = safe_url(dashboard_url)
    html = _wrap(f"""
      <h3 style="color:#1D9E75">¡Tu cuenta de agente fue aprobada!</h3>
      <p>Hola {nombre_h},</p>
      <p>Tu solicitud ha sido revisada y aprobada. Ya puedes publicar listings en Medellín Social.</p>
      <div style="margin-top:20px">
        <a href="{dashboard_url_h}" style="background:#1D9E75;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
          Ir a mi perfil
        </a>
      </div>
      <p style="margin-top:16px;font-size:13px;color:#62736d">
        Para publicar tu primer listing ve a la sección Real Estate desde el menú principal.
      </p>
    """)
    await send_email(email, "¡Tu cuenta de agente en Medellín Social fue aprobada!", html)


async def send_verify_email(to: str, nombre: str, verify_url: str) -> None:
    nombre_h = esc(nombre)
    verify_url_h = safe_url(verify_url)
    nombre_display = esc(nombre or to)
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Confirma tu correo electrónico</h3>
      <p>Hola {nombre_display},</p>
      <p>Gracias por registrarte en Medellín Social. Haz clic en el botón para confirmar tu correo:</p>
      <div style="margin-top:24px">
        <a href="{verify_url_h}"
           style="background:#1D9E75;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
          Confirmar correo
        </a>
      </div>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Este enlace es válido por 24 horas. Si no creaste esta cuenta, ignora este mensaje.
      </p>
    """)
    await send_email(to, "Confirma tu correo · Medellín Social", html)


async def send_reset_password(to: str, nombre: str, reset_url: str) -> None:
    nombre_h = esc(nombre)
    reset_url_h = safe_url(reset_url)
    nombre_display = esc(nombre or to)
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Restablecer contraseña</h3>
      <p>Hola {nombre_display},</p>
      <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón:</p>
      <div style="margin-top:24px">
        <a href="{reset_url_h}"
           style="background:#1D9E75;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
          Restablecer contraseña
        </a>
      </div>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Este enlace es válido por 1 hora. Si no solicitaste esto, ignora este mensaje.
      </p>
    """)
    await send_email(to, "Restablecer contraseña · Medellín Social", html)


async def send_magic_link(to: str, login_url: str) -> None:
    login_url_h = safe_url(login_url)
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Tu link para ingresar</h3>
      <p>Haz clic en el botón para entrar a Medellín Social — sin contraseña:</p>
      <div style="margin-top:24px">
        <a href="{login_url_h}"
           style="background:#1D9E75;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
          Ingresar a Medellín Social
        </a>
      </div>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Este enlace es válido por 15 minutos y funciona una sola vez. Si no lo pediste tú, ignora este mensaje.
      </p>
    """)
    await send_email(to, "Tu link para ingresar · Medellín Social", html)


async def send_invite_agencia(to: str, agency_nombre: str, invitado_por, invite_url: str) -> None:
    agency_nombre_h = esc(agency_nombre)
    invite_url_h = safe_url(invite_url)
    html = _wrap(f"""
      <h3 style="color:#1D9E75">Te invitan a unirte a {agency_nombre_h}</h3>
      <p>Hola,</p>
      <p><strong>{esc(invitado_por.nombre) if hasattr(invitado_por, 'nombre') else 'El equipo'}</strong>
         te invita a formar parte de <strong>{agency_nombre_h}</strong> en Medellín Social.</p>
      <p style="color:#62736d;font-size:13px">
        Como agente miembro recibirás leads de la agencia y podrás gestionar listings en su nombre.
      </p>
      <div style="margin-top:24px">
        <a href="{invite_url_h}"
           style="background:#1D9E75;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
          Aceptar invitación
        </a>
      </div>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Este enlace es válido por 7 días. Si no esperabas esta invitación, puedes ignorar este correo.
      </p>
    """)
    await send_email(to, f"Invitación para unirte a {agency_nombre} · Medellín Social", html)


async def notify_agente_rechazado(email: str, nombre: str, motivo: str, formulario_url: str) -> None:
    nombre_h = esc(nombre)
    motivo_h = esc(motivo)
    formulario_url_h = safe_url(formulario_url)
    html = _wrap(f"""
      <h3 style="color:#D85A30">Solicitud — información adicional requerida</h3>
      <p>Hola {nombre_h},</p>
      <p>Revisamos tu solicitud y necesitamos que corrijas lo siguiente:</p>
      <blockquote style="border-left:3px solid #D85A30;padding:8px 16px;background:#FAECE7;border-radius:0 6px 6px 0;color:#14201d">
        {motivo_h}
      </blockquote>
      <p>Una vez corregida la información puedes reenviar tu solicitud:</p>
      <div style="margin-top:16px">
        <a href="{formulario_url_h}" style="background:#D85A30;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
          Corregir y reenviar
        </a>
      </div>
    """)
    await send_email(email, "Solicitud de agente — información adicional requerida", html)
