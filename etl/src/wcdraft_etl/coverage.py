"""Generate etl/output/COVERAGE.md — the honest-state coverage report.

Reports, from the *built* canonical tables (so the report can never drift from
what was emitted): row counts per table, null-rate per nullable column, the two
era cliffs, and per-era card coverage. Pure functions of the data; no timestamps,
so the output is byte-stable across runs.
"""

from __future__ import annotations

from . import source

# Columns we treat as nullable (honest-state) and therefore report a null-rate for.
NULLABLE = {
    "nations": ["canonical_name", "code", "successor"],
    "players": ["full_name", "birth_date", "primary_position"],
    "player_tournaments": ["shirt", "position_listed", "club_at_tournament", "appearances"],
    "managers": ["full_name", "nation_id", "birth_date"],
    "manager_tournaments": ["matches", "final_placement"],
    "tournaments": ["name", "year", "host_country", "champion", "count_teams"],
}


def _null_rate(rows: list[dict], col: str) -> tuple[int, int]:
    n = len(rows)
    nulls = sum(1 for r in rows if r.get(col) is None)
    return nulls, n


def _pct(nulls: int, n: int) -> str:
    return f"{(100 * nulls / n):.1f}%" if n else "—"


def render(tables: dict[str, list[dict]]) -> str:
    cards = tables["player_tournaments"]
    tdf = source.load("tournaments")
    year_of = {t.tournament_id: int(t.year) for t in tdf.itertuples(index=False)}

    L: list[str] = []
    L.append("# wcdraft ETL — Coverage Report\n")
    L.append(
        "Per-era signal availability and null-rates for the canonical tables built\n"
        "from the Fjelstul World Cup Database. **Honest-state:** a signal absent for\n"
        "an era is `null`, never `0`/`false`/`\"\"`. This report is generated from the\n"
        "emitted tables, so it cannot drift from what was shipped.\n"
    )
    L.append(f"> {source.ATTRIBUTION}\n")

    # --- Era cliffs ---
    L.append("## The two era cliffs\n")
    L.append(
        "| Signal | Available from | Before that |\n"
        "|---|---|---|\n"
        "| Goals, squad selection, awards, standings, managers | **1930** | — (full history) |\n"
        "| Match appearances / lineups, bookings, substitutions | **1970** | `null` (no match-level data) |\n"  # noqa: E501
        "| Shirt numbers | **1954** | `null` (no squad numbers assigned) |\n"
        "| Club at tournament | **pinned Wikipedia squad pages (men's 1930–2022)** | `null` where the pinned source lacks a club row/value or no unambiguous join exists |\n"  # noqa: E501
        "| **Assists, minutes played** | **never** | permanently absent — omitted, not fabricated |\n"  # noqa: E501
    )
    L.append(
        "\nTwo distinct cliffs drive card coverage: squad numbers begin in **1954**\n"
        "and match-level appearances begin in **1970**. Goals/selection/awards reach\n"
        "back to **1930**.\n"
    )

    # --- Row counts ---
    L.append("## Row counts per table\n")
    L.append("| Table | Rows |\n|---|---|")
    for name in sorted(tables):
        L.append(f"| {name} | {len(tables[name]):,} |")
    L.append("")

    # --- Null-rates ---
    L.append("## Null-rate per nullable column\n")
    L.append(
        "Only honest-state nullable columns are listed. `club_at_tournament` is\n"
        "populated only where the pinned Wikipedia squad source carries a factual\n"
        "club name and the row joins unambiguously to a canonical card; managers'\n"
        "`birth_date` is **100% null** (no birth_date column upstream); and\n"
        "`final_placement` is null except for semifinalists, because the upstream\n"
        "`tournament_standings` ranks only positions 1–4 per tournament. These are\n"
        "absences in the source, surfaced — not data-quality defects.\n"
    )
    L.append("| Table | Column | Null rate |\n|---|---|---|")
    for name in sorted(NULLABLE):
        rows = tables.get(name, [])
        for col in NULLABLE[name]:
            nulls, n = _null_rate(rows, col)
            L.append(f"| {name} | {col} | {_pct(nulls, n)} ({nulls:,}/{n:,}) |")
    L.append("")

    # --- Per-era card coverage ---
    L.append("## Card coverage by era\n")
    L.append(
        "`coverage` = fraction of the per-card signal universe "
        "{selection, position_listed, goals, awards, appearances, shirt} present\n"
        "for that card. Signals outside the rating-input universe "
        "(club, assists, minutes) are excluded: club is optional display metadata,\n"
        "while assists/minutes are absent. The values cluster at\n"
        "three tiers matching the cliffs.\n"
    )
    buckets: dict[str, list[float]] = {"pre-1954": [], "1954–1969": [], "1970+": []}
    for c in cards:
        y = year_of.get(c["tournament_id"])
        b = "pre-1954" if (y is None or y < 1954) else "1954–1969" if y < 1970 else "1970+"
        buckets[b].append(c["coverage"])
    L.append("| Era | Cards | Mean coverage | Typical |\n|---|---|---|---|")
    typical = {"pre-1954": "0.6667 (4/6)", "1954–1969": "0.8333 (5/6)", "1970+": "1.0000 (6/6)"}
    for b in ("pre-1954", "1954–1969", "1970+"):
        vals = buckets[b]
        mean = f"{sum(vals) / len(vals):.4f}" if vals else "—"
        L.append(f"| {b} | {len(vals):,} | {mean} | {typical[b]} |")
    L.append("")

    return "\n".join(L) + "\n"
