# merit-v4.1 ratings coverage season - pre-ship report

Date: 2026-06-14
Branch: `merit-v4.1`
Base: `origin/main` at `97392d07b34f23708406a3d50921c9c4800b0063`
Status: local gates pass on the rebased implementation; independent review, CI, merge, deploy, and live verification still follow this report.

## Outcome

Implemented Proposal A's ratings-coverage correction as a Red ratings season:

- Active source set: `active-career-source-set-2.1.0` -> `active-career-source-set-2.2.0`.
- Career stature: `career-stature-4.0.0` -> `career-stature-4.1.0`.
- Historical rating replay anchor: `wc-perf-6.0.0` -> `wc-perf-6.1.0`.
- Projected rating replay anchor: `proj-career-5.0.0` -> `proj-career-5.1.0`.
- Runtime data schema: `runtime-data-2.2.0` -> `runtime-data-2.3.0`.
- Engine season: `engine-2026.06.13-merit-v4` -> `engine-2026.06.14-merit-v4.1`.
- Leaderboard season key: `engine-2026.06.14-merit-v4.1_wc-perf-6.1.0+proj-career-5.1.0_2026-06-04_ruleset-2026.06.04_11cbbd5e`.

The implementation does not claim 150-250 newly hand-authored active rows. The broader pool already contains `2,144` licensing-clean source facts over `819` linked players in `source_facts.json`; this season makes that objective record usable in the projected material pathway and adds a bounded active-note recovery where the audit found concrete canonical misses. The active authoring delta is intentionally small and citation-backed: Salem Al-Dawsari AFC Champions League final-participation facts, Salem century-caps canonical recovery, and Aymen Hussein goals-record canonical recovery. Ambiguous names remain withheld.

## Methodology Delta

The league-of-employment prior changed from a dominant pre-tournament anchor to a smoother input:

| Position | merit-v4 weight | merit-v4.1 weight |
|---|---:|---:|
| FW | 0.31 | 0.18 |
| MF | 0.34 | 0.20 |
| DF | 0.31 | 0.18 |
| GK | 0.28 | 0.16 |

Projected v4.1 adds a conservative objective-record path for active 2026 cards. It requires a linked/minted career-stature row with minimum coverage/index and then either active current objective evidence or membership in the under-covered AFC/CAF/CONCACAF 2026 squad set. The path is capped at `0.70` material weight, so it can distinguish objective standouts without turning sparse active rows into all-time peaks. Fully material projected rows also snap tiny positive modulation misses to the shared up-cap when already within `0.005`; this preserves the previously approved Vinicius 2026 gate while leaving raw-only/journeyman cards untouched.

The league-prior decision is affirmative: change the prior. The old top-league weight made club employment too determinative for projected 2026 cards. v4.1 keeps league quality visible but makes objective individual record overcomable.

## Worked Anchors

Before values are from `origin/main` tracked 2026 outputs or prior locked merit-v4 anchors. After values are from this branch's generated runtime bundles.

| Anchor | Before | After | Result |
|---|---:|---:|---|
| Son 2026 | 90 `career_stature_estimate` | 90 `career_stature_estimate` | Holds acceptance `>=88`; the audit's older `85` example is stale against current `origin/main`. |
| Salem Al-Dawsari 2026 | 77 `measured_performance` | 86 `career_stature_estimate` | Top Saudi, objective-record path = 1, material weight = 0.70. |
| Saudi runner-up band | 77-79 measured | 77-79 measured | Salem is separated by 7 points from the top measured Saudi card. |
| Christian Pulisic 2026 | 81 `measured_performance` | 88 `career_stature_estimate` | United States gains a distinguished headroom card. |
| Mathew Ryan 2026 | 83 `measured_performance` | 87 `career_stature_estimate` | Australia gains a distinguished headroom card. |
| Aymen Hussein 2026 | 79 `measured_performance` | 87 `career_stature_estimate` | Iraq gains a distinguished headroom card. |
| Vinicius Jr 2026 | 90 `career_stature_estimate` | 90 `career_stature_estimate` | Prior merit gate preserved. |
| Bernardo Silva 2026 | 88 `measured_performance` | 88 `measured_performance` | Non-objective-path control not inflated. |
| Dayot Upamecano 2026 | 83 `measured_performance` | 82 `measured_performance` | Non-objective-path control remains measured. |
| Bale 2022 | 90 | 90 | European merit-v4 anchor holds. |
| Ibrahimovic 2002 | 90 | 90 | European merit-v4 anchor holds. |
| Ibrahimovic 2006 | 90 | 90 | European merit-v4 anchor holds. |
| Haaland 2026 | 92 | 92 | European merit-v4 anchor holds. |

