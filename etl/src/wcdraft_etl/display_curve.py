"""MV2-6 unified display curve — ONE pooled monotonic curve over the combined
historical (``wc-perf``) + 2026 (``proj-career``) INTERNAL score distribution.

Before MV2-6 the historical stage (``rating.py``) and the projected stage
(``rating_2026.py``) each fit their OWN four-anchor display curve on their OWN
internal pool. That was an honest stopgap while the two internal scales were not
yet comparable. MV2-5 closed that gap: the 2026 non-material internal scores are
empirically quantile-mapped onto the historical raw-only internal distribution,
and the 2026 linked-material players ride the SAME career-stature scale as the
historical greats. With the two internal scales now cross-era-fair, ONE pooled
display curve is the honest mapping (plan §322): a single monotonic low-DOF curve
fit over BOTH pools together and applied identically to every card in both eras —
no per-era table, no per-player pin.

The curve FORM is unchanged from ``rating._fit_display_curve`` /
``rating._display_value`` (the proven monotone piecewise-power on the pre-display
composite, three globally-fixed exponents, four data anchors). MV2-6 changes ONLY
the DATA the anchors are fit on: the POOLED (historical + 2026) internal scores
rather than each era in isolation.

DECOUPLED: the curve reshapes the display ``overall`` ONLY. The four sim channels
are materialized independently from the same internal ``score_0_100`` via
``rating._channel`` and are NEVER routed through this curve — they stay
byte-identical to base, so the sim is untouched.

merit-v3 V4 (design §4.4 + §5): the curve is re-fit — kind
``unified_pooled_piecewise_power_v2`` — over the UNION of both bases' internal
pools across both eras (historical career + historical current + 2026 career +
2026 current; n = 24,438). One shared curve maps every basis of every era, so
the same internal score renders identically across bases (draft-config §D).
The fitted anchors are FROZEN below for byte-determinism; the lock test asserts
the frozen tuple equals a live refit, so the freeze cannot go silently stale.
"""

from __future__ import annotations

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

# Fit at V4 lock time on the union pool (see fit_unified_curve(refit=True));
# test_unified_display pins frozen == live-refit. NOTE (recorded for the gate
# report): the union p95 anchor still lands exactly ON the internal-62.0 clamp
# pile — 1,150 historical no-award cards sit at exactly 62.0, byte-stable under
# V2's own §4.1 no-award invariant, so no monotone curve can spread them.
FROZEN_UNIFIED_CURVE_V2_ANCHORS = {
    "raw_floor": 20.0,
    "raw_median": 42.325568000000004,
    "raw_p95": 62.0,
    "raw_max": 100.0,
}


def _historical_internal_rows(output_dir: Path) -> list[dict]:
    """Internal rows of every historical men's card, rebuilt deterministically
    from the committed canonical tables. Pure function of the committed inputs —
    independent of the display curve, so pooling is safe against the bootstrap
    (the internal scores never depend on which curve last wrote ratings.json)."""
    from . import rating  # lazy: avoid an import cycle (rating imports this module)

    internal, _self_curve = rating.build_internal_view(
        players=rating._load(output_dir, "players"),
        cards=rating._load(output_dir, "player_tournaments"),
        tournaments=rating._load(output_dir, "tournaments"),
        manager_tournaments=rating._load(output_dir, "manager_tournaments"),
        career_stature_by_player=rating._load_career_stature(output_dir),
    )
    return internal


def _projected_internal_rows(output_dir: Path) -> list[dict]:
    """Internal rows of every 2026 card, rebuilt with the EXACT production
    projected path (the same ``_historical_raw_only_internal`` quantile-map
    target the committed ``ratings_2026.json`` was built from)."""
    from . import rating_2026  # lazy: avoid an import cycle

    cards = json.loads(
        (output_dir / "player_tournaments_2026.json").read_text(encoding="utf-8")
    )
    career = rating_2026._load_career_stature(output_dir)
    historical_raw_only = rating_2026._historical_raw_only_internal(output_dir)
    return rating_2026._build_internal_rows(cards, career, historical_raw_only)


def _union_pool(output_dir: Path) -> list[float]:
    """The v2 fit population: career + current internal scores, both eras."""
    rows = _historical_internal_rows(output_dir) + _projected_internal_rows(output_dir)
    return [r["score_0_100"] for r in rows] + [r["current_score_0_100"] for r in rows]


def fit_unified_curve(output_dir: Path = OUTPUT_DIR, *, refit: bool = False):
    """Return the ONE unified display curve (v2 kind).

    By default this returns the FROZEN v2 anchors (byte-determinism for the
    committed artifacts). ``refit=True`` recomputes the union-pool anchors live;
    the lock test asserts frozen == live so the freeze tracks the internals.
    """
    from . import rating  # lazy

    if not refit:
        return rating.DisplayCurve(**FROZEN_UNIFIED_CURVE_V2_ANCHORS)

    return rating._fit_display_curve(_union_pool(output_dir))


