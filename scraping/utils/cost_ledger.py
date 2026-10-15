"""Paid-API call ledger + monthly cap (AirROI, Google Places).

Every billable request goes through charge() first: it refuses the call once the
provider's monthly cap is reached and records it in raw.api_cost_ledger
(migration 0112), so spend is visible and bounded instead of open-ended.

Caps (calls per calendar month, env-overridable):
    AIRROI_MONTHLY_CALL_CAP          default 1000
    GOOGLE_PLACES_MONTHLY_CALL_CAP   default 5000
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)

_DEFAULT_CAPS = {"airroi": 1000, "google_places": 5000}
_conn = None


class BudgetExceeded(RuntimeError):
    pass


def _cap(proveedor: str) -> int:
    raw = os.getenv(f"{proveedor.upper()}_MONTHLY_CALL_CAP", "").strip()
    return int(raw) if raw.isdigit() else _DEFAULT_CAPS.get(proveedor, 1000)


def _connection():
    global _conn
    if _conn is None or _conn.closed:
        import psycopg2
        from scraping.utils.db import get_db_url
        _conn = psycopg2.connect(get_db_url())
        _conn.autocommit = True
    return _conn


def charge(proveedor: str, endpoint: str, costo_usd_est: float | None = None) -> None:
    """Record one billable call; raise BudgetExceeded when the month's cap is used up.

    If the ledger itself is unavailable (no DB / table missing) the call is
    allowed and a warning is logged: the ledger must never be the reason a job
    dies, but it must never be silently bypassed either."""
    try:
        cur = _connection().cursor()
        cur.execute(
            "SELECT COALESCE(SUM(llamadas), 0) FROM raw.api_cost_ledger "
            "WHERE proveedor = %s AND created_at >= date_trunc('month', NOW())",
            (proveedor,),
        )
        used = int(cur.fetchone()[0])
        cap = _cap(proveedor)
        if used >= cap:
            raise BudgetExceeded(f"{proveedor}: monthly cap reached ({used}/{cap} calls)")
        cur.execute(
            "INSERT INTO raw.api_cost_ledger (proveedor, endpoint, llamadas, costo_usd_est) VALUES (%s, %s, 1, %s)",
            (proveedor, endpoint, costo_usd_est),
        )
    except BudgetExceeded:
        raise
    except Exception as e:
        log.warning("cost ledger unavailable (%s) — call to %s allowed but NOT recorded", e, proveedor)
