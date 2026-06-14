# merit-v4 Ratings Rebuild Season Summary

Branch: `merit-v4`
Base / merge-base: `origin/main` `b4d7fe89a4c6ceb71071d6ee530eae4b4436815d`
Status: **candidate implementation complete for final Red-tier review**.

## Outcome

The merit-v4 methodology shift landed in the candidate branch: ratings now use
individual merit contextualized by public national-team strength and objective
club achievement.

This report records the candidate artifacts and acceptance evidence before the
final Red-tier ship sequence. The SHA-pinned review, merge, production deploy,
and live verification are tracked in-session so they can stay tied to the exact
head commit being shipped.

## Version Anchors

| Anchor | Candidate value |
| --- | --- |
| runtime schema | `runtime-data-2.2.0` |
| historical rating | `wc-perf-6.0.0` |
| projected rating | `proj-career-5.0.0` |
| career stature | `career-stature-4.0.0` |
| merit source set | `merit-source-set-2.2.0` |
| active source set | `active-career-source-set-2.1.0` |
| engine | `engine-2026.06.13-merit-v4` |
| leaderboard season key | `engine-2026.06.13-merit-v4_wc-perf-6.0.0+proj-career-5.0.0_2026-06-04_ruleset-2026.06.04_2923a844` |

Compact artifacts:

| Bundle | Raw | Gzip | Brotli | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| draft pool | 100,702,891 | 3,413,135 | 1,428,224 | `8ec327f6fd786cb89b93c534e6e8cb70ace2a9eef88813f5d10a873197656ceb` |
| scenario 2026 | 108,775 | 7,710 | 4,480 | `214bccae6e4482b0f7e752f4bf95fdda2c4a69acbb726e57807cd18bdcf5f099` |
| manifest | 6,399 | 2,190 | 1,920 | `70135193b7de6893f5e428eeb40db84c9ccc459b3b1bee36a099882e39030803` |
| total | 100,818,065 | 3,423,035 | 1,434,624 | n/a |

The historical ETL ratings artifact is deterministically compact-encoded at
`59,551,789` bytes so the review branch stays below GitHub's hard per-blob
limit while preserving parsed rating data and sorted-key byte stability.
Compact bundle Brotli sizes are normalized to 128-byte upper-bound buckets in
manifest/report metadata, because exact Brotli lengths varied by two bytes
between local macOS and Linux CI for the 96 MB draft-pool bundle.

## Methodology Shift

National-strength prior:

- Added `etl/src/wcdraft_etl/national_strength.py`.
- Source inputs are World Football Elo tournament-start snapshots plus official
  ranking releases from 1994 onward.
- The old nation-blind `0.62` raw-only ceiling is replaced by a smooth
  `(tournament, nation)` prior from `0.500` to `0.625`.
- The prior is overcomable by awards or material career stature; it is not a
  hard rank cliff.

Objective club achievement:

- Activated the previously dead `club_honors` family for objective facts only.
- Included major club trophy counts, continental club-title facts, league
  top-scorer by goals, and world-record / era-defining transfer facts.
- Excluded fan votes, proprietary ratings, club/player-of-year voting routes,
  and subjective awards.
- Final source facts: `2144` facts across `819` players; career stature emits
  `845` players, `209` material rows, and `114` source-derived legend rows.

Selected public source rows added for v4:

