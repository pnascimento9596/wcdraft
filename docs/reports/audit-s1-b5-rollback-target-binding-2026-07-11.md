# Audit Season 1 B5 rollback target binding

## Candidate

- Branch: `ws-f4/audit-s1-rollback-target-binding`
- Base: shipped B1+B2 main `d47d06af78e018c362751c25e5ea865ff072786c`
- Risk: RED — destructive migration rollback guard and CI workflow

## Safety boundary

Before any migration apply, test-row, purge, or down-migration statement, the guard now:

1. Requires `NEON_API_KEY`, `NEON_PROJECT_ID`, and the ephemeral branch sentinel.
2. Parses the direct/unpooled Neon URL without logging credentials.
3. Reads `current_database()` through the rollback DB handle and requires it to match the URL database.
4. Resolves the exact endpoint host and endpoint ID through Neon API truth with one unambiguous project match.
5. Requires the endpoint to be read-write and binds its branch to the sentinel.
6. Independently verifies the branch response.
7. Refuses primary/default, API-protected, and protected-name branches closed.

API and driver failures expose neither database URLs nor API keys.

## Adversarial coverage

The focused suite pins absent credentials/sentinel, attacker-chosen sentinel, split or duplicate endpoint mappings, connected-database mismatch/query failure, primary/default/protected targets and names, malformed/non-Neon/pooled URLs, API/shape failures, wrong project/branch/read-only endpoints, the valid ephemeral control, and executable guard-before-migrate ordering.

## Post-rebase validation

- Focused rollback-target guard: 37/37.
- Complete DB package: 4 files, 156/156.
- Root typecheck: 8/8 tasks.
- Root lint: 5/5 tasks.
- Root build: 4/4 tasks; Next 40/40 pages.
- Production migration workflow contract: PASS (8 classifier cases, GitHub-ref success plus 5 refusals, Node 22 Neon resolver execution plus 2 role refusals, 18 bindings, two authenticated live-main checks, secret/order guards).
- `actionlint` v1.7.12, Prettier, and `git diff --check`: PASS.
- Browser-inclusive root test: 8/8 Turbo tasks in 7m31.385s; core 391/391,
  data 168 passed / 9 skipped, DB 156/156, marketing 68/68, web 1,044 passed /
  1 skipped, expanded game-flow PASS, responsive 204 metrics / 0 failures
  (desktop 84, mobile 56, interaction targets 40, mode/setup 24).

No live or ephemeral Neon branch was created, modified, or deleted locally. The real destructive round trip remains the PR's credentialed ephemeral-Neon CI gate. Because `.github/workflows/ci.yml` changes, protected CI must also execute the heavy realism lane.

## Pending

- Fresh exact-SHA independent RED review.
- Protected CI, including credentialed ephemeral-Neon up/down and heavy realism.
- SHA-pinned merge, deployment observation, and production sanity.

## Independent-review fix-forward

Independent review of head `ebf1faeeeb3e48c0b3f93b4b25db2284269e7871` returned FAIL (report SHA-256 `464abe493fc047ac297d0dc240b5a19dc0ddefe035b6353aecf07e8a7fad5ef1`). The guard callback wrapped only the initial migration apply; every test mutation, purge delete, reverse down migration, and final clean-state assertion ran after the callback returned.

The fix-forward moves the entire apply → probe mutations → purge → reverse downs → clean-state assertion sequence into `runWithVerifiedRollbackTarget`; only `pool.end()` remains outside. A structural contract now enumerates all `await db.execute` occurrences: the sole pre-scope execution must be the read-only `current_database()` verifier, and every later DB execution plus the migration apply must lie between explicit verified-scope markers before pool teardown. Focused guard coverage remains 37/37, and DB typecheck/lint plus diff check pass.

The failed candidate's protected CI was cancelled before any credentialed database mutation. A replacement SHA requires fresh exact-head RED re-review and a new full protected CI run.

The exact replacement source reran the browser-inclusive root test successfully: 8/8 Turbo tasks in 8m18.872s; core 391/391, data 168 passed / 9 skipped, DB 156/156, marketing 68/68, web 1,044 passed / 1 skipped, expanded game-flow PASS, and responsive 204 metrics / 0 failures.

The next independent re-review of head `34072171dc7da6468c431bed697f33d853fae2cc` confirmed the runtime enclosure but returned FAIL (report SHA-256 `ed52d15bfd35caf50264d7fd101227c9b9d27ecd49044ae9709156c5b5de5788`). The regex structural test matched only 29 awaited forms out of 46 actual `db.execute` calls, missing 17 callback-returned executions; it also did not structurally identify the callback boundary.

The second fix-forward parses `rollback-check.ts` with the TypeScript AST and inventories actual CallExpression nodes. It requires exactly one `runWithVerifiedRollbackTarget` call whose third argument is the destructive arrow callback; pins all 46 `db.execute` calls; allows exactly one outside call containing the read-only `current_database()` verifier; requires the other 45 calls inside the callback's real AST body; inventories the sole `migrate(...)` call inside; and proves `pool.end()` follows the callback. Focused 37/37, full DB 156/156, typecheck/lint/build, workflow contract, actionlint, Prettier, and diff check pass after this change.

