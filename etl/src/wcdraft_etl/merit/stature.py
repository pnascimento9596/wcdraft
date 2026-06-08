"""ENGINE-V2 E-4.2 — deterministic per-player career-stature composite.

Reads the committed E-4.1 linked-fact file (``etl/output/merit/source_facts.json``)
and the canonical men's World Cup years, and emits one career-stature row per
linked ``player_id``:

    etl/output/career_stature.json          the per-player composite table
    etl/output/merit/CAREER_STATURE.md       the human-readable build report
    etl/output/merit/career_stature_review.json  rows held below the lift gate

This table is the ONLY place career aggregates live. ``rating.py`` (E-4.3) consumes
``career_stature.json`` keyed by ``player_id`` and is the only downstream reader.

INVARIANT LINE (mirrors the E-4.1 intake and the RSSSF supplement):

  * Pure + offline: a re-run over the committed ``source_facts.json`` reproduces
    byte-identical outputs. No network, no clock, no randomness.
  * Missing coverage is coverage. A player absent from a source contributes no fact
    and is never scored a zero AGAINST themselves — the absent family is simply
    dropped from that player's denominator, surfaced as ``coverage`` < 1.0.
  * No per-player override. Every score is the same era-weighted saturating product
    of the same family scorers; there is no name-keyed table anywhere.
  * The composite assigns NO rating. It is the merit BASE that E-4.3 turns into a
    capped lift; this module emits no ``overall`` and touches no engine constant.

COMPOSITE SHAPE (plan docs/plans/merit-rating-model-2026-06-07.md §"Career composite"):

  family_score[f]        = 1 - Π_facts (1 - strength(fact))          # saturating
  career_stature_score   = 1 - Π_families (1 - era_weight[f] · family_score[f])
  coverage               = Σ era_weight[f over present families] / Σ era_weight[f]

Each family folds its own facts via the same saturating product the rating stage
uses for awards (``rating._award_score``). Positive evidence accumulates toward 1.0
and never exceeds it. The era weights gate which families are structurally available
(annual recognition is weight 0 pre-1956, before the first Ballon d'Or), so a
pre-war great is scored only on the signals that could exist for their era.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import ERA_BUCKETS, FAMILY_KEYS, VERSION
from .paths import OUTPUT_DIR

# career_stature.json lives next to the canonical tables (the rating stage reads it
# from there), NOT under merit/output — it is a first-class ETL artifact.
_CANON_DIR = Path(__file__).resolve().parents[3] / "output"
CAREER_STATURE_PATH = _CANON_DIR / "career_stature.json"

# Float rounding so emitted JSON is byte-stable (matches rating._PRECISION).
_PRECISION = 6

# ─── era-bucketed family weights ──────────────────────────────────────────────
# The load-bearing composite shape (plan §"Career composite"). A family weight of
# 0.0 means the family is structurally unavailable for that era and is excluded
# from BOTH the score product and the coverage denominator. ``club_honors`` is
# deferred (E-4b) and weight 0.0 in every era.
ERA_FAMILY_WEIGHTS: dict[str, dict[str, float]] = {
    "pre_1956": {
        "wc_legacy": 0.45,
        "annual_recognition": 0.00,
        "international_record": 0.20,
        "retrospective_selection": 0.35,
        "club_honors": 0.00,
    },
    "1956_1990": {
        "wc_legacy": 0.30,
        "annual_recognition": 0.45,
        "international_record": 0.10,
        "retrospective_selection": 0.15,
        "club_honors": 0.00,
    },
    "1991_plus": {
        "wc_legacy": 0.25,
        "annual_recognition": 0.45,
        "international_record": 0.20,
        "retrospective_selection": 0.10,
        "club_honors": 0.00,
    },
}

# ─── per-fact strengths (the family input scorers) ────────────────────────────
# Each linked fact contributes one input s ∈ (0, 1] to its family's saturating
# product. The values are absolute and era-invariant (a 1962 Golden Ball anchors
# the same input as a 2014 one), mirroring rating.AWARD_POINTS. They are NOT
# per-player; they are per KIND of distinction.

# World Cup individual awards — reuse the rating stage's award anchor points so the
# career view and the per-tournament view agree on what a Golden Ball is worth.
_WC_AWARD_STRENGTH: dict[str, float] = {
    "Golden Ball": 1.00,
    "Silver Ball": 0.70,
    "Bronze Ball": 0.50,
    "Golden Boot": 0.90,
    "Silver Boot": 0.60,
    "Bronze Boot": 0.45,
    "Golden Glove": 0.85,
    "Best Young Player": 0.55,
}

# Annual player-of-the-year elections, by source. The global European election
# (Ballon d'Or) and the global IFFHS election outrank the regional South-American
# election; each WIN is one input, so repeat winners saturate toward 1.0.
_ANNUAL_STRENGTH: dict[str, float] = {
    "european_poy": 0.85,
    "iffhs_worlds_best": 0.80,
    "south_american_poy": 0.70,
}

# Retrospective century / living-legends selections. A "World Player of the
# Century" election is the strongest single retrospective fact; a continental
# election is strong; a living-legends list inclusion is a softer corroboration.
_RETRO_WORLD_CENTURY = 1.00
_RETRO_CONTINENTAL_CENTURY = 0.72
_RETRO_LIVING_LEGENDS = 0.55

# International longevity records. Caps and goals are LONGEVITY/volume signals, not
# peak-quality signals, so they saturate to a deliberately modest ceiling: they
# corroborate a long elite career but never define elite stature on their own.
_CAPS_FLOOR_STRENGTH = 0.28
_CAPS_PER_CAP = 1.0 / 320.0  # +1 cap over 100 adds this much, capped below
_CAPS_CEILING_STRENGTH = 0.55
_GOALS_FLOOR_STRENGTH = 0.30
_GOALS_PER_GOAL = 1.0 / 120.0  # +1 intl goal over 30 adds this much, capped below
_GOALS_CEILING_STRENGTH = 0.65

# Coverage below which a fact's family is considered "thin" only for the report's
# review queue; the LIFT gate itself (MIN_CAREER_COVERAGE_FOR_LIFT) lives in
# rating.py. Surfaced here so the report and the rating gate stay legible together.
REVIEW_COVERAGE_THRESHOLD = 0.25


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _saturate(strengths: list[float]) -> float:
    """1 - Π(1 - s): positive evidence accumulates toward 1.0, never past it."""
    acc = 1.0
    for s in strengths:
        acc *= 1.0 - _clamp01(s)
    return 1.0 - acc


def _fact_strength(fact: dict) -> float:
    """Map one linked source fact to its family input strength in (0, 1].

    Raises on an unrecognized World Cup award name — drift protection identical to
    ``rating._award_score``: an unknown distinction must fail loud, never be
    silently dropped (understating the player) or guessed.
    """
    family = fact["family"]
    detail = fact["detail"]
    if family == "wc_legacy":
        kind = detail.split(" WC-")[0]
        if kind not in _WC_AWARD_STRENGTH:
            raise KeyError(f"unrecognized WC award {kind!r} in fact {fact!r}")
        return _WC_AWARD_STRENGTH[kind]
    if family == "annual_recognition":
        sid = fact["source_id"]
        if sid not in _ANNUAL_STRENGTH:
            raise KeyError(f"unrecognized annual-recognition source {sid!r}")
        return _ANNUAL_STRENGTH[sid]
    if family == "retrospective_selection":
        if "World - Player of the Century" in detail:
            return _RETRO_WORLD_CENTURY
        if "century election" in detail:
            return _RETRO_CONTINENTAL_CENTURY
        if "living-legends" in detail:
            return _RETRO_LIVING_LEGENDS
        raise KeyError(f"unrecognized retrospective fact {detail!r}")
    if family == "international_record":
        m = re.search(r"caps=(\d+)", detail)
        if m:
            caps = int(m.group(1))
            return min(
                _CAPS_CEILING_STRENGTH,
                _CAPS_FLOOR_STRENGTH + max(0, caps - 100) * _CAPS_PER_CAP,
            )
        m = re.search(r"goals=(\d+)", detail)
        if m:
            goals = int(m.group(1))
            return min(
                _GOALS_CEILING_STRENGTH,
                _GOALS_FLOOR_STRENGTH + max(0, goals - 30) * _GOALS_PER_GOAL,
            )
        raise KeyError(f"unrecognized international-record fact {detail!r}")
    raise KeyError(f"fact carries unknown family {family!r}: {fact!r}")


def _mens_wc_years(cards: list[dict], tournaments: list[dict]) -> dict[str, list[int]]:
    """player_id -> sorted list of the men's World Cup years they have a card in."""
    year_of = {
        t["tournament_id"]: t["year"] for t in tournaments if not t.get("womens")
    }
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
    club-career peaks (plan §"Career composite" rules)."""
    if not years:
        return None
    return years[(len(years) - 1) // 2]


def build_rows(source_facts: dict, mens_years: dict[str, list[int]]) -> list[dict]:
    """Build the sorted per-player career-stature rows (pure)."""
    facts = source_facts["facts"]
    by_player: dict[str, list[dict]] = {}
    for f in facts:
        by_player.setdefault(f["player_id"], []).append(f)

    rows: list[dict] = []
    for pid in sorted(by_player):
        pfacts = by_player[pid]
        # Every fact for a player carries the same player-era (E-4.1 derives it
        # from the player's earliest WC); assert it so a mislabeled fact fails loud.
        eras = {f["era"] for f in pfacts}
        if len(eras) != 1:
            raise ValueError(f"player {pid} has conflicting fact eras {eras}")
        era = next(iter(eras))
        if era not in ERA_BUCKETS:
            raise ValueError(f"player {pid} has unknown era {era!r}")
        weights = ERA_FAMILY_WEIGHTS[era]

        # Per-family saturating fold over that family's facts.
        family_facts: dict[str, list[dict]] = {}
        for f in pfacts:
            family_facts.setdefault(f["family"], []).append(f)
        family_scores: dict[str, float] = {}
        for fam, ff in family_facts.items():
            if fam not in FAMILY_KEYS:
                raise ValueError(f"player {pid} fact in unknown family {fam!r}")
            family_scores[fam] = round(
                _saturate([_fact_strength(f) for f in ff]), _PRECISION
            )

        # Era-weighted saturating combine across families. Only era-available
        # families (weight > 0) participate; club_honors (weight 0) is excluded.
        active = [fam for fam in FAMILY_KEYS if weights.get(fam, 0.0) > 0.0]
        acc = 1.0
        for fam in active:
            fs = family_scores.get(fam, 0.0)
            acc *= 1.0 - weights[fam] * fs
        career_score = round(1.0 - acc, _PRECISION)

        # Coverage: fraction of era-available family weight that actually has a
        # positive fact. Absent families lower coverage; they are NOT a zero.
        total_w = sum(weights[fam] for fam in active)
        present_w = sum(
            weights[fam]
            for fam in active
            if family_scores.get(fam, 0.0) > 0.0
        )
        coverage = round(present_w / total_w, _PRECISION) if total_w > 0 else 0.0

        peak_year = _career_peak_year(mens_years.get(pid, []))

        # Sorted, stable source refs for auditability (no scores attached here).
        source_refs = sorted(
            {f"{f['source_id']}:{f['detail']}" for f in pfacts}
        )

        rows.append(
            {
                "player_id": pid,
                "stature_version": VERSION,
                "career_stature_score": career_score,
                "coverage": coverage,
                "era_bucket": era,
                "career_peak_year": peak_year,
                "family_scores": {
                    fam: family_scores.get(fam, None) for fam in FAMILY_KEYS
                },
                "family_weights": {fam: weights.get(fam, 0.0) for fam in FAMILY_KEYS},
                "fact_count": len(pfacts),
                "review_flags": _review_flags(coverage, family_scores),
                "source_refs": source_refs,
            }
        )
    return rows


def _review_flags(coverage: float, family_scores: dict[str, float]) -> list[str]:
    """Non-fatal advisory flags for the review queue (never affect the score)."""
    flags: list[str] = []
    if coverage < REVIEW_COVERAGE_THRESHOLD:
        flags.append("below_lift_coverage_gate")
    if len(family_scores) == 1:
        flags.append("single_family_only")
    return flags


def build(write: bool = True) -> dict:
    source_facts = json.loads(
        (OUTPUT_DIR / "source_facts.json").read_text(encoding="utf-8")
    )
    cards = json.loads((_CANON_DIR / "player_tournaments.json").read_text("utf-8"))
    tournaments = json.loads((_CANON_DIR / "tournaments.json").read_text("utf-8"))
    mens_years = _mens_wc_years(cards, tournaments)

    rows = build_rows(source_facts, mens_years)
    review = [r for r in rows if r["review_flags"]]

    table = {
        "version": VERSION,
        "player_count": len(rows),
        "lift_eligible_count": sum(
            1 for r in rows if r["coverage"] >= REVIEW_COVERAGE_THRESHOLD
        ),
        "career_stature": rows,
    }
    review_doc = {
        "version": VERSION,
        "review_count": len(review),
        "coverage_gate": REVIEW_COVERAGE_THRESHOLD,
        "review": review,
    }
    report_md = _render_report(rows)

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


# Canonical-greats checklist (mirrors merit.report._GREATS) — report-only de-risk
# signal so the career composite is legible run-to-run.
_GREATS: tuple[tuple[str, str], ...] = (
    ("Pelé", "P-38906"),
    ("Alfredo Di Stéfano", "P-34403"),
    ("Garrincha", "P-46080"),
    ("Ferenc Puskás", "P-12676"),
    ("Lev Yashin (GK)", "P-09317"),
    ("Bobby Charlton", "P-08601"),
    ("Eusébio", "P-74747"),
    ("Franz Beckenbauer", "P-72864"),
    ("Johan Cruyff", "P-50564"),
    ("Gerd Müller", "P-72441"),
    ("Diego Maradona", "P-80404"),
    ("Michel Platini", "P-08939"),
    ("Zico", "P-37483"),
    ("Karl-Heinz Rummenigge", "P-59574"),
    ("Franco Baresi (DF)", "P-42920"),
    ("Lothar Matthäus", "P-49502"),
    ("Marco van Basten", "P-76874"),
    ("Roberto Baggio", "P-78756"),
    ("Zinedine Zidane", "P-56430"),
    ("Ronaldo", "P-62722"),
    ("Ronaldinho", "P-57361"),
    ("Cafu (DF)", "P-91718"),
    ("Gianluigi Buffon (GK)", "P-11392"),
    ("Paolo Maldini (DF)", "P-43222"),
    ("Lionel Messi", "P-14758"),
    ("Cristiano Ronaldo", "P-70442"),
)


def _render_report(rows: list[dict]) -> str:
    by_pid = {r["player_id"]: r for r in rows}
    L: list[str] = []
    L.append(f"# Career-stature composite ({VERSION})\n")
    L.append(
        "Per-player career-stature BASE consumed by the rating stage (E-4.3) as a "
        "capped lift. NOT a rating. Built deterministically from the committed "
        "`merit/source_facts.json` + canonical men's World Cup years.\n"
    )
    L.append(f"- Players scored: **{len(rows)}**")
    elig = sum(1 for r in rows if r["coverage"] >= REVIEW_COVERAGE_THRESHOLD)
    L.append(
        f"- Lift-eligible (coverage ≥ {REVIEW_COVERAGE_THRESHOLD}): **{elig}** "
        f"(the rest carry a real score but get little/no lift — honest thin coverage)\n"
    )
    # distribution by era
    L.append("## Score distribution by era bucket\n")
    L.append("| Era | players | min | median | max |")
    L.append("|---|---:|---:|---:|---:|")
    for era in ERA_BUCKETS:
        ss = sorted(r["career_stature_score"] for r in rows if r["era_bucket"] == era)
        if not ss:
            continue
        med = ss[len(ss) // 2]
        L.append(f"| `{era}` | {len(ss)} | {ss[0]:.3f} | {med:.3f} | {ss[-1]:.3f} |")
    # canonical greats
    L.append("\n## Canonical-greats checklist (de-risk signal)\n")
    L.append("| Great | Era | Score | Coverage | Families with facts |")
    L.append("|---|---|---:|---:|---|")
    for name, pid in _GREATS:
        r = by_pid.get(pid)
        if r is None:
            L.append(f"| {name} | — | — | — | (no linked facts) |")
            continue
        fams = ", ".join(
            f for f in FAMILY_KEYS if r["family_scores"].get(f) not in (None, 0.0)
        )
        L.append(
            f"| {name} | `{r['era_bucket']}` | {r['career_stature_score']:.3f} "
            f"| {r['coverage']:.2f} | {fams} |"
        )
    L.append(
        "\n_Thin-coverage greats (single World Cup, sparse public recognition) score "
        "low by design: missing coverage is coverage, never a zero against the "
        "player, and the rating lift gate (`MIN_CAREER_COVERAGE_FOR_LIFT`) withholds "
        "lift where the public record is too thin to support it._\n"
    )
    return "\n".join(L) + "\n"


def _write_json(path: Path, obj: dict) -> None:
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    out = build(write=True)
    t = out["table"]
    print(f"career stature {VERSION}")
    print(f"  players: {t['player_count']}  lift-eligible: {t['lift_eligible_count']}")
    print(f"  -> {CAREER_STATURE_PATH}")
    print(f"  -> {OUTPUT_DIR / 'CAREER_STATURE.md'}")
