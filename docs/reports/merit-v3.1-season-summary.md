# merit-v3.1 Curation Season Summary

Branch: `merit-v3.1`
Current merge base: `origin/main` `12dd2b934760a2deac8670b195b932ef4f2638a2`
Runtime candidate: `runtime-data-2.1.0` / `wc-perf-5.1.0` / `proj-career-4.1.0`
Status: **candidate only**. No merge, deploy, or live production verification has
occurred for this branch.

## Source Scope Rules

### W1 public season honors

Declared scope before rescoring:

- Population: the final merit-v3 V8 §7 honest-miss-due-to-unstaged-facts cards:
  Lukaku and B. Fernandes. The final V8 gate did not identify any additional
  honest-miss card in that class.
- Fact families: public individual senior club/league/competition season honors
  established by the 2022 World Cup final.
- Included: domestic top-flight league MVP/player-of-year and UEFA senior club
  competition player-of-season.
- Excluded: fan votes, proprietary ratings, club-only player-of-year awards,
  team/squad selections already covered by position-balanced source families,
  monthly awards, and post-2022 facts.

Staged facts and snapshots:

| Player       | Fact                                            | Snapshot                                                                            |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Lukaku       | UEFA Europa League Player of the Season 2019-20 | `etl/sources/merit_v31/public_awards/lukaku_uefa_europa_league_player_2019_20.html` |
| Lukaku       | Serie A Best Overall / MVP 2020-21              | `etl/sources/merit_v31/public_awards/lukaku_lega_serie_a_best_overall_2020_21.html` |
| B. Fernandes | LPFP Primeira Liga Player of the Year 2017-18   | `etl/sources/merit_v31/public_awards/bruno_fernandes_lpfp_player_of_year.html`      |
| B. Fernandes | LPFP Primeira Liga Player of the Year 2018-19   | `etl/sources/merit_v31/public_awards/bruno_fernandes_lpfp_player_of_year.html`      |

Completeness assertion: the active source-set build pins 6 active notes, emits
63 active facts for 30 players, and the W1 scoped rows are exhaustively consumed
by `active_public_season_honors` with `snapshot_path` validation requiring
`etl/sources/`.

### W2/W2b retrospective and legend-census extension

W2 mechanism diagnosis: the named pre-1967 coherence failures already had
strong public retrospective and international-record evidence in the source set,
but the legend derivation lacked a route for high-index pre-1967 players whose
recognition is mostly retrospective rather than modern annual/position-balanced
award families.

W2 derivation rule:

- `pre_1967_retrospective_consensus`
- Requires career peak before 1967.
- Requires career-stature index `>= 0.70`.
- Requires complete source-derived public evidence combinations from IFFHS
  century selections, living-legends/retrospective selections, international
  record facts, and/or World Cup legacy facts.
- Does not inspect display rating, channels, or card IDs.

W2b extension rule:

- Complete parse of the `IFFHS Men Legends` section from the pinned public
  IFFHS World's Best Player snapshot.
- Complete parse of RSSSF's Guldbollen winners table as a public national
  player-of-the-year family. This is global over the table and is not a
  per-player Ibrahimović pin.
- The extension is non-fan-vote only. UEFA Team of the Year was removed because
  it is fan-selected; its removals are reported as guardrail losses, not hidden
  regressions.

Support snapshot manifest:

- `etl/sources/merit_v31/retrospective/SOURCES.json`
- Includes IFFHS Men Legends, IFFHS century, living legends, international
  caps/goals, ESM Team of the Season, UEFA club positional awards, African
  Player of the Year, European Player of the Year, Guldbollen, and the
  citation-backed WC All-Star research note.
- Excludes fan votes and proprietary ratings.

## Re-score Artifacts

Generated review artifacts:

- `docs/reports/merit-v3.1-historical-rescore-delta.csv` — 10,973 historical rows.
- `docs/reports/merit-v3.1-projected-rescore-delta.csv` — 1,246 projected rows.
- `docs/reports/merit-v3.1-rating-band-summary.csv` — historical/projected/pooled band counts.
- `docs/reports/merit-v3.1-legend-census-flips.csv` — 39 card-level legend flips with source refs and snapshots.
- `docs/reports/merit-v3.1-rating-delta-summary.json` — machine summary.

Measured summary versus `HEAD` / shipped V8:

| Metric                          |            V8 | v3.1 candidate |
| ------------------------------- | ------------: | -------------: |
| Runtime ratings                 |        12,219 |         12,219 |
| Display-changed cards           |           n/a |            208 |
| Basis-changed cards             |           n/a |             42 |
| Runtime legends                 |           270 |            287 |
| Career measured_performance     |        11,355 |         11,351 |
| Career career_stature_estimate  |           478 |            482 |
| Career baseline_anchor_estimate |           386 |            386 |
| Largest display pile            | 71 at 17.767% |  71 at 17.743% |
| 88 display share                |       11.302% |        11.114% |

Compact artifacts:

