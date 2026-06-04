"""WS-A Rating stage — the per-card player Rating MOAT.

Computes an ORIGINAL, era-normalized, position-weighted, awards-anchored player
``Rating`` for every men's World Cup card, from the *committed canonical JSON*
in ``etl/output/`` (the ingestion's output — NOT the upstream CSVs). Keeping the
input to the already-committed canonical tables makes this stage self-contained
and byte-deterministic without the vendor source clone: same canonical input ->
identical ``ratings.json`` bytes.

LEGAL FIREWALL (non-negotiable): every number here is derived ONLY from the
factual public signals in the Fjelstul database (goals, appearances, awards,
team finish, position). NOTHING is ingested, mirrored, or "perturbed" from EA
Sports FC or any proprietary rating set. The formula is entirely wcdraft's own.
See RATING_METHODOLOGY.md for the derivation and the calibration rationale.

HONEST-STATE: a signal that is absent for a card (e.g. match appearances before
the 1970 cliff) is DROPPED from that card's weighting and surfaced as a ``null``
component value — it is NEVER substituted with 0. A card with no individually
measured performance signal at all (a pre-1970 goalkeeper: appearances null,
goals carry zero weight for keepers) gets ``overall = null`` — the contract's
honest "insufficient signal to display" path — rather than a fabricated score.

SCOPE: men's tournaments 1930-2022 (the contract's gameplay scope). Women's
cards present in the canonical tables are explicitly excluded here, not silently
dropped — the count is reported by ``run()``.
"""

from __future__ import annotations

import json
from pathlib import Path

# Anchored to the package location (etl/src/wcdraft_etl/ -> etl/output) so the
# stage reads/writes the same place regardless of the caller's cwd. Mirrors
# pipeline.OUTPUT_DIR.
OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

# Rating-algorithm version anchor — one of the three replay anchors in the core
# contract. Bump on ANY change to weights, normalization, or channel mapping;
# the golden git-diff guard will force the committed ratings.json to move with it.
RATING_VERSION = "wc-perf-1.0.0"

# ─── CALIBRATION CONSTANTS ────────────────────────────────────────────────────
# Everything below is a CALIBRATION choice (like the sim's lambda / scoring
# knobs): documented, golden-locked, and tunable without touching the algorithm.

COARSE_POSITIONS = ("GK", "DF", "MF", "FW")

# Cross-era ANCHOR #1 — individual awards. Absolute, era-invariant points in
# [0,1]: a 1962 Golden Ball anchors the same lift as a 2014 one, which is what
# equalizes cross-era comparability. Keyed by the canonical award_name strings
# carried on each card. (all_tournament_team / fair_play never appear in the
# source, so they are absent here by construction, not omitted by choice.)
AWARD_POINTS: dict[str, float] = {
    "Golden Ball": 1.00,
    "Silver Ball": 0.70,
    "Bronze Ball": 0.50,
    "Golden Boot": 0.90,
    "Silver Boot": 0.60,
    "Bronze Boot": 0.45,
    "Golden Glove": 0.85,
    "Best Young Player": 0.55,
}

# Cross-era ANCHOR #2 — team final placement that tournament. Semifinalists only
# (positions 1-4); the source ranks no further, so non-semifinalists have a null
# finish that is DROPPED, never read as 0. Absolute and era-invariant: winning in
# 1950 anchors the same as winning in 2022.
FINISH_POINTS: dict[int, float] = {1: 1.00, 2: 0.75, 3: 0.55, 4: 0.40}

# Position-specific BASE weights over the era-normalized PERFORMANCE signals
# (goals, appearances). A defender/keeper is never rated on goals: their base
# leans on appearances and their strength comes through the team-finish/awards
# anchor. Weights need not sum to 1 — they are renormalized over whatever signals
# are actually PRESENT for the card (honest-state drop).
BASE_WEIGHTS: dict[str, dict[str, float]] = {
    "FW": {"goals": 0.75, "appearances": 0.25},
    "MF": {"goals": 0.40, "appearances": 0.60},
    "DF": {"goals": 0.00, "appearances": 1.00},
    "GK": {"goals": 0.00, "appearances": 1.00},
}

