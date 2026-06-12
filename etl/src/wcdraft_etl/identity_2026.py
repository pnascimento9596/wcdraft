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
    with a normalized name corroboration; it is deliberately CONSERVATIVE —
    an ambiguous match mints a new id rather than risk a wrong merge.
  * merit-v3 U0 (Audit-2 §H.3): corroboration is placeholder-aware and
    mononym-aware. 474 historical rows carry the literal ``given_name``
    placeholder ``"not applicable"`` (which pollutes ``full_name`` —
    ``"not applicable Rodri"``); those are scrubbed before matching, and a
    historical mononym record (no usable given name) corroborates on the
    mononym itself against the 2026 name/tokens. Given-name compatibility
    extends to nickname/spelling variants via a shared-prefix rule
    (Cammy~Cameron, Willian~William). Ambiguity (>1 survivor) still withholds —
    the strengthened MV2-12a ``multi_candidate`` guard pattern.
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


# ─── name-form canonicalization (merit-v3 U0, Audit-2 §H.3) ─────────────────────

# The upstream historical source uses this literal where a player has no given
# name (mononyms — 474 rows: Neymar, Rodri, Casemiro, …). It pollutes
# ``full_name`` as ``"not applicable <family>"`` and defeated both corroboration
# rules, so every such player re-appearing in 2026 minted a duplicate identity.
_GIVEN_NAME_PLACEHOLDER = "not applicable"

# Given-name nickname/spelling variants corroborate when they share at least
# this many leading characters (normalized): Cammy~Cameron ("cam"),
# Willian~William ("willia"). Distinct given names — the Timber-twins class
# (Quinten vs Jurriën, prefix 0) — stay incompatible.
_GIVEN_PREFIX_MIN = 3


def clean_given_name(given: str | None) -> str | None:
    """The literal placeholder means ABSENT, not a name — map it to None."""
    if given is not None and given.strip().lower() == _GIVEN_NAME_PLACEHOLDER:
        return None
    return given


def clean_full_name(full: str | None) -> str | None:
    """Strip the given-name placeholder the source bakes into ``full_name``
    (``"not applicable Rodri"`` -> ``"Rodri"``). Clean names pass through."""
    if full is None:
        return None
    stripped = full.strip()
    if stripped.lower().startswith(_GIVEN_NAME_PLACEHOLDER + " "):
        return stripped[len(_GIVEN_NAME_PLACEHOLDER) + 1 :]
    if stripped.lower() == _GIVEN_NAME_PLACEHOLDER:
        return None
    return stripped


def name_tokens(s: str | None) -> list[str]:
    """Normalized per-token forms of a name ("Danilo Luiz" -> ["danilo","luiz"])."""
    return [t for t in (normalize_name(tok) for tok in (s or "").split()) if t]


def _given_compatible(a: str, b: str) -> bool:
    """Normalized given names corroborate when equal, one contains the other
    (Ronald~Ronaldo), or they share a >=3-char prefix (nickname/spelling
    variants: Cammy~Cameron, Willian~William). Names with no shared prefix —
    the same-family same-birth-date twins class — never corroborate."""
    if a == b or a in b or b in a:
        return True
    prefix = 0
    for ca, cb in zip(a, b, strict=False):
        if ca != cb:
            break
        prefix += 1
    return prefix >= _GIVEN_PREFIX_MIN


# ─── promoted identity bridges (MV2-12a review -> real linker path) ────────────

# The four MV2-12a ``identity_bridge_review`` entries, promoted from review-only
# staging into the real linker path (merit-v3 U0's deliberate flip). Each pair
# was birth-date-corroborated by the 12a build and human-verified in the Audit-2
# §H.3 sweep. Keyed by the NATURAL identity key — (nation_id, birth_date,
# normalized 2026 squad name) — because minted ``P-W26-*`` ids are positional
# and cease to exist once their player links. The bridge is authoritative but
# never silently divergent: ``link_player`` raises if the generalized mechanism
# resolves a bridged player to a different id (mechanism regression guard).
IDENTITY_BRIDGES: dict[tuple[str, str, str], str] = {
    ("T-09", "1992-02-05", "neymar"): "P-87008",      # Neymar (Brazil)
    ("T-09", "1992-10-02", "alisson"): "P-21531",     # Alisson (Brazil)
    ("T-09", "1994-05-14", "marquinhos"): "P-76060",  # Marquinhos (Brazil)
    ("T-73", "1996-06-22", "rodri"): "P-62341",       # Rodri (Spain)
}


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
        # Placeholder-scrubbed canonical forms (merit-v3 U0): a "not applicable"
        # given name is ABSENT (norm_given "") and the polluted full_name is
        # cleaned, so "not applicable Rodri" indexes as the mononym "Rodri".
        entry = {
            "player_id": pid,
            "norm_family": normalize_name(p.get("family_name")),
            "norm_given": normalize_name(clean_given_name(p.get("given_name"))),
            "norm_full": normalize_name(clean_full_name(p.get("full_name"))),
        }
        for nid in nats:
            index.setdefault((nid, p["birth_date"]), []).append(entry)
    return index


