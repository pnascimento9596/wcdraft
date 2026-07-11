# Audit Season 1 D1 fix-forward report

## Outcome

The two numbered defects from the independent review of PR #235 head
`dd3faa71fcad841608e824fce92f5c1529a8613a`, the successful-response
classification defect found in the review of replacement head
`411d6af9cdf9a3fda6389f9b410cee5290aa8d74`, and the HTTP-acknowledgement
ambiguity defect found in the review of replacement head
`28115bcad3093509e124c0e796e1bf4a4491ee29` are fixed locally. The branch is
not approved for merge yet. The three FAIL reports have SHA-256
`a24d3259f159b1909090f1862881c67f650e2f964aab762aa13b8903bb928fce` and
`6f02364748f8572586c03ba74cc5f14f5cf077442856f49cfc4d0c9d00298cd1`, and
`c94a0b2bfed3cf87a6c187d7303aa358ee774466b2f5930ba89b01178467a88e`,
respectively.

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
- Known application 4xx failures, excluding 408, release the latch and remain
  usable.

Mounted regressions use held-open real mutation calls. They assert exactly one
request after an attempted repeat, no ranked `onLocked` or router side effect,
transport-unknown locking, definitive HTTP recovery, changed-operation
recovery, successful issuance followed by local creation failure, and
successful issuance followed by a throwing parent handoff.

## Defect 1b — committed success with an unusable response

The ranked-attempt route commits the attempt and returns HTTP 201. A response
body read or JSON parse failure is therefore not a definitive issuance
failure: the browser has lost the seed details, but the database write may
already exist. The same is true when a successful 2xx body parses but fails
the required attempt contract or does not echo the requested configuration.

`requestRankedAttempt()` now has three explicit outcomes:

- A 2xx with the complete validated attempt contract is accepted.
- Any 2xx without that usable contract is `outcomeUnknown: true` and remains
  locked in `FormationSelect`.
- A known application 4xx response, excluding 408, is definitive and remains
  retryable; HTTP 408 and 5xx responses are outcome-unknown.

Direct client tests cover unreadable and malformed HTTP 201 bodies, unusable
200/204/299 responses, the full acknowledgement-status matrix, and a valid 201.
Mounted `FormationSelect` tests cover both unreadable and malformed committed
201 responses and prove attempted repeats leave the POST count at exactly one,
with no local run, `onLocked`, or router side effect and with only Account and
mode-selection alternatives exposed.

## Defect 1c — ambiguous HTTP acknowledgements

An HTTP response does not always prove that a non-idempotent mutation did not
commit. In particular, an origin may commit before returning an unexpected
failure, and a gateway may emit 502 or 504 after losing the origin's successful
acknowledgement. The prior client logic settled its latch for every non-2xx
response, so HTTP 408 and 5xx responses could enable a duplicate write.

The shared unsafe-mutation module now classifies response acknowledgement
explicitly:

- 400, 401, 403, 409, 429, and other known application 4xx responses are
  definitive, except 408.
- 408 and every 5xx response are outcome-unknown for a non-idempotent mutation.
- Invalid or out-of-range status values fail closed as outcome-unknown.

Ranked attempt issuance, magic-link sign-in, password-reset delivery, password
sign-in, sign-up, username update, verification resend, password set/change,
and account deletion apply that classifier before any ordinary error path.
Each ambiguous response keeps the operation's one-dispatch latch, presents
operation-specific acknowledgement-loss copy, and offers only a state check or
safe alternate. The successful username contract must contain a non-empty
`profile.username`, and the successful password contract must contain
`hasPassword: true`; an unusable committed 2xx locks rather than performing a
downstream state handoff. The other affected success paths do not consume a
required response field: link and verification delivery need the acknowledged
status, sign-in and sign-up have safe default redirects, and deletion hands off
on an acknowledged 2xx.

The idempotent/reconciled Account and Header sign-out flows are intentionally
unchanged. The leaderboard-submit mutation is also unchanged because its
exact-replay dedupe and existing reconciliation paths make replay semantics
different from ranked attempt issuance.

Mounted React regressions cover every affected operation. For representative
408/5xx responses they assert the exact POST/PUT/DELETE method, exactly one
dispatch after an attempted repeat, disabled controls, a safe recovery path,
and no router or ranked callback handoff. Companion mounted cases prove known
4xx rejections release the latch and valid success contracts remain usable.

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

- Third fix-forward direct/mounted regressions: 2 files passed, 73 tests passed.
- Complete web Vitest suite: 95 files passed / 1 skipped; 1025 tests passed / 1
  skipped.
- Complete data package suite: 16 files passed / 1 skipped; 168 tests passed /
  9 skipped.
- Root typecheck: 8/8 tasks passed; 7 cached and the changed web task executed.
- Root lint: 5/5 tasks passed; 4 cached and the changed web task executed.
- Root build: 4/4 tasks passed; 3 cached and the changed web task executed; Next
  generated 40/40 pages.
- Frozen-source game-flow Playwright gate: passed mode selection, draft setup,
  position-first target, pick lock, manager guard, review simulation, results,
  and share.
- Frozen-source responsive gate: desktop 84 metrics / 0 failures; mobile 56 / 0;
  interaction targets 40 / 0.
- Changed-file Prettier: passed.
- `git diff --check`: passed.

The earlier isolated browser receipt validates superseded head `28115bc`, not
this third fix-forward, and is not claimed as current-source evidence. The
current browser gates above ran against frozen source/test diff SHA-256
`e84a75310f712f6da24c40682e490a7da4ae2dec46cf7257a1c9c0f5639ebb9b`.
After both gates exited zero, a process scan found no game-flow, responsive
wrapper/verifier, Next dev, or next-server process, and the working tree showed
no generated-file drift.

## Risk and review focus

- Review the mutation latch transitions, especially committed ranked issuance
  and operation-relevant sign-in resets.
- Review the acknowledgement classifier: every 408/5xx and unusable successful
  body must remain locked, while known application 4xx failures remain usable.
- Review that unknown deletion, verification resend, and ranked issuance have
  no local replay path.
- Review the mounted tests as container evidence rather than helper-only
  evidence; the injected seam is below the actual effects and state owners.
- The added DOM dependency is test-only. No schema, migration, data artifact,
  rating, simulation, draft-engine, or server API contract changed.

## Remaining gates

- Push the final commit and let protected CI run at that exact head.
- Obtain a fresh independent review pinned to that head. The three FAILs are not
  superseded until the new reviewer returns PASS.
- Do not merge from this report alone.
