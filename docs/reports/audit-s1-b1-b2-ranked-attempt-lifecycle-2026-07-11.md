# Audit Season 1 B1+B2 ranked-attempt lifecycle

## Candidate

- Branch: `ws-f4/audit-s1-ranked-attempt-lifecycle`
- Base: shipped D3 main `7ab21687628fbec439e44e5236b999bdd3af2915`
- Risk: RED — ranked issuance and leaderboard acceptance semantics

## Remediation

- Reject attempt-backed submissions before replay/simulation unless the token matches the newest exact-config live attempt for that user and season.
- Preserve accepted duplicate idempotency before replay and recheck it inside the write transaction.
- Serialize issuance on the stable user row, reuse the newest exact-config live attempt, and delete superseded legacy live rows for that exact configuration.
- Bound expired-attempt cleanup to 25 indexed rows per issuance.
- Charge every issuance request, including reuse, to a durable user bucket capped at 10 per hour with typed `429 RATE_LIMITED` and `Retry-After`.
- Preserve B3's structural attempt witnesses and atomic consume behavior.
- Keep Casual and Daily attempt-free.

## Adversarial evidence

- A cheap-valid token without an issued attempt returns typed `403 BAD_ATTEMPT` before simulation.
- Eight concurrent identical requests produce one `201`, seven `200` reuses, and one stored attempt.
- Ten sequential same-config requests reuse one attempt; the eleventh returns typed `429`.
- Thirty pre-fix same-config live rows collapse to the newest canonical attempt and one physical row.
- The shipped D3 mounted-mutation and ranked-setup boundary passes alongside B1+B2: 3 focused files, 115/115 tests.

## Independent-review fix-forward

Independent review of head `2b84bc82baffc34c1609ff6384cb67b3aace595f` reproduced a PostgreSQL concurrency defect. The consume subquery selected only an unconsumed attempt, but its outer UPDATE did not repeat that predicate. Under READ COMMITTED, a concurrent loser could wait for the winner, re-evaluate the changed row, update the already-consumed timestamp, and violate B3's restrictive attempt-to-entry structural FK. That surfaced 500 instead of an idempotent duplicate or controlled rejection.

The replacement statement repeats `consumed_at IS NULL` on the outer UPDATE. If no attempt is returned, the transaction performs a new-statement exact duplicate lookup so a winner committed during the wait is returned as an honest duplicate before `BAD_ATTEMPT`. A concurrent same-token route regression now requires one `201`, one `200` with `duplicate: true`, one leaderboard row, and one consumed attempt.

## Implementer gates on rebased candidate

- Post-fix integrated focused tests: 3 files; 116/116 passed.
- Post-fix complete web Vitest: 95 files passed / 1 skipped; 1,044 tests passed / 1 skipped.
- Root typecheck: 8/8 tasks passed.
- Root lint: 5/5 tasks passed.
- Root build: 4/4 tasks passed; Next generated 40/40 pages.
- Core RNG/narrative goldens: 69/69.
- Core draft goldens: 42/42.
- Data goldens: 54/54.
- Data integration goldens: 22/22.
- Leaderboard golden: 6/6.
- Expanded game-flow Playwright: PASS.
- Responsive wrapper: 204 metrics / 0 failures (desktop 84, mobile 56, interaction targets 40, mode/setup 24).
- Full Prettier and `git diff --check`: PASS.

After the concurrency fix, the exact replacement source reran the complete web test command: 1,044 tests passed / 1 skipped, expanded game-flow passed, and the responsive wrapper again passed all 204 metrics with zero failures.

The first candidate's CI run was cancelled after its independent-review FAIL and is not claimed. The post-fix candidate requires a new frozen SHA, fresh independent re-review (including the PostgreSQL race probe), and new protected CI.

The initial focused command after rebase loaded an ignored, stale `packages/data/dist/client.js` and failed because it predated D1's `isRequestTimeoutError` export. Rebuilding `@wcdraft/data` materialized the current source output; the exact same focused tests then passed 115/115. This was a local prerequisite failure, not counted as product evidence.

Heavy realism was not run because this candidate does not change ratings, simulation, engine, or runtime-data semantics.

## Pending release gates

- Fresh exact-SHA independent RED review with gate re-execution.
- Protected branch CI and SHA-pinned squash merge.
- Production deployment observation, exact health receipt, and ranked/D3 live sanity.
