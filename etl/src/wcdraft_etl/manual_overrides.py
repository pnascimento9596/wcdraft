"""Owner-authored merit-v4.3 manual rating overrides.

The CSV in ``etl/overrides/manual-ratings-v4.3.csv`` is the audit source. This
module validates that source, resolves each row to a canonical card, emits the
match/miss artifacts, and applies resolved rows as an internal-score pin.

Only unambiguous matches are applied. Plausible-but-non-unique rows are honest
misses and remain visible in the unmatched artifact.
"""

from __future__ import annotations

import csv
import difflib
import hashlib
import html
import json
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from .merit.text import norm

ETL_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ETL_DIR / "output"
OVERRIDE_PATH = ETL_DIR / "overrides" / "manual-ratings-v4.3.csv"

EXPECTED_SHA256 = "f121d0f768fe70cfc6d699559bf78dc25d356ccea33ca0aa5e8ded11c65d9da6"
EXPECTED_ROWS = 2516
EXPECTED_RULE_COUNTS = {
    "agree": 1055,
    "avg": 455,
    "f2-only": 811,
    "f1-only": 190,
    "f1-corrupt->f2": 5,
}
EXPECTED_HEADER = [
    "country",
    "year",
    "player_name",
    "final_rating",
    "rule",
    "file1_val",
    "file2_val",
    "current_baseline",
]
MIN_MATCH_RATE = 0.90

_TARGET_YEARS = {2002, 2006, 2010, 2014, 2018, 2022, 2026}
_GENERIC_NAME_TOKENS = {
    "al",
    "and",
    "bin",
    "da",
    "das",
    "de",
    "del",
    "della",
    "di",
    "do",
    "dos",
    "du",
    "el",
    "ibn",
    "ii",
    "iii",
    "iv",
    "jr",
    "junior",
    "la",
    "le",
    "not",
    "applicable",
    "van",
    "von",
    "y",
}

# Country spellings used by the owner file that are not guaranteed to appear as
# exact canonical aliases in every historical entity table.
_NATION_ALIASES: dict[str, tuple[str, ...]] = {
    "caboverde": ("Cabo Verde", "Cape Verde"),
    "capeverde": ("Cabo Verde", "Cape Verde"),
    "curacao": ("Curaçao", "Curacao"),
    "czechrepublic": ("Czech Republic",),
    "democraticrepublicofthecongo": ("DR Congo", "Democratic Republic of the Congo"),
    "drcongo": ("DR Congo", "Democratic Republic of the Congo"),
    "drc": ("DR Congo", "Democratic Republic of the Congo"),
    "ireland": ("Republic of Ireland",),
    "korearepublic": ("Korea Republic", "South Korea", "Republic of Korea"),
    "republicofireland": ("Republic of Ireland",),
    "serbiaandmontenegro": ("Serbia and Montenegro",),
    "southkorea": ("Korea Republic", "South Korea", "Republic of Korea"),
    "trinidadandtobago": ("Trinidad and Tobago",),
    "unitedstates": ("United States",),
    "usa": ("United States",),
}


@dataclass(frozen=True)
class OverrideRow:
    source_line: int
    country: str
    year: int
    player_name: str
    final_rating: int
    rule: str
    file1_val: str
    file2_val: str
    current_baseline: str


@dataclass(frozen=True)
class ResolvedOverride:
    source_line: int
    country: str
    year: int
    player_name: str
    final_rating: int
    rule: str
    current_baseline: str
    card_id: str
    player_id: str
    tournament_id: str
    nation_id: str
    matched_name: str
    match_method: str


@dataclass(frozen=True)
class UnmatchedOverride:
    source_line: int
    country: str
    year: int
    player_name: str
    final_rating: int
    rule: str
    current_baseline: str
    reason: str
    candidate_card_ids: tuple[str, ...] = ()
    candidate_names: tuple[str, ...] = ()


