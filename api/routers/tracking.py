from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from api.limiter import limiter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.db import get_pool
from api.dependencies import get_optional_user

router = APIRouter()


class TrackEvent(BaseModel):
    session_id: str
    event_type: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    barrio_id: Optional[int] = None
    duration_ms: Optional[int] = None
    metadata: Optional[dict[str, Any]] = None


@router.post("")
@limiter.limit("120/minute")
async def track(
    request: Request,
    req: TrackEvent,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    pool = get_pool()
    usuario_id: Optional[int] = current_user["id"] if current_user else None
    metadata = req.metadata or {}

    # Backfill duration on matching open/entry event
    if req.event_type.endswith(("_close", "_exit")):
        base = req.event_type[: req.event_type.rfind("_")]
        try:
            await pool.execute(
                """
                UPDATE public.user_events
                SET duration_ms = $1
                WHERE session_id = $2
                  AND event_type = ANY($3::varchar[])
                  AND duration_ms IS NULL
                  AND created_at > NOW() - INTERVAL '2 hours'
                """,
                req.duration_ms,
                req.session_id,
                [f"{base}_open", f"{base}_entry"],
            )
        except Exception:
            pass

    try:
        await pool.execute(
            """
            INSERT INTO public.user_events
                (usuario_id, session_id, event_type, entity_type, entity_id,
                 barrio_id, duration_ms, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            usuario_id,
            req.session_id,
            req.event_type,
            req.entity_type,
            req.entity_id,
            req.barrio_id,
            req.duration_ms,
            json.dumps(metadata),
        )
    except Exception:
        pass

    try:
        await pool.execute(
            """
            INSERT INTO public.user_sessions (session_id, usuario_id, total_eventos)
            VALUES ($1, $2, 1)
            ON CONFLICT (session_id) DO UPDATE
            SET total_eventos = public.user_sessions.total_eventos + 1,
                usuario_id = COALESCE(public.user_sessions.usuario_id, EXCLUDED.usuario_id)
            """,
            req.session_id,
            usuario_id,
        )
    except Exception:
        pass

    return JSONResponse(content={"ok": True}, status_code=200)
