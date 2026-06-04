"""Source access for the WS-A-2026 ingest — pinned Wikipedia raw-wikitext snapshots.

This module is the single point of contact with the upstream Wikipedia source for
the 2026 World Cup opponents (squads + draw + bracket). It mirrors ``source.py``:
it pins the *exact* upstream revisions, carries the required CC-BY-SA attribution,
and loads the committed raw-wikitext snapshots so the ingest is self-contained and
byte-deterministic WITHOUT a live network fetch (the determinism guarantee, and
what lets CI rebuild offline).

LEGAL: the 2026 squad/draw/bracket facts come from Wikipedia, CC-BY-SA 4.0 —
ShareAlike propagates exactly as the Fjelstul data does. NO EA Sports / proprietary
ratings are ingested here or anywhere downstream; the projected ratings are derived
ONLY from the factual career signals on these pages (caps, international goals,
date of birth, listed position) by wcdraft's own formula.
"""

from __future__ import annotations

import json
from pathlib import Path

# etl/src/wcdraft_etl/ -> etl/sources/wikipedia_2026
SOURCES_DIR = Path(__file__).resolve().parents[2] / "sources" / "wikipedia_2026"

SOURCE_PUBLISHER = "Wikipedia (Wikimedia Foundation)"
SOURCE_LICENSE = "CC-BY-SA 4.0"
SOURCE_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
RETRIEVED_DATE = "2026-06-04"

# The canonical 2026 tournament id (string form, matching the canonical
# tournament_id shape used by the 1930-2022 cards, e.g. "WC-1986").
TOURNAMENT_ID = "WC-2026"

# The exact CC-BY-SA 4.0 attribution block the derived 2026 data must carry.
ATTRIBUTION = (
    "2026 FIFA World Cup squads, draw, and knockout-bracket facts are from Wikipedia "
    "(English), used under CC-BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). "
    "Pinned revisions: '2026 FIFA World Cup squads' (oldid 1357762108), "
    "'2026 FIFA World Cup draw' (oldid 1357747592), and "
    "'2026 FIFA World Cup knockout stage' (oldid 1357752786), retrieved 2026-06-04. "
    "Modifications by wcdraft: parsed into canonical 2026 player cards, Team2026, and "
    "Bracket2026 records; linked players/nations to the canonical 1930-2022 identity "
    "space; derived ORIGINAL projected-career player ratings from the factual career "
    "signals (international caps, international goals, age, listed position) by wcdraft's "
    "own era-fair, position-weighted formula. No proprietary (e.g. EA Sports) ratings "
    "were ingested or perturbed; absent signals are preserved as null, never fabricated. "
    "wcdraft derived 2026 data is redistributed under CC-BY-SA 4.0 (ShareAlike)."
)


def _manifest() -> dict:
    return json.loads((SOURCES_DIR / "SOURCES.json").read_text(encoding="utf-8"))


def snapshot_meta() -> dict:
    """Return the pinned snapshot metadata (revids, timestamps, titles, urls)."""
    return _manifest()["snapshots"]


def load_wikitext(key: str) -> str:
    """Load one pinned raw-wikitext snapshot ('squads' | 'draw' | 'knockout').

    Reads the committed snapshot verbatim — no network, no NA coercion. The bytes
    on disk ARE the pinned revision; the parsers decide what each field means.
    """
    snaps = snapshot_meta()
    if key not in snaps:
        raise KeyError(f"unknown 2026 source snapshot {key!r}; known: {sorted(snaps)}")
    path = SOURCES_DIR / snaps[key]["file"]
    if not path.is_file():
        raise FileNotFoundError(f"pinned snapshot missing: {path}")
    return path.read_text(encoding="utf-8")


def source_ref(field: str | None = None, confidence: float | None = None) -> dict:
    """A SourceRef-shaped citation for the pinned Wikipedia squads revision."""
    s = snapshot_meta()["squads"]
    return {
        "source": f"Wikipedia: {s['title']} (oldid {s['revid']})",
        "source_type": "wikipedia",
        "citation": (
            f"\"{s['title']}\". Wikipedia. Revision {s['revid']} "
            f"({s['timestamp']}). {s['url']}. Used under {SOURCE_LICENSE}."
        ),
        "retrieved_date": RETRIEVED_DATE,
        "field": field,
        "confidence": confidence,
    }
