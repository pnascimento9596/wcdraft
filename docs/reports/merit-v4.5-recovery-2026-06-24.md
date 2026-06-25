# merit-v4.5 recovered honest misses

Local RED-gate closeout for `ws-merit/v4.5`, measured 2026-06-24.

## Checkpoint reconstruction

Classification: **A — no durable progress**.

- Fresh implementation clone: `/tmp/wcdraft-merit-v45-resume.bNmoD8/repo`.
- `origin/main` remained `4fb3589637dd1d6268402781d899f67c5fc7847b`.
- `gh pr list --state all` found no v4.5 PR/branch; open PR state was unrelated.
- `etl/overrides/manual-ratings-v4.3.csv` matched the committed baseline sha256
  `f121d0f768fe70cfc6d699559bf78dc25d356ccea33ca0aa5e8ded11c65d9da6` and 2,516
  rows. No recovered v4.5 rows existed on remote.
- Main branch anchor greps were still v4.4, not v4.5.
- Live production manifest was still v4.4:
  `runtime-data-2.6.0` / `engine-2026.06.16-merit-v4.4` /
  `wc-perf-6.4.0` / `proj-career-5.4.0`.
- Live leaderboard season key was still
  `engine-2026.06.16-merit-v4.4_wc-perf-6.4.0+proj-career-5.4.0_2026-06-04_ruleset-2026.06.04_f79ba870`.

## Basis proof

`PYTHONPATH=etl/src python3 -m wcdraft_etl.manual_overrides` on the clean
baseline confirmed:

- v4.3: `2,300/2,516 matched (91.41%); 216 unmatched`
- v4.4: `515/515 matched (100.00%); 0 unmatched`

The resolved v4.3 rows proved the owner value basis:

- v4.3 resolved cards checked: `2,246`
- Career display mismatches: `0`
- Current display mismatches: `19`, all explained by v4.4 overlap
- Basis semantics: v4.3 pins **Career and Current**; v4.4 pins **Current only**
  and supersedes the v4.3/v4.5 Current pin where it overlaps.

## Recovery result

The implementer first derived 46 candidates. The independent reviewer then ran
in fresh clone `/tmp/wcdraft-v45-reviewer.uPY5eK/repo`, independently derived
matches, and finally performed a candidate-by-candidate agreement pass.

Ship set = implementer ∩ reviewer by the same `source_line` and same `card_id`:

- Implementer candidates: `46`
- Reviewer-agreed candidates: `36`
- Reviewer-disagreed/demoted implementer candidates: `10`
- Remaining v4.3 honest misses: `180`
- v4.3+v4.5 matched rows: `2,336/2,516 (92.85%)`
- v4.3+v4.5 effective Career+Current pins: `2,265`
- v4.3+v4.5 plus v4.4 Current overlay effective pins: `2,691`

The durable input file is:

- `etl/overrides/manual-ratings-v4.5-recovered.csv`
- sha256 `3effc3ba9adb7efd5fb4d00c406da5aa82db67d5b64f20e5a049cb807eaef249`
- row count `36`

Recovered rows:

