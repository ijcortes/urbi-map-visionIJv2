"""Tienda GHL contract — pure round-trip, no network, no creds.

Outbound (push_tienda, LIVE) splits fields into standard + custom; inbound
(_upsert_tienda_from_ghl) reads them merged. Guards both stay the same contract
(§2 GHL_CONTRATO_PROPUESTO.md)."""
from datetime import datetime

from api.utils.ghl_client import _tienda_campos_to_standard, _tienda_campos_to_custom
from api.routers.ghl_webhook import _tienda_payload_to_row


def test_tienda_roundtrip():
    campos = {
        "nombre": "Café Pergamino", "descripcion": "Café de origen", "subcategoria": "cafes",
        "direccion": "Cra 37 #8A-37", "telefono": "+576041", "whatsapp": "+57310",
        "instagram": "@pergamino", "website": "https://pergamino.co", "google_place_id": "abc123",
        "precio_rango": "$$", "rating_google": 4.8, "activo": True, "verificado": True,
        "destacado": True, "featured_badge": True, "featured_desde": datetime(2026, 10, 1, 0, 0),
        "barrio_nombre": "El Poblado", "ciudad_nombre": "Medellín", "horario": {"lun": "8-18"},
    }
    props = {**_tienda_campos_to_standard(campos), **_tienda_campos_to_custom(campos)}
    assert props["name"] == "Café Pergamino"
    assert props["price_range"] == "moderate"
    assert props["verified"] == "yes" and props["featured"] == "yes"

    row = _tienda_payload_to_row(props)
    assert row["nombre"] == "Café Pergamino"
    assert row["precio_rango"] == "$$"
    assert row["verificado"] is True and row["destacado"] is True
    assert row["featured_badge"] is True
    assert row["rating_google"] == 4.8
    assert row["subcategoria"] == "cafes"
    assert row["activo"] is True  # from active=yes (no business_listing_status in outbound)
    assert row["featured_desde"] == datetime(2026, 10, 1, 0, 0)


def test_tienda_listing_status_overrides_active():
    row = _tienda_payload_to_row({"name": "X", "business_listing_status": "Pending", "active": "yes"})
    assert row["activo"] is False  # status manda sobre active


def test_tienda_insert_needs_name():
    row = _tienda_payload_to_row({"description": "sin nombre"})
    assert "nombre" not in row


if __name__ == "__main__":
    test_tienda_roundtrip()
    test_tienda_listing_status_overrides_active()
    test_tienda_insert_needs_name()
    print("tienda GHL round-trip self-check OK")
