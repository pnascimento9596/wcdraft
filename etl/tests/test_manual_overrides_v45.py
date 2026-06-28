"""merit-v4.5 recovered v4.3 honest misses.

The v4.5 file is a conservative extension of merit-v4.3, not an independent
rating source. Every recovered row must still be a v4.3 unmatched row, and once
accepted it follows the v4.3 duplicate-average and Career+Current apply rules.
"""

from __future__ import annotations

from wcdraft_etl import display_curve, manual_overrides, rating_display

EXPECTED_SHA256_V45 = "3effc3ba9adb7efd5fb4d00c406da5aa82db67d5b64f20e5a049cb807eaef249"


def _row(card_id: str, career: float, current: float) -> dict:
    return {
        "card_id": card_id,
        "score_0_100": career,
        "current_score_0_100": current,
        "components": [],
    }


def _expected_internal(target: int) -> float:
    return rating_display._inverse_display_value(target, display_curve.fit_unified_curve())


def test_source_fingerprint_and_v43_unmatched_subset():
    rows, sha = manual_overrides.load_override_rows_v45()
    v43 = manual_overrides.resolve_overrides()

    assert sha == EXPECTED_SHA256_V45
    assert len(rows) == 36
    assert len({row.source_line for row in rows}) == 36
    assert {row.source_line for row in rows} <= {
        row.source_line for row in v43.unmatched
    }
    assert all(row.match_method.startswith("v4.5_") for row in rows)
    assert {row.evidence_source for row in rows} == {"local", "wikidata"}


def test_resolution_recovers_expected_rows_and_remainder():
    v43 = manual_overrides.resolve_overrides()
    v45 = manual_overrides.resolve_overrides_v45()
    recovered_lines = {row.source_line for row in manual_overrides.load_override_rows_v45()[0]}

    assert len(v43.matched) == 2300
    assert len(v43.unmatched) == 216
    assert len(v45.matched) == 2336
    assert len(v45.unmatched) == 180
    assert recovered_lines.isdisjoint({row.source_line for row in v45.unmatched})


def test_duplicate_average_matches_v43_contract():
    effective = manual_overrides.resolve_overrides_v45().matched_by_card_id

    spots = {
        "P-23484:WC-2010": (74, "canonical-duplicate-avg(75,73)", "v4.3+v4.5"),
        "P-76060:WC-2018": (84, "avg(83,84)", "v4.5"),
        "P-87266:WC-2018": (82, "agree", "v4.5"),
        "P-10501:WC-2022": (85, "canonical-duplicate-avg(85,84)", "v4.3+v4.5"),
    }
    for card_id, (target, rule, source_version) in spots.items():
        row = effective[card_id]
        assert row.final_rating == target
        assert row.rule == rule
        assert row.source_version == source_version


def test_apply_pins_recovered_rows_and_preserves_v44_current_precedence():
    v45 = manual_overrides.resolve_overrides_v45().matched_by_card_id
    v44 = manual_overrides.resolve_overrides_v44().matched_by_card_id

    v45_only = "P-76060:WC-2018"
    v44_overlap = "P-49114:WC-2022"
    assert v45_only in v45 and v45_only not in v44
    assert v44_overlap in v45 and v44_overlap in v44

    rows = [
        _row(v45_only, 60.0, 61.0),
        _row(v44_overlap, 60.0, 61.0),
    ]
    manual_overrides.apply_to_internal_rows(rows)
    by_id = {row["card_id"]: row for row in rows}

    row = by_id[v45_only]
    assert row["score_0_100"] == _expected_internal(v45[v45_only].final_rating)
    assert row["current_score_0_100"] == _expected_internal(v45[v45_only].final_rating)
    assert row["manual_rating_override"]["source_version"] == "v4.5"
    assert manual_overrides.manual_overall(row) == v45[v45_only].final_rating
    assert manual_overrides.manual_current_overall(row) == v45[v45_only].final_rating

    row = by_id[v44_overlap]
    assert row["score_0_100"] == _expected_internal(v45[v44_overlap].final_rating)
    assert row["current_score_0_100"] == _expected_internal(v44[v44_overlap].final_rating)
    assert row["manual_rating_override"]["source_version"] == "v4.5"
    assert row["manual_current_override"]["source_version"] == "v4.4"
    assert manual_overrides.manual_overall(row) == v45[v44_overlap].final_rating
    assert manual_overrides.manual_current_overall(row) == v44[v44_overlap].final_rating
