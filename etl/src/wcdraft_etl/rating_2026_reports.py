"""Projected 2026 rating report rendering helpers."""

from __future__ import annotations

import json
from pathlib import Path

from .rating import (
    CHANNEL_SPREAD,
    CHANNELS,
    RAW_ONLY_GLOBAL_CEILING,
    STATURE_DOMINANT_WEIGHT,
    _channel,
)

# ─── MV2-5 accuracy-eyeball SAMPLE (2026 INTERNAL-score shape) ────────────────
# Appended to etl/output/merit/MERIT_V2_SAMPLE.md (after the historical MV2-4
# section) so Paulo can eyeball the 2026 reconciliation: linked-material players on
# the stature scale, the previously-spurious OVR-99 projected MF cards now capped on
# the raw-only path, and a journeyman control. INTERNAL scores only — display is
# provisional until the unified curve (MV2-6).

# Explicit eyeball anchors (canonical player_ids): Messi, Mbappé, Vinícius,
# Bellingham, Modrić. The 4 previously-spurious cards are the OVR-99 projected MF
# cards on the old proj-career-2.0.0 raw formula. Names are rendered from the player
# tables at write time, so only the ids are pinned here.
_SAMPLE_NAMED_ANCHORS: tuple[str, ...] = (
    "P-14758",
    "P-64077",
    "P-92812",
    "P-15674",
    "P-29491",
)
_SAMPLE_SPURIOUS_99: tuple[str, ...] = ("P-34205", "P-39584", "P-58692", "P-W26-0177")


def _sample_comp(row: dict, signal: str):
    return next(c["value"] for c in row["components"] if c["signal"] == signal)


def render_merit_v2_sample_2026(
    internal_rows: list[dict],
    cards: list[dict],
    name_of: dict[str, str],
    *,
    rating_version: str,
) -> str:
    by_pid = {ir["player_id"]: ir for ir in internal_rows}
    link_of = {c["player_id"]: c["link_status"] for c in cards}

    def status(ir: dict) -> str:
        ls = link_of.get(ir["player_id"], "?")
        wt = _sample_comp(ir, "stature_model_weight")
        if ls != "linked":
            return ls
        return "linked·material" if wt >= STATURE_DOMINANT_WEIGHT else "linked·below"

    def row_line(ir: dict) -> str:
        idx = _sample_comp(ir, "career_stature_index")
        wt = _sample_comp(ir, "stature_model_weight")
        raw = _sample_comp(ir, "projected_raw_score")
        tgt = _sample_comp(ir, "stature_target_score")
        mod = _sample_comp(ir, "projected_modulation")
        nm = name_of.get(ir["player_id"], ir["player_id"])
        # Channels recomputed from the internal score (the materialized rating uses
        # the same _channel on the same score), so the table needs only internal rows.
        chans = {ch: _channel(ir["score_0_100"], CHANNEL_SPREAD[ir["pos"]][ch]) for ch in CHANNELS}
        return (
            f"| {nm} | `{ir['player_id']}` | {ir['pos']} | {status(ir)} "
            f"| {idx if idx is not None else '—'} | {wt:.2f} | {raw:.3f} "
            f"| {tgt if tgt is not None else '—'} | {mod:+.3f} "
            f"| {ir['score_0_100'] / 100:.3f} | {chans['attack']} | {chans['midfield']} "
            f"| {chans['defense']} | {chans['goalkeeping']} | {'✓' if ir['legend'] else '—'} |"
        )

    header = (
        "| Player | Player ID | Pos | Status | Index | Wt | Raw | Target | Mod | Final "
        "| ATT | MID | DEF | GK | Lgd |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|"
        "---:|---:|---:|---:|---|"
    )
    L: list[str] = []
    L.append(f"\n---\n\n# 2026 reconciliation INTERNAL-score sample ({rating_version})\n")
    L.append(
        "MV2-5 brings linked + material-stature 2026 players onto the SAME stature "
        "scale as the historical wc-perf-4.x cards, and caps non-material 2026 cards "
        "below the recognized-greats band on the projected raw path. Columns mirror "
        "the historical sample: **Status** (linked·material / linked·below / minted), "
        "career **Index**, stature model **Wt**, **Raw** projected score, stature "
        "**Target**, projected **Mod**ulation, blended **Final** (internal, NOT "
        "display — display is provisional until MV2-6), the four sim channels, and "
        "the factual **L**e**g**en**d** flag.\n"
    )

    # Linked-material cohort, top by index.
    material = sorted(
        (
            ir
            for ir in internal_rows
            if _sample_comp(ir, "stature_model_weight") >= STATURE_DOMINANT_WEIGHT
        ),
        key=lambda r: -(_sample_comp(r, "career_stature_index") or 0.0),
    )
    L.append("## Linked + material (reconciled onto the stature scale)\n")
    L.append(header)
    for ir in material:
        L.append(row_line(ir))

    L.append("\n## Named eyeball anchors\n")
    L.append(header)
    for pid in _SAMPLE_NAMED_ANCHORS:
        ir = by_pid.get(pid)
        if ir is not None:
            L.append(row_line(ir))

    L.append("\n## Previously-spurious OVR-99 projected cards (now raw-only capped)\n")
    L.append(header)
    for pid in _SAMPLE_SPURIOUS_99:
        ir = by_pid.get(pid)
        if ir is not None:
            L.append(row_line(ir))

    # Raw-only controls: the top non-material cards by projected raw (the band the
    # ceiling protects) and the single lowest-Final card (the journeyman floor).
    raw_only = sorted(
        (ir for ir in internal_rows if _sample_comp(ir, "stature_model_weight") == 0.0),
        key=lambda r: -_sample_comp(r, "projected_raw_score"),
    )
    L.append("\n## Raw-only controls (non-material — top of the raw band + journeyman floor)\n")
    L.append(header)
    for ir in raw_only[:5]:
        L.append(row_line(ir))
    if raw_only:
        floor_ir = min(internal_rows, key=lambda r: r["score_0_100"])
        L.append(row_line(floor_ir))

    L.append(
        f"\n_A non-material 2026 card's projected raw path is capped at the global "
        f"raw-only ceiling ({RAW_ONLY_GLOBAL_CEILING}), strictly below the marginal-"
        f"material stature floor, so it cannot occupy the high-90s/legend band on the "
        f"projection alone — the fix for the spurious OVR-99 projected MF cards. A "
        f"linked aging legend takes bounded DOWNWARD projected modulation (tightest at "
        f"the gold tier) but never collapses below recognized stature._\n"
    )
    return "\n".join(L) + "\n"


