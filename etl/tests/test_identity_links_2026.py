"""merit-v3 U0 — the 2026 identity-link seam fix (Audit-2 §H.3).

Guards the three repaired mechanisms and their conservatism bounds:

  * placeholder scrub — 474 historical rows carry the literal
    ``given_name = "not applicable"`` which pollutes ``full_name``
    ("not applicable Rodri") and used to defeat both corroboration rules;
  * mononym corroboration — a historical record with no usable given name
    corroborates on the mononym itself against the 2026 name/tokens;
  * given-name variant compatibility — nickname/spelling variants
    (Cammy~Cameron, Willian~William) corroborate via a >=3-char shared prefix,
    while distinct given names (the Timber twins) never do;

plus the MV2-12a bridge promotion (review-only -> real linker path, with a
hard mechanism-agreement guard) and the resolution census: the fix links
EXACTLY the 17 human-verified pairs from Audit-2 §H.3 — zero extra links,
zero removed links, zero re-assigned links.
"""

from __future__ import annotations

import json

import pytest

from wcdraft_etl import identity_2026 as idn
from wcdraft_etl import ingest_2026

OUT = ingest_2026.OUTPUT_DIR


def _load(name: str):
    return json.loads((OUT / f"{name}.json").read_text(encoding="utf-8"))


# ─── the 17 verified pairs (Audit-2 §H.3, human-verified) ─────────────────────
# Rows mirror the parsed 2026 squad fields: mononym rows carry no family/given
# (the parser leaves them None), the two variant rows carry both.
# (nation_id, birth_date, family, given, 2026 squad name) -> historical id.
VERIFIED_LINKS = {
    ("T-09", "1992-02-05", None, None, "Neymar"): "P-87008",
    ("T-73", "1996-06-22", None, None, "Rodri"): "P-62341",
    ("T-09", "1992-02-23", None, None, "Casemiro"): "P-02305",
    ("T-09", "1992-10-02", None, None, "Alisson"): "P-21531",
    ("T-09", "1993-08-17", None, None, "Ederson"): "P-89248",
    ("T-09", "1994-05-14", None, None, "Marquinhos"): "P-76060",
    ("T-09", "1993-10-23", None, None, "Fabinho"): "P-77071",
    ("T-09", "1996-12-14", None, None, "Raphinha"): "P-83169",
    ("T-09", "1987-12-13", None, None, "Weverton"): "P-66020",
    ("T-09", "1997-03-18", None, None, "Bremer"): "P-14060",
    ("T-09", "1991-07-15", None, None, "Danilo Luiz"): "P-40137",
    ("T-25", "2001-10-16", "Pacho", "Willian", "Willian Pacho"): "P-49934",
    ("T-26", "1994-10-01", None, None, "Trézéguet"): "P-82223",
    ("T-58", "2000-02-13", None, None, "Vitinha"): "P-89266",
    ("T-73", "2002-11-25", None, None, "Pedri"): "P-24897",
    ("T-73", "2004-08-05", None, None, "Gavi"): "P-88433",
    ("T-04", "1998-06-07", "Devlin", "Cammy", "Cammy Devlin"): "P-64249",
}

# The pre-fix linked census (committed at the MV2-12a tip): 335 canonical ids.
PRE_FIX_LINKED = 335
POST_FIX_LINKED = PRE_FIX_LINKED + len(VERIFIED_LINKS)


# ─── fixtures (committed outputs; the golden test pins committed == fresh) ────


@pytest.fixture(scope="module")
def cards_2026():
    return _load("player_tournaments_2026")


@pytest.fixture(scope="module")
def index():
    return idn.build_player_index(_load("players"), _load("player_tournaments"))


# ─── mechanism units: placeholder scrub ───────────────────────────────────────


def test_clean_given_name_scrubs_placeholder_only():
    assert idn.clean_given_name("not applicable") is None
    assert idn.clean_given_name("Not Applicable") is None
    assert idn.clean_given_name(None) is None
    assert idn.clean_given_name("Lionel") == "Lionel"
    # A real name CONTAINING the words is never scrubbed.
    assert idn.clean_given_name("Notap") == "Notap"


def test_clean_full_name_strips_placeholder_prefix():
    assert idn.clean_full_name("not applicable Rodri") == "Rodri"
    assert idn.clean_full_name("not applicable Ró-Ró") == "Ró-Ró"
    assert idn.clean_full_name("not applicable") is None
    assert idn.clean_full_name("Lionel Messi") == "Lionel Messi"
    assert idn.clean_full_name(None) is None


def test_index_canonicalizes_polluted_records(index):
    """The Rodri record indexes under its CLEANED forms: full 'rodri', given ''."""
    entries = {e["player_id"]: e for e in index[("T-73", "1996-06-22")]}
    rodri = entries["P-62341"]
    assert rodri["norm_full"] == "rodri"
    assert rodri["norm_given"] == ""
    assert rodri["norm_family"] == "rodri"


# ─── mechanism units: given-name variant compatibility ────────────────────────


