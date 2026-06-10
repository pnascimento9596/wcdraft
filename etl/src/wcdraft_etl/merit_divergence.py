"""ENGINE-V2 E-4.6 — career-lift divergence review queue (REVIEW-ONLY).

Emits ``etl/output/merit/merit_divergence_review.json``: every men's card whose
career-stature lift moved it materially, at the plan's default thresholds

    abs(Δoverall) ≥ 8   OR   abs(Δ primary channel) ≥ 10

so a human can eyeball whether the lift did something surprising for a given
player. This file is REVIEW OUTPUT ONLY — nothing downstream loads it, it is never
a source, and it never overrides a rating.

DIVERGENCE BASELINE: the comparison is the pre-lift composite (the wc-perf-2.0.0
behavior, reproduced deterministically by running the SAME rating build with the
career table disabled) vs the post-lift output (wc-perf-3.0.0). This makes the
queue self-contained and deterministic — it needs no external file.

EXTERNAL CROSS-CHECK (optional overlay, not committed to the build path): an
independent non-proprietary merit assembly (e.g. a separately-produced report) may
be dropped under ``docs/`` and diffed against this output by a reviewer. It is
review input only and is deliberately NOT read here — keeping the build pure and
the firewall intact (no external rating IP ever enters ETL scoring).
"""

from __future__ import annotations

import json
from pathlib import Path

from . import rating
from .merit import VERSION

# Primary sim channel per coarse position — the channel the player's stature most
# directly drives (and the one the plan's Δ threshold watches).
_PRIMARY_CHANNEL: dict[str, str] = {
    "FW": "attack",
    "MF": "midfield",
    "DF": "defense",
    "GK": "goalkeeping",
}

DELTA_OVERALL_THRESHOLD = 8
DELTA_CHANNEL_THRESHOLD = 10

OUTPUT_PATH = rating.OUTPUT_DIR / "merit" / "merit_divergence_review.json"


def _coarse_pos_of(card: dict, players_by_id: dict[str, dict]) -> str | None:
    pos = card.get("position_listed") or players_by_id.get(
        card["player_id"], {}
    ).get("primary_position")
    return pos if pos in rating.COARSE_POSITIONS else None


def build(output_dir: Path = rating.OUTPUT_DIR, write: bool = True) -> dict:
    players = rating._load(output_dir, "players")
    cards = rating._load(output_dir, "player_tournaments")
    tournaments = rating._load(output_dir, "tournaments")
    manager_tournaments = rating._load(output_dir, "manager_tournaments")
    career = rating._load_career_stature(output_dir)

    # MV2-6: hold the display curve FIXED (the shared unified pooled curve) across
    # both builds so Δoverall isolates the career-lift's effect on the INTERNAL
    # score as seen through the production curve — not a by-product of each build
    # refitting a different per-pool curve. Channel deltas are curve-independent.
    from . import display_curve

    curve = display_curve.fit_unified_curve(output_dir)
    before = rating.build_ratings(
        players, cards, tournaments, manager_tournaments, {}, curve=curve
    )
    after = rating.build_ratings(
        players, cards, tournaments, manager_tournaments, career, curve=curve
    )
    before_by = {r["card_id"]: r for r in before}
    players_by_id = {p["player_id"]: p for p in players}
    cards_by_id = {c["card_id"]: c for c in cards}

    rows: list[dict] = []
    for a in after:
        b = before_by[a["card_id"]]
        pos = _coarse_pos_of(cards_by_id[a["card_id"]], players_by_id)
        prim = _PRIMARY_CHANNEL.get(pos) if pos else None
        d_overall = a["overall"] - b["overall"]
        d_primary = (a[prim] - b[prim]) if prim else 0
        if (
            abs(d_overall) >= DELTA_OVERALL_THRESHOLD
            or abs(d_primary) >= DELTA_CHANNEL_THRESHOLD
        ):
            cs = career.get(a["player_id"])
            rows.append(
                {
                    "card_id": a["card_id"],
                    "player_id": a["player_id"],
                    "position": pos,
                    "primary_channel": prim,
                    "overall_before": b["overall"],
                    "overall_after": a["overall"],
                    "delta_overall": d_overall,
                    "primary_channel_before": b[prim] if prim else None,
                    "primary_channel_after": a[prim] if prim else None,
                    "delta_primary_channel": d_primary,
                    "career_stature_score": cs["career_stature_score"] if cs else None,
                    "career_coverage": cs["coverage"] if cs else None,
                }
            )

    rows.sort(
        key=lambda r: (
            -abs(r["delta_primary_channel"]),
            -abs(r["delta_overall"]),
            r["card_id"],
        )
    )
    doc = {
        "version": VERSION,
        "note": (
            "REVIEW ONLY — raw-only baseline (career table disabled) vs the "
            "stature-dominant output (career table enabled) divergence, both mapped "
            "through the shared MV2-6 unified display curve so Δoverall isolates the "
            "career lift. Never a source, never an override. An external independent "
            "merit assembly may be diffed against this by a reviewer but is not read "
            "by the build."
        ),
        "thresholds": {
            "abs_delta_overall_min": DELTA_OVERALL_THRESHOLD,
            "abs_delta_primary_channel_min": DELTA_CHANNEL_THRESHOLD,
        },
        "flagged_count": len(rows),
        "review": rows,
    }
    if write:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return doc


if __name__ == "__main__":
    out = build(write=True)
    print(f"career-lift divergence review {VERSION}")
    print(f"  flagged: {out['flagged_count']} cards (Δovr≥8 or Δchannel≥10)")
    print(f"  -> {OUTPUT_PATH}")
