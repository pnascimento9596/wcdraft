"""Identity resolution for the 2026 ingest: nations and cross-tournament players.

Two linkage problems, both solved against the committed canonical 1930-2022
tables so a 2026 player/nation that ALREADY exists keeps its stable id:

NATIONS
  * 43 of the 48 teams match an existing canonical nation by name (exact).
  * 5 are debutants in their current form and are MINTED here with namespaced
    ids (``T-W26-*``) so they can never collide with the upstream ``T-NN`` id
    space. DR Congo is minted fresh rather than merged onto the historical Zaire
    (``T-88``): the repo's invariant is that historical entities stay separate and
    are never merged, so we record Zaire as DR Congo's predecessor instead.
  * The final-draw table keys teams by FIFA tri-code, which is NOT the ISO-3 code
    the canonical table uses (FIFA ``GER`` vs ISO ``DEU`` etc.), so an explicit,
    auditable FIFA->nation map is required reference data.

PLAYERS
  * A 2026 player who already has a 1930-2022 card LINKS to that canonical
    ``player_id`` (e.g. a 2022+2026 player shares one id); otherwise a new stable
    namespaced id (``P-W26-*``) is minted. Linking keys on (nation, date of birth)
    with a normalized family-name corroboration; it is deliberately CONSERVATIVE —
    an ambiguous match mints a new id rather than risk a wrong merge.
"""

from __future__ import annotations

import unicodedata

# ─── new nations (minted; full canonical shape, matching nations.json) ──────────
# Sorted by canonical_name so the minted ids are stable and order-independent.
NEW_NATIONS: list[dict] = [
    {
        "nation_id": "T-W26-1",
        "code": "CPV",
        "canonical_name": "Cape Verde",
        "confederation": "CAF",
        "historical": False,
        "mens_team": True,
        "womens_team": False,
        "aliases": ["Cabo Verde"],
        "successor": None,
    },
    {
        "nation_id": "T-W26-2",
        "code": "CUW",
        "canonical_name": "Curaçao",
        "confederation": "CONCACAF",
        "historical": False,
        "mens_team": True,
        "womens_team": False,
        "aliases": [],
        "successor": None,
    },
    {
        "nation_id": "T-W26-3",
        "code": "COD",
        "canonical_name": "DR Congo",
        "confederation": "CAF",
        "historical": False,
        "mens_team": True,
        "womens_team": False,
        "aliases": ["Democratic Republic of the Congo", "Congo DR"],
        # Same football association as the historical "Zaire" (T-88, 1974); kept
        # as a SEPARATE current entity per the never-merge-historical invariant.
        "predecessor": "T-88",
        "successor": None,
    },
    {
        "nation_id": "T-W26-4",
        "code": "JOR",
        "canonical_name": "Jordan",
        "confederation": "AFC",
        "historical": False,
        "mens_team": True,
        "womens_team": False,
        "aliases": [],
        "successor": None,
    },
    {
        "nation_id": "T-W26-5",
        "code": "UZB",
        "canonical_name": "Uzbekistan",
        "confederation": "AFC",
        "historical": False,
        "mens_team": True,
        "womens_team": False,
        "aliases": [],
        "successor": None,
    },
]

# squads-page section header -> minted nation_id (the 5 that don't match by name).
_MINT_BY_NAME = {n["canonical_name"]: n["nation_id"] for n in NEW_NATIONS}

# FIFA tri-code (final-draw table) -> nation_id. Explicit because FIFA codes are
# a distinct code system from the ISO-3 codes the canonical table carries.
FIFA_TO_NATION: dict[str, str] = {
    "MEX": "T-46", "RSA": "T-70", "KOR": "T-71", "CZE": "T-20",
    "CAN": "T-12", "BIH": "T-08", "QAT": "T-59", "SUI": "T-75",
    "BRA": "T-09", "MAR": "T-47", "HAI": "T-34", "SCO": "T-64",
    "USA": "T-83", "PAR": "T-55", "AUS": "T-04", "TUR": "T-80",
    "GER": "T-31", "CUW": "T-W26-2", "CIV": "T-42", "ECU": "T-25",
    "NED": "T-48", "JPN": "T-44", "SWE": "T-74", "TUN": "T-79",
    "BEL": "T-06", "EGY": "T-26", "IRN": "T-38", "NZL": "T-49",
    "ESP": "T-73", "CPV": "T-W26-1", "KSA": "T-63", "URU": "T-84",
    "FRA": "T-30", "SEN": "T-65", "IRQ": "T-39", "NOR": "T-53",
    "ARG": "T-03", "ALG": "T-01", "AUT": "T-05", "JOR": "T-W26-4",
    "POR": "T-58", "COD": "T-W26-3", "UZB": "T-W26-5", "COL": "T-16",
    "ENG": "T-28", "CRO": "T-18", "GHA": "T-32", "PAN": "T-54",
}


