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
    POSITIONS,
    SOURCE_SET_VERSION,
    VERSION,
    MeritRecord,
    parse_century_caps,
    parse_century_election,
    parse_iffhs_dreamteams,
    parse_poy,
    parse_rsssf_awards,
    parse_wiki,
    parse_wiki_awards,
    parse_wiki_xi,
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
    # Pelé spans the v2 families available to him: World Cup legacy, regional annual
    # (South American Player of the Year), international record, and retrospective.
    assert by_player["P-38906"] >= {
        "wc_legacy",
        "regional_annual_recognition",
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
    assert manifest["version"] == SOURCE_SET_VERSION


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
    assert committed["version"] == SOURCE_SET_VERSION


# ─── MV2-1: v2 source-set expansion (parsers, positions, coverage) ────────────


def test_source_set_and_stature_table_versions_are_independent():
    """The two version axes move independently: MV2-1/2 bumped the SOURCE-SET to v2;
    MV2-3 now bumps the career-stature TABLE to v2 to consume that breadth. They are
    distinct strings (different schemas, different change cadences)."""
    assert SOURCE_SET_VERSION == "merit-source-set-2.0.0"
    assert VERSION == "career-stature-2.0.0"
    assert SOURCE_SET_VERSION != VERSION


def test_manifest_dedups_a_shared_snapshot():
    """A snapshot backing more than one logical source (the SAM page backs both the
    winners and the placements parser) is pinned ONCE — one manifest entry per file,
    yet the SOURCES set still references it."""
    manifest = json.loads((REPO_ROOT / "etl" / "merit" / "fetch_manifest.json").read_text())
    files = [f["file"] for f in manifest["files"]]
    assert len(files) == len(set(files)), "duplicate file entry in fetch manifest"
    from wcdraft_etl.merit import SOURCE_BY_ID

    assert SOURCE_BY_ID["south_american_poy"].raw_file == "rsssf/sam-poy.html"
    assert SOURCE_BY_ID["south_american_poy_placements"].raw_file == "rsssf/sam-poy.html"


def test_v2_sources_each_contribute_linked_facts(built):
    """Every v2 fact source links at least one real record — proof the new parsers
    are wired and resolve, not dead code."""
    by_source = {f["source_id"] for f in built["facts"]}
    for sid in (
        "african_poy",
        "asian_poy",
        "concacaf_poy",
        "south_american_poy_placements",
        "uefa_mens_poy",
        "world_soccer_poy",
        "onze_awards",
        "uefa_club_positional",
        "uefa_team_of_the_year",
        "fifpro_world11",
        "esm_team_of_the_season",
        "ballondor_dream_team",
        "iffhs_dream_teams",
    ):
        assert sid in by_source, f"v2 source {sid} contributed no linked fact"


def test_position_balanced_sources_emit_first_class_positions(built):
    """The whole point of MV2-1: position-aware sources emit first-class GK/DF/MF/FW
    facts. Every position is in the closed set, and all four appear — the striker
    bias is broken."""
    positions = {f["position"] for f in built["facts"] if f["position"] is not None}
    assert positions == set(POSITIONS), positions
    # The UEFA positional awards directly source goalkeepers AND defenders.
    pos_by_source = {}
    for f in built["facts"]:
        if f["position"]:
            pos_by_source.setdefault(f["source_id"], set()).add(f["position"])
    assert {"GK", "DF"} <= pos_by_source["uefa_club_positional"]
    assert "GK" in pos_by_source["esm_team_of_the_season"]


def test_defender_and_keeper_greats_now_carry_facts(built):
    """The v2 repair target: the defender/goalkeeper legends the striker-biased v1
    ballots missed now carry facts, and (mononym ambiguity aside) a position."""
    by_player: dict[str, list[dict]] = {}
    for f in built["facts"]:
        by_player.setdefault(f["player_id"], []).append(f)
    checklist = {
        "P-42920": "Baresi",
        "P-43222": "Maldini",
        "P-09317": "Yashin",
        "P-11392": "Buffon",
        "P-91718": "Cafu",
        "P-72864": "Beckenbauer",
    }
    for pid, name in checklist.items():
        assert by_player.get(pid), f"{name} ({pid}) carries no v2 stature fact"
    # All but the mononym 'Cafu' (withheld on the all-time-XI row, no nation/year)
    # carry a first-class position from a positional / formation source.
    for pid in ("P-42920", "P-43222", "P-09317", "P-11392", "P-72864"):
        assert any(f["position"] for f in by_player[pid]), pid


def test_v2_parser_anchor_facts_are_correct():
    """Spot-check documented anchor facts so a parser regression is loud (assert,
    don't eyeball). Pure over the committed snapshots."""
    onze = parse_rsssf_awards.parse_onze_awards()
    assert any(
        r.year == 1986 and r.extra["selection"] == "onze_dor" and "MARADONA" in r.name.upper()
        for r in onze
    )
    wsoc = parse_rsssf_awards.parse_world_soccer_poy()
    assert any(r.year == 1986 and "MARADONA" in r.name.upper() for r in wsoc)
    asian = parse_rsssf_awards.parse_asian_poy()
    assert any(r.year == 2020 and "SON" in r.name.upper() for r in asian)
    # CONCACAF male Player of the Year 2014 winner is the keeper Keylor Navas.
    concacaf = parse_wiki_awards.parse_concacaf_poy()
    assert any(r.year == 2014 and "NAVAS" in r.name.upper() for r in concacaf)
    # Ballon d'Or First Team: Yashin is the GK, Maldini a defender (position joined
    # from the per-position nomination sections via the article slug).
    bd = parse_wiki_xi.parse_ballondor_dream_team()
    first = {r.name: r.position for r in bd if r.extra["selection"] == "ballondor_first_team"}
    assert first.get("Lev Yashin") == "GK"
    assert first.get("Paolo Maldini") == "DF"
    # ESM reads position from the formation column: Buffon is the keeper.
    esm = parse_wiki_xi.parse_esm_team_of_the_season()
    assert any(r.name == "Gianluigi Buffon" and r.position == "GK" for r in esm)
    # IFFHS All-Time World XI: the goalkeeper (Yashin) is listed first.
    iffhs = parse_iffhs_dreamteams.parse()
    assert any("YASHIN" in r.name.upper() and r.position == "GK" for r in iffhs)


def test_v2_review_reasons_are_the_same_conservative_set(built):
    """The linker is UNCHANGED: the broadened source set produces only the existing
    conservative withholding reasons — no new silent-assignment path."""
    valid = {
        "no_candidate",
        "multi_candidate",
        "nation_mismatch",
        "nation_divergent",
        "weak_unverified",
    }
    assert {r["reason"] for r in built["review"]} <= valid


def test_v2_stature_table_scores_the_full_source_set():
    """MV2-3 removed the v1 isolation: the career-stature-2.0.0 table consumes the
    FULL source_facts.json over the v2 position-balanced family taxonomy. The v2-only
    families (regional / position-balanced / captaincy) now drive real family scores —
    the inverse of the MV2-1 scope guard, which held the v1 table byte-identical."""
    from wcdraft_etl.merit import stature

    table = json.loads(
        (REPO_ROOT / "etl" / "output" / "career_stature.json").read_text("utf-8")
    )
    assert table["version"] == "career-stature-2.0.0"
    # The v2-only families carry positive scores on real rows — they are scored, not
    # staged-and-ignored as they were under the v1 table.
    for fam in (
        "regional_annual_recognition",
        "position_balanced_selection",
        "captaincy",
    ):
        assert any(
            (r["family_scores"].get(fam) or 0.0) > 0.0 for r in table["career_stature"]
        ), f"v2 family {fam} contributes no family score — full set not consumed"
    # The v1 isolation machinery is gone (no _v1_facts / _V1_* symbols remain).
    assert not hasattr(stature, "_v1_facts")


# ─── MV2-2: deterministic factual research backstop ───────────────────────────


@pytest.fixture(scope="session")
def research_facts(built) -> list[dict]:
    from wcdraft_etl.merit import RESEARCH_SOURCE_IDS

    return [f for f in built["facts"] if f["source_id"] in RESEARCH_SOURCE_IDS]


def test_research_rows_are_all_cited_and_linked_like_parser_rows(research_facts):
    """Every research-backstop fact links to a real player_id and carries a public
    citation (url + claim). The linker emitted them via the SAME path as parser
    rows — they are not a privileged side-channel."""
    assert len(research_facts) >= 20
    for f in research_facts:
        assert f["player_id"].startswith("P-")
        cite = f.get("citation")
        assert isinstance(cite, dict), f
        assert cite["url"].lower().startswith("http"), f
        assert cite["claim"].strip(), f
        # research rows never invent a rating number / ranking field
        assert "overall" not in f and "rating" not in f


def test_research_uncited_row_fails_the_build(monkeypatch):
    """An uncited / malformed research row raises ResearchError — uncited fails the
    build, it is never silently accepted."""
    from wcdraft_etl.merit import parse_research

    monkeypatch.setattr(
        parse_research, "_load_note", lambda s: {
            "source_id": s.source_id,
            "family": s.family,
            "rows": [{"name": "Someone", "nation_token": "Brazil", "year": 1970}],
        }
    )
    with pytest.raises(parse_research.ResearchError):
        parse_research.collect()


def test_research_ambiguous_row_is_withheld_to_review_not_assigned(built):
    """A research record with an ambiguous identity is routed to link_review by the
    SAME conservative linker as parser rows — never force-assigned. Feeding a bare
    surname with no corroborating nation through link_records yields a review row,
    not a fact (research rows have no privileged link path)."""
    from wcdraft_etl.merit import MeritRecord
    from wcdraft_etl.merit.link import build_canon, link_records

    canon = build_canon(
        json.loads((REPO_ROOT / "etl" / "output" / "players.json").read_text()),
        json.loads((REPO_ROOT / "etl" / "output" / "player_tournaments.json").read_text()),
        json.loads((REPO_ROOT / "etl" / "output" / "tournaments.json").read_text()),
        json.loads((REPO_ROOT / "etl" / "output" / "nations.json").read_text()),
    )
    ambiguous = MeritRecord(
        source_id="research_captaincy",
        family="captaincy",
        name="Silva",  # a surname shared by many; no nation to disambiguate
        nation_token=None,
        year=None,
        extra={"citation": {"url": "https://example.org/x", "claim": "c"}},
    )
    facts, review = link_records([ambiguous], canon)
    assert facts == []
    assert review and review[0]["source_id"] == "research_captaincy"


def test_research_manifest_pins_bytes_so_editing_a_citation_is_detected(tmp_path, monkeypatch):
    """Editing any citation changes the note bytes and therefore the pinned sha256:
    verify() must catch the drift. Proven by mutating a committed note in place and
    re-running verify against the unchanged manifest (restored in a finally block)."""
    from wcdraft_etl.merit import RESEARCH_SOURCES, parse_research

    # clean state first
    assert parse_research.verify() == 0

    src = RESEARCH_SOURCES[0]
    real = MERIT_RAW / src.raw_file
    doc = json.loads(real.read_text(encoding="utf-8"))
    doc["rows"][0]["citation"]["url"] = "https://en.wikipedia.org/wiki/Tampered"
    backup = real.read_text(encoding="utf-8")
    try:
        real.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        assert parse_research.verify() == 1  # sha drift detected
    finally:
        real.write_text(backup, encoding="utf-8")
    assert parse_research.verify() == 0  # restored


def test_research_facts_are_scored_by_the_v2_stature_table(research_facts):
    """MV2-3 consumes the research backstop: every linked research fact reaches the
    v2 career-stature table for its player (it is no longer filtered out as it was by
    the v1 isolation), via the research family (captaincy / global_annual)."""
    research_pids = {f["player_id"] for f in research_facts}
    assert research_pids
    table = json.loads(
        (REPO_ROOT / "etl" / "output" / "career_stature.json").read_text("utf-8")
    )
    scored_pids = {r["player_id"] for r in table["career_stature"]}
    # Every player carrying a research fact is scored by the v2 table.
    assert research_pids <= scored_pids
    # The research-fed families carry positive scores somewhere in the table.
    research_families = {f["family"] for f in research_facts}
    for fam in research_families:
        assert any(
            (r["family_scores"].get(fam) or 0.0) > 0.0 for r in table["career_stature"]
        ), fam


def test_research_activates_captaincy_and_closes_named_v1_gaps(research_facts, built):
    """The reserved `captaincy` family is now sourced, and the named v1 gaps pick up
    a research fact: Cruyff (global recognition recovered under his canonical name),
    Cafu / Carlos Alberto / Facchetti / Passarella / Baresi (DF captaincy)."""
    from wcdraft_etl.merit import ACTIVE_SOURCE_FAMILIES

    assert "captaincy" in ACTIVE_SOURCE_FAMILIES
    fam_by_pid = {}
    for f in built["facts"]:
        fam_by_pid.setdefault(f["player_id"], set()).add(f["family"])

    # Cruyff: global recognition now linked (was withheld under "Cruijff").
    assert "global_annual_recognition" in fam_by_pid.get("P-50564", set())
    # Defender / GK captaincy closures (player_id, expected family).
    for pid in ("P-91718", "P-25829", "P-68170", "P-80376", "P-42920"):
        assert "captaincy" in fam_by_pid.get(pid, set()), pid
    # Position is carried on the research captaincy facts (the DF/GK repair).
    cafu_caps = [f for f in research_facts if f["player_id"] == "P-91718"]
    assert any(f["position"] == "DF" for f in cafu_caps)


def test_research_manifest_covers_every_research_source(research_facts):
    """The research manifest lists exactly the registered research sources, stamped
    with the source-set version, and verify() is clean."""
    from wcdraft_etl.merit import RESEARCH_SOURCES, parse_research
    from wcdraft_etl.merit.paths import RESEARCH_MANIFEST_PATH

    manifest = json.loads(RESEARCH_MANIFEST_PATH.read_text(encoding="utf-8"))
    files = {f["file"] for f in manifest["files"]}
    assert files == {s.raw_file for s in RESEARCH_SOURCES}
    assert manifest["version"] == SOURCE_SET_VERSION
    assert parse_research.verify() == 0


def test_research_sources_are_excluded_from_the_fetch_manifest():
    """Research notes are NOT fetched web snapshots: they must not appear in
    fetch_manifest.json (which pins only downloaded pages) — they own a separate
    manifest. This keeps `fetch --verify`'s fetched-source set unchanged."""
    from wcdraft_etl.merit import RESEARCH_SOURCE_IDS, SOURCES

    fetch_manifest = json.loads(
        (REPO_ROOT / "etl" / "merit" / "fetch_manifest.json").read_text()
    )
    fetch_sources = {f["source_id"] for f in fetch_manifest["files"]}
    assert fetch_sources.isdisjoint(RESEARCH_SOURCE_IDS)
    assert RESEARCH_SOURCE_IDS.isdisjoint({s.source_id for s in SOURCES})
