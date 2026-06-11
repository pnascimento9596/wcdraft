"""ENGINE-V2 E-4.2 / E-4.6 — career-stature composite acceptance suite.

Proves the offline merit composite (`merit/stature.py` → `etl/output/career_stature.json`)
is deterministic, schema-clean, honest-state compliant, and free of any per-player
override. The career composite is the ONLY place career aggregates live; the rating
stage consumes it as a capped lift (covered by `test_rating.py`).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from wcdraft_etl.merit import (
    ACTIVE_SOURCE_SET_VERSION,
    FAMILY_KEYS,
    SOURCE_SET_VERSION,
    VERSION,
    stature,
)

_OUTPUT = Path(__file__).resolve().parents[1] / "output"


def _committed() -> dict:
    return json.loads((_OUTPUT / "career_stature.json").read_text("utf-8"))


def test_rebuild_is_byte_identical_to_committed():
    """A fresh build over the committed source facts reproduces the committed
    artifact byte-for-byte (the determinism moat)."""
    out = stature.build(write=False)
    rebuilt = json.dumps(out["table"], ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    committed = (_OUTPUT / "career_stature.json").read_text("utf-8")
    assert rebuilt == committed


def test_table_version_and_keys():
    table = _committed()
    assert table["version"] == VERSION
    rows = table["career_stature"]
    assert table["player_count"] == len(rows)
    pids = [r["player_id"] for r in rows]
    assert pids == sorted(pids), "rows must be sorted by player_id"
    assert len(pids) == len(set(pids)), "player_id keys must be unique"


def test_scores_and_coverage_are_finite_in_unit_interval():
    for r in _committed()["career_stature"]:
        s = r["career_stature_score"]
        c = r["coverage"]
        assert isinstance(s, (int, float)) and 0.0 <= s <= 1.0, r["player_id"]
        assert isinstance(c, (int, float)) and 0.0 <= c <= 1.0, r["player_id"]
        # finite (not nan/inf)
        assert s == s and c == c
        for fam, fs in r["family_scores"].items():
            assert fam in FAMILY_KEYS
            assert fs is None or (0.0 <= fs <= 1.0)


def test_club_honors_legacy_zero_and_club_season_honors_active():
    """V1 adds the narrow club_season_honors family. The legacy club_honors key
    remains the explicit zero-weight placeholder, while cited active title/final
    participation facts score only through the new family."""
    club_rows = []
    for r in _committed()["career_stature"]:
        assert r["family_scores"]["club_honors"] is None
        assert r["family_weights"]["club_honors"] == 0.0
        if r["family_scores"]["club_season_honors"]:
            club_rows.append(r)
            assert r["family_weights"]["club_season_honors"] > 0.0
            assert r["active_source_set_version"] == ACTIVE_SOURCE_SET_VERSION
    assert {
        "P-05174",
        "P-21531",
        "P-62341",
        "P-92812",
        "P-W26-0050",
        "P-W26-0115",
        "P-W26-0477",
        "P-W26-0512",
        "P-W26-0574",
    } <= {r["player_id"] for r in club_rows}


def test_family_weights_are_era_based_with_documented_eligibility_adjustments():
    """Weights start from the era table, drop structurally unavailable families,
    then apply only closed-set eligibility adjustments. This is not per-player
    tuning: the only V1 adjustment is pre-1995 Ballon d'Or ineligibility."""
    for r in _committed()["career_stature"]:
        base = stature.ERA_FAMILY_WEIGHTS[r["era_bucket"]]
        weights = r["family_weights"]
        assert set(weights) == set(stature._V2_FAMILY_KEYS), r["player_id"]
        assert weights["club_honors"] == 0.0
        for fam, base_weight in base.items():
            if base_weight == 0.0:
                assert weights[fam] == 0.0, (r["player_id"], fam)
        assert round(sum(weights.values()), stature._PRECISION) == 1.0, r["player_id"]
        adjustments = r["family_weight_adjustments"]
        assert set(adjustments) <= {
            "global_annual_recognition:pre_1995_ballondor_ineligible"
        }
        if not adjustments:
            total = sum(w for w in base.values() if w > 0.0)
            expected = {
                fam: round((base.get(fam, 0.0) / total) if base.get(fam, 0.0) > 0.0 else 0.0,
                           stature._PRECISION)
                for fam in stature._V2_FAMILY_KEYS
            }
            assert weights == expected, r["player_id"]

    pele = {r["player_id"]: r for r in _committed()["career_stature"]}["P-38906"]
    assert pele["family_weight_adjustments"] == [
        "global_annual_recognition:pre_1995_ballondor_ineligible"
    ]


