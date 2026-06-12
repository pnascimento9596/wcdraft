# merit-v3 V6 Compact Regen Report

Date: 2026-06-11
Base: `origin/merit-v3` at `e860d15973c752fc6d2de1c41fd98041dd869b7d`
Unit: V6 compact regen (`runtime-data-2.0.0`)

## Compact Build

Two temp builds were byte-identical before committing artifacts:

- `draft-pool.compact.json`: `93a05d9ecb56f26b8aa186355abf7bf32180f8eb6392a4f4a231e02f60da1821`
- `manifest.json`: `aed8c02e902ccaa701e75ebf783cf3af8bb83e7559d34a0ec6f65e06816b32fd`
- `scenario-2026.compact.json`: `238e56a88f0ac2c9052baaa638164ffc733bf29e26f793d37f437e138c320098`

Runtime anchors:

- `schema_version`: `runtime-data-2.0.0`
- `rating_version_historical`: `wc-perf-5.0.0`
- `rating_version_projected`: `proj-career-4.0.0`
- `engine_version`: `engine-2026.06.11` at the V6 unit boundary after rebase; V8 owns the next engine stamp.

Manifest counts:

- `player_cards`: 12,219
- `ratings`: 12,219
- `baseline_anchor_estimate`: 386
- `career_stature_estimate`: 478
- `legend`: 270
- `rating_basis.career`: 12,219 ratings, 386 baseline estimates, 478 career-stature estimates
- `rating_basis.current`: 12,219 ratings, 388 baseline estimates, 0 career-stature estimates

## Size Budget

Measured brotli total: 1,216,302 bytes.
Committed budget with 15% headroom: 1,398,748 bytes.

Delta from previous committed size report:

- Previous total brotli: 678,714 bytes
- New total brotli: 1,216,302 bytes
- Delta: +537,588 bytes (+79.2%)

The growth is from carrying the Current basis rating set in the compact draft pool. The Career row remains the compatibility alias in `ratings[]`; `basis_ratings.current` carries the additional basis without duplicating the Career row as a second lookup map. The committed budget uses the repo's existing measured-plus-15% rule, and `draft-pool.compact.json` remains below GitHub's 100 MiB file limit at 87,203,409 raw bytes.

## Club Backfill Census

Historical men's card rows: 10,973.
Rows with `club_at_tournament`: 10,957.
Verified-absent honest null rows: 16.
Coverage: 99.854%.

Honest null card IDs:

- `P-01918:WC-1934`
- `P-11648:WC-1930`
- `P-16278:WC-1938`
- `P-29687:WC-1930`
- `P-41536:WC-1930`
- `P-44740:WC-1934`
- `P-46561:WC-1950`
- `P-53883:WC-1950`
- `P-54466:WC-1950`
- `P-58460:WC-1930`
- `P-63886:WC-1934`
- `P-71162:WC-1950`
- `P-79551:WC-2010`
- `P-79649:WC-1950`
- `P-92120:WC-1938`
- `P-92190:WC-1934`

## Legend Census

Old compact census: 302.
New source-derived compact census: 270.
Delta: -32.

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

Pinned non-material legend check: `P-97778` Ousmane Dembele remains `legend: true` while his V6 Career OVR is 81 in 2026 and 83 in 2018/2022, proving the flag remains source-derived and is not an OVR threshold re-derivation.

## Strategic-Pick Canary

Regenerated with:

`WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts`

Changed picks: 11.

