# Perf Delivery Red Season — 2026-06-14

Subject branch: `perf-delivery` off `origin/main` `c5eb8e8`
(`feat(rating): expand merit v4.1 coverage (#141)`). This coordinates after
merit-v4.1: the compact DATA is the current merit-v4.1 data, and this season
changes DELIVERY/perf paths only.

## Outcome

Candidate implementation is local-green on the full pre-review gate set below,
and fresh-context unit + cumulative reviews passed. Preview, merge, production
deploy, live checks, and auto-revert status are recorded after the PR/deploy
phase.

## Unit B — compressed data delivery

Decision: use a versioned, max-quality Brotli artifact instead of splitting the
draft bundle into index/detail files. This preserves the existing replay and
determinism contract: after decompression the browser receives the exact
`DraftPoolBundle` bytes already fingerprinted by the manifest. Splitting would
introduce a new fetch graph and replay/data-shape contract for the same dominant
wire-size win.

Before (production `www.wcdraft.com`, fixed legacy URL):

```text
GET /data/wcdraft/draft-pool.compact.json
content-encoding: br
encoded bytes: 5,015,795
decoded bytes: 101,026,822
decoded sha256: f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7
```

After (local generated candidate artifact):

```text
GET /data/wcdraft/runtime-data-2.3.0/draft-pool.compact.json.br
encoded bytes: 1,429,691
decoded bytes: 101,026,822
decoded sha256: f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7
manifest sha256: f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7
byte-identical: true
```

Local before→after: `5,015,795 -> 1,429,691` encoded bytes, a `3.51x` cut on
the dominant draft-pool wire payload.

Local production server header proof (`next start` on `127.0.0.1:4317`):

```text
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Encoding: br
Vary: Accept-Encoding
Cache-Control: public, max-age=31536000, immutable
Content-Length: 1429691
decoded sha256: f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7
```

Implementation:

- `copy-web-assets.mjs` mirrors legacy unversioned raw JSON paths for backwards
  compatibility and writes the current versioned static layout.
- `draft-pool.compact.json.br` is generated with Brotli quality 11 at build
  time.
- `next.config.mjs` serves the `.br` artifact as JSON with
  `Content-Encoding: br` and immutable caching.
- `@wcdraft/data/client` defaults to
  `/data/wcdraft/runtime-data-2.3.0` and fetches
  `draft-pool.compact.json.br`.
- `public/sw.js` consumes generated precache URLs from `/sw-version.js` and no
  longer precaches the raw draft-pool URL.

## Unit — atomic versioned delivery

The browser runtime-data base path is now schema-versioned:

```text
/data/wcdraft/runtime-data-2.3.0/manifest.json
/data/wcdraft/runtime-data-2.3.0/draft-pool.compact.json.br
/data/wcdraft/runtime-data-2.3.0/scenario-2026.compact.json
```

The fixed legacy paths remain available for old clients and server-side
filesystem readers, but newly built client code no longer races an overwritten
`/data/wcdraft/manifest.json`.

Coexistence proof:

- `packages/data/test/web-assets-copy.test.ts` builds a fixture with
  `runtime-data-prev` retained and `runtime-data-next` current, runs
  `copy-web-assets.mjs`, and verifies both version directories resolve.
- `packages/data/src/retained-runtime-data/runtime-data-2.3.0/` stores the
  retained current manifest, scenario bundle, and compressed draft-pool artifact
  so a future `N+1` deploy can carry `N`.
- `pnpm run check:generated` now validates retained runtime directories by
  decompressing `.br` and checking manifest fingerprints.

## Unit C — OG edge route

Current production contract after the security E/F follow-up: browser-minted
`t2` `og` summaries remain decoded for compatibility, but `runTokenOgSummary()`
returns `null` because the summary is unsigned and untrusted. Therefore the
server-rendered route must use the static fallback for current tokens.

Change made here: remove the latent full-pool dynamic branch from
`app/api/og/run/route.tsx`. The edge route now has no import or call path for
`loadDraftPoolBundle()`, `buildGameData()`, or `renderRunOgImage()`. It still
validates current-version manifests from the versioned data path when a future
trusted summary path exists, then falls back until a signed/server-minted token
contract carries enough trusted display data to render without replaying the
full draft catalog.

Determinism/behavior proof:

- Current malformed/unsigned route behavior remains `307` to
  `/brand/marketing/og-default.png` with `Cache-Control: public, max-age=300`.
- Existing image renderer golden remains byte-identical for an already trusted
  in-memory model.
- New source guard asserts the edge route stays out of the full draft-pool parse
  path.

Honest scope note: a strict "token-referenced cards only" dynamic OG render is
not implementable against the current unsigned token shape without changing the
token contract, because manager picks store only `{ k: "m" }`, not the manager
card id. The production-safe fix in this season is to preserve today's static
fallback and remove the full-pool cold branch.

## Unit D — sim worker payload

The worker boundary now builds the deterministic `RunScenario` before
`postMessage`, so the worker no longer receives the duplicate all-48-team
`teams` array. It also prunes `world.nationByCardId` to drafted squad card ids
before structured clone. The worker still receives all 48 opponent records
because knockout ladder selection happens after group-stage simulation and
can select from the global non-group pool.

Fixed fixture measurement (`wcdraft:e2e-real-run:v1:14`):

```json
{
  "old_json_bytes": 500458,
  "new_json_bytes": 155336,
  "delta_bytes": 345122,
  "reduction_pct": 68.96,
  "old_nationByCardId_entries": 12219,
  "new_nationByCardId_entries": 16,
  "old_teams_count": 48,
  "new_has_teams_field": false,
  "old_opponents_count": 48,
  "new_opponents_count": 48
}
```

