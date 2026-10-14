"""Regression tests for the 2026-10 security report (no DB needed).

H1/H2/M3..M8 behaviours that need a database live in test_security_fixes_db.py.
"""
import asyncio
import importlib
import json

import jwt
import pytest
from starlette.requests import Request

from api import limiter as lim
from api.dependencies import JWT_ALGORITHM, JWT_SECRET
from api.routers import auth as auth_mod
from api.utils import email as email_mod
from api.utils.body_limit import BodySizeLimitMiddleware
from api.utils.urls import require_plain_text, require_safe_url


def _req(headers=None, peer="10.0.0.9"):
    scope = {
        "type": "http", "method": "GET", "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (peer, 1234),
    }
    return Request(scope)


# ── M6: token_version claim + shorter expiry ────────────────────────────────

def test_token_has_tv_iat_exp_and_default_expiry_is_7_days(monkeypatch):
    monkeypatch.delenv("JWT_EXPIRY_HOURS", raising=False)
    p = jwt.decode(auth_mod._make_token(5, 3), JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert p["sub"] == "5" and p["tv"] == 3
    assert p["exp"] - p["iat"] == 168 * 3600


def test_expiry_env_is_honoured_and_capped(monkeypatch):
    monkeypatch.setenv("JWT_EXPIRY_HOURS", "2")
    p = jwt.decode(auth_mod._make_token(1), JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert p["exp"] - p["iat"] == 2 * 3600
    monkeypatch.setenv("JWT_EXPIRY_HOURS", "99999")
    p = jwt.decode(auth_mod._make_token(1), JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert p["exp"] - p["iat"] == 720 * 3600  # blacklist purge window is 30 d


@pytest.mark.asyncio
async def test_forged_and_tokens_without_exp_are_rejected():
    from fastapi import HTTPException
    from api.dependencies import _get_user_from_token

    none_alg = jwt.encode({"sub": "1", "exp": 4102444800}, key="", algorithm="none")
    no_exp = jwt.encode({"sub": "1"}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    wrong_key = jwt.encode({"sub": "1", "exp": 4102444800}, "x" * 40, algorithm=JWT_ALGORITHM)
    for tok in (none_alg, no_exp, wrong_key, "garbage"):
        with pytest.raises(HTTPException) as e:
            await _get_user_from_token(tok)
        assert e.value.status_code == 401


# ── H2: admin fails closed ──────────────────────────────────────────────────

def test_require_admin_needs_matching_verified_account():
    from fastapi import HTTPException
    from api.routers.admin import ADMIN_EMAIL, require_admin

    assert require_admin({"email": ADMIN_EMAIL, "email_verificado": True})
    for u in (
        {"email": ADMIN_EMAIL, "email_verificado": False},
        {"email": ADMIN_EMAIL},                       # field missing -> closed
        {"email": "other@x.com", "email_verificado": True},
        {"email": None, "email_verificado": True},
    ):
        with pytest.raises(HTTPException) as e:
            require_admin(u)
        assert e.value.status_code == 403


def test_admin_and_reserved_emails_are_reserved(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "Boss@Example.com")
    monkeypatch.setenv("RESERVED_EMAILS", "ceo@example.com, Ops@example.com")
    assert auth_mod._reserved_emails() == {"boss@example.com", "ceo@example.com", "ops@example.com"}


# ── M5: rate-limit keying ───────────────────────────────────────────────────

def test_client_ip_ignores_spoofable_headers_when_zero_hops(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", "0")
    r = _req({"x-real-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7"}, peer="1.2.3.4")
    assert lim._client_ip(r) == "1.2.3.4"


def test_client_ip_default_off_railway_is_fail_closed(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_COUNT", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    assert lim._client_ip(_req({"x-real-ip": "6.6.6.6"}, peer="1.2.3.4")) == "1.2.3.4"


def test_client_ip_railway_legacy_mode_still_uses_edge_header(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_COUNT", raising=False)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    assert lim._client_ip(_req({"x-real-ip": "8.8.8.8"}, peer="100.64.0.1")) == "8.8.8.8"


def test_client_ip_counts_hops_from_the_right(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", "1")
    # attacker prepends a fake entry; the one proxy appended the real peer address
    r = _req({"x-forwarded-for": "6.6.6.6, 9.9.9.9"}, peer="10.0.0.1")
    assert lim._client_ip(r) == "9.9.9.9"
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", "2")
    assert lim._client_ip(r) == "6.6.6.6"
    # fewer entries than hops: fall back to the leftmost (never IndexError)
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", "5")
    assert lim._client_ip(r) == "6.6.6.6"


def test_keyed_throttle_window():
    t = lim.KeyedThrottle(max_events=2, window_s=60)
    assert t.allow("a") and t.allow("a") and not t.allow("a")
    assert t.allow("b")
    t.reset()
    assert t.allow("a")


# ── M4: email escaping ──────────────────────────────────────────────────────

EVIL = '<img src=x onerror=alert(1)><a href="https://evil">pay</a>'


@pytest.fixture
def sent(monkeypatch):
    box = []

    async def fake(to, subject, html):
        box.append((to, subject, html))

    monkeypatch.setattr(email_mod, "send_email", fake)
    return box


@pytest.mark.asyncio
async def test_all_user_fields_are_escaped_in_email_templates(sent):
    await email_mod.send_verify_email("v@x.com", EVIL, "https://app/verify?t=1")
    await email_mod.send_reset_password("v@x.com", EVIL, "https://app/reset?t=1")
    await email_mod.notify_admin_new_agente(EVIL, EVIL, EVIL, EVIL, "https://app/admin")
    await email_mod.notify_admin_reclamo(EVIL, EVIL, EVIL, EVIL, "javascript:alert(1)", EVIL)
    await email_mod.notify_agente_aprobado("v@x.com", EVIL, "https://app/d")
    await email_mod.notify_agente_rechazado("v@x.com", EVIL, EVIL, "https://app/f")
    await email_mod.send_invite_agencia("v@x.com", EVIL, type("U", (), {"nombre": EVIL})(), "https://app/i")
    assert len(sent) == 7
    for _to, subject, html in sent:
        assert "<img src=x" not in html and 'href="https://evil"' not in html
        assert "&lt;img" in html
        assert "\n" not in subject
    # non-http(s) link targets are neutralised
    reclamo_html = sent[3][2]
    assert 'href="javascript:' not in reclamo_html and 'href="#"' in reclamo_html


@pytest.mark.asyncio
async def test_router_email_helpers_escape(monkeypatch):
    from api.routers import listings_propios as lp

    box = []

    async def fake(to, subject, html):
        box.append(html)

    monkeypatch.setattr(lp, "send_email", fake)
    await lp._notify_admin_new_listing(1, EVIL, EVIL, 1000.0, EVIL, EVIL)
    await lp._notify_agente_nueva_solicitud(
        1, {"email": "a@x.com", "nombre": EVIL},
        {"precio_cop": 1.0, "tipo_inmueble": EVIL, "tipo_operacion": EVIL},
        {"nombre": EVIL, "apellido": EVIL, "email": EVIL},
    )
    await lp._notify_propietario_respuesta("aceptar", "p@x.com", EVIL, EVIL, 1)
    assert len(box) == 3 and all("<img src=x" not in h for h in box)


@pytest.mark.asyncio
async def test_send_email_strips_header_injection(monkeypatch):
    got = {}
    import api.utils.gmail_api as g

    monkeypatch.setattr(g, "is_configured", lambda: True)

    async def fake(to, subject, html):
        got.update(to=to, subject=subject)

    monkeypatch.setattr(g, "send_via_gmail_api", fake)
    await email_mod.send_email("a@x.com\r\nBcc: z@x.com", "hi\r\nBcc: evil@x.com", "<p>x</p>")
    assert "\n" not in got["subject"] and "\r" not in got["to"] and "\n" not in got["to"]


# ── H3: server-side validation of /mi-negocio ───────────────────────────────

def test_require_safe_url_rejects_scheme_and_breakout_chars():
    assert require_safe_url("https://ok.com/a?b=1") == "https://ok.com/a?b=1"
    for bad in ("javascript:alert(1)", "data:text/html,x", "//evil.com", "http:///x",
                "https://a.com/'onerror=1", 'https://a.com/"x', "https://a.com/<x>", "https://a b.com"):
        with pytest.raises(ValueError):
            require_safe_url(bad)


def test_mi_negocio_model_rejects_markup_and_bad_urls():
    from pydantic import ValidationError
    from api.routers.business import MiNegocioIn

    ok = MiNegocioIn(nombre="Café & Co", categoria="cafe", website="https://cafe.co")
    assert ok.nombre == "Café & Co"
    for field, value in (("nombre", EVIL), ("direccion", "<script>x</script>"),
                         ("website", "javascript:alert(1)"), ("foto_url", "data:image/svg+xml,<svg onload=1>"),
                         ("categoria", "x" * 500)):
        with pytest.raises(ValidationError):
            MiNegocioIn(**{"nombre": "n", "categoria": "c", field: value})


def test_require_plain_text():
    f = require_plain_text(5)
    assert f("  ab ") == "ab" and f("   ") is None and f(None) is None
    for bad in ("<b>", "a\x00", "toolong"):
        with pytest.raises(ValueError):
            f(bad)


# ── M7: body cap + tracking caps ─────────────────────────────────────────────

async def _call(app, body: bytes, headers, chunks=None):
    sent = []
    msgs = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
            for i, c in enumerate(chunks)] if chunks else [{"type": "http.request", "body": body, "more_body": False}]

    async def receive():
        return msgs.pop(0) if msgs else {"type": "http.disconnect"}

    async def send(m):
        sent.append(m)

    await app({"type": "http", "method": "POST", "path": "/", "headers": headers}, receive, send)
    return sent


async def _echo(scope, receive, send):
    n = 0
    while True:
        m = await receive()
        n += len(m.get("body", b""))
        if not m.get("more_body"):
            break
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": str(n).encode()})


@pytest.mark.asyncio
async def test_body_limit_by_content_length_and_streaming():
    app = BodySizeLimitMiddleware(_echo, max_bytes=100, max_multipart_bytes=1000)
    ct = [(b"content-type", b"application/json")]
    ok = await _call(app, b"x" * 100, ct + [(b"content-length", b"100")])
    assert ok[0]["status"] == 200
    big = await _call(app, b"x" * 101, ct + [(b"content-length", b"101")])
    assert big[0]["status"] == 413
    # no Content-Length (chunked): counted while streaming
    streamed = await _call(app, b"", ct, chunks=[b"x" * 60, b"x" * 60])
    assert streamed[0]["status"] == 413
    mp = await _call(app, b"x" * 500, [(b"content-type", b"multipart/form-data; boundary=x"), (b"content-length", b"500")])
    assert mp[0]["status"] == 200  # multipart gets the larger cap


def test_track_event_caps():
    from pydantic import ValidationError
    from api.routers.tracking import TrackEvent

    TrackEvent(session_id="s", event_type="listing_view", entity_id="e", metadata={"a": 1})
    for kw in ({"session_id": "s" * 101}, {"entity_id": "e" * 601}, {"metadata": {"k": "v" * 5000}},
               {"duration_ms": -1}):
        base = {"session_id": "s", "event_type": "t"}
        base.update(kw)
        with pytest.raises(ValidationError):
            TrackEvent(**base)


# ── M8: fail closed ──────────────────────────────────────────────────────────

def test_cors_and_docs_fail_closed(monkeypatch):
    import api.main as m

    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("EXPOSE_DOCS", raising=False)
    try:
        m2 = importlib.reload(m)
        assert m2.app.docs_url is None and m2.app.redoc_url is None and m2.app.openapi_url is None
        assert not any("localhost" in o for o in m2._build_origins())
    finally:
        importlib.reload(m)


# ── scraper secrets ──────────────────────────────────────────────────────────

def test_scrapers_have_no_embedded_key():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2]
    for rel in ("scraping/habi/habi_scraper.py", "scraping/metrocuadrado/scraper.py"):
        src = (root / rel).read_text()
        assert "VnXl" not in src and "P1Mf" not in src


def test_scrapers_fail_clearly_without_env_key(monkeypatch):
    pytest.importorskip("rapidfuzz")  # scraping deps are not in the API requirements
    monkeypatch.delenv("HABI_API_KEY", raising=False)
    monkeypatch.delenv("METROCUADRADO_API_KEY", raising=False)
    habi = importlib.import_module("scraping.habi.habi_scraper")
    mc = importlib.import_module("scraping.metrocuadrado.scraper")
    monkeypatch.setattr(habi, "API_KEY", "")
    monkeypatch.setattr(mc, "API_KEY", "")
    with pytest.raises(RuntimeError, match="HABI_API_KEY"):
        habi._headers()
    with pytest.raises(RuntimeError, match="METROCUADRADO_API_KEY"):
        mc._require_api_key()


def test_suscribirse_response_has_no_id_or_existence_flag():
    from api.routers.usuario import SuscribirseOut
    assert set(SuscribirseOut.model_fields) == {"success"}