def test_given_compatible_accepts_verified_variant_classes():
    assert idn._given_compatible("cammy", "cameron")  # nickname (shared 'cam')
    assert idn._given_compatible("willian", "william")  # spelling (shared 'willia')
    assert idn._given_compatible("ronald", "ronaldo")  # containment
    assert idn._given_compatible("pele", "pele")  # equality


def test_given_compatible_rejects_distinct_names():
    assert not idn._given_compatible("quinten", "jurrien")  # the Timber twins
    assert not idn._given_compatible("yoel", "edgar")  # Bárcenas middle-name alias
    assert not idn._given_compatible("ab", "ac")  # below the 3-char prefix floor


# ─── the 17-pair resolution census ────────────────────────────────────────────


def test_all_seventeen_verified_pairs_resolve(index):
    """Every Audit-2 §H.3 verified pair links to its exact historical id —
    through the MECHANISM (bridges must agree, never substitute)."""
    for (nation_id, dob, family, given, name), expected in VERIFIED_LINKS.items():
        pid, reason = idn.link_player_detail(nation_id, dob, family, given, name, index)
        assert pid == expected, f"{name}: {pid} != {expected} ({reason})"
        assert reason in ("linked", "linked_bridge")


def test_seventeen_pairs_linked_in_committed_cards(cards_2026):
    """The committed 2026 cards carry the 17 links (no P-W26 duplicate ids)."""
    by_pid = {c["player_id"]: c for c in cards_2026}
    for (nation_id, dob, _family, _given, _name), pid in VERIFIED_LINKS.items():
        assert pid in by_pid, f"{pid} not linked in committed cards"
        assert by_pid[pid]["link_status"] == "linked"
        assert by_pid[pid]["nation_id"] == nation_id
        assert by_pid[pid]["birth_date"] == dob


def test_no_new_links_beyond_the_seventeen(cards_2026):
    """Link census: exactly the pre-fix 335 + the 17 verified pairs. Any drift —
    an extra link OR a lost link — is a linker-behavior change that must be
    re-verified against Audit-2 §H.3 (extras are findings, never silent)."""
    linked = [c for c in cards_2026 if c["link_status"] == "linked"]
    assert len(linked) == POST_FIX_LINKED, (
        f"linked census {len(linked)} != {POST_FIX_LINKED}"
    )
    minted = [c for c in cards_2026 if c["link_status"] == "minted"]
    assert len(linked) + len(minted) == len(cards_2026)


# ─── promoted bridges ─────────────────────────────────────────────────────────


def test_bridges_fire_with_mechanism_agreement(index):
    """All 4 promoted MV2-12a bridges resolve via the bridge path, and the
    mechanism agrees with each (link_player_detail would raise otherwise)."""
    fired = 0
    for (nation_id, dob, nname), pid in idn.IDENTITY_BRIDGES.items():
        for (vnat, vdob, vfam, vgiv, vname), vpid in VERIFIED_LINKS.items():
            if (vnat, vdob, idn.normalize_name(vname)) == (nation_id, dob, nname):
                got, reason = idn.link_player_detail(vnat, vdob, vfam, vgiv, vname, index)
                assert (got, reason) == (pid, "linked_bridge")
                assert vpid == pid
                fired += 1
    assert fired == len(idn.IDENTITY_BRIDGES) == 4


def test_bridge_mechanism_divergence_fails_loudly():
    """A bridge whose target the mechanism cannot reproduce is a regression —
    the linker must raise, never silently prefer either answer."""
    nation_id, dob, nname = "T-09", "1992-02-05", "neymar"
    assert (nation_id, dob, nname) in idn.IDENTITY_BRIDGES
    # An index where the bridged key resolves to a DIFFERENT player.
    other = {
        "player_id": "P-99999",
        "norm_family": "neymar",
        "norm_given": "",
        "norm_full": "neymar",
    }
    forged = {(nation_id, dob): [other]}
    with pytest.raises(ValueError, match="identity bridge"):
        idn.link_player_detail(nation_id, dob, None, None, "Neymar", forged)


# ─── negative pins: twins, strangers, near-misses ─────────────────────────────


def test_timber_twins_stay_distinct(index, cards_2026):
    """The twins trap: same nation, birth date and surname. Jurriën (historical
    card) links; Quinten must withhold against Jurriën's record and mint."""
    pid, reason = idn.link_player_detail(
        "T-48", "2001-06-17", "Timber", "Jurrien", "Jurriën Timber", index
    )
    assert (pid, reason) == ("P-74111", "linked")
    qpid, qreason = idn.link_player_detail(
        "T-48", "2001-06-17", "Timber", "Quinten", "Quinten Timber", index
    )
    assert (qpid, qreason) == (None, "no_corroboration")
    # And the committed cards reflect it: Jurriën on the canonical id, Quinten minted.
    timbers = [
        c for c in cards_2026 if c["nation_id"] == "T-48" and c["birth_date"] == "2001-06-17"
    ]
    assert len(timbers) == 2
    statuses = {c["player_id"]: c["link_status"] for c in timbers}
    assert statuses.pop("P-74111") == "linked"
    minted_id, minted_status = statuses.popitem()
    assert minted_status == "minted" and minted_id.startswith("P-W26-")


