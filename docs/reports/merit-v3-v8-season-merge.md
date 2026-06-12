# merit-v3 V8 Season-Merge Prep

Date: 2026-06-12  
Branch: `merit-v3` after rebase onto draft-config main  
Spec: `docs/plans/merit-v3-design-2026-06-11.md`

## Anchor Matrix

| Anchor | Final value |
|---|---|
| `schema_version` | `runtime-data-2.0.0` |
| `dataset_version` | `2026-06-04` |
| `ruleset_version` | `ruleset-2026.06.04` |
| `engine_version` | `engine-2026.06.12` |
| historical rating | `wc-perf-5.0.0` |
| projected rating | `proj-career-4.0.0` |
| career stature | `career-stature-3.0.0` |
| active source set | `active-career-source-set-2.0.0` |
| display curve | `unified_pooled_piecewise_power_v2` |
| compact hash | `93a05d9ecb56f26b8aa186355abf7bf32180f8eb6392a4f4a231e02f60da1821+238e56a88f0ac2c9052baaa638164ffc733bf29e26f793d37f437e138c320098` |
| leaderboard season key | `engine-2026.06.12_wc-perf-5.0.0+proj-career-4.0.0_2026-06-04_ruleset-2026.06.04_03bc6434` |

V8 is the season's single public engine bump after the V7 lambda refit. The
compact data payload did not change beyond the manifest stamp/hash: draft pool
and scenario hashes remain the post-V6 content hashes above; manifest hash moved
to `e2bec1bb3f527b4930ab74bcbc7ac230fb70671bdcb106de3b8e60efa8254c4e`.

## Regeneration Notes

- `pnpm --filter @wcdraft/data run build:compact` re-emitted the manifest with
  12,219 ratings, 501 managers, 48 teams, 62 knockout slots, 386
  `baseline_anchor_estimate` rows, and 270 legends.
- Brotli budget after the engine stamp: `1,216,305 <= 1,398,748` bytes. The
  three-byte increase is only the compressed manifest string/hash delta.
- `pnpm --filter @wcdraft/data gen:e2e-golden` preserved the accepted seed
  `wcdraft:e2e-real-run:engine-v2-e3a:29`; run shape stayed
  `R32`, `0-3-1`, 4 matches.
- `pnpm --filter @wcdraft/data gen:era-golden` re-stamped the era preset golden.
- `WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts`
  passed and re-stamped the canary header.
- `pnpm --filter @wcdraft/data exec tsx scripts/regen-asym-golden.mts` re-derived
  the asymmetric shape bands under the same V7 tuple and stamped
  `engine-2026.06.12`.
- `pnpm --filter @wcdraft/web gen:leaderboard-golden` re-derived the V8 season key.
  Classic verified score remains `-1`; hidden verified score remains `-25`.
- `pnpm --filter @wcdraft/web gen:token-skew` now sources `current_prod_t1` from
  real shipped main commit `18cdbef10fa41debff396c398adf52f4639fd34b`, with anchors
  `runtime-data-1.2.0`, `engine-2026.06.11`,
  `wc-perf-4.2.1+proj-career-3.0.0`, and the shipped production compact hash.

## Waiver Table For Owner

Every entry below is a pre-registered miss or explicit owner-ledger item. V8 must
either receive owner waiver or fix-forward the ordered exception before merge.