| source_line | country      | year | source player                    | target | card_id              | evidence |
| ----------: | ------------ | ---: | -------------------------------- | -----: | -------------------- | -------- |
|           9 | Algeria      | 2010 | Medhi Lacen                      |     73 | `P-23484:WC-2010`    | wikidata |
|          70 | Argentina    | 2022 | Nicolas Gonzalo                  |     82 | `P-49114:WC-2022`    | wikidata |
|          78 | Argentina    | 2022 | Nahuel Lucero                    |     78 | `P-84430:WC-2022`    | wikidata |
|         112 | Australia    | 2018 | Timothy Filiga                   |     70 | `P-44926:WC-2018`    | wikidata |
|         234 | Brazil       | 2002 | Jose Vitor Roque Junior          |     81 | `P-66308:WC-2002`    | local    |
|         243 | Brazil       | 2010 | Julio de Espindola               |     89 | `P-11275:WC-2010`    | wikidata |
|         246 | Brazil       | 2010 | Daniel da Silva                  |     86 | `P-09441:WC-2010`    | wikidata |
|         252 | Brazil       | 2010 | Edinaldo Libanio                 |     83 | `P-82456:WC-2010`    | wikidata |
|         259 | Brazil       | 2010 | Donieber Marangao                |     78 | `P-61927:WC-2010`    | wikidata |
|         267 | Brazil       | 2014 | Julio de Espindola               |     82 | `P-11275:WC-2014`    | wikidata |
|         271 | Brazil       | 2014 | Fernando Roza                    |     81 | `P-41758:WC-2014`    | wikidata |
|         276 | Brazil       | 2014 | Frederico Guedes                 |     79 | `P-54042:WC-2014`    | wikidata |
|         280 | Brazil       | 2018 | Marcos Correa                    |     84 | `P-76060:WC-2018`    | wikidata |
|         281 | Brazil       | 2018 | Taison Freda                     |     82 | `P-87266:WC-2018`    | wikidata |
|         285 | Brazil       | 2022 | Gleison Nascimento               |     83 | `P-14060:WC-2022`    | wikidata |
|         286 | Brazil       | 2022 | Raphael Belloli                  |     83 | `P-83169:WC-2022`    | wikidata |
|         291 | Brazil       | 2022 | Daniel da Silva                  |     77 | `P-09441:WC-2022`    | wikidata |
|         309 | Cameroon     | 2002 | Jacques o                        |     69 | `P-93402:WC-2002`    | local    |
|         422 | Colombia     | 2018 | Juan Guillermo Cuadrado Bello    |     82 | `P-83216:WC-2018`    | local    |
|         649 | Denmark      | 2018 | William Vitved Kvist Jorgensen   |     70 | `P-93951:WC-2018`    | local    |
|         699 | Ecuador      | 2022 | Alexander Carabali               |     70 | `P-94877:WC-2022`    | wikidata |
|         712 | Ecuador      | 2026 | Jeremy Mera                      |     66 | `P-W26-0198:WC-2026` | wikidata |
|         766 | England      | 2022 | Philip Foden                     |     85 | `P-10501:WC-2022`    | local    |
|        1375 | Morocco      | 2022 | Yahya Attiat-Allah               |     72 | `P-91543:WC-2022`    | local    |
|        1434 | Netherlands  | 2022 | Kenneth Ina Dorothea Taylor      |     73 | `P-95763:WC-2022`    | local    |
|        1435 | Netherlands  | 2022 | Xavi Quentin Shay Simons         |     73 | `P-34458:WC-2022`    | local    |
|        1545 | Panama       | 2018 | Gabriel Arturo Torres Tejada     |     68 | `P-78106:WC-2018`    | local    |
|        1609 | Poland       | 2002 | Radoslaw Kaluzny                 |     74 | `P-29986:WC-2002`    | local    |
|        1707 | Portugal     | 2022 | Andre Miguel Valente da Silva    |     82 | `P-33280:WC-2022`    | local    |
|        1713 | Portugal     | 2022 | Antonio Joao Tavares Silva       |     66 | `P-05289:WC-2022`    | local    |
|        1715 | Qatar        | 2022 | Ali Qambar                       |     69 | `P-51678:WC-2022`    | wikidata |
|        1803 | Saudi Arabia | 2018 | Housain Ali Jassim Al-Mogahwi    |     71 | `P-77853:WC-2018`    | local    |
|        1910 | Senegal      | 2026 | Iliman Cheikh Baroy Ndiaye       |     79 | `P-33958:WC-2026`    | local    |
|        2503 | Uruguay      | 2026 | Federico Sebastian Vinas Barboza |     72 | `P-W26-0756:WC-2026` | wikidata |
|        2511 | Wales        | 2022 | Benjamin Davies                  |     78 | `P-41198:WC-2022`    | wikidata |
|        2516 | Wales        | 2022 | Christopher James Mepham         |     71 | `P-74888:WC-2022`    | wikidata |

## Remainder

Full remainder artifact:

- `etl/output/manual-ratings-v4.5-unmatched.csv`
- row count `180`

Reason counts:

| reason                            | count |
| --------------------------------- | ----: |
| `no_unambiguous_match`            |   112 |
| `duplicate_conflict_weaker_match` |    34 |
| `source_hint_not_player_name`     |    19 |
| `ambiguous_unapplied`             |    11 |
| `duplicate_conflict_weak_only`    |     4 |

Reviewer-only high-confidence rows not in the implementer candidate file were
not applied because they are outside the required intersection: source lines
`235`, `650`, `1068`, `1352`, `1763`, `2399`, and `2467`.

Reviewer-demoted implementer candidates were not applied: source lines `490`,
`639`, `640`, `715`, `719`, `720`, `960`, `1347`, `1809`, and `2095`.

## Runtime and calibration

Final anchors:

- schema: `runtime-data-2.7.0`
- engine: `engine-2026.06.17-merit-v4.5`
- historical rating: `wc-perf-6.5.0`
- projected rating: `proj-career-5.5.0`
- season key:
  `engine-2026.06.17-merit-v4.5_wc-perf-6.5.0+proj-career-5.5.0_2026-06-04_ruleset-2026.06.04_e0542bd8`

Bundle anchors:

- draft raw bytes: `129,711,288`
- draft sha256:
  `976f6ac517b679b02f052606fcc48809df7ae384ee69a6b015559faf9115ff00`
- draft manifest Brotli bucket: `2,222,592`
- copied `.br` bytes: `2,222,522`
- manifest sha256:
  `903e44f4ddeeb610d5f8b5aba68eaf01b345bc5a413a2de5e1a29d9767c938c4`
