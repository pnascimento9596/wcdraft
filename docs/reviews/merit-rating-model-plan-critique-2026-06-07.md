# Merit-Rating-Model Plan — Editorial Critique

> Scope: tight, prioritized feedback on `docs/plans/merit-rating-model-2026-06-07.md` to inform Phase 7 polish. Compared against `prompt-exports/oracle-plan-2026-06-07-235118-merit-rating-plan-2c-b755.md`. Not a re-plan.

## 1. Top 3 under-specified seams (load-bearing)

1. **`REPLACEMENT_BASE` is referenced but never defined.** Approach formula `career_target = REPLACEMENT_BASE + CAREER_TARGET_SPAN[pos] * career_elite` (plan line 205) — no value, no semantic anchor (is it the existing `FLOOR_CHANNEL = 20` analogue? The display floor 66/100? Something position-aware?). E-4.4 can't be implemented without this. Either commit a number (e.g. `0.55` ≈ replacement-level 55 OVR pre-curve) or explicitly route to E-4.5 calibration alongside the other constants.
2. **`saturating_combine(...)` has no definition.** Plan keeps the prose mandate ("positive-evidence dominant and saturating, not additive-unbounded") but drops the export's per-family signal decomposition (export lines 348–374) that named which inputs feed `wc_legacy`, `annual_recognition`, `international_record`, `retrospective_selection`. An implementer of E-4.3 has to guess the saturating shape (`1 − exp(−x/τ)`? `min(1, Σw·s)`? piecewise?) **and** invent per-signal sub-weights inside each family. This is the central composite-construction seam.
3. **2026 canonical `player_id` lookup mechanism is unspecified for the linked-player path.** E-4.4 says `rating_2026.py` "may consume `career_stature.json` for linked canonical `player_id`s only" and cites `ingest_2026.py:117-137, 142-166`, but never names the field that ties a 2026 row to a historical `player_id` (is it `players_2026.canonical_player_id`? Synthesized via name+nation+DOB match against `players.json`? Already populated by `identity_2026.py`?). If Open Question 4 is approved as "include," this becomes a hard blocker for E-4.4 and the IP-audit surface for E-4.7.

> Secondary (worth a one-line fix, not a blocker): `MIN_CAREER_COVERAGE_FOR_LIFT = 0.25` is declared in the Approach but never wired into the formula (no `if coverage < MIN: lift = 0` line) — E-4.4 done-when only says "low-coverage → lift = 0" without defining "low." Pick one or the other.

## 2. Specificity balance

- **Over-specified: initial calibration constants.** The Approach commits exact values (`CAREER_ELITE_EXPONENT = 1.35`, `CAREER_TARGET_SPAN` per position, `CAREER_BLEND_HISTORICAL = 0.65`, `CAREER_MAX_LIFT` per position) and simultaneously routes them to E-4.5 fit-against-anchors **and** asks Paulo to approve them in Open Question 2. Pick one stance: either commit them as starting points and drop OQ2, or label them "indicative; E-4.5 fits" and stop printing precise digits. The current presentation reads as if the implementer should treat them as normative.
- **Dropped useful framing from export.** The export's family-scoring decomposition (`wc_legacy = saturating_combine(career WC award score, career WC team-finish score, career WC goals / appearance trust score)` and equivalents for the other three families, export lines 348–374) is the only place that ties source families to specific committed-byte signals. The plan's Approach → "Career composite" keeps the era-weights table but drops this. Restoring those four lines (one per family) closes seam #2 above without bloating the plan.
- **Over-specified: E-4.6's "no manager rating map introduced" assertion.** This locks a negative invariant that already holds in `build-compact-data.mjs` — pure overhead. Trim.

## 3. Contradictions / missing dependencies

