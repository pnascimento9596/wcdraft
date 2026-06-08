"""ENGINE-V2 E-4.2 / E-4.6 — career-stature composite acceptance suite.

Proves the offline merit composite (`merit/stature.py` → `etl/output/career_stature.json`)
is deterministic, schema-clean, honest-state compliant, and free of any per-player
override. The career composite is the ONLY place career aggregates live; the rating
stage consumes it as a capped lift (covered by `test_rating.py`).
"""

from __future__ import annotations

import json
from pathlib import Path

from wcdraft_etl.merit import FAMILY_KEYS, VERSION, stature

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


def test_club_honors_is_deferred_weight_zero_everywhere():
    """Tier-2 club honours are deferred (E-4b): null family score, weight 0,
    in every row — never a fact, never a weight."""
    for r in _committed()["career_stature"]:
        assert r["family_scores"]["club_honors"] is None
        assert r["family_weights"]["club_honors"] == 0.0


def test_era_weights_match_the_locked_table():
    """Each row's family weights are exactly the era-bucket weights — there is no
    per-player weighting, only per-era."""
    for r in _committed()["career_stature"]:
        expected = stature.ERA_FAMILY_WEIGHTS[r["era_bucket"]]
        assert r["family_weights"] == expected, r["player_id"]


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


def test_coverage_gate_split_is_consistent():
    """lift_eligible_count = rows at/above the coverage gate; the review queue is
    its complement (every below-gate row is flagged)."""
    table = _committed()
    rows = table["career_stature"]
    eligible = [r for r in rows if r["coverage"] >= stature.REVIEW_COVERAGE_THRESHOLD]
    assert table["lift_eligible_count"] == len(eligible)
    review = json.loads((_OUTPUT / "merit" / "career_stature_review.json").read_text("utf-8"))
    flagged_pids = {r["player_id"] for r in review["review"]}
    below = {r["player_id"] for r in rows if r["coverage"] < stature.REVIEW_COVERAGE_THRESHOLD}
    assert below <= flagged_pids  # every below-gate row appears in the review queue


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
