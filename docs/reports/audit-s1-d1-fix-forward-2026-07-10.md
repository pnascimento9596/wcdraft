# Audit Season 1 D1 fix-forward report

## Outcome

The two numbered defects from the independent review of PR #235 head
`dd3faa71fcad841608e824fce92f5c1529a8613a` are fixed locally. The branch is
ready for a new exact-head independent review after push; it is not approved
for merge yet. The prior FAIL report has SHA-256
`a24d3259f159b1909090f1862881c67f650e2f964aab762aa13b8903bb928fce`.

## Defect 1 — unsafe mutation replay

The browser now uses one shared synchronous mutation latch with four states:
idle, pending, committed, and outcome unknown. `begin()` claims the write slot
synchronously, so repeated events cannot race React rendering. A timeout or
transport failure remains latched until the operation is materially changed
or server state is reconciled; a committed write cannot be released by a
later local failure.

- Ranked attempt results now distinguish `outcomeUnknown` from definitive
  HTTP failures. Unknown issuance locks formation and draft configuration for
  the page and exposes only Account and mode-selection alternates.
- A successful ranked response is marked committed before local run creation,
  persistence, and the parent `onLocked` handoff. Creation or callback failure
  therefore cannot issue a second seed.
- Password sign-in, magic-link sign-in, password-reset delivery, sign-up,
  username update, verification resend, password update, account deletion,
  and Account sign-out all preserve timeout/transport uncertainty and keep the
  corresponding mutation disabled.
- Sign-in resets are operation-aware: editing an unrelated field does not
  unlock the unknown request. Verification, deletion, and ranked issuance have
  no local replay reset and require reload/read reconciliation or a safe
  alternate.
- Definitive HTTP failures release the latch and remain usable.

Mounted regressions use held-open real mutation calls. They assert exactly one
request after an attempted repeat, no ranked `onLocked` or router side effect,
transport-unknown locking, definitive HTTP recovery, changed-operation
recovery, successful issuance followed by local creation failure, and
successful issuance followed by a throwing parent handoff.

## Defect 2 — mounted first-load evidence

Real ReactDOM mounts now exercise every named state-owning container:

- `AuthProvider` with `AccountMenu`
- `ModeSelect`
- `DraftScreen`
- `HistoryScreen`
- `ResultsScreen`
- `ReviewScreen`
- `ShareScreen`
- `BoardScreen`

Each test begins with a never-resolving read, advances the production request
budget with fake timers, proves the loading UI disappears, checks stable
timeout copy plus a safe alternate, and verifies Retry starts only a new GET.
The game-container matrix keeps the real container effects and production
budget boundary while injecting a held-open GET seam below the data loader.

The repository had no DOM renderer or mount harness: its Vitest configuration
was explicitly Node-only, with no jsdom, happy-dom, testing-library, or
react-test-renderer dependency. The fix adds only `happy-dom` as a web
development dependency and uses the existing ReactDOM plus Vitest APIs
directly. It does not add a testing-library stack or production runtime code.

## Validation

- Focused mounted/client regressions: 5 files passed, 25 tests passed.
- Complete web Vitest suite: 95 files passed / 1 skipped; 969 tests passed / 1
  skipped.
- Complete data package suite: 16 files passed / 1 skipped; 168 tests passed /
  9 skipped.
- Forced root typecheck: 8/8 tasks, 0 cached.
- Forced root lint: 5/5 tasks, 0 cached.
- Forced root build: 4/4 tasks, 0 cached; Next generated 40/40 pages.
- Final isolated game-flow Playwright gate: passed mode selection, draft setup,
  position-first target, pick lock, manager guard, review simulation, results,
  and share.
- Final isolated responsive gate: desktop 84 metrics / 0 failures; mobile 56 / 0;
  interaction targets 40 / 0.
- Full-repository Prettier: passed.
- `git diff --check`: passed.

An earlier browser run overlapped another lane. Although it exited cleanly, it
is deliberately not counted. The browser results above are from the later
exclusive final-source rerun, followed by a process scan confirming that the
game-flow, responsive, verifier, Next dev, and next-server children exited and
`next-env.d.ts` was restored.

## Risk and review focus

- Review the mutation latch transitions, especially committed ranked issuance
  and operation-relevant sign-in resets.
- Review that unknown deletion, verification resend, and ranked issuance have
  no local replay path.
- Review the mounted tests as container evidence rather than helper-only
  evidence; the injected seam is below the actual effects and state owners.
- The added DOM dependency is test-only. No schema, migration, data artifact,
  rating, simulation, draft-engine, or server API contract changed.

## Remaining gates

- Push the final commit and let protected CI run at that exact head.
- Obtain a fresh independent review pinned to that head. The old FAIL is not
  superseded until the new reviewer returns PASS.
- Do not merge from this report alone.
