"""WS-A supplement — source pre-1970 World Cup tournament appearances from the web.

The base ingestion (``wcdraft_etl.pipeline``) is pure Fjelstul: match-level
appearance data exists upstream only from 1970, so every pre-1970 card carries
``appearances = null``. That gap is what forced ~933 defenders/keepers onto the
rating's honest "insufficient signal" null path.

This package SOURCES the missing fact from a real public record — the RSSSF
match archive — and LINKS each sourced appearance count to the canonical
``player_id``. The integrity line is hard:

  * We SOURCE and LINK real public stats; we never INVENT a factual value.
  * Pre-1970 World Cups allowed **no substitutions**, so the set of players who
    appeared in a match is exactly the listed starting XI (an in-match keeper
    swap names a player already in that XI). A player's tournament appearances =
    the number of that team's matches whose starting XI lists them. This is a
    measured fact transcribed from the lineups, not a derivation.
  * Where a lineup name cannot be UNAMBIGUOUSLY linked to one canonical card
    (transliteration differences, surname collisions an initial can't split, a
    squad RSSSF romanizes beyond recognition) we DO NOT guess — the appearance
    stays ``null`` and the case is emitted to a human review list.
  * Minutes and assists were never recorded at this era and are NOT synthesised
    (e.g. matches x 90); they remain unavailable. Honest-state is preserved.

Determinism: the committed raw RSSSF snapshots under ``etl/supplement/raw/`` are
the sole web input; parsing and linking are pure functions of those bytes plus
the canonical tables, so the overlay reproduces byte-for-byte offline.

Attribution (recorded in README + manifest): match data from the Rec.Sport.
Soccer Statistics Foundation (RSSSF, https://www.rsssf.org/), used with
acknowledgement under the RSSSF free-use-with-credit terms.
"""

from __future__ import annotations

# Pre-1970 men's World Cups whose appearances are sourced here, mapped to the
# canonical tournament_id and the RSSSF "{yy}full.html" archive page. 1970+ has
# native Fjelstul match-event appearances, so it is deliberately absent.
RSSSF_TOURNAMENTS: dict[str, str] = {
    "WC-1930": "30full.html",
    "WC-1934": "34full.html",
    "WC-1938": "38full.html",
    "WC-1950": "50full.html",
    "WC-1954": "54full.html",
    "WC-1958": "58full.html",
    "WC-1962": "62full.html",
    "WC-1966": "66full.html",
}

# Known number of matches per tournament — a completeness GATE. A tournament's
# sourced counts are trusted only if the parser recovers exactly this many
# matches from the archive; a mismatch means the parse is incomplete and the
# whole tournament is withheld (flagged), never half-sourced.
KNOWN_MATCH_COUNT: dict[str, int] = {
    "WC-1930": 18,
    "WC-1934": 17,
    "WC-1938": 18,
    "WC-1950": 22,
    "WC-1954": 26,
    "WC-1958": 35,
    "WC-1962": 32,
    "WC-1966": 32,
}

RSSSF_BASE_URL = "https://www.rsssf.org/tables/"
RSSSF_SOURCE_NAME = "Rec.Sport.Soccer Statistics Foundation (RSSSF)"
RSSSF_LICENSE = "Free use with acknowledgement (RSSSF terms)"
RSSSF_LICENSE_URL = "https://www.rsssf.org/"
RSSSF_ATTRIBUTION = (
    "Pre-1970 World Cup tournament appearances sourced from the "
    "Rec.Sport.Soccer Statistics Foundation (RSSSF) match archive "
    "(https://www.rsssf.org/), used with acknowledgement. Each appearance count "
    "is the number of a team's matches whose starting XI (no substitutes existed "
    "pre-1970) lists the player, transcribed from the committed RSSSF snapshots "
    "and linked to the canonical player_id on name + nation + tournament. "
    "Unlinkable names are withheld (null) and emitted for human review; minutes "
    "and assists remain unavailable and are never synthesised."
)

# Provenance tag written onto each overlaid card's appearances_source field.
SOURCE_TAG = "rsssf_starting_xi"