@dataclass(frozen=True)
class OverrideResolution:
    rows: tuple[OverrideRow, ...]
    matched: tuple[ResolvedOverride, ...]
    unmatched: tuple[UnmatchedOverride, ...]
    csv_sha256: str
    rule_counts: dict[str, int]

    @property
    def match_rate(self) -> float:
        return len(self.matched) / len(self.rows) if self.rows else 0.0

    @property
    def matched_by_card_id(self) -> dict[str, ResolvedOverride]:
        out: dict[str, ResolvedOverride] = {}
        by_card: dict[str, list[ResolvedOverride]] = defaultdict(list)
        for row in self.matched:
            by_card[row.card_id].append(row)
        for card_id, rows in by_card.items():
            rows = sorted(rows, key=lambda row: row.source_line)
            values = [row.final_rating for row in rows]
            if len(set(values)) == 1:
                out[card_id] = rows[0]
                continue
            merged = _round_half_up(sum(values) / len(values))
            first = rows[0]
            out[card_id] = ResolvedOverride(
                source_line=first.source_line,
                country=first.country,
                year=first.year,
                player_name=" / ".join(row.player_name for row in rows),
                final_rating=merged,
                rule="canonical-duplicate-avg(" + ",".join(str(v) for v in values) + ")",
                current_baseline=first.current_baseline,
                card_id=card_id,
                player_id=first.player_id,
                tournament_id=first.tournament_id,
                nation_id=first.nation_id,
                matched_name=first.matched_name,
                match_method="canonical_duplicate_avg",
            )
        return out


@dataclass(frozen=True)
class _CandidateName:
    name: str
    field: str
    priority: int
    key: str
    tokens: tuple[str, ...]


@dataclass(frozen=True)
class _Candidate:
    card_id: str
    player_id: str
    tournament_id: str
    nation_id: str
    display_name: str
    names: tuple[_CandidateName, ...]
    all_tokens: frozenset[str]
    fallback_tokens: frozenset[str]


@dataclass(frozen=True)
class _Score:
    value: float
    method: str
    candidate: _Candidate


_RESOLUTION_CACHE: dict[Path, OverrideResolution] = {}


def load_override_rows(
    path: Path = OVERRIDE_PATH,
) -> tuple[tuple[OverrideRow, ...], str, dict[str, int]]:
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != EXPECTED_SHA256:
        raise ValueError(
            f"{path}: sha256 {sha} != expected {EXPECTED_SHA256}; do not apply overrides"
        )

    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines())
    if reader.fieldnames != EXPECTED_HEADER:
        raise ValueError(f"{path}: header {reader.fieldnames!r} != {EXPECTED_HEADER!r}")

    rows: list[OverrideRow] = []
    rule_counts: Counter[str] = Counter()
    for source_line, raw_row in enumerate(reader, start=2):
        final_rating = int(raw_row["final_rating"])
        if not 0 <= final_rating <= 99:
            raise ValueError(f"{path}:{source_line}: final_rating {final_rating} outside [0, 99]")
        row = OverrideRow(
            source_line=source_line,
            country=raw_row["country"],
            year=int(raw_row["year"]),
            player_name=html.unescape(raw_row["player_name"]),
            final_rating=final_rating,
            rule=raw_row["rule"],
            file1_val=raw_row["file1_val"],
            file2_val=raw_row["file2_val"],
            current_baseline=raw_row["current_baseline"],
        )
        rows.append(row)
        rule_counts[_rule_bucket(row.rule)] += 1

    if len(rows) != EXPECTED_ROWS:
        raise ValueError(f"{path}: {len(rows)} data rows != expected {EXPECTED_ROWS}")
    if dict(rule_counts) != EXPECTED_RULE_COUNTS:
        raise ValueError(
            f"{path}: rule counts {dict(rule_counts)!r} != expected {EXPECTED_RULE_COUNTS!r}"
        )
    return tuple(rows), sha, dict(rule_counts)


