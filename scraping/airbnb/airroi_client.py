"""
Cliente AirROI — datos de Airbnb por barrio para el Valle de Aburrá.

Consulta la API de AirROI (https://airroi.com/api) usando el centroide
de cada barrio como punto de búsqueda. Agrega métricas de short-term rental
y guarda en raw.airbnb_barrios.

Uso:
    python -m scraping.airbnb.airroi_client                  # API real
    python -m scraping.airbnb.airroi_client --mock           # datos simulados sin API key
    python -m scraping.airbnb.airroi_client --mock --dry-run # simular sin escribir a DB
    python -m scraping.airbnb.airroi_client --dry-run        # API real sin escritura
    python -m scraping.airbnb.airroi_client --barrio-id 42   # barrio específico
    python -m scraping.airbnb.airroi_client --radius 1.0     # radio en km (default 0.5)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scraping.utils.cost_ledger import BudgetExceeded, charge
from scraping.utils.db import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------
AIRROI_BASE_URL = "https://api.airroi.io/v1"
AIRROI_API_KEY = os.getenv("AIRROI_API_KEY", "")

DEFAULT_RADIUS_KM = 0.5

# AirROI devuelve tarifas en USD — tasa de conversión aproximada COP/USD
USD_TO_COP = float(os.getenv("USD_TO_COP", "4100"))

API_DELAY_SECONDS = float(os.getenv("AIRROI_DELAY_SECONDS", "1.0"))

# ---------------------------------------------------------------------------
# Mock data — valores de referencia basados en mercado real de Medellín
# Llaves = nombre del barrio en DB (raw.barrios.nombre, uppercase).
# Valores: occupancy_rate (0-1), adr_usd, active_listings.
# ---------------------------------------------------------------------------
_MOCK_DEFAULT = {"occupancy_rate": 0.40, "adr": 50.0, "active_listings": 50}

_MOCK_DATA: dict[str, dict] = {
    "EL POBLADO":  {"occupancy_rate": 0.72, "adr": 120.0, "active_listings": 1841},
    "LAURELES":    {"occupancy_rate": 0.65, "adr":  85.0, "active_listings":  892},
    "BELEN":       {"occupancy_rate": 0.48, "adr":  55.0, "active_listings":  234},
    "ROBLEDO":     {"occupancy_rate": 0.41, "adr":  45.0, "active_listings":  187},
    "ARANJUEZ":    {"occupancy_rate": 0.38, "adr":  40.0, "active_listings":  143},
    "ESTADIO":     {"occupancy_rate": 0.61, "adr":  78.0, "active_listings":  412},
    "EL RODEO":    {"occupancy_rate": 0.35, "adr":  38.0, "active_listings":   89},
}

# Jitter ±5% so repeated mock runs produce slightly different numbers
_JITTER = 0.05


def _mock_response(nombre: str) -> dict[str, Any]:
    """Return AirROI-shaped dict with realistic mock values for a barrio."""
    base = _MOCK_DATA.get(nombre.strip().upper(), _MOCK_DEFAULT)

    def jitter(v: float) -> float:
        return round(v * (1 + random.uniform(-_JITTER, _JITTER)), 4)

    occ = jitter(base["occupancy_rate"])
    adr = jitter(base["adr"])
    n   = max(1, int(base["active_listings"] * (1 + random.uniform(-_JITTER, _JITTER))))
    rev = round(adr * occ * 365, 2)

    return {
        "active_listings": n,
        "occupancy_rate":  round(occ, 4),
        "adr":             round(adr, 2),
        "annual_revenue":  rev,
        "_mock":           True,
    }


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS raw.airbnb_barrios (
    id                          SERIAL PRIMARY KEY,
    barrio_id                   INTEGER REFERENCES raw.barrios(id),
    n_listings                  INTEGER,
    ocupacion_pct               NUMERIC(5, 2),
    adr_cop                     NUMERIC(12, 0),
    ingresos_anuales_estimados  NUMERIC(15, 0),
    fecha_consulta              TIMESTAMPTZ DEFAULT NOW(),
    raw_data                    JSONB
);
CREATE INDEX IF NOT EXISTS idx_airbnb_barrios_barrio ON raw.airbnb_barrios(barrio_id);
CREATE INDEX IF NOT EXISTS idx_airbnb_barrios_fecha  ON raw.airbnb_barrios(fecha_consulta);
-- Unique constraint required for UPSERT; safe to run repeatedly
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'airbnb_barrios_barrio_id_unique'
    ) THEN
        ALTER TABLE raw.airbnb_barrios
            ADD CONSTRAINT airbnb_barrios_barrio_id_unique UNIQUE (barrio_id);
    END IF;
END $$;
"""

