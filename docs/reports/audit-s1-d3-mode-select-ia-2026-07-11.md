# Audit Season 1 D3 mode-select IA

## Outcome

D3 is complete locally on `ws-ux/audit-s1-mode-select-ia`, rebased without a
stash onto shipped D1 main `1681d64c2567b87f6c6bdb512bca7a67693fd28b`.
The branch is intentionally not pushed from this receipt; remote review
sequencing remains held by the lead.

## What changed

- Daily remains the lead mode; Classic, Open Draft, Memory, and Blind Open use
  a compact two-column small-viewport board.
- Classic and Memory say `Ranked-capable · casual by default` and expose a
  visible Casual/Ranked setup choice, with Casual selected by default.
- Ranked setup calls `requestRankedAttempt`, preserves the server-issued
  attempt contract, and shows direct sign-in or resend-verification actions for
  definitive auth gates. Legacy ranked query parameters restore the visible
  choice but are not the only entry path.
- The tall Daily-unavailable notice stays in document flow, while checking and
  available states retain their safe sticky action dock. The final card row is
  not covered at `360x800`, `390x844`, or `667x375`.
- Daily timeout remains distinct from unavailable and offers Retry plus Classic
  fallback.
- Ranked issuance now accepts caller cancellation through the bounded CSRF
  POST. FormationSelect aborts on unmount, invalidates a monotonically
  increasing request sequence, and verifies mounted/current identity after the
  request and before local run creation or `onLocked` handoff. A late or
  superseded completion is inert even when the underlying fetch ignores abort.

## D1 compatibility

The rebase preserves D1's unsafe-mutation behavior. HTTP 408, all 5xx,
transport loss, timeout, and unusable successful attempt bodies remain
outcome-unknown and one-dispatch locked. Known application 4xx responses,
including 429 but excluding 408, remain definitive. The D3 `code` field is
retained so `AUTH_REQUIRED` and `VERIFICATION_REQUIRED` select their typed UI
actions.

## Regression evidence

Mounted tests hold a ranked response open, unmount the setup as navigation
would, then resolve a valid success. They assert zero `createNewRunRecord`
calls, zero persistence/handoff, and an aborted caller signal. A replacement
mount test resolves the stale request before the replacement request and proves
only the replacement can create a run and call `onLocked`. Direct client
coverage proves caller cancellation settles even when the underlying fetch
resolves late.

## Validation

- Focused source, response, and mounted lifecycle tests: 5 files passed, 99
  tests passed.
- Complete direct web Vitest: 95 files passed / 1 skipped; 1,031 tests passed /
  1 skipped.
- Complete data Vitest: 16 files passed / 1 skipped; 168 tests passed / 9
  skipped.
- Root typecheck: 8/8 tasks passed; changed web task executed.
- Root lint: 5/5 tasks passed; changed web task executed.
- Root build: 4/4 tasks passed; changed web task executed; Next generated 40/40
  pages.
- Full-repository Prettier and `git diff --check`: passed.
- Expanded game-flow Playwright: passed compact mode dock, Daily-unavailable
  flow, Casual/Ranked setup and 401/403 actions, position-first flow, pick and
  manager guards, review, results, and share.
- Responsive wrapper: desktop 84/0, mobile 56/0, interactions 40/0, mode/setup
  24/0; total 204 metrics / 0 failures.
- Browser-relevant source/test diff SHA-256:
  `a0fe5fb384ae9065dfd2a91a9802aa13d8c503268a0508407f5a2085f1533586`.
- Post-browser scan: zero game-flow, responsive wrapper/verifier, Next dev, or
  next-server processes; working tree had no generated drift.

## Risk and carryover

No schema, migration, rating, simulation, token-validation, runtime-data, or
leaderboard-server semantics changed. Existing roving-tabindex behavior is a
known nonblocking carryover. B2 outstanding-attempt reuse and farming controls
are not merged at this base and require their own release lane.
