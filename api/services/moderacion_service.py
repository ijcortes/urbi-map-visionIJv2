"""Moderación del listing — publicación inicial (aprobar/rechazar).

Solo la publicación inicial pasa por aquí. Editar un listing PUBLICADO NO se
modera: los edits salen en vivo (decidido en paso 2). listing_moderacion es la
bitácora: guarda por qué se aprobó/rechazó, no solo el estado resultante.
"""
from __future__ import annotations

import uuid
from typing import Any

import logging

from api.cache import insert_listing_into_cache
from api.services.listing_service import transition
from api.utils import ghl_client

logger = logging.getLogger(__name__)


async def aprobar(listing: Any, moderador_id: str, pool: Any) -> None:
    """en_revision → publicado + bitácora. transition setea published_at 1ª vez."""
    transition(listing, "publicado")  # valida en_revision→publicado
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE listing SET estado = 'publicado', verificado = TRUE, "
            "published_at = COALESCE(published_at, NOW()) WHERE id = $1",
            listing.id,
        )
        await conn.execute(
            "INSERT INTO listing_moderacion (id, listing_id, accion, moderador_id) "
            "VALUES ($1, $2, 'aprobado', $3)",
            str(uuid.uuid4()), listing.id, moderador_id,
        )
    # Aprobado → al mapa al instante (sin esperar el refresh horario).
    try:
        await insert_listing_into_cache(pool, listing.id)
    except Exception:
        logger.exception("aprobar: insert_listing_into_cache falló para %s", listing.id)
    await ghl_client.sync_listing(listing.id)


async def rechazar(listing: Any, moderador_id: str, motivo: str, pool: Any) -> None:
    """en_revision → rechazado + bitácora con el motivo."""
    if not motivo:
        raise ValueError("El rechazo requiere un motivo")
    transition(listing, "rechazado")  # valida en_revision→rechazado
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE listing SET estado = 'rechazado' WHERE id = $1",
            listing.id,
        )
        await conn.execute(
            "INSERT INTO listing_moderacion (id, listing_id, accion, motivo, moderador_id) "
            "VALUES ($1, $2, 'rechazado', $3, $4)",
            str(uuid.uuid4()), listing.id, motivo, moderador_id,
        )
    await ghl_client.sync_listing(listing.id)