Worked league-prior controls:

| Card | League strength | League weight | Projected raw | Objective path | Stature weight | Overall |
|---|---:|---:|---:|---:|---:|---:|
| Heung-min Son 2026 | 0.58 | 0.18 | 0.755743 | 0 | 1.00 | 90 |
| Salem Al-Dawsari 2026 | 0.58 | 0.18 | 0.653057 | 1 | 0.70 | 86 |
| Nasser Al-Dawsari 2026 | 0.58 | 0.20 | 0.539522 | 0 | 0.00 | 72 |
| Abdullah Al-Hamdan 2026 | 0.58 | 0.18 | 0.687086 | 0 | 0.00 | 79 |
| Musab Al-Juwayr 2026 | 0.58 | 0.20 | 0.707642 | 0 | 0.00 | 79 |
| Cristian Roldan 2026 | 0.58 | 0.20 | 0.482448 | 0 | 0.00 | 72 |
| Maximilian Arfsten 2026 | 0.58 | 0.18 | 0.544400 | 0 | 0.00 | 73 |

## Coverage Counts

Material headroom means top-level `overall_basis == "career_stature_estimate"` for at least one 2026 squad card.

| Confederation slice | Before | After | After details |
|---|---:|---:|---|
| AFC targeted squads | 0/7 | 7/7 | Australia Ryan 87; Iran Taremi 88; Iraq Aymen Hussein 87; Japan Nagatomo 88; Qatar 5 material cards with Khoukhi/Afif at 87; Saudi Arabia Salem 86; Uzbekistan Shomurodov 88. |
| CONCACAF targeted squads | 0/5 | 5/5 | Canada Larin 88; Haiti Nazon 87; Mexico Jimenez 88; Panama Carrasquilla 87; United States Pulisic 88. |
| CAF targeted squads | 2/8 | 4/8 | Egypt Salah 93 and Senegal Mane 90 hold; Algeria and Morocco gain material cards; Ghana, Ivory Coast, South Africa, and Tunisia remain honest misses. |

90+ remains rare: `290 / 12,219 = 2.373%` pooled runtime ratings; 2026 alone is `18 / 1,246 = 1.445%`.

## Versioned Artifacts

Measured compact outputs:

| Artifact | Value |
|---|---|
| Runtime ratings | 12,219 |
| Career basis split | 11,292 measured; 541 career-stature; 386 baseline |
| Career-stature table | 847 players; 209 material rows; 114 source-derived legends |
| Runtime legend census | 295 |
| Draft compact | 101,026,822 raw bytes; 1,429,760 brotli; sha `f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7` |
| Scenario compact | 108,775 raw bytes; 4,480 brotli; sha `bd362cb7a509b8081ec7febf440749217fe94f7fc7d14d9431ce28347803f420` |
| Manifest compact | 6,401 raw bytes; 1,920 brotli; sha `126a77fba59e9bf432b0163c6691a79eb3e70d93d037f7a8f92bad0a14de16ea` |
| Total compact | 101,141,998 raw bytes; 1,436,160 brotli |
| Ratings lock | 10,973 rows; 59,551,889 bytes; sha `81c2a6ab1983617e2b885db21b91e1f77bab574f2fb5d2d228aaaa956bf2fe26` |

## Canary, Lambda, Realism

Strategic-pick canary was intentionally regenerated from:

- `wc-perf-6.0.0+proj-career-5.0.0` / `engine-2026.06.13-merit-v4`
- to `wc-perf-6.1.0+proj-career-5.1.0` / `engine-2026.06.14-merit-v4.1`

Documented pick flips: 2.

| Seed | Spin | Slot | Before | After |
|---:|---:|---|---|---|
| 0 | 3 | `4-3-3.LCB` | `P-W26-0605:2026` | `P-47321:2026` |
| 4 | 7 | `4-3-3.LCM` | `P-96340:2026` | `P-W26-0019:2026` |

