"""Career-stature report and JSON emission helpers."""

from __future__ import annotations

import json
from pathlib import Path

from . import ACTIVE_SOURCE_SET_VERSION, ERA_BUCKETS, SOURCE_SET_VERSION, VERSION
from .stature_scoring import (
    _LEGEND_REASON_CODES,
    MATERIAL_MIN_COVERAGE,
    MATERIAL_MIN_INDEX,
)

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

# Defender / goalkeeper checklist — the v2 repair target (these legends were thin or
# zeroed in the striker-biased v1 set; v2 must surface them via the position-balanced
# and all-time routes).
_DEF_GK_CHECK: tuple[tuple[str, str], ...] = (
    ("Paolo Maldini (DF)", "P-43222"),
    ("Franco Baresi (DF)", "P-42920"),
    ("Franz Beckenbauer (DF)", "P-72864"),
    ("Cafu (DF)", "P-91718"),
    ("Lev Yashin (GK)", "P-09317"),
    ("Dino Zoff (GK)", "P-30086"),
    ("Gianluigi Buffon (GK)", "P-11392"),
    ("Iker Casillas (GK)", "P-46821"),
)


def _render_report(rows: list[dict], tier_meta: dict) -> str:
    from .stature import _is_material

    by_pid = {r["player_id"]: r for r in rows}
    material = [r for r in rows if _is_material(r)]
    legends = [r for r in rows if r["legend"]]
    L: list[str] = []
    L.append(f"# Career-stature composite ({VERSION})\n")
    L.append(
        "Per-player career-stature BASE consumed by the stature-dominant rating "
        "stage (MV2-4). NOT a rating. Built deterministically from the committed "
        f"`merit/source_facts.json` ({SOURCE_SET_VERSION}), "
        f"`merit/source_facts_active.json` ({ACTIVE_SOURCE_SET_VERSION}), and "
        "canonical men's World Cup years. Active facts are merged by person "
        "identity and stage-normalized in this table; rating-output consumption "
        "uses the full row directly.\n"
    )
    L.append(f"- Players scored: **{len(rows)}**")
    L.append(f"- Rows with active facts: **{sum(1 for r in rows if r['active_fact_count'])}**")
    L.append(
        f"- Material-stature (coverage ≥ {MATERIAL_MIN_COVERAGE} AND index ≥ "
        f"{MATERIAL_MIN_INDEX}): **{len(material)}** (the cohort the rating stage "
        "ramps onto the stature-dominant path; the rest stay raw-tournament)"
    )
    L.append(f"- Factual legends: **{len(legends)}**")
    gold = tier_meta.get("gold_min_index")
    silver = tier_meta.get("silver_min_index")
    L.append(
        f"- Tier cuts (index quantiles of the material cohort): gold ≥ "
        f"`{gold}`, silver ≥ `{silver}`, bronze = qualifying remainder\n"
    )

    # score + index distribution by era
    L.append("## Score / index distribution by era bucket\n")
    L.append("| Era | players | score min/med/max | index min/med/max |")
    L.append("|---|---:|---|---|")
    for era in ERA_BUCKETS:
        er = [r for r in rows if r["era_bucket"] == era]
        if not er:
            continue
        ss = sorted(r["career_stature_score"] for r in er)
        ii = sorted(r["career_stature_index"] for r in er)
        L.append(
            f"| `{era}` | {len(er)} | {ss[0]:.3f} / {ss[len(ss) // 2]:.3f} / {ss[-1]:.3f} "
            f"| {ii[0]:.3f} / {ii[len(ii) // 2]:.3f} / {ii[-1]:.3f} |"
        )

    # index distribution by modal position (the position-balance check)
    L.append("\n## Material-cohort index by modal position\n")
    L.append("| Position | material players | index min/med/max |")
    L.append("|---|---:|---|")
    for pos in ("GK", "DF", "MF", "FW"):
        pr = [r for r in material if r["modal_position"] == pos]
        if not pr:
            L.append(f"| {pos} | 0 | — |")
            continue
        ii = sorted(r["career_stature_index"] for r in pr)
        L.append(f"| {pos} | {len(pr)} | {ii[0]:.3f} / {ii[len(ii) // 2]:.3f} / {ii[-1]:.3f} |")

    # legend reason-code breakdown
    L.append("\n## Legend reason-code breakdown\n")
    L.append("| Reason code | players |")
    L.append("|---|---:|")
    for code in _LEGEND_REASON_CODES:
        n = sum(1 for r in legends if code in r["legend_reason_codes"])
        L.append(f"| `{code}` | {n} |")

    # canonical greats
    L.append("\n## Canonical-greats checklist (de-risk signal)\n")
    L.append("| Great | Era | Score | Index | Cov | Tier | Legend |")
    L.append("|---|---|---:|---:|---:|---|---|")
    for name, pid in _GREATS:
        r = by_pid.get(pid)
        if r is None:
            L.append(f"| {name} | — | — | — | — | — | (no linked facts) |")
            continue
        L.append(
            f"| {name} | `{r['era_bucket']}` | {r['career_stature_score']:.3f} "
            f"| {r['career_stature_index']:.3f} | {r['coverage']:.2f} "
            f"| {r['stature_tier'] or '—'} | {'✓' if r['legend'] else '—'} |"
        )

    # defender / GK repair checklist
    L.append("\n## Defender / goalkeeper checklist (the v2 repair target)\n")
    L.append("| Player | Era | Index | Cov | Tier | Legend | Reason codes |")
    L.append("|---|---|---:|---:|---|---|---|")
    for name, pid in _DEF_GK_CHECK:
        r = by_pid.get(pid)
        if r is None:
            L.append(f"| {name} | — | — | — | — | — | (no linked facts) |")
            continue
        L.append(
            f"| {name} | `{r['era_bucket']}` | {r['career_stature_index']:.3f} "
            f"| {r['coverage']:.2f} | {r['stature_tier'] or '—'} "
            f"| {'✓' if r['legend'] else '—'} | {', '.join(r['legend_reason_codes']) or '—'} |"
        )

    L.append(
        "\n_Thin-coverage / low-index rows are withheld from the stature-dominant "
        "rating path (they keep their raw tournament score — missing coverage is "
        "coverage, never a zero against the player) and listed in "
        "`career_stature_review.json`. Legend is SOURCE-derived and never inspects a "
        "rating; the Route-4 index floor (a documented in-spirit tightening of the "
        "plan) keeps the broad living-legends long-tail out of the badge._\n"
    )
    return "\n".join(L) + "\n"


def _write_json(path: Path, obj: dict) -> None:
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
