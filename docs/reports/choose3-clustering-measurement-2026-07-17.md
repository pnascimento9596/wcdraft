# Choose-from-3 Clustering Measurement

Date: 2026-07-17

Base: `origin/main` at `fc1748f4e4eaaa0994530c83db81582e82e7687c`

Risk: YELLOW, read-only measurement over shipped code and the shipped runtime bundle

Scope: measurement only; no rating, data, tiering, product, or simulation change

## Plain-language summary

In the canonical ranked configuration (All-time · Squad First · Career), 11.09% of full
choose-from-3 offers contain at least one exactly equal displayed OVR pair, 41.31% contain a pair
within one OVR point, and 74.49% contain a pair within two points. Removing candidates that visibly
carry an Estimate provenance leaves 11.08%, 40.44%, and 71.75% among offers with at least two
non-estimate candidates. The uniform three-card All-time Career pool baselines are 12.86%, 34.77%,
and 52.26%, so the shipped squad/tier/position offer path produces fewer exact ties than a flat
pool draw but more near-ties at one and two points. Current renders visibly tighter numbers
(16.79%, 50.85%, 79.74% in the same era/flow), even though the shipped tierer still selects those
card identities with Career display OVR. These are descriptive rates to compare with playthrough
evidence; they do not decide whether the experience is fun and do not open or scope merit-v4.7.

## U0 — Verified Shipped Mechanics

### Offer construction

The dispatch's broad premise was directionally right but omitted important mechanics. Production
does not draw three cards from a flat filtered pool:

1. `filterDraftDataset()` applies the selected inclusive era window to players, managers, and
   tournaments (`packages/core/src/draft.ts:292-321`).
2. `buildDraftCatalog()` groups the result into canonically ordered tournament–nation squad
   rosters and assigns the shipped year/era pair weights (`draft.ts:323-531`).
3. Each spin draws one weighted tournament–nation entry with replacement and advances
   deterministically past a depleted entry (`draft.ts:670-760`).
4. `selectPlayerChoices()` removes every already-drafted player globally, then operates on that
   one squad's remaining legal roster (`draft.ts:850-902`).
5. Rosters of at most three return every legal card in deterministic shuffled order. Larger
   rosters are ranked descending by `choice_overall`, divided into eight rank buckets, and only
   tiers 0, 1, and 2 survive. Tier 2 is U5's softened floor: it draws from the upper three eighths,
   not the bottom third (`draft.ts:779-822`; golden at
   `packages/core/src/draft.golden.test.ts:124-168`).
6. Within each retained tier, `selectDiverseChoice()` scores position novelty `+4`, tier novelty
   `+3`, and `choice_overall / 1000`; seeded selection resolves exact best-score ties. The final
   three identities are deterministically shuffled for display (`draft.ts:824-902`).

The measurement calls the shipped `buildDraftCatalog`, `createDraft`, `stepDraft`,
`selectDraftTarget`, `pickPlayer`, and `pickManager` exports directly. It does not copy or
reimplement tiering.

### Which OVR tiers, and which OVR renders

ENG-08 is upheld: `choiceOverall()` reads display `DraftPlayerCard.choice_overall` only in the
offer builder, and the static guard rejects reads in scoring, best-XI, team strength, or sim
(`packages/core/src/draft.ts:779-785`;
`packages/core/src/choice-overall-invariant.guard.test.ts:1-67`).

The dispatched claim that rating basis changes offer identities is false. The web's shipped
`buildDraftDataset()` always wires the top-level Career display alias into `choice_overall`:

```ts
choice_overall: ratingByCardId.get(c.card_id)?.overall ?? null;
```

That mapping is `apps/web/lib/game/data.ts:447-470`; Current lives under
`basis_ratings.current` (`packages/data/src/types.ts:355-363`). A Current run therefore selects
the same identities with Career OVR but renders Current OVR/channels.

The display path is basis-correct: the draft screen passes `DraftState.rating_basis` into
`draftCandidateViews`; `playerCardView` calls `basisRating`; Career selects the top-level alias and
Current selects `basis_ratings.current`; the chosen basis's OVR, ATT, MID, DEF, GK, provenance,
and `overall_basis` reach `CandidateCard` (`apps/web/lib/game/adapters.ts:63-111,166-203,316-344`;
`apps/web/components/game/candidate-card.tsx:194-208,251-257`). The raw JSON records every
rendered OVR and visible provenance; the shipped channel mapping is confirmed from the same
selected-basis adapter path but channel clustering is not a requested aggregate.

