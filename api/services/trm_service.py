"""Single source of truth for the COP/<moneda> exchange rate.

Used by the /trm endpoint AND by every listings endpoint that converts prices
(`precio_usd` output, `moneda=USD` price filters), so the frontend, the popup
and the filters can never disagree on the rate.

Source order: public.trm (row per moneda) -> env fallback (USD_TO_COP /
EUR_TO_COP, see api/config). Cached in-process for a few minutes so a map pan
never costs a DB round-trip for the rate.
"""
from __future__ import annotations

import time
from typing import Optional

from api.config import EUR_TO_COP, USD_TO_COP
from api.db import get_pool

_FALLBACK = {"USD": USD_TO_COP, "EUR": EUR_TO_COP}
_TTL = 300  # seconds
_cache: dict[str, tuple[float, Optional[str], float]] = {}  # moneda -> (valor, vigencia, ts)


def clear_cache() -> None:
    _cache.clear()


async def get_trm(moneda: str = "USD") -> tuple[float, Optional[str]]:
    """Return (COP per 1 `moneda`, vigencia|None). Never raises."""
    moneda = moneda.upper()
    hit = _cache.get(moneda)
    if hit and time.monotonic() - hit[2] < _TTL:
        return hit[0], hit[1]
    valor = float(_FALLBACK[moneda])
    vigencia: Optional[str] = None
    try:
        row = await get_pool().fetchrow(
            "SELECT valor::float8 AS valor, vigencia::text AS vigencia FROM public.trm WHERE moneda = $1",
            moneda,
        )
        if row and row["valor"] and float(row["valor"]) > 0:
            valor = float(row["valor"])
            vigencia = row["vigencia"]
    except Exception:
        pass  # keep env fallback — never break the map over the rate
    _cache[moneda] = (valor, vigencia, time.monotonic())
    return valor, vigencia


async def get_usd_rate() -> float:
    return (await get_trm("USD"))[0]


def usd_from_cop(precio_cop: Optional[int | float], rate: float) -> Optional[int]:
    """COP -> USD rounded to the nearest dollar (no int() truncation)."""
    if precio_cop is None or not rate:
        return None
    return int(round(float(precio_cop) / rate))


def cop_from_moneda(valor: Optional[int | float], moneda: str, rate: float) -> Optional[int]:
    """Convert a user-entered price filter in `moneda` to COP."""
    if valor is None:
        return None
    if (moneda or "COP").upper() == "USD":
        return int(round(float(valor) * rate))
    return int(valor)
