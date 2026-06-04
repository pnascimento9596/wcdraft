"""Shared fixtures: build the canonical tables once per test session."""

from __future__ import annotations

import pytest

from wcdraft_etl import pipeline


@pytest.fixture(scope="session")
def tables() -> dict[str, list[dict]]:
    return pipeline.build_all()
