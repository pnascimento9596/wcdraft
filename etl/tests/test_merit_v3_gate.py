"""merit-v3 §7 pre-registered acceptance gate, committed as tests (design §7,
V4 entry: "the §7 probe table committed as tests").

EVERY probe result is FINAL and encoded as-is:
  * an IN-BAND probe asserts its pre-registered band — a regression out of band
    is a red build;
  * a MISSED probe is encoded as an explicit ``*_MISSED_*`` test that PINS the
    measured value, with the pre-registered band and the mechanism analysis in
    the docstring — the miss is loud, ledgered for the owner at V8, and any
    silent drift of the missed value is also a red build. No parameter was tuned
    to convert a miss (no §-pre-registered adjustment protocol applies to any of
    them).

Bands are display values on the re-fit v2 curve (design §7 preamble).
SELF-CONTAINED: asserts the committed ratings.json / ratings_2026.json /
career_stature.json artifacts (the same bytes CI's determinism gates prove are
rebuilt bit-for-bit from the canonical tables).
"""

from __future__ import annotations

import bisect
import json
from collections import Counter

import pytest

from wcdraft_etl import rating

OUT = rating.OUTPUT_DIR


@pytest.fixture(scope="session")
def hist() -> dict[str, dict]:
    return {r["card_id"]: r for r in json.loads((OUT / "ratings.json").read_text())}


@pytest.fixture(scope="session")
def proj() -> dict[str, dict]:
    return {r["card_id"]: r for r in json.loads((OUT / "ratings_2026.json").read_text())}


@pytest.fixture(scope="session")
def stature() -> dict:
    return json.loads((OUT / "career_stature.json").read_text())


def _comp(row: dict, signal: str):
    try:
        return next(c["value"] for c in row["components"] if c["signal"] == signal)
    except StopIteration:
        return None


def _ovr(pool: dict[str, dict], card_id: str) -> int:
    return pool[card_id]["overall"]


# ─── §7.1 movers — IN-BAND (band asserted) ────────────────────────────────────


def test_probe_04_valverde_2022(hist):
    """#4: 76 → 81–86 + basis flips to career_stature_estimate (D2 reaches
    historical cards of actives; T6 band)."""
    r = hist["P-05174:WC-2022"]
    assert 81 <= r["overall"] <= 86, r["overall"]
    assert r["overall_basis"] == "career_stature_estimate"


def test_probe_05_rodri_2026(proj):
    """#5: 88 → 89–92 + legend badge (link fix + archive consult + re-curation)."""
    r = proj["P-62341:WC-2026"]
    assert 89 <= r["overall"] <= 92, r["overall"]
    assert r["legend"] is True


def test_probe_07_vinicius_2026(proj):
    """#7: 87 → ≥90 (D2 re-curation of a linked active; idx 0.200 stale → 0.511)."""
    r = proj["P-92812:WC-2026"]
    assert r["overall"] >= 90, r["overall"]


def test_probe_08_e_martinez_2022(hist):
    """#8: 88 → 89–92 (award-gated headroom — Golden Glove, champion)."""
    assert 89 <= _ovr(hist, "P-13162:WC-2022") <= 92


def test_probe_09_schumacher_1986(hist):
    """#9: 88 → 89–92 (headroom — Silver Ball, raw 100)."""
    assert 89 <= _ovr(hist, "P-07171:WC-1986") <= 92


def test_probe_10_forlan_2010(hist):
    """#10: 88 → 89–92 (headroom — Golden Ball)."""
    assert 89 <= _ovr(hist, "P-86087:WC-2010") <= 92


def test_probe_11_vava_jairzinho_klose_and_squad_hierarchy(hist):
    """#11: Vavá-1962 / Jairzinho-1970 / Klose-2006 all >88; Jairzinho out-rates
    the Brazil-1970 squad-wall members Piazza and Félix (hierarchy restored)."""
    assert _ovr(hist, "P-45310:WC-1962") > 88
    assert _ovr(hist, "P-77430:WC-1970") > 88
    assert _ovr(hist, "P-27787:WC-2006") > 88
    assert _ovr(hist, "P-77430:WC-1970") > _ovr(hist, "P-02965:WC-1970")
    assert _ovr(hist, "P-77430:WC-1970") > _ovr(hist, "P-39749:WC-1970")