def test_every_family_score_is_backed_by_a_source_ref():
    """No family carries a positive score without a sourced fact behind it — the
    composite invents nothing."""
    for r in _committed()["career_stature"]:
        for fs in r["family_scores"].values():
            if fs is not None and fs > 0.0:
                assert any(":" in ref for ref in r["source_refs"]), r["player_id"]
        assert r["fact_count"] == len(r["source_refs"]) or r["fact_count"] >= len(
            r["source_refs"]
        )  # dedup of identical refs may shrink the set, never grow it


def test_material_gate_split_is_consistent():
    """material_count = rows clearing BOTH the coverage AND the index gate; every
    below-gate row appears in the review queue (its complement)."""
    table = _committed()
    rows = table["career_stature"]
    material = [r for r in rows if stature._is_material(r)]
    assert table["material_count"] == len(material)
    assert table["material_gate"] == {
        "min_coverage": stature.MATERIAL_MIN_COVERAGE,
        "min_index": stature.MATERIAL_MIN_INDEX,
    }
    review = json.loads((_OUTPUT / "merit" / "career_stature_review.json").read_text("utf-8"))
    flagged_pids = {r["player_id"] for r in review["review"]}
    below = {r["player_id"] for r in rows if not stature._is_material(r)}
    assert below <= flagged_pids  # every below-gate row appears in the review queue


def test_index_is_finite_monotonic_respread_in_unit_interval():
    """career_stature_index_raw is the finite monotonic global re-spread. The
    emitted index may be lower only through the documented V1 bias controls."""
    rows = sorted(
        _committed()["career_stature"], key=lambda r: r["career_stature_score"]
    )
    last_raw = -1.0
    for r in rows:
        raw = r["career_stature_index_raw"]
        idx = r["career_stature_index"]
        assert isinstance(raw, (int, float)) and 0.0 <= raw <= 1.0 and raw == raw, r
        assert isinstance(idx, (int, float)) and 0.0 <= idx <= 1.0 and idx == idx, r
        assert raw >= last_raw - 1e-9, ("raw index not monotonic vs score", r["player_id"])
        assert idx <= raw + 1e-9, ("bias control inflated index", r["player_id"])
        if not r["index_adjustments"]:
            assert idx == raw, r["player_id"]
        last_raw = raw
    # The transform is a pure function of the score (no per-player parameter): equal
    # scores must yield equal raw indices.
    for r in _committed()["career_stature"]:
        assert r["career_stature_index_raw"] == round(
            stature._index_of(r["career_stature_score"]), stature._PRECISION
        ), r["player_id"]


def test_stature_tier_only_on_material_rows_and_index_ordered():
    """stature_tier ∈ {bronze,silver,gold} on material rows ONLY (null otherwise),
    assigned by index quantiles of the material cohort — higher index ⇒ higher
    tier."""
    rows = _committed()["career_stature"]
    rank = {"bronze": 0, "silver": 1, "gold": 2}
    for r in rows:
        if stature._is_material(r):
            assert r["stature_tier"] in rank, r["player_id"]
        else:
            assert r["stature_tier"] is None, r["player_id"]
    material = [r for r in rows if r["stature_tier"] is not None]
    # No bronze index exceeds a gold index — tiers partition the index axis.
    by_tier = {t: [r["career_stature_index"] for r in material if r["stature_tier"] == t]
               for t in rank}
    if by_tier["bronze"] and by_tier["gold"]:
        assert max(by_tier["bronze"]) <= min(by_tier["gold"])


def test_legend_is_source_derived_with_closed_reason_codes():
    """legend is a boolean backed by ≥1 closed-set reason code; the reason codes are
    a pure function of the player's SOURCE facts + index (never a rating)."""
    facts_by_player: dict[str, list[dict]] = {}
    for name in ("source_facts.json", "source_facts_active.json"):
        sf = json.loads((_OUTPUT / "merit" / name).read_text("utf-8"))
        for f in sf["facts"]:
            facts_by_player.setdefault(f["player_id"], []).append(f)
    for r in _committed()["career_stature"]:
        codes = r["legend_reason_codes"]
        assert all(c in stature._LEGEND_REASON_CODES for c in codes), r["player_id"]
        assert r["legend"] == bool(codes)
        # Re-derive from source facts alone — proves no rating leaked into the flag.
        rederived = stature._legend_reason_codes(
            facts_by_player[r["player_id"]], r["career_stature_index"]
        )
        assert rederived == codes, r["player_id"]


