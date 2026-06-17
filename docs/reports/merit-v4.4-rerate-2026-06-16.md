# merit-v4.4 owner re-rate (85–90 CURRENT-basis band) — ship report

Branch: `ws-merit/v4.4`
Date: 2026-06-16
Status: pre-merge RED candidate. Merge / deploy / live verification are blocked on
the owner approval checkpoint.

## Outcome

- Candidate runtime: `runtime-data-2.6.0` / `wc-perf-6.4.0` / `proj-career-5.4.0`
  / `engine-2026.06.16-merit-v4.4`.
- Leaderboard season key:
  `engine-2026.06.16-merit-v4.4_wc-perf-6.4.0+proj-career-5.4.0_2026-06-04_ruleset-2026.06.04_f79ba870`.
- Manual source: `etl/overrides/manual-ratings-v4.4.csv`
  (sha256 `d51f188357d645f2ff558d8a851434ab78d7e5755136e0be189ad34cdab143a0`).
- Applied 515 / 1,154 rows (639 blank-target rows are explicit no-changes, skipped).
- Resolution: 515 / 515 matched (100.0000%); 0 honest misses; 0 ambiguous; 0
  card collisions (515 distinct effective pins).
- HUMAN ACTION: owner approval is required before merge.

## ⚠ Basis correction — the file is the CURRENT basis, not Career

The dispatch labelled this the "85–90 CAREER band". Build-verified evidence shows
the opposite, and the implementation follows the evidence (owner-confirmed):

- A v4.3-state baseline rebuild reproduces the live committed `ratings_2026.json`
  with 0 / 1,246 mismatches, so the comparison reads the genuine live ratings.
- The file's `current_rating` column equals the **Current** basis overall for
  **515 / 515** cards; it equals the **Career** basis overall for only 339 / 515.
- The file's own `delta` column (144 up / 249 down / 122 same) reproduces exactly
  when computed against the **Current** overall, and not against Career
  (62 up / 338 down / 115 same).
- All 39 cards with Career ≥ 95 (Pelé, Messi, Maradona, Beckenbauer, Zidane, …)
  would be pushed **down** if targets were applied to Career. The dispatch frames
  these as "legends corrected up" — true only on the Current basis (Pelé 1970:
  Career 99, Current 88 → target 95 = ↑ on Current, ↓ on Career).

Owner decision (2026-06-16): apply on the **CURRENT basis, Current-only pin** —
the all-time Career view is left untouched (legends keep 95–99).

## Application contract (CURRENT-basis, Current-only)

Applied in `etl/src/wcdraft_etl/manual_overrides.py`, layered after the merit
model builds internal rows, in two ordered layers:

1. **merit-v4.3** pins BOTH the career `score_0_100` and the current
   `current_score_0_100` (byte-for-byte the shipped v4.3 mechanism — unchanged).
2. **merit-v4.4** pins the CURRENT basis ONLY (`current_score_0_100`); the career
   `score_0_100`, the default/Career display overall, and the top-level sim
   channels are untouched. The current display overall is short-circuited to the
   owner target (no display-leak through the pooled curve); the current channels
   are rematerialized from the same pinned score via the existing decoupled
   channel map.

For each resolved card: Current display OVERALL == target; Current channels
coherent with the new Current overall; Career basis untouched; non-listed cards
unchanged. The 639 blank-target rows are never applied.

Verified on the full rebuild:

- Career overall changed: **0 / 1,246** (2026); top-level career channels
  changed: **0**.
- Current overall changed only for v4.4 cards (63 of the 73 2026 cards moved; 10
  were target == current no-ops); **0** collateral on non-listed cards.
- Spot pins: Pelé 1970 → Career 99 (untouched) / Current 95; Messi 2026 → Career
  99 / Current 86; Jara 2010 → Career 87 / Current 64; all 515 Current displays
  equal their target.

## v4.3 ∪ v4.4 precedence

- v4.3 effective pins: 2,246 cards (career + current). REMAIN.
- v4.4 effective pins: 515 cards (current only).
- Overlap (named by both): **87** cards → Career = v4.3 value, Current = v4.4
  target (v4.4's current target supersedes v4.3's current pin).
- v4.4-only new cards: **428**.
- Combined effective card pins: **2,674**.

### v4.3 basis sanity (owner-requested, no inversion)

v4.3 de-clustered the default/Career view and could not be inverted: its rows are
all from 2002+ editions, where the Career and Current bases nearly coincide
(matched-set means: Career 75.0 == Current 75.0; e.g. Kroos 89/88, Cafu 88/88).
The Career/Current divergence only exists for pre-2002 legends, which v4.3 never
touched. No latent inversion; the two re-rate layers operate on different bases
and coexist cleanly.

## Resolution

- Resolution machinery reused from v4.3 with three additions for the historical
  band: (a) stroke/ligature ASCII folding so heavy diacritics resolve
  (ł→l, ø→o, đ→d, æ→ae, ß→ss, ı→i — verified on Hoeneß, Kjær, Sørensen, Lučić,
  Brozović, …), applied opt-in so the v4.3 path stays byte-identical;
  (b) the candidate index widened to every men's World Cup edition (1930–2026 —
  the band reaches back to 1954); (c) absent nation/year blocks recorded as honest
  misses rather than raising (none occurred).
- Artifacts: `etl/output/manual-ratings-v4.4-resolution.csv` (515),
  `manual-ratings-v4.4-unmatched.csv` (0), `manual-ratings-v4.4-effective.csv`
  (515), `manual-ratings-v4.4-summary.json`.