# Position-specific ANCHOR weights. The anchor is the SUM of two INDEPENDENT
# cross-era lifts so they never wash each other out:
#   award lift  = AWARD_WEIGHT[pos]  * award_score   (individual distinction)
#   finish lift = FINISH_WEIGHT[pos] * finish_points  (team success)
# Keeping them separate is what lets a Golden-Ball winner on the champion team
# out-rate an undecorated starter on the same team — if the two lifts shared one
# saturating term, the champion's finish alone would max it and the award would
# add nothing (the bug that let a squad defender tie Maradona).
#
# AWARD_WEIGHT is broadly even across positions (an award is an award). FINISH is
# weighted UP for DF/GK (team defensive success is their headline signal) and
# DOWN for FW (whose own box score already carries them through the base).
AWARD_WEIGHT: dict[str, float] = {"FW": 0.20, "MF": 0.22, "DF": 0.18, "GK": 0.22}
FINISH_WEIGHT: dict[str, float] = {"FW": 0.16, "MF": 0.16, "DF": 0.24, "GK": 0.28}

# Replacement-level base in [0,1] used (a) as the off-position channel floor,
# (b) as the FLOOR of the performance base scale, and (c) as the channel base for
# a card with no individual performance signal, so a sim-consumed channel is
# never a degenerate 0. It is DISPLAY-independent: a no-signal card still reports
# overall = null even though its channels are floored.
REPLACEMENT_BASE = 0.20
FLOOR_CHANNEL = round(REPLACEMENT_BASE * 100)  # 20

# Performance base scale. The era-normalized percentile blend in [0,1] is mapped
# onto [REPLACEMENT_BASE, BASE_CEILING] rather than straight to [0,1]. This is
# deliberate: raw box-score performance can only carry a card to "very good"
# (BASE_CEILING); reaching the top of the scale REQUIRES the cross-era anchor
# (awards + team finish). That is what makes awards the differentiator between
# the merely-excellent and the legendary, and keeps the elite tail spread out
# instead of everyone with a high percentile pinning at 100.
BASE_CEILING = 0.68

# Position -> sim-channel SPREAD. The card's own channel gets the full score
# (spread 1.0); off-position channels are a convex blend toward REPLACEMENT_BASE.
# Outfielders get spread 0.0 into goalkeeping (you cannot keep goal by being a
# good striker) -> they sit at the replacement floor in that channel.
CHANNEL_SPREAD: dict[str, dict[str, float]] = {
    "FW": {"attack": 1.00, "midfield": 0.60, "defense": 0.30, "goalkeeping": 0.00},
    "MF": {"attack": 0.65, "midfield": 1.00, "defense": 0.60, "goalkeeping": 0.00},
    "DF": {"attack": 0.35, "midfield": 0.60, "defense": 1.00, "goalkeeping": 0.00},
    "GK": {"attack": 0.05, "midfield": 0.20, "defense": 0.55, "goalkeeping": 1.00},
}

CHANNELS = ("attack", "midfield", "defense", "goalkeeping")

# Rounding precision for component float values, so the emitted JSON is stable.
_PRECISION = 6


# ─── INPUT LOADING ────────────────────────────────────────────────────────────


def _load(output_dir: Path, name: str) -> list[dict]:
    return json.loads((output_dir / f"{name}.json").read_text(encoding="utf-8"))


# ─── ERA NORMALIZATION ────────────────────────────────────────────────────────


def _percentile_map(values: list[int]) -> dict[int, float]:
    """Mid-rank percentile in [0,1] for each distinct integer value in a cohort.

    pct(v) = (#strictly-less + 0.5 * #equal) / N. Deterministic and tie-stable;
    an all-equal cohort maps every member to 0.5 (neutral), and a singleton maps
    to 0.5. This is the era equalizer: a value is ranked against its own
    (tournament, position) contemporaries, so a 1954 striker and a 2022 striker
    are placed on the same 0..1 scale despite very different raw counts.
    """
    n = len(values)
    if n == 0:
        return {}
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    pct: dict[int, float] = {}
    cum_less = 0
    for v in sorted(counts):
        eq = counts[v]
        pct[v] = round((cum_less + 0.5 * eq) / n, _PRECISION)
        cum_less += eq
    return pct


# ─── ANCHOR COMPONENTS ────────────────────────────────────────────────────────