def resolve_overrides(output_dir: Path = OUTPUT_DIR) -> OverrideResolution:
    output_dir = output_dir.resolve()
    cached = _RESOLUTION_CACHE.get(output_dir)
    if cached is not None:
        return cached

    rows, sha, rule_counts = load_override_rows()
    candidates_by_block, nation_ids_by_name = _build_resolution_index(output_dir)
    matched: list[ResolvedOverride] = []
    unmatched: list[UnmatchedOverride] = []
    absent_blocks: set[tuple[str, int]] = set()

    for row in rows:
        nation_ids = _resolve_nation_ids(row.country, nation_ids_by_name)
        block = [
            candidate
            for nation_id in sorted(nation_ids)
            for candidate in candidates_by_block.get((nation_id, row.year), ())
        ]
        if not block:
            absent_blocks.add((row.country, row.year))
            unmatched.append(_unmatched(row, "nation_year_block_absent"))
            continue
        if _looks_like_source_hint(row.player_name):
            unmatched.append(_unmatched(row, "source_hint_not_player_name"))
            continue

        score = _resolve_player(row.player_name, block)
        if isinstance(score, _Score):
            matched.append(
                ResolvedOverride(
                    source_line=row.source_line,
                    country=row.country,
                    year=row.year,
                    player_name=row.player_name,
                    final_rating=row.final_rating,
                    rule=row.rule,
                    current_baseline=row.current_baseline,
                    card_id=score.candidate.card_id,
                    player_id=score.candidate.player_id,
                    tournament_id=score.candidate.tournament_id,
                    nation_id=score.candidate.nation_id,
                    matched_name=score.candidate.display_name,
                    match_method=score.method,
                )
            )
        elif score:
            top = score[:5]
            unmatched.append(
                _unmatched(
                    row,
                    "ambiguous_unapplied",
                    candidate_card_ids=tuple(s.candidate.card_id for s in top),
                    candidate_names=tuple(s.candidate.display_name for s in top),
                )
            )
        else:
            unmatched.append(_unmatched(row, "no_unambiguous_match"))

    matched, unmatched = _drop_conflicting_weak_duplicates(matched, unmatched)

    resolution = OverrideResolution(
        rows=rows,
        matched=tuple(sorted(matched, key=lambda r: (r.year, r.country, r.source_line))),
        unmatched=tuple(sorted(unmatched, key=lambda r: r.source_line)),
        csv_sha256=sha,
        rule_counts=rule_counts,
    )
    if absent_blocks:
        sample = ", ".join(f"{country} {year}" for country, year in sorted(absent_blocks)[:10])
        raise ValueError(f"manual rating override found absent nation/year blocks: {sample}")
    if resolution.match_rate < MIN_MATCH_RATE:
        raise ValueError(
            "manual rating override match rate "
            f"{resolution.match_rate:.2%} below required {MIN_MATCH_RATE:.0%}"
        )
    # Force duplicate-card synthesis before caching.
    _ = resolution.matched_by_card_id
    _RESOLUTION_CACHE[output_dir] = resolution
    return resolution


def apply_to_internal_rows(
    internal_rows: list[dict],
    output_dir: Path = OUTPUT_DIR,
) -> list[dict]:
    """Pin resolved rows in-place and return ``internal_rows`` for chaining."""
    overrides = resolve_overrides(output_dir).matched_by_card_id
    for row in internal_rows:
        override = overrides.get(row["card_id"])
        if override is None:
            continue
        previous_score = row["score_0_100"]
        previous_current = row["current_score_0_100"]
        target = float(override.final_rating)
        row["score_0_100"] = target
        row["current_score_0_100"] = target
        row["manual_rating_override"] = {
            "source_line": override.source_line,
            "source_sha256": EXPECTED_SHA256,
            "final_rating": override.final_rating,
            "rule": override.rule,
            "player_name": override.player_name,
            "matched_name": override.matched_name,
            "match_method": override.match_method,
            "previous_score_0_100": round(previous_score, 6),
            "previous_current_score_0_100": round(previous_current, 6),
        }
        row["components"] = [
            *row["components"],
            {
                "signal": "manual_rating_override",
                "value": override.final_rating,
                "weight": 1.0,
            },
            {
                "signal": "manual_rating_override_source_line",
                "value": override.source_line,
                "weight": 0.0,
            },
            {
                "signal": "manual_rating_override_previous_score",
                "value": round(previous_score, 6),
                "weight": 0.0,
            },
            {
                "signal": "manual_rating_override_previous_current_score",
                "value": round(previous_current, 6),
                "weight": 0.0,
            },
        ]
    return internal_rows


def manual_overall(row: dict) -> int | None:
    override = row.get("manual_rating_override")
    if not isinstance(override, dict):
        return None
    target = int(override["final_rating"])
    score = int(round(float(row["score_0_100"])))
    current_score = int(round(float(row.get("current_score_0_100", row["score_0_100"]))))
    if score != target or current_score != target:
        raise ValueError(
            f"manual override drift for {row.get('card_id')}: "
            f"source target {target}, score {score}, current_score {current_score}"
        )
    return score