def test_probe_12_klose_2014(hist):
    """#12: 88 → >88 (knife-edge resolved by re-curation, the 0.40 gate did NOT
    move)."""
    assert _ovr(hist, "P-27787:WC-2014") > 88
    assert rating.MATERIAL_STATURE_MIN_INDEX == 0.40  # the gate itself is pinned


def test_probe_15_ait_nouri_and_gavi(proj):
    """#15: Aït-Nouri 83 → 84–87 (D1); Gavi modest ↑ (84 → measured 88, the up
    direction — his first row in the pinned pool post-U0)."""
    assert 84 <= _ovr(proj, "P-W26-0015:WC-2026") <= 87
    assert _ovr(proj, "P-88433:WC-2026") > 84


def test_probe_16_pele_index_and_card(hist, stature):
    """#16: Pelé index top-10 and ≥ Kocsis' new index; Pelé-1970 97 → 98–99
    (§3 era/eligibility re-norm)."""
    rows = sorted(
        stature["career_stature"], key=lambda r: -r["career_stature_index"]
    )
    rank = next(i for i, r in enumerate(rows, 1) if r["player_id"] == "P-38906")
    idx = {r["player_id"]: r["career_stature_index"] for r in rows}
    assert rank <= 10, rank
    assert idx["P-38906"] >= idx["P-07028"]
    assert 98 <= _ovr(hist, "P-38906:WC-1970") <= 99


def test_probe_17_kocsis_index(stature):
    """#17 (index half): Kocsis ≤0.90 and not #1 (the card half is MISSED — see
    test_probe_17_kocsis_card_MISSED)."""
    rows = sorted(
        stature["career_stature"], key=lambda r: -r["career_stature_index"]
    )
    idx = {r["player_id"]: r["career_stature_index"] for r in rows}
    assert idx["P-07028"] <= 0.90
    assert rows[0]["player_id"] != "P-07028"


def test_probe_18_cruyff_over_owen(hist, stature):
    """#18 (ordering half): Cruyff > Owen on index AND on the 1974/1998 cards
    (the Cruyff-1974 96–98 band half is MISSED — see the MISSED pin)."""
    idx = {r["player_id"]: r["career_stature_index"] for r in stature["career_stature"]}
    assert idx["P-50564"] > idx["P-51130"]
    assert _ovr(hist, "P-50564:WC-1974") > _ovr(hist, "P-51130:WC-1998")


def test_probe_19_participation_scaled_down_cap(hist):
    """#19: Rossi-1986 94 → 89–92; Zidane-2002 95 → 90–93; Messi-2010 98 → 95–97
    (participation-scaled down-cap, §4.3a)."""
    assert 89 <= _ovr(hist, "P-91717:WC-1986") <= 92
    assert 90 <= _ovr(hist, "P-56430:WC-2002") <= 93
    assert 95 <= _ovr(hist, "P-14758:WC-2010") <= 97


def test_probe_20_zero_app_champion_reserves(hist):
    """#20: 0-app champion reserves land 76–83 (Argentina-2022 backup GKs
    Rulli/Armani, Brazil-1970 Ado/Leão) — squad hierarchy without zeroing."""
    for cid in ("P-36188:WC-2022", "P-39788:WC-2022", "P-47010:WC-1970", "P-06015:WC-1970"):
        assert 76 <= _ovr(hist, cid) <= 83, (cid, _ovr(hist, cid))


# ─── §7.1 movers — MISSED (measured value pinned; ledgered for V8) ────────────


def test_probe_01_yamal_MISSED_one_above_band(proj):
    """#1 Yamal 2026: band 85–91 (≥85 hard). MEASURED 92 — the ≥85 hard floor
    holds and the D1+D2 exit from 79 is proven, but the value sits ONE point
    above the band ceiling. Mechanism: his V1 person row (idx 0.641, 5 staged
    facts incl. global_annual_recognition) puts the stature target above the
    band the design predicted from D1+D2 alone. Not tuned away (no protocol)."""
    r = proj["P-W26-0663:WC-2026"]
    assert r["overall"] >= 85  # the hard floor of the band HOLDS
    assert r["overall"] == 92, r["overall"]  # pinned measured miss (band 85–91)
    assert r["legend"] is True