| Bundle        | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| manifest      | `d5b32a05ab45457087a9f807ac1de949e6c812bc319f7b4dff5cd64f619189a4` |
| draft pool    | `ba238aa16d21006989279f6bc74bb8fcc6d7e7768ec4716dbc4c78b47ceb6c02` |
| 2026 scenario | `182546ab9bf3d67f774e5773933f963b6d5915b3cd96f5785f8d5e48d7578463` |

`build:compact` was run twice and reproduced the same hashes.

## Probe Outcomes / Decision Table

| Area                       | Outcome                                                                                                                                                                                      | Decision / waiver posture needed                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| W1 Lukaku                  | PASS: `P-72637:WC-2022` 71 -> 88, `career_stature_estimate`, no legend.                                                                                                                      | No waiver needed.                                                                                          |
| W1 B. Fernandes            | PASS: `P-39584:WC-2018` 72 -> 81, `career_stature_estimate`, no legend.                                                                                                                      | No waiver needed.                                                                                          |
| W2 pre-1967 9              | PASS: zero remaining 94+ non-legend/non-award coherence violations.                                                                                                                          | No waiver needed.                                                                                          |
| W2b source extension       | PARTIAL PASS: Raúl, Eto'o, and Ibrahimović are restored under the declared non-fan public source scope; 33 V8-loss cards remain non-legend.                                                  | No waiver needed for non-restores if owner accepts the declared source rule.                               |
| W2b guardrail losses       | PASS / explicit tradeoff: 11 cards lose legend because fan-voted UEFA Team of the Year was removed.                                                                                          | Owner should affirm this no-fan-vote posture; otherwise the scope must be reopened explicitly.             |
| Sweden-2002 named exemplar | PASS: Ibrahimović is restored and moves 86 -> 90; every no-award Sweden-2002 squad member remains <=88.                                                                                      | No waiver needed for ordering.                                                                             |
| Sweden-2002 cohort shelf   | PARTIAL PASS: the cohort is not flat (`[68, 70, 71, 72, 73, 80, 86, 88]`), but four no-award players remain at 88 because W3 stopped.                                                        | Covered by W3 decision.                                                                                    |
| W3 88-wall                 | STOP: no implementation. The requested global `<=4% at any display value` gate conflicts with the standing median/control constraints by pigeonhole lower bound.                             | Owner decision required: accept STOP proof, or replace the gate with a compatible 88-specific wall metric. |
| Display curve / lambda     | PASS: display-curve code unchanged; no persisted curve artifact moved; lambda refit skipped.                                                                                                 | No waiver needed.                                                                                          |
| Compact/canary             | PASS: compact regen stable; canary regen twice and normal canary pass.                                                                                                                       | No waiver needed.                                                                                          |
| Leaderboard season key     | PASS: new key `engine-2026.06.12_wc-perf-5.1.0+proj-career-4.1.0_2026-06-04_ruleset-2026.06.04_7fcbb544`; current-prod skew fixture derives from `c174775d223d8776f8950749b50a0e6099ca456b`. | No waiver needed.                                                                                          |
| Live prod verification     | PENDING: requires cumulative review, SHA-pinned merge, deploy, live checks, and auto-revert on failed live checks.                                                                           | Cannot be waived before merge/deploy.                                                                      |

## Census Results

Runtime legend census moves 270 -> 287. The card-level flip list contains
28 gains and 11 losses. Every flip carries source refs and citation snapshots in
`docs/reports/merit-v3.1-legend-census-flips.csv`.

Rule-driven gained cards:

- Hidegkuti: 1954, 1958; citations include IFFHS century and RSSSF international caps/goals snapshots.
- F. Walter: 1954, 1958; citations include IFFHS century and RSSSF international caps/goals snapshots.
- Albert: 1962, 1966; citations include European Player of the Year, IFFHS century, RSSSF international caps/goals, and canonical WC awards.
- Raúl: 1998, 2002, 2006; citations include ESM Team of the Season, UEFA club positional awards, IFFHS Men Legends, RSSSF international caps/goals, and FIFA 100/living legends.
- Madjer: 1982, 1986; citations include African Player of the Year, IFFHS century, and IFFHS Men Legends.
- N. Santos: 1954, 1958, 1962, 1966; citations include FIFA 100/living legends and the WC All-Star research note.
- Ocwirk: 1954; citations include IFFHS century.
- Eto'o: 1998, 2002, 2010, 2014; citations include African Player of the Year, ESM Team of the Season, UEFA club positional awards, and IFFHS Men Legends.
- Andrade: 1930; citations include IFFHS century.
- Piola: 1938; citations include IFFHS century, RSSSF international goals, and canonical WC awards.
- Bozsik: 1954, 1958; citations include IFFHS century and RSSSF international caps.
- Ibrahimović: 2002, 2006; citations include RSSSF Guldbollen, ESM Team of the Season, IFFHS Men Legends, and RSSSF international caps/goals.
- Hanappi: 1954, 1958; citations include IFFHS century.

Guardrail legend losses from removing the fan-voted UEFA Team of the Year route:

- Sneijder: 2006, 2010, 2014.
- Hazard: 2014, 2018, 2022.
- Neymar: 2014, 2018, 2022, 2026.
- Alaba: 2026.