# The audit's verified same-name strangers (§H.3 true negatives). Under the
# production (nation_id, birth_date) key none of them has any candidate — their
# audit-probe hits were artifacts of the looser cross-nation join.
STRANGERS = [
    ("T-84", "1999-08-17", "Emiliano Martínez"),  # URU 1999 ≠ Dibu (ARG)
    ("T-16", "1997-12-02", "Luis Suárez"),  # COL 1997 ≠ Luis Suárez (URU)
    ("T-70", "1997-01-24", "Teboho Mokoena"),  # RSA ≠ Aaron Mokoena
    ("T-59", "1993-01-25", "Ahmed Fathy"),  # QAT ≠ Ahmed Fathy (EGY)
    ("T-46", "2003-04-20", "Armando González"),  # MEX 2003
]


def test_same_name_strangers_stay_unlinked(index, cards_2026):
    for nation_id, dob, name in STRANGERS:
        pid, reason = idn.link_player_detail(nation_id, dob, None, None, name, index)
        assert pid is None, f"{name} must not link (got {pid})"
        assert reason == "no_candidate"
    # And none of them is linked in the committed cards.
    linked_keys = {
        (c["nation_id"], c["birth_date"])
        for c in cards_2026
        if c["link_status"] == "linked"
    }
    for nation_id, dob, name in STRANGERS:
        assert (nation_id, dob) not in linked_keys or all(
            c["link_status"] == "minted"
            for c in cards_2026
            if c["nation_id"] == nation_id and c["birth_date"] == dob
        ), f"{name} appears linked"


def test_mononym_rule_is_selective(index):
    """Mikel Merino shares Rodri's exact (nation, birth date) key; the mononym
    'Rodri' must NOT corroborate against 'Mikel Merino' (no token overlap)."""
    pid, reason = idn.link_player_detail(
        "T-73", "1996-06-22", "Merino", "Mikel", "Mikel Merino", index
    )
    assert (pid, reason) == (None, "no_corroboration")


def test_danilo_luiz_links_by_mononym_token_not_to_namesake(index):
    """'Danilo Luiz' carries the historical mononym 'Danilo' as a token; the
    OTHER Brazilian Danilo (Danilo Santos, b. 2001) must keep minting."""
    pid, reason = idn.link_player_detail(
        "T-09", "1991-07-15", None, None, "Danilo Luiz", index
    )
    assert (pid, reason) == ("P-40137", "linked")
    pid2, _reason2 = idn.link_player_detail(
        "T-09", "2001-04-29", "Santos", "Danilo", "Danilo Santos", index
    )
    assert pid2 is None


# Surfaced near-misses (NOT in the Audit-2 verified list): probable additional
# identity misses found while fixing the mechanism, withheld pending human
# verification — a future curation unit may bridge them. Pinned so a silent
# linker loosening cannot quietly merge them.
SURFACED_NEAR_MISSES = [
    ("T-59", "1990-08-06", None, None, "Pedro Miguel"),  # vs Ró-Ró (QAT) — alias
    ("T-47", "2004-05-10", "El Khannouss", "Bilal", "Bilal El Khannouss"),  # vs El Khannous
    ("T-32", "2004-03-08", "Fatawu", "Abdul", "Abdul Fatawu"),  # vs A. F. Issahaku
    ("T-32", "1994-07-02", "Baba", "Abdul Rahman", "Abdul Rahman Baba"),  # vs Baba Rahman
    ("T-54", "1993-10-23", "Bárcenas", "Yoel", "Yoel Bárcenas"),  # vs Édgar Bárcenas
]


def test_surfaced_near_misses_stay_withheld(index):
    for nation_id, dob, family, given, name in SURFACED_NEAR_MISSES:
        pid, reason = idn.link_player_detail(nation_id, dob, family, given, name, index)
        assert pid is None, f"{name} must stay withheld pending verification (got {pid})"
        assert reason == "no_corroboration"


# ─── ambiguity withholds (the strengthened MV2-12a guard pattern) ─────────────


def test_multi_candidate_withholds():
    """Two corroborating candidates at one key -> withhold with multi_candidate
    (mint), never pick one."""
    key = ("T-09", "1990-01-01")
    twin = lambda pid: {  # noqa: E731 - local literal
        "player_id": pid,
        "norm_family": "silva",
        "norm_given": "",
        "norm_full": "silva",
    }
    synthetic = {key: [twin("P-1"), twin("P-2")]}
    pid, reason = idn.link_player_detail(key[0], key[1], None, None, "Silva", synthetic)
    assert (pid, reason) == (None, "multi_candidate")


def test_missing_birth_date_withholds(index):
    pid, reason = idn.link_player_detail("T-09", None, None, None, "Neymar", index)
    assert (pid, reason) == (None, "no_birth_date")