def test_active_stage_normalization_and_honest_absence():
    """Active dated facts are accrual-to-date normalized and capped. Players with
    no sourced fact still have no row; no synthetic zero or placeholder lift is
    emitted."""
    by = {r["player_id"]: r for r in _committed()["career_stature"]}

    valverde = by["P-05174"]
    assert valverde["active_fact_count"] == 2
    assert valverde["family_scores"]["club_season_honors"] == 1.0
    assert valverde["active_stage_factors"]["club_season_honors"] == 0.625
    assert 0.40 <= valverde["career_stature_index"] <= 0.46
    assert valverde["coverage"] == 0.32

    yamal = by["P-W26-0663"]
    assert yamal["active_stage_factors"]["global_annual_recognition"] == 0.35
    assert yamal["career_stature_index"] >= 0.50

    # Named no-fact candidates remain honestly absent from the stature table.
    assert "P-36290" not in by  # José Luis Perlaza
    assert "P-40581" not in by  # Anis Ayari
    assert "P-W26-0686" not in by  # Yasin Ayari


def test_person_identity_resolver_and_merge_prevent_double_credit():
    """Post-activation double credit is impossible at the stature merge: a
    historical fact plus an active fact on a bridged 2026 alias produce one
    person row, not two player rows."""
    resolver = stature._PersonIdentityResolver(
        players=[{"player_id": "P-62341", "birth_date": "1996-06-22"}],
        players_2026=[
            {
                "player_id": "P-W26-RODRI",
                "birth_date": "1996-06-22",
                "full_name": "Rodri",
                "common_name": "Rodri",
                "family_name": "Rodri",
            }
        ],
        cards_2026=[
            {
                "card_id": "P-W26-RODRI:WC-2026",
                "player_id": "P-W26-RODRI",
                "link_status": "minted",
                "nation_id": "T-73",
                "birth_date": "1996-06-22",
            }
        ],
    )
    assert resolver.resolve("P-W26-RODRI") == "P-62341"

    ctx = stature._ScoringContext(
        resolver=resolver,
        birth_year={"P-62341": 1996},
        confederations={"P-62341": {"UEFA"}},
    )
    source_facts = {
        "version": SOURCE_SET_VERSION,
        "facts": [
            {
                "player_id": "P-62341",
                "source_id": "european_poy",
                "family": "global_annual_recognition",
                "year": 2024,
                "position": "MF",
                "detail": "european_poy winner 2024",
                "era": "1991_plus",
            }
        ],
    }
    active_facts = {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "facts": [
            {
                "player_id": "P-W26-RODRI",
                "source_id": "active_club_season_honors",
                "family": "club_season_honors",
                "year": 2024,
                "position": "MF",
                "detail": "UEFA Champions League title with final participation",
            }
        ],
    }
    active_staging = {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "entries": [{"player_id": "P-W26-RODRI"}],
    }
    merged, meta = stature._merge_active_channel(
        source_facts, active_facts, active_staging, {"P-62341": [2022]}, ctx
    )
    assert meta["resolved_aliases"] == {"P-62341": ["P-62341", "P-W26-RODRI"]}
    rows, _ = stature.build_rows(merged, {"P-62341": [2022]}, ctx)
    assert len(rows) == 1
    row = rows[0]
    assert row["player_id"] == "P-62341"
    assert row["fact_count"] == 2
    assert row["active_fact_count"] == 1
    assert row["resolved_player_ids"] == ["P-62341", "P-W26-RODRI"]
    assert "identity_bridge" in row["person_resolution_methods"]


