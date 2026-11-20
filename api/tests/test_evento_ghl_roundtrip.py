"""Evento GHL contract — pure round-trip, no network, no creds.

Guards that outbound field names (ghl_client) and inbound reverse-map
(ghl_webhook) stay the same contract (§1 GHL_CONTRATO_PROPUESTO.md): a drift in
either breaks the sync silently against real data."""
from datetime import datetime

from api.utils.ghl_client import _evento_campos_to_properties
from api.routers.ghl_webhook import _evento_payload_to_row


def test_evento_roundtrip():
    campos = {
        "titulo": "Noche de Jazz", "descripcion": "En vivo", "categoria": "musica",
        "tipo_audiencia": "social", "municipio": "MEDELLIN", "barrio_nombre": "El Poblado",
        "fecha_inicio": datetime(2026, 11, 20, 19, 0), "fecha_fin": datetime(2026, 11, 20, 22, 0),
        "precio": 50000, "gratuito": False, "url_externo": "https://lu.ma/x",
        "foto_url": "https://img/x.jpg", "organizador": "Club", "max_asistentes": 100,
        "activo": True, "destacado": True, "destacado_nivel": "barrio",
        "destacado_zona_codigo": "123", "fuente": "interno", "barrio_id": 123,
    }
    props = _evento_campos_to_properties(campos, 777)
    assert props["event_title"] == "Noche de Jazz"
    assert props["is_free"] == "no" and props["is_featured"] == "yes"
    assert props["currency"] == "cop"
    assert props["start_date"].startswith("2026-11-20T19:00")
    assert props["website_event_id"] == "777" and props["website_barrio_id"] == "123"

    row = _evento_payload_to_row(props)
    assert row["titulo"] == "Noche de Jazz"
    assert row["gratuito"] is False and row["destacado"] is True
    assert row["activo"] is True
    assert row["fecha_inicio"] == datetime(2026, 11, 20, 19, 0)
    assert row["barrio_id"] == 123
    assert row["categoria"] == "musica" and row["tipo_audiencia"] == "social"
    assert row["destacado_nivel"] == "barrio" and row["destacado_zona_codigo"] == "123"


def test_inbound_partial_update_drops_none():
    # sparse payload → row only carries what GHL sent (partial UPDATE, no clobber)
    row = _evento_payload_to_row({"event_title": "X", "is_featured": "yes"})
    assert row == {"titulo": "X", "destacado": True}


def test_inbound_insert_needs_title_and_date():
    # no start_date → handler raises ValueError on INSERT (clean 400 for Talal's tests)
    row = _evento_payload_to_row({"event_title": "X"})
    assert "fecha_inicio" not in row


if __name__ == "__main__":
    test_evento_roundtrip()
    test_inbound_partial_update_drops_none()
    test_inbound_insert_needs_title_and_date()
    print("evento GHL round-trip self-check OK")
