"""Strict row-shape contracts for emitted ETL artifacts.

These validators sit on the emit path so schema drift fails before a JSON file is
rewritten. They intentionally validate keys, not value semantics; value-level
rating and intake checks live in the stage-specific test suites.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

CANONICAL_TABLE_ROW_KEYS: dict[str, frozenset[str]] = {
    "appearances": frozenset(
        {
            "appearance_id",
            "era_1970_plus",
            "match_id",
            "nation_id",
            "player_id",
            "starter",
            "substitute",
            "tournament_id",
        }
    ),
    "awards": frozenset(
        {
            "award_id",
            "award_name",
            "award_winner_id",
            "nation_id",
            "player_id",
            "shared",
            "tournament_id",
        }
    ),
    "goals": frozenset(
        {
            "goal_id",
            "match_id",
            "minute_regulation",
            "minute_stoppage",
            "nation_id",
            "own_goal",
            "penalty",
            "player_id",
            "tournament_id",
        }
    ),
    "manager_tournaments": frozenset(
        {
            "final_placement",
            "manager_id",
            "manager_tournament_id",
            "matches",
            "nation_id",
            "tournament_id",
        }
    ),
    "managers": frozenset(
        {
            "birth_date",
            "family_name",
            "female",
            "full_name",
            "given_name",
            "manager_id",
            "nation_id",
            "nationality_name",
        }
    ),
    "nations": frozenset(
        {
            "aliases",
            "canonical_name",
            "code",
            "confederation",
            "historical",
            "mens_team",
            "nation_id",
            "successor",
            "womens_team",
        }
    ),
    "player_tournaments": frozenset(
        {
            "appearances",
            "appearances_source",
            "awards",
            "card_id",
            "club_at_tournament",
            "coverage",
            "goals",
            "nation_id",
            "player_id",
            "position_listed",
            "shirt",
            "tournament_id",
        }
    ),
    "players": frozenset(
        {
            "birth_date",
            "common_name",
            "eligible_positions",
            "family_name",
            "female",
            "full_name",
            "given_name",
            "player_id",
            "primary_position",
        }
    ),
    "tournaments": frozenset(
        {
            "champion",
            "count_teams",
            "end_date",
            "host_country",
            "name",
            "start_date",
            "tournament_id",
            "womens",
            "year",
        }
    ),
}

CANONICAL_TABLE_OPTIONAL_ROW_KEYS: dict[str, frozenset[str]] = {
    "player_tournaments": frozenset({"caps", "club_nation_code", "intl_goals"}),
}

HISTORICAL_RATING_ROW_KEYS = frozenset(
    {
        "appearances_source",
        "attack",
        "basis_ratings",
        "card_id",
        "components",
        "coverage",
        "coverage_basis",
        "defense",
        "goalkeeping",
        "legend",
        "midfield",
        "overall",
        "overall_basis",
        "player_id",
        "provenance",
        "rating_version",
        "tournament_id",
    }
)

PROJECTED_RATING_ROW_KEYS = HISTORICAL_RATING_ROW_KEYS - {"appearances_source"}

RATING_BASIS_KEYS = frozenset(
    {
        "attack",
        "basis_metadata",
        "components",
        "coverage",
        "defense",
        "goalkeeping",
        "midfield",
        "overall",
        "overall_basis",
    }
)

RATING_COMPONENT_KEYS = frozenset({"signal", "value", "weight"})


def _assert_mapping(value: Any, context: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TypeError(f"{context} must be an object, got {type(value).__name__}")
    return value


def _assert_key_set(
    row: Mapping[str, Any],
    expected: frozenset[str],
    context: str,
    *,
    optional: frozenset[str] = frozenset(),
) -> None:
    actual = frozenset(row.keys())
    allowed = expected | optional
    if expected <= actual <= allowed:
        return
    missing = sorted(expected - actual)
    extra = sorted(actual - allowed)
    raise ValueError(f"{context} key drift: missing={missing} extra={extra}")


def validate_canonical_table(name: str, rows: Sequence[Mapping[str, Any]]) -> None:
    expected = CANONICAL_TABLE_ROW_KEYS.get(name)
    if expected is None:
        raise ValueError(f"no canonical output contract registered for {name!r}")
    optional = CANONICAL_TABLE_OPTIONAL_ROW_KEYS.get(name, frozenset())
    for idx, row in enumerate(rows):
        _assert_key_set(
            _assert_mapping(row, f"{name}[{idx}]"),
            expected,
            f"{name}[{idx}]",
            optional=optional,
        )


def validate_canonical_tables(tables: Mapping[str, Sequence[Mapping[str, Any]]]) -> None:
    actual_tables = frozenset(tables.keys())
    expected_tables = frozenset(CANONICAL_TABLE_ROW_KEYS.keys())
    if actual_tables != expected_tables:
        missing = sorted(expected_tables - actual_tables)
        extra = sorted(actual_tables - expected_tables)
        raise ValueError(f"canonical table drift: missing={missing} extra={extra}")
    for name, rows in tables.items():
        validate_canonical_table(name, rows)


def _validate_components(components: Any, context: str) -> None:
    if not isinstance(components, list):
        raise TypeError(f"{context}.components must be a list, got {type(components).__name__}")
    for idx, component in enumerate(components):
        component_map = _assert_mapping(component, f"{context}.components[{idx}]")
        _assert_key_set(
            component_map,
            RATING_COMPONENT_KEYS,
            f"{context}.components[{idx}]",
        )


def _validate_rating_basis(row: Mapping[str, Any], context: str) -> None:
    basis = _assert_mapping(row.get("basis_ratings"), f"{context}.basis_ratings")
    _assert_key_set(basis, frozenset({"career", "current"}), f"{context}.basis_ratings")
    for basis_name in ("career", "current"):
        payload = _assert_mapping(basis[basis_name], f"{context}.basis_ratings.{basis_name}")
        _assert_key_set(payload, RATING_BASIS_KEYS, f"{context}.basis_ratings.{basis_name}")
        _validate_components(payload["components"], f"{context}.basis_ratings.{basis_name}")


def validate_historical_rating_rows(rows: Sequence[Mapping[str, Any]]) -> None:
    for idx, row in enumerate(rows):
        row_map = _assert_mapping(row, f"ratings[{idx}]")
        _assert_key_set(row_map, HISTORICAL_RATING_ROW_KEYS, f"ratings[{idx}]")
        _validate_components(row_map["components"], f"ratings[{idx}]")
        _validate_rating_basis(row_map, f"ratings[{idx}]")


def validate_projected_rating_rows(rows: Sequence[Mapping[str, Any]]) -> None:
    for idx, row in enumerate(rows):
        row_map = _assert_mapping(row, f"ratings_2026[{idx}]")
        _assert_key_set(row_map, PROJECTED_RATING_ROW_KEYS, f"ratings_2026[{idx}]")
        _validate_components(row_map["components"], f"ratings_2026[{idx}]")
        _validate_rating_basis(row_map, f"ratings_2026[{idx}]")