def has_manual_override_components(rating_row: dict) -> bool:
    return any(
        c.get("signal") == "manual_rating_override"
        for c in rating_row.get("components", ())
    )


def write_resolution_artifacts(output_dir: Path = OUTPUT_DIR) -> OverrideResolution:
    resolution = resolve_overrides(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    resolution_path = output_dir / "manual-ratings-v4.3-resolution.csv"
    with resolution_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "source_line",
                "country",
                "year",
                "player_name",
                "final_rating",
                "rule",
                "current_baseline",
                "card_id",
                "player_id",
                "tournament_id",
                "nation_id",
                "matched_name",
                "match_method",
            ],
        )
        writer.writeheader()
        for row in resolution.matched:
            writer.writerow(row.__dict__)

    unmatched_path = output_dir / "manual-ratings-v4.3-unmatched.csv"
    with unmatched_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "source_line",
                "country",
                "year",
                "player_name",
                "final_rating",
                "rule",
                "current_baseline",
                "reason",
                "candidate_card_ids",
                "candidate_names",
            ],
        )
        writer.writeheader()
        for row in resolution.unmatched:
            writer.writerow(
                {
                    **row.__dict__,
                    "candidate_card_ids": ";".join(row.candidate_card_ids),
                    "candidate_names": ";".join(row.candidate_names),
                }
            )

    effective = resolution.matched_by_card_id
    effective_path = output_dir / "manual-ratings-v4.3-effective.csv"
    matched_by_card: dict[str, list[ResolvedOverride]] = defaultdict(list)
    for row in resolution.matched:
        matched_by_card[row.card_id].append(row)
    with effective_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "card_id",
                "player_id",
                "tournament_id",
                "nation_id",
                "matched_name",
                "effective_final_rating",
                "effective_rule",
                "source_lines",
                "source_player_names",
                "source_final_ratings",
            ],
        )
        writer.writeheader()
        for card_id in sorted(effective):
            row = effective[card_id]
            source_rows = sorted(matched_by_card[card_id], key=lambda r: r.source_line)
            writer.writerow(
                {
                    "card_id": card_id,
                    "player_id": row.player_id,
                    "tournament_id": row.tournament_id,
                    "nation_id": row.nation_id,
                    "matched_name": row.matched_name,
                    "effective_final_rating": row.final_rating,
                    "effective_rule": row.rule,
                    "source_lines": ";".join(str(r.source_line) for r in source_rows),
                    "source_player_names": ";".join(r.player_name for r in source_rows),
                    "source_final_ratings": ";".join(str(r.final_rating) for r in source_rows),
                }
            )

    summary = {
        "canonical_duplicate_avg_cards": sum(
            1 for row in effective.values() if row.match_method == "canonical_duplicate_avg"
        ),
        "effective_cards": len(effective),
        "source": str(OVERRIDE_PATH.relative_to(ETL_DIR)),
        "sha256": resolution.csv_sha256,
        "rows": len(resolution.rows),
        "matched": len(resolution.matched),
        "unmatched": len(resolution.unmatched),
        "match_rate": round(resolution.match_rate, 6),
        "rule_counts": resolution.rule_counts,
    }
    (output_dir / "manual-ratings-v4.3-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return resolution


def _rule_bucket(rule: str) -> str:
    if rule.startswith("avg"):
        return "avg"
    if rule.startswith("f1-only"):
        return "f1-only"
    if rule.startswith("f2-only"):
        return "f2-only"
    return rule


def _looks_like_source_hint(player_name: str) -> bool:
    normalized = norm_with_separators(player_name)
    tokens = normalized.split()
    if not tokens:
        return True
    if tokens[0] in {"likely", "strong"}:
        return True
    hint_phrases = {
        "center back",
        "centre back",
        "left back",
        "right back",
        "striker",
    }
    return normalized in hint_phrases or normalized.endswith(" striker")


def _unmatched(
    row: OverrideRow,
    reason: str,
    *,
    candidate_card_ids: tuple[str, ...] = (),
    candidate_names: tuple[str, ...] = (),
) -> UnmatchedOverride:
    return UnmatchedOverride(
        source_line=row.source_line,
        country=row.country,
        year=row.year,
        player_name=row.player_name,
        final_rating=row.final_rating,
        rule=row.rule,
        current_baseline=row.current_baseline,
        reason=reason,
        candidate_card_ids=candidate_card_ids,
        candidate_names=candidate_names,
    )


def _drop_conflicting_weak_duplicates(
    matched: list[ResolvedOverride],
    unmatched: list[UnmatchedOverride],
) -> tuple[list[ResolvedOverride], list[UnmatchedOverride]]:
    by_card: dict[str, list[ResolvedOverride]] = defaultdict(list)
    for row in matched:
        by_card[row.card_id].append(row)

    drop_lines: set[int] = set()
    for _card_id, rows in by_card.items():
        if len({row.final_rating for row in rows}) <= 1:
            continue
        strong = [row for row in rows if not _is_weak_match(row.match_method)]
        if len(strong) == 1:
            chosen = strong[0]
            for row in rows:
                if row.source_line == chosen.source_line or row.final_rating == chosen.final_rating:
                    continue
                drop_lines.add(row.source_line)
                unmatched.append(_unmatched_from_resolved(row, "duplicate_conflict_weaker_match"))
            continue
        if not strong:
            for row in rows:
                drop_lines.add(row.source_line)
                unmatched.append(_unmatched_from_resolved(row, "duplicate_conflict_weak_only"))
            continue

    if not drop_lines:
        return matched, unmatched
    return [row for row in matched if row.source_line not in drop_lines], unmatched


def _is_weak_match(method: str) -> bool:
    return method.startswith("distinctive_single:")


def _round_half_up(value: float) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _unmatched_from_resolved(row: ResolvedOverride, reason: str) -> UnmatchedOverride:
    return UnmatchedOverride(
        source_line=row.source_line,
        country=row.country,
        year=row.year,
        player_name=row.player_name,
        final_rating=row.final_rating,
        rule=row.rule,
        current_baseline=row.current_baseline,
        reason=reason,
        candidate_card_ids=(row.card_id,),
        candidate_names=(row.matched_name,),
    )


def _load_json(output_dir: Path, name: str) -> list[dict]:
    path = output_dir / f"{name}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _build_resolution_index(
    output_dir: Path,
) -> tuple[dict[tuple[str, int], tuple[_Candidate, ...]], dict[str, frozenset[str]]]:
    nations = _load_json(output_dir, "nations") + _load_json(output_dir, "nations_2026")
    players = _load_json(output_dir, "players") + _load_json(output_dir, "players_2026")
    cards = _load_json(output_dir, "player_tournaments") + _load_json(
        output_dir, "player_tournaments_2026"
    )

    nation_ids_by_name: dict[str, set[str]] = defaultdict(set)
    canonical_by_name: dict[str, str] = {}
    for nation in nations:
        canonical_by_name.setdefault(norm(nation["canonical_name"]), nation["nation_id"])
        for name in (nation["canonical_name"], *nation.get("aliases", [])):
            key = norm(name)
            if key:
                nation_ids_by_name[key].add(nation["nation_id"])
    for alias, canonical_names in _NATION_ALIASES.items():
        for canonical in canonical_names:
            nation_id = canonical_by_name.get(norm(canonical))
            if nation_id:
                nation_ids_by_name[alias].add(nation_id)

    players_by_id = {p["player_id"]: p for p in players}
    aliases = _player_aliases(output_dir)
    candidates_by_block: dict[tuple[str, int], list[_Candidate]] = defaultdict(list)
    for card in cards:
        tournament_id = card["tournament_id"]
        match = re.fullmatch(r"WC-(\d{4})", tournament_id)
        if not match:
            continue
        year = int(match.group(1))
        if year not in _TARGET_YEARS:
            continue
        player = players_by_id.get(card["player_id"])
        if player is None:
            continue
        candidate = _candidate_from_card(card, player, aliases.get(card["player_id"], ()))
        candidates_by_block[(card["nation_id"], year)].append(candidate)

    return (
        {k: tuple(v) for k, v in candidates_by_block.items()},
        {k: frozenset(v) for k, v in nation_ids_by_name.items()},
    )


