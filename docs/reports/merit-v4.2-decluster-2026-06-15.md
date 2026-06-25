# merit-v4.2 DECLUSTER ratings season - ship report

Branch: `merit-v4.2`
Date: 2026-06-15
Status: pre-merge candidate; final merge/deploy/live-verification section is updated during ship closeout.

## Outcome

- Candidate runtime: `runtime-data-2.4.0` / `wc-perf-6.2.0` / `proj-career-5.2.0` / `engine-2026.06.15-merit-v4.2`.
- Leaderboard season key: `engine-2026.06.15-merit-v4.2_wc-perf-6.2.0+proj-career-5.2.0_2026-06-04_ruleset-2026.06.04_f8de3452`.
- Rebased on `origin/main` `9892af365dd85d36783f4a038ca8a946d3b36291` after the parallel `ui-polish` lane landed.
- HUMAN ACTIONS: none requested by this lane; owner approval step intentionally waived by dispatch.
- Oracle note: initial GPT-5.5 high-path oracle planning was obtained before implementation; later final-form oracle attempts failed because the RepoPromptCE oracle transport was closed.

## Mechanism

- Historical squad tables now stage per-player club, caps, international goals where available, and club-nation code from pinned Wikipedia squad revisions.
- Historical raw-only rows compute a factual context score from caps, international goals, club-league context, and tournament role; a component activates only when >=80% of that squad has that field, and missing values under an active component are honest-low rather than guessed.
- 2026 projected raw-only rows use the same context allocator for caps, international goals, and club-league context. Tournament role is intentionally inactive for 2026 because tournament minutes do not exist yet.
- The context term is bounded inside the existing replacement-to-raw-ceiling band and is inactive for career-stature-dominant or award-headroom rows. v4.2 uses a global context-target exponent of `0.88` so mid/high public-record differences separate without per-player overrides.
- Display floor for measured rows widens to 60; baseline-anchor estimates remain capped to [66, 73]. The unified display curve is re-frozen at raw anchors floor `20.0`, median `41.84577933310018`, p95 `59.14638138639868`, max `100.0`, with high-tail exponent `2.00`.

## Sourcing

- Historical squad-table facts: English Wikipedia squad pages, CC-BY-SA 4.0, pinned one revision per tournament under `etl/sources/wikipedia_historical_squads/fetch_manifest.json`; 2022 squad page revision `1357405491`, retrieved 2026-06-11, sha256 `b6585538431bc960de174cc15e61155ca397e785632f00b603038f740420bc62`.
- 2026 squad facts: English Wikipedia 2026 squad snapshot revision `1357762108`, retrieved 2026-06-04, from `etl/sources/wikipedia_2026/SOURCES.json`.
- Fjelstul/RSSSF/tournament facts continue through the existing pinned sources; no proprietary game-rating source or fan-vote award path is used.

## Staged Facts

| Scope                |  Cards |   caps | intl goals | club nation |
| -------------------- | -----: | -----: | ---------: | ----------: |
| Historical 1930-2022 | 10,973 | 10,809 |      1,573 |      10,949 |
| Projected 2026       |  1,246 |  1,246 |      1,246 |       1,246 |

## Cluster Inventory

Full before/after inventory: `docs/reports/merit-v4.2-decluster-cluster-inventory.csv`. Rows are squad+basis+overall groups where at least 5 player cards share the same display overall. Both Career and Current bases are included.

| Metric                                  | Before runtime-data-2.3.0 | After runtime-data-2.4.0 |
| --------------------------------------- | ------------------------: | -----------------------: |
| >=5-player cluster groups               |                     1,451 |                      468 |
| Player rows inside those groups         |                     9,767 |                    2,712 |
| Modern rows inside those groups (1998+) |                     5,416 |                      938 |
| 2010+ rows inside those groups          |                     3,518 |                      637 |

Target squads, max duplicate display OVR by basis:

| Squad             | Career before | Career after | Current before | Current after |
| ----------------- | ------------: | -----------: | -------------: | ------------: |
| Ghana 2022        |             7 |            4 |              7 |             4 |
| Morocco 2022      |            17 |            4 |             17 |             4 |
| Tunisia 2022      |            13 |            4 |             13 |             4 |
| Ghana 2026        |             8 |            4 |              8 |             4 |
| Ivory Coast 2026  |            12 |            4 |             12 |             4 |
| South Africa 2026 |             5 |            4 |              5 |             4 |
| Tunisia 2026      |             7 |            4 |              7 |             4 |
| North Korea 2010  |             6 |            5 |              6 |             5 |

