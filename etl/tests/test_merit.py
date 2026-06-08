"""ENGINE-V2 E-4.1 merit intake: parser correctness, conservative linking,
determinism, brand-neutrality, and the SHA-pin.

Self-contained — reads the committed canonical JSON in ``etl/output/`` plus the
committed raw snapshots under ``etl/merit/raw/``, so it runs without the upstream
Fjelstul CSV clone. The committed snapshots are a fixed input, so the assertions
are stable run-to-run.

This suite asserts ONLY coverage/intake behavior — E-4.1 changes no rating output,
and ``test_no_rating_artifact_is_touched`` guards that boundary.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wcdraft_etl.merit import (
    VERSION,
    MeritRecord,
    parse_century_caps,
    parse_century_election,
    parse_poy,
    parse_wiki,
)
from wcdraft_etl.merit import fetch as merit_fetch
from wcdraft_etl.merit.build import build
from wcdraft_etl.merit.link import build_canon, link_records
from wcdraft_etl.merit.nation import NationResolver

REPO_ROOT = Path(__file__).resolve().parents[2]
MERIT_SRC = REPO_ROOT / "etl" / "src" / "wcdraft_etl" / "merit"
MERIT_RAW = REPO_ROOT / "etl" / "merit" / "raw"
MERIT_OUT = REPO_ROOT / "etl" / "output" / "merit"


@pytest.fixture(scope="session")
def built() -> dict:
    # write=False: tests must never depend on (or mutate) committed outputs.
    return build(write=False)


# ─── parser correctness (assert documented facts, don't eyeball) ──────────────


def test_poy_winners_have_distinctive_names_and_years():
    eu = parse_poy.parse("european_poy")
    sa = parse_poy.parse("south_american_poy")
    eu_by_year = {r.year: r.name for r in eu}
    # Ballon d'Or facts.
    assert "MATTHEWS" in eu_by_year[1956].upper()
    assert "CRUYFF" in eu_by_year[1974].upper() or "CRUIJFF" in eu_by_year[1974].upper()
    assert "WEAH" in eu_by_year[1995].upper()
    # South American POY facts.
    sa_by_year = {}
    for r in sa:
        sa_by_year.setdefault(r.year, []).append(r.name.upper())
    assert any("PELÉ" in n or "PELE" in n.replace("É", "E") for n in sa_by_year[1973])
    assert any("MARADONA" in n for n in sa_by_year[1979])
    # No winner row leaks the goalkeeper/runner-up sections (vote-count artefacts).
    assert all(not r.name.strip().isdigit() for r in eu)


def test_century_caps_values_respect_section_thresholds():
    recs = parse_century_caps.parse()
    caps = [r for r in recs if r.extra["list"] == "caps"]
    goals = [r for r in recs if r.extra["list"] == "goals"]
    assert caps and goals
    assert min(r.extra["value"] for r in caps) >= 100  # "century of caps"
    assert min(r.extra["value"] for r in goals) >= 30  # "30 or more goals"
    # Names never absorb the bracketed nation or the trailing counts.
    for r in recs:
        assert "[" not in r.name and not any(c.isdigit() for c in r.name)


def test_century_election_excludes_keeper_and_female_polls():
    recs = parse_century_election.parse()
    assert recs
    for r in recs:
        low = r.extra["election"].lower()
        assert "keeper" not in low and "female" not in low
    # The headline world election ranks Pelé first.
    world = [r for r in recs if r.extra["election"].startswith("World")]
    assert world and world[0].name.replace("é", "e").lower().startswith("pel")


def test_wiki_parsers_extract_player_not_flag():
    best = parse_wiki.parse_iffhs_best()
    legends = parse_wiki.parse_living_legends()
    # IFFHS World's Best ran 1988-1990 then revived 2020+ (a genuine gap, not a bug).
    assert {r.year for r in best} >= {1988, 1989, 1990, 2024}
    assert all(r.name and "national football team" not in r.name.lower() for r in best)
    # The 2004 living-legends list is the 125-player selection.
    assert len(legends) == 125
    assert all(r.year == 2004 for r in legends)


def test_golden_ball_crosscheck_rows_are_year_keyed():
    rows = parse_wiki.parse_wc_awards_crosscheck()
    by_year = {r["year"]: r["name"] for r in rows}
    assert by_year[1986] == "Diego Maradona"
    assert "Messi" in by_year[2022]


# ─── nation resolver ──────────────────────────────────────────────────────────


def test_nation_resolver_handles_codes_names_and_successors():
    nations = json.loads((REPO_ROOT / "etl" / "output" / "nations.json").read_text())
    r = NationResolver(nations)
    assert r.resolve("Arg") == r.resolve("Argentina")
    assert r.resolve("Arg")  # non-empty
    # A successor-spanning code resolves to a SET that includes both states.
    ger = r.resolve("Ger")
    assert len(ger) >= 2  # Germany + West Germany (+ East Germany)
    # Full-name tokens are successor-lineage expanded: "Germany" corroborates a
    # West-Germany card, "Russia" corroborates a Soviet-Union card.
    nid = {n["canonical_name"]: n["nation_id"] for n in nations}
    assert nid["West Germany"] in r.resolve("Germany")
    assert nid["Soviet Union"] in r.resolve("Russia")
    # ...but unrelated nations are never merged.
    assert nid["Spain"] not in r.resolve("Argentina")
    # An unmapped token is honestly empty (nation simply unavailable).
    assert r.resolve("ZZZ") == frozenset()
    assert r.resolve(None) == frozenset()


# ─── conservative linking: link don't guess ──────────────────────────────────


def test_native_golden_ball_matches_public_list(built):
    cc = built["crosscheck"]
    assert cc["checked"] >= 10
    assert cc["agree"] == cc["checked"], cc["mismatches"]


def test_canonical_greats_pick_up_stature(built):
    """The de-risk signal: every canonical great links at least one stature fact."""
    by_player: dict[str, set] = {}
    for f in built["facts"]:
        by_player.setdefault(f["player_id"], set()).add(f["family"])
    greats = {
        "P-38906": "Pelé",
        "P-80404": "Maradona",
        "P-72864": "Beckenbauer",
        "P-14758": "Messi",
        "P-56430": "Zidane",
        "P-46080": "Garrincha",
        "P-34403": "Di Stéfano",
    }
    for pid, name in greats.items():
        assert by_player.get(pid), f"{name} ({pid}) picked up no stature fact"
    # Pelé spans all four active families.
    assert by_player["P-38906"] >= {
        "wc_legacy",
        "annual_recognition",
        "international_record",
        "retrospective_selection",
    }


def test_weah_is_not_mislinked_to_his_son(built):
    """George Weah (Ballon d'Or 1995) has only his son Timothy in the men's pool;
    nation/year do not corroborate, so the record is WITHHELD, never assigned."""
    weah_facts = [f for f in built["facts"] if "WEAH" in f["raw_name"].upper()]
    assert not any(f["player_id"] == "P-30252" for f in weah_facts)
    withheld = [
        r
        for r in built["review"]
        if "WEAH" in r["raw_name"].upper() and r["source_id"] == "european_poy"
    ]
    assert withheld, "Weah must be in the review queue, not silently dropped"


def test_review_rows_are_auditable_and_never_assigned(built):
    valid = {
        "no_candidate",
        "multi_candidate",
        "nation_mismatch",
        "nation_divergent",
        "weak_unverified",
    }
    for r in built["review"]:
        assert r["reason"] in valid, r["reason"]
        assert r["raw_name"]
        assert r["occurrences"] >= 1
        assert isinstance(r["candidates"], list)


def test_namesake_from_another_country_is_withheld_not_mislinked(built):
    """A full-name match whose source nation contradicts the only canonical card
    (no successor-lineage overlap, no career-year corroboration) is WITHHELD, not
    assigned — it is likely a coincidental namesake. The IFFHS Century lists the
    Ivorian 'Youssouf Fofana'; the only such card in the men's pool is the modern
    French player (P-23304, World Cup 2022), so the record must NOT link to him."""
    assert not any(f["player_id"] == "P-23304" for f in built["facts"])
    withheld = [
        r
        for r in built["review"]
        if r["reason"] == "nation_divergent" and "fofana" in r["raw_name"].lower()
    ]
    assert withheld, "the Ivorian Fofana record must be withheld for review"


def test_no_fact_is_assigned_against_a_contradicting_nation(built):
    """No assigned fact may carry a 'divergent' method — nation contradictions are
    withheld, never silently assigned with a flag."""
    assert not [f for f in built["facts"] if "divergent" in f["method"]]


def test_no_fact_is_a_fabricated_zero(built):
    """Every fact is a real linked record; absence is never written as a fact."""
    for f in built["facts"]:
        assert f["player_id"].startswith("P-")
        assert f["family"]
        assert f["method"]


def test_distinct_null_year_facts_survive_dedup_exact_duplicates_collapse():
    """Regression for the de-dupe key: a null-year ranked-list row carries a
    metric/election discriminator, so genuinely distinct facts that share a null
    year survive — a century-caps player keeps BOTH caps and goals, and a player
    elected in several distinct century polls keeps EACH election — while an exact
    repeat of the same row still collapses to a single fact."""
    players = [
        {
            "player_id": "P-TEST",
            "given_name": "Distinctive",
            "family_name": "Testplayer",
            "full_name": "Distinctive Testplayer",
            "common_name": None,
        }
    ]
    cards = [{"player_id": "P-TEST", "nation_id": "N-1", "tournament_id": "WC-1970"}]
    tournaments = [{"tournament_id": "WC-1970", "womens": False}]
    nations = [{"nation_id": "N-1", "canonical_name": "Testland"}]
    canon = build_canon(players, cards, tournaments, nations)

    name = "Distinctive Testplayer"  # distinctive full name -> links on its own
    records = [
        # century-caps page emits BOTH metrics for one player, year=None.
        MeritRecord(
            "international_century_caps", "international_record", name,
            year=None, detail="caps=150 (1968-1975)",
            extra={"list": "caps", "value": 150},
        ),
        MeritRecord(
            "international_century_caps", "international_record", name,
            year=None, detail="goals=40", extra={"list": "goals", "value": 40},
        ),
        # an EXACT repeat of the caps row must collapse, not duplicate.
        MeritRecord(
            "international_century_caps", "international_record", name,
            year=None, detail="caps=150 (1968-1975)",
            extra={"list": "caps", "value": 150},
        ),
        # two DISTINCT century elections for the same player, year=None.
        MeritRecord(
            "iffhs_century", "retrospective_selection", name, year=None,
            detail="century election: World - Player of the Century",
            extra={"election": "World - Player of the Century"},
        ),
        MeritRecord(
            "iffhs_century", "retrospective_selection", name, year=None,
            detail="century election: Europe - Player of the Century",
            extra={"election": "Europe - Player of the Century"},
        ),
        # an EXACT repeat of the World election must collapse.
        MeritRecord(
            "iffhs_century", "retrospective_selection", name, year=None,
            detail="century election: World - Player of the Century",
            extra={"election": "World - Player of the Century"},
        ),
    ]
    facts, _review = link_records(records, canon)
    mine = [f for f in facts if f["player_id"] == "P-TEST"]

    caps_goals = sorted(
        f["detail"] for f in mine if f["source_id"] == "international_century_caps"
    )
    assert caps_goals == ["caps=150 (1968-1975)", "goals=40"]  # both kept; dup gone

    elections = sorted(f["detail"] for f in mine if f["source_id"] == "iffhs_century")
    assert elections == [
        "century election: Europe - Player of the Century",
        "century election: World - Player of the Century",
    ]  # both distinct elections kept; dup gone

    # 2 international-record + 2 retrospective facts; the two exact repeats collapsed.
    assert len(mine) == 4


# ─── honest-state boundary: NO rating output is touched ───────────────────────


def test_no_rating_artifact_is_imported_or_written():
    """E-4.1 is coverage-only. No merit module may IMPORT the rating/engine layer
    or WRITE a rating/engine/compact artifact. Checked against real import
    statements and artifact filenames — prose that merely says "no rating output"
    is fine."""
    bad_imports = ("from ..rating", "import rating", "from ..supplement", "calibration")
    bad_filenames = ("ratings.json", "ratings_2026.json", ".compact.json", "engine_version")
    for path in MERIT_SRC.glob("*.py"):
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            is_import = line.startswith(("import ", "from "))
            if is_import:
                for tok in bad_imports:
                    assert tok not in line, f"{path.name}: imports rating layer: {line!r}"
            # No string literal naming a rating/engine artifact (write target).
            for fn in bad_filenames:
                assert fn not in line, f"{path.name}: references artifact {fn!r}"


# ─── brand-neutrality ─────────────────────────────────────────────────────────


def test_outputs_and_code_carry_no_governing_body_brand():
    """Source ids, field names, report text and output VALUES carry no 'fifa'
    brand string. It is allowed ONLY in a provenance URL (manifest) and in the
    proprietary block-list tokens (forbidden strings, mirrored from the IP audit).
    """
    # Outputs: zero 'fifa' anywhere.
    for path in MERIT_OUT.glob("*"):
        assert "fifa" not in path.read_text(encoding="utf-8").lower(), path.name
    # Code: 'fifa' only inside provenance URLs or the block-list token tuple.
    blocklist_ok = ("sofifa",)
    for path in MERIT_SRC.glob("*.py"):
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
            low = line.lower()
            if "fifa" not in low:
                continue
            is_url = "http" in low
            is_block = any(tok in low for tok in blocklist_ok)
            assert is_url or is_block, f"{path.name}:{i + 1}: stray brand: {line.strip()!r}"


# ─── SHA-pin + determinism ────────────────────────────────────────────────────


def test_committed_snapshots_match_manifest_sha():
    assert merit_fetch.verify() == 0


def test_manifest_covers_every_source():
    manifest = json.loads((REPO_ROOT / "etl" / "merit" / "fetch_manifest.json").read_text())
    files = {f["file"] for f in manifest["files"]}
    from wcdraft_etl.merit import SOURCES

    assert files == {s.raw_file for s in SOURCES}
    assert manifest["version"] == VERSION


def test_build_is_deterministic():
    a = build(write=False)
    b = build(write=False)
    dump = lambda o: json.dumps(o, ensure_ascii=False, sort_keys=True)  # noqa: E731
    assert dump(a["facts"]) == dump(b["facts"])
    assert dump(a["review"]) == dump(b["review"])
    assert a["report_md"] == b["report_md"]


def test_committed_outputs_are_in_sync_with_a_fresh_build(built):
    """The committed source_facts.json must equal a fresh in-memory build — proof
    the artifacts were regenerated, not hand-edited."""
    committed = json.loads((MERIT_OUT / "source_facts.json").read_text())
    assert committed["facts"] == built["source_facts"]["facts"]
    assert committed["version"] == VERSION