Lambda was refit before realism relock. Accepted tuple changes only `LAMBDA.GAMMA_MID` from `0.80` to `1.00`; fitter winner after 175 evaluations:

- goals/game `2.547`
- group draw `25.18%`
- margin >= 4 `4.79%`
- KO -> ET `33.87%`
- shootout `21.47%`

Heavy asymmetric realism was rederived after the final projected snap:

| Policy | Qualifying | Matches | Groups | KO | Goals/game |
|---|---:|---:|---:|---:|---:|
| `autoDraft` | 68 | 6,077 | 6,000 | 77 | 2.910 |
| `strategicAutoDraft` | 1,592 | 9,862 | 6,000 | 3,862 | 2.600 |
| `greedyOverallAutoDraft` | 345 | 6,550 | 6,000 | 550 | 3.151 |

## Validation

Local gates run on branch `merit-v4.1`. In a fresh clone, run
`node packages/data/scripts/ensure-generated-artifacts.mjs --inputs-only` before
the ETL pytest gate because `etl/output/ratings.json` is intentionally generated
on demand.

- `node packages/data/scripts/ensure-generated-artifacts.mjs --inputs-only`, then `cd etl && ruff check src tests && pytest -q` - PASS, 297 passed.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` - PASS.
  - Typecheck: 8/8 tasks.
  - Lint: 5/5 tasks.
  - Test: 8/8 tasks, including core 366, data 71 plus 7 skipped heavy gate, db 79, web 683 plus 1 skipped, marketing-x 64.
  - Build: 4/4 tasks. Next build emitted existing chunk-cycle/edge-runtime warnings only.
- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core` - PASS, 67 + 40 tests.
- `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data` - PASS, 31 + 22 tests.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web` - PASS, 6 tests.
- `pnpm --filter @wcdraft/data test:realism:heavy` - PASS, 7 tests.
- Focused pre-registered v4.1 probes: `pnpm --filter @wcdraft/data exec vitest run test/merit-v41.acceptance.test.ts test/compact-data.integrity.test.ts` - PASS, 31 tests.
- Focused canary/modern realism: `pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts test/realism-modern-norms.golden.test.ts` - PASS, 6 tests.

## Files

Primary implementation files:

- `etl/src/wcdraft_etl/rating_2026.py`
- `etl/src/wcdraft_etl/rating.py`
- `etl/src/wcdraft_etl/display_curve.py`
- `etl/src/wcdraft_etl/merit/__init__.py`
- `etl/merit/raw/active/club-season-honors.json`
- `etl/merit/raw/active/international-record.json`
- `packages/core/src/engine/calibration.ts`
- `packages/data/scripts/build-compact-data.mjs`
- `packages/data/test/merit-v41.acceptance.test.ts`
- `apps/web/lib/leaderboard/__tests__/ui-gating.test.ts`

Generated/relocked surfaces:

- ETL outputs under `etl/output/*`
- Compact manifests under `packages/data/src/generated/*`
- Golden fixtures under `packages/core/test/fixtures/*`, `packages/data/test/fixtures/*`, `packages/data/test/realism/*`, and `apps/web/lib/leaderboard/__tests__/fixtures/*`
- Methodology/state docs: `STATE.md`, `etl/RATING_METHODOLOGY.md`, `etl/RATING_METHODOLOGY_2026.md`, `packages/core/SIM_CALIBRATION.md`, `packages/data/README.md`

## Risks and Carryovers

- CAF is improved but not complete: Ghana, Ivory Coast, South Africa, and Tunisia still have no material headroom card in the current 2026 squad output. This is an honest miss under the conservative linker and current objective fact surface.
- Active authoring remains intentionally conservative. The pass did not manufacture domestic-top-scorer rows where no in-repo citation-backed, unambiguous linked source was already available.
- The branch changes rating/runtime/engine bytes and therefore requires fresh-context Red review, CI green, production deploy verification, and auto-revert if live checks fail.

## Human Actions

None requested or required by this autonomous dispatch. The normal Red human-approval gate is intentionally waived by the explicit season dispatch; the fresh-context review and CI gates remain mandatory before merge.
