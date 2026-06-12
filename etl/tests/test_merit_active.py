"""MV2-12a / merit-v3 V1 active-career intake: citation discipline,
conservative dual-space linking, determinism, the SHA-pin, and the explicit
activation seam: active.py still emits facts + identity only, while
career-stature-3.0.0 consumes those facts through stature.py.

Self-contained: reads the committed canonical JSON in ``etl/output/`` plus the
committed snapshots/notes under ``etl/merit/raw/``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wcdraft_etl.merit import (
    ACTIVE_CUTOFF_DATE,
    ACTIVE_SOURCE_IDS,
    ACTIVE_SOURCE_SET_VERSION,
    ACTIVE_SOURCES,
    SOURCES,
    MeritRecord,
    active,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MERIT_SRC = REPO_ROOT / "etl" / "src" / "wcdraft_etl" / "merit"
MERIT_RAW = REPO_ROOT / "etl" / "merit" / "raw"
MERIT_OUT = REPO_ROOT / "etl" / "output" / "merit"
ETL_OUT = REPO_ROOT / "etl" / "output"
ETL_SRC = REPO_ROOT / "etl" / "src" / "wcdraft_etl"

# The committed staged artifacts this unit owns.
ACTIVE_ARTIFACTS = (
    "source_facts_active.json",
    "link_review_active.json",
    "career_stature_active_staging.json",
    "ACTIVE_CAREERS.md",
)


@pytest.fixture(scope="session")
def abuilt() -> dict:
    # write=False: tests must never depend on (or mutate) committed outputs.
    return active.build(write=False)


@pytest.fixture(scope="session")
def minted_canon():
    players_2026 = json.loads((ETL_OUT / "players_2026.json").read_text(encoding="utf-8"))
    cards_2026 = json.loads(
        (ETL_OUT / "player_tournaments_2026.json").read_text(encoding="utf-8")
    )
    return active.build_minted_canon(players_2026, cards_2026)


# ─── determinism: committed artifacts == a fresh build ────────────────────────


def test_committed_active_outputs_are_in_sync_with_a_fresh_build(abuilt):
    fresh = {
        "source_facts_active.json": abuilt["facts_doc"],
        "link_review_active.json": abuilt["review_doc"],
        "career_stature_active_staging.json": abuilt["staging_doc"],
    }
    for name, doc in fresh.items():
        committed = json.loads((MERIT_OUT / name).read_text(encoding="utf-8"))
        assert committed == doc, f"{name} is stale — rerun python -m wcdraft_etl.merit.active"
    committed_md = (MERIT_OUT / "ACTIVE_CAREERS.md").read_text(encoding="utf-8")
    assert committed_md == abuilt["report_md"]


def test_build_is_deterministic(abuilt):
    again = active.build(write=False)
    assert again["facts_doc"] == abuilt["facts_doc"]
    assert again["staging_doc"] == abuilt["staging_doc"]
    assert again["review_doc"] == abuilt["review_doc"]


# ─── ACTIVATION: stature consumes active facts; rating still does not ─────────


def test_no_active_source_id_reaches_the_consumed_fact_file():
    """The archive's input file must carry ZERO active-channel facts — the
    active source ids and the active sources themselves are absent from both
    ``source_facts.json`` and the main fetched-source registry."""
    sf = json.loads((MERIT_OUT / "source_facts.json").read_text(encoding="utf-8"))
    assert not {f["source_id"] for f in sf["facts"]} & ACTIVE_SOURCE_IDS
    assert not {s.source_id for s in SOURCES} & ACTIVE_SOURCE_IDS


def test_archived_active_targets_are_staged_for_stature_merge(abuilt):
    """V1 activation flip: archived targets are allowed in the active channel.
    The no-double-credit invariant now belongs to stature.py's person-level
    merge, so this test asserts the intended archived-target staging surface."""
    archive = json.loads((MERIT_OUT / "source_facts.json").read_text(encoding="utf-8"))
    archived = {f["player_id"] for f in archive["facts"]}
    staged = {e["player_id"] for e in abuilt["entries"]}
    assert {"P-62341", "P-92812"} <= staged & archived
    entries = {e["player_id"]: e for e in abuilt["entries"]}
    assert entries["P-21531"]["identity_space"] == "historical"
    assert entries["P-21531"]["families"] == [
        "club_season_honors",
        "position_balanced_selection",
    ]
    assert entries["P-62341"]["families"] == ["club_season_honors"]
    assert entries["P-92812"]["families"] == ["club_season_honors"]


def test_scoring_code_never_references_the_active_artifacts():
    """V1 activation flip: stature.py must name and consume the active artifacts,
    while rating/compact/ingest modules still do not import the active channel.
    This replaces the old inertness assertion with the post-activation boundary."""
    stature_text = (ETL_SRC / "merit" / "stature.py").read_text(encoding="utf-8")
    for token in (
        "source_facts_active.json",
        "career_stature_active_staging.json",
        "ACTIVE_SOURCE_SET_VERSION",
    ):
        assert token in stature_text, f"stature.py does not consume {token!r}"
    for token in ("merit.active", "import active", "from . import active"):
        assert token not in stature_text, f"stature.py imports active module: {token!r}"

    consumed_modules = [
        ETL_SRC / "rating.py",
        ETL_SRC / "rating_2026.py",
        ETL_SRC / "display_curve.py",
        ETL_SRC / "pipeline.py",
        ETL_SRC / "ingest_2026.py",
        ETL_SRC / "merit" / "build.py",
        ETL_SRC / "merit" / "link.py",
    ]
    banned = (*ACTIVE_ARTIFACTS, "merit.active", "import active", "from . import active")
    for path in consumed_modules:
        text = path.read_text(encoding="utf-8")
        for token in banned:
            assert token not in text, f"{path.name} references active channel: {token!r}"


def test_active_module_never_imports_or_writes_rating_artifacts():
    """Mirror of the merit-wide honest-state boundary, asserted for active.py
    specifically: no rating-layer import, no rating/compact artifact filename."""
    bad_imports = ("from ..rating", "import rating", "from ..supplement", "calibration")
    bad_filenames = ("ratings.json", "ratings_2026.json", ".compact.json", "engine_version")
    for raw_line in (MERIT_SRC / "active.py").read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith(("import ", "from ")):
            for tok in bad_imports:
                assert tok not in line, f"active.py imports rating layer: {line!r}"
        for fn in bad_filenames:
            assert fn not in line, f"active.py references artifact {fn!r}"


def test_staged_entries_carry_no_score_index_tier_or_legend(abuilt):
    """Even after V1 activation, active.py stays facts + identity ONLY. The
    completed-career composite keys remain structurally absent because stature.py
    owns scoring, stage normalization, tiers and legend flags."""
    forbidden = {
        "career_stature_score",
        "career_stature_index",
        "coverage",
        "stature_tier",
        "legend",
        "legend_reason_codes",
        "family_scores",
        "family_weights",
    }
    assert abuilt["staging_doc"]["activated_by"] == "career-stature-3.0.0"
    for e in abuilt["entries"]:
        assert not forbidden & set(e), e["player_id"]


# ─── citation + curation discipline ───────────────────────────────────────────


def test_every_active_fact_is_linked_and_note_facts_are_cited(abuilt):
    """Every fact resolves to a real player id in exactly one identity space;
    every note-channel fact carries a public citation; no fact invents a rating
    field. Parser-recovered facts carry snapshot provenance instead (their
    source ids live in the main fetched registry's manifest)."""
    parser_ids = {s.source_id for s in SOURCES}
    for f in abuilt["facts"]:
        assert f["player_id"].startswith("P-")
        assert f["identity_space"] in ("historical", "minted_2026")
        assert (f["identity_space"] == "minted_2026") == f["player_id"].startswith("P-W26-")
        assert "overall" not in f and "rating" not in f
        if f["source_id"] in ACTIVE_SOURCE_IDS:
            cite = f.get("citation")
            assert isinstance(cite, dict), f
            assert cite["url"].lower().startswith("http"), f
            assert cite["claim"].strip(), f
        else:
            assert f["source_id"] in parser_ids, f


def test_club_season_honors_census_matches_scope_and_registry(abuilt):
    """The V1 club-season honors source is a real census, not a probe-adjacent
    sample: rows must equal scope × pinned finals registry under the written
    top-tier continental-title/final-participation rule."""
    note = json.loads(
        (MERIT_RAW / "active" / "club-season-honors.json").read_text(encoding="utf-8")
    )
    census = note["census"]
    assert "top-tier continental club titles" in census["rule"]
    assert "documented final participation" in census["rule"]
    assert "MV2-12a active 23 plus the V1 additions" in census["rule"]

    scope_ids = {p["player_id"] for p in census["scope"]}
    assert len(scope_ids) == 26
    assert scope_ids == {e["player_id"] for e in abuilt["entries"]}
    assert {
        p["player_id"]
        for p in census["scope"]
        if p["scope_reason"] == "v1_club_season_honors_addition"
    } == {"P-05174", "P-62341", "P-92812"}
    assert {c["confederation"] for c in census["top_tier_competitions"]} == {
        "AFC",
        "CAF",
        "CONCACAF",
        "CONMEBOL",
        "OFC",
        "UEFA",
    }

    expected = set()
    for final in census["finals_registry"]:
        assert final["citation_url"].startswith("http")
        for player in final["qualifying_scope_players"]:
            assert player["player_id"] in scope_ids
            expected.add((player["player_id"], final["year"], final["competition"]))
    actual = {(r["player_id"], r["year"], r["competition"]) for r in note["rows"]}
    assert actual == expected
    verification = note["verification_notes"]
    assert verification["verified_on"] == "2026-06-11"
    verified = {r["row_key"]: r for r in verification["rows"]}
    row_keys = {f"{r['player_id']}:{r['year']}:{r['competition']}" for r in note["rows"]}
    assert set(verified) == row_keys
    assert len(verified) == len(note["rows"]) == 14
    alaba_2020 = next(
        r
        for r in note["rows"]
        if r["player_id"] == "P-W26-0050" and r["year"] == 2020
    )
    assert "match/2030150--paris-vs-bayern-munchen/lineups/" in alaba_2020[
        "citation"
    ]["url"]
    assert "2030150" in verified["P-W26-0050:2020:UEFA Champions League"][
        "citation_url"
    ]
    all_urls = [r["citation"]["url"] for r in note["rows"]] + [
        f["citation_url"] for f in census["finals_registry"]
    ]
    assert all("2029490" not in url for url in all_urls)
    assert expected >= {
        ("P-W26-0050", 2013, "UEFA Champions League"),
        ("P-W26-0050", 2020, "UEFA Champions League"),
        ("P-W26-0050", 2022, "UEFA Champions League"),
        ("P-21531", 2019, "UEFA Champions League"),
        ("P-W26-0574", 2019, "UEFA Champions League"),
        ("P-W26-0512", 2020, "Copa Libertadores"),
        ("P-W26-0512", 2021, "Copa Libertadores"),
        ("P-W26-0115", 2024, "Copa Libertadores"),
    }
    assert len(note["rows"]) == 14
    assert {r["player_id"] for r in note["rows"]} <= scope_ids
    assert {r["player_id"] for r in note["rows"] if r["name"] == "Luiz Henrique"} == {
        "P-W26-0115"
    }
    exclusions = {e["player_id"]: e["reason"] for e in census["exclusions"]}
    assert "final participation" in exclusions["P-W26-0049"]
    assert "losing-final" in exclusions["P-W26-0716"]


def test_uncited_or_off_scope_note_row_fails_the_build(monkeypatch):
    base = {
        "source_id": ACTIVE_SOURCES[0].source_id,
        "family": ACTIVE_SOURCES[0].family,
        "cutoff_date": ACTIVE_CUTOFF_DATE,
        "curation_notes": [],
    }
    for bad_row in (
        {"name": "Someone", "nation_token": "Brazil", "year": 2024, "scope": "active_career"},
        {
            "name": "Someone",
            "year": 2024,
            "scope": "historical_gap",  # wrong scope for the active channel
            "citation": {"url": "https://example.org/x", "claim": "c"},
        },
        {
            "name": "Someone",
            "year": 2027,  # past the squad-pin season
            "scope": "active_career",
            "citation": {"url": "https://example.org/x", "claim": "c"},
        },
    ):
        monkeypatch.setattr(active, "_load_note", lambda s, row=bad_row: {**base, "rows": [row]})
        with pytest.raises(active.ActiveIntakeError):
            active.collect_notes()


def test_note_cutoff_date_must_match_the_registry(monkeypatch):
    src = ACTIVE_SOURCES[0]
    doc = json.loads((MERIT_RAW / src.raw_file).read_text(encoding="utf-8"))
    doc["cutoff_date"] = "2099-01-01"
    monkeypatch.setattr(active, "_read_bytes", lambda f: json.dumps(doc).encode())
    with pytest.raises(active.ActiveIntakeError):
        active._load_note(src)


def test_double_credit_guard_is_now_a_stature_merge_invariant(monkeypatch):
    """V1 activation flip: an archived active target no longer fails active.build.
    Design consequence: post-activation, active facts may legitimately reach an
    archived identity through the person resolver. The post-flip no-double-credit
    guard is the stature merge invariant tested in test_career_stature.py; this
    pin proves active.py no longer owns that gate."""
    real_collect = active.collect_notes

    def with_archived_target():
        records, notes = real_collect()
        records = [
            *records,
            MeritRecord(
                source_id="active_captaincy",
                family="captaincy",
                name="Heung-min Son",
                nation_token="South Korea",
                year=None,
                position="FW",
                detail="national-team captain — captains South Korea",
                extra={"citation": {"url": "https://example.org/x", "claim": "c"}},
            ),
        ]
        return records, notes

    monkeypatch.setattr(active, "collect_notes", with_archived_target)
    out = active.build(write=False)
    injected = [
        f
        for f in out["facts"]
        if f["source_id"] == "active_captaincy" and f["raw_name"] == "Heung-min Son"
    ]
    assert injected
    assert any(e["player_id"] == injected[0]["player_id"] for e in out["entries"])


# ─── conservative linking in the minted 2026 space ────────────────────────────


def test_parser_recovery_only_takes_records_with_no_historical_candidate(abuilt):
    """Eligibility line: every parser-recovered fact's raw name has ZERO
    candidates in the historical canon — nothing the main build linked or holds
    in review-with-candidates is re-routed."""
    from wcdraft_etl.merit.link import _candidates, build_canon

    canon = build_canon(
        json.loads((ETL_OUT / "players.json").read_text(encoding="utf-8")),
        json.loads((ETL_OUT / "player_tournaments.json").read_text(encoding="utf-8")),
        json.loads((ETL_OUT / "tournaments.json").read_text(encoding="utf-8")),
        json.loads((ETL_OUT / "nations.json").read_text(encoding="utf-8")),
    )
    parser_facts = [f for f in abuilt["facts"] if f["source_id"] not in ACTIVE_SOURCE_IDS]
    assert parser_facts, "parser recovery yielded nothing"
    for f in parser_facts:
        rec = MeritRecord(source_id=f["source_id"], family=f["family"], name=f["raw_name"])
        cands, tier = _candidates(rec, canon)
        assert cands == [] and tier == "no_candidate", f


def test_minted_multi_candidate_ambiguity_is_withheld_not_assigned(minted_canon):
    """A bare ambiguous surname with no corroboration must not link in the
    minted space."""
    rec = MeritRecord(source_id="active_captaincy", family="captaincy", name="Rodriguez")
    pid, method, cands = active._link_minted(rec, minted_canon, frozenset())
    assert pid is None
    assert method == "multi_candidate"
    assert cands == ["P-W26-0501", "P-W26-0764"]  # renumbered by merit-v3 U0 link fix


def test_minted_single_candidate_weak_key_is_withheld(minted_canon):
    rec = MeritRecord(source_id="active_captaincy", family="captaincy", name="Silva")
    pid, method, cands = active._link_minted(rec, minted_canon, frozenset())
    assert pid is None
    assert method == "weak_unverified"
    assert cands == ["P-W26-0533"]  # renumbered by merit-v3 U0 link fix


def test_named_anchor_links(abuilt):
    """The audit-named identities resolve exactly as designed."""
    by_pid: dict[str, list[dict]] = {}
    for f in abuilt["facts"]:
        by_pid.setdefault(f["player_id"], []).append(f)
    # Yamal — minted 2026 identity; Kopa + Ballon d'Or podium note facts AND
    # snapshot-recovered selections.
    yamal = by_pid["P-W26-0663"]  # renumbered by merit-v3 U0 link fix
    details = {f["detail"] for f in yamal}
    assert any("Kopa Trophy" in d and "2024" in d for d in details)
    assert any("Kopa Trophy" in d and "2025" in d for d in details)
    assert any("Ballon d'Or — 2025 runner-up" in d for d in details)
    assert any(f["source_id"] == "esm_team_of_the_season" for f in yamal)
    # Alisson — facts key to his HISTORICAL identity (P-21531), not the minted
    # duplicate; both GK awards and the 2019 UCL final-title fact are present.
    alisson = by_pid["P-21531"]
    assert all(f["identity_space"] == "historical" for f in alisson)
    assert {f["source_id"] for f in alisson} == {
        "active_club_season_honors",
        "active_gk_award",
    }
    assert len(alisson) == 3
    # Ochoa — canonical-name recovery of the withheld century-caps record.
    ochoa = by_pid["P-80826"]
    assert ochoa[0]["detail"].startswith("caps=152")
    # Giménez — the Uruguay captaincy lands on the canonical card name.
    gimenez = by_pid["P-65659"]
    assert gimenez[0]["family"] == "captaincy"
    # Valverde — REFUTED captaincy stays out, while the separate club-season
    # honors facts are allowed in under their own sourced family.
    valverde = by_pid["P-05174"]
    assert {f["source_id"] for f in valverde} == {"active_club_season_honors"}
    assert {f["family"] for f in valverde} == {"club_season_honors"}
    assert len(valverde) == 2
    # Reviewer-named omissions are now census facts or explicitly in scope.
    alaba = by_pid["P-W26-0050"]
    assert sum(f["source_id"] == "active_club_season_honors" for f in alaba) == 3
    robertson = by_pid["P-W26-0574"]
    assert any(f["source_id"] == "active_club_season_honors" for f in robertson)
    gomez = by_pid["P-W26-0512"]
    assert sum(f["source_id"] == "active_club_season_honors" for f in gomez) == 2
    luiz = by_pid["P-W26-0115"]
    assert any(
        f["source_id"] == "active_club_season_honors" and f["year"] == 2024
        for f in luiz
    )
    valverde_drop = [n for n in abuilt["staging_doc"]["curation_notes"] if "Valverde" in n]
    assert valverde_drop, "the Valverde drop must stay documented"


def test_identity_bridge_review_empty_after_promotion(abuilt):
    """merit-v3 U0 promoted the four 12a bridge pairs (Neymar, Alisson,
    Marquinhos, Rodri) from review-only staging into the REAL linker path
    (``identity_2026.IDENTITY_BRIDGES``): those players now link to their
    canonical historical ids at ingest, so no minted 2026 identity shadows a
    fact-carrying historical identity any more — the review queue is empty."""
    assert abuilt["bridges"] == []
    # The promoted identities are real links in the committed 2026 cards…
    cards = json.loads(
        (REPO_ROOT / "etl" / "output" / "player_tournaments_2026.json").read_text(
            encoding="utf-8"
        )
    )
    by_pid = {c["player_id"]: c for c in cards}
    for hpid in ("P-87008", "P-21531", "P-76060", "P-62341"):
        assert by_pid[hpid]["link_status"] == "linked"
    # …and Alisson's staged active facts ride the canonical id, now correctly
    # flagged as in the 2026 squad (the seam used to split this identity).
    alisson = [e for e in abuilt["entries"] if e["player_id"] == "P-21531"]
    assert alisson and alisson[0]["in_2026_squad"] is True


# ─── position balance + cohort shape ──────────────────────────────────────────


def test_active_facts_cover_all_four_positions(abuilt):
    """The position-balance discipline holds for the active set: stated-position
    facts span GK / DF / MF / FW (the GK arm is the curated award note — the
    snapshots carry no GK facts for this cohort)."""
    positions = {f["position"] for f in abuilt["facts"] if f["position"]}
    assert positions >= {"GK", "DF", "MF", "FW"}


def test_facts_respect_the_cutoff_and_families(abuilt):
    families = {s.family for s in ACTIVE_SOURCES} | {
        "international_record",
        "position_balanced_selection",
        "global_annual_recognition",
        "regional_annual_recognition",
        "retrospective_selection",
        "captaincy",
        "wc_legacy",
    }
    for f in abuilt["facts"]:
        assert f["family"] in families
        assert f["year"] is None or f["year"] <= 2026
    assert abuilt["facts_doc"]["cutoff_date"] == ACTIVE_CUTOFF_DATE


def test_staging_entries_match_facts(abuilt):
    by_pid: dict[str, list[dict]] = {}
    for f in abuilt["facts"]:
        by_pid.setdefault(f["player_id"], []).append(f)
    entries = {e["player_id"]: e for e in abuilt["entries"]}
    assert set(entries) == set(by_pid)
    for pid, e in entries.items():
        assert e["fact_count"] == len(by_pid[pid])
        assert e["families"] == sorted({f["family"] for f in by_pid[pid]})


# ─── SHA-pin ──────────────────────────────────────────────────────────────────


def test_committed_active_notes_match_manifest_sha():
    assert active.verify() == 0


def test_active_manifest_covers_every_active_source():
    manifest = json.loads(
        (MERIT_RAW / "active" / "manifest.json").read_text(encoding="utf-8")
    )
    assert {f["file"] for f in manifest["files"]} == {s.raw_file for s in ACTIVE_SOURCES}
    assert manifest["version"] == ACTIVE_SOURCE_SET_VERSION
    assert manifest["cutoff_date"] == ACTIVE_CUTOFF_DATE


def test_active_manifest_pins_bytes_so_editing_a_citation_is_detected():
    src = ACTIVE_SOURCES[0]
    real = MERIT_RAW / src.raw_file
    doc = json.loads(real.read_text(encoding="utf-8"))
    doc["rows"][0]["citation"]["url"] = "https://en.wikipedia.org/wiki/Tampered"
    backup = real.read_text(encoding="utf-8")
    try:
        real.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        assert active.verify() == 1
    finally:
        real.write_text(backup, encoding="utf-8")
    assert active.verify() == 0


def test_active_sources_are_excluded_from_fetch_and_research_manifests():
    fetch_manifest = json.loads(
        (REPO_ROOT / "etl" / "merit" / "fetch_manifest.json").read_text(encoding="utf-8")
    )
    research_manifest = json.loads(
        (MERIT_RAW / "research" / "manifest.json").read_text(encoding="utf-8")
    )
    active_files = {s.raw_file for s in ACTIVE_SOURCES}
    assert not {f["file"] for f in fetch_manifest["files"]} & active_files
    assert not {f["file"] for f in research_manifest["files"]} & active_files
