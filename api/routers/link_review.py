"""One-click Retire / Keep links from the broken-link review e-mail.

GET  /api/v1/link-review/confirm?t=<token>  -> HTML confirmation page ONLY (never acts: mail scanners prefetch GETs)
POST /api/v1/link-review/confirm?t=<token>  -> performs the action (single-use, HMAC-signed, expiring)
"""
import html

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse

from api.db import get_pool
from api.limiter import limiter
from api.services import link_review as lr

router = APIRouter()

_MSG = {
    "malformed": "This link is not valid.",
    "bad_signature": "This link is not valid.",
    "expired": "This link has expired. A reminder e-mail with fresh links is sent if the item is still pending.",
    "used": "This link was already used.",
    "unconfigured": "Link review is not configured on the server.",
}


def _page(title: str, body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>{html.escape(title)}</title>"
        f"<body style='font-family:sans-serif;max-width:560px;margin:40px auto'><h2>{html.escape(title)}</h2>{body}</body>",
        status_code=status, headers={"Cache-Control": "no-store"})


@router.get("/confirm", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def confirm_page(request: Request, t: str = Query(...)):
    try:
        tok = lr.verify_token(t)
    except lr.TokenError as e:
        return _page("Link not valid", f"<p>{_MSG[e.kind]}</p>", 400)
    pool = get_pool()
    async with pool.acquire() as conn:
        if await lr.token_is_used(conn, tok["jti"]):
            return _page("Link already used", f"<p>{_MSG['used']}</p>", 410)
    what = {"retire": "RETIRE this listing (it will be removed from the site)",
            "keep": "KEEP this listing (the original link is restored; not re-proposed for 30 days)",
            "retire_all": "RETIRE ALL listings in this review batch"}[tok["action"]]
    target = "" if tok["action"] == "retire_all" else f"<p><code>{html.escape(str(tok['target']))[:200]}</code></p>"
    return _page("Confirm", f"<p>You are about to {html.escape(what)}.</p>{target}"
                 f"<form method=post action='confirm?t={html.escape(t)}'><button type=submit "
                 "style='padding:10px 20px;font-size:16px'>Confirm</button></form>")


@router.post("/confirm", response_class=HTMLResponse)
@limiter.limit("30/minute")
async def confirm_action(request: Request, t: str = Query(...)):
    try:
        tok = lr.verify_token(t)
    except lr.TokenError as e:
        return _page("Link not valid", f"<p>{_MSG[e.kind]}</p>", 400)
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await lr.consume_token(conn, tok):
                return _page("Link already used", f"<p>{_MSG['used']}</p>", 410)
            res = await lr.apply_decision(conn, tok["action"], str(tok["target"]), who="email-link")
    if tok["action"] == "keep":
        return _page("Kept", f"<p>Done. Kept: {res['kept']}. The link is shown again.</p>")
    return _page("Retired", f"<p>Done. Listings retired: {res['retired']} (already-decided items were skipped).</p>")
