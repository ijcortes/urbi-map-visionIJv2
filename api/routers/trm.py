"""TRM endpoint — canonical COP/USD (o COP/EUR) rate for the frontend (cards/drawer/filter).

public.trm es multi-moneda desde 2026-08-23 (PK moneda, antes fila única id=1 solo USD).
The lookup lives in api/services/trm_service.py, shared with the listings endpoints.
"""
from fastapi import APIRouter, Query, Response

from api.services.trm_service import get_trm as _get_trm

router = APIRouter()


@router.get("")
async def get_trm(response: Response, moneda: str = Query("USD", pattern="^(USD|EUR)$")):
    """Current rate (COP per `moneda`) from public.trm; falls back to config if absent."""
    valor, vigencia = await _get_trm(moneda)
    response.headers["Cache-Control"] = "public, max-age=3600"
    return {"moneda": moneda, "valor": valor, "vigencia": vigencia}