def nation_id_for_team(team_name: str, existing_by_name: dict[str, str]) -> str:
    """Resolve a squads-page team header to a nation_id (existing or minted)."""
    if team_name in existing_by_name:
        return existing_by_name[team_name]
    if team_name in _MINT_BY_NAME:
        return _MINT_BY_NAME[team_name]
    raise KeyError(f"2026 team {team_name!r} matches no canonical nation and is not a known mint")


# ─── name normalization (accent/punct-insensitive) ─────────────────────────────


def normalize_name(s: str | None) -> str:
    """Lowercase, strip diacritics and non-alphanumerics — for tolerant matching
    of names that differ only by accents/spacing across sources."""
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    return "".join(c for c in no_accents.lower() if c.isalnum())


# ─── cross-tournament player linking ────────────────────────────────────────────


def build_player_index(
    players: list[dict], cards: list[dict]
) -> dict[tuple[str, str], list[dict]]:
    """Index existing players by (nation_id-ever-played, birth_date).

    A player is indexed under every nation_id they ever carried a card for, so a
    2026 player is matched within the nation they represent in 2026. The value is
    the list of candidate player records (with normalized family name attached).
    """
    nations_of: dict[str, set[str]] = {}
    for c in cards:
        nations_of.setdefault(c["player_id"], set()).add(c["nation_id"])
    by_id = {p["player_id"]: p for p in players}
    index: dict[tuple[str, str], list[dict]] = {}
    for pid, nats in nations_of.items():
        p = by_id.get(pid)
        if p is None or not p.get("birth_date"):
            continue
        entry = {
            "player_id": pid,
            "norm_family": normalize_name(p.get("family_name")),
            "norm_given": normalize_name(p.get("given_name")),
            "norm_full": normalize_name(p.get("full_name")),
        }
        for nid in nats:
            index.setdefault((nid, p["birth_date"]), []).append(entry)
    return index


def link_player(
    nation_id: str,
    birth_date: str | None,
    family_name: str | None,
    given_name: str | None,
    full_name: str | None,
    index: dict[tuple[str, str], list[dict]],
) -> str | None:
    """Return an existing canonical player_id to link to, or None to mint.

    Conservative: requires a birth-date + nation match, then name corroboration,
    and a UNIQUE survivor. Corroboration is either an exact normalized full-name
    match OR a family-name match WITH a compatible given name — the given-name
    check is what stops same-DOB / same-surname / same-nation namesakes (e.g. the
    Timber twins) from collapsing onto one canonical id. Any ambiguity (no birth
    date, no corroboration, or >1 survivor) returns None -> mint, so a wrong merge
    is never silently made.
    """
    if not birth_date:
        return None
    candidates = index.get((nation_id, birth_date), [])
    if not candidates:
        return None
    nf = normalize_name(family_name)
    ng = normalize_name(given_name)
    nfull = normalize_name(full_name)

    def _hit(c: dict) -> bool:
        if nfull and nfull == c["norm_full"]:
            return True
        if not (nf and nf == c["norm_family"]):
            return False
        # Family + DOB + nation align; require a compatible GIVEN name to confirm —
        # this rejects same-DOB / same-surname / same-nation namesakes (e.g. the
        # Timber twins). If a given name is unavailable on EITHER side, we CANNOT
        # corroborate, so we do NOT link (mint instead) — conservative by design.
        if ng and c["norm_given"]:
            return ng == c["norm_given"] or ng in c["norm_given"] or c["norm_given"] in ng
        return False

    hits = [c for c in candidates if _hit(c)]
    if len(hits) == 1:
        return hits[0]["player_id"]
    return None
