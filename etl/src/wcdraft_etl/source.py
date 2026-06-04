"""Source access for the Fjelstul World Cup Database.

This module is the single point of contact with the upstream CC-BY-SA source.
It pins the exact upstream revision, carries the required attribution string,
and loads CSVs with strict *honest-state* semantics: every cell is read as a
string with no pandas NA coercion, so the transforms decide — explicitly and
per-column — what counts as "missing". Nothing here ever invents a value.

Source: github.com/jfjelstul/worldcup  (v1.2.0)
License: CC-BY-SA 4.0
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

# --- Upstream pin (the exact revision this ETL was built and validated against) ---
SOURCE_NAME = "The Fjelstul World Cup Database"
SOURCE_VERSION = "1.2.0"
SOURCE_REPO = "https://www.github.com/jfjelstul/worldcup"
SOURCE_COMMIT = "f41e9437a007498bdbf3751305818101f96cb6fb"
SOURCE_LICENSE = "CC-BY-SA 4.0"
SOURCE_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/legalcode"
SOURCE_AUTHOR = "Joshua C. Fjelstul, Ph.D."
SOURCE_COPYRIGHT = "© 2023 Joshua C. Fjelstul, Ph.D."

# The exact attribution block CC-BY-SA 4.0 requires a downstream work to carry,
# including a statement of modifications (the last element).
ATTRIBUTION = (
    f"Contains information from {SOURCE_NAME} (v{SOURCE_VERSION}) by {SOURCE_AUTHOR}, "
    f"{SOURCE_COPYRIGHT}, used under {SOURCE_LICENSE} "
    f"({SOURCE_LICENSE_URL}). Source: {SOURCE_REPO} "
    f"(pinned commit {SOURCE_COMMIT}). "
    "Modifications by wcdraft: normalized into canonical nation/player/card/manager/"
    "tournament tables; derived coarse positions, per-card goal/appearance/award "
    "aggregates and a per-card coverage score; added a curated historical-entity / "
    "alias reference for nations. No upstream values were altered, imputed, or "
    "back-filled; absent signals are preserved as null. wcdraft derived data is "
    "redistributed under CC-BY-SA 4.0 (ShareAlike)."
)

# Candidate locations for the upstream `data-csv/` directory, in priority order.
# CI clones the pinned commit into etl/vendor/worldcup; locally we reuse the recon clone.
_CANDIDATES = (
    os.environ.get("WCDRAFT_WORLDCUP_DIR"),
    "etl/vendor/worldcup/data-csv",
    "vendor/worldcup/data-csv",
    os.path.expanduser("~/Projects/wcdraft-recon/worldcup/data-csv"),
)


def resolve_source_dir() -> Path:
    """Return the first existing upstream `data-csv` directory, or raise."""
    for cand in _CANDIDATES:
        if not cand:
            continue
        p = Path(cand)
        if p.is_dir() and (p / "teams.csv").is_file():
            return p
    searched = "\n  ".join(c for c in _CANDIDATES if c)
    raise FileNotFoundError(
        "Could not locate the Fjelstul worldcup data-csv directory. Set "
        "WCDRAFT_WORLDCUP_DIR or clone github.com/jfjelstul/worldcup "
        f"(commit {SOURCE_COMMIT}). Searched:\n  {searched}"
    )


def load(table: str, source_dir: Path | None = None) -> pd.DataFrame:
    """Load one upstream CSV as all-string columns with NO NA coercion.

    Empty cells come through as the empty string "" so each transform decides,
    explicitly, what missing means for that column. This is the honest-state
    guarantee at the I/O boundary: the loader never turns "" into 0/False/NaN.
    """
    src = source_dir or resolve_source_dir()
    return pd.read_csv(src / f"{table}.csv", dtype=str, keep_default_na=False, na_filter=False)
