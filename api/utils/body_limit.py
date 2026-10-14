"""Request-body size cap (pure ASGI, streaming-safe).

Starlette/uvicorn impose no body limit, and multipart parts are spooled to disk
before any per-endpoint check can reject them. This middleware answers 413 when
the declared Content-Length is over the cap, and also counts streamed bytes for
chunked requests that declare nothing.

Env:  MAX_BODY_BYTES (default 1 MiB, JSON/other)  ·  MAX_UPLOAD_BODY_BYTES
      (default 12 MiB, multipart/form-data: image uploads are capped at 10 MiB
      by api.utils.storage, plus form overhead).
"""
from __future__ import annotations

import json
import os


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


class BodySizeLimitMiddleware:
    def __init__(self, app, max_bytes: int | None = None, max_multipart_bytes: int | None = None):
        self.app = app
        self.max_bytes = max_bytes or _env_int("MAX_BODY_BYTES", 1024 * 1024)
        self.max_multipart_bytes = max_multipart_bytes or _env_int(
            "MAX_UPLOAD_BODY_BYTES", 12 * 1024 * 1024
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        ctype = headers.get(b"content-type", b"").lower()
        limit = self.max_multipart_bytes if ctype.startswith(b"multipart/") else self.max_bytes

        cl = headers.get(b"content-length")
        if cl is not None:
            try:
                if int(cl) > limit:
                    await self._reject(send)
                    return
            except ValueError:
                await self._reject(send, 400)
                return

        total = 0
        started = False
        exceeded = False
        suppress: list[bool] = []

        async def counting_receive():
            # Never raise from receive(): inner BaseHTTPMiddleware wraps it in a task
            # group and would turn the error into an ExceptionGroup / 500. Report a
            # client disconnect instead and answer 413 ourselves afterwards.
            nonlocal total, exceeded
            if exceeded:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    exceeded = True
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message):
            nonlocal started
            if started and exceeded and message["type"].startswith("http.response") and suppress:
                return  # swallow whatever the app still wants to send after our 413
            if message["type"] == "http.response.start":
                if exceeded:
                    # The app answered anyway after seeing a truncated body: replace it.
                    suppress.append(True)
                    started = True
                    await self._reject(send)
                    return
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except Exception:
            if exceeded and not started:
                await self._reject(send)
                return
            raise
        if exceeded and not started:
            await self._reject(send)

    @staticmethod
    async def _reject(send, status: int = 413):
        detail = "Cuerpo de la petición demasiado grande" if status == 413 else "Content-Length inválido"
        body = json.dumps({"detail": detail}).encode()
        await send({
            "type": "http.response.start", "status": status,
            "headers": [(b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"connection", b"close")],
        })
        await send({"type": "http.response.body", "body": body})