def _player_aliases(output_dir: Path) -> dict[str, tuple[str, ...]]:
    aliases: dict[str, set[str]] = defaultdict(set)
    facts_path = output_dir / "merit" / "source_facts.json"
    if facts_path.exists():
        facts = json.loads(facts_path.read_text(encoding="utf-8"))
        for fact in facts.get("facts", ()):
            player_id = fact.get("player_id")
            if not player_id:
                continue
            for key in ("player_name", "raw_name"):
                value = fact.get(key)
                if not value:
                    continue
                aliases[player_id].add(html.unescape(value))
                for quoted in re.findall(r'"([^"]+)"', value):
                    aliases[player_id].add(html.unescape(quoted))

    recon_path = (
        output_dir.parent
        / "merit"
        / "external_review"
        / "recon"
        / "player_career_strength_ratings_v1_1.csv"
    )
    if recon_path.exists():
        with recon_path.open(encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                if row.get("player_id") and row.get("player_name"):
                    aliases[row["player_id"]].add(html.unescape(row["player_name"]))
    return {player_id: tuple(sorted(names)) for player_id, names in aliases.items()}


def _candidate_from_card(card: dict, player: dict, aliases: Iterable[str]) -> _Candidate:
    weighted: list[tuple[str, int, str]] = []
    for field, priority in (("common_name", 8), ("full_name", 7)):
        if player.get(field):
            weighted.append((player[field], priority, field))
    given = player.get("given_name")
    family = player.get("family_name")
    if given and family:
        weighted.append((f"{given} {family}", 6, "given_family"))
        weighted.append((f"{family} {given}", 6, "family_given"))
    for field, priority in (("family_name", 3), ("given_name", 2)):
        if player.get(field):
            weighted.append((player[field], priority, field))
    for alias in aliases:
        weighted.append((alias, 7, "repo_alias"))

    names: list[_CandidateName] = []
    all_tokens: set[str] = set()
    fallback_tokens: set[str] = set()
    seen: set[tuple[str, str]] = set()
    for name, priority, field in weighted:
        key = norm(name)
        tokens = _significant_tokens(name)
        if not key and not tokens:
            continue
        dedupe = (key, field)
        if dedupe in seen:
            continue
        seen.add(dedupe)
        names.append(
            _CandidateName(
                name=name,
                field=field,
                priority=priority,
                key=key,
                tokens=tokens,
            )
        )
        all_tokens.update(tokens)
        if field in {"common_name", "family_name"}:
            fallback_tokens.update(tokens)

    display = player.get("common_name") or player.get("full_name") or card["player_id"]
    return _Candidate(
        card_id=card["card_id"],
        player_id=card["player_id"],
        tournament_id=card["tournament_id"],
        nation_id=card["nation_id"],
        display_name=display,
        names=tuple(names),
        all_tokens=frozenset(all_tokens),
        fallback_tokens=frozenset(fallback_tokens),
    )


def _resolve_nation_ids(
    country: str, nation_ids_by_name: dict[str, frozenset[str]]
) -> frozenset[str]:
    key = norm(country)
    if key in nation_ids_by_name:
        return nation_ids_by_name[key]
    if key in _NATION_ALIASES:
        out: set[str] = set()
        for alias in _NATION_ALIASES[key]:
            out.update(nation_ids_by_name.get(norm(alias), ()))
        return frozenset(out)
    return frozenset()


def _resolve_player(player_name: str, block: list[_Candidate]) -> _Score | list[_Score] | None:
    row_tokens = _significant_tokens(player_name)
    scored: list[_Score] = []
    for candidate in block:
        score = _score_candidate(player_name, row_tokens, candidate)
        if score is not None:
            scored.append(score)

    if scored:
        scored.sort(key=lambda s: s.value, reverse=True)
        top = scored[0]
        tied = [s for s in scored if abs(s.value - top.value) < 1e-9]
        if len(tied) == 1 and (
            len(scored) == 1 or top.value - scored[1].value >= 3.0 or top.value >= 100
        ):
            return top
        return scored

    distinctive = _distinctive_token_fallback(row_tokens, block)
    if distinctive is not None:
        return distinctive
    return None


def _score_candidate(
    player_name: str,
    row_tokens: tuple[str, ...],
    candidate: _Candidate,
) -> _Score | None:
    row_key = norm(player_name)
    row_set = set(row_tokens)
    best: _Score | None = None
    for name in candidate.names:
        score = 0.0
        method = ""
        if row_key and row_key == name.key:
            score = 100.0 + name.priority
            method = f"exact:{name.field}"
        elif row_set and name.tokens:
            total, exact, fuzzy, initials = _token_match_total(row_tokens, name.tokens)
            row_coverage = total / max(len(row_tokens), 1)
            candidate_coverage = total / max(len(name.tokens), 1)
            if (
                len(row_tokens) >= 2
                and len(name.tokens) >= 2
                and row_coverage >= 0.72
                and candidate_coverage >= 0.55
                and total >= 1.72
            ):
                score = 60.0 + total * 7.0 + name.priority + exact * 3.0 - initials * 0.5
                method = (
                    f"token:{name.field}:total={total:.2f}:"
                    f"exact={exact}:fuzzy={fuzzy}:initial={initials}"
                )
            elif (
                len(row_tokens) == 1
                and len(name.tokens) == 1
                and total == 1.0
                and name.field in {"common_name", "full_name", "repo_alias"}
            ):
                score = 50.0 + name.priority
                method = f"mononym:{name.field}"
        if score:
            current = _Score(score, method, candidate)
            if best is None or current.value > best.value:
                best = current
    return best


def _distinctive_token_fallback(
    row_tokens: tuple[str, ...],
    block: list[_Candidate],
) -> _Score | None:
    meaningful = [token for token in row_tokens if len(token) >= 4]
    if not meaningful:
        return None
    scores: list[_Score] = []
    for candidate in block:
        matched_tokens = [
            token
            for token in meaningful
            if any(
                _token_match(token, cand_token) >= 0.82
                for cand_token in candidate.fallback_tokens
            )
        ]
        if len(matched_tokens) >= 2:
            scores.append(
                _Score(
                    50.0 + len(matched_tokens) * 3.0,
                    "distinctive_multi:" + ",".join(matched_tokens),
                    candidate,
                )
            )
        elif len(matched_tokens) == 1:
            scores.append(
                _Score(44.0, "distinctive_single:" + matched_tokens[0], candidate)
            )
    return scores[0] if len(scores) == 1 else None


def _token_match_total(
    row_tokens: tuple[str, ...],
    candidate_tokens: tuple[str, ...],
) -> tuple[float, int, int, int]:
    used: set[int] = set()
    total = 0.0
    exact = 0
    fuzzy = 0
    initials = 0
    for row_token in row_tokens:
        best_index: int | None = None
        best_value = 0.0
        for index, candidate_token in enumerate(candidate_tokens):
            if index in used:
                continue
            value = _token_match(row_token, candidate_token)
            if value > best_value:
                best_index = index
                best_value = value
        if best_index is None or best_value <= 0.0:
            continue
        used.add(best_index)
        total += best_value
        if best_value == 1.0:
            exact += 1
        elif best_value == 0.72:
            initials += 1
        else:
            fuzzy += 1
    return total, exact, fuzzy, initials


def _token_match(left: str, right: str) -> float:
    if left == right:
        return 1.0
    if len(left) == 1 and len(right) >= 3 and left[0] == right[0]:
        return 0.72
    if _close_token(left, right):
        return 0.82
    return 0.0


def _close_token(left: str, right: str) -> bool:
    if len(left) < 4 or len(right) < 4:
        return False
    if left[0] != right[0]:
        return False
    if abs(len(left) - len(right)) > 2:
        return False
    return difflib.SequenceMatcher(None, left, right).ratio() >= 0.82


def _significant_tokens(value: str) -> tuple[str, ...]:
    raw_tokens = re.split(r"[^a-z0-9]+", norm_with_separators(value))
    return tuple(
        token
        for token in raw_tokens
        if token and token not in _GENERIC_NAME_TOKENS and len(token) > 1
    )


def norm_with_separators(value: str | None) -> str:
    text = html.unescape(value or "")
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-zA-Z0-9]+", " ", stripped).lower()


if __name__ == "__main__":
    result = write_resolution_artifacts()
    print(
        "manual ratings v4.3: "
        f"{len(result.matched):,}/{len(result.rows):,} matched "
        f"({result.match_rate:.2%}); {len(result.unmatched):,} unmatched"
    )