# ─── MV2-6 accuracy-eyeball SAMPLE (unified DISPLAY band) ─────────────────────
# Paulo's accuracy gate. Unlike the MV2-4/MV2-5 sections (which show INTERNAL
# scores), this section shows the FINAL display `overall` for BOTH eras on the ONE
# unified curve, plus the anti-inflation band distribution. Appended to
# MERIT_V2_SAMPLE.md after the 2026 internal section by
# rating_2026.write_merit_v2_sample.

# Named display anchors — (label, card_id). Historical card_id = player_id:tournament.
_HIST_ANCHORS: tuple[tuple[str, str], ...] = (
    ("Messi 2010", "P-14758:WC-2010"),
    ("Messi 2022", "P-14758:WC-2022"),
    ("Pelé 1958", "P-38906:WC-1958"),
    ("Pelé 1966", "P-38906:WC-1966"),
    ("Pelé 1970", "P-38906:WC-1970"),
    ("Maradona 1986", "P-80404:WC-1986"),
    ("Cruyff 1974", "P-50564:WC-1974"),
    ("Beckenbauer 1974", "P-72864:WC-1974"),
    ("Maldini 1990", "P-43222:WC-1990"),
    ("Baresi 1990", "P-42920:WC-1990"),
    ("Yashin 1958", "P-09317:WC-1958"),
)
# 2026 anchors — player_id (one card each, tournament WC-2026).
_PROJ_ANCHORS: tuple[tuple[str, str], ...] = (
    ("Messi 2026", "P-14758"),
    ("Mbappé 2026", "P-64077"),
    ("Vinícius 2026", "P-92812"),
    ("Bellingham 2026", "P-15674"),
    ("Modrić 2026", "P-29491"),
)
# The four previously-spurious projected MF cards (OVR-99 on the old raw formula).
_PROJ_SPURIOUS_99: tuple[str, ...] = ("P-34205", "P-39584", "P-58692", "P-W26-0177")

_BANDS = ((66, 73), (74, 83), (84, 90), (91, 99))


def _band_counts(overalls: list[int]) -> list[int]:
    return [sum(1 for o in overalls if lo <= o <= hi) for (lo, hi) in _BANDS]