- **Ordering bug: E-4.5 updates a constant it cannot yet measure.** E-4.5 done-when says "Old fixed `baseline_anchor_estimate = 388` assertion replaced with locked E-4 counts." That constant lives at `packages/data/test/compact-data.integrity.test.ts:47` and pins `RUNTIME_DATA_MANIFEST.counts.baseline_anchor_estimate` — i.e. the count from the *compact bundle*, which is not rebuilt until E-4.8 (and the integrity test itself is owned by E-4.6/E-4.8). E-4.5 cannot lock the integer before E-4.8 rebuilds the bundle. Either: (a) move the integrity-test count update into E-4.6 or E-4.8 done-when, or (b) add `addBlockedBy: [E-4.6]` to E-4.5's runtime-side assertion only. As written, the sequence "E-4.5 → E-4.6 → E-4.8" claims E-4.5 lands a value that doesn't exist yet.
- **E-4.5 → display-curve cap path for `career_stature_estimate` is implied but unstated.** The new basis is supposed to bypass the `[66, 73]` cap (Approach table), but no work item names the line in `rating.py:198-279` (`_fit_display_curve` / `_display_score`) where the cap branch is selected, nor does E-4.4/E-4.5 done-when mention removing/gating it. Add one bullet to E-4.4 done-when: "`_display_score()` cap branch keyed on `overall_basis`; `career_stature_estimate` exits via the uncapped path."
- **E-4.8 dependency edge.** E-4.8 deps only on E-4.7; it actually consumes E-4.4 / E-4.5 / E-4.6 artifacts directly. Transitive coverage is fine, but if E-4.7 is parallelizable with E-4.6 in practice, the implicit edge breaks.

## 4. Risk of over-planning

- **E-4.1 as a standalone M-sized work item is doc overhead.** It produces a source registry markdown and zero rating changes — easily folded into E-4.2's first commit (committed raw bytes + manifest = the registry). Cut to a 3-bullet preamble inside E-4.2.
- **Background § "IP firewall — clarify 'no FIFA string'"** is ~25 lines justifying the legal status quo. One sentence — "Firewall = no proprietary rating IP (Sofifa/Futbin/EA/PES); existing FIFA tournament naming, tri-codes, and disclaimers stay; audit regex at `test_rating.py:648-680` extends to new raw dirs" — does the same work for the implementer.
- **E-4.7 historical rating-test bullets duplicate E-4.5's anchor tests** (Pelé 1958 / Maradona / Zidane / Messi, defender/GK not rated on goals). Pick one home (E-4.5 for named anchors, E-4.7 for the determinism/audit/divergence suite) and de-duplicate.

## 5. Open Questions that materially reorder E-4.1–E-4.8

- **OQ 4 (projected 2026 integration in E-4a vs deferred E-4b)** is the biggest reorderer. "Include" forces E-4.4 to specify the canonical-id lookup (seam #3 above), forces E-4.5 to update `RATING_METHODOLOGY_2026.md` and re-fit the projected display distribution, and forces E-4.8 to regenerate `scenario-2026.compact.json` + verify `realism-modern-norms` under moved Team2026 aggregates. "Defer" cuts those branches and turns E-4.4/E-4.5/E-4.8 noticeably smaller. Worth resolving **before** sizing E-4.4 final.
- **OQ 5 (engine-v2 sequencing — rating-only vs atomic with E-3a/E-3b)** materially reshapes E-4.8 and adds an implicit pre-step. "Atomic" requires restoring/recreating `packages/core/src/faithfulness.test.ts` **before** E-4.4 ships (the channel-moving lift must land against an operative faithfulness gate, not a missing one), which is currently neither a work item nor a dep edge. "Rating-only" keeps E-4.8 as-is and pushes faithfulness to a separate engine-v2 workstream.

OQ 1 (channel-only rejection), OQ 2 (constants), and OQ 3 (divergence threshold) only change *content*, not *ordering*.

---

**Editorial verdict:** plan is structurally sound and grounded in the right seams. The seven items above are the editorial polish targets — close `REPLACEMENT_BASE` + restore the family-scorer decomposition (closes the two biggest implementer-guess seams), fix the E-4.5 / integrity-test ordering, and decide OQ 4 before publishing.
