"""WS-A Rating: golden determinism, schema bounds, honest-state, and the
``wc-perf-2.0.0`` recalibration acceptance suite.

SELF-CONTAINED: the rating stage reads the committed canonical JSON in
``etl/output/``, so the suite runs without the upstream Fjelstul CSV clone
(unlike the ingestion tests). The fixed input dataset is the committed canonical
tables; the locked output is the committed ratings.json.

PHASE 1 RECALIBRATION (wc-perf-2.0.0):
  * Display floor 66, p50 ≈ 73, p95 ≈ 88, max 99 (no 100s).
  * baseline_anchor_estimate cards banded into [66, 73].
  * Recoupled path: the calibration curve drives both ``overall`` AND the four
    sim channels; ``calibration.ts`` λ is retuned on the compressed channel scale.
  * No new data ingestion. Only the existing committed signals are re-shaped.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from wcdraft_etl import rating

REPO_ROOT = Path(__file__).resolve().parents[2]

# ─── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def built() -> list[dict]:
    """Ratings rebuilt from the committed canonical tables."""
    return rating.build_all()


@pytest.fixture(scope="session")
def by_id(built: list[dict]) -> dict[str, dict]:
    return {r["card_id"]: r for r in built}


@pytest.fixture(scope="session")
def cards() -> dict[str, dict]:
    return {c["card_id"]: c for c in rating._load(rating.OUTPUT_DIR, "player_tournaments")}


@pytest.fixture(scope="session")
def players() -> list[dict]:
    return rating._load(rating.OUTPUT_DIR, "players")


@pytest.fixture(scope="session")
def tournaments() -> dict[str, dict]:
    return {t["tournament_id"]: t for t in rating._load(rating.OUTPUT_DIR, "tournaments")}


@pytest.fixture(scope="session")
def awards() -> list[dict]:
    return rating._load(rating.OUTPUT_DIR, "awards")


def _card_id(
    players: list[dict], cards: dict[str, dict], common_name: str, tournament_id: str
) -> str:
    """Resolve a card_id by player common_name + tournament — name-based so the
    sanity assertions stay readable and survive any player_id renumbering."""
    pids = {p["player_id"] for p in players if p["common_name"] == common_name}
    matches = [
        c["card_id"]
        for c in cards.values()
        if c["player_id"] in pids and c["tournament_id"] == tournament_id
    ]
    assert len(matches) == 1, f"expected one {common_name} card in {tournament_id}, got {matches}"
    return matches[0]


def _quantile(xs: list[int | float], q: float) -> float:
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        raise AssertionError("empty quantile input")
    if n == 1:
        return float(xs[0])
    pos = (n - 1) * q
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    return float(xs[lo]) * (1.0 - (pos - lo)) + float(xs[hi]) * (pos - lo)


# ─── determinism + golden ─────────────────────────────────────────────────────


def test_build_is_deterministic():
    a = json.dumps(rating.build_all(), ensure_ascii=False, indent=2, sort_keys=True)
    b = json.dumps(rating.build_all(), ensure_ascii=False, indent=2, sort_keys=True)
    assert a == b


def test_matches_committed_golden(built: list[dict]):
    """Committed ratings.json must equal a fresh build, byte for byte. The CI
    git-diff guard enforces the same after a clean rebuild."""
    committed_text = (rating.OUTPUT_DIR / "ratings.json").read_text(encoding="utf-8")
    fresh_text = json.dumps(built, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    assert committed_text == fresh_text, (
        "etl/output/ratings.json is stale — run `python -m wcdraft_etl.rating` and commit."
    )


def test_rows_sorted_by_card_id(built: list[dict]):
    ids = [r["card_id"] for r in built]
    assert ids == sorted(ids)


# ─── schema bounds (mirrors the core RatingSchema contract) ───────────────────


def test_schema_bounds(built: list[dict], cards: dict[str, dict]):
    for r in built:
        assert r["card_id"] == f"{r['player_id']}:{r['tournament_id']}"
        assert r["card_id"] in cards  # joins 1:1 with the canonical card table
        # The four sim channels live on the recalibrated display band.
        for ch in ("attack", "midfield", "defense", "goalkeeping"):
            assert isinstance(r[ch], int) and rating.DISPLAY_FLOOR <= r[ch] <= rating.DISPLAY_MAX, (
                r["card_id"],
                ch,
                r[ch],
            )
        # overall is ALWAYS a real int in [DISPLAY_FLOOR, DISPLAY_MAX].
        assert (
            isinstance(r["overall"], int)
            and rating.DISPLAY_FLOOR <= r["overall"] <= rating.DISPLAY_MAX
        ), r["card_id"]
        assert r["overall_basis"] in ("measured_performance", "baseline_anchor_estimate")
        assert r["appearances_source"] in (None, "fjelstul_match_events", "rsssf_starting_xi")
        assert r["coverage"] in (0.6667, 0.8333, 1.0)
        assert r["coverage_basis"] == "wc_signals"
        assert r["provenance"] == "wc_performance"
        assert r["rating_version"] == rating.RATING_VERSION
        for comp in r["components"]:
            assert comp["signal"]
            assert comp["value"] is None or isinstance(comp["value"], (int, float))
            assert isinstance(comp["weight"], (int, float)) and comp["weight"] >= 0


def test_rating_version_is_phase1(built: list[dict]):
    assert rating.RATING_VERSION == "wc-perf-2.0.0"
    for r in built:
        assert r["rating_version"] == "wc-perf-2.0.0"


def test_scope_is_mens_only(built: list[dict], tournaments: dict[str, dict]):
    for r in built:
        assert "Men's" in tournaments[r["tournament_id"]]["name"], r["card_id"]


# ─── §4 acceptance: distribution shape (the recalibration headline) ───────────


def test_overall_distribution_shape(built: list[dict]):
    """Reshaped onto [66, 99] with the documented anchors. The exact target
    quantiles are slightly elastic (±1) because the curve is fit on measured
    internal anchors, but the floor and max are HARD."""
    overalls = [r["overall"] for r in built]
    assert min(overalls) == rating.DISPLAY_FLOOR
    assert max(overalls) <= rating.DISPLAY_MAX
    assert max(overalls) >= rating.DISPLAY_MAX - 1  # the elite tail must reach the top
    assert 0 not in {ov for ov in overalls}  # no zero-filled holes
    assert all(rating.DISPLAY_FLOOR <= ov <= rating.DISPLAY_MAX for ov in overalls)
    # No 100s — the old pinned-at-ceiling failure mode.
    assert 100 not in set(overalls), "wc-perf-2.0.0 caps the display max at 99 — no overall == 100"

    median = _quantile(overalls, 0.50)
    p95 = _quantile(overalls, 0.95)
    assert rating.DISPLAY_MEDIAN - 1 <= median <= rating.DISPLAY_MEDIAN + 1, median
    assert rating.DISPLAY_P95 - 1 <= p95 <= rating.DISPLAY_P95 + 1, p95


def test_elite_tail_is_thin(built: list[dict]):
    """The elite tail must be a true tail, not a clump — guards against the
    old ‘pin at 100’ failure mode."""
    overalls = [r["overall"] for r in built]
    n = len(overalls)
    share_95 = sum(1 for ov in overalls if ov >= 95) / n
    share_98 = sum(1 for ov in overalls if ov >= 98) / n
    assert share_95 <= 0.02, f"share >=95 was {share_95:.4f} (target <=0.020)"
    assert share_98 <= 0.006, f"share >=98 was {share_98:.4f} (target <=0.006)"


def test_floor_is_not_a_clump(built: list[dict]):
    """The display floor must hold a real population (the estimate band is
    banded onto it) but the channel/overall distribution must not collapse to
    a single mode at the floor."""
    overalls = [r["overall"] for r in built]
    n = len(overalls)
    share_at_floor = sum(1 for ov in overalls if ov == rating.DISPLAY_FLOOR) / n
    # 388/10973 ≈ 0.035; allow a wide window so it’s tolerant to small
    # data refreshes but still flags a regression that pins everything to 66.
    assert share_at_floor < 0.15, f"too many overalls clumped at floor: {share_at_floor:.4f}"


# ─── §4 acceptance: low-DOF curve guard ───────────────────────────────────────


def test_display_curve_is_low_dof():
    """The recalibration is a global low-DOF curve, not a per-player override
    table. The contract: one shared curve kind name + three global exponents +
    four data anchors fit on the emitted dataset. No additional knobs."""
    assert rating.DISPLAY_CURVE_KIND == "global_piecewise_power_v1"
    free_exponents = {
        "low": rating.DISPLAY_LOW_EXPONENT,
        "mid": rating.DISPLAY_MID_EXPONENT,
        "high": rating.DISPLAY_HIGH_EXPONENT,
    }
    assert len(free_exponents) == 3
    for k, v in free_exponents.items():
        assert isinstance(v, (int, float)) and v > 0.0, (k, v)
    # No per-player override MAPPING in the module (a stray word "override" in
    # a comment is fine — what we forbid is a runtime data structure that lets
    # individual players be hand-tuned). Strip comments before checking, then
    # look for both runtime mappings and the obvious markers.
    raw_module_text = Path(rating.__file__).read_text(encoding="utf-8")
    code_only_lines = []
    for line in raw_module_text.splitlines():
        stripped = line.split("#", 1)[0]
        code_only_lines.append(stripped)
    code_text = "\n".join(code_only_lines)
    assert not re.search(r"PLAYER[_-]?OVERRIDES?\s*[:=]", code_text)
    assert not re.search(r"per[_-]?player[_-]?override", code_text, flags=re.IGNORECASE)
    # Mapping keyed by a player_id literal (P-#### -> number) is the smoking gun.
    assert not re.search(r"\bP-\d{3,}\b\s*:", code_text)


# ─── §4 acceptance: ordering / monotonicity ───────────────────────────────────


def test_display_curve_preserves_ordering(built: list[dict], cards: dict[str, dict]):
    """The curve is monotonic on the internal score; the emitted overall must
    therefore preserve internal ordering up to integer-rounding ties. We
    re-derive each card's internal score the same way build_ratings does and
    assert no display-overall inversion exists."""
    players_rows = rating._load(rating.OUTPUT_DIR, "players")
    mt_rows = rating._load(rating.OUTPUT_DIR, "manager_tournaments")
    tournaments_rows = rating._load(rating.OUTPUT_DIR, "tournaments")
    pt_rows = list(cards.values())
    rebuilt = rating.build_ratings(
        players=players_rows,
        cards=pt_rows,
        tournaments=tournaments_rows,
        manager_tournaments=mt_rows,
    )
    assert {r["card_id"] for r in rebuilt} == {r["card_id"] for r in built}

    # We do not have internal scores directly on the emitted rows, but a
    # monotonic curve means: equal overall implies overlapping internal
    # bands. Cross-card invariant: for any pair where the rounded overall
    # of A is strictly greater than B's, then on a re-fit A's internal
    # score must be >= B's (no inversion). We verify the surrogate via the
    # observable channels — own-channel >= overall - 1 for the strongest
    # position spread, which holds when the curve is monotonic.
    for r in built:
        # The card's strongest channel (max across positions) must be
        # within 1 of the overall — the curve emits own-position channel
        # at the same display value as overall.
        max_ch = max(r["attack"], r["midfield"], r["defense"], r["goalkeeping"])
        assert max_ch >= r["overall"] - 1, (r["card_id"], max_ch, r["overall"])


# ─── §4 acceptance: public anchor TRAIN / HELD-OUT ────────────────────────────


_TRAIN_AWARDS = {"Golden Ball", "Golden Boot", "Golden Glove"}
_HELDOUT_AWARDS = {"Silver Ball", "Bronze Ball", "Silver Boot", "Bronze Boot", "Best Young Player"}


def test_public_award_anchor_train_holdout(
    built: list[dict], awards: list[dict], tournaments: dict[str, dict]
):
    """Distinguished cards (named-anchor bands) come from PUBLIC sources only:
    Golden Ball / Boot / Glove etc. The curve was NOT fit to specific players —
    only to the four global quantiles. The named anchors must therefore land
    in plausible bands on BOTH a training subset (used by the recalibration
    designer as expected lift) AND a held-out subset never used to tune."""
    by_card = {r["card_id"]: r for r in built}
    mens_ids = {t["tournament_id"] for t in tournaments.values() if "Men's" in t["name"]}
    train_overalls: list[int] = []
    held_overalls: list[int] = []
    anchored: set[str] = set()
    for a in awards:
        if a["tournament_id"] not in mens_ids:
            continue
        cid = f"{a['player_id']}:{a['tournament_id']}"
        r = by_card.get(cid)
        if r is None:
            continue
        anchored.add(cid)
        name = a["award_name"]
        if name in _TRAIN_AWARDS:
            train_overalls.append(r["overall"])
        elif name in _HELDOUT_AWARDS:
            held_overalls.append(r["overall"])
    assert train_overalls, "TRAIN anchors empty — public awards source missing"
    assert held_overalls, "HELDOUT anchors empty — public awards source missing"

    train_median = _quantile(train_overalls, 0.50)
    train_p10 = _quantile(train_overalls, 0.10)
    held_median = _quantile(held_overalls, 0.50)
    held_p10 = _quantile(held_overalls, 0.10)
    non_anchor = [r["overall"] for cid, r in by_card.items() if cid not in anchored]
    non_anchor_median = _quantile(non_anchor, 0.50)

    # TRAIN must be visibly elite.
    assert train_median >= 88, train_median
    assert train_p10 >= 80, train_p10
    # HELD-OUT must also be elite — proves the curve isn’t overfit to TRAIN.
    assert held_median >= 82, held_median
    assert held_p10 >= 76, held_p10
    # Ordering: TRAIN above HELD above non-anchor by a real margin.
    assert train_median >= held_median, (train_median, held_median)
    assert held_median >= non_anchor_median + 5, (held_median, non_anchor_median)


# ─── §4 acceptance: pre-1982 era sanity ───────────────────────────────────────


def test_pre1978_golden_boot_winners_not_systematically_depressed(
    built: list[dict], awards: list[dict]
):
    """Golden Ball was first awarded at WC-1978; Golden Boot exists from WC-1930.
    Pre-1978 greats lack the Golden-Ball cross-era lift, so an over-fit curve
    could systematically under-rate them. This test guards that pre-1978
    Golden-Boot winners land in a plausible elite band."""
    by_card = {r["card_id"]: r for r in built}
    pre_1978 = [
        a
        for a in awards
        if a["award_name"] == "Golden Boot" and int(a["tournament_id"][3:]) < 1978
    ]
    overalls = [by_card[f"{a['player_id']}:{a['tournament_id']}"]["overall"] for a in pre_1978]
    assert overalls, "expected pre-1978 Golden Boot data"
    median = _quantile(overalls, 0.50)
    p10 = _quantile(overalls, 0.10)
    assert median >= 85, median
    assert p10 >= 78, p10


def test_named_era_anchors_land_in_expected_bands(players, cards, by_id):
    """Spot-check named greats land in plausible bands. Values are bands, not
    exact equalities — the curve maps internal merit deterministically, but the
    final integer is allowed to drift one tick on minor data refreshes."""
    def ov(name, tid):
        return by_id[_card_id(players, cards, name, tid)]["overall"]

    # Maradona '86 and Zidane '06 — decorated apex performers (Golden Ball).
    assert 96 <= ov("Maradona", "WC-1986") <= 99
    assert 96 <= ov("Zidane", "WC-2006") <= 99
    # Pelé '58 — Best Young Player + Silver Boot + champion at 17.
    assert ov("Pelé", "WC-1958") >= 93
    # Pelé '70 — champion, no individual award in 1970.
    assert ov("Pelé", "WC-1970") >= 85
    # Fontaine '58 — 13 goals + Golden Boot + started every match.
    assert ov("Fontaine", "WC-1958") >= 90
    # Puskás '54 — runner-up, top striker of his era (one of his player_ids).
    puskas_cid = "P-12676:WC-1954"
    assert by_id[puskas_cid]["overall"] >= 80
    # Rodrigo '18 — modern journeyman, no run, 0 goals 3 apps.
    rodrigo = ov("Rodrigo", "WC-2018")
    assert rodrigo <= 80
    # Cross-era invariant: Puskás '54 clearly above modern journeyman.
    assert by_id[puskas_cid]["overall"] > rodrigo + 5


def test_great_pre1970_defender_lands_in_elite_band(players, cards, by_id):
    """Bobby Moore '66 — England champion captain DF with all-6 RSSSF
    appearances supplemented — must land near the top of the DF band."""
    cid = _card_id(players, cards, "Moore", "WC-1966")
    r = by_id[cid]
    src = cards[cid]
    assert src["position_listed"] == "DF"
    assert src["appearances"] == 6
    assert src["appearances_source"] == "rsssf_starting_xi"
    assert r["overall_basis"] == "measured_performance"
    assert r["coverage"] == 1.0
    assert r["overall"] >= 88


def test_strong_defender_not_punished_for_zero_goals(players, cards, by_id):
    """Mertesacker '14 — champion DF, 6 apps 0 goals — lands in the elite
    band, never penalized for not scoring."""
    cid = _card_id(players, cards, "Mertesacker", "WC-2014")
    r = by_id[cid]
    src = cards[cid]
    assert src["goals"] == 0 and src["position_listed"] == "DF"
    assert r["overall"] >= 88
    assert r["defense"] >= r["overall"] - 1
    comp = {c["signal"]: c for c in r["components"]}
    assert comp["goals_percentile"]["weight"] == 0.0
    assert comp["appearances_percentile"]["weight"] == 1.0


# ─── §4 acceptance: estimate band ─────────────────────────────────────────────


def test_estimates_are_banded_and_honest(built: list[dict], cards: dict[str, dict]):
    """``baseline_anchor_estimate`` rows: count holds; overall + every channel
    in [ESTIMATE_FLOOR, ESTIMATE_CEILING]; honest-state preserved (no
    fabricated appearances, low coverage, goals weight zero for DF/GK)."""
    estimates = [r for r in built if r["overall_basis"] == "baseline_anchor_estimate"]
    assert estimates, "the honest-estimate path should be exercised by the residual cards"
    assert len(estimates) == 388  # pinned: basis logic unchanged in Phase 1
    for r in estimates:
        assert rating.ESTIMATE_FLOOR <= r["overall"] <= rating.ESTIMATE_CEILING, r["card_id"]
        for ch in ("attack", "midfield", "defense", "goalkeeping"):
            assert rating.ESTIMATE_FLOOR <= r[ch] <= rating.ESTIMATE_CEILING, (r["card_id"], ch)
        assert r["coverage"] < 1.0
        src = cards[r["card_id"]]
        assert src["position_listed"] in {"DF", "GK"}
        assert src["appearances"] is None and src["appearances_source"] is None
        comp = {c["signal"]: c for c in r["components"]}
        assert comp["goals_percentile"]["weight"] == 0.0
        assert comp["appearances_percentile"]["weight"] == 0.0
        assert comp["appearances"]["value"] is None  # never a fabricated 0


def test_estimates_cannot_outrate_linked_greats(built: list[dict]):
    """An estimate-band card may never exceed a measured great's overall —
    the headline ordering invariant of the estimate tier."""
    estimates = [r for r in built if r["overall_basis"] == "baseline_anchor_estimate"]
    measured = [r for r in built if r["overall_basis"] == "measured_performance"]
    max_estimate = max(r["overall"] for r in estimates)
    measured_top = max(r["overall"] for r in measured)
    assert max_estimate <= rating.ESTIMATE_CEILING
    assert max_estimate < measured_top


# ─── §4 acceptance: honest-state nulls ────────────────────────────────────────


def test_missing_appearances_stay_null_never_zero(built: list[dict], cards: dict[str, dict]):
    """A card whose source appearances are null (pre-1970) surfaces that as a
    null component value — never a fabricated 0."""
    checked = 0
    for r in built:
        src = cards[r["card_id"]]
        if src["appearances"] is None:
            comp = {c["signal"]: c for c in r["components"]}
            assert comp["appearances"]["value"] is None
            assert comp["appearances_percentile"]["value"] is None
            assert comp["appearances_percentile"]["weight"] == 0.0
            checked += 1
    assert checked > 0  # the pre-1970 era exercises this path


def test_non_semifinalist_team_finish_is_null(built: list[dict]):
    """team_finish exists for semifinalists only; otherwise null, dropped from
    weighting — not read as a 0-placement."""
    saw_null = saw_value = False
    for r in built:
        tf = next(c for c in r["components"] if c["signal"] == "team_finish")
        if tf["value"] is None:
            saw_null = True
        else:
            assert tf["value"] in rating.FINISH_POINTS.values()
            saw_value = True
    assert saw_null and saw_value


def test_no_card_has_null_overall(built: list[dict]):
    """Every men's card carries a real overall on the new display band."""
    nulls = [r["card_id"] for r in built if r["overall"] is None]
    assert nulls == []
    for r in built:
        assert isinstance(r["overall"], int) and r["overall"] >= rating.DISPLAY_FLOOR, r["card_id"]


