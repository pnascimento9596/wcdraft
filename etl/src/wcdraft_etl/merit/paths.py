"""Filesystem anchors for the merit package (committed inputs + emitted outputs).

The raw snapshots live OUTSIDE the Python package (``etl/merit/raw/``) next to the
manifest, mirroring the RSSSF supplement layout (``etl/supplement/raw/``). Outputs
land under ``etl/output/merit/``. All paths are derived from this file's location
so the package is import-location independent."""

from __future__ import annotations

from pathlib import Path

# .../etl/src/wcdraft_etl/merit/paths.py -> parents[3] == .../etl
_ETL_ROOT = Path(__file__).resolve().parents[3]

RAW_DIR = _ETL_ROOT / "merit" / "raw"
MANIFEST_PATH = _ETL_ROOT / "merit" / "fetch_manifest.json"
OUTPUT_DIR = _ETL_ROOT / "output" / "merit"

# Deterministic factual research backstop (MV2-2): committed citation-backed notes
# live under ``merit/raw/research/`` with their OWN pinned manifest, separate from
# the fetched web snapshots in ``fetch_manifest.json`` (research notes are authored
# from fetched-and-verified public citations, not downloaded as a single page).
RESEARCH_DIR = RAW_DIR / "research"
RESEARCH_MANIFEST_PATH = RESEARCH_DIR / "manifest.json"


def read_raw(raw_file: str, charset: str) -> str:
    """Read a committed snapshot as text in its declared charset."""
    return (RAW_DIR / raw_file).read_text(encoding=charset)
