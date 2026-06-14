"""merit-v4 national-team strength priors."""

from __future__ import annotations

import json

import pytest

from wcdraft_etl import national_strength as ns

OUT = ns.OUTPUT_DIR


def _rows() -> list[dict]:
    return json.loads((OUT / "national_strength.json").read_text(encoding="utf-8"))


def _by_key() -> dict[tuple[str, str], dict]:
    return {(r["tournament_id"], r["nation_id"]): r for r in _rows()}


def test_raw_only_ceiling_curve_is_smooth_monotone_and_pinned():
    assert ns.raw_only_ceiling_for_strength(0.0) == pytest.approx(0.500)
    assert ns.raw_only_ceiling_for_strength(1.0) == pytest.approx(0.625)
    vals = [ns.raw_only_ceiling_for_strength(i / 20) for i in range(21)]
    assert vals == sorted(vals)
    assert vals[10] == pytest.approx(0.5625)


def test_national_strength_rebuild_matches_committed_artifact():
    fresh = ns.build_all()
    committed = _rows()
    assert fresh == committed


def test_all_card_participant_pairs_have_strength_rows():
    expected: set[tuple[str, str]] = set()
    mens_tournaments = {
        t["tournament_id"]
        for t in json.loads((OUT / "tournaments.json").read_text(encoding="utf-8"))
        if t["womens"] is False
    }
    for card in json.loads((OUT / "player_tournaments.json").read_text(encoding="utf-8")):
        if card["tournament_id"] in mens_tournaments:
            expected.add((card["tournament_id"], card["nation_id"]))
    for card in json.loads((OUT / "player_tournaments_2026.json").read_text(encoding="utf-8")):
        expected.add((card["tournament_id"], card["nation_id"]))
    assert set(_by_key()) == expected


def test_named_public_source_rows_are_pinned():
    rows = _by_key()

    korea_2022 = rows[("WC-2022", "T-71")]
    assert korea_2022["elo_code"] == "KR"
    assert korea_2022["elo_global_rank"] == 27
    assert korea_2022["fifa_date_id"] == "id13792"
    assert korea_2022["fifa_rank"] == 28

    france_2022 = rows[("WC-2022", "T-30")]
    assert france_2022["elo_code"] == "FR"
    assert france_2022["elo_global_rank"] == 7
    assert france_2022["raw_only_ceiling"] > korea_2022["raw_only_ceiling"]

    norway_2026 = rows[("WC-2026", "T-53")]
    assert norway_2026["elo_code"] == "NO"
    assert norway_2026["elo_global_rank"] == 11
    assert norway_2026["fifa_date_id"] == "id15136"
    assert norway_2026["fifa_release_date"] == "2026-06-11"
    assert norway_2026["fifa_rank"] == 31

    cape_verde_2026 = rows[("WC-2026", "T-W26-1")]
    curacao_2026 = rows[("WC-2026", "T-W26-2")]
    assert cape_verde_2026["elo_code"] == "CV"
    assert cape_verde_2026["fifa_code"] == "CPV"
    assert curacao_2026["elo_code"] == "CW"
    assert curacao_2026["fifa_code"] == "CUW"


def test_post_1994_rows_have_official_fifa_rank_and_all_rows_have_elo():
    for row in _rows():
        assert row["elo_global_rank"] is not None
        assert row["elo_rating"] is not None
        if row["year"] >= 1994:
            assert row["fifa_rank"] is not None, row
            assert row["strength_basis"] == "elo_rank_plus_fifa_rank"
        else:
            assert row["fifa_rank"] is None
            assert row["strength_basis"] == "elo_rank"
