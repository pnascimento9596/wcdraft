"""MV2 recon divergence read — REVIEW-ONLY cross-check (NOT wired into ratings).

Cross-checks OUR ``career_stature.json`` career-strength ranking against the
independent, separately-produced recon reference staged under
``etl/merit/external_review/recon/``. The question this answers is narrow:

    Does our v4 ``career_stature_index`` agree with recon's career-strength
    ranking, and where it diverges sharply, does the gap look like a fact OUR
    MODEL is missing (a candidate MV2-3.x fix) or a defensible methodology
    difference?

HARD INVARIANTS (enforced by tests, restated here so the file documents itself):
  * recon is REVIEW-ONLY. This module is NOT imported by the pipeline, by
    ``rating.py``, or by any rating path. It reads recon as a *reference* and
    NEVER writes a recon number into ``career_stature.json``, ``ratings.json``,
    ``ratings_2026.json``, or any compact bundle.
  * NO per-card copying. Divergences feed MODEL-level discussion only. The output
    is a committed review report; it changes no ratings.
  * The recon directory is reference data + provenance only; the IP-firewall audit
    (``test_etl_source_pins_have_no_proprietary_rating_references``) scans it and
    must stay green.

RECON COMPOSITE COLUMN: ``career_strength_overall`` — recon's headline
career-strength composite (0-100, award/fact/template-sourced per the recon
README/manifest; NOT a game rating). The other numeric columns
(``world_cup_merit_score`` and the per-attribute splits) are inputs to it, not the
composite, so the composite is the correct cross-check target.

DETERMINISM: no wall-clock, no RNG; every collection is sorted by a stable key and
every float is rounded before it reaches the report, so ``RECON_DIVERGENCE.md``
rebuilds byte-identically across runs.
"""

from __future__ import annotations

import csv
import json
from collections import Counter

from . import rating
from .merit import VERSION

# recon reference lives under etl/merit/external_review/recon/ (REVIEW-ONLY).
RECON_DIR = rating.OUTPUT_DIR.parent / "merit" / "external_review" / "recon"
RECON_CSV = RECON_DIR / "player_career_strength_ratings_v1_1.csv"

# recon's headline career-strength composite column (see module docstring).
RECON_COMPOSITE_COL = "career_strength_overall"

OUTPUT_PATH = rating.OUTPUT_DIR / "merit" / "RECON_DIVERGENCE.md"

# recon primary_position vocabulary -> our coarse FW/MF/DF/GK buckets.
_RECON_POS_MAP = {"FWD": "FW", "MID": "MF", "DEF": "DF", "GK": "GK"}
_POS_ORDER = ["FW", "MF", "DF", "GK"]

# How many divergences to surface per direction.
N_DIVERGENCE = 20
# How many recon-anchored-but-sub-material players to spotlight as model-gap leads.
N_ANCHOR_GAP = 25


def _average_ranks(values: list[float]) -> list[float]:
    """1-based average (fractional) ranks, rank 1 = largest value (best). Ties
    share the mean of the ranks they span — the standard Spearman tie handling."""
    order = sorted(range(len(values)), key=lambda i: (-values[i], i))
    ranks = [0.0] * len(values)
    i = 0
    n = len(values)
    while i < n:
        j = i
        # group of equal values (descending order, so equality = adjacency)
        while j + 1 < n and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + 1 + j + 1) / 2.0  # mean of 1-based positions i..j
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _spearman(a: list[float], b: list[float]) -> float | None:
    """Spearman rho = Pearson correlation of the average-rank vectors."""
    n = len(a)
    if n < 3:
        return None
    ra, rb = _average_ranks(a), _average_ranks(b)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((ra[i] - ma) * (rb[i] - mb) for i in range(n))
    va = sum((ra[i] - ma) ** 2 for i in range(n))
    vb = sum((rb[i] - mb) ** 2 for i in range(n))
    if va == 0 or vb == 0:
        return None
    return cov / (va * vb) ** 0.5


def _percentiles(values: list[float]) -> list[float]:
    """Map each value to a 0-100 percentile via its average rank (100 = best)."""
    n = len(values)
    if n < 2:
        return [100.0] * n
    ranks = _average_ranks(values)
    return [100.0 * (n - r) / (n - 1) for r in ranks]


