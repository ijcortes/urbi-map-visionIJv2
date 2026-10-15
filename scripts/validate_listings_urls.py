"""DEPRECATED shim. The weekly ping that marked any timeout/403 dead and ran 50 concurrent requests
is replaced by scraping/link_checker (polite, soft-404 aware, two-strike, block != gone).
Kept so existing cron/Airflow entries keep working; it just delegates.

    python scripts/validate_listings_urls.py [--batch 500]   ==   python -m scraping.link_checker --limit 500
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraping.link_checker.__main__ import main  # noqa: E402


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--concurrency", type=int, default=None, help="ignored (per-domain pacing now)")
    a, _ = ap.parse_known_args()
    sys.exit(main(["--limit", str(a.batch), "--older-than", "7d"]))