The third independent re-review of head `0476090972db0146fa7ca90788c358c314203c29` returned FAIL (report SHA-256 `eaa5a9c2dbe582f199cdf55f5afe39714c6246b3a19ee44f1f83ec42430f0251`). A concrete nested `db` shadow preserved every direct AST count while the verifier used handle A and destructive work used handle B.

The third fix-forward makes the verified handle an API capability. `RollbackTargetDependencies<Handle>` carries one `verifiedHandle`; verification invokes `queryCurrentDatabase(handle)`, then the guard invokes `destructiveOperation(target, handle)` with the same object. The rollback script uses only callback parameter `verifiedDb` for the exact verifier, migration apply, all 45 later executions, and reverse downs. Its AST contract now inventories every `.execute` call regardless of receiver spelling, requires all 46 receivers to be `verifiedDb`, validates the exact read-only SQL template, rejects `verifiedDb` shadows in the verifier and destructive callback, pins one outer `openMigratorDb`, requires the sole migration call to use `verifiedDb`, and AST-validates one `pool.end()` after the callback. Negative in-memory source fixtures pin rejection of nested handle shadows, alternate execute receivers, and compound/mutating verifier SQL. Focused 38/38, full DB 157/157, typecheck/lint/build, workflow contract, actionlint, Prettier, and diff check pass.

The third review's broader DB run hit shared-host ENOSPC after 136 passing tests. Obsolete completed audit clones—not worktrees or reports—were removed, restoring 15 GiB before replacement validation.

The fourth independent re-review of head `926ee177166bb9d3c8695a4740b8753a937dd81a` returned FAIL (report SHA-256 `a3f7ce1bdb373ef7c00c1a45b915928110e798a62e34646d01bceffe5cebdd5a`). The generic capability guaranteed that verifier and destructive callbacks received the same caller-selected object, but the AST contract did not bind that object to the direct database handle returned by `openMigratorDb()`. A compiling `{ pool } = openMigratorDb(); const db = getDb()` substitution kept every asserted 46/45/1 count green while allowing API evidence to verify the ephemeral direct URL and destructive work to use a pooled production handle with the same database name.

The fourth fix-forward structurally binds the capability and teardown to one exact `const { db, pool } = openMigratorDb()` declaration inside `main`. It requires the direct `openMigratorDb` client import; requires that call to initialize the exact `db` and `pool` object binding; rejects every other `db`/`pool` binding, assignment, or local `openMigratorDb` shadow in `main` and its callbacks; preserves `verifiedHandle: db`, all 46 callback-capability execute receivers, exact verifier SQL, and the sole migration argument; and requires the one `pool.end()` after the verified callback. Negative fixtures now pin pooled-handle substitution and reassignment in addition to callback shadowing, alternate receivers, and mutating verifier SQL. Focused validation passes 38/38 and full DB validation passes 157/157; a new frozen SHA still requires a fresh exact-head RED review and protected credentialed CI.

The fifth independent re-review of head `33152be85d16419fc829a883ef8cd1e8aacdc783` returned FAIL (report SHA-256 `16dcb5d8ad7d1ce59f55deaeafb64dba8ee511d4fa0e1b5d32c05a93198c10dd`). Although the runtime correctly awaited `pool.end()` in `finally`, the AST contract required only one textual teardown receiver after the callback. Moving the sole awaited call into a never-called nested function preserved the exact destructure, all counts, receiver spelling, after-callback position, no-assignment checks, and zero syntax diagnostics while no teardown ran.

The fifth fix-forward requires the verified guard invocation to lie inside exactly one `try` and requires that statement's paired `finally` block to contain exactly one statement: an `await` whose expression is the sole inventoried `pool.end()` call. The adversarial suite now includes the never-called teardown-function rewrite and proves it does not satisfy the paired-finally contract. Focused coverage remains 38/38. The failed head's protected CI was cancelled before the credentialed database lane executed; a replacement SHA requires a fresh exact-head RED review and complete protected CI.

The sixth independent re-review of head `3f06f7c1da4323112615c89e25008c62f64672c2` returned FAIL (report SHA-256 `437d4ca5ecf530327e146b60ff90e7953928ff07418d2606ac98dcf23a595972`). Two compiling rewrites preserved the exact direct destructure/import, paired awaited teardown, all 46/45/1 inventory counts, and the no-direct-`db`/`pool`-assignment checks while redirecting the capability: aliasing outer `db` and applying `Object.assign(alias, getDb())`, or reassigning the destructive callback parameter with `verifiedDb = getDb()`.

The sixth fix-forward removes three obsolete outer-`db` arguments from the duplicate-rejection helper and constrains handle capabilities by complete identifier inventory. Outer `db` may appear only in the exact `openMigratorDb()` destructuring binding and `verifiedHandle` initializer; `pool` may appear only in that binding and the paired-finally teardown; and `verifiedDb` may appear only in the two allowed callback parameter declarations, all 46 execute receivers, and the sole migration argument. Additional alias/object-mutation and callback reassignment/object-mutation negative fixtures prove those rewrites introduce forbidden references. Focused coverage remains 38/38. The failed head's CI was cancelled before credentialed rollback work; replacement exact-head review and complete protected CI remain required.