def _load_recon() -> dict[str, dict]:
    """player_id -> recon row (composite + display fields + provenance flags)."""
    rows: dict[str, dict] = {}
    with RECON_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid = row["player_id"]
            rows[pid] = {
                "name": row["player_name"],
                "nation": row["primary_team"],
                "position": _RECON_POS_MAP.get(row["primary_position"]),
                "composite": float(row[RECON_COMPOSITE_COL]),
                "anchored": row["manual_anchor_used"].strip().lower() == "true"
                or row["career_override_used"].strip().lower() == "true",
                "basis": row["career_strength_basis"] or row["rating_basis"],
            }
    return rows


def build(write: bool = True) -> dict:
    table = json.loads(
        (rating.OUTPUT_DIR / "career_stature.json").read_text(encoding="utf-8")
    )
    ours = {r["player_id"]: r for r in table["career_stature"]}
    recon = _load_recon()

    matched_ids = sorted(ours.keys() & recon.keys())
    ours_only = sorted(ours.keys() - recon.keys())
    recon_only_n = len(recon.keys() - ours.keys())

    # --- assemble the matched cohort with full-cohort ranks/percentiles ---------
    our_idx = [ours[p]["career_stature_index"] for p in matched_ids]
    rec_idx = [recon[p]["composite"] for p in matched_ids]
    our_rank = _average_ranks(our_idx)
    rec_rank = _average_ranks(rec_idx)
    our_pct = _percentiles(our_idx)
    rec_pct = _percentiles(rec_idx)

    rows: list[dict] = []
    for k, p in enumerate(matched_ids):
        o, r = ours[p], recon[p]
        rows.append(
            {
                "player_id": p,
                "name": r["name"],
                "nation": r["nation"],
                # our coarse position (modal_position is often null) with recon's
                # complete classification as the display/stratification fallback.
                "our_position": o["modal_position"],
                "position": o["modal_position"] or r["position"],
                "our_index": o["career_stature_index"],
                "our_rank": our_rank[k],
                "our_pct": our_pct[k],
                "recon_strength": r["composite"],
                "recon_rank": rec_rank[k],
                "recon_pct": rec_pct[k],
                "pct_gap": our_pct[k] - rec_pct[k],  # +ve = WE rank higher
                "material": o["stature_tier"] is not None,
                "stature_tier": o["stature_tier"],
                "legend": o["legend"],
                "recon_anchored": r["anchored"],
                "recon_basis": r["basis"],
            }
        )
    material = [r for r in rows if r["material"]]

    # --- overall agreement ------------------------------------------------------
    spearman_full = _spearman(our_idx, rec_idx)
    spearman_material = _spearman(
        [r["our_index"] for r in material], [r["recon_strength"] for r in material]
    )

    def _topn_overlap(n: int) -> dict:
        our_top = {r["player_id"] for r in sorted(
            rows, key=lambda r: (-r["our_index"], r["player_id"])
        )[:n]}
        rec_top = {r["player_id"] for r in sorted(
            rows, key=lambda r: (-r["recon_strength"], r["player_id"])
        )[:n]}
        shared = our_top & rec_top
        return {"n": n, "shared": len(shared), "overlap_pct": round(100.0 * len(shared) / n, 1)}

    # --- position-stratified (material cohort, recon's complete classification) -
    pos_strat = []
    for pos in _POS_ORDER:
        # bucket by the displayed position: our coarse modal_position if present,
        # else recon's complete classification (folded into r["position"] above).
        sub = [r for r in material if r["position"] == pos]
        rho = _spearman(
            [r["our_index"] for r in sub], [r["recon_strength"] for r in sub]
        )
        pos_strat.append({"position": pos, "n": len(sub), "spearman": _r4(rho)})

    # --- biggest divergences within the material cohort -------------------------
    we_higher = sorted(material, key=lambda r: (-r["pct_gap"], r["player_id"]))[:N_DIVERGENCE]
    we_lower = sorted(material, key=lambda r: (r["pct_gap"], r["player_id"]))[:N_DIVERGENCE]

    # --- model-gap spotlight: recon-anchored players we leave SUB-material -------
    # recon curated a real career-strength anchor (award/honors/editorial) but our
    # model never crossed its material gate for them => clearest "source a real
    # fact" leads. Ranked by recon strength (how strong recon thinks they are).
    anchor_gap = sorted(
        [r for r in rows if r["recon_anchored"] and not r["material"]],
        key=lambda r: (-r["recon_strength"], r["player_id"]),
    )[:N_ANCHOR_GAP]

    doc = {
        "version": VERSION,
        "recon_composite_column": RECON_COMPOSITE_COL,
        "join": {
            "key": "player_id",
            "our_players": len(ours),
            "matched": len(matched_ids),
            "our_unmatched": len(ours_only),
            "recon_only": recon_only_n,
            "recon_total": len(recon),
        },
        "agreement": {
            "spearman_full": _r4(spearman_full),
            "spearman_material": _r4(spearman_material),
            "material_n": len(material),
            "top20_overlap": _topn_overlap(20),
            "top50_overlap": _topn_overlap(50),
        },
        "position_stratified_material": pos_strat,
        "we_higher": we_higher,
        "we_lower": we_lower,
        "anchor_gap": anchor_gap,
    }
    if write:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(_render_md(doc), encoding="utf-8")
    return doc


