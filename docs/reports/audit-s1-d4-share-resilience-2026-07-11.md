# Audit Season 1 D4 share resilience

## Outcome

D4 is complete locally on `ws-ux/audit-s1-share-resilience`, rebased as one
isolated commit onto tagged Wave B main
`f9559061de9b47b00c8fc1b5a1ea1164358f61ae`. The branch is intentionally not
pushed; PR, independent review, merge, deployment, and live verification remain.

## Architecture decision

Replay-token creation is the availability boundary. Once the token exists, the
client immediately builds the unsigned `/play/share?run=...` URL and uses it for
the caption, clipboard actions, native sharing, and social intents. That page's
existing metadata path selects `og-default` when there is no valid signed `og`
parameter.

Signed OG generation is an optional URL upgrade, not a prerequisite for
sharing. It retains the exact `POST /api/og/sign`, JSON content type, and
`{ "run": token }` body. The request now uses D1's shared bounded-request helper
with a four-second budget and the existing three-attempt schedule. No signing,
verification, render, or fetch server path changed.

## Behavior

- Copy link, Copy caption, native share, and social intents are enabled while
  signing is pending and after signing fails or times out.
- A valid signed response upgrades later actions to the signed URL. The
  already-available replay URL is never withdrawn.
- Signing failure displays the literal status `preview unavailable, link
works` and explains that the static preview card is active.
- Retry restarts preview signing only. It neither dispatches nor disables copy,
  native, caption, or social sharing.
- A synchronous per-action latch prevents repeated dispatch while that action
  is pending. Different actions remain independent.
- Unmount aborts the active preview request. A late response from a fetch that
  ignores cancellation cannot update the removed screen.
- D2's 44px preview Retry target and reduced-motion behavior remain unchanged.

## Regression evidence

The mounted ShareScreen suite covers a held-open signing request and proves the
caption contains the unsigned replay URL immediately. It exercises copy link,
copy caption, and native share before preview resolution and verifies the sign
request's method, path, headers, and body. Separate cases cover three HTTP 503
attempts, three bounded timeouts, Retry isolation, abort plus late success after
unmount, and exactly-once native sharing while the platform promise is pending.
The existing OG suite continues to prove unsigned share metadata resolves to
`/brand/marketing/og-default.png`.

The first post-Wave-B responsive run caught a real integration regression: the
newly immediate unsigned replay URL is a long unbroken token, so the caption
expanded the Share author surface horizontally at 667x375 and 768x1024 in both
themes. The fix-forward keeps the caption within its container and permits the
token URL to wrap. The replacement full matrix proves the overflow is closed.

## Validation

- Focused mounted, adapter, source-contract, fallback, and OG tests: 5 files
  passed; 60 tests passed.
- Complete direct web Vitest: 100 files passed / 1 skipped; 1,079 tests passed /
  1 skipped.
- Complete data Vitest: 16 files passed / 1 skipped; 168 tests passed / 9
  skipped.
- Root typecheck: 8/8 tasks passed; changed web task executed.
- Root lint: 5/5 tasks passed; changed web task executed.
- Root build: 4/4 tasks passed; changed web task executed; Next generated 40/40
  pages.
- Targeted Prettier on the changed implementation and test files: passed.
- Post-Wave-B game-flow Playwright: passed.
- Post-Wave-B responsive shell: 204 metrics / 0 failures — desktop 84/0,
  mobile 56/0, interaction targets 40/0, mode/setup 24/0.
- Replacement typecheck, lint, build, targeted Prettier, and diff checks passed
  after the overflow fix; build still generated 40/40 pages.

## Risk and carryover

The change is bounded to share-screen client orchestration, caption containment,
and tests. No schema,
migration, authentication, rating, simulation, token-validation, runtime-data,
leaderboard-server, ETL, or OG server semantics changed. Automatic preview
signing still makes up to three attempts by design. PR, merge, deploy, and live
verification have not occurred.
