from __future__ import annotations

from wcdraft_etl import output_contracts, pipeline, rating, rating_2026


def test_pipeline_tables_match_registered_output_contracts():
    output_contracts.validate_canonical_tables(pipeline.build_all())


def test_historical_rating_rows_match_registered_output_contract():
    output_contracts.validate_historical_rating_rows(rating.build_all())


def test_projected_rating_rows_match_registered_output_contract():
    output_contracts.validate_projected_rating_rows(rating_2026.build_all())
