# FIT-06 — Local reference standing on every result (gate report)

Date: 2026-07-01 · Branch: `ws-f4/reference-standing-20260701` · PR: #205 · Tier: RED

## Scope

- **U1**: ship the strategicAutoDraft N=2000 score population (pinned by
  `asym-realism-golden.json`) as `packages/data/src/generated/score-distribution.compact.json`
  — 101 nearest-rank percentile→score breakpoints + population summary +
  embedded anchors (dataset/engine/rating/ruleset versions and source-bundle
  sha256s). 1856 B raw / 767 B gzip / 640 B brotli. Fingerprinted in
  `manifest.json` as optional `bundles.score_distribution`; copied to the web
  data directories. Generation: `pnpm --filter @wcdraft/data run build:score-distribution`
  (deterministic, ~10 s; byte-identical on re-run).
- **U2**: every completed run shows "Beat ~X% of reference drafts" computed
  locally from the shipped table. Monotone, whole-%, conservative strict-less
  ties, tails clamp to Top/Bottom ~1%. Anchor-gated to the run record's
  versions (mismatch ⇒ omitted, never a wrong-population percentile).
  Non-daily captions carry the line; daily captions keep the posted-field
  rules and never carry it. Memory runs surface it post-reveal only.
  How-to-Play gained a "Reference standing" entry.
- **U3**: teardown synthesis doc landed via PR #204 (squash merge `a551aab`),
  byte-identical content + a prettier whitespace-only reflow (8 blank-line
  insertions, zero word-level changes) required by the format gate.

## Honest deviations

- `dataset_version` stays `2026-07-01`: it already equals today's ETL
  revision date (`etl/src/wcdraft_etl/pipeline.py: DATASET_REVISION_DATE`).
  Bumping to a future date would fabricate a revision. The live-verifiable
  "new dataset anchor" is the manifest's `bundles.score_distribution`
  fingerprint (sha256 `16c01f92…`), absent from the pre-ship manifest.
- Daily captions do NOT include the reference standing (dispatcher left it to
  my call): the daily slot already carries the posted-field standing or the
  claim hook, and excluding it guarantees zero wording cross-contamination.
- Screenshot probe score 84 was not reachable in the scanned seed set for the
  canonical-first probe policy; nearest achievable was 52 ("Beat ~92%") —
  allowed by the dispatch ("or nearest achievable seeded examples").

## Standing text from the shipped table

| score      | standing                       |
| ---------- | ------------------------------ |
| −24 (min)  | Bottom ~1% of reference drafts |
| −7         | Beat ~10% of reference drafts  |
| 0          | Beat ~27% of reference drafts  |
| 9 (median) | Beat ~49% of reference drafts  |
| 14         | Beat ~57% of reference drafts  |
| 62 (p95)   | Beat ~94% of reference drafts  |
| 84         | Beat ~98% of reference drafts  |
| 126 (max)  | Top ~1% of reference drafts    |

## Gates (implementer, real counts)

- data targeted suites: web-assets-copy + compact-data golden +
  score-distribution golden = 16/16.
- Root: typecheck 8/8 · lint 5/5 · test 8/8 (web 860 passed / 1 skipped +
  game-flow-playwright ok) · build 4/4.
- Golden turbo tasks: core 2, data 3, web 4 — all successful.
- Heavy realism (`WCDRAFT_REALISM_HEAVY=1`): 9/9, including the new
  live-ensemble quantile re-derivation (byte-faithful table proof).
- No-engine-movement: canary pick golden, RNG/draft/sim/e2e/era/leaderboard
  goldens all green with zero re-locks; realism bands untouched; diff
  confined to data artifact generation/validation/copy, web display, tests,
  docs.
- UI proof (`apps/web/scripts/verify-reference-standing-browser.mts`):
  scores {−7, 0, 14, 52} × {390×844, 360×800} × {light, dark} = 16
  screenshots, axe 0 violations (WCAG A/AA/2.1AA), token-replay standing
  identical, no wording cross-contamination.

## Reviewer verdict

(fresh-context re-executing reviewer — filled in before merge)

## Live verification

(filled in after deploy)
