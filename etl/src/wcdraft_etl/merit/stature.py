"""MERIT-V2 MV2-3 — deterministic per-player career-stature composite (v2).

Reads the committed v2 linked-fact file (``etl/output/merit/source_facts.json`` —
the full ``merit-source-set-2.2.0`` set: WC legacy + global/regional annual
recognition + position-balanced selections + international records + retrospective
all-time selections + captaincy) and the canonical men's World Cup years, and emits
one career-stature row per linked ``player_id``:

    etl/output/career_stature.json               the per-player composite table
    etl/output/merit/CAREER_STATURE.md            the human-readable build report
    etl/output/merit/career_stature_review.json   rows held below the material gate

This table is the ONLY place career aggregates live. ``rating.py`` (MV2-4) consumes
``career_stature.json`` keyed by ``player_id`` and is the only downstream reader.

WHAT CHANGED FROM career-stature-1.0.0 (MV2-3):

  * The v1 table scored ONLY the v1 source subset through a v1 family relabel
    (``_v1_facts``) so MV2-1/MV2-2 could broaden ``source_facts.json`` without
    moving any rating. That isolation is REMOVED. The v2 table scores the FULL
    ``source_facts.json`` over the v2 position-balanced family taxonomy.
  * Two distinct numbers are emitted (the load-bearing distinction):
      - ``career_stature_score`` — the transparent saturating factual composite
        (per-family ``1 − Π(1 − strength)``; cross-family ``1 − Π(1 − w[f]·fs[f])``).
        It is structurally compressed: even the all-time peak tops out near ~0.67.
      - ``career_stature_index`` — a global, monotonic, documented re-spread of the
        score onto [0, 1] that corrects that compression so the recognized-greats
        cohort lands near the top and the material distribution is not clumped.
        The rating stage consumes the INDEX, never the raw score.
  * Position-balanced family weights: attacker-heavy annual awards CANNOT be the
    only route to high stature. Defenders / goalkeepers / midfielders reach high
    stature via all-time XI / dream-team / positional / repeated world-XI /
    captaincy facts (the defender/GK repair the v1 striker-biased set could not do).
  * ``stature_tier`` ∈ {bronze, silver, gold} — index quantiles WITHIN the material
    cohort; consumed only by the rating stage's per-pos tournament down-cap table.
  * A factual ``legend`` boolean + ``legend_reason_codes`` (closed set) is derived
    from the SOURCE FACTS alone — it never inspects ``overall`` or any rating
    channel. It replaces the UI's old ``overall >= 96`` heuristic (MV2-7 switches
    the badge). Threshold = the tightened, Paulo-approved (2026-06-08) routes
    (see ``_legend_reason_codes``).

INVARIANT LINE (mirrors the E-4.1 intake and the RSSSF supplement):

  * Pure + offline: a re-run over the committed ``source_facts.json`` reproduces
    byte-identical outputs. No network, no clock, no randomness.
  * Missing coverage is coverage. A player absent from a source contributes no fact
    and is never scored a zero AGAINST themselves — the absent family is simply
    dropped from that player's denominator, surfaced as ``coverage`` < 1.0.
  * No per-player override. Every score, index, tier and legend flag is the same
    era-weighted saturating product / global transform / factual route applied to
    every player; there is no name-keyed table anywhere.
  * The composite assigns NO rating. It is the merit BASE that MV2-4 turns into a
    stature target; this module emits no ``overall`` and touches no engine constant.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .. import identity_2026
from . import (
    ACTIVE_CUTOFF_DATE,
    ACTIVE_SOURCE_SET_VERSION,
    ERA_BUCKETS,
    SOURCE_SET_VERSION,
    VERSION,
    era_bucket,
)
from .paths import OUTPUT_DIR
from .stature_inputs import load_build_inputs
from .stature_reports import (  # noqa: F401 - report checklists remain part of stature.py's test surface
    _DEF_GK_CHECK,
    _GREATS,
    _render_report,
    _write_json,
)
from .stature_scoring import (  # noqa: F401 - private helpers/constants remain part of stature.py's test surface
    _ACTIVE_STAGE_FULL_AGE,
    _ACTIVE_STAGE_MIN_FRACTION,
    _ACTIVE_STAGE_START_AGE,
    _LEGEND_REASON_CODES,
    _PRECISION,
    _V2_FAMILY_KEYS,
    ERA_FAMILY_WEIGHTS,
    GOLD_FLOOR_INDEX,
    INDEX_CONTROL_POINTS,
    LEGEND_INDEX_FLOOR,
    MATERIAL_MIN_COVERAGE,
    MATERIAL_MIN_INDEX,
    REVIEW_COVERAGE_THRESHOLD,
    SINGLE_FAMILY_INDEX_CAP,
    SPARSE_FACT_CONFIDENCE_DENOMINATOR,
    SPARSE_FACT_COUNT_THRESHOLD,
    SPARSE_FAMILY_COUNT_THRESHOLD,
    TIER_GOLD_QUANTILE,
    TIER_SILVER_QUANTILE,
    _clamp01,
    _fact_strength,
    _index_of,
    _legend_aggregates,
    _legend_reason_codes,
    _pre_1967_retrospective_consensus,
    _saturate,
)
from .text import norm

# career_stature.json lives next to the canonical tables (the rating stage reads it
# from there), NOT under merit/output — it is a first-class ETL artifact.
_CANON_DIR = Path(__file__).resolve().parents[3] / "output"
CAREER_STATURE_PATH = _CANON_DIR / "career_stature.json"



# ─── canonical men's WC years (peak year) ─────────────────────────────────────


def _mens_wc_years(cards: list[dict], tournaments: list[dict]) -> dict[str, list[int]]:
    """player_id -> sorted list of the men's World Cup years they have a card in."""
    year_of = {t["tournament_id"]: t["year"] for t in tournaments if not t.get("womens")}
    years: dict[str, list[int]] = {}
    for c in cards:
        y = year_of.get(c["tournament_id"])
        if y is None:
            continue
        years.setdefault(c["player_id"], []).append(int(y))
    for pid in years:
        years[pid].sort()
    return years