def render_merit_v2_sample_full(output_dir: Path | None = None) -> str:
    """Render the full 3-section MERIT_V2_SAMPLE.md (no write): historical MV2-4
    section (rendered fresh from rating.py) + 2026 MV2-5 reconciliation section +
    MV2-6 unified-display section. Deterministic: regenerated entirely from the
    committed canonical + career-stature + 2026 tables."""
    from . import display_curve, national_strength, rating, rating_2026

    out = output_dir or rating_2026.OUTPUT_DIR
    cards = json.loads((out / "player_tournaments_2026.json").read_text(encoding="utf-8"))
    career = rating_2026._load_career_stature(out)
    historical_raw_only = rating_2026._historical_raw_only_internal(out)
    internal_rows = rating_2026._build_internal_rows(
        cards, career, historical_raw_only, national_strength.load_by_key(out)
    )

    players_canon = json.loads((out / "players.json").read_text(encoding="utf-8"))
    players_minted = json.loads((out / "players_2026.json").read_text(encoding="utf-8"))
    name_of: dict[str, str] = {}
    for p in players_canon + players_minted:
        name_of[p["player_id"]] = p.get("common_name") or p.get("full_name") or p["player_id"]

    historical = rating.render_merit_v2_sample(out)
    section_2026 = render_merit_v2_sample_2026(
        internal_rows, cards, name_of, rating_version=rating_2026.RATING_VERSION
    )
    # MV2-6: append the unified DISPLAY-band section (final `overall`, both eras on
    # the one pooled curve + the anti-inflation band distribution — Paulo's gate).
    section_display = display_curve.render_unified_display_sample(out)
    return historical + section_2026 + section_display


def write_merit_v2_sample(output_dir: Path | None = None) -> str:
    """(Re)write etl/output/merit/MERIT_V2_SAMPLE.md — the SOLE owner of that file
    (invoked from ``ingest_2026.run``; ``rating.run`` deliberately does not write
    it). Runs LAST in the ingest lane and regenerates the whole 3-section file, so
    a clean rebuild reproduces the committed bytes regardless of stage order."""
    from . import rating_2026

    out_dir = output_dir or rating_2026.OUTPUT_DIR
    md = render_merit_v2_sample_full(out_dir)
    out = out_dir / "merit" / "MERIT_V2_SAMPLE.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    return md