Residual note: North Korea 2010 still has a 5-player current/career cluster after v4.2, but those rows share similarly thin public records: PRK domestic clubs, narrow caps range, and similar tournament roles in the clustered sample. This is an honest near-identical-record cluster, not an undifferentiated filler wall.

Top residual cluster groups after v4.2:

| Basis   | Squad          | OVR | Size | Score span | Caps span | Sample                                                                                                                                            |
| ------- | -------------- | --: | ---: | ---------: | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| current | Uruguay 1930   |  88 |   13 |      3.115 | 10-49     | Scarone (49 caps); Andrade (30 caps); Nasazzi (28 caps); Fernández (20 caps); Castro (17 caps); Gestido (10 caps); Anselmo; Dorado                |
| career  | Turkey 1954    |  66 |   11 |      2.767 | 0-11      | Şeren (11 caps); Ertan (4 caps); Dirimlili (3 caps); Ersoy (3 caps); Beratlıgil (2 caps); Bolatlı (2 caps); Akgün (1 caps); Berman (0 caps)       |
| current | Turkey 1954    |  66 |   11 |      2.767 | 0-11      | Şeren (11 caps); Ertan (4 caps); Dirimlili (3 caps); Ersoy (3 caps); Beratlıgil (2 caps); Bolatlı (2 caps); Akgün (1 caps); Berman (0 caps)       |
| career  | Scotland 1954  |  69 |   11 |      1.117 | 0-5       | Hamilton (5 caps); Mackenzie (4 caps); Combe (3 caps); McMillan (3 caps); Ormond (3 caps); Anderson (1 caps); Fernie (1 caps); Mochan (1 caps)    |
| current | Scotland 1954  |  69 |   11 |      1.117 | 0-5       | Hamilton (5 caps); Mackenzie (4 caps); Combe (3 caps); McMillan (3 caps); Ormond (3 caps); Anderson (1 caps); Fernie (1 caps); Mochan (1 caps)    |
| career  | Uruguay 1930   |  88 |   10 |      3.115 | 10-20     | Fernández (20 caps); Castro (17 caps); Gestido (10 caps); Anselmo; Dorado; Iriarte; Mascheroni; Melogno                                           |
| current | Spain 2010     |  88 |   10 |      2.441 | 16-87     | Xavi (87 caps); Puyol (83 caps); Torres (73 caps); Alonso (69 caps); Ramos (60 caps); Marchena (59 caps); Fàbregas (49 caps); Capdevila (46 caps) |
| career  | Argentina 1934 |  69 |   10 |      2.043 | 0-3       | Devincenzi (3 caps); López (2 caps); Belis (0 caps); Irañeta (0 caps); Izzeta (0 caps); Nehin (0 caps); Pedevilla (0 caps); Pérez (0 caps)        |
| current | Argentina 1934 |  69 |   10 |      2.043 | 0-3       | Devincenzi (3 caps); López (2 caps); Belis (0 caps); Irañeta (0 caps); Izzeta (0 caps); Nehin (0 caps); Pedevilla (0 caps); Pérez (0 caps)        |
| current | Brazil 2006    |  88 |    9 |      6.510 | 32-138    | Cafu (138 caps); Carlos (121 caps); Ronaldo (92 caps); Dida (86 caps); Zé Roberto (79 caps); Lúcio (50 caps); Juan (38 caps); Kaká (38 caps)      |

## Face-validity Sample

