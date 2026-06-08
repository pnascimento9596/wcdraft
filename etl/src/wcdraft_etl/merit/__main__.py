"""``python -m wcdraft_etl.merit`` -> deterministic coverage build (no network)."""

from __future__ import annotations

from .build import build
from .paths import OUTPUT_DIR

if __name__ == "__main__":
    out = build(write=True)
    print(f"merit coverage build -> {OUTPUT_DIR}")
    print(f"  facts {len(out['facts'])} | review {len(out['review'])}")