| Item | Measured | Registered target | Mechanism / disposition |
|---|---:|---:|---|
| Yamal 2026 | 92, legend | 85-91 | Miss +1. D1+D2 worked, but V1 active row index 0.641 overshoots the prediction. |
| Haaland 2026 | 98, legend | 89-93 | Miss +5. Active index 0.843 maps near peak; wall exit proven but magnitude high. |
| Valverde 2026 | 88 | 89-91 | Miss -1. `career_stature_index` lands exactly 0.40, so the continuity weight is exactly 0.50; design §1.3 said not to force the weight. |
| Neymar 2026 | 91, legend | 92-94 | Miss -1. Declared watch item; index 0.600 plus age-34 down-modulation. |
| Lukaku 2022 | 71 | >=78, conditional on citable facts | Honest miss. No V1 facts were staged; no fabricated fact was added to satisfy the band. |
| B. Fernandes 2018 | 72 | upward direction, conditional on citable facts | Honest miss. Same no-staged-fact mechanism as Lukaku. |
| Kocsis index/card | index 0.876, rank 3; card 99 | index <=0.90 and not #1; card 94-97 | Split result. Index half passes; card remains +2 above band because 0.876 sits only 0.002 below Pele and both map near ceiling. |
| Cruyff vs Owen / Cruyff-1974 | Cruyff index 0.720 > Owen 0.677; cards 94 > 93; Cruyff-1974 card 94 | ordering restored; card 96-98 | Split result. Ordering half passes; card is -2 below band. |
| Pile-up | 88 = 11.3%; also 71 = 17.8%, 72 = 15.3% | no value >4% | Structural miss. The 88 wall contains a 1,150-card internal-62.0 point mass from no-award historical cards pinned byte-stable by the no-award invariant; a monotone display curve cannot spread identical inputs. |
| Cross-era inversion | 0.588% (36,476 / 6,200,282 pairs) | <=0.5% | Marginal miss. Award-gated headroom lifts historical measured award cards while 2026 projected cards are award-null pre-tournament. |
| Pre-1967 legend coherence | 9 violations | 0 | Miss pinned exactly: Hidegkuti-1954, F. Walter-1954/1958, Albert-1966, N. Santos-1962, Ocwirk-1954, Andrade-1930, Bozsik-1954, Hanappi-1954. |
| Legend census | 302 -> 270 | re-measured | Source-derived compact census moved -32 with 42 losses and 10 gains; see flip list below. |
| Dembélé non-material legend | 2026 OVR 81, 2018/2022 OVR 83, `legend: true` | ledgered non-material legend | Non-material legend remains intentionally source-derived, not an OVR threshold re-derivation. |

## Legend Census Flip List

Old compact census: 302. New source-derived compact census: 270. Delta: -32.

Losses (42):

- `P-03013:2006` van Nistelrooy
- `P-24556:1998` Raul
- `P-24556:2002` Raul
- `P-24556:2006` Raul
- `P-30486:2010` Suarez
- `P-30486:2014` Suarez
- `P-30486:2018` Suarez
- `P-30486:2022` Suarez
- `P-32798:2010` Silva
- `P-32798:2014` Silva
- `P-32798:2018` Silva
- `P-32798:2022` Silva
- `P-35183:1998` Schmeichel
- `P-39356:2010` Kroos
- `P-39356:2014` Kroos
- `P-39356:2018` Kroos
- `P-48955:2014` De Bruyne
- `P-48955:2018` De Bruyne
- `P-48955:2022` De Bruyne
- `P-48955:2026` De Bruyne
- `P-53062:2006` Cech
- `P-55511:1998` Nesta
- `P-55511:2002` Nesta
- `P-55511:2006` Nesta
- `P-56947:1998` Thuram
- `P-56947:2002` Thuram
- `P-56947:2006` Thuram
- `P-61703:1998` Eto'o
- `P-61703:2002` Eto'o
- `P-61703:2010` Eto'o
- `P-61703:2014` Eto'o
- `P-64348:2010` Pique
- `P-64348:2014` Pique
- `P-64348:2018` Pique
- `P-80105:2002` Ibrahimovic
- `P-80105:2006` Ibrahimovic
- `P-81297:2006` Fabregas
- `P-81297:2010` Fabregas
- `P-81297:2014` Fabregas
- `P-84003:2002` Ballack
- `P-84003:2006` Ballack
- `P-88946:1998` Seedorf

Gains (10):

- `P-49600:1990` Valderrama
- `P-49600:1994` Valderrama
- `P-49600:1998` Valderrama
- `P-62341:2026` Rodri
- `P-78605:1982` Socrates
- `P-78605:1986` Socrates
- `P-87008:2026` Neymar
- `P-W26-0050:2026` Alaba
- `P-W26-0477:2026` Haaland
- `P-W26-0663:2026` Yamal

## Review Status

Completed locally before the V8 commit: root typecheck/lint/test/build, explicit
core/data/web goldens, ETL ruff + pytest, heavy realism, focused token/skew
tests, and byte-identical regen hash proof for the generated artifacts.

Pending: cumulative fresh-context review, owner waiver decision, and owner
approval pinned to the exact SHA.