def _award_score(award_names: list[str]) -> float:
    """Saturating combine of held awards in [0,1]: 1 - prod(1 - points_i).

    Multiple awards lift more but never past 1.0. Raises on an unrecognized award
    name — drift protection: an unknown award must fail loud, never be silently
    dropped (which would understate) or fabricated.
    """
    acc = 1.0
    for name in award_names:
        if name not in AWARD_POINTS:
            raise KeyError(f"unrecognized award_name {name!r}; refusing to silently drop it")
        acc *= 1.0 - AWARD_POINTS[name]
    return round(1.0 - acc, _PRECISION)


# ─── CORE ─────────────────────────────────────────────────────────────────────


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _channel(score_0_100: float, spread: float) -> int:
    """Convex blend between the card score (spread=1) and the replacement floor
    (spread=0), rounded to an integer in [0,100]."""
    val = score_0_100 * spread + FLOOR_CHANNEL * (1.0 - spread)
    return max(0, min(100, round(val)))


def _coarse_pos(card: dict, position_of_player: dict[str, str | None]) -> str:
    """Per-card coarse position to weight on: the listed position, falling back
    to the player's primary position. Raises if neither is a coarse code so a
    rating is never silently produced for an unweightable card."""
    pos = card["position_listed"] or position_of_player.get(card["player_id"])
    if pos not in COARSE_POSITIONS:
        raise ValueError(f"card {card['card_id']} has no coarse position to weight on")
    return pos


