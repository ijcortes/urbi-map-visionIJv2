"""Fixture tests for scraper normalizers and the shared quality helpers (DAT-19).

Fixtures in fixtures/scrapers/ mirror the portals' real response shapes (field
names checked against live responses 2026-10-14; values synthetic). A portal
schema change shows up here as a failing parse instead of silently empty data.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIX = Path(__file__).parent / "fixtures" / "scrapers"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))


def _load(name):
    return json.loads((FIX / name).read_text())


def _fr():
    """scripts/scrape_fincaraiz.py does `from config import ...` (scripts/config.py);
    drop that generic module name afterwards so it cannot shadow scraping/habi/config.py."""
    pytest.importorskip("bs4")
    prev = sys.modules.pop("config", None)
    try:
        import scrape_fincaraiz
        return scrape_fincaraiz
    finally:
        sys.modules.pop("config", None)
        if prev is not None:
            sys.modules["config"] = prev


# ── shared helpers ───────────────────────────────────────────────────────────

def test_implausible_reason_bounds():
    from scraping.utils.quality import implausible_reason as r
    assert r(500_000_000, 80, "apartamento", "venta") is None
    assert r(80_000, 80, "apartamento", "venta")            # 1,000 COP/m2
    assert r(2_000_000, 2, "apartamento", "arriendo")       # 2 m2
    assert r(100_000_000, 50_000, "lote", "venta") is None  # land: no price/m2 bound
    assert r(0, 80, "casa", "venta") == "no price"


def test_run_stats_exit_codes(monkeypatch):
    from scraping.utils.quality import RunStats
    ok = RunStats("t", pages_ok=10, items_seen=100, parse_failed=5)
    assert ok.exit_code() == 0
    drift = RunStats("t", pages_ok=10, items_seen=100, parse_failed=50)
    assert drift.exit_code() == 2
    trunc = RunStats("t", pages_ok=5, pages_failed=5, items_seen=100)
    assert trunc.exit_code() == 2
    assert RunStats("t").exit_code() == 2  # nothing fetched at all


def test_dedup_hash_single_definition():
    from scraping.utils.dedup import dedup_hash
    from scraping.metrocuadrado.scraper import calcular_dedup_hash
    args = ("El Poblado", "apartamento", "venta", 3, 2, 95, 851_000_000)
    assert dedup_hash(*args) == calcular_dedup_hash(*args)
    # price within the same 10M bucket -> same hash; next bucket -> different
    assert dedup_hash(*args[:-1], 849_000_000) == dedup_hash(*args)
    assert dedup_hash(*args[:-1], 870_000_000) != dedup_hash(*args)


def test_user_agent_identifies_bot(monkeypatch):
    from scraping.utils.quality import scraper_user_agent
    monkeypatch.delenv("SCRAPER_USER_AGENT", raising=False)
    assert "MedellinSocialBot" in scraper_user_agent()
    monkeypatch.setenv("SCRAPER_USER_AGENT", "custom/1.0")
    assert scraper_user_agent() == "custom/1.0"


def test_http_get_retries_then_succeeds(monkeypatch):
    from scraping.utils import quality

    class Resp:
        def __init__(self, code):
            self.status_code, self.headers = code, {}

    calls = []

    class Sess:
        headers = {"User-Agent": "x"}

        def get(self, url, params=None, timeout=None):
            calls.append(url)
            return Resp(429 if len(calls) < 3 else 200)

    monkeypatch.setattr(quality.time, "sleep", lambda s: None)
    stats = quality.RunStats("t")
    r = quality.http_get(Sess(), "https://example.com/x", stats=stats, check_robots=False)
    assert r.status_code == 200 and len(calls) == 3 and stats.pages_ok == 1


# ── FincaRaíz ────────────────────────────────────────────────────────────────

def test_fincaraiz_normalize_fixture():
    fr = _fr()
    out = fr.normalize_listing(_load("fincaraiz_item.json"), "envigado", "venta", "apartamento")
    assert out["precio"] == 1_230_000_000
    assert out["area"] == 137 and out["area_tipo"] == "construida"
    assert out["moneda"] == "COP" and out["precio_incluye_admin"] is False
    assert out["destacado"] is True and out["anunciante_tipo"] == "inmobiliaria"
    assert out["barrio"] == "EL ESMERALDAL" and out["municipio"] == "ENVIGADO"
    assert out["url"].endswith("/ficha/191234567")
    assert len(out["fotos"]) == 2


def test_fincaraiz_rejects_foreign_currency_and_out_of_box():
    fr = _fr()
    item = _load("fincaraiz_item.json")
    item["price"]["currency"]["name"] = "U$S"
    with pytest.raises(fr.OutOfScope):
        fr.normalize_listing(item, "envigado", "venta", "apartamento")
    item = _load("fincaraiz_item.json")
    item["latitude"] = 4.6  # Bogotá
    with pytest.raises(fr.OutOfScope):
        fr.normalize_listing(item, "envigado", "venta", "apartamento")


def test_fincaraiz_schema_drift_is_an_exception_not_none():
    fr = _fr()
    item = _load("fincaraiz_item.json")
    item["price"] = "not-an-object"  # portal changed the shape
    with pytest.raises(Exception):
        fr.normalize_listing(item, "envigado", "venta", "apartamento")


# ── Metrocuadrado ────────────────────────────────────────────────────────────

def test_metrocuadrado_parse_fixture():
    from scraping.metrocuadrado.scraper import _parse_listing
    out = _parse_listing(_load("metrocuadrado_item.json"), "apartamento", "venta", "Medellín")
    assert out["precio"] == 850_000_000
    assert out["area_m2"] == 95 and out["area_tipo"] == "privada"
    assert out["habitaciones"] == 3 and out["banos"] == 2
    assert out["moneda"] == "COP" and out["destacado"] is True
    assert out["administracion"] == 650000
    assert out["url"].startswith("https://www.metrocuadrado.com/inmueble/")
    assert out["lat"] == 6.2088 and out["barrio_id"] is None  # resolved at save time


def test_metrocuadrado_studio_folds_into_apartamento():
    from scraping.metrocuadrado.scraper import _parse_listing
    out = _parse_listing(_load("metrocuadrado_item.json"), "apartaestudio", "arriendo", "Medellín")
    assert out["tipo_inmueble"] == "apartamento" and out["habitaciones"] == 0


def test_metrocuadrado_total_area_fallback_is_labelled():
    from scraping.metrocuadrado.scraper import _parse_listing
    item = _load("metrocuadrado_item.json")
    item.pop("areaprivada")
    out = _parse_listing(item, "apartamento", "venta", "Medellín")
    assert out["area_m2"] == 110 and out["area_tipo"] == "total"


# ── stale rule ───────────────────────────────────────────────────────────────

def test_stale_config_keys_cover_studio_and_accents():
    import deactivate_stale_listings as st
    assert st.config_keys("metrocuadrado", "Itagüí", "apartamento", "venta") == [
        "itagui|apartamento|venta", "itagui|apartaestudio|venta"]
    assert st.config_keys("fincaraiz", "LA ESTRELLA", "casa", "arriendo") == ["la-estrella|casa|arriendo"]
    assert st.config_keys("habi", "Medellín", "Apartamento", None) == ["valle_aburra"]
