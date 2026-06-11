# q-002 — MV2-12 candidate (next merit-model iteration)

- **Tier:** Red (rating model) · **Mode:** DISPATCH-ONLY — Lead Architect authors the
  prompt; never self-served.
- **Status:** AUDITED — diagnostic pre-work executed 2026-06-10; see
  [`docs/reports/mv212-ratings-audit-2026-06-10.md`](../reports/mv212-ratings-audit-2026-06-10.md).
  **GO recommended** (option D2 + D1: active-career recognition intake with a
  career-stage-normalized index, plus age-conditioned projected cohorts). Confirmed
  mechanisms: the career-stature archive has zero in-progress careers (primary) and an
  age/all-age-percentile double penalty (secondary); the raw-path ceiling (internal
  0.62 → display 88) makes everything above 88 stature-only in BOTH eras.
  "Maldini 71" ruled Cesare-1962 (surname display-ambiguity UX follow-up, not a rating
  defect). No authored spec yet — implementation remains DISPATCH-ONLY pending a
  Lead-Architect-authored plan.
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
fresh-session re-executing review, human approval, `--match-head-commit` merge.
