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
    """career_stature_index is a finite [0,1] value, monotonic non-decreasing in the
    score (the global re-spread), and never below the raw score's own compression —
    the recognized-greats cohort lands near the top of [0,1]."""
    rows = sorted(
        _committed()["career_stature"], key=lambda r: r["career_stature_score"]
    )
    last = -1.0
    for r in rows:
        idx = r["career_stature_index"]
        assert isinstance(idx, (int, float)) and 0.0 <= idx <= 1.0 and idx == idx, r
        assert idx >= last - 1e-9, ("index not monotonic vs score", r["player_id"])
        last = idx
    # The transform is a pure function of the score (no per-player parameter): equal
    # scores must yield equal indices.
    for r in _committed()["career_stature"]:
        assert r["career_stature_index"] == round(
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
    sf = json.loads((_OUTPUT / "merit" / "source_facts.json").read_text("utf-8"))
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