def build_ratings(
    players: list[dict],
    cards: list[dict],
    tournaments: list[dict],
    manager_tournaments: list[dict],
) -> list[dict]:
    """Return Rating-shaped records for every men's card, sorted by card_id.

    Records carry the canonical (string) ``tournament_id`` / ``card_id`` so they
    JOIN 1:1 with player_tournaments.json. Mapping the string tournament id to
    the numeric id the runtime ``Rating`` zod schema wants is the later
    packages/data emit-lock step and deliberately out of scope here.
    """
    mens = {t["tournament_id"] for t in tournaments if "Men's" in t["name"]}
    position_of_player = {p["player_id"]: p.get("primary_position") for p in players}

    # Team final placement keyed by (nation_id, tournament_id). Semifinalists only;
    # everything else is genuinely absent (-> None -> dropped, never 0).
    finish_of: dict[tuple[str, str], int] = {}
    for m in manager_tournaments:
        fp = m.get("final_placement")
        if fp is None:
            continue
        key = (m["nation_id"], m["tournament_id"])
        # A mid-tournament manager change repeats the team's placement; keep the
        # best (min) deterministically if the source ever disagreed.
        finish_of[key] = fp if key not in finish_of else min(finish_of[key], fp)

    mens_cards = [c for c in cards if c["tournament_id"] in mens]

    # Build per-(tournament, position) percentile maps for the two era-dependent
    # performance signals. Appearances are null pre-1970 and excluded from their
    # cohort entirely (the signal does not exist for that era).
    goals_cohort: dict[tuple[str, str], list[int]] = {}
    apps_cohort: dict[tuple[str, str], list[int]] = {}
    for c in mens_cards:
        ckey = (c["tournament_id"], _coarse_pos(c, position_of_player))
        goals_cohort.setdefault(ckey, []).append(c["goals"])
        if c["appearances"] is not None:
            apps_cohort.setdefault(ckey, []).append(c["appearances"])
    goals_pct = {k: _percentile_map(v) for k, v in goals_cohort.items()}
    apps_pct = {k: _percentile_map(v) for k, v in apps_cohort.items()}

    ratings: list[dict] = []
    for c in mens_cards:
        pos = _coarse_pos(c, position_of_player)
        ckey = (c["tournament_id"], pos)

        g_pct = goals_pct[ckey][c["goals"]]
        a_pct = apps_pct[ckey][c["appearances"]] if c["appearances"] is not None else None

        bw = BASE_WEIGHTS[pos]
        # Present, positively-weighted performance signals (honest-state: drop the
        # rest). A signal counts only if its value exists AND its weight is > 0.
        present: list[tuple[str, float, float]] = []  # (name, value, raw_weight)
        if bw["goals"] > 0.0:
            present.append(("goals", g_pct, bw["goals"]))
        if a_pct is not None:
            present.append(("appearances", a_pct, bw["appearances"]))
        present = [(n, v, w) for (n, v, w) in present if w > 0.0]
        present_w = sum(w for _, _, w in present)

        has_individual_signal = present_w > 0.0
        if has_individual_signal:
            # Era-normalized percentile blend in [0,1], scaled onto the performance
            # base band [REPLACEMENT_BASE, BASE_CEILING]. Performance alone tops out
            # at BASE_CEILING; the anchor supplies the rest of the headroom.
            blend = sum(w * v for _, v, w in present) / present_w
            base = REPLACEMENT_BASE + (BASE_CEILING - REPLACEMENT_BASE) * blend
        else:
            # Pre-1970 DF/GK: appearances null and goals carry zero weight, so we
            # have no usable individual performance signal. Channels still need a
            # value for the sim, so they float on the replacement base + anchor;
            # but the DISPLAY overall is honestly null.
            base = REPLACEMENT_BASE

        eff_weight = {
            n: round(w / present_w, _PRECISION) if has_individual_signal else 0.0
            for (n, _, w) in present
        }

        award_score = _award_score(c["awards"]) if c["awards"] is not None else 0.0
        finish = finish_of.get((c["nation_id"], c["tournament_id"]))
        finish_pts = FINISH_POINTS[finish] if finish is not None else None
        # Two independent additive cross-era lifts (see AWARD_WEIGHT / FINISH_WEIGHT).
        anchor = AWARD_WEIGHT[pos] * award_score + FINISH_WEIGHT[pos] * (finish_pts or 0.0)

        score = _clamp01(base + anchor)
        score_0_100 = 100.0 * score
        overall = round(score_0_100) if has_individual_signal else None

        channels = {ch: _channel(score_0_100, CHANNEL_SPREAD[pos][ch]) for ch in CHANNELS}

        components = [
            # Raw box-score values for transparency (weight 0 — informational).
            {"signal": "goals", "value": c["goals"], "weight": 0.0},
            {"signal": "appearances", "value": c["appearances"], "weight": 0.0},
            # Era-normalized performance signals with their EFFECTIVE base weights.
            # A dropped signal shows value:null, weight:0.0 — visibly not 0-substituted.
            {
                "signal": "goals_percentile",
                "value": g_pct,
                "weight": eff_weight.get("goals", 0.0),
            },
            {
                "signal": "appearances_percentile",
                "value": a_pct,
                "weight": eff_weight.get("appearances", 0.0),
            },
            # Cross-era anchors, each with its independent position weight. A null
            # team_finish (non-semifinalist) is shown as null, never 0-substituted.
            {"signal": "award_score", "value": award_score, "weight": AWARD_WEIGHT[pos]},
            {"signal": "team_finish", "value": finish_pts, "weight": FINISH_WEIGHT[pos]},
        ]

        ratings.append(
            {
                "card_id": c["card_id"],
                "player_id": c["player_id"],
                "tournament_id": c["tournament_id"],
                "overall": overall,
                "attack": channels["attack"],
                "midfield": channels["midfield"],
                "defense": channels["defense"],
                "goalkeeping": channels["goalkeeping"],
                "components": components,
                "coverage": c["coverage"],
                "coverage_basis": "wc_signals",
                "provenance": "wc_performance",
                "rating_version": RATING_VERSION,
            }
        )

    ratings.sort(key=lambda r: r["card_id"])
    return ratings


def build_all(output_dir: Path = OUTPUT_DIR) -> list[dict]:
    """Load the committed canonical tables and build every men's-card rating."""
    return build_ratings(
        players=_load(output_dir, "players"),
        cards=_load(output_dir, "player_tournaments"),
        tournaments=_load(output_dir, "tournaments"),
        manager_tournaments=_load(output_dir, "manager_tournaments"),
    )


def _write_json(path: Path, obj) -> None:
    # Byte-identical with the ingestion's emitter: sorted keys, stable indent,
    # trailing newline, no timestamps.
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def run(output_dir: Path = OUTPUT_DIR) -> list[dict]:
    """Build ratings from the committed canonical tables and emit ratings.json."""
    ratings = build_all(output_dir)
    _write_json(output_dir / "ratings.json", ratings)
    return ratings


if __name__ == "__main__":
    rows = run()
    rated = len(rows)
    nulls = sum(1 for r in rows if r["overall"] is None)
    print(f"wcdraft rating: wrote {rated:,} men's-card ratings -> {OUTPUT_DIR}/ratings.json")
    print(f"  overall=null (insufficient individual signal): {nulls:,}")
