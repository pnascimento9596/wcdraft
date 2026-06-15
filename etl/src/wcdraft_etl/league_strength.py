"""Shared club-league strength prior used by rating stages.

The values are a transparent calibration prior keyed by the nation where the
player's club competes. They are not club ratings and do not ingest any
proprietary player/attribute database. Unknown clubs stay ``None``; present but
untiered leagues receive the honest weak/default tier.
"""

from __future__ import annotations

import unicodedata

_LEAGUE_TIERS: dict[float, tuple[str, ...]] = {
    1.00: ("ENG", "ESP"),
    0.90: ("GER", "ITA", "FRA"),
    0.74: ("POR", "NED", "BRA"),
    0.58: (
        "BEL",
        "TUR",
        "ARG",
        "USA",
        "KSA",
        "MEX",
        "GRE",
        "SUI",
        "RUS",
        "AUT",
        "SCO",
        "DEN",
        "CRO",
        "JPN",
        "KOR",
        "NOR",
        "CZE",
        "POL",
        "SRB",
        "UKR",
    ),
}

LEAGUE_DEFAULT = 0.42
LEAGUE_STRENGTH: dict[str, float] = {
    code: score for score, codes in _LEAGUE_TIERS.items() for code in codes
}

_CODE_ALIASES: dict[str, str] = {
    "ENGLAND": "ENG",
    "SCOTLAND": "SCO",
    "SPAIN": "ESP",
    "GERMANY": "GER",
    "WEST GERMANY": "GER",
    "ITALY": "ITA",
    "FRANCE": "FRA",
    "PORTUGAL": "POR",
    "NETHERLANDS": "NED",
    "HOLLAND": "NED",
    "BRAZIL": "BRA",
    "BELGIUM": "BEL",
    "TURKEY": "TUR",
    "TURKIYE": "TUR",
    "ARGENTINA": "ARG",
    "UNITED STATES": "USA",
    "UNITED STATES OF AMERICA": "USA",
    "USA": "USA",
    "SAUDI ARABIA": "KSA",
    "MEXICO": "MEX",
    "GREECE": "GRE",
    "SWITZERLAND": "SUI",
    "RUSSIA": "RUS",
    "AUSTRIA": "AUT",
    "DENMARK": "DEN",
    "CROATIA": "CRO",
    "JAPAN": "JPN",
    "SOUTH KOREA": "KOR",
    "KOREA REPUBLIC": "KOR",
    "REPUBLIC OF KOREA": "KOR",
    "NORWAY": "NOR",
    "CZECH REPUBLIC": "CZE",
    "CZECHIA": "CZE",
    "POLAND": "POL",
    "SERBIA": "SRB",
    "UKRAINE": "UKR",
}


def normalize_club_nation_code(value: str | None) -> str | None:
    if not value:
        return None
    text = unicodedata.normalize("NFKD", str(value).strip())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    key = " ".join(text.upper().replace("_", " ").split())
    if not key:
        return None
    if len(key) == 3 and key.isalpha():
        return key
    return _CODE_ALIASES.get(key)


def league_score(club_nation_code: str | None) -> float | None:
    """Return a league-strength score or ``None`` when the club is unknown."""
    code = normalize_club_nation_code(club_nation_code)
    if not code:
        return None
    return LEAGUE_STRENGTH.get(code, LEAGUE_DEFAULT)


def league_context_component(club_nation_code: str | None) -> float | None:
    """Normalize league score for capped-context allocation.

    Present weak/default leagues map to 0.0, ENG/ESP map to 1.0, and missing club
    nation remains ``None`` so squad activation can decide whether the component
    is usable.
    """
    score = league_score(club_nation_code)
    if score is None:
        return None
    return max(0.0, min(1.0, (score - LEAGUE_DEFAULT) / (1.0 - LEAGUE_DEFAULT)))
