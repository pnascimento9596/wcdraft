# q-002 — MV2-12 candidate (next merit-model iteration)

- **Tier:** Red (rating model) · **Mode:** DISPATCH-ONLY — Lead Architect authors the
  prompt; never self-served.
- **Status update 2026-06-12 — SUPERSEDED / SHIPPED.** The replacement
  merit-v3 season shipped via #104 and is now the production data season:
  `runtime-data-2.0.0`, `wc-perf-5.0.0`, `proj-career-4.0.0`,
  `career-stature-3.0.0`, and `engine-2026.06.12`. The MV2-12/12b labels below
  remain only as historical audit-trail language; they are not a current queue
  item.
- **Status update 2026-06-11 — DESIGNED.** The Lead-Architect season design landed:
  [`docs/plans/merit-v3-design-2026-06-11.md`](../plans/merit-v3-design-2026-06-11.md)
  (integration branch `merit-v3`). It supersedes the "MV2-12b" label: the rating
  integration is decomposed into season units U0 (identity links, in flight) +
  V1–V8 (stature core → historical/projected integration → curve re-fit + pre-registered
  probe gate → club backfill → compact regen → λ re-fit → season merge), with the
  version matrix (wc-perf-5.0.0 / proj-career-4.0.0 / career-stature-3.0.0 /
  runtime-data-2.0.0 / engine bump), the §H.2-derived acceptance-probe set
  pre-registered, and the one-skew-event rule. Per this item's done-when, q-002 is
  replaced by the plan's units; those units have now shipped through merit-v3.
  The sections below stay as the audit-trail record.
- **Status:** AUDITED — diagnostic pre-work executed 2026-06-10; see
  [`docs/reports/mv212-ratings-audit-2026-06-10.md`](../reports/mv212-ratings-audit-2026-06-10.md).
  **GO recommended** (option D2 + D1: active-career recognition intake with a
  career-stage-normalized index, plus age-conditioned projected cohorts). Confirmed
  mechanisms: the career-stature archive has zero in-progress careers (primary) and an
  age/all-age-percentile double penalty (secondary); the raw-path ceiling (internal
  0.62 → display 88) makes everything above 88 stature-only in BOTH eras.
  "Maldini 71" ruled Cesare-1962 (surname display-ambiguity UX follow-up — now filed as
  [`q-005`](q-005-surname-disambiguation.md)). The audit's severable **12a intake unit was
  built and reviewed** as part of the superseded design chain; **12b language is
  historical only** after merit-v3.
- **Audit-2 (face-validity sweep) executed 2026-06-10; see
  [`docs/reports/mv212-face-validity-2026-06-10.md`](../reports/mv212-face-validity-2026-06-10.md).**
  Adds: (1) **P0 NEW DEFECT — 17 identity-seam link misses among minted 2026 cards**
  (Neymar 88 vs hist 93+legend, Rodri 88; mononym/nickname name-forms + 474
  `given_name="not applicable"` historical rows) → recommend a small Red link-seam
  fix unit BEFORE/alongside 12b; (2) **NEW 12b design input — the career-stature
  index is era/eligibility biased within the archive** (Pelé 0.807 rank-45 silver vs
  Kocsis 0.992 #1; pre-1995 Ballon d'Or eligibility + sparse-fact inflation);
  (3) consolidated candidate-misratings table (21 classes) + a named 12b
  acceptance-probe set incl. Valverde-2022 counterfactual (injected index 0.42 → 84,
  matching the owner's instinct — D2 fixes him organically).

## MV2-12a — active-career stature intake (FACTS-ONLY, historical)

- Branch `ws-etl/mv212a-active-career-intake`: extends the merit intake to in-progress
  careers via a structurally INERT active channel — 47 facts / 23 players
  (`active-career-source-set-1.0.0`, cutoff 2026-06-01): 36 parser-recovered facts
  (withheld pinned-snapshot records re-linked against the minted 2026 identity space)
  plus 11 citation-backed active-note facts (own SHA-pinned manifest under
  `etl/merit/raw/active/`). Staged in `etl/output/merit/source_facts_active.json` +
  `career_stature_active_staging.json` (NO score/index — entries are facts + identity
  only). Consumed archive, both rating outputs and compact bundles proven
  byte-identical. 4 identity-bridge review entries (minted 2026 duplicates of
  fact-carrying historical ids: Neymar, Alisson, Marquinhos, Rodri) staged for 12b.
- Anti-fab drops recorded in the notes: Valverde Uruguay-captaincy REFUTED (Giménez is
  the citable 2026 captain); Hajsafi century-caps absent from the pinned snapshot.

## MV2-12b — rating integration (historical label, superseded by merit-v3)

Activates the channel per the audit's D2+D1: player-identity stature seam (not
historical-card link), career-stage-normalized index for in-progress careers,
age-conditioned cohorts in the projected raw path. Carries the FULL Red chain:
rating-version bumps, canary regen + pick-equality, compact regen, λ re-fit BEFORE
any realism re-lock, fresh-session RED review, autonomous SHA-pinned merge,
deploy observation, and live verification with auto-revert on failed live checks.
The 12a inertness tests (`test_scoring_code_never_references_the_active_artifacts`,
the double-credit build guard) are the explicit flip points 12b must change.

## Verified deferred threads (sources: merit-v2 plan + lane memories)

- Captaincy family expansion deferred at MV2-1 (#18); Yashin captaincy WITHHELD at MV2-2
  on anti-fabrication grounds (needs a citable source, not a workaround).
- Recon cross-check wiring beyond review-only staging was deferred at the MV2-8/MV2-9
  boundary; MV2-9 divergence read measured DF Spearman ρ 0.11 → 0.29 after MV2-3.5 —
  defender/keeper under-credit is narrowed, not closed.
- MV2-9 divergence-review queue mechanism exists; top-end great-vs-great inversions are
  routed there by design (not test-pinned) and remain unreviewed inventory.
- **Club-at-tournament backfill (12b compact-regen train inherits this):** historical
  club is source-absent for all 10,973 pre-2026 cards (Fjelstul has no club column; ETL
  honest-nulls at `cards.py:114`). Spec staged in
  [`docs/reports/club-backfill-manifest-2026-06-10.md`](../reports/club-backfill-manifest-2026-06-10.md):
  pin per-tournament Wikipedia squads revisions (1930–2022, same mechanism as
  `source_2026.py`), parse club, join in ETL, regen compact. UI render path + census-lock
  test already shipped on `ws-ux/club-coverage`; the census test MUST flip with the regen.

## Done-when (for the CANDIDATE itself)

A Lead-Architect-authored plan lands in `docs/plans/` defining scope, version bumps, and
gates — at which point this item is replaced by real work items.

## Evidence required (whenever dispatched)

Full Red protocol per CLAUDE.md: byte-identical proofs for out-of-scope outputs, ETL suite,
named-anchor/golden gates, canary regen + pick-equality on any rating-version bump,
fresh-session re-executing review, SHA-pinned merge, deploy observation, and live
verification with auto-revert on any failed live check.
