# Merit-v2 Stature-Dominant Plan — Editorial Critique

> Scope: tight, prioritized critique of `docs/plans/merit-v2-stature-dominant-2026-06-08.md` against the source export `prompt-exports/oracle-plan-2026-06-08-183948-merit-v2-plan-9d2dec-fc60.md`. Not a re-plan. Intentional handoffs (`target_for_position` shape, indicative `MATERIAL_STATURE_*` / `STATURE_TARGET_*` / `TOURNAMENT_*_CAP` numerics, final Legend threshold, `calibrated_monotonic_transform` exact form) are excluded by request.

## 1. Top 3 under-specified seams

1. **`stature_tier` taxonomy is undefined.** Plan uses `TOURNAMENT_DOWN_CAP[pos, stature_tier]` and "tighter at highest stature tier" (Approach line ~285; MV2-4 done-when) without saying how many tiers, where the `career_stature_index` boundaries sit, or whether tiering is shared with the Legend route. The numeric _values_ are intentional handoff; the _table shape_ is structural and not. **Blocks MV2-4 (cap-table emission) and MV2-5 (projected analogue).** Pick one bullet — e.g. "≥3 tiers split by `career_stature_index` quantiles within material-stature cohort" — and let MV2-8 lock the exact edges.
2. **`raw_only_score` elite ceiling has no procedure.** Approach line ~313 and MV2-4 done-when both promise "raw-only non-material cards do not occupy the same high-90s semantic band as global legends" via a "global evidence-based raw-only elite ceiling," but no work item defines how the ceiling is derived (percentile of raw-only distribution? Fixed display-band cap? Anchored to top non-Legend internal score?). The separation invariant in MV2-6 and the anchor test in MV2-8 cannot be implemented or locked without it. **Blocks MV2-4 → MV2-6 → MV2-8.**
3. **`tournament_ref` / `projected_ref` cohort fallback is unspecified.** `median raw_tournament_score for (tournament_id, pos)` is fine for WC-2014-FW but degenerate for WC-1930-GK (n≤4) and many early-era backline cohorts. Plan never names the fallback (global-position median? position-only across-tournament? raw-as-ref → modulation=0?). Same gap on the 2026 side at `rating_2026.py:193-263`. **Blocks MV2-4 and MV2-5 deterministically.**

> Secondary, fixable in a bullet: MV2-7 requires `legend: boolean` on every rating row, but neither MV2-4 nor MV2-5 done-when says rating.py/rating_2026.py emit `legend` by joining `career_stature.json.legend` onto the rating row. Either add the emit bullet to MV2-4/MV2-5 or move the join into MV2-7 explicitly.

## 2. Specificity balance

- **Over-specified — MV2-9 divergence thresholds.** "`abs(Δoverall) >= 8` OR `abs(Δprimary_channel) >= 10` OR factual Legend disagreement" are normative integers in a Done-when bullet. The export left divergence shape qualitative ("review-only artifact, never override"). Either label them indicative-and-locked-by-MV2-8 like the other constants, or commit them and stop calling MV2-9 review-only.
- **Over-specified — MV2-7 file:line pins inside Done-when.** Listing `view-models.ts:277-282`, `adapters.ts:60-78`, `candidate-card.tsx:80-84, 124-128, 156-160`, and four CSS line ranges as acceptance criteria locks tactical seams the implementer should own as adjacent code shifts. The same refs already live in Background; keep them there as orientation, not as Done-when assertions.
- **Dropped framing — research-backstop scope rationale.** Export framed MV2-2 as a _bounded coverage-gap mechanism_ (top-5-per-2026-team selected by score + curated historical gap list, with the explicit "no LLM in intake" guardrail). Plan keeps the mechanics but loses the "why this is bounded and not an editorial channel" framing. Restoring two sentences would head off the predictable reviewer pushback that any research path is a slippery slope.

## 3. Contradictions / missing dependencies

- **The prior plan's runtime-count-before-compact-rebuild ordering bug is fixed.** MV2-10 explicitly states "Runtime count assertions updated ONLY AFTER compact rebuild" and replaces `EXPECTED_BASELINE_ANCHOR_ESTIMATE = 388` post-build. ✓
- **Real gap — `legend` emission on rating rows is unowned** (see §1 secondary). MV2-3 emits `legend` on `career_stature.json`; MV2-7 reads `legend` off the rating row; nothing in MV2-4/MV2-5 says the rating layer joins the two. As written, MV2-7's compact builder would fail on missing-`legend` for every rating row.
- **Real edge — MV2-5 done-when asserts on linked Messi-2026 ("no longer collapsed by age-only projected math") _before_ MV2-6 lands the unified display curve.** Either flag those assertions as internal-score (pre-display) or move them into MV2-6 done-when. The plan currently makes both items partially responsible for the same outcome.
- **Dep edge — MV2-11 sim cascade transitively depends on MV2-7 (runtime `legend`) but lists only MV2-10.** Transitive coverage is fine; flag if MV2-7 and MV2-10 ever get parallelized.

## 4. Risk of over-planning

The plan is 825 lines and earns ~600 of them. Cuts worth making:

- **MV2-9 done-when has 11 bullets that re-state MV2-1–MV2-8 acceptance tests.** Trim to the four unique-to-MV2-9 promises: cross-stage determinism, IP audit, schema-drift fail-loud, divergence-review artifact. Push the per-stage tests back into their owning items.
- **The "Recommendation" sub-section inside Approach is a 6-bullet recap of the prose immediately above it.** Cut it; the prose already says this.
- **Background's "Card UI / Legend badge seam" and References' "Card UI / Legend badge seams" are the same seven file:line pins.** Pick one location.
- **MV2-8 as a standalone L-item is mostly documentation that owns no behavior change.** Consider folding methodology updates into the last commit of MV2-4 / MV2-5 / MV2-7 and keeping MV2-8 as a small M item that owns _only_ named-anchor acceptance tests. The current split implies docs gate the rollout, which they shouldn't.

## 5. Questions that materially reorder

- **Is MV2-11 allowed to slip merit-v2 if λ refit becomes necessary (size jumps L→XL)?** If yes, MV2-11 should split into MV2-11a (validate-only, gates merge) and MV2-11b (refit + re-lock, separate PR). If no, the rating PR carries open-ended sim risk. This is the single biggest schedule decision.
- **Are #12 IFFHS All-Time / #13 Ballon d'Or Dream Team URLs deterministically parseable and SHA-pinnable today, or do they need WebArchive snapshots?** If any Tier-A source fails to pin cleanly, MV2-1 shrinks and MV2-2 (research backstop) grows to cover the position-balanced Legend route. Worth resolving before MV2-1 sizing locks.
- **Does MV2-9's divergence review gate merge, or post-ship audit?** Current dep edge (MV2-10 → MV2-9) implies pre-merge gating, but MV2-9 is L-sized and could become the critical path. Confirm intent; if post-ship, drop the edge.

---

**Editorial verdict:** plan is structurally tighter than its predecessor — it explicitly fixed the prior critique's runtime-count ordering bug, named `link_status` for the 2026 lookup seam, and kept the saturating-product family math the prior plan had dropped. The three real polish targets are (a) define `stature_tier` shape and the raw-only ceiling procedure, (b) assign `legend` emission onto rating rows to MV2-4/MV2-5, and (c) trim MV2-8 + MV2-9 redundancy. Resolve the MV2-11 split decision before publishing.