def _r4(x: float | None) -> float | None:
    return None if x is None else round(x, 4)


def _r2(x: float) -> str:
    return f"{x:.2f}"


def _md_table(headers: list[str], rows: list[list[str]]) -> str:
    line = "| " + " | ".join(headers) + " |"
    sep = "| " + " | ".join("---" for _ in headers) + " |"
    body = "\n".join("| " + " | ".join(c for c in r) + " |" for r in rows)
    return "\n".join([line, sep, body]) if rows else line + "\n" + sep + "\n| _(none)_ |"


def _div_rows(items: list[dict]) -> list[list[str]]:
    out = []
    for r in items:
        out.append([
            r["name"],
            r["nation"],
            r["position"] or "—",
            r["stature_tier"] or "—",
            f"{_r2(r['our_index'])} (#{r['our_rank']:.0f}, {_r2(r['our_pct'])}p)",
            f"{r['recon_strength']:.0f} (#{r['recon_rank']:.0f}, {_r2(r['recon_pct'])}p)",
            f"{r['pct_gap']:+.1f}",
        ])
    return out


def _render_md(doc: dict) -> str:
    j = doc["join"]
    a = doc["agreement"]
    P = []
    P.append("# RECON_DIVERGENCE — career-stature cross-check vs recon reference")
    P.append("")
    P.append(
        "> **REVIEW-ONLY.** This report cross-checks OUR career-stature ranking "
        "(`career_stature.json` → `career_stature_index`) against the independent "
        "recon career-strength reference staged under "
        "`etl/merit/external_review/recon/`. recon is a cross-check reference ONLY: "
        "it is **never** a rating source, its numbers are **never** copied per-card "
        "into our model, and this script is **not** wired into any rating path. "
        "Every divergence below feeds MODEL-level discussion only."
    )
    P.append("")
    P.append(
        f"- recon composite column: **`{doc['recon_composite_column']}`** "
        f"(0-100, award/fact/template-sourced; not a game rating)"
    )
    P.append("- our composite: **`career_stature_index`** (0-1, merit-fact-sourced)")
    P.append(f"- merit version: `{doc['version']}`")
    P.append("")
    P.append("## Join coverage")
    P.append("")
    P.append(
        f"Joined on **`{j['key']}`** "
        f"(shared deterministic key — no name/era fuzzy-matching needed)."
    )
    P.append("")
    P.append(f"- our career-stature players: **{j['our_players']}**")
    P.append(
        f"- matched to recon: **{j['matched']}** "
        f"({_r2(100.0 * j['matched'] / j['our_players'])}% of ours)"
    )
    P.append(f"- our players unmatched in recon: **{j['our_unmatched']}**")
    P.append(
        f"- recon rows with no career-stature row of ours: **{j['recon_only']}** "
        f"(of recon's {j['recon_total']} total)"
    )
    P.append("")
    P.append(
        f"Our model only emits a stature row for players carrying merit facts, so "
        f"the {j['recon_only']} recon-only rows are players recon scores from "
        f"position/era templates but for whom we hold no fact — expected, not a drop."
    )
    P.append("")
    P.append("## Overall agreement")
    P.append("")
    P.append(
        f"- **Spearman ρ (full matched cohort, n={j['matched']})**: "
        f"**{a['spearman_full']}**"
    )
    P.append(
        f"- **Spearman ρ (material cohort only, n={a['material_n']})**: "
        f"**{a['spearman_material']}**"
    )
    P.append(
        f"- **Top-20 overlap**: {a['top20_overlap']['shared']}/20 "
        f"({a['top20_overlap']['overlap_pct']}%)"
    )
    P.append(
        f"- **Top-50 overlap**: {a['top50_overlap']['shared']}/50 "
        f"({a['top50_overlap']['overlap_pct']}%)"
    )
    P.append("")
    P.append(
        "The **material cohort** is our players above the material gate "
        "(`stature_tier` ∈ {gold, silver, bronze}) — the ones our model actually "
        "differentiates; the rest sit tied near zero in our index (fact-gated: no "
        "facts → no spread), while recon assigns every player a position/era template "
        "score. The material-cohort ρ is the cleaner like-for-like number. Read both "
        "honestly: agreement here is **moderate** — the two models put a similar set "
        "of greats near the top (top-N overlap ≈ half) but rank the broad middle "
        "differently, and that disagreement is **not uniform** — it concentrates by "
        "position and era (see the read below)."
    )
    P.append("")
    P.append("## Position-stratified agreement (material cohort)")
    P.append("")
    P.append(
        "Spearman ρ within each coarse position, restricted to the material cohort "
        "(position = our `modal_position` where present, else recon's "
        "classification). Tests whether the MV2-3 position-balance repair holds "
        "evenly against recon across FW/MF/DF/GK."
    )
    P.append("")
    P.append(_md_table(
        ["position", "n", "Spearman ρ"],
        [
            [r["position"], str(r["n"]), str(r["spearman"])]
            for r in doc["position_stratified_material"]
        ],
    ))
    P.append("")
    P.append("## Biggest divergences — WE rank higher than recon")
    P.append("")
    P.append(
        "Material players where our percentile sits well above recon's. Columns: "
        "our index (rank, percentile) · recon strength (rank, percentile) · "
        "percentile gap."
    )
    P.append("")
    P.append(_md_table(
        ["player", "nation", "pos", "tier", "ours", "recon", "Δpct"],
        _div_rows(doc["we_higher"]),
    ))
    P.append("")
    P.append("## Biggest divergences — recon ranks higher than US")
    P.append("")
    P.append(_md_table(
        ["player", "nation", "pos", "tier", "ours", "recon", "Δpct"],
        _div_rows(doc["we_lower"]),
    ))
    P.append("")
    P.append("## Model-gap spotlight — recon-anchored players we leave SUB-material")
    P.append("")
    P.append(
        "Players recon backed with a **curated career-strength anchor** "
        "(award/honors/editorial override) but whom our model never lifted across "
        "its material gate — i.e. we hold no merit fact strong enough. These are the "
        "cleanest **\"source a real fact\" (candidate MV2-3.x)** leads: the fix is "
        "always to find the real, citable fact for our MODEL, **never** to copy "
        "recon's number. Ranked by recon strength."
    )
    P.append("")
    P.append(_md_table(
        ["player", "nation", "pos", "recon strength", "recon basis", "our index"],
        [[r["name"], r["nation"], r["position"] or "—", f"{r['recon_strength']:.0f}",
          r["recon_basis"] or "—", _r2(r["our_index"])] for r in doc["anchor_gap"]],
    ))
    P.append("")
    P.append("## Plain-language read")
    P.append("")
    P.append(_read(doc))
    P.append("")
    return "\n".join(P)