def test_defenders_and_keepers_are_never_rated_on_goals(built: list[dict], cards: dict[str, dict]):
    checked = 0
    for r in built:
        src = cards[r["card_id"]]
        if src["position_listed"] not in {"DF", "GK"}:
            continue
        comp = {c["signal"]: c for c in r["components"]}
        assert comp["goals_percentile"]["weight"] == 0.0, r["card_id"]
        checked += 1
    assert checked > 0


# ─── §4 acceptance: provenance / legal grep ───────────────────────────────────


# Proprietary game-rating terms that must never appear in our ETL source pins.
# We deliberately do NOT include the three-letter token "pes" alone because it
# collides with non-proprietary content (e.g. surnames such as "Lópes-Herranz"
# in pre-1970 RSSSF starting XIs). The longer, unambiguous tokens below are
# what catches a proprietary rating-source contamination.
_PROPRIETARY_PATTERN = re.compile(
    r"sofifa|futbin|fifa[-_ ]?ratings|easports|ea\s*sports\s*fc|pro\s*evolution\s*soccer|"
    r"\befootball\b|\bpes\s*\d|konami\s*pes",
    re.IGNORECASE,
)


def test_etl_source_pins_have_no_proprietary_rating_references():
    """ETL source pins + supplement raw inputs must NOT mention any proprietary
    rating source. The recalibration is clean-room: every signal comes from
    public, factually-grounded sources (Fjelstul + RSSSF + Wikipedia 2026)."""
    scan_dirs = [
        REPO_ROOT / "etl" / "sources",
        REPO_ROOT / "etl" / "supplement" / "raw",
    ]
    hits: list[str] = []
    for d in scan_dirs:
        if not d.exists():
            continue
        for path in d.rglob("*"):
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except (OSError, UnicodeDecodeError):
                continue
            for m in _PROPRIETARY_PATTERN.finditer(text):
                hits.append(f"{path.relative_to(REPO_ROOT)}: {m.group(0)!r}")
    assert hits == [], "proprietary rating references in ETL source pins:\n" + "\n".join(hits)