| Player             | Squad              | Public facts staged                           | Career OVR | Current OVR | Basis                   | Read                                                                                                       |
| ------------------ | ------------------ | --------------------------------------------- | ---------: | ----------: | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Heung-min Son      | South Korea 2026   | 144 caps; 56 intl goals; Los Angeles FC (USA) |         91 |          84 | career_stature_estimate | global marquee holds elite; current basis lower than career but facts keep Son above ordinary squadmates   |
| Gareth Bale        | Wales 2022         | 108 caps; 40 intl goals; Los Angeles FC (USA) |         90 |          83 | career_stature_estimate | Wales marquee remains 90 career with high caps/goals; 2022 current reads lower                             |
| Zlatan Ibrahimović | Sweden 2002        | 9 caps; null intl goals; Ajax (NETHERLANDS)   |         90 |          70 | career_stature_estimate | elite career stature with tournament-current record separated by year/context                              |
| Zlatan Ibrahimović | Sweden 2006        | 38 caps; null intl goals; Juventus (ITA)      |         90 |          72 | career_stature_estimate | elite career stature with tournament-current record separated by year/context                              |
| Erling Haaland     | Norway 2026        | 49 caps; 55 intl goals; Manchester City (ENG) |         92 |          88 | career_stature_estimate | Haaland remains the exact 92 registered career anchor; current basis reflects actual Norway/projected path |
| Salem Al-Dawsari   | Saudi Arabia 2026  | 108 caps; 26 intl goals; Al-Hilal (KSA)       |         87 |          78 | career_stature_estimate | Salem remains clear Saudi standout; ordinary Saudi controls stay low                                       |
| Christian Pulisic  | United States 2026 | 85 caps; 33 intl goals; Milan (ITA)           |         88 |          83 | career_stature_estimate | Pulisic holds 88 career anchor and top US public-record signal                                             |
| Mohamed Salah      | Egypt 2026         | 115 caps; 67 intl goals; Liverpool (ENG)      |         93 |          81 | career_stature_estimate | Salah remains rare elite with strongest caps/goals sample                                                  |
| Thomas Partey      | Ghana 2026         | 57 caps; 15 intl goals; Villarreal (ESP)      |         79 |          79 | measured_performance    | Partey separates Ghana 2026 midfield tier without material-headroom inflation                              |
| Franck Kessié      | Ivory Coast 2026   | 102 caps; 15 intl goals; Al-Ahli (KSA)        |         78 |          78 | measured_performance    | Kessie separates Ivory Coast 2026 but stays below elite gate                                               |
| Wahbi Khazri       | Tunisia 2022       | 72 caps; 24 intl goals; Montpellier (FRA)     |         80 |          80 | measured_performance    | Khazri differentiates Tunisia 2022 from lower-record teammates                                             |
| Mohammed Kudus     | Ghana 2022         | 18 caps; 5 intl goals; Ajax (NED)             |         76 |          76 | measured_performance    | Kudus lifts from Ghana 2022 raw-only plateau but stays plausible                                           |
| Nasser Al-Dawsari  | Saudi Arabia 2026  | 42 caps; 0 intl goals; Al-Hilal (KSA)         |         72 |          72 | measured_performance    | journeyman control, not Salem; stays raw/current-path low                                                  |

## Pre-registered Probes

- Target CAF clusters resolved where public facts differ: PASS in `test/merit-v42.acceptance.test.ts`; all listed target squads have max duplicate Current OVR < 5.
- Named anchors: PASS in committed acceptance probe: Son >=88, Bale 90, Ibra 90, Haaland 92, Salem Al-Dawsari clear top of Saudi Arabia, Pulisic 88.
- 90+ rarity: PASS, 306 / 12219 = 2.504% top-level ratings.
- Weak-league journeymen stay honest-low: PASS in acceptance probe controls, including Nasser Al-Dawsari, Abdullah Al-Hamdan, Musab Al-Juwayr, Cristian Roldan, and Maximilian Arfsten below 83 and non-material.

## Calibration

- λ refit before realism re-lock: `BASE=1.05`, `SPREAD=6.5`, `MIN=0.30`, `MAX=3.40`, `W_DEF/W_GK=0.70/0.30`, `GAMMA_MID=0.70`, `KO_LAMBDA_FACTOR=0.82`, `LAMBDA_DISP` unchanged.
- Symmetric realism landing after final context-shape regeneration: mean goals 2.549, group draw 25.00%, margin >=4 5.06%, KO->ET 33.73%, KO->shootout 22.13%; all within existing bands.
- Heavy realism gate: PASS, 1 file / 7 tests.
- Strategic-pick canary regenerated under `WCDRAFT_CANARY_REGEN=1`; focused canary file passed 1/1 after regeneration.
- E2E real-run golden seed remains `wcdraft:e2e-real-run:engine-v2-e3a:29`; regenerated fixture reaches R32, record 0-3-1, matches 4.

## Runtime Anchors

