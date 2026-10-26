"""
Inmobiliarias del Valle de Aburrá desde Google Places → CSV para importar a GHL.

Por qué así y no scrapeando Metro Cuadrado/Fincaraíz (Ken, call 23-oct):
  - Metro Cuadrado no expone el contacto del realtor (el número es un puente suyo)
    y su API solo responde con una clave interna; Fincaraíz prohíbe esas páginas
    en robots.txt.
  - Mandar email/SMS/voicemail masivo a personas sin autorización choca con la
    Ley 1581 de 2012 (habeas data). Places da el contacto PÚBLICO de la EMPRESA
    (teléfono/web que la inmobiliaria publica para que la llamen) por una API
    oficial: es outreach B2B, no datos de una persona.

Qué hace: busca negocios tipo real_estate_agency alrededor de N barrios por
comuna/municipio, deduplica por place_id y escribe un CSV con el formato de
importación de contactos de GHL (tag "realtor-outreach", fuente google-places).
No toca la base de datos ni GHL: el CSV se revisa y se importa a mano.

Costo: ~(16 comunas + 5 municipios) × N × $0.032 → N=3 ≈ $2 USD.

Run:
  python scraping/inmobiliarias/google_places_inmobiliarias.py --por-comuna 3
  python scraping/inmobiliarias/google_places_inmobiliarias.py --por-comuna 1 --out /tmp/prueba.csv
"""

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_ROOT))
from scraping.tiendas.google_places_scraper import (  # noqa: E402
    API_KEY, get_barrios_por_comuna, get_conn, scrape_barrio_categoria,
)

# Solo los campos que usa el CSV: Places factura por el tier más caro pedido.
FIELD_MASK = ",".join(f"places.{f}" for f in (
    "id", "displayName", "formattedAddress", "nationalPhoneNumber", "websiteUri", "rating", "userRatingCount",
))
# Excluir lo que no es una inmobiliaria con la que se pueda hacer un trato.
_NO_INMOBILIARIA = ("fiduciaria", "notaria", "banco", "constructora")
GHL_COLUMNS = ["Company Name", "Phone", "Website", "Address1", "City", "Tags", "Source", "Rating", "Reviews", "Google Place ID", "Zona"]


def a_fila(p: dict, zona: str, municipio: str) -> dict | None:
    nombre = (p.get("displayName") or {}).get("text", "").strip()
    if not nombre or any(w in nombre.lower() for w in _NO_INMOBILIARIA):
        return None
    if not (p.get("nationalPhoneNumber") or p.get("websiteUri")):
        return None  # sin forma pública de contactarla
    return {
        "Company Name": nombre,
        "Phone": p.get("nationalPhoneNumber", ""),
        "Website": p.get("websiteUri", ""),
        "Address1": p.get("formattedAddress", ""),
        "City": (municipio or "").title(),
        "Tags": "realtor-outreach,medellin-social",
        "Source": "google-places",
        "Rating": p.get("rating", ""),
        "Reviews": p.get("userRatingCount", ""),
        "Google Place ID": p.get("id", ""),
        "Zona": zona,
    }


def run(por_comuna: int, out: Path) -> None:
    if not API_KEY:
        sys.exit("ERROR: GOOGLE_PLACES_API_KEY not set")
    conn = get_conn()
    try:
        zonas = get_barrios_por_comuna(conn, por_comuna=por_comuna)
    finally:
        conn.close()
    print(f"[plan] {len(zonas)} puntos de búsqueda ≈ ${len(zonas) * 0.032:.2f} USD")

    filas: dict[str, dict] = {}
    for b in zonas:
        for p in scrape_barrio_categoria(b, ["real_estate_agency"], field_mask=FIELD_MASK):
            f = a_fila(p, str(b["zona"]), b["municipio"])
            if f:
                filas.setdefault(f["Google Place ID"], f)
        print(f"  {b['zona']:>12} {b['nombre']:30} → {len(filas)} acumuladas")

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=GHL_COLUMNS)
        w.writeheader()
        w.writerows(sorted(filas.values(), key=lambda f: -(f["Reviews"] or 0)))
    print(f"\n{len(filas)} inmobiliarias → {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Inmobiliarias (Google Places) → CSV para GHL")
    ap.add_argument("--por-comuna", type=int, default=3, help="barrios por comuna/municipio (default 3)")
    ap.add_argument("--out", type=Path, default=_ROOT / f"exports/inmobiliarias_{date.today()}.csv")
    args = ap.parse_args()
    run(args.por_comuna, args.out)