- Seed `0000`, spin 0, `4-3-3.GK`: `P-W26-0115:2026` Alisson (old OVR 88 -> new OVR 88) -> `P-21531:2026` Alisson (historical-id relink, new OVR 89)
- Seed `0000`, spin 3, `4-3-3.LCB`: `P-47321:2026` Koulibaly (84 -> 84) -> `P-W26-0605:2026` Diouf (75 -> 85)
- Seed `0000`, spin 15, `bench.3`: `P-W26-0351:2026` Bayesh (80 -> 71) -> `P-W26-0338:2026` Bayesh (66 -> 80)
- Seed `0001`, spin 1, `4-3-3.GK`: `P-W26-0473:2026` Nyland (87 -> 71) -> `P-W26-0460:2026` Nyland (73 -> 86)
- Seed `0001`, spin 8, `4-3-3.RCM`: `P-75890:2018` Salah (96 -> 91) -> `P-60871:2018` Elneny (74 -> 75)
- Seed `0002`, spin 6, `4-3-3.CDM`: `P-79299:2018` Mane (94 -> 90) -> `P-40621:2018` Gueye (74 -> 75)
- Seed `0002`, spin 9, `4-3-3.LW`: `P-72637:2026` Lukaku (88 -> 88) -> `P-29578:2026` Doku (86 -> 88)
- Seed `0002`, spin 16, `bench.4`: `P-10713:2010` Cacau (88 -> 88) -> `P-27787:2010` Klose (88 -> 89)
- Seed `0003`, spin 8, `4-3-3.RCM`: `P-W26-0854:2026` Kayembe (86 -> 74) -> `P-W26-0837:2026` Kayembe (72 -> 84)
- Seed `0004`, spin 7, `4-3-3.LCM`: `P-96340:2026` Bentaleb (88 -> 84) -> `P-W26-0019:2026` Chaibi (80 -> 86)
- Seed `0004`, spin 8, `4-3-3.RCM`: `P-15674:2022` Bellingham (89 -> 88) -> `P-08169:2022` Henderson (88 -> 88)

Review note: the changed picks are rating/id explained. Several same-name changes are U0/V3 identity relinks or minted-id resequences; the others follow from the V3/V4 rating movement changing `pickBest` ordering under the canary's fixed candidate rolls.

## Gates Run

- `pnpm --filter @wcdraft/core build` PASS
- `node packages/data/scripts/build-compact-data.mjs --out-dir /tmp/wcdraft-v6-build-a` PASS
- `node packages/data/scripts/build-compact-data.mjs --out-dir /tmp/wcdraft-v6-build-b` PASS, byte-identical to build A
- `WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data exec vitest run test/realism/strategic-pick-canary.golden.test.ts` PASS
- `pnpm --filter @wcdraft/data gen:e2e-golden` PASS, seed `wcdraft:e2e-real-run:engine-v2-e3a:29`
- `pnpm --filter @wcdraft/data exec vitest run test/compact-data.integrity.test.ts test/realism/strategic-pick-canary.golden.test.ts test/e2e-real-run.golden.test.ts` PASS, 36 tests
- `pnpm --filter @wcdraft/data exec vitest run test/compact-data.golden.test.ts` PASS, 6 tests
- `pnpm --filter @wcdraft/data typecheck` PASS
- `pnpm --filter @wcdraft/data build` PASS after package build heap was raised to 8 GiB for the enlarged static JSON imports
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-token.test.ts` PASS, 23 tests
- V6 review fix-forward:
  - `pnpm --filter @wcdraft/core build` PASS
  - `pnpm --filter @wcdraft/data typecheck && pnpm --filter @wcdraft/data build` PASS
  - `pnpm --filter @wcdraft/db build` PASS
  - `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/club-coverage.test.ts` PASS, 7 tests
  - `pnpm --filter @wcdraft/web build` PASS
  - `rm -rf packages/data/dist/generated && pnpm --filter @wcdraft/data typecheck && pnpm --filter @wcdraft/data build && test ! -e packages/data/dist/generated && pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/club-coverage.test.ts` PASS, proves the data top-level loader falls back to `src/generated` from a clean built package
  - `test ! -e packages/data/dist/generated && pnpm --filter @wcdraft/web build` PASS
  - `pnpm --filter @wcdraft/data exec vitest run test/compact-data.integrity.test.ts test/realism/strategic-pick-canary.golden.test.ts test/e2e-real-run.golden.test.ts` PASS, 36 tests
  - `pnpm --filter @wcdraft/data exec vitest run test/compact-data.golden.test.ts` PASS, 6 tests
  - `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-token.test.ts` PASS, 23 tests

Known next step: V7 lambda refit must run before realism goldens are re-locked. A broad accidental `@wcdraft/data test` collection showed the existing `realism-modern-norms.golden.test.ts` mean-goals band red under the V6 data, which is the expected reason V7 exists.