- Draft-pool raw bytes: 126,794,469; manifest brotli bucket: 2,131,456; copied `.br` bytes: 2,131,348; sha256 `c0312658ba09f305a70509ba9a8dbfe87c5cd2ffefbbb6fd28e6a0247fa695ca`.
- Scenario sha256 `b482b03b0628d63eb5701089f5faec7773d03ce400a941438186faf93fc78ef4`; manifest sha256 `e4075505351419b7ce9d00ad909017c3f25bd16ea9c730f679536fb3311cd377`.
- Ratings lock: 76,724,883 bytes; sha256 `c3c80f5bb3286189994400f6a872531f2dd027998110caf4b7e7bf888e6d6529`.

## Gate Log

| Gate                                                                                                                                     | Result                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `python -m wcdraft_etl.pipeline`                                                                                                         | PASS: 9 tables / 56,743 rows / player_tournaments 13,843                                                                                                                                                                                                                 |
| `python -m wcdraft_etl.rating`                                                                                                           | PASS: 10,973 ratings / null 0 / baseline 386 / RSSSF 1,578                                                                                                                                                                                                               |
| `python -m wcdraft_etl.ingest_2026`                                                                                                      | PASS: nations minted 5 / players minted 894 / cards 1,246 / teams 48 / knockout slots 62                                                                                                                                                                                 |
| `cd etl && .venv/bin/ruff check src tests && .venv/bin/pytest -q`                                                                        | PASS: ruff clean / 297 passed                                                                                                                                                                                                                                            |
| `pnpm --filter @wcdraft/data build:compact`                                                                                              | PASS: 12,219 player ratings / 501 managers / 295 legends / draft-pool brotli 2,131,456 bytes                                                                                                                                                                             |
| `pnpm --filter @wcdraft/data exec vitest run test/merit-v42.acceptance.test.ts test/compact-data.integrity.test.ts`                      | PASS: 2 files / 32 tests                                                                                                                                                                                                                                                 |
| `WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts`                   | PASS: 1 file / 1 test                                                                                                                                                                                                                                                    |
| `pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts test/realism-modern-norms.golden.test.ts` | PASS: 2 files / 6 tests                                                                                                                                                                                                                                                  |
| `pnpm --filter @wcdraft/data test:realism:heavy`                                                                                         | PASS: 1 file / 7 tests                                                                                                                                                                                                                                                   |
| `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`                                                    | PASS: 3 tasks / 53 tests                                                                                                                                                                                                                                                 |
| `pnpm --filter @wcdraft/web gen:leaderboard-golden`                                                                                      | PASS: season key `engine-2026.06.15-merit-v4.2_wc-perf-6.2.0+proj-career-5.2.0_2026-06-04_ruleset-2026.06.04_f8de3452`; classic -3 / hidden -25                                                                                                                          |
| `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`                                                                      | PASS: 4 tasks / leaderboard 6 tests                                                                                                                                                                                                                                      |
| `pnpm typecheck`                                                                                                                         | PASS: 8 tasks                                                                                                                                                                                                                                                            |
| `pnpm lint`                                                                                                                              | PASS: 5 tasks                                                                                                                                                                                                                                                            |
| `pnpm test`                                                                                                                              | PASS after fix-forwarding stale OG test runtime-data stub: 8 tasks; web 694 passed / 1 skipped; data 74 passed / 7 skipped; core 366 passed; db 79 passed; marketing 64 passed                                                                                           |
| `pnpm build`                                                                                                                             | PASS: 4 tasks; Next build completed with existing chunk-cycle and edge-runtime warnings                                                                                                                                                                                  |
| `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`                                                               | PASS: 2 tasks / 107 tests                                                                                                                                                                                                                                                |
| `git diff --check`                                                                                                                       | PASS                                                                                                                                                                                                                                                                     |
| Fresh-context independent review                                                                                                         | PASS fallback: RepoPromptCE sub-agent transport closed, so `/tmp/wcdraft-merit-v42-review` was created as a detached fresh worktree; re-executed ETL provenance/display audit 4 passed, data merit/compact/realism probes 38 passed, and web leaderboard golden 6 passed |
| CI                                                                                                                                       | PENDING                                                                                                                                                                                                                                                                  |
| Merge / deploy / live verify                                                                                                             | PENDING                                                                                                                                                                                                                                                                  |

## Ship Closeout

- Merge SHA: PENDING.
- PR: PENDING.
- Deploy id: PENDING.
- Live verify: PENDING.
- Revert status: PENDING; no revert attempted before live verification.
- Git status at closeout: PENDING.
