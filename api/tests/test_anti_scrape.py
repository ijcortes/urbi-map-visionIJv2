"""AntiScrapeMiddleware: blocks scraper UAs on the API, lets browsers/crawlers
and server-to-server paths through. Pure-ASGI unit — no DB, no app lifespan."""
from api.utils.anti_scrape import AntiScrapeMiddleware


async def _drive(ua: bytes, path: str = "/api/v1/listings"):
    """Run the middleware once; return (status, inner_app_reached)."""
    reached = {"v": False}

    async def inner(scope, receive, send):
        reached["v"] = True
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    mw = AntiScrapeMiddleware(inner)
    headers = [(b"user-agent", ua)] if ua is not None else []
    scope = {"type": "http", "method": "GET", "path": path, "headers": headers}
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(msg):
        sent.append(msg)

    await mw(scope, receive, send)
    status = next((m["status"] for m in sent if m["type"] == "http.response.start"), None)
    return status, reached["v"]


async def test_scraper_ua_blocked():
    for ua in (b"python-requests/2.31.0", b"curl/8.4.0", b"Scrapy/2.11",
               b"Go-http-client/2.0", b"HeadlessChrome/120.0"):
        status, reached = await _drive(ua)
        assert status == 403, ua
        assert reached is False, ua


async def test_browser_and_crawler_allowed():
    for ua in (b"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36",
               b"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
               b"Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"):
        status, reached = await _drive(ua)
        assert reached is True, ua
        assert status == 200, ua


async def test_empty_ua_not_blocked():
    # Internal SSR / fetch clients send no UA — must pass (see middleware note).
    status, reached = await _drive(b"")
    assert reached is True
    assert status == 200


async def test_exempt_paths_pass_even_for_tools():
    for path in ("/health", "/api/v1/webhook/ghl", "/api/v1/ghl/leads"):
        status, reached = await _drive(b"python-requests/2.31.0", path=path)
        assert reached is True, path
        assert status == 200, path
