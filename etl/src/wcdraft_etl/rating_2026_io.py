"""Projected 2026 rating input and quantile-map helpers."""

from __future__ import annotations

import bisect
from pathlib import Path

from . import rating
from .rating import _quantile


def _load_career_stature(output_dir: Path) -> dict[str, dict]:
    """player_id -> FULL career-stature-4.1.0 row (merit-v4.1).

    V3 retires the V1 rating-compat pin: the projected stage now consumes the
    same full v3 person-identity rows as the historical wc-perf-5.0.0 stage —
    one table, one scale, both eras. Minted 2026 players resolved by the V1
    person-identity resolver carry rows keyed by their minted player_id, so the
    same player_id lookup serves linked and minted cards alike.
    """
    return rating._load_career_stature(output_dir)

def _historical_raw_only_internal(output_dir: Path) -> list[float]:
    """Sorted internal scores (in [0,1]) of the HISTORICAL PURE raw-only cards
    (``stature_model_weight == 0``) under the LIVE wc-perf-5.0.0 view.

    merit-v3 V3 re-derives the MV2-5 cross-era quantile map against V2's new
    historical raw-only distribution (design §2.1: same mechanism, new inputs).
    The V2-era compatibility reconstruction is removed: the target is now each
    raw-only card's actual internal final —
    its ``raw_only_score``, i.e. the participation-scaled raw path including the
    §4.1 award-gated headroom — exactly the population the unified display curve
    pools. (2026 cards have null awards pre-tournament, so their own ceiling
    clamp in pass 1d still binds at the no-award clamp.)
    """
    target: list[float] = []
    internal, _curve = rating.build_internal_view(
        players=rating._load(output_dir, "players"),
        cards=rating._load(output_dir, "player_tournaments"),
        tournaments=rating._load(output_dir, "tournaments"),
        manager_tournaments=rating._load(output_dir, "manager_tournaments"),
        career_stature_by_player=rating._load_career_stature(output_dir),
    )
    for r in internal:
        comps = {c["signal"]: c["value"] for c in r["components"]}
        if comps.get("stature_model_weight") == 0.0:
            # For a weight==0 card the blend collapses to the raw path, so the
            # emitted raw_only_score IS the card's internal final score.
            target.append(comps["raw_only_score"])
    return sorted(target)

def _empirical_percentile(sorted_vals: list[float], x: float) -> float:
    """Mid-rank percentile of ``x`` within ``sorted_vals`` in [0,1]: ``(#strictly-less
    + 0.5·#equal) / N`` — the float analog of ``rating._percentile_map``. Tie-stable,
    deterministic, monotonic non-decreasing in ``x`` (equal values share a percentile);
    empty reference ⇒ 0.5 (neutral)."""
    n = len(sorted_vals)
    if n == 0:
        return 0.5
    lo = bisect.bisect_left(sorted_vals, x)
    hi = bisect.bisect_right(sorted_vals, x)
    return (lo + 0.5 * (hi - lo)) / n

def _raw_only_quantile_map(
    projected_raw: float,
    raw_only_cohort_sorted: list[float],
    historical_raw_only_internal: list[float],
) -> float:
    """Place a non-material 2026 card's projected raw composite onto the HISTORICAL
    raw-only internal scale by EMPIRICAL QUANTILE MAPPING (density neutralization, not
    bound-matching).

    The projected raw composite (caps/goals percentile band + a strong club-league
    quality anchor) runs HOT relative to the historical tournament box score — its
    median is ≈0.66 vs ≈0.43 historically. An affine rescale onto
    ``[REPLACEMENT_BASE, ceiling]`` matched only the BOUNDS: it left the 2026 floor
    lifted (≈0.34 vs the historical 0.20) and the whole non-material distribution
    sitting systematically above comparable historical journeymen, which a single
    monotonic display curve (MV2-6) cannot pull back down. Instead we histogram-match:
    take the card's percentile ``p`` within the 2026 pure-raw-only (``weight == 0``)
    projected-raw cohort, then read the historical raw-only internal score at the SAME
    percentile ``p``. The 2026 non-material internal-score distribution then MATCHES
    the historical raw-only quantiles — a 2026 reserve at percentile ``p`` lands at the
    same internal score as a historical raw-only card at percentile ``p`` (e.g. a 2026
    bench defender aligns with a Mangala-2014-class historical reserve, not above it).

    Monotonic in ``projected_raw`` (mid-rank percentile ∘ linear-interp quantile), so
    within-2026 rank is preserved. Used as the raw COMPONENT everywhere: pure raw-only
    (``weight == 0``) cards AND the raw term of the continuity-ramp blend for
    linked-but-below-material (``0 < weight < 0.5``) cards — the percentile is always
    taken against the ``weight == 0`` cohort. With no historical band to match
    (``ratings.json`` absent) the projected raw passes through rank-preserved.
    """
    if not historical_raw_only_internal:
        return projected_raw
    p = _empirical_percentile(raw_only_cohort_sorted, projected_raw)
    return _quantile(historical_raw_only_internal, p)