def link_player_detail(
    nation_id: str,
    birth_date: str | None,
    family_name: str | None,
    given_name: str | None,
    full_name: str | None,
    index: dict[tuple[str, str], list[dict]],
) -> tuple[str | None, str]:
    """Resolve a 2026 player against the canonical index; return
    ``(player_id | None, reason)``.

    Conservative: requires a birth-date + nation match, then name corroboration,
    and a UNIQUE survivor. Corroboration (placeholder-scrubbed, merit-v3 U0):

      1. exact canonical full-name match ("Neymar" == cleaned "Neymar"); or
      2. the historical record is a MONONYM (no usable given name survives the
         placeholder scrub, so given-name corroboration is impossible for this
         record class BY CONSTRUCTION) and the mononym equals the 2026 player's
         whole canonical name or one of its name tokens ("Danilo Luiz" carries
         "Danilo"). Records WITH a usable given name never take this path, so
         same-DOB namesakes with real given names (the Timber twins) cannot
         slip through it; or
      3. family-name match WITH a compatible given name (equality, containment,
         or a >=3-char shared prefix for nickname/spelling variants) — distinct
         given names (Quinten vs Jurriën) still refuse to corroborate.

    Promoted MV2-12a bridges short-circuit to their human-verified target, with
    a hard error if the mechanism disagrees. Any ambiguity (no birth date, no
    corroboration, or >1 survivor) withholds -> mint; reasons: ``linked``,
    ``linked_bridge``, ``no_birth_date``, ``no_candidate``, ``no_corroboration``,
    ``multi_candidate``.
    """
    if not birth_date:
        return None, "no_birth_date"
    candidates = index.get((nation_id, birth_date), [])
    if not candidates:
        return None, "no_candidate"
    nf = normalize_name(family_name)
    ng = normalize_name(clean_given_name(given_name))
    nfull = normalize_name(clean_full_name(full_name))
    toks = name_tokens(clean_full_name(full_name))

    def _hit(c: dict) -> bool:
        if nfull and nfull == c["norm_full"]:
            return True
        if not c["norm_given"]:
            # Historical mononym record (placeholder-scrubbed): corroborate on
            # the mononym itself, against the whole 2026 name or its tokens.
            mono = c["norm_family"]
            return bool(mono) and (mono == nfull or mono in toks)
        if not (nf and nf == c["norm_family"]):
            return False
        if ng:
            return _given_compatible(ng, c["norm_given"])
        return False

    hits = [c for c in candidates if _hit(c)]
    mechanism_pid = hits[0]["player_id"] if len(hits) == 1 else None

    bridge_pid = IDENTITY_BRIDGES.get((nation_id, birth_date, nfull))
    if bridge_pid is not None:
        # The bridge is human-verified ground truth; the generalized mechanism
        # must agree with it or the linker has regressed — fail the build.
        if mechanism_pid != bridge_pid:
            raise ValueError(
                f"identity bridge {(nation_id, birth_date, nfull)} -> {bridge_pid} "
                f"disagrees with linker mechanism result {mechanism_pid!r}"
            )
        return bridge_pid, "linked_bridge"

    if mechanism_pid is not None:
        return mechanism_pid, "linked"
    if len(hits) > 1:
        return None, "multi_candidate"
    return None, "no_corroboration"


def link_player(
    nation_id: str,
    birth_date: str | None,
    family_name: str | None,
    given_name: str | None,
    full_name: str | None,
    index: dict[tuple[str, str], list[dict]],
) -> str | None:
    """Return an existing canonical player_id to link to, or None to mint
    (see ``link_player_detail`` for the corroboration rules + withhold reasons)."""
    pid, _ = link_player_detail(nation_id, birth_date, family_name, given_name, full_name, index)
    return pid
