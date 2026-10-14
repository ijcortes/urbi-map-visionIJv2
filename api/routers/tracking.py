from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from api.limiter import client_ip, event_throttle, limiter, view_throttle
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from api.db import get_pool
from api.dependencies import get_optional_user

router = APIRouter()


_MAX_METADATA_BYTES = 4096


class TrackEvent(BaseModel):
    # Anonymous endpoint: every field is size-capped so one call cannot bloat the DB.
    session_id: str = Field(min_length=1, max_length=100)
    event_type: str = Field(min_length=1, max_length=60)
    entity_type: Optional[str] = Field(default=None, max_length=60)
    entity_id: Optional[str] = Field(default=None, max_length=600)
    barrio_id: Optional[int] = None
    duration_ms: Optional[int] = Field(default=None, ge=0, le=86_400_000)
    metadata: Optional[dict[str, Any]] = None

    @field_validator("metadata")
    @classmethod
    def _metadata_small(cls, v):
        if v is not None and len(json.dumps(v, default=str)) > _MAX_METADATA_BYTES:
            raise ValueError("metadata demasiado grande")
        return v


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

    # De-duplicate so a loop cannot inflate view counts: one 'listing_view' per
    # (IP, entity) per 30 min; any other event with an entity once per 5 s.
    # Dropped events still answer ok (no oracle, no client retry storm).
    if req.entity_id and not req.event_type.endswith(("_close", "_exit")):
        key = f"{client_ip(request)}|{req.event_type}|{req.entity_type}|{req.entity_id}"
        throttle = view_throttle if req.event_type == "listing_view" else event_throttle
        if not throttle.allow(key):
            return JSONResponse(content={"ok": True}, status_code=200)

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