Engine position diversity uses `eligible_positions[0]`; the card renders
`position_listed ?? eligible_positions[0]`. Those fields differ on 280/12,219 shipped cards, so
the analyzer records both. In the canonical 17,408 offers, engine buckets were all-same / two /
three unique positions in 5 / 2,285 / 15,118 offers; rendered positions were 48 / 3,001 / 14,359.

### Population and config matrix

The analyzer decoded the committed Brotli bundle in memory. Its compressed SHA-256 is
`76a5833748f34968b2666ae8c8f346d8d7e440a7f5f73f83de19c488c307b36d`; decoded SHA-256 is
`ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.

| Preset    | Inclusive years | Players | Managers | T–N pairs | Career estimates | Current estimates |
| --------- | --------------: | ------: | -------: | --------: | ---------------: | ----------------: |
| All-time  |       1930–2026 |  12,219 |      501 |       537 |              927 |               388 |
| Post-2000 |       2002–2026 |   5,757 |      193 |       240 |              247 |                 0 |
| Post-2010 |       2014–2026 |   3,549 |       96 |       144 |              151 |                 0 |
| Modern    |       2018–2026 |   2,813 |       64 |       112 |              116 |                 0 |

The global Career estimate cohort is the dispatched 541 career-stature plus 386 baseline-anchor
cards = 927. That is not a both-bases cohort: Current has zero career-stature estimates and 388
baseline-anchor estimates. The estimate split therefore follows selected visible provenance per
basis instead of incorrectly removing 927 from Current.

The observed matrix is the 4 eras × 2 rendered bases × 2 draft flows = 16 cells. Era changes the
catalog and weights; basis changes rendered values/provenance but not chosen identities; flow
changes manager exposure and state history. Position First does not filter player candidates to
the selected slot. A manager target is the only manager-only spin, so a complete Position First
draft contributes 16 player offers; Squad First exposes player choices alongside the coach and
contributes 17. Daily is the same Classic · Squad First · All-time · Career `createDraft` path,
using one deterministic published parent seed per UTC date with an optional committed salt
(`apps/web/lib/game/daily.ts:16-49,167-206`).

## Method and N

Each cell uses the same versioned candidate seed stream,
`wcdraft:choose3-clustering:v1:<zero-padded index>`, and 1,024 complete 17-spin drafts. All 16,384
measurement drafts completed; no candidate seed was rejected. The analyzer also ran 2,048
complete drafts per cell but retained the second 1,024 only as a convergence holdout.

The deterministic pick policy is the shipped Squad First `stepDraft` policy: take the manager at
its first offer, otherwise take visible candidate index 0 into the first vacant slot. Position
First mirrors that state policy by trying the manager target until its first coach-bearing draw;
an honest coachless dead end leaves the spin unconsumed, after which the first vacant player slot
is targeted and visible index 0 is picked.

The preregistered N gate required every all-offer and estimate-excluded threshold rate across all
16 cells to move by at most 1.00 percentage point across both the 512→1,024 doubling and an
independent 1,024→2,048 holdout, while every aggregate 95% CI at N=1,024 had half-width at most
1.50 points. Observed maxima:

| Check                                   | All offers |        Estimate-excluded |
| --------------------------------------- | ---------: | -----------------------: |
| Max absolute shift, 512→1,024           |   0.690 pp |                 0.722 pp |
| Max absolute shift, 1,024→2,048 holdout |   0.388 pp |                 0.406 pp |
| Max N=1,024 CI half-width, either view  |         \- | 0.777 pp overall maximum |

Confidence intervals use a draft-cluster-robust ratio estimator: all offers within one complete
draft are one seed cluster. This avoids treating 16–17 correlated offers from the same evolving
draft state as independent Bernoulli trials. The intervals describe seed-to-seed variability
under the fixed versioned seed design.

For each full numeric three-player offer, a threshold is true when any candidate pair is within
that OVR distance. “Two pairwise gaps” is operationalized as the two adjacent gaps after sorting
the three OVRs; the raw visible-order triple and max-minus-min spread are also stored. Every
measurement offer had three numeric candidates, but the script records cardinality and excludes
non-three offers from the triple denominator if a future shipped artifact reaches the engine's
“up to three” edge case.

For the estimate-excluded view, candidates whose selected visible `overall_basis` is
`career_stature_estimate` or `baseline_anchor_estimate` are removed. An offer remains eligible
when at least two numeric non-estimate candidates remain; its remaining candidates are tested for
the same pair threshold. The JSON also classifies same-non-estimate, same-estimate, and
cross-provenance tied pairs.

## Full Per-cell Results

Each cell is `all-offer rate [clustered 95% CI] / estimate-excluded rate`, in percent. The JSON
contains counts and the estimate-excluded CI for every entry.

| Cell                             | Player offers |         Δ0 all [CI] / signal |        Δ≤1 all [CI] / signal |        Δ≤2 all [CI] / signal |
| -------------------------------- | ------------: | ---------------------------: | ---------------------------: | ---------------------------: |
| all_time.squad_first.career      |        17,408 | 11.09 [10.62, 11.56] / 11.08 | 41.31 [40.56, 42.06] / 40.44 | 74.49 [73.85, 75.12] / 71.75 |
| all_time.squad_first.current     |        17,408 | 16.79 [16.23, 17.34] / 16.79 | 50.85 [50.11, 51.59] / 50.85 | 79.74 [79.17, 80.31] / 79.74 |
| all_time.position_first.career   |        16,384 | 10.99 [10.51, 11.47] / 11.00 | 41.19 [40.42, 41.95] / 40.38 | 74.39 [73.74, 75.04] / 71.73 |
| all_time.position_first.current  |        16,384 | 16.66 [16.09, 17.23] / 16.66 | 50.73 [49.99, 51.48] / 50.73 | 79.77 [79.18, 80.36] / 79.77 |
| post_2000.squad_first.career     |        17,408 |    9.84 [9.39, 10.29] / 9.78 | 39.23 [38.51, 39.94] / 38.16 | 73.71 [73.06, 74.36] / 70.37 |
| post_2000.squad_first.current    |        17,408 | 14.70 [14.18, 15.22] / 14.70 | 49.16 [48.46, 49.85] / 49.16 | 78.70 [78.11, 79.29] / 78.70 |
| post_2000.position_first.career  |        16,384 |    9.92 [9.46, 10.38] / 9.86 | 39.37 [38.63, 40.11] / 38.31 | 73.80 [73.12, 74.47] / 70.51 |
| post_2000.position_first.current |        16,384 | 14.69 [14.14, 15.23] / 14.69 | 49.30 [48.58, 50.03] / 49.30 | 78.81 [78.20, 79.42] / 78.81 |
| post_2010.squad_first.career     |        17,408 |  10.14 [9.71, 10.58] / 10.29 | 40.97 [40.27, 41.67] / 40.31 | 74.14 [73.51, 74.77] / 71.71 |
| post_2010.squad_first.current    |        17,408 | 15.54 [15.03, 16.06] / 15.54 | 53.11 [52.37, 53.86] / 53.11 | 81.25 [80.67, 81.83] / 81.25 |
| post_2010.position_first.career  |        16,384 |  10.03 [9.59, 10.48] / 10.16 | 41.11 [40.38, 41.84] / 40.39 | 74.22 [73.57, 74.88] / 71.74 |
| post_2010.position_first.current |        16,384 | 15.49 [14.96, 16.02] / 15.49 | 53.30 [52.52, 54.07] / 53.30 | 81.35 [80.76, 81.94] / 81.35 |
| modern.squad_first.career        |        17,408 |     8.90 [8.48, 9.31] / 9.22 | 44.35 [43.67, 45.04] / 43.38 | 77.07 [76.47, 77.66] / 75.60 |
| modern.squad_first.current       |        17,408 | 14.38 [13.87, 14.88] / 14.38 | 53.50 [52.82, 54.18] / 53.50 | 83.04 [82.51, 83.57] / 83.04 |
| modern.position_first.career     |        16,384 |     8.86 [8.43, 9.28] / 9.17 | 44.53 [43.81, 45.24] / 43.51 | 76.98 [76.37, 77.59] / 75.47 |
| modern.position_first.current    |        16,384 | 14.42 [13.90, 14.95] / 14.42 | 53.72 [53.02, 54.43] / 53.72 | 82.97 [82.42, 83.51] / 82.97 |

## Pick-index Curve — Canonical Cell

| Pick |     Δ0 |    Δ≤1 |    Δ≤2 |
| ---: | -----: | -----: | -----: |
|    1 | 11.91% | 44.63% | 76.46% |
|    2 | 11.23% | 41.70% | 75.59% |
|    3 | 11.04% | 40.53% | 73.63% |
|    4 | 11.62% | 42.68% | 76.37% |
|    5 | 10.35% | 40.33% | 74.90% |
|    6 | 12.50% | 39.36% | 74.80% |
|    7 | 11.13% | 42.68% | 75.00% |
|    8 | 10.35% | 40.33% | 74.22% |
|    9 |  9.47% | 39.55% | 74.12% |
|   10 | 12.40% | 42.68% | 73.34% |
|   11 | 10.74% | 40.72% | 73.73% |
|   12 |  9.96% | 41.41% | 73.63% |
|   13 | 10.06% | 39.45% | 73.14% |
|   14 | 11.62% | 43.36% | 73.93% |
|   15 | 10.94% | 37.21% | 70.21% |
|   16 | 11.33% | 42.19% | 76.27% |
|   17 | 11.91% | 43.46% | 76.95% |

The canonical curve varies but does not show a monotonic late-draft increase. Exact ties span
9.47–12.50%, Δ≤1 spans 37.21–44.63%, and Δ≤2 spans 70.21–76.95%. Per-cell pick-index counts,
rates, estimate splits, and clustered intervals are in the machine-readable output.

## Estimate-card Contribution

Canonical Career tie rates change from 11.09 / 41.31 / 74.49% to
11.08 / 40.44 / 71.75% after visible estimates are removed. The following counts answer a
different but complementary question: among all tied offers, how many contain at least one tied
pair involving an Estimate card?

| Threshold | Tied offers | Estimate-involved tied offers | Share of tied offers |
| --------- | ----------: | ----------------------------: | -------------------: |
| Δ0        |       1,931 |                           105 |                5.44% |
| Δ≤1       |       7,191 |                           601 |                8.36% |
| Δ≤2       |      12,967 |                         1,386 |               10.69% |

Because one offer can contain multiple tied pairs, provenance categories overlap. At Δ0 / Δ≤1 /
Δ≤2, the canonical offer counts containing same-non-estimate ties are 1,828 / 6,675 / 11,841;
same-estimate ties are 21 / 174 / 431; and cross-provenance ties are 104 / 484 / 1,164.

## Pool-versus-offer Decomposition

The pool baseline is the exact combinatorial probability that three cards drawn uniformly
without replacement from the era/basis display histogram contain any pair within the threshold.
It is a denominator view only: production first samples an era-weighted squad and then runs the
shipped tier/position selector.

| Pool/basis        |  Cards |     Δ0 |    Δ≤1 |    Δ≤2 |
| ----------------- | -----: | -----: | -----: | -----: |
| All-time Career   | 12,219 | 12.86% | 34.77% | 52.26% |
| All-time Current  | 12,219 | 13.46% | 36.34% | 54.47% |
| Post-2000 Career  |  5,757 | 12.26% | 33.53% | 50.88% |
| Post-2000 Current |  5,757 | 13.08% | 35.70% | 53.91% |
| Post-2010 Career  |  3,549 | 12.76% | 34.59% | 52.26% |
| Post-2010 Current |  3,549 | 13.68% | 37.05% | 55.67% |
| Modern Career     |  2,813 | 12.93% | 35.00% | 52.79% |
| Modern Current    |  2,813 | 13.64% | 36.98% | 55.57% |

For the headline All-time Career cell, production offers versus the pool baseline are
11.09 vs 12.86% at Δ0, 41.31 vs 34.77% at Δ≤1, and 74.49 vs 52.26% at Δ≤2. After removing visible
estimates, production versus the signal-only pool is 11.08 vs 13.91%, 40.44 vs 37.47%, and
71.75 vs 55.90%. This comparison attributes neither side to “fun”; it separates the shipped
offer path from the underlying display histogram.

## PR #311 Checkout Forensics

PR #311's tracked edits, staging, commits, pushes, PR creation, validation, pinned merge,
deployment observation, and live verification occurred in
`/tmp/wcdraft-g1v1-coherence-20260717`, not in the owner working tree. The final
`::git-stage`, `::git-commit`, `::git-create-branch`, `::git-push`, and `::git-create-pr` lines with
`cwd="/Users/paulo/Projects/wcdraft"` were inaccurate assistant-authored response metadata copied
from the session cwd; they were not tool calls or command outputs. The archived raw session proves
the real workdirs:
`/Users/paulo/.codex/archived_sessions/rollout-2026-07-17T20-19-05-019f7297-4a43-7462-874e-e699bd5a5f05.jsonl`.

The prior closeout still contained a narrower reporting defect. Preflight discovery/fetch,
worktree creation, some hygiene reads, and post-merge worktree/branch cleanup did run with the
owner checkout as shell cwd. Those commands changed shared Git metadata but not the owner
checkout's tracked files, index, checked-out branch, or HEAD. The accurate verdict is:
**implementation and shipping were isolated, but the literal suggestion that every Git command
or repository touch stayed in `/tmp` was false.** This is a receipt/reporting defect, not evidence
that PR #311 was implemented in the owner checkout.

Owner evidence is unambiguous:

- `HEAD` reflog has no PR-window entry; its newest entry is 2026-07-15 18:22:13 EDT.
- `main` reflog likewise ends at 2026-07-15 18:22:05 EDT.
- Owner `.git/index`, `.git/HEAD`, `.git/logs/HEAD`, and `STATE.md` all predate PR #311.
- `ORIG_HEAD` is the unrelated `81a3b5a...` from 2026-07-14; no stash reflog, G1/V1 branch ref,
  or G1/V1 worktree metadata remains.
- The available OpenCode watcher log records watchers on the temporary G1/V1 directory and no
  revert/reset/restore event. Its first owner-checkout watcher entry is after lane closeout.

No watcher revert occurred because there was no owner-path tracked-file change to revert.

## Architect-delegated Decisions

1. **Measure Current as shipped, not as imagined.** Current cells retain Career-based tiering and
   use Current only for rendered OVR/channels/provenance. Rebuilding `choice_overall` from Current
   would measure a hypothetical tierer and violate the instruction to drive production code.
2. **Make estimate exclusion basis-specific.** Remove 927 visible estimates in Career but only
   388 in Current (and the era-filtered subsets shown above). This is the least-assumptive
   honest-state interpretation because provenance is rendered per selected basis.
3. **Use the shipped default pick history and a state-equivalent Position First walk.** Offer
   streams depend on prior picks, but no human pick policy was supplied. Visible index 0 plus
   manager-first is the repository's deterministic `stepDraft` harness; mirroring it for Position
   First changes the fewest unspecified variables and makes every draft complete and replayable.
4. **Use full three-player offers as the primary denominator.** The product contract is “up to
   three,” while the requested metric is a triple. Cardinality is still recorded and every
   observed shipped offer happened to contain three numeric candidates.
5. **Cluster statistical uncertainty by complete draft.** Treating all offers as independent
   would understate uncertainty because later spins share seed and pick history. The ratio
   sandwich interval keeps the draft as the independent sampling unit.
6. **Interpret the requested two gaps as sorted adjacent gaps.** Three cards have three unordered
   pair distances but two adjacent gaps. The output also stores the raw visible-order OVR triple
   and max-minus-min spread, so no distance information needed for the thresholds is lost.
7. **Use a uniform pool triple only as the denominator baseline.** It quantifies the histogram's
   inherent tie probability without pretending to reproduce production's weighted squad draw or
   diversity selector.

## Reproduction and Scope

From a clean clone with workspace dependencies installed:

```bash
NODE_OPTIONS=--max-old-space-size=8192 \
  pnpm exec tsx packages/data/scripts/analyze-choose3-clustering.mts \
  > /tmp/choose3-clustering.json
cmp /tmp/choose3-clustering.json \
  docs/reports/choose3-clustering-measurement-2026-07-17.json
```

The compact JSON includes 270,336 per-offer records: raw visible OVR triples, spreads, adjacent
gaps, threshold masks, both position definitions, provenance, pick index, seed/draft identity,
full cell summaries, per-pick curves, pool histograms, input fingerprints, and convergence
prefixes.

No rating changed; no curve or tiering logic changed; no ETL source, compact bundle, manifest,
golden, canary, lambda, realism band, or Daily salt map is in the diff. The analyzer reads the
tracked shipped Brotli artifact and writes only stdout. Rating anchors remain
`wc-perf-6.6.0` / `proj-career-5.6.0`; ratings SHA remains
`896301819a2988e4e93b3038b35ffa44bcef4182b4a55ac82c7569241801cee0`; draft-pool SHA remains
`ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.

This report does not recommend a rating change, decide whether clustering is enjoyable, or open
merit-v4.7. Those judgments require the owner's playthrough evidence alongside these measurements.
