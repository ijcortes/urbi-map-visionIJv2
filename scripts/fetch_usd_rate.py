"""
Fetch current USD/COP rate from exchangerate-api.com and persist to raw.parametros_sistema.
Run daily via Airflow or cron. Falls back to 4100 if API is unavailable.

Usage:
    python scripts/fetch_usd_rate.py
"""
import os

import requests
from sqlalchemy import create_engine, text


def fetch_and_save_usd_rate() -> float:
    try:
        r = requests.get(
            "https://api.exchangerate-api.com/v4/latest/USD",
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        cop_rate = data["rates"]["COP"]

        engine = create_engine(os.getenv("DATABASE_URL"))
        with engine.connect() as conn:
            # raw.parametros_sistema en prod solo tiene (nombre, valor) — la app
            # lee solo esas dos (api/parametros.py). fuente/updated_at del schema
            # "intencional" nunca se aplicaron a prod y nadie los lee; no los
            # escribimos para no depender de columnas inexistentes.
            conn.execute(
                text("""
                    INSERT INTO raw.parametros_sistema (nombre, valor)
                    VALUES ('USD_TO_COP', :valor)
                    ON CONFLICT (nombre) DO UPDATE SET valor = :valor
                """),
                {"valor": str(cop_rate)},
            )
            conn.commit()

        print(f"USD_TO_COP actualizado: {cop_rate}")
        return cop_rate

    except Exception as e:
        print(f"Error actualizando tasa: {e}")
        return 4100.0  # fallback


if __name__ == "__main__":
    fetch_and_save_usd_rate()