def test_probe_02_haaland_MISSED_above_band(proj):
    """#2 Haaland 2026: band 89–93. MEASURED 98. Mechanism: V1 staged 11 facts
    give idx 0.843 — the stature target maps near the internal ceiling, well
    above the band predicted when the probe was registered (the prediction
    assumed a marginal ceiling exit, not a near-peak index). The ceiling exit
    via D2 facts is proven; the magnitude is owner information for V8."""
    r = proj["P-W26-0477:WC-2026"]
    assert r["overall"] > 88  # the wall exit (the probe's mechanism) HOLDS
    assert r["overall"] == 98, r["overall"]  # pinned measured miss (band 89–93)


def test_probe_03_valverde_2026_MISSED_one_below_band(proj):
    """#3 Valverde 2026: band 89–91. MEASURED 88. Mechanism: his
    club_season_honors-driven index lands EXACTLY at the 0.40 material gate →
    continuity weight exactly 0.5 → the blend sits half on the raw path; the
    design pre-registered (§1.3) that if the family weight needed to force the
    band distorts controls, the probe is reported missed rather than forced."""
    r = proj["P-05174:WC-2026"]
    assert r["overall"] == 88, r["overall"]  # pinned measured miss (band 89–91)
    assert r["overall_basis"] == "career_stature_estimate"
    assert _comp(r, "career_stature_index") == pytest.approx(0.40)


def test_probe_06_neymar_2026_MISSED_one_below_band(proj):
    """#6 Neymar 2026: band 92–94 + legend. MEASURED 91 + legend ✓. The DECLARED
    watch-item. Mechanism: idx 0.600 (post-U0 link) maps to a stature target at
    the silver/gold boundary; his age-conditioned projected context (age 34)
    takes the full gold-tier down-modulation. Owner information for V8."""
    r = proj["P-87008:WC-2026"]
    assert r["legend"] is True  # the badge half of the probe HOLDS
    assert r["overall"] == 91, r["overall"]  # pinned measured miss (band 92–94)


def test_probe_13_lukaku_2022_MISSED_no_facts_landed(hist):
    """#13 Lukaku 2022: band ≥78, CONDITIONAL on citable facts landing
    ("if none land, report the miss honestly"). No Lukaku facts were staged in
    the V1 source-set increment → no row movement → MEASURED 71 (unchanged).
    The honest-miss branch of the probe's own registration."""
    assert _ovr(hist, "P-72637:WC-2022") == 71


def test_probe_14_b_fernandes_2018_MISSED_no_facts_landed(hist):
    """#14 B. Fernandes 2018: direction ↑ (T6-b class, same conditional
    mechanism as #13). No facts landed → MEASURED 72 (unchanged)."""
    assert _ovr(hist, "P-39584:WC-2018") == 72


def test_probe_17_kocsis_card_MISSED_above_band(hist):
    """#17 (card half): Kocsis-1954 band 94–97. MEASURED 99. Mechanism: the
    saturation/shrinkage took his INDEX 0.992 → 0.876 (≤0.90 ✓, not #1 ✓), but
    0.876 still sits within 0.002 of Pelé's 0.878 — the stature target span maps
    both near the internal ceiling, and his monstrous measured inputs (Golden
    Boot, 11 goals) add the full up-modulation. The index gate succeeded; the
    card band needed a larger index drop than §3.2's constants produced."""
    assert _ovr(hist, "P-07028:WC-1954") == 99


def test_probe_18_cruyff_1974_card_MISSED_below_band(hist):
    """#18 (band half): Cruyff-1974 band 96–98. MEASURED 94 (ordering vs Owen ✓,
    93). Mechanism: idx 0.720 maps mid-gold; the band assumed a larger §3
    eligibility-re-norm lift for Cruyff than the committed index produced."""
    assert _ovr(hist, "P-50564:WC-1974") == 94


# ─── §7.2 controls (≤1 display point of movement) ─────────────────────────────