- v4.3 resolution re-run is byte-identical (2,300 / 2,516; 216 unmatched;
  committed v4.3 artifacts unchanged).
- Honest misses: **none** (100% match).

## Version bump

| Anchor | v4.3 | v4.4 |
|---|---|---|
| runtime data | `runtime-data-2.5.0` | `runtime-data-2.6.0` |
| engine | `engine-2026.06.15-merit-v4.3` | `engine-2026.06.16-merit-v4.4` |
| historical rating | `wc-perf-6.3.0` | `wc-perf-6.4.0` |
| projected rating | `proj-career-5.3.0` | `proj-career-5.4.0` |
| leaderboard season | `..._923c4a93` | `..._f79ba870` |

`runtime-data-2.5.0` is retained under
`packages/data/src/retained-runtime-data/runtime-data-2.5.0/` (rebuilt from a
pristine origin/main checkout; draft-pool decompressed sha256
`e9d3a20b7d5cc1dab239bd54c07e45f3f1ccff137b29ca85f3a6176959d8a448` matches the
committed 2.5.0 manifest fingerprint exactly — which also proves the v4.4 code
introduces no career/v4.3 regression). 2.3.0 and 2.4.0 remain retained.

Runtime bundle anchors (2.6.0):

- Draft-pool raw bytes: 129,690,546; sha256
  `a65ae19048cea5c2ec6c…` (full value in `src/generated/manifest.json`).
- Draft-pool brotli: 2,221,824 bytes (budget 2,540,672 — within budget).
- Ratings lock: 78,727,042 bytes, sha256
  `21fc95027fbc235478aa230e9f49800ed26346915ed3fb92da5be3e8f8a802bd`,
  rating_version `wc-perf-6.4.0`.

## Distribution (the elite-band shift)

| Metric | Baseline (v4.3) | v4.4 | Δ |
|---|---:|---:|---:|
| **Career** 90+ share | 2.6516% | 2.6516% | 0 (untouched) |
| **Career** 85–90 band (cards) | 1,204 | 1,204 | 0 (untouched) |
| **Current** 90+ share | 0.5320% | 1.0066% | +0.4746pp |
| **Current** 91+ count | 23 | 79 | +56 new entrants (91–95) |
| **Current** 85–90 band (cards) | 1,154 | 920 | −234 |

The +56 new 91+ entrants are exactly the dispatch's "~56 entrants at 91–95". The
dispatch's `2.6516%` figure is the **Career** 90+ share — which v4.4 leaves
unchanged. The rise is entirely on the **Current** basis.

## Canary + realism (sim is Career-basis; v4.4 is Current-basis)

The strategic-pick canary and realism gate sim the default/**Career** basis,
which v4.4 does not change. Therefore:

- Strategic-pick canary: **0 pick flips**. Regen is stamp-only — the diff is the
  two version-stamp lines (`rating_version`, `engine_version`); the entire `picks`
  array is byte-identical across all 5 seeds.
- λ is **unchanged** (no refit). The realism gate re-runs deterministically and
  the landing numbers in `asym-realism-golden.json` are byte-identical to v4.3
  (only the `engine_version` stamp + doc strings move). Re-fitting λ here would
  re-lock calibration to a Career distribution that did not move — explicitly out
  of bounds per the operating contract. Career-basis realism is confirmed
  unchanged.
- Current-basis impact (informational): the existing canary/realism harness sims
  the Career basis only, so there is no Current-basis sim canary. The Current
  impact is fully characterised by the 515 re-rates (144 up / 249 down / 122 same)
  and the +56 new 91+ entrants above.

## Gate log

| Gate | Result |
|---|---|
| `python -m wcdraft_etl.manual_overrides` | PASS — v4.3 2,300/2,516; v4.4 515/515; 2,674 combined |
| `python -m wcdraft_etl.rating` | PASS — 10,973; null 0; baseline 386; RSSSF 1,578 |
| `python -m wcdraft_etl.ingest_2026` | PASS — 1,246 cards; 48 teams; 62 KO slots |
| `cd etl && ruff check src tests` | PASS |
| `cd etl && pytest -q` | PASS — 297 + 5 new (test_manual_overrides_v44.py) |
| `pnpm --filter @wcdraft/data build:compact` | PASS — runtime-data-2.6.0; 12,219 ratings; legend 295 |
| `pnpm --filter @wcdraft/data test:golden:data` | PASS — 4 files / 38 tests (after fix-forward of the version-anchor + de-cluster-exempt assertions) |
| `pnpm --filter @wcdraft/data test:golden:integration` | PASS — e2e seed `:105` unchanged; era 4 presets |
| strategic-pick canary | PASS — 0 pick flips (stamp-only regen) |
| asym realism golden | PASS — landings byte-identical; stamp-only |
| `pnpm --filter @wcdraft/data test:realism:heavy` | PASS — 1 file / 7 tests |
| `pnpm --filter @wcdraft/web test:golden:leaderboard` | PASS — 6 tests; season key `..._f79ba870` |
| core RNG/draft goldens | PASS — test:golden 67 · test:golden:draft 40 |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS — typecheck 8 · lint 5 · test 8 (web 694+1skip, data 74+7skip, core 366, db 79, marketing-x 64) · build 4 |
| `git diff --check` | PASS — `.gitattributes` marks the fingerprinted override CSVs `-text -whitespace` (intrinsic CRLF) |
| Fresh-context independent review | PENDING |
| CI | PENDING |
| Merge / deploy / live verify | PENDING owner approval |

## Ship closeout

- Candidate SHA: posted at the owner approval checkpoint.
- PR / merge / deploy / live verify / revert: PENDING owner approval.