# UPSERT: repeated scraper runs refresh existing rows instead of duplicating
INSERT_SQL = """
INSERT INTO raw.airbnb_barrios
    (barrio_id, n_listings, ocupacion_pct, adr_cop,
     ingresos_anuales_estimados, fecha_consulta, raw_data)
VALUES
    (%(barrio_id)s, %(n_listings)s, %(ocupacion_pct)s, %(adr_cop)s,
     %(ingresos_anuales_estimados)s, %(fecha_consulta)s, %(raw_data)s)
ON CONFLICT (barrio_id) DO UPDATE SET
    n_listings                  = EXCLUDED.n_listings,
    ocupacion_pct               = EXCLUDED.ocupacion_pct,
    adr_cop                     = EXCLUDED.adr_cop,
    ingresos_anuales_estimados  = EXCLUDED.ingresos_anuales_estimados,
    fecha_consulta              = NOW(),
    raw_data                    = EXCLUDED.raw_data
"""


# ---------------------------------------------------------------------------
# Helpers de conversión
# ---------------------------------------------------------------------------

def _usd_to_cop(usd: float | None) -> float | None:
    if usd is None:
        return None
    return round(usd * USD_TO_COP)


def _occupancy_to_pct(rate: float | None) -> float | None:
    """AirROI returns 0-1; convert to 0-100."""
    if rate is None:
        return None
    return round(rate * 100, 2) if rate <= 1 else round(rate, 2)


# ---------------------------------------------------------------------------
# AirROI Client
# ---------------------------------------------------------------------------