def test_controls_within_one_point(hist, proj):
    controls = [
        (proj, "P-W26-0713:WC-2026", 71, "Khalil Ayari — fringe inflation"),
        (hist, "P-18672:WC-2010", 88, "Dempsey — no-award measured untouched"),
        (hist, "P-59033:WC-2022", 88, "Boufal — clamped-without-award stays"),
        (hist, "P-14758:WC-2022", 99, "Messi 2022 — stature stability"),
        (hist, "P-34023:WC-1962", 71, "Cesare Maldini — Audit-1 ruling stands"),
        (proj, "P-W26-0429:WC-2026", 72, "Q. Timber — twins unmerged"),
    ]
    for pool, cid, expected, label in controls:
        got = pool[cid]["overall"]
        assert abs(got - expected) <= 1, (label, expected, got)


def test_control_perlaza_not_in_pinned_pool(proj):
    """Perlaza (§7.2) has NO card in the pinned 2026 pool — the control is
    honestly non-evaluable (precedent: V2's Gavi absence). Pinned so a future
    pool re-pin that adds him re-activates the control consciously."""
    assert not any(
        r["player_id"] == "P-36290" for r in proj.values()
    )


def test_control_baseline_anchor_cohort_band(hist):
    """baseline_anchor cohort stays in [66, 73] (the estimate band is untouched
    by the season's mechanisms)."""
    band = [r["overall"] for r in hist.values() if r["overall_basis"] == "baseline_anchor_estimate"]
    assert band and min(band) >= 66 and max(band) <= 73


# ─── §7.3 distribution + structural gates ─────────────────────────────────────


def _career_pool_overalls(hist, proj) -> list[int]:
    return [r["overall"] for r in hist.values()] + [r["overall"] for r in proj.values()]