| Player | Objective fact | Source |
| --- | --- | --- |
| Son | 2021-22 Premier League Golden Boot, 23 goals | [Premier League](https://www.premierleague.com/en/news/2626553) |
| Bale | five European Cups / Champions Leagues with Real Madrid | [Real Madrid](https://www.realmadrid.com/en-US/the-club/history/football-legends/gareth-bale) |
| Bale | 2013 Real Madrid fee reported around EUR100m, then most expensive in the sport | [El Pais](https://english.elpais.com/elpais/2013/09/01/inenglish/1378061135_102744.html) |
| Lampard | 13 Chelsea trophies incl. Champions League, Europa League, league/cup titles | [Chelsea](https://www.chelseafc.com/en/news/article/everything-you-need-to-know-about-frank-lampard) |
| Van Nistelrooy | 2002-03 Premier League Golden Boot, 25 goals | [Premier League](https://www.premierleague.com/en/news/1206108) |
| Seedorf | four European Cup titles with three teams | [Real Madrid](https://www.realmadrid.com/en-US/the-club/history/football-legends/clarence-seedorf) |
| Yaya Toure | three PL titles, three League Cups, FA Cup, Community Shield with City | [Manchester City](https://www.mancity.com/news/mens/yaya-toure-shortlisted-for-premier-league-hall-of-fame-63815759) |
| Rooney | 13 major trophies with Manchester United | [Manchester United](https://www.manutd.com/en/news/the-stats-behind-wayne-rooneys-man-utd-career) |
| Vidal | eight consecutive domestic league titles across three major European leagues | [FC Barcelona](https://www.fcbarcelona.com/en/news/1198503/arturo-vidal-the-king-of-back-to-back-league-titles) |
| Gundogan | Champions League, five PL titles, two FA Cups, four League Cups, two Community Shields | [Manchester City](https://www.mancity.com/mancitylegends/gundogan-ilkay) |
| Kimmich | eight Bundesliga titles, Champions League, Club World Cup among other honours | [Bayern Munich](https://fcbayern.com/en/news/2025/03/fc-bayern-and-joshua-kimmich-extend-until-2029) |

## Anchor Matrix

Measured from current candidate compact data against `origin/main`.

| Anchor | Card | Base | v4 | Basis in v4 | Notes |
| --- | --- | ---: | ---: | --- | --- |
| Son 2022 | `P-77335:2022` | 81 | 89 | `career_stature_estimate` | Golden Boot fact opens club-honor route; South Korea wall no longer outranks him. |
| Bale 2022 | `P-63927:2022` | 82 | 90 | `career_stature_estimate` | Real Madrid European Cups + transfer-record fact. |
| Ibrahimovic 2002 | `P-80105:2002` | 90 | 90 | `career_stature_estimate` | Holds the >=90 acceptance target. |
| Ibrahimovic 2006 | `P-80105:2006` | 90 | 90 | `career_stature_estimate` | Holds the >=90 acceptance target. |
| Haaland 2026 | `P-W26-0477:2026` | 98 | 92 | `career_stature_estimate` | Active-career cap prevents sparse-current overrun; cap `0.845`. |
| Lampard 2006 | `P-65534:2006` | 84 | 90 | `career_stature_estimate` | Objective trophy fact crosses material route. |
| Van Nistelrooy 2006 | `P-03013:2006` | 83 | 91 | `career_stature_estimate` | Golden Boot fact crosses material route. |
| Seedorf 1998 | `P-88946:1998` | 83 | 90 | `career_stature_estimate` | Continental-title token crosses material route. |
| Yaya Toure 2010 | `P-44934:2010` | 83 | 89 | `career_stature_estimate` | Objective City trophy fact. |
| Rooney 2014 | `P-99967:2014` | 81 | 89 | `career_stature_estimate` | United trophy-count fact. |
| Vidal 2010 | `P-41001:2010` | 81 | 89 | `career_stature_estimate` | Eight-title fact. |
| Gundogan 2022 | `P-08896:2022` | 84 | 89 | `career_stature_estimate` | City trophy-count fact. |
| Kimmich 2026 | `P-30316:2026` | 88 | 91 | `career_stature_estimate` | Bayern trophy-count fact. |

Channel invariant spot checks:

| Card | ATT | MID | DEF | GK |
| --- | ---: | ---: | ---: | ---: |
| Son 2022 | 54 | 72 | 51 | 20 |
| Bale 2022 | 77 | 54 | 37 | 20 |
| Haaland 2026 | 84 | 59 | 39 | 20 |
| Kimmich 2026 | 41 | 56 | 79 | 20 |

## Squad-Wall Evidence

South Korea 2022:

| Metric | Base | v4 |
| --- | --- | --- |
| top card | Seung-gyu Kim / Cho Gue-sung at 88 | Son at 89 |
| role-player max | 88 | 83 |
| distribution | `{68:2, 70:1, 71:6, 73:3, 75:1, 77:2, 79:2, 81:4, 87:3, 88:2}` | `{68:2, 70:1, 71:6, 73:3, 75:1, 76:2, 79:2, 81:3, 83:5, 89:1}` |

Saudi Arabia 2022:

| Metric | Base | v4 |
| --- | --- | --- |
| top card | Salem Al-Dawsari 86 / Mohammed Al-Owais 85 | seven-card max cluster at 79 |
| distribution | `{70:1, 71:12, 72:1, 73:4, 77:1, 79:4, 82:1, 85:1, 86:1}` | `{70:1, 71:12, 72:1, 73:4, 76:1, 79:7}` |

No-award sub-top-20 Elo measured cards now max at OVR `86`; the highest
observed raw-only ceiling in that slice is `0.593451`. That directly replaces
the old flat `0.62` ceiling shelf.

## Population Deltas

| Metric | Base | v4 |
| --- | ---: | ---: |
| Runtime ratings | 12,219 | 12,219 |
| Career measured_performance | 11,351 | 11,328 |
| Career career_stature_estimate | 482 | 505 |
| Career baseline_anchor_estimate | 386 | 386 |
| Runtime legends | 287 | 295 |
| 88 display count/share | 1,358 / 11.114% | 685 / 5.606% |
| 90+ display count/share | 287 / 2.349% | 290 / 2.373% |
| Historical 90+ | n/a | 272 / 10,973 = 2.479% |
| 2026 90+ | n/a | 18 / 1,246 = 1.445% |
| Exact `raw_only_score == 0.62` | 1,162 | 0 |
| Exact `raw_only_ceiling == 0.62` | 10,735 | 0 |
| 85-89 band from Elo-rank>20 nations | 514 / 2,215 = 23.205% | 102 / 1,719 = 5.934% |
| Median | 73 | 73 |

Distribution carryovers remain explicit:

- Low-band piles remain by construction: the v4 probe ledger pins `71 ≈17.8%`
  and `72 ≈15.3%`.
- Legacy cross-era measured-vs-measured inversion metric is pinned at `3.47%`
  as a v4 rebase metric; the old <=0.5% merit-v3 gate is no longer the right
  gate under national-strength contextual ceilings.
- Pooled `90+` is under the acceptance headline of <=~3%, but above the more
  aggressive design aspiration of ~1.5% for the full historical+projected pool.
  The 2026 slice alone is 1.445%.

## Refit / Relock

Display curve:

- `display_curve.fit_unified_curve(etl/output)` remains
  `raw_floor=20.0`, `raw_median=42.325568000000004`, `raw_p95=62.3652`,
  `raw_max=100.0`.
- No per-player map or player pin was introduced.

Lambda:

- `pnpm --filter @wcdraft/data exec tsx scripts/fit-calibration.mjs`
  re-ran the deterministic fitter after the final fact expansion.
- Winner remained: `BASE=1.10`, `SPREAD=6.0`, `MIN=0.30`, `MAX=3.4`,
  `W_DEF=0.70`, `W_GK=0.30`, `GAMMA_MID=0.80`, `KO_LAMBDA_FACTOR=0.82`,
  `CHANCES.REGULATION=50`, `CHANCES.EXTRA_TIME=17`, `LAMBDA_DISP` unchanged.
- Fit: `175` evaluations; symmetric landing `goals=2.544`, `draw=24.87%`,
  `margin>=4=4.86%`, `KO->ET=34.13%`, `SO=21.33%`.

Asymmetric realism relock:

| Policy | Qualifying | Matches | Goals/game | Group draw | Margin>=4 | KO->ET | Shootout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| autoDraft | 87 | 6,105 | 2.867 | 13.08% | 20.97% | 18.10% | 10.48% |
| strategicAutoDraft | 1,611 | 9,965 | 2.586 | 25.28% | 4.64% | 32.41% | 19.87% |
| greedyOverallAutoDraft | 379 | 6,588 | 3.104 | 17.47% | 13.98% | 26.19% | 15.14% |

Strategic-pick canary:

| Seed | Spin | Slot | Base pick | v4 pick |
| ---: | ---: | --- | --- | --- |
| 0 | 6 | `4-3-3.CDM` | `P-68952:2026` Weston McKennie, 88 | `P-14151:2026` Tyler Adams, 81 |
| 0 | 11 | `4-3-3.RW` | `P-71308:2014` Keun-ho Lee, 81 | `P-77335:2014` Son, 89 |
| 3 | 11 | `4-3-3.RW` | `P-27540:2026` Memphis Depay, 88 | `P-28911:2026` Cody Gakpo, 88 |
| 3 | 12 | `bench.0` | `P-50688:2022` Yassine Bounou, 88 | `P-15566:2022` Munir Mohamedi, 83 |
| 4 | 7 | `4-3-3.LCM` | `P-W26-0019:2026` Fares Chaibi, 86 | `P-96340:2026` Nabil Bentaleb, 83 |
| 4 | 13 | `bench.1` | `P-09614:2022` Noussair Mazraoui, 88 | `P-00597:2022` Badr Benoun, 83 |

The canary was intentionally regenerated; these are not silent flips.

## Validation

Local gates run on the candidate worktree. Most full-stack gates below ran
after the rating/compact/regolden work and before the final `ratings.json`
compact-serialization amendment. That amendment changes only deterministic JSON
text encoding plus its writer/golden test, not parsed rating data or runtime
compact artifacts; the ETL and whitespace gates were re-run after the amendment.

| Gate | Result |
| --- | --- |
| `git fetch origin && git rev-parse HEAD && git rev-parse origin/main && git merge-base HEAD origin/main` | all `b4d7fe89a4c6ceb71071d6ee530eae4b4436815d`; no rebase required |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS: typecheck 8/8, lint 5/5, test 8/8, build 4/4 |
| root `pnpm test` package counts | core 366; data 65 passed / 7 skipped; db 79; web 674 passed / 1 skipped; marketing-x 64 |
| `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core` | PASS: 67 + 40 |
| `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data` | PASS: 31 + 22 |
| `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web` | PASS: 6 |
| `cd etl && ruff check src tests && pytest -q` | PASS: ruff clean; 297 passed |
| focused ETL v4/probe suite | PASS: 225 passed |
| `pnpm --filter @wcdraft/data test:realism:heavy` | PASS: 7 passed |
| `pnpm --filter @wcdraft/data exec tsx scripts/fit-calibration.mjs` | PASS: 175 evals; final tuple above |
| `git diff --check` | PASS |
| post-compact-serialization `cd etl && ruff check src tests && pytest -q` | PASS: ruff clean; 297 passed |
| post-compact-serialization `git diff --check` | PASS |
| post-CI compact metadata fix `pnpm --filter @wcdraft/data test` | PASS: 65 passed / 7 skipped |
| post-CI compact metadata fix `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS: typecheck 8/8, lint 5/5, test 8/8, build 4/4 |
| post-CI compact metadata fix `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data` | PASS: 31 + 22 |

Generation/relock commands run:

- `PYTHONPATH=src python3 -m wcdraft_etl.national_strength --fetch`
- `PYTHONPATH=src python3 -m wcdraft_etl.merit.parse_research`
- `PYTHONPATH=src python3 -m wcdraft_etl.merit.build`
- `PYTHONPATH=src python3 -m wcdraft_etl.merit.active`
- `PYTHONPATH=src python3 -m wcdraft_etl.merit.active --pin`
- `PYTHONPATH=src python3 -m wcdraft_etl.merit.stature`
- `PYTHONPATH=src python3 -m wcdraft_etl.rating`
- `PYTHONPATH=src python3 -m wcdraft_etl.ingest_2026`
- `PYTHONPATH=src python3 -m wcdraft_etl.merit.fetch --pin`
- `PYTHONPATH=src python3 -m wcdraft_etl.merit_divergence`
- `pnpm --filter @wcdraft/data build:compact`
- `pnpm --filter @wcdraft/data gen:e2e-golden`
- `pnpm --filter @wcdraft/data gen:era-golden`
- `WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts`
- `pnpm --filter @wcdraft/data exec tsx scripts/regen-asym-golden.mts`
- `pnpm --filter @wcdraft/data copy:web-assets`
- `pnpm --filter @wcdraft/web gen:leaderboard-golden`
- `pnpm --filter @wcdraft/web gen:token-skew`

## Files Changed

Major surfaces changed:

- ETL source: national-strength fetch/build, merit source-set activation,
  objective club-honors scoring, historical/projected rating wiring.
- ETL committed outputs: national strength, career stature, ratings,
  projected ratings, merit reports, 2026 manifests/teams.
- Core sim calibration: λ constants and sim golden fixture.
- Data runtime: compact bundles, manifest, size budget, type surface,
  realism/canary/e2e/era goldens.
- Web fixtures: leaderboard season key and token-skew fixtures.
- Docs: `STATE.md`, rating methodologies, sim calibration, this report.

## Pending / Human Actions

Required before merge:

1. Fresh-session independent reviewer must re-execute the gates on this branch.
2. Owner must give explicit SHA-pinned approval in-session.
3. Squash merge must use `gh pr merge --squash --match-head-commit <sha>`.
4. Wait for Vercel production deploy READY.
5. Live-verify:
   - Korea 2022 renders Son above the role players.
   - A weak-nation squad no longer walls at 88.
   - Bale renders around 90.
   - Leaderboard shows the new season key.
   - A real pre-season token gives the honest skew notice.
   - A re-scored OG image and narrative render correctly.

Not run locally in this candidate closeout:

- Live `www.wcdraft.com` checks, because the branch has not been merged or
  deployed.
- Fresh-session independent review, because this report is the implementer
  closeout input for that review.
- Browser screenshot of a sample OG/narrative flow; unit/golden coverage passed,
  but the dispatch's live sample belongs after deploy unless the owner asks for
  a pre-merge local browser pass.