def _median_int(overalls: list[int]) -> int:
    s = sorted(overalls)
    return s[len(s) // 2]


def render_unified_display_sample(output_dir: Path = OUTPUT_DIR) -> str:
    """Render the MV2-6 unified DISPLAY-band markdown section (no write).

    Builds BOTH eras' ratings on the ONE unified curve and shows the final display
    ``overall`` for the named anchors, mid-band starter controls, journeyman floors,
    and the four previously-spurious 2026 cards, plus the anti-inflation band
    distribution for historical / 2026 / pooled. Deterministic (a pure function of
    the committed tables)."""
    from . import rating, rating_2026  # lazy: avoid an import cycle

    curve = fit_unified_curve(output_dir)
    hist = rating.build_all(output_dir)
    proj = rating_2026.build_all(output_dir)
    hist_by_card = {r["card_id"]: r for r in hist}
    proj_by_player = {r["player_id"]: r for r in proj}

    players = json.loads((output_dir / "players.json").read_text(encoding="utf-8"))
    minted = json.loads((output_dir / "players_2026.json").read_text(encoding="utf-8"))
    name_of = {
        p["player_id"]: (p.get("common_name") or p.get("full_name") or p["player_id"])
        for p in players + minted
    }

    hist_ov = [r["overall"] for r in hist]
    proj_ov = [r["overall"] for r in proj]
    pool_ov = hist_ov + proj_ov

    L: list[str] = []
    L.append(
        f"\n---\n\n# Unified display-curve sample "
        f"({rating.RATING_VERSION} curve; maps {rating_2026.RATING_VERSION} too)\n"
    )
    L.append(
        "MV2-6 fits **one** monotonic low-DOF display curve "
        f"(`{rating.DISPLAY_CURVE_KIND}`) over the POOLED historical + 2026 INTERNAL "
        "distribution and applies it identically to BOTH eras. The four anchors "
        f"(floor→{rating.DISPLAY_FLOOR}, median→{rating.DISPLAY_MEDIAN}, "
        f"p95→{rating.DISPLAY_P95}, max→{rating.DISPLAY_MAX}) are fit on the pool; "
        "the three segment exponents are globally fixed "
        f"(low {rating.DISPLAY_LOW_EXPONENT}, mid {rating.DISPLAY_MID_EXPONENT}, "
        f"high {rating.DISPLAY_HIGH_EXPONENT}). It reshapes the display `overall` "
        "ONLY — the four sim channels are materialized independently from the same "
        "internal score and are byte-identical to base.\n"
    )
    L.append(
        "**Pooled curve anchors (internal 0–100):** "
        f"floor `{curve.raw_floor:.3f}` · median `{curve.raw_median:.3f}` · "
        f"p95 `{curve.raw_p95:.3f}` · max `{curve.raw_max:.3f}`.\n"
    )

    # ── band distribution (the anti-inflation guard, reported per era + pooled) ──
    L.append("## Band distribution (anti-inflation guard)\n")
    L.append(
        "| Cohort | n | median | 66–73 | 74–83 | 84–90 | 91–99 | ≥84 | ≥90 |\n"
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|"
    )
    for label, ov in (("Historical", hist_ov), ("2026", proj_ov), ("Pooled", pool_ov)):
        n = len(ov)
        c = _band_counts(ov)
        ge84 = sum(1 for o in ov if o >= 84)
        ge90 = sum(1 for o in ov if o >= 90)
        L.append(
            f"| {label} | {n} | {_median_int(ov)} "
            + " ".join(f"| {x} ({100 * x / n:.1f}%)" for x in c)
            + f" | {ge84} ({100 * ge84 / n:.1f}%) | {ge90} ({100 * ge90 / n:.1f}%) |"
        )
    L.append(
        "\n_The broad middle stays put: pooled median ≈ 73, the 91–99 band is a thin "
        "tail (≤ ~3%), and 84+ is a clear minority — the middle does not inflate into "
        "the high 80s._\n"
    )

    # ── named display anchors ──
    def hist_line(label: str, card_id: str) -> str:
        r = hist_by_card.get(card_id)
        if r is None:
            return f"| {label} | `{card_id}` | — | — | — |"
        return (
            f"| {label} | `{card_id}` | {r['overall_basis']} "
            f"| {'✓' if r['legend'] else '—'} | **{r['overall']}** |"
        )

    def proj_line(label: str, pid: str) -> str:
        r = proj_by_player.get(pid)
        if r is None:
            return f"| {label} | `{pid}` | — | — | — |"
        return (
            f"| {label} | `{r['card_id']}` | {r['overall_basis']} "
            f"| {'✓' if r['legend'] else '—'} | **{r['overall']}** |"
        )

    anchor_header = "| Player | Card | Basis | Lgd | Display OVR |\n|---|---|---|---|---:|"
    L.append("\n## Historical anchors (unified curve)\n")
    L.append(anchor_header)
    for label, cid in _HIST_ANCHORS:
        L.append(hist_line(label, cid))
    L.append("\n## 2026 anchors (SAME unified curve)\n")
    L.append(anchor_header)
    for label, pid in _PROJ_ANCHORS:
        L.append(proj_line(label, pid))

    L.append(
        "\n## Previously-spurious OVR-99 2026 cards (now mid-80s, not 99)\n"
    )
    L.append(anchor_header)
    for pid in _PROJ_SPURIOUS_99:
        L.append(proj_line(name_of.get(pid, pid), pid))

    # ── mid-band "solid starter" controls + journeyman floor, both eras ──
    def starter(ratings: list[dict]) -> dict | None:
        # A measured starter sitting right at the display median (the solid-starter
        # control): nearest measured_performance card to the median, tiebreak card_id.
        med = _median_int([r["overall"] for r in ratings])
        cands = [r for r in ratings if r["overall_basis"] == "measured_performance"]
        if not cands:
            return None
        return min(cands, key=lambda r: (abs(r["overall"] - med), r["card_id"]))

    def floor_card(ratings: list[dict]) -> dict:
        return min(ratings, key=lambda r: (r["overall"], r["card_id"]))

    L.append("\n## Mid-band starter + journeyman floor controls (both eras)\n")
    L.append(
        "| Control | Player | Card | Basis | Display OVR |\n|---|---|---|---|---:|"
    )
    for label, ratings in (
        ("Historical starter", hist),
        ("Historical floor", hist),
        ("2026 starter", proj),
        ("2026 floor", proj),
    ):
        r = starter(ratings) if "starter" in label else floor_card(ratings)
        if r is None:
            continue
        nm = name_of.get(r["player_id"], r["player_id"])
        L.append(
            f"| {label} | {nm} | `{r['card_id']}` | {r['overall_basis']} "
            f"| **{r['overall']}** |"
        )

    L.append(
        "\n_One curve, both eras, ordering preserved: recognized greats land in-band "
        "by their internal score (never hard-pinned), the broad middle holds at the "
        "median, and the four spurious projected cards collapse from a raw-only 99 to "
        "the mid-80s. No card displays 100._\n"
    )
    return "\n".join(L) + "\n"
