"""merit-v4.4 owner re-rate — resolution + layered-apply contract.

The merit-v4.4 delta file re-rates the 85–90 CURRENT-basis band. This suite locks
the contract that the implementation must hold:

* the screened source fingerprint (sha + 515 applied / 639 skipped-blank rows),
* a clean, unambiguous resolution (515/515, no >1-player collisions),
* the layered apply: v4.4 pins the CURRENT basis ONLY; the CAREER basis is left
  untouched; on a card named by both v4.3 and v4.4 the v4.4 current target
  supersedes v4.3's current pin while v4.3's career pin remains; non-listed
  cards are untouched.
"""

from __future__ import annotations

from wcdraft_etl import manual_overrides

EXPECTED_SHA256_V44 = "d51f188357d645f2ff558d8a851434ab78d7e5755136e0be189ad34cdab143a0"


def test_source_fingerprint_and_blank_skip():
    rows, sha = manual_overrides.load_override_rows_v44()
    assert sha == EXPECTED_SHA256_V44
    # 1,154 data rows; only the 515 non-blank-target rows are loaded as applied.
    assert len(rows) == 515
    assert all(0 <= r.final_rating <= 99 for r in rows)
    assert all(r.rule == "v4.4-target" for r in rows)


def test_resolution_is_clean_and_unambiguous():
    res = manual_overrides.resolve_overrides_v44()
    assert len(res.matched) == 515
    assert len(res.unmatched) == 0
    assert res.match_rate == 1.0
    # Each row resolves to its own canonical card (no card collisions / no
    # duplicate-average synthesis): effective pins == matched rows.
    assert len(res.matched_by_card_id) == 515


def test_two_way_rerate_split():
    """144 up / 249 down / 122 same vs the file's own current_rating baseline."""
    rows, _ = manual_overrides.load_override_rows_v44()
    up = sum(1 for r in rows if r.final_rating > int(r.current_baseline))
    down = sum(1 for r in rows if r.final_rating < int(r.current_baseline))
    same = sum(1 for r in rows if r.final_rating == int(r.current_baseline))
    assert (up, down, same) == (144, 249, 122)


def _row(card_id: str, career: float, current: float) -> dict:
    return {
        "card_id": card_id,
        "score_0_100": career,
        "current_score_0_100": current,
        "components": [],
    }


def test_apply_pins_current_only_and_leaves_career_untouched():
    v44 = manual_overrides.resolve_overrides_v44().matched_by_card_id
    v43 = manual_overrides.resolve_overrides().matched_by_card_id

    v44_only = sorted(set(v44) - set(v43))
    overlap = sorted(set(v44) & set(v43))
    assert v44_only, "expected v4.4-only cards"
    assert overlap, "expected v4.3 ∩ v4.4 overlap cards"

    v44_card = v44_only[0]
    overlap_card = overlap[0]
    unlisted = "P-00000:WC-1930"  # not in either override set

    BASE_CAREER, BASE_CURRENT = 70.0, 71.0
    rows = [
        _row(v44_card, BASE_CAREER, BASE_CURRENT),
        _row(overlap_card, BASE_CAREER, BASE_CURRENT),
        _row(unlisted, BASE_CAREER, BASE_CURRENT),
    ]
    manual_overrides.apply_to_internal_rows(rows)
    by_id = {r["card_id"]: r for r in rows}

    # v4.4-only: CURRENT pinned to target; CAREER score untouched.
    r = by_id[v44_card]
    assert r["current_score_0_100"] == float(v44[v44_card].final_rating)
    assert r["score_0_100"] == BASE_CAREER
    assert manual_overrides.manual_current_overall(r) == v44[v44_card].final_rating
    assert manual_overrides.manual_overall(r) is None  # no career pin

    # Overlap: CAREER = v4.3 pin; CURRENT = v4.4 target (v4.4 supersedes).
    r = by_id[overlap_card]
    assert r["score_0_100"] == float(v43[overlap_card].final_rating)
    assert r["current_score_0_100"] == float(v44[overlap_card].final_rating)
    assert manual_overrides.manual_overall(r) == v43[overlap_card].final_rating
    assert manual_overrides.manual_current_overall(r) == v44[overlap_card].final_rating

    # Non-listed: completely untouched.
    r = by_id[unlisted]
    assert r["score_0_100"] == BASE_CAREER
    assert r["current_score_0_100"] == BASE_CURRENT
    assert manual_overrides.manual_overall(r) is None
    assert manual_overrides.manual_current_overall(r) is None


def test_known_spot_pins():
    """Pelé 1970 → Current 95 (Career untouched); Gonzalo Jara 2010 → Current 64."""
    v44 = manual_overrides.resolve_overrides_v44().matched_by_card_id
    spots = {"P-38906:WC-1970": 95, "P-21890:WC-2010": 64}
    for card_id, target in spots.items():
        assert card_id in v44, card_id
        assert v44[card_id].final_rating == target, (card_id, v44[card_id].final_rating)