Determinism proof:

- New focused test compares `handleWorkerInput(buildWorkerSimInputs(...))`
  against `runSimulationSync(...)` and asserts byte-identical simulation JSON.
- Full sim/golden gates passed before review.

## Surface Inventory

| Surface                                                       | Change                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/data/wcdraft/manifest.json`                                 | Legacy compatibility path retained.                                                                       |
| `/data/wcdraft/draft-pool.compact.json`                       | Legacy raw compatibility path retained; no longer used by new browser loader or SW precache.              |
| `/data/wcdraft/scenario-2026.compact.json`                    | Legacy compatibility path retained.                                                                       |
| `/data/wcdraft/runtime-data-2.3.0/manifest.json`              | New versioned manifest path for current browser clients.                                                  |
| `/data/wcdraft/runtime-data-2.3.0/draft-pool.compact.json.br` | New versioned max-quality Brotli draft-pool payload; served as JSON with `Content-Encoding: br`.          |
| `/data/wcdraft/runtime-data-2.3.0/scenario-2026.compact.json` | New versioned scenario path for current browser clients.                                                  |
| `/sw-version.js`                                              | Now carries `runtime_data_base_path` and concrete compressed precache URLs.                               |
| `/sw.js`                                                      | Reads generated precache URLs and rejects raw draft-pool precache configuration.                          |
| `/api/og/run`                                                 | Static-fallback behavior preserved; latent full-pool edge render branch removed.                          |
| Sim worker `postMessage` payload                              | Removes `teams`/`bracket`/`ruleset_version`; sends prebuilt `scenario` and pruned `world.nationByCardId`. |

## Gates Run

| Gate                                                                                                                                                                     | Result                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `pnpm --filter @wcdraft/data exec vitest run test/client-fetch-binding.test.ts test/web-assets-copy.test.ts`                                                             | PASS: 2 files, 8 tests                                    |
| `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/simulate-telemetry.test.ts lib/game/__tests__/run-og.test.ts lib/game/__tests__/sw-cache-version.test.ts` | PASS: 3 files, 38 tests                                   |
| `pnpm --filter @wcdraft/data typecheck`                                                                                                                                  | PASS                                                      |
| `pnpm --filter @wcdraft/data lint`                                                                                                                                       | PASS                                                      |
| `pnpm --filter @wcdraft/web lint`                                                                                                                                        | PASS                                                      |
| `pnpm --filter @wcdraft/web typecheck`                                                                                                                                   | PASS after building `@wcdraft/db` in the fresh worktree   |
| `pnpm run check:generated`                                                                                                                                               | PASS; retained runtime archive validated                  |
| `pnpm --filter @wcdraft/data test`                                                                                                                                       | PASS: 9 files passed / 1 skipped; 73 passed / 7 skipped   |
| `pnpm --filter @wcdraft/web test`                                                                                                                                        | PASS: 62 files passed / 1 skipped; 687 passed / 1 skipped |
| `pnpm typecheck`                                                                                                                                                         | PASS: 8/8 tasks                                           |
| `pnpm lint`                                                                                                                                                              | PASS: 5/5 tasks                                           |
| `pnpm test`                                                                                                                                                              | PASS: 8/8 tasks; core 22 files/366 tests, data 9 files passed + 1 skipped/73 passed + 7 skipped, db 2 files/79 tests, marketing-x 7 files/64 tests, web 62 files passed + 1 skipped/687 passed + 1 skipped |
| `pnpm build`                                                                                                                                                             | PASS: 4/4 tasks; existing web build warnings only          |
| `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`                                                                                                | PASS: core golden 2 files/67 tests; draft golden 5 files/40 tests |
| `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`                                                                                     | PASS: data golden 2 files/31 tests; integration golden 2 files/22 tests |
| `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`                                                                                                       | PASS: leaderboard golden 1 file/6 tests                   |
| `pnpm exec turbo run test:realism:heavy --filter=@wcdraft/data`                                                                                                           | PASS: 1 file/7 tests; strategic locked bands green at N=2000 |
| `cd etl && ruff check src tests && pytest -q`                                                                                                                            | PASS: ruff clean; 297 tests passed                        |
| `git diff --check`                                                                                                                                                       | PASS                                                      |
| local `next start` + `curl /data/wcdraft/runtime-data-2.3.0/draft-pool.compact.json.br`                                                                                   | PASS: `Content-Encoding: br`, `Content-Length: 1429691`, decompressed sha matches manifest |

## Fresh-Context Review

| Review                     | Result                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit B data delivery       | PASS after fix-forward commit tracked retained runtime-data files and `web-assets-copy` test; reviewer re-ran data/SW/check-generated proofs |
| Atomic versioned delivery  | PASS after fix-forward commit tracked retained runtime-data files and `web-assets-copy` test; reviewer re-ran retention/SW/check-generated proofs |
| Unit C OG edge route       | PASS; reviewer confirmed current unsigned token contract requires static fallback and route no longer has full-pool parse/build/render path  |
| Unit D sim worker payload  | PASS; reviewer re-measured `500,459 -> 155,337` JSON bytes and byte-identical worker vs sync simulation for fixed seed                       |
| Cumulative Red review      | PASS; reviewer rechecked `origin/main...HEAD`, decompressed `.br` identity, versioned data paths, OG route, sim identity, forced build/goldens/heavy realism |

## Remaining Required Gates

- Vercel preview wire-byte proof.
- Merge/deploy/live verification and auto-revert decision.
