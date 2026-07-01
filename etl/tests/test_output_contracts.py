from __future__ import annotations

from wcdraft_etl import output_contracts, pipeline, rating, rating_2026


def test_pipeline_tables_match_registered_output_contracts():
    output_contracts.validate_canonical_tables(pipeline.build_all())


def test_name_part_sentinels_are_normalized_without_touching_real_na_names():
    tables = pipeline.build_all()
    players = {row["player_id"]: row for row in tables["players"]}
    managers = {row["manager_id"]: row for row in tables["managers"]}

    assert players["P-81323"]["given_name"] is None
    assert players["P-81323"]["full_name"] == "Rodri"
    assert players["P-62341"]["given_name"] is None
    assert players["P-62341"]["full_name"] == "Rodri"

    assert players["P-10357"]["given_name"] == "Na"
    assert players["P-10357"]["full_name"] == "Na Sang-ho"

    assert managers["M-100"]["given_name"] is None
    assert managers["M-100"]["full_name"] == "Didi"
    assert managers["M-108"]["given_name"] is None
    assert managers["M-108"]["full_name"] == "Dunga"
    assert managers["M-475"]["given_name"] is None
    assert managers["M-475"]["full_name"] == "Zico"


def test_historical_rating_rows_match_registered_output_contract():
    output_contracts.validate_historical_rating_rows(rating.build_all())


def test_projected_rating_rows_match_registered_output_contract():
    output_contracts.validate_projected_rating_rows(rating_2026.build_all())