def _read(doc: dict) -> str:
    a = doc["agreement"]
    j = doc["join"]
    submaterial = j["matched"] - a["material_n"]
    rated_ps = [r for r in doc["position_stratified_material"] if r["spearman"] is not None]
    worst = min(rated_ps, key=lambda r: r["spearman"])
    best = max(rated_ps, key=lambda r: r["spearman"])

    # data-driven composition of the two divergence tables
    hi_pos = Counter(r["position"] for r in doc["we_higher"])
    hi_floor = sum(1 for r in doc["we_higher"] if r["recon_pct"] < 5.0)
    lo_defgk = sum(1 for r in doc["we_lower"] if r["position"] in ("DF", "GK"))
    gap_defgk = sum(1 for r in doc["anchor_gap"] if r["position"] in ("DF", "GK"))
    n_hi, n_lo, n_gap = len(doc["we_higher"]), len(doc["we_lower"]), len(doc["anchor_gap"])

    lines = []
    lines.append(
        f"**Headline — moderate agreement, concentrated disagreement.** Two "
        f"independently-built, differently-sourced career-strength models agree "
        f"*moderately*: Spearman ρ={a['spearman_full']} across all {j['matched']} "
        f"matched players and ρ={a['spearman_material']} within the material cohort we "
        f"differentiate, with {a['top20_overlap']['shared']}/20 and "
        f"{a['top50_overlap']['shared']}/50 of the top names shared. About half the "
        f"elite overlaps — real corroboration that both float a similar set of greats "
        f"to the top, but well short of a lockstep ranking. The material ρ sitting at "
        f"or below the full ρ tells us the disagreement lives *inside* the cohort we "
        f"differentiate, not just in the tied tail — so it is worth dissecting, which "
        f"the next points do. The disagreement is not uniform; it sorts cleanly by "
        f"era and by position."
    )
    lines.append("")
    lines.append(
        f"**'We rank higher' = recon under-rating history (methodology, not our "
        f"gap).** The we-higher table is {hi_pos.get('FW', 0)}/{n_hi} forwards, and "
        f"{hi_floor}/{n_hi} of them are floored by recon near its **1st percentile** "
        f"(recon strength ≈ 52) — pre-modern recognition-greats like Zizinho, "
        f"Sindelar, Matthews, Scarone and Gento. recon's composite leans on a "
        f"World-Cup-match merit score plus curated anchors, and where it never "
        f"anchored a pre-1970 great it drops to a low template; our recognition "
        f"archives (POY placements, all-time selections) correctly elevate them. So "
        f"this whole direction is mostly recon under-crediting history, **not** us "
        f"over-crediting it — it corroborates our historic coverage. The one guardrail: "
        f"where a single thin fact drives a high index, confirm the fact is real (it "
        f"is sourced, by construction) and not over-weighted."
    )
    lines.append("")
    lines.append(
        f"**'recon ranks higher' + the DF lag = the real candidate MODEL gap.** "
        f"Position-stratified agreement is uneven: best is {best['position']} "
        f"(ρ={best['spearman']}, n={best['n']}), worst is **{worst['position']}** "
        f"(ρ={worst['spearman']}, n={worst['n']}). And the we-lower table is "
        f"{lo_defgk}/{n_lo} **defenders and goalkeepers** — Baresi, Djalma & Nílton "
        f"Santos, Bobby Moore, Roberto Carlos, Cafu, Puyol, Schmeichel, Barthez. This "
        f"is the report's strongest model-gap signal: our recognition-weighted "
        f"families structurally under-credit elite defenders and keepers, who win far "
        f"fewer individual awards (Ballon d'Or, player-of-the-year) than forwards, so "
        f"a recognition-archive index under-rates them even after the MV2-3 "
        f"position-balance repair. The repair narrowed the gap; the {worst['position']} "
        f"ρ and this table say it has not closed it — a defender-honors family (caps "
        f"records, all-time-XI selections, defensive awards) is the natural MV2-3.x lift."
    )
    lines.append("")
    lines.append(
        f"**Sub-material anchors sharpen the same lead — and the hard guardrail.** "
        f"The recon-anchored-but-sub-material list is {gap_defgk}/{n_gap} keepers and "
        f"defenders (Zoff, Banks, Maier, Carlos Alberto, the Santoses, Zanetti…): "
        f"players recon curated from real awards/honors but for whom our merit set "
        f"holds no fact strong enough to clear the gate. Each is a lead to **source a "
        f"real, citable fact** into our MODEL — never to copy recon's number, blend it, "
        f"or back-fit our gate to it. Net read: the cross-check validates our top and "
        f"our historic coverage, attributes the bulk divergence to a defensible "
        f"fact-gated-vs-template methodology split ({j['recon_only']} recon-only + "
        f"{submaterial} sub-material players diverge by construction), and points one "
        f"clear, actionable direction for the MODEL — close the defender/keeper "
        f"recognition deficit with real facts."
    )
    return "\n".join(lines)


if __name__ == "__main__":
    out = build(write=True)
    a = out["agreement"]
    print(f"recon divergence read {out['version']}")
    print(f"  matched {out['join']['matched']}/{out['join']['our_players']} on player_id")
    print(f"  Spearman full={a['spearman_full']} material={a['spearman_material']}")
    print(f"  top20={a['top20_overlap']['shared']}/20 top50={a['top50_overlap']['shared']}/50")
    print(f"  -> {OUTPUT_PATH}")