def test_unresolved_active_identity_bridge_fails_stature_merge():
    """Mutation proof for the post-activation guard: if an active fact reaches a
    historical/archive identity without an identity merge, the staging artifact
    still carries ``identity_bridge_review`` and stature refuses to score it."""
    resolver = stature._PersonIdentityResolver(
        players=[{"player_id": "P-62341", "birth_date": "1996-06-22"}],
        players_2026=[
            {
                "player_id": "P-W26-RODRI",
                "birth_date": "1996-06-22",
                "full_name": "Unmerged Rodri Alias",
                "common_name": "Rodri Alias",
                "family_name": "Alias",
            }
        ],
        cards_2026=[
            {
                "card_id": "P-W26-RODRI:WC-2026",
                "player_id": "P-W26-RODRI",
                "link_status": "minted",
                "nation_id": "T-73",
                "birth_date": "1996-06-22",
            }
        ],
    )
    assert resolver.resolve("P-W26-RODRI") == "P-W26-RODRI"

    ctx = stature._ScoringContext(
        resolver=resolver,
        birth_year={"P-62341": 1996, "P-W26-RODRI": 1996},
        confederations={"P-62341": {"UEFA"}, "P-W26-RODRI": {"UEFA"}},
    )
    source_facts = {
        "version": SOURCE_SET_VERSION,
        "facts": [
            {
                "player_id": "P-62341",
                "source_id": "european_poy",
                "family": "global_annual_recognition",
                "year": 2024,
                "position": "MF",
                "detail": "european_poy winner 2024",
                "era": "1991_plus",
            }
        ],
    }
    active_facts = {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "facts": [
            {
                "player_id": "P-W26-RODRI",
                "source_id": "active_club_season_honors",
                "family": "club_season_honors",
                "year": 2024,
                "position": "MF",
                "detail": "UEFA Champions League title with final participation",
            }
        ],
    }
    active_staging = {
        "version": ACTIVE_SOURCE_SET_VERSION,
        "entries": [{"player_id": "P-W26-RODRI"}],
        "identity_bridge_review": [
            {
                "minted_player_id": "P-W26-RODRI",
                "historical_player_id": "P-62341",
                "historical_has_archive_row": True,
                "method": "manual-mutation",
            }
        ],
    }
    with pytest.raises(ValueError, match="unresolved identity bridges"):
        stature._merge_active_channel(
            source_facts, active_facts, active_staging, {"P-62341": [2022]}, ctx
        )


def test_index_bias_control_probe_census():
    """V1-owned probe census: eligibility-aware re-normalization raises
    pre-1995 non-UEFA profiles, sparse-control prevents tiny profiles from
    occupying the extreme band, and known ordering probes stay coherent."""
    by = {r["player_id"]: r for r in _committed()["career_stature"]}
    pele = by["P-38906"]
    kocsis = by["P-07028"]
    cruyff = by["P-50564"]
    owen = by["P-51130"]
    klose = by["P-27787"]

    assert pele["career_stature_index"] > kocsis["career_stature_index"]
    assert "sparse_fact_count_shrinkage" in kocsis["index_adjustments"]
    assert kocsis["career_stature_index"] <= 0.90
    assert cruyff["career_stature_index"] > owen["career_stature_index"]
    assert klose["career_stature_index"] >= 0.40


def test_canonical_greats_and_defender_gk_legends_are_flagged():
    """Every canonical great with a row is a factual legend, and the v2 repair
    target — defenders/GKs that were thin/zeroed in v1 — now carry the badge via the
    all-time / position-balanced routes (never the striker-biased annual route)."""
    by = {r["player_id"]: r for r in _committed()["career_stature"]}
    for name, pid in stature._GREATS:
        r = by.get(pid)
        assert r is not None and r["legend"], f"{name} ({pid}) is not a legend"
    for name, pid in (
        ("Maldini", "P-43222"),
        ("Baresi", "P-42920"),
        ("Yashin", "P-09317"),
        ("Buffon", "P-11392"),
        ("Cafu", "P-91718"),
    ):
        r = by.get(pid)
        assert r is not None and r["legend"], f"DF/GK legend {name} missing badge"


def test_no_per_player_override_in_stature_module():
    """The whole table is global: no player_id-keyed override mapping anywhere in
    stature.py (a P-#### literal used as a dict key is the smoking gun)."""
    import re

    code = Path(stature.__file__).read_text("utf-8")
    code = "\n".join(line.split("#", 1)[0] for line in code.splitlines())
    assert not re.search(r"\bP-\d{3,}\b\s*:", code)
    assert not re.search(r"per[_-]?player[_-]?override", code, flags=re.IGNORECASE)


def test_divergence_review_is_deterministic_and_review_only():
    """The career-lift divergence queue rebuilds byte-identical to the committed
    artifact, carries the plan's thresholds, and is purely review output."""
    from wcdraft_etl import merit_divergence

    out = merit_divergence.build(write=False)
    rebuilt = json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    committed = (_OUTPUT / "merit" / "merit_divergence_review.json").read_text("utf-8")
    assert rebuilt == committed
    assert out["thresholds"] == {
        "abs_delta_overall_min": 8,
        "abs_delta_primary_channel_min": 10,
    }
    assert "REVIEW ONLY" in out["note"]


def test_canonical_greats_are_all_scored():
    """Every canonical great resolves to a real, non-null career score (coverage
    may be thin, but the player is present — never silently dropped)."""
    by = {r["player_id"]: r for r in _committed()["career_stature"]}
    missing = [(n, pid) for n, pid in stature._GREATS if pid not in by]
    assert missing == [], f"canonical greats with no career row: {missing}"
