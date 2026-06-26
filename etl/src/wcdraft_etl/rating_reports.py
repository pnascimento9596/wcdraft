"""Historical rating report rendering helpers."""

from __future__ import annotations

from pathlib import Path

from .rating_components import RAW_ONLY_GLOBAL_CEILING

# ─── MV2-4 accuracy-eyeball SAMPLE (INTERNAL-score shape) ─────────────────────
# A human-readable shape sample for Paulo's first eyeball BEFORE MV2-5/MV2-6 commit
# further effort. It shows INTERNAL scores (final, stature_path ingredients, four
# channels), NOT final display — if the curve is visibly wrong here, MV2-4 iterates
# before the downstream stages bake in a bad shape.

# Position-channel anchors surfaced explicitly so the channel-shape is legible.
_SAMPLE_POSITION_ANCHORS: tuple[tuple[str, str, str], ...] = (
    ("Paolo Maldini", "P-43222", "DF"),
    ("Franco Baresi", "P-42920", "DF"),
    ("Franz Beckenbauer", "P-72864", "DF"),
    ("Cafu", "P-91718", "DF"),
    ("Lev Yashin", "P-09317", "GK"),
    ("Gianluigi Buffon", "P-11392", "GK"),
    ("Lothar Matthäus", "P-49502", "MF"),
    ("Johan Cruyff", "P-50564", "MF"),
)


def _sample_comp(row: dict, signal: str):
    return next(c["value"] for c in row["components"] if c["signal"] == signal)


def _render_merit_v2_sample(
    internal_rows: list[dict],
    ratings_by_card: dict[str, dict],
    players: list[dict],
    career_by_player: dict[str, dict],
    *,
    rating_version: str,
) -> str:
    name_of = {p["player_id"]: p.get("common_name") or p["player_id"] for p in players}
    # Representative card per player = their highest internal score.
    best: dict[str, dict] = {}
    for r in internal_rows:
        cur = best.get(r["player_id"])
        if cur is None or r["score_0_100"] > cur["score_0_100"]:
            best[r["player_id"]] = r

    def row_line(ir: dict) -> str:
        rr = ratings_by_card[ir["card_id"]]
        idx = _sample_comp(ir, "career_stature_index")
        wt = _sample_comp(ir, "stature_model_weight")
        raw = _sample_comp(ir, "raw_tournament_score")
        tgt = _sample_comp(ir, "stature_target_score")
        mod = _sample_comp(ir, "tournament_modulation")
        nm = name_of.get(ir["player_id"], ir["player_id"])
        return (
            f"| {nm} | `{ir['tournament_id']}` | {ir['pos']} "
            f"| {idx if idx is not None else '—'} | {wt:.2f} | {raw:.3f} "
            f"| {tgt if tgt is not None else '—'} | {mod:+.3f} "
            f"| {ir['score_0_100'] / 100:.3f} | {rr['attack']} | {rr['midfield']} "
            f"| {rr['defense']} | {rr['goalkeeping']} | {'✓' if rr['legend'] else '—'} |"
        )

    header = (
        "| Player | Card | Pos | Index | Wt | Raw | Target | Mod | Final | ATT | MID "
        "| DEF | GK | Lgd |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"
    )
    L: list[str] = []
    L.append(f"# Merit-v2 internal-score SHAPE sample ({rating_version})\n")
    L.append(
        "First-eyeball accuracy check of the stature-dominant INTERNAL scores (final "
        "= stature_model_weight·stature_path + (1−weight)·raw_path). NOT final "
        "display — the unified display curve is MV2-6 and final display anchors are "
        "MV2-8. `overall` is provisional here. Columns: career-stature **Index**, "
        "stature model **Wt**(eight), **Raw** tournament score, stature **Target**, "
        "tournament **Mod**ulation, blended **Final**, the four sim channels, and the "
        "factual **L**e**g**en**d** flag. Channels expose the position shape (a "
        "DF/GK legend reads elite on-position, not uniformly elite).\n"
    )

    material = [
        ir
        for pid, ir in best.items()
        if (career_by_player.get(pid) or {}).get("career_stature_index") is not None
        and _sample_comp(ir, "stature_model_weight") > 0.0
    ]
    material.sort(key=lambda r: -_sample_comp(r, "career_stature_index"))

    L.append("## Top 20 by career-stature index (representative card)\n")
    L.append(header)
    for ir in material[:20]:
        L.append(row_line(ir))

    mid = [ir for ir in material if 0.40 <= _sample_comp(ir, "career_stature_index") <= 0.58]
    L.append("\n## Mid-band material sample (index 0.40–0.58)\n")
    L.append(header)
    for ir in mid[:12]:
        L.append(row_line(ir))

    L.append("\n## Position-channel anchors (DF / GK / MF — channel-shape check)\n")
    L.append(header)
    for _name, pid, _pos in _SAMPLE_POSITION_ANCHORS:
        ir = best.get(pid)
        if ir is not None:
            L.append(row_line(ir))

    # A raw-only control so the band separation is visible.
    raw_only = [ir for pid, ir in best.items() if _sample_comp(ir, "stature_model_weight") == 0.0]
    raw_only.sort(key=lambda r: -r["score_0_100"])
    L.append("\n## Raw-only controls (no material stature — top of the raw band)\n")
    L.append(header)
    for ir in raw_only[:6]:
        L.append(row_line(ir))

    L.append(
        "\n_SHAPE check only. A recognized great's weak tournament should still read "
        "elite (bounded down-modulation off a high stature target); an apex "
        "tournament can exceed the target; a raw-only control stays below the "
        f"material band (capped at the global raw-only ceiling {RAW_ONLY_GLOBAL_CEILING})._\n"
    )
    return "\n".join(L) + "\n"


def render_merit_v2_sample(output_dir: Path | None = None) -> str:
    """Render the historical INTERNAL-score shape sample as markdown (no write).

    ``MERIT_V2_SAMPLE.md`` has a SINGLE owner: ``rating_2026.write_merit_v2_sample``
    (invoked from ``ingest_2026.run``), which prepends this exact historical section
    before its 2026 reconciliation + unified-display sections. This module only
    renders — it must never write the file, or whichever stage ran last would
    decide its committed contents (the dual-writer trap)."""
    from . import rating

    out = output_dir or rating.OUTPUT_DIR
    players = rating._load(out, "players")
    cards = rating._load(out, "player_tournaments")
    tournaments = rating._load(out, "tournaments")
    manager_tournaments = rating._load(out, "manager_tournaments")
    career = rating._load_career_stature(out)
    internal, _curve = rating.build_internal_view(
        players, cards, tournaments, manager_tournaments, career, output_dir=out
    )
    ratings = rating.build_ratings(
        players, cards, tournaments, manager_tournaments, career, output_dir=out
    )
    return _render_merit_v2_sample(
        internal,
        {r["card_id"]: r for r in ratings},
        players,
        career,
        rating_version=rating.RATING_VERSION,
    )