The named W2b V8-loss restoration set is exactly:

- Raúl: 1998, 2002, 2006.
- Eto'o: 1998, 2002, 2010, 2014.
- Ibrahimović: 2002, 2006.

The remaining V8-loss cards stay non-legend under the declared non-fan public
extension because they lack a qualifying restored census route in the staged
scope:

- `P-03013` van Nistelrooy: 2006.
- `P-30486` Suárez: 2010, 2014, 2018, 2022.
- `P-32798` Silva: 2010, 2014, 2018, 2022.
- `P-35183` Schmeichel: 1998.
- `P-39356` Kroos: 2010, 2014, 2018.
- `P-48955` De Bruyne: 2014, 2018, 2022, 2026.
- `P-53062` Čech: 2006.
- `P-55511` Nesta: 1998, 2002, 2006.
- `P-56947` Thuram: 1998, 2002, 2006.
- `P-64348` Piqué: 2010, 2014, 2018.
- `P-81297` Fàbregas: 2006, 2010, 2014.
- `P-84003` Ballack: 2002, 2006.
- `P-88946` Seedorf: 1998.

## Sweden 2002 Exemplar

| Card              | Player        | Old | New | Legend | Basis                   |
| ----------------- | ------------- | --: | --: | ------ | ----------------------- |
| `P-80105:WC-2002` | Ibrahimović   |  86 |  90 | true   | career_stature_estimate |
| `P-42808:WC-2002` | Alexandersson |  88 |  88 | false  | measured_performance    |
| `P-07902:WC-2002` | Hedman        |  88 |  88 | false  | measured_performance    |
| `P-42895:WC-2002` | Larsson       |  88 |  88 | false  | measured_performance    |
| `P-85432:WC-2002` | Svensson      |  88 |  88 | false  | measured_performance    |
| `P-68329:WC-2002` | Jakobsson     |  86 |  86 | false  | measured_performance    |
| `P-30568:WC-2002` | Lučić         |  86 |  86 | false  | measured_performance    |
| `P-06256:WC-2002` | Mellberg      |  86 |  86 | false  | measured_performance    |
| `P-56718:WC-2002` | Mjällby       |  86 |  86 | false  | measured_performance    |

No-award Sweden-2002 display values after v3.1: `[68, 70, 71, 72, 73, 80, 86, 88]`.
The cohort is not a flat shelf, and the strict ordering probe now passes because
Ibrahimović is 90 while every no-award squad member is 88 or below.

## W3 Design Verdict

The committed design document is
`docs/plans/merit-v3.1-88wall-design.md`.

Conclusion: stop W3 under the dispatched global pile-up gate. The no-award 88
wall can be targeted by a compatible 88-specific metric, but the requested gate
`pile-up <=4% at any display value` conflicts with the median 73 +/-1 and
anti-inflation controls. At least half of 12,219 cards must occupy the eight
integer display values 66..73, so some display value must carry at least
`ceil(6110 / 8) / 12219 = 6.25%`.

No W3 formula, source, or compact implementation was added.

## Canary / Simulation Consequences

Canary regeneration changed exactly one pick:

- Spin 9, `4-3-3.LW`: `P-29578:2026` Jérémy Doku -> `P-72637:2026` Romelu Lukaku.
- Mechanism: W1 makes Lukaku display 90 in 2026 Career basis; Doku remains 88.

PR-CI fix-forward: the heavy asymmetric realism gate surfaced a telemetry-golden
drift from the runtime rating/data change. The strategic PASS policy remained
inside every locked shape band; only the per-policy run-count/telemetry golden
was re-locked in `packages/data/test/realism/asym-realism-golden.json`.

The same PR-CI pass also red-flagged public HTML source snapshots through
GitGuardian/gitleaks generic key detectors. The committed
`etl/sources/merit_v31/**` HTML snapshots now redact only non-evidence
client-side key-like script literals, with fresh bytes/SHA entries in their
`SOURCES.json` manifests; article/table evidence used by the citations is
preserved.

The e2e real-run golden kept the same seed and draft picks, with rating-version
stamps updated. One scenario group match moved from 2-0 to 2-1 because the
rating data changed.

## Validation

Commands run and passing:

- `uv run --extra dev ruff check .` in `etl/`.
- `uv run --extra dev pytest -q` in `etl/`.
- `uv run --extra dev pytest tests/test_merit_v3_gate.py -q`.
- `pnpm --filter @wcdraft/core build`.
- `pnpm --filter @wcdraft/data build`.
- `pnpm --filter @wcdraft/data build:compact` twice with byte-identical hashes.
- `pnpm --filter @wcdraft/data test:golden:data`.
- `pnpm --filter @wcdraft/data test:golden:integration`.
- `pnpm --filter @wcdraft/data test -- test/realism/strategic-pick-canary.golden.test.ts`
  (`65 passed`, `7 skipped`; includes the strategic-pick canary).
- `pnpm --filter @wcdraft/web test:golden:leaderboard`.
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-token.test.ts lib/game/__tests__/run-token-v2.test.ts`.
