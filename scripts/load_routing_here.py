"""Tiempos de recorrido en hora pico por zona hacia El Poblado y el Centro (#27).

Usa HERE Routing API v8 (router.hereapi.com/v8/routes). `summary.duration` sale
CON trafico cuando se pasa `departureTime` (vs `baseDuration` = flujo libre; se
verifico en vivo que difieren). Dato ESTATICO estilo campana, igual que el perfil
de trafico (analytics.barrios_trafico_perfil): se corre este script y queda
congelado en analytics.zona_tiempos_recorrido hasta la proxima corrida.

Grano = ZONA (comuna para Medellin, municipio para el resto, ~25 zonas) para no
gastar la cuota free de HERE — per-barrio serian ~2300 llamadas. Barrios vecinos
llegan a El Poblado con pocos minutos de diferencia, asi que la zona alcanza.
Mismo keying que raw.poblacion_* : zona_codigo en mayusculas.

Requiere HERE_API_KEY (platform.here.com, el mismo del flow) en .env.

  python scripts/load_routing_here.py              # puebla todas las zonas (live)
  python scripts/load_routing_here.py --self-check # test offline, no red
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()
HERE_API_KEY = os.getenv("HERE_API_KEY", "")
ROUTE_URL = "https://router.hereapi.com/v8/routes"
COT = timezone(timedelta(hours=-5))  # Colombia, sin DST

# Destinos clave (lat, lon): Parque del Poblado y Parque Berrio (centro).
DESTINOS = {
    "poblado": (6.2088, -75.5680),
    "centro":  (6.2518, -75.5636),
}

# ponytail: solo pico AM (direccion hacia los centros = la congestionada).
# Si la asimetria AM/PM importa, agregar una segunda franja 18:00.
def _proximo_pico_am() -> str:
    """ISO del proximo miercoles 07:30 COT (dia habil representativo, futuro)."""
    hoy = datetime.now(COT)
    dias = (2 - hoy.weekday()) % 7 or 7  # 2 = miercoles; siempre a futuro
    objetivo = (hoy + timedelta(days=dias)).replace(hour=7, minute=30, second=0, microsecond=0)
    return objetivo.isoformat()


_ZONAS_SQL = """
    SELECT
        CASE WHEN upper(municipio) = 'MEDELLIN' THEN 'comuna' ELSE 'municipio' END   AS zona_tipo,
        CASE WHEN upper(municipio) = 'MEDELLIN' THEN upper(comuna) ELSE upper(municipio) END AS zona_codigo,
        ST_Y(ST_Centroid(ST_Collect(geometry)))                                       AS lat,
        ST_X(ST_Centroid(ST_Collect(geometry)))                                       AS lon
    FROM raw.barrios
    WHERE (upper(municipio) = 'MEDELLIN' AND comuna IS NOT NULL)
       OR (upper(municipio) <> 'MEDELLIN' AND municipio IS NOT NULL)
    GROUP BY 1, 2
"""

_UPSERT_SQL = """
    INSERT INTO analytics.zona_tiempos_recorrido
        (zona_tipo, zona_codigo, tiempo_poblado_min, tiempo_centro_min, calculado_en)
    VALUES (%s, %s, %s, %s, now())
    ON CONFLICT (zona_tipo, zona_codigo) DO UPDATE SET
        tiempo_poblado_min = EXCLUDED.tiempo_poblado_min,
        tiempo_centro_min  = EXCLUDED.tiempo_centro_min,
        calculado_en       = now()
"""


def summary_to_min(summary: dict) -> int | None:
    """duration (segundos, con trafico) -> minutos redondeados."""
    secs = summary.get("duration")
    return round(secs / 60) if secs is not None else None


def fetch_min(olat: float, olon: float, dlat: float, dlon: float, dep_iso: str) -> int | None:
    """Minutos en auto origen->destino a `dep_iso`. None si HERE falla 3 veces."""
    params = {
        "transportMode": "car",
        "origin": f"{olat},{olon}",
        "destination": f"{dlat},{dlon}",
        "departureTime": dep_iso,
        "return": "summary",
        "apikey": HERE_API_KEY,
    }
    for _ in range(3):
        try:
            r = requests.get(ROUTE_URL, params=params, timeout=30)
            if r.status_code == 200:
                return summary_to_min(r.json()["routes"][0]["sections"][0]["summary"])
            print(f"  WARN: HERE -> {r.status_code}: {r.text[:150]}")
        except (requests.RequestException, KeyError, IndexError) as exc:
            print(f"  WARN: {exc}")
        time.sleep(1.5)
    return None


def run() -> int:
    """Puebla analytics.zona_tiempos_recorrido. Retorna nº de zonas escritas."""
    if not HERE_API_KEY:
        sys.exit("ERROR: falta HERE_API_KEY en .env")
    dep = _proximo_pico_am()
    print(f"departureTime (pico AM): {dep}")
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(_ZONAS_SQL)
    zonas = cur.fetchall()
    print(f"{len(zonas)} zonas x {len(DESTINOS)} destinos = {len(zonas)*len(DESTINOS)} llamadas HERE")
    n = 0
    for zt, zc, lat, lon in zonas:
        pob = fetch_min(lat, lon, *DESTINOS["poblado"], dep)
        cen = fetch_min(lat, lon, *DESTINOS["centro"], dep)
        cur.execute(_UPSERT_SQL, (zt, zc, pob, cen))
        conn.commit()
        n += 1
        print(f"  {zt}/{zc}: poblado={pob}min centro={cen}min")
    cur.close()
    conn.close()
    return n


def self_check() -> None:
    """Test offline de la conversion y el keying — sin red ni DB."""
    assert summary_to_min({"duration": 1503}) == 25, "1503s debe dar 25 min"
    assert summary_to_min({"duration": 1346}) == 22, "1346s debe dar 22 min"
    assert summary_to_min({}) is None, "sin duration -> None"
    dep = _proximo_pico_am()
    assert dep.endswith("-05:00") and "T07:30" in dep, f"pico AM mal formado: {dep}"
    # el dia objetivo debe ser futuro y miercoles (weekday 2)
    assert datetime.fromisoformat(dep) > datetime.now(COT), "departureTime no es futuro"
    assert datetime.fromisoformat(dep).weekday() == 2, "no cae miercoles"
    print("self-check OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true", help="test offline y sale")
    args = ap.parse_args()
    if args.self_check:
        self_check()
    else:
        print(f"Escritas {run()} zonas en analytics.zona_tiempos_recorrido")