- scenario raw bytes: `108,775`
- scenario sha256:
  `75214e06dd8f90bd11bbe84b458128d39b8eeaf05b9cbf0ffba4b3b612c499c0`

The λ refit was run before realism re-lock. Winner:

- `BASE=0.95`, `SPREAD=5.5`, `MIN=0.8`, `MAX=3.4`
- `W_DEF=0.7`, `W_GK=0.30`, `GAMMA_MID=0.7`
- `KO_LAMBDA_FACTOR=0.82`
- `CHANCES.REGULATION=50`, `EXTRA_TIME=17`
- `LAMBDA_DISP.OUTER_PROB=0.2`, `A=0.75`
- `LAMBDA_DISP.GROUP_OUTER_PROB=0.02`, `GROUP_A=0.4`

Landing: goals `2.528`, draw `24.96%`, margin>=4 `5.02%`, ET `32.53%`,
shootout `21.73%`.

## Metrics

CAREER 90+ before/after:

- before: `324/12,219 = 2.6516%`
- after: `324/12,219 = 2.6516%`

CAREER 85+ histogram after:

| OVR | count |
| --: | ----: |
|  85 |   240 |
|  86 |   233 |
|  87 |   168 |
|  88 |   332 |
|  89 |   132 |
|  90 |    97 |
|  91 |    64 |
|  92 |    38 |
|  93 |    26 |
|  94 |    15 |
|  95 |    16 |
|  96 |     7 |
|  97 |    15 |
|  98 |    36 |
|  99 |    10 |

Clusters with >=5 players at the same basis/year/nation/OVR:

- v4.4: 485 groups, 2,828 player rows, 1,038 modern rows, 721 rows from 2010+
- v4.5: 488 groups, 2,843 player rows, 1,053 modern rows, 726 rows from 2010+
- added groups: 3
- removed groups: 0

Added groups:

- career Cameroon 2002 OVR 69 size 5:
  `P-56970:2002`, `P-60079:2002`, `P-63567:2002`, `P-78387:2002`, `P-93402:2002`
- current Cameroon 2002 OVR 69 size 5:
  `P-56970:2002`, `P-60079:2002`, `P-63567:2002`, `P-78387:2002`, `P-93402:2002`
- current Senegal 2026 OVR 79 size 5:
  `P-33958:2026`, `P-37935:2026`, `P-40621:2026`, `P-76835:2026`, `P-W26-0605:2026`

Strategic pick canary: 0 Career pick-sequence flips; the golden diff is
version-stamp only.

## Validation

- `pnpm install --frozen-lockfile`: PASS, 177 packages installed.
- `PYTHONPATH=etl/src python3 -m wcdraft_etl.manual_overrides`: PASS, v4.5
  `2,336/2,516 matched`, `180 unmatched`, `36 recovered`.
- `cd etl && PYTHONPATH=src pytest -q tests/test_manual_overrides_v44.py tests/test_manual_overrides_v45.py`:
  PASS, 9 tests.
- `PYTHONPATH=etl/src python3 -m wcdraft_etl.rating`: PASS, 10,973 ratings,
  overall null 0.
- `PYTHONPATH=etl/src python3 -m wcdraft_etl.ingest_2026`: PASS, 894 players
  minted, 1,246 2026 cards, 48 teams, 62 knockout slots.
- `pnpm --filter @wcdraft/data build:compact`: PASS, 12,219 ratings, 2.12 MiB
  brotli draft bundle.
- `pnpm --filter @wcdraft/data exec tsx scripts/fit-calibration.mjs`: PASS,
  175 evaluations, winner above.
- `WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts`:
  PASS, 1 test.
- `pnpm --filter @wcdraft/data exec tsx scripts/regen-asym-golden.mts`: PASS,
  relocked autoDraft/strategic/greedy outputs.
- `cd etl && ruff check src tests && PYTHONPATH=src pytest -q`: PASS,
  306 tests.
- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core --force`:
  PASS, 67 + 40 tests.
- `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data --force`:
  PASS, 31 + 22 tests.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web --force`:
  PASS, 6 tests.
- `pnpm --filter @wcdraft/data test:realism:heavy`: PASS, 7 tests.
- `pnpm exec turbo run typecheck --force`: PASS, 8 tasks, 0 cached.
- `pnpm lint`: PASS, 5 tasks.
- `pnpm test`: PASS, 8 tasks; core 376, data 82 passed / 7 skipped, db 83,
  marketing-x 64, web 704 passed / 1 skipped.
- `pnpm build`: PASS, 4 tasks; Next emitted existing-style webpack circular
  chunk and edge-runtime static-generation warnings.

## Ship notes

This report captures local RED-gate truth before merge. Production closeout
must still verify:

- manifest anchors served from `https://www.wcdraft.com`
- live `.br` decompressed sha matches manifest
- sample recovered rows read back their listed Career overall
- leaderboard serves the new season key with an empty board
- OG sign/run and core surfaces remain alive
