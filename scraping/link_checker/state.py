"""Pure state machine: previous health row + new verdict -> next health row.

Rules: blocked is neutral (never gone, never resets), errors only flip to 'error' after a
threshold, 'gone' needs `strikes` observations at least `strike_gap_hours` apart and only yields
'pending_review' (a human retires it later); a recent human 'keep' suppresses re-proposals; success resets.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from .classify import BLOCKED, ERROR, GONE, OK, REDIRECTED
from .config import Settings

SUSPECT = "gone_suspect"   # gone seen while the mass-gone brake was engaged: recorded, never counted


def next_state(prev: dict | None, result: str, *, now: datetime, cfg: Settings,
               http_status: int | None = None, final_url: str | None = None,
               error: str | None = None) -> dict:
    p = dict(prev or {})
    st = {
        "url_status": p.get("url_status") or "unknown",
        "consecutive_failures": p.get("consecutive_failures") or 0,
        "consecutive_gone": p.get("consecutive_gone") or 0,
        "first_gone_at": p.get("first_gone_at"),
        "last_gone_at": p.get("last_gone_at"),
        "last_ok_at": p.get("last_ok_at"),
        "last_result": result,
        "http_status": http_status,
        "final_url": final_url,
        "last_checked_at": now,
        "check_error": error,
        "priority": 0 if result != BLOCKED else (p.get("priority") or 0),
        "review_notified_at": p.get("review_notified_at"),
        "review_batch": p.get("review_batch"),
        "keep_until": p.get("keep_until"),
        "review_generation": p.get("review_generation") or 0,
        "first_notified_at": p.get("first_notified_at"),
        "last_gone_confirmed_at": p.get("last_gone_confirmed_at"),
        "confirmed_gone_now": False,
        "recovered": False,
    }
    if result in (OK, REDIRECTED):
        st["recovered"] = st["url_status"] in ("gone", "pending_review")
        st.update(url_status=result, consecutive_failures=0, consecutive_gone=0,
                  first_gone_at=None, last_gone_at=None, last_ok_at=now, check_error=None,
                  review_notified_at=None, review_batch=None, first_notified_at=None, last_gone_confirmed_at=None)
    elif result == GONE:
        last = st["last_gone_at"]
        gap = timedelta(hours=cfg.strike_gap_hours)
        if st["consecutive_gone"] == 0 or last is None or now - last >= gap:
            st["consecutive_gone"] += 1
            st["last_gone_at"] = now
            st["first_gone_at"] = st["first_gone_at"] or now
        st["last_gone_confirmed_at"] = now       # conclusive 'gone' observation (auto-retire needs a recent one)
        kept = p.get("keep_until") is not None and p["keep_until"] > now   # human said "keep": do not re-propose yet
        if st["consecutive_gone"] >= cfg.strikes and not kept:
            if st["url_status"] not in ("gone", "pending_review"):
                st["confirmed_gone_now"] = True      # NEW review candidate; nothing is deactivated here
                st["url_status"] = "pending_review"
                st["review_generation"] += 1         # new pending episode: invalidates tokens of older ones
                st["first_notified_at"] = None
    elif result == BLOCKED:
        if st["url_status"] in ("unknown", "blocked"):
            st["url_status"] = "blocked"
        # counters untouched: a block says nothing about the listing
    elif result == ERROR:
        st["consecutive_failures"] += 1
        if st["consecutive_failures"] >= cfg.error_threshold and st["url_status"] not in ("gone", "pending_review"):
            st["url_status"] = "error"
    elif result == SUSPECT:
        pass   # recorded in last_result only
    return st