class AirROIClient:
    """
    Fetch short-term rental market data from AirROI per barrio.

    Pass mock=True to use built-in reference data instead of calling the API.
    Useful for end-to-end pipeline validation before the API key is available.

    AirROI docs: https://airroi.com/api/developer/activate
    Rate limit: 1 req/s on free tier ($10 initial credits).
    """

    def __init__(
        self,
        api_key: str = AIRROI_API_KEY,
        radius_km: float = DEFAULT_RADIUS_KM,
        barrio_ids: list[int] | None = None,
        delay: float = API_DELAY_SECONDS,
        mock: bool = False,
    ):
        self.mock = mock
        if not mock and not api_key:
            raise ValueError(
                "AIRROI_API_KEY not set. "
                "Register at https://airroi.com/api/developer/activate "
                "and set AIRROI_API_KEY in .env  —  or run with --mock."
            )
        self.api_key = api_key
        self.radius_km = radius_km
        self.barrio_ids = barrio_ids
        self.delay = delay

        if not mock:
            self._session = requests.Session()
            self._session.headers.update({
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
            })

    def _get_barrios(self) -> list[dict]:
        """Fetch barrio_id + nombre + centroid lat/lng from raw.barrios."""
        sql = """
            SELECT
                id                                       AS barrio_id,
                nombre,
                ST_Y(ST_Centroid(geometry::geometry))    AS lat,
                ST_X(ST_Centroid(geometry::geometry))    AS lng
            FROM raw.barrios
            {where}
            ORDER BY id
        """.format(
            where=(
                f"WHERE id = ANY(ARRAY{self.barrio_ids})"
                if self.barrio_ids else ""
            )
        )
        with get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql)
                return [dict(r) for r in cur.fetchall()]

    def _fetch_market(self, lat: float, lng: float) -> dict[str, Any] | None:
        """
        Call AirROI market-data endpoint for a lat/lng point.

        Endpoint: GET /v1/market/search
        Params:
          lat, lng   — centroid of the area
          radius     — search radius in km
          currency   — response currency (USD; converted to COP locally)
        """
        url = f"{AIRROI_BASE_URL}/market/search"
        params = {
            "lat": lat,
            "lng": lng,
            "radius": self.radius_km,
            "currency": "USD",
        }
        try:
            charge("airroi", "market/search")
        except BudgetExceeded as e:
            log.error(str(e))
            return None
        try:
            resp = self._session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.HTTPError as e:
            log.error(f"AirROI HTTP {e.response.status_code} for ({lat},{lng}): {e}")
            return None
        except requests.RequestException as e:
            log.error(f"AirROI request error for ({lat},{lng}): {e}")
            return None

    @staticmethod
    def _parse_response(barrio_id: int, data: dict) -> dict | None:
        """
        Map AirROI response (real or mock) to raw.airbnb_barrios row.

        Expected response shape:
        {
          "active_listings": 142,
          "occupancy_rate":  0.72,    # 0-1
          "adr":             85.50,   # Average Daily Rate in USD
          "annual_revenue":  22450.0, # Estimated gross annual revenue USD
        }
        """
        try:
            n_listings = data.get("active_listings") or data.get("listings_count")
            occ_raw    = data.get("occupancy_rate")  or data.get("occupancy")
            adr_usd    = data.get("adr")             or data.get("average_daily_rate")
            rev_usd    = data.get("annual_revenue")  or data.get("revenue_annual")

            return {
                "barrio_id":                  barrio_id,
                "n_listings":                 int(n_listings) if n_listings is not None else None,
                "ocupacion_pct":              _occupancy_to_pct(float(occ_raw)) if occ_raw is not None else None,
                "adr_cop":                    _usd_to_cop(float(adr_usd)) if adr_usd is not None else None,
                "ingresos_anuales_estimados": _usd_to_cop(float(rev_usd)) if rev_usd is not None else None,
                "fecha_consulta":             datetime.now(timezone.utc).isoformat(),
                "raw_data":                   json.dumps(data, ensure_ascii=False),
            }
        except (TypeError, ValueError) as e:
            log.warning(f"Parse error barrio {barrio_id}: {e} — data: {data}")
            return None

    def run(self) -> list[dict]:
        barrios = self._get_barrios()
        mode    = "MOCK" if self.mock else f"API (radio {self.radius_km} km)"
        log.info(f"Consultando AirROI [{mode}] para {len(barrios)} barrios")

        results: list[dict] = []
        for i, barrio in enumerate(barrios, 1):
            barrio_id = barrio["barrio_id"]
            nombre    = barrio["nombre"]
            lat       = float(barrio["lat"])
            lng       = float(barrio["lng"])

            log.info(f"  [{i}/{len(barrios)}] {nombre}")

            if self.mock:
                raw_data = _mock_response(nombre)
            else:
                raw_data = self._fetch_market(lat, lng)
                if raw_data is None:
                    log.warning(f"    Sin datos para {nombre}, saltando")
                    continue
                if i < len(barrios):
                    time.sleep(self.delay)

            row = self._parse_response(barrio_id, raw_data)
            if row:
                results.append(row)
                log.info(
                    f"    n={row['n_listings']}, "
                    f"occ={row['ocupacion_pct']}%, "
                    f"ADR={row['adr_cop']:,.0f} COP"
                    if row["adr_cop"] else f"    n={row['n_listings']}"
                )

        log.info(f"Total registros: {len(results)}")
        return results


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def ensure_table() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE_SQL)


def save_records(records: list[dict]) -> int:
    if not records:
        return 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, INSERT_SQL, records, page_size=50)
    return len(records)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Cliente AirROI — Medellín/Valle de Aburrá")
    parser.add_argument("--mock",      action="store_true", help="Usar datos simulados (sin API key)")
    parser.add_argument("--dry-run",   action="store_true", help="No escribe a DB")
    parser.add_argument("--barrio-id", type=int,            help="Consultar solo este barrio_id")
    parser.add_argument("--radius",    type=float, default=DEFAULT_RADIUS_KM,
                        help=f"Radio de búsqueda en km (default {DEFAULT_RADIUS_KM})")
    args = parser.parse_args()

    barrio_ids = [args.barrio_id] if args.barrio_id else None

    client = AirROIClient(
        radius_km=args.radius,
        barrio_ids=barrio_ids,
        mock=args.mock,
    )
    records = client.run()

    if not records:
        log.warning("Sin registros obtenidos.")
        sys.exit(1)

    if args.dry_run:
        log.info(f"[dry-run] {len(records)} registros. Ejemplo:")
        example = {k: v for k, v in records[0].items() if k != "raw_data"}
        log.info(json.dumps(example, ensure_ascii=False, indent=2, default=str))
    else:
        ensure_table()
        saved = save_records(records)
        log.info(f"Guardados {saved} registros en raw.airbnb_barrios")


if __name__ == "__main__":
    main()