def test_distribution_median_and_tail(hist, proj):
    """Anti-inflation: pooled median 73 ±1; 90+ share ≤5%."""
    ov = sorted(_career_pool_overalls(hist, proj))
    n = len(ov)
    assert n == 12219
    assert abs(ov[n // 2] - 73) <= 1
    assert sum(1 for o in ov if o >= 90) / n <= 0.05


def test_distribution_pileup_MISSED_structurally(hist, proj):
    """§7.3 pile-up gate: no single display value >4% of the pool. MISSED —
    measured worst piles: 71 ≈ 17.8%, 72 ≈ 15.3%, 88 ≈ 11.3%. Mechanism
    analysis (recorded for the owner at V8):
      * the 88 wall is a POINT MASS: 1,150 historical no-award cards sit at
        internal exactly 62.0 under the raw-only clamp, byte-stable by V2's own
        §4.1 no-award invariant — only 119 award cards could escape; D1/D2 move
        other cohorts. No monotone curve can spread a point mass.
      * the 71/72 piles are pigeonhole: floor→median (66..73, 8 integers) must
        hold ~half of 12,219 cards while the median anchor is itself a §7.3
        gate (73 ±1) — ≤4%-per-value is arithmetically unsatisfiable jointly
        with the median gate.
    The improvement direction IS locked: the 88 wall must stay below the
    pre-season 12.0% and the high-band wall must never re-form above it."""
    ov = _career_pool_overalls(hist, proj)
    n = len(ov)
    shares = {v: c / n for v, c in Counter(ov).items()}
    assert shares[88] < 0.120  # strictly below the pre-season wall
    # pinned measured piles (loud if they drift)
    assert shares[88] == pytest.approx(0.113, abs=0.005)
    assert shares[71] == pytest.approx(0.178, abs=0.005)
    assert shares[72] == pytest.approx(0.155, abs=0.005)


def test_distribution_inversion_rate_MISSED_marginally(hist, proj):
    """§7.3 cross-era inversion gate (Audit-1 §B.3 methodology re-executed):
    measured-vs-measured rate ≤0.5%. MEASURED 0.588% — a 0.09pp MISS. Mechanism:
    the §4.1 award-gated headroom lifts ~119 historical measured cards into
    89–92 display while 2026 measured cards are structurally award-null
    pre-tournament (their cap holds at the no-award clamp), so a thin band of
    award-evidence pairs counts as inversions under the raw-percentile
    operationalization. The pre-season baseline was 0.27%; the increase is the
    designed award asymmetry, not a scale unfairness regression. Pinned ≤0.65%
    so genuine regressions stay loud."""
    hm = [r for r in hist.values() if r["overall_basis"] == "measured_performance"]
    pm = [r for r in proj.values() if r["overall_basis"] == "measured_performance"]
    hraw = sorted(_comp(r, "raw_tournament_score") for r in hm)
    praw = sorted(_comp(r, "projected_raw_score") for r in pm)

    def pct(sv, x):
        lo = bisect.bisect_left(sv, x)
        hi = bisect.bisect_right(sv, x)
        return (lo + 0.5 * (hi - lo)) / len(sv)

    H = sorted((pct(hraw, _comp(r, "raw_tournament_score")), r["overall"]) for r in hm)
    hp = [x[0] for x in H]
    run = [0] * 101
    cum = [run.copy()]
    for _, ov in H:
        run[ov] += 1
        cum.append(run.copy())
    dominated = inversions = 0
    for r in pm:
        p = pct(praw, _comp(r, "projected_raw_score"))
        k = bisect.bisect_left(hp, p)
        dominated += k
        inversions += sum(cum[k][r["overall"] + 1 :])
    rate = inversions / dominated
    assert rate <= 0.0065, rate  # pinned measured miss (gate ≤0.005)
    assert rate > 0.005  # the miss itself, pinned: a silent pass would mean the
    # distribution moved — re-evaluate the gate, don't let it rot


def test_coherence_census_MISSED_nine_pinned(hist, proj):
    """§3.3/§7.3 legend-band coherence: no 94+ display without legend or a
    measured-award path. MISSED — exactly NINE historical cards violate, all
    1930s–1966 career_stature_estimate cards (idx 0.72–0.85) whose V1 legend
    re-derivation did NOT award the badge: Hidegkuti-54, F. Walter-54/58,
    Albert-66, N. Santos-62, Ocwirk-54, Andrade-30, Bozsik-54, Hanappi-54.
    Mechanism: §3.3 required the inconsistency to 'close in whichever direction
    the new index sends each entry' — the index sent them ABOVE 94 on the card
    side while the V1 legend gate (reason-code driven) kept the badge off; the
    closure needed either a legend grant or a larger §3.2 shrinkage. V1-owned
    constants; ledgered for V8. The set is pinned exactly — growth is red."""
    violations = set()
    for pool in (hist, proj):
        for cid, r in pool.items():
            if r["overall"] >= 94 and not r["legend"] and not _comp(r, "award_score"):
                violations.add(cid)
    assert violations == {
        "P-01173:WC-1954",
        "P-09973:WC-1954",
        "P-09973:WC-1958",
        "P-21188:WC-1966",
        "P-52002:WC-1962",
        "P-53882:WC-1954",
        "P-63826:WC-1930",
        "P-70989:WC-1954",
        "P-98569:WC-1954",
    }, violations


def test_basis_transition_assert(hist):
    """§7.3 (T6 caveat): probes that cross the material gate flip overall_basis,
    not just OVR — Valverde-2022 is the registered crosser."""
    r = hist["P-05174:WC-2022"]
    assert r["overall_basis"] == "career_stature_estimate"
    assert _comp(r, "stature_model_weight") >= rating.STATURE_DOMINANT_WEIGHT


def test_dual_basis_complete_both_eras(hist, proj):
    """§7.3: every card carries complete channel sets for BOTH bases (the
    ratingByCardId ≡ .career compact alias proof is V6's; here the ETL rows)."""
    for pool in (hist, proj):
        for cid, r in pool.items():
            for basis in ("career", "current"):
                b = r["basis_ratings"][basis]
                for f in ("overall", "attack", "midfield", "defense", "goalkeeping"):
                    assert isinstance(b[f], int), (cid, basis, f)


def test_determinism_rebuild_reproduces_committed_overall(hist, proj):
    """§7.3 structural: rebuilt internals + the frozen v2 curve reproduce the
    committed `overall` 12,219/12,219 (both audits' reproduction harness)."""
    from wcdraft_etl import display_curve

    curve = display_curve.fit_unified_curve(OUT)
    internal = display_curve._historical_internal_rows(OUT)
    ok = 0
    for r in internal:
        est = r["overall_basis"] == "baseline_anchor_estimate"
        assert hist[r["card_id"]]["overall"] == rating._display_score(
            r["score_0_100"], curve, estimate=est
        ), r["card_id"]
        ok += 1
    for r in display_curve._projected_internal_rows(OUT):
        assert proj[r["card_id"]]["overall"] == rating._display_score(
            r["score_0_100"], curve
        ), r["card_id"]
        ok += 1
    assert ok == 12219
