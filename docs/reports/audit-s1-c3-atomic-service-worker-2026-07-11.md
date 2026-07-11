# Audit Season 1 C3 — atomic service-worker data promotion

## Outcome

C3 is implemented and fully validated locally on `ws-f4/audit-s1-sw-atomic`,
rebased onto Wave-D-tagged main `c0fd708e518ca96f8e9992f1e445c719c08e3533`.
The lane remains unshipped pending protected CI, fresh exact-head RED review,
the required Ollama Cloud cross-model spot review, merge, deployment, and live
verification.

## What changed

- `generate-sw-version.mjs` derives the required precache closure from the
  runtime manifest instead of a hand-maintained URL list. The current closure
  contains the manifest, canonical Brotli draft pool, scenario, Daily salt map,
  and score distribution.
- The generated worker configuration separates a deploy-keyed shell cache from
  a data cache keyed only by the composed data revision. A UI-only deployment
  therefore reuses immutable data without fetch, write, eviction, or rotation.
- Service-worker install is atomic: every required fetch, HTTP response,
  fingerprint/header check, cache write, and post-write presence check must
  succeed. A failed candidate rejects install, never calls `skipWaiting`, and
  removes only its newly named partial cache after active fills settle.
- Activation verifies the complete required set before it enumerates or removes
  old `wcdraft-*` caches, then claims clients.
- Web Locks plus an in-worker promise deduplicate pool demand across active and
  installing workers.
- A page-side handoff coordinates the genuinely uncontrolled cold-page race.
  Manifest, pool, and Daily-map demand all wait until one controller revision is
  selected. Unsupported browsers and definitive registration failure use the
  direct loader; a bounded 15-second pending-install timeout fails the attempt
  instead of duplicating worker pool work.
- The post-rebase `loadGameData` composition preserves D1's shared 30-second
  request budget and translated errors. Its abort signal binds the coherent
  manifest, pool, and optional Daily salt-map fetches.

## Executable lifecycle evidence

The fake CacheStorage/ServiceWorker harness executes committed `public/sw.js`
and the real page coordinator. It covers failed required assets retaining the
old complete caches, healthy promotion and cleanup, UI-only reuse, data-version
rotation, non-OK responses, throwing/missing cache writes, malformed config,
incomplete activation, cross-worker pool deduplication, and the uncontrolled
page handoff. The cold-page proof keeps total pool network count at exactly one.

The final post-rebase focused overlap matrix included the C3 worker/config,
lifecycle, handoff, and registration tests plus D1 Daily and mounted/first-load
contracts: 7 files, 49 tests passed.

## Validation

- Generated-artifact deterministic rebuild/check: passed; no tracked artifact
  drift.
- Forced typecheck: 8/8 tasks, 0 cached.
- Forced lint: 5/5 tasks, 0 cached.
- Forced root test: 8/8 tasks, 0 cached, 8m47.648s.
  - core: 26 files / 391 tests;
  - data: 16 passed files + 1 heavy skip / 168 passed + 9 skipped tests;
  - DB: 4 files / 161 tests;
  - marketing: 8 files / 68 tests;
  - web: 105 passed files + 1 benchmark skip / 1,116 passed + 1 skipped tests;
  - game-flow Playwright: passed;
  - responsive: 218 metrics / 0 failures (84 desktop, 56 mobile, 40
    interaction, 30 mode/setup, 8 opened navigation).
- Forced build: 4/4 tasks, 0 cached; 40/40 web pages.
- Core goldens: 69 RNG/narrative + 42 draft.
- Data goldens: 54 data + 22 integration.
- Leaderboard golden: 6.
- Prettier and `git diff --check`: passed.

The first post-rebase overlap attempt is not release evidence: the preserved
worktree resolved a stale linked `@wcdraft/data` build that predated D1 and
therefore lacked its timeout exports. After rebuilding the workspace packages,
the entire matrix was restarted and passed.

## Exact-head review fix-forward

Fresh independent review of `02b1103f89075deed7f0100afc01873b4698005a`
returned **FAIL** even though its full gate rerun passed. The reviewer reproduced
four release blockers: the Brotli body was not cryptographically verified; an
integrity-failed required response could be returned to a controlled page; the
manifest could load through the old controller before the pool crossed to the
new controller; and slow worker lock/fetch work could outlive the page handoff
and trigger duplicate pool work.

The fix-forward now hashes the actual decoded bytes consumed by the page for
every required response, including the 130,545,042-byte draft pool. Only a
response that completed that proof may survive a subsequent CacheStorage write
failure as a network response; integrity failures return the fail-closed 504.
Required lock acquisition and network fills share an abortable 25-second worker
budget. The page now selects one controller before it starts the manifest, pool,
or Daily-map request, and a 15-second handoff timeout fails the attempt instead
of starting duplicate direct pool work while installation continues.

Executed negative coverage now includes same-length pool and identity-bundle
corruption, verified-response/storage-failure separation, never-settling fetch,
never-acquired origin lock, old-controller/new-controller handoff ordering,
handoff timeout without direct fallback, and cache-deletion rejection. The
focused worker/handoff suite passes 2 files / 24 tests; the complete seven-file
C3+D1 overlap passes 56 tests. The fix-forward full validation then passed:
generated-artifact check; forced typecheck 8/8; forced lint 5/5; forced root test
8/8 in 7m53.744s with web 1,123 passed + 1 expected skip and responsive 218/0;
forced build 4/4 with 40/40 pages; core goldens 69 + 42; data goldens 54 + 22;
and leaderboard golden 6. Protected CI, fresh RED review, and Ollama Cloud review
remain required for the fix-forward.

## Risk and rollback

The high-risk surface is service-worker lifecycle ordering: a partial candidate
must never replace or delete the last complete cache, and UI-only deploys must
not churn immutable data. Those transitions are executable and fail-closed in
the lifecycle harness. Availability fallback remains the direct network loader.

No runtime-data payload, rating, draft, simulation, schema, migration, API,
database, or six-anchor semantic value changed. If a production live check
fails, the merge must be auto-reverted and the prior worker/cache generation
re-verified before fix-forward.