def _career_peak_year(years: list[int]) -> int | None:
    """Lower-median men's WC year — deterministic, no inference of unobserved
    club-career peaks."""
    if not years:
        return None
    return years[(len(years) - 1) // 2]


def _modal_position(facts: list[dict]) -> str | None:
    """Most-frequent stated fact position (GK/DF/MF/FW) — REPORT-ONLY (the rating
    stage weights on the card position, not this). Ties broken by GK<DF<MF<FW."""
    counts: dict[str, int] = {}
    for f in facts:
        p = f.get("position")
        if p:
            counts[p] = counts.get(p, 0) + 1
    if not counts:
        return None
    order = {"GK": 0, "DF": 1, "MF": 2, "FW": 3}
    return min(counts, key=lambda p: (-counts[p], order.get(p, 9)))


@dataclass(frozen=True)
class _ScoringContext:
    resolver: _PersonIdentityResolver
    birth_year: dict[str, int | None]
    confederations: dict[str, set[str]]


class _PersonIdentityResolver:
    """Resolve historical and 2026 ids onto one person key.

    The 2026 ingest's real links are consumed first because linked cards already
    carry the historical ``P-*`` id. The explicit bridge table is second and only
    applies to still-minted natural keys. Ambiguity is not guessed here.
    """

    def __init__(self, players: list[dict], players_2026: list[dict], cards_2026: list[dict]):
        self._alias_to_person: dict[str, str] = {}
        self._alias_method: dict[str, str] = {}
        self._aliases_by_person: dict[str, set[str]] = defaultdict(set)
        self._historical_ids = {p["player_id"] for p in players}
        for pid in self._historical_ids:
            self._set_alias(pid, pid, "historical")
        players_2026_by_id = {p["player_id"]: p for p in players_2026}
        for c in cards_2026:
            pid = c["player_id"]
            status = c.get("link_status")
            if status == "linked":
                if pid not in self._historical_ids:
                    raise ValueError(f"linked 2026 card points at unknown historical id {pid}")
                self._set_alias(pid, pid, "u0_link")
                continue
            if status != "minted":
                raise ValueError(f"2026 card {c['card_id']} has bad link_status {status!r}")
            p = players_2026_by_id.get(pid)
            if p is None:
                raise ValueError(f"minted 2026 card {c['card_id']} has no players_2026 row")
            bridge_pid = self._bridge_target(p, c["nation_id"])
            if bridge_pid is not None:
                self._set_alias(pid, bridge_pid, "identity_bridge")
            else:
                self._set_alias(pid, pid, "minted")

    def _set_alias(self, alias: str, person: str, method: str) -> None:
        prior = self._alias_to_person.get(alias)
        if prior is not None and prior != person:
            raise ValueError(f"identity alias {alias} resolves to both {prior} and {person}")
        self._alias_to_person[alias] = person
        self._alias_method[alias] = method
        self._aliases_by_person[person].add(alias)

    def _bridge_target(self, p: dict, nation_id: str) -> str | None:
        birth_date = p.get("birth_date")
        if not birth_date:
            return None
        names = {
            norm(p.get("full_name") or ""),
            norm(p.get("common_name") or ""),
            norm(p.get("family_name") or ""),
        }
        full = p.get("full_name") or ""
        if full:
            names.add(norm(full.split()[-1]))
        for n in names:
            if not n:
                continue
            target = identity_2026.IDENTITY_BRIDGES.get((nation_id, birth_date, n))
            if target is None:
                continue
            if target not in self._historical_ids:
                raise ValueError(f"identity bridge for {p['player_id']} targets unknown {target}")
            return target
        return None

    def resolve(self, player_id: str) -> str:
        return self._alias_to_person.get(player_id, player_id)

    def aliases_for(self, person_id: str) -> list[str]:
        return sorted(self._aliases_by_person.get(person_id, {person_id}))

    def methods_for(self, aliases: list[str]) -> list[str]:
        return sorted({self._alias_method.get(a, "source_fact") for a in aliases})


def _birth_years(
    players: list[dict],
    players_2026: list[dict],
    cards_2026: list[dict],
    resolver: _PersonIdentityResolver,
) -> dict[str, int | None]:
    years: dict[str, int | None] = {}

    def add(pid: str, birth_date: str | None) -> None:
        person = resolver.resolve(pid)
        year = int(birth_date[:4]) if birth_date and birth_date[:4].isdigit() else None
        if years.get(person) is None and year is not None:
            years[person] = year
        else:
            years.setdefault(person, year)

    for p in players:
        add(p["player_id"], p.get("birth_date"))
    for p in players_2026:
        add(p["player_id"], p.get("birth_date"))
    for c in cards_2026:
        add(c["player_id"], c.get("birth_date"))
    return years


def _player_confederations(
    cards: list[dict],
    cards_2026: list[dict],
    nations: list[dict],
    nations_2026: list[dict],
    resolver: _PersonIdentityResolver,
) -> dict[str, set[str]]:
    confed_of = {n["nation_id"]: n.get("confederation") for n in (*nations, *nations_2026)}
    out: dict[str, set[str]] = defaultdict(set)
    for c in (*cards, *cards_2026):
        confed = confed_of.get(c["nation_id"])
        if confed:
            out[resolver.resolve(c["player_id"])].add(confed)
    return out


def _build_context(
    players: list[dict],
    players_2026: list[dict],
    cards: list[dict],
    cards_2026: list[dict],
    nations: list[dict],
    nations_2026: list[dict],
) -> _ScoringContext:
    resolver = _PersonIdentityResolver(players, players_2026, cards_2026)
    return _ScoringContext(
        resolver=resolver,
        birth_year=_birth_years(players, players_2026, cards_2026, resolver),
        confederations=_player_confederations(cards, cards_2026, nations, nations_2026, resolver),
    )


def _active_stage_fraction(person_id: str, ctx: _ScoringContext | None) -> float:
    if ctx is None:
        return 1.0
    born = ctx.birth_year.get(person_id)
    if born is None:
        return 1.0
    cutoff_year = int(ACTIVE_CUTOFF_DATE[:4])
    age = cutoff_year - born
    raw = (age - _ACTIVE_STAGE_START_AGE) / (_ACTIVE_STAGE_FULL_AGE - _ACTIVE_STAGE_START_AGE)
    return max(_ACTIVE_STAGE_MIN_FRACTION, min(1.0, raw))


def _stage_normalized_family_score(
    person_id: str, facts: list[dict], completed_score: float, ctx: _ScoringContext | None
) -> tuple[float, float | None]:
    active = [f for f in facts if f.get("active_source_set_version")]
    if not active or not any(f.get("year") is not None for f in active):
        return completed_score, None
    fraction = _active_stage_fraction(person_id, ctx)
    return min(1.0, completed_score / fraction), round(fraction, _PRECISION)


def _eligible_family_weights(
    person_id: str,
    era: str,
    family_scores: dict[str, float],
    ctx: _ScoringContext | None,
) -> tuple[dict[str, float], list[str]]:
    base = ERA_FAMILY_WEIGHTS[era]
    eligible = {fam: w for fam, w in base.items() if w > 0.0}
    removed: list[str] = []
    if "club_honors" in eligible and not family_scores.get("club_honors"):
        eligible.pop("club_honors")
    # Pre-1995 Ballon d'Or was not open to non-European players. The global family
    # also contains open global lists; only remove it when the player has no global
    # facts and their World Cup nations are outside UEFA.
    if (
        era != "1991_plus"
        and "global_annual_recognition" in eligible
        and not family_scores.get("global_annual_recognition")
        and ctx is not None
        and "UEFA" not in ctx.confederations.get(person_id, set())
    ):
        eligible.pop("global_annual_recognition")
        removed.append("global_annual_recognition:pre_1995_ballondor_ineligible")
    total = sum(eligible.values())
    if total <= 0.0:
        return {fam: 0.0 for fam in _V2_FAMILY_KEYS}, removed
    normalized = {fam: round(eligible.get(fam, 0.0) / total, _PRECISION) for fam in _V2_FAMILY_KEYS}
    remainder = round(1.0 - sum(normalized.values()), _PRECISION)
    if remainder:
        positives = [fam for fam in _V2_FAMILY_KEYS if normalized[fam] > 0.0]
        anchor = max(positives, key=lambda fam: (normalized[fam], -_V2_FAMILY_KEYS.index(fam)))
        normalized[anchor] = round(normalized[anchor] + remainder, _PRECISION)
    return normalized, removed


def _apply_index_bias_controls(
    index: float, family_scores: dict[str, float], fact_count: int
) -> tuple[float, list[str]]:
    adjusted = index
    flags: list[str] = []
    material_family_count = sum(1 for v in family_scores.values() if (v or 0.0) > 0.0)
    if material_family_count <= 1 and adjusted > SINGLE_FAMILY_INDEX_CAP:
        adjusted = SINGLE_FAMILY_INDEX_CAP
        flags.append("single_family_index_saturation")
    if adjusted > GOLD_FLOOR_INDEX and (
        fact_count < SPARSE_FACT_COUNT_THRESHOLD
        or material_family_count < SPARSE_FAMILY_COUNT_THRESHOLD
    ):
        confidence = min(
            1.0,
            max(
                0.0,
                min(
                    fact_count / SPARSE_FACT_CONFIDENCE_DENOMINATOR,
                    material_family_count / SPARSE_FAMILY_COUNT_THRESHOLD,
                ),
            ),
        )
        adjusted = GOLD_FLOOR_INDEX + (adjusted - GOLD_FLOOR_INDEX) * confidence
        flags.append("sparse_fact_count_shrinkage")
    return round(adjusted, _PRECISION), flags


def _merge_active_channel(
    source_facts: dict,
    active_facts: dict,
    active_staging: dict,
    mens_years: dict[str, list[int]],
    ctx: _ScoringContext,
) -> tuple[dict, dict]:
    if active_facts.get("version") != ACTIVE_SOURCE_SET_VERSION:
        raise ValueError(
            f"active fact version {active_facts.get('version')!r} != {ACTIVE_SOURCE_SET_VERSION!r}"
        )
    if active_staging.get("version") != ACTIVE_SOURCE_SET_VERSION:
        raise ValueError(
            f"active staging version {active_staging.get('version')!r} != "
            f"{ACTIVE_SOURCE_SET_VERSION!r}"
        )
    unresolved_bridges = active_staging.get("identity_bridge_review") or []
    if unresolved_bridges:
        preview = ", ".join(
            f"{b.get('minted_player_id')}->{b.get('historical_player_id')}"
            for b in unresolved_bridges[:5]
        )
        raise ValueError(
            "active staging has unresolved identity bridges; promote/merge before "
            f"career-stature scoring: {preview}"
        )
    active_pids = {f["player_id"] for f in active_facts["facts"]}
    staged_pids = {e["player_id"] for e in active_staging["entries"]}
    if active_pids != staged_pids:
        raise ValueError("active source facts and active staging entries disagree")

    merged: list[dict] = []
    active_persons: set[str] = set()
    alias_pairs: dict[str, set[str]] = defaultdict(set)

    def add_fact(f: dict, active_source_set_version: str | None) -> None:
        original = f["player_id"]
        person = ctx.resolver.resolve(original)
        nf = dict(f)
        nf["source_player_id"] = original
        nf["player_id"] = person
        nf["person_id"] = person
        if active_source_set_version is not None:
            nf["active_source_set_version"] = active_source_set_version
            nf.setdefault("era", era_bucket((mens_years.get(person) or [2026])[0]))
            active_persons.add(person)
        alias_pairs[person].add(original)
        merged.append(nf)

    for f in source_facts["facts"]:
        add_fact(f, None)
    for f in active_facts["facts"]:
        add_fact(f, active_facts["version"])

    merged_doc = {
        "version": source_facts.get("version"),
        "active_source_set_version": active_facts["version"],
        "fact_count": len(merged),
        "linked_player_count": len({f["person_id"] for f in merged}),
        "facts": merged,
    }
    meta = {
        "active_fact_count": len(active_facts["facts"]),
        "active_person_count": len(active_persons),
        "active_person_ids": sorted(active_persons),
        "resolved_aliases": {p: sorted(a) for p, a in sorted(alias_pairs.items()) if len(a) > 1},
    }
    return merged_doc, meta


# ─── row build ────────────────────────────────────────────────────────────────


def _build_player_rows(
    source_facts: dict,
    mens_years: dict[str, list[int]],
    ctx: _ScoringContext | None = None,
) -> list[dict]:
    """Build the per-player rows WITHOUT tier (tier needs the whole cohort). Pure."""
    by_player: dict[str, list[dict]] = {}
    for f in source_facts["facts"]:
        pid = f.get("person_id") or (
            ctx.resolver.resolve(f["player_id"]) if ctx else f["player_id"]
        )
        nf = dict(f)
        nf["player_id"] = pid
        nf["person_id"] = pid
        nf.setdefault("source_player_id", f["player_id"])
        by_player.setdefault(pid, []).append(nf)

    rows: list[dict] = []
    for pid in sorted(by_player):
        pfacts = by_player[pid]
        # Every fact for a player carries the same player-era (derived from the
        # player's earliest WC); assert it so a mislabeled fact fails loud.
        eras = {f["era"] for f in pfacts}
        if len(eras) != 1:
            raise ValueError(f"player {pid} has conflicting fact eras {eras}")
        era = next(iter(eras))
        if era not in ERA_BUCKETS:
            raise ValueError(f"player {pid} has unknown era {era!r}")

        # Per-family saturating fold over that family's facts.
        family_facts: dict[str, list[dict]] = {}
        for f in pfacts:
            fam = f["family"]
            if fam not in _V2_FAMILY_KEYS:
                raise ValueError(f"player {pid} fact in unknown family {fam!r}")
            family_facts.setdefault(fam, []).append(f)
        family_scores: dict[str, float] = {}
        stage_factors: dict[str, float | None] = {}
        for fam, ff in family_facts.items():
            completed = round(_saturate([_fact_strength(f) for f in ff]), _PRECISION)
            normalized, stage_factor = _stage_normalized_family_score(pid, ff, completed, ctx)
            family_scores[fam] = round(normalized, _PRECISION)
            stage_factors[fam] = stage_factor

        weights, eligibility_adjustments = _eligible_family_weights(pid, era, family_scores, ctx)

        # Eligibility-weighted saturating combine across the available families.
        active = [fam for fam in _V2_FAMILY_KEYS if weights.get(fam, 0.0) > 0.0]
        acc = 1.0
        for fam in active:
            acc *= 1.0 - weights[fam] * family_scores.get(fam, 0.0)
        career_score = round(1.0 - acc, _PRECISION)
        raw_index = round(_index_of(career_score), _PRECISION)
        career_index, index_adjustments = _apply_index_bias_controls(
            raw_index, family_scores, len(pfacts)
        )

        # Coverage: fraction of eligible family weight that has a positive fact.
        total_w = sum(weights[fam] for fam in active)
        present_w = sum(weights[fam] for fam in active if family_scores.get(fam, 0.0) > 0.0)
        coverage_denominator = total_w
        active_stage_values = [v for v in stage_factors.values() if v is not None]
        if active_stage_values:
            coverage_denominator *= min(active_stage_values)
        coverage = (
            round(min(1.0, present_w / coverage_denominator), _PRECISION)
            if coverage_denominator > 0
            else 0.0
        )

        peak_year = _career_peak_year(mens_years.get(pid, []))
        legend_codes = _legend_reason_codes(pfacts, career_index, peak_year)
        source_refs = sorted({f"{f['source_id']}:{f['detail']}" for f in pfacts})
        aliases = ctx.resolver.aliases_for(pid) if ctx else [pid]
        source_player_ids = sorted({f.get("source_player_id", pid) for f in pfacts})
        active_count = sum(1 for f in pfacts if f.get("active_source_set_version"))

        rows.append(
            {
                "player_id": pid,
                "person_id": pid,
                "resolved_player_ids": sorted(set(aliases) | set(source_player_ids)),
                "person_resolution_methods": (
                    ctx.resolver.methods_for(aliases) if ctx else ["historical"]
                ),
                "stature_version": VERSION,
                "source_set_version": SOURCE_SET_VERSION,
                "active_source_set_version": (ACTIVE_SOURCE_SET_VERSION if active_count else None),
                "career_stature_score": career_score,
                "career_stature_index_raw": raw_index,
                "career_stature_index": career_index,
                "coverage": coverage,
                "era_bucket": era,
                "career_peak_year": peak_year,
                "modal_position": _modal_position(pfacts),
                "family_scores": {fam: family_scores.get(fam, None) for fam in _V2_FAMILY_KEYS},
                "family_weights": {fam: weights.get(fam, 0.0) for fam in _V2_FAMILY_KEYS},
                "family_weight_adjustments": eligibility_adjustments,
                "active_stage_factors": {
                    fam: stage_factors.get(fam)
                    for fam in _V2_FAMILY_KEYS
                    if stage_factors.get(fam) is not None
                },
                "stature_tier": None,  # filled by _assign_tiers over the full cohort
                "legend": bool(legend_codes),
                "legend_reason_codes": legend_codes,
                "fact_count": len(pfacts),
                "active_fact_count": active_count,
                "index_adjustments": index_adjustments,
                "review_flags": _review_flags(coverage, career_index, family_scores),
                "source_refs": source_refs,
            }
        )
    return rows


def _is_material(row: dict) -> bool:
    return (
        row["coverage"] >= MATERIAL_MIN_COVERAGE
        and row["career_stature_index"] >= MATERIAL_MIN_INDEX
    )


def _quantile(sorted_values: list[float], q: float) -> float:
    n = len(sorted_values)
    if n == 0:
        raise ValueError("_quantile called on empty list")
    if n == 1:
        return float(sorted_values[0])
    pos = (n - 1) * q
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return float(sorted_values[lo]) * (1.0 - frac) + float(sorted_values[hi]) * frac


def _assign_tiers(rows: list[dict]) -> dict[str, float | None]:
    """Assign stature_tier in place over the material cohort by index quantiles.
    Returns the (deterministic) gold/silver cut thresholds for the table meta."""
    material_idx = sorted(r["career_stature_index"] for r in rows if _is_material(r))
    if not material_idx:
        return {"gold_min_index": None, "silver_min_index": None}
    gold_cut = round(_quantile(material_idx, TIER_GOLD_QUANTILE), _PRECISION)
    silver_cut = round(_quantile(material_idx, TIER_SILVER_QUANTILE), _PRECISION)
    for r in rows:
        if not _is_material(r):
            r["stature_tier"] = None
            continue
        idx = r["career_stature_index"]
        r["stature_tier"] = (
            "gold" if idx >= gold_cut else "silver" if idx >= silver_cut else "bronze"
        )
    return {"gold_min_index": gold_cut, "silver_min_index": silver_cut}


def build_rows(
    source_facts: dict,
    mens_years: dict[str, list[int]],
    ctx: _ScoringContext | None = None,
) -> tuple[list[dict], dict]:
    """Build the sorted per-player career-stature rows + tier meta (pure)."""
    rows = _build_player_rows(source_facts, mens_years, ctx)
    tier_meta = _assign_tiers(rows)
    return rows, tier_meta


def _review_flags(coverage: float, index: float, family_scores: dict[str, float]) -> list[str]:
    """Non-fatal advisory flags for the review queue (never affect the score)."""
    flags: list[str] = []
    if coverage < MATERIAL_MIN_COVERAGE:
        flags.append("below_material_coverage_gate")
    if index < MATERIAL_MIN_INDEX:
        flags.append("below_material_index_gate")
    if len(family_scores) == 1:
        flags.append("single_family_only")
    return flags


def build(write: bool = True) -> dict:
    # Input loading is centralized in stature_inputs.py; this build stage still
    # consumes source_facts_active.json and career_stature_active_staging.json.
    loaded = load_build_inputs(OUTPUT_DIR, _CANON_DIR)
    source_facts = loaded["source_facts"]
    active_facts = loaded["active_facts"]
    active_staging = loaded["active_staging"]
    players = loaded["players"]
    cards = loaded["cards"]
    tournaments = loaded["tournaments"]
    nations = loaded["nations"]
    players_2026 = loaded["players_2026"]
    cards_2026 = loaded["cards_2026"]
    tournaments_2026 = loaded["tournaments_2026"]
    nations_2026 = loaded["nations_2026"]
    ctx = _build_context(players, players_2026, cards, cards_2026, nations, nations_2026)
    mens_years = _mens_wc_years([*cards, *cards_2026], [*tournaments, *tournaments_2026])
    merged_facts, active_meta = _merge_active_channel(
        source_facts, active_facts, active_staging, mens_years, ctx
    )

    rows, tier_meta = build_rows(merged_facts, mens_years, ctx)
    review = [r for r in rows if r["review_flags"]]
    material = [r for r in rows if _is_material(r)]
    legends = [r for r in rows if r["legend"]]

    table = {
        "version": VERSION,
        "source_set_version": SOURCE_SET_VERSION,
        "active_source_set_version": ACTIVE_SOURCE_SET_VERSION,
        "player_count": len(rows),
        "material_count": len(material),
        "legend_count": len(legends),
        "active_channel": active_meta,
        "index_bias_controls": {
            "gold_floor_index": GOLD_FLOOR_INDEX,
            "single_family_index_cap": SINGLE_FAMILY_INDEX_CAP,
            "sparse_fact_count_threshold": SPARSE_FACT_COUNT_THRESHOLD,
            "sparse_family_count_threshold": SPARSE_FAMILY_COUNT_THRESHOLD,
            "sparse_fact_confidence_denominator": SPARSE_FACT_CONFIDENCE_DENOMINATOR,
        },
        "material_gate": {
            "min_coverage": MATERIAL_MIN_COVERAGE,
            "min_index": MATERIAL_MIN_INDEX,
        },
        "tier_thresholds": tier_meta,
        "career_stature": rows,
    }
    review_doc = {
        "version": VERSION,
        "active_source_set_version": ACTIVE_SOURCE_SET_VERSION,
        "review_count": len(review),
        "coverage_gate": MATERIAL_MIN_COVERAGE,
        "index_gate": MATERIAL_MIN_INDEX,
        "review": review,
    }
    report_md = _render_report(rows, tier_meta)

    if write:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        _write_json(CAREER_STATURE_PATH, table)
        _write_json(OUTPUT_DIR / "career_stature_review.json", review_doc)
        (OUTPUT_DIR / "CAREER_STATURE.md").write_text(report_md, encoding="utf-8")

    return {
        "rows": rows,
        "review": review,
        "table": table,
        "review_doc": review_doc,
        "report_md": report_md,
    }




if __name__ == "__main__":
    out = build(write=True)
    t = out["table"]
    print(f"career stature {VERSION}")
    print(
        f"  players: {t['player_count']}  material: {t['material_count']}  "
        f"legends: {t['legend_count']}"
    )
    print(f"  -> {CAREER_STATURE_PATH}")
    print(f"  -> {OUTPUT_DIR / 'CAREER_STATURE.md'}")
