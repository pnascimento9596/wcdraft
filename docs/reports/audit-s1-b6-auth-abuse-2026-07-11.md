# Audit Season 1 B6 — auth and abuse hardening

## Outcome

Implementation is complete locally on `ws-f4/audit-s1-auth-abuse`, rebased onto
B5-shipped main `cfcccb52df33246ae5a187e0c9a15b7a4ffcc535`. This is a RED
schema/auth/privacy lane and is intentionally **not shipped** by this report. It requires an
independent fresh-session review at the exact final commit, protected CI,
squash merge, production migration/deploy observation, and live verification.

## What changed

- Magic-link rate limits are consumed in one transaction with the coarse IP
  bucket first. A blocked source returns before touching an email bucket,
  preventing identifier quota poisoning. Sign-in tokens are removed if email
  delivery fails.
- Password-reset requests retain their anti-enumeration response while storing
  an explicit eligibility/delivery outcome and PII-free correlation ID. Both
  eligible and ineligible requests share an 8.5-second response target, while
  nonexistent accounts never invoke the email provider. Delivery errors use
  message-free structured security logs.
- Provider delivery and database bookkeeping are separate outcomes. A
  delivered sign-in token remains usable if its status update fails. Reset
  delivery status is `delivered` after provider success, `failed` after a
  definitive provider rejection, and `unknown` after the bounded provider
  timeout.
- Resend delivery has an explicit 8-second elapsed request budget covering the
  response body. Timeout is classified as an unsafe mutation with unknown
  provider outcome.
- Cookie-less `/api/auth/csrf` reads now issue a signed five-minute stateless
  bootstrap. No 30-day database session exists until the first protected
  mutation upgrades that nonce exactly once. Expired durable sessions are
  lazily swept through the existing expiry index with a bounded delete.
- Token consumption, user materialization, and authenticated-session mutation
  now share one database transaction. A downstream session failure rolls token
  consumption back; a retry can complete, while successful-token replay remains
  rejected.
- Unexpected auth errors return only an allowlisted code/message plus a UUID
  correlation ID. Server logs contain only an allowlisted event code,
  correlation ID, and coarse error class; raw database/provider messages are
  never logged.
- Saved-run storage now enforces five anonymous rows, and 500 rows plus 8 MiB
  for an account. The byte counter is the exact UTF-8 size of persisted payload
  columns. Eviction is deterministic by `created_at`, then `id`, skips pinned
  rows, and rejects atomically if the new row cannot fit. Pin state and quota
  usage are exposed through the existing run/account APIs.
- Account saves, account pin mutations, and anonymous claims serialize on the
  same account scope lock. Claims acquire account then source-session locks in
  one fixed order. Eviction rechecks `pinned_at IS NULL` in the delete and
  aborts if a post-delete quota read is still over cap. Claiming also
  recomputes exact payload bytes after `anonymous` becomes `claimed`.
- Account/history/privacy copy now states the actual storage caps, cookies,
  delivery metadata, account-deletion cascade, Privacy link, and Vercel
  performance-only vitals usage without claiming email is the only PII.
- Additive migration `0013_audit_s1_auth_abuse` adds magic-link delivery fields
  and saved-run quota fields/indexes/checks. The paired down migration restores
  the `0012` shape. Drizzle journal and snapshot metadata are in parity.

## Adversarial evidence

- Fifty stateless bootstrap generations create zero durable session rows.
- Concurrent upgrades of one bootstrap converge on one row; tampered and
  expired bootstraps write none.
- Forty identifier attempts from one IP create only the ten email buckets
  allowed before the source block; a victim attempted after the block retains
  the full email quota from legitimate sources.
- A failed sign-in delivery leaves no usable token, while an injected
  post-delivery bookkeeping failure preserves a usable delivered token. Reset
  provider success, definitive failure, and timeout are recorded as
  `delivered`, `failed`, and `unknown`; neither logs nor the response contain
  the target address.
- Fake-clock evidence proves existing and nonexistent password-reset requests
  settle at the same configured target despite provider delay, and only the
  existing account invokes the sender.
- An injected session-update constraint failure rolls back token consumption;
  removing the fault allows the same token to complete once.
- A synthetic database error containing `victim@example.com` appears in neither
  the JSON response nor captured logs.
- Exact multibyte payload accounting, deterministic tied-timestamp eviction,
  pin preservation, 8 MiB all-pinned rejection rollback, and account quota
  reporting are covered against PGlite.
- Deterministic interleavings prove pin/save and claim/save share the account
  lock, preserve a newly pinned eviction candidate, and finish at the 500-row
  account cap. Claimed rows match the migration/runtime byte expression and
  remove the exact two-byte `anonymous`→`claimed` delta.
- Account deletion cascades through an owned leaderboard row.
- The complete migration chain applies `0013`, backfills exact multibyte payload
  size, enforces the non-negative check, applies the paired down migration, and
  preserves the pre-existing saved row at the restored `0012` shape.

## Gates run

- Exact post-rebase `pnpm --filter @wcdraft/db test`: 4 files, 161/161,
  including the complete `0013` PGlite apply/backfill/constraint/down/row-survival case.
- Focused auth/saved-run/claim regression: 4 files and 73/73. The final affected
  auth file passed 24/24 after the last delivered-status assertion.
- Exact post-rebase web Vitest: 97 files passed, 1 skipped; 1,065 tests passed,
  1 skipped.
- Forced root typecheck: 8/8 tasks, zero cached.
- Forced root lint: 5/5 tasks, zero cached.
- Forced root test: 8/8 tasks, zero cached, in 7m31.143s: core 391/391, data
  168 passed / 9 skipped, DB 161/161, marketing 68/68, web 1,065 passed / 1
  skipped, expanded game-flow PASS, and responsive 204/0 (desktop 84, mobile
  56, interactions 40, mode/setup 24).
- Forced root build: 4/4 tasks, zero cached; Next generated 40/40 pages.
- Full Prettier and `git diff --check`: PASS.

The earlier overlapping responsive invocation was interrupted and is not used
as evidence; the exact post-rebase isolated responsive run above is the gate.
No external email delivery, external database mutation, push, pull request,
merge, deployment, or live verification was run in this lane.

## Protected-CI fix-forward

Protected CI run `29158981632` on frozen head
`dd80e5d4782ac72733f9dc237f07f3a7eadfc519` returned FAIL in the stateless
bootstrap tamper fixture while 1,064 other web tests passed. The fixture changed
the final base64url signature character. Because the 32-byte HMAC encoding has
unused trailing bits, that textual change can decode to the same signature for
some random values; the runtime correctly accepted an effectively unchanged
HMAC. The replacement fixture changes the first signature sextet, where every
bit is significant, and asserts that the serialized token differs before
expecting rejection. No runtime code changed. The failed SHA is not promoted as
evidence; focused/full gates, fresh exact-head review, and protected CI repeat
on the replacement commit.

## Independent-review fix-forward B6-R1

The first independent review of replacement head `3c844ac0` correctly found
that `POST /api/runs` reached bounded body read, JSON parsing, and payload
coercion before checking whether an authenticated account was already at the
8 MiB byte ceiling. That violated the dispatch's explicit cost-firewall
ordering even though the locked store transaction still enforced the final
quota atomically.

The route now applies the existing content-type and declared content-length
checks as a header-only preflight immediately after auth, Origin, and CSRF.
For an authenticated account it then reads quota and returns the existing
`SAVED_RUN_QUOTA_EXCEEDED` 409 response when `usedBytes >= maxBytes`, without
reading the request stream. Only an allowed request reaches the existing
bounded read/JSON/coercion and locked transactional enforcement. Anonymous
saves intentionally skip this account preflight and retain the five-row
eviction policy.

An already-full account cannot distinguish an idempotent duplicate from a new
token without parsing the body. The cost firewall therefore rejects both at
the byte ceiling. This is a narrow behavior change for full accounts and is
safer than introducing a client-provided idempotency key that would need its
own authenticated binding and collision contract. Idempotence below the
ceiling and the transactional race check are unchanged.

Focused regression evidence after the fix-forward:

- Route quota preflight plus bounded-body contract: 2 files, 10/10 tests.
- The full-account route case observed zero body-reader calls and zero store
  save calls before the 409 response.
- The anonymous route case consumed the bounded JSON stream and reached the
  store with `userId: null`; the account quota reader was not called.

The exact fix-forward SHA still requires fresh independent RED re-review and
protected CI. Prior PASS counts do not transfer to the changed head.

## Independent-review fix-forward B6-R2

The independent review of head
`6143463e1eac584cc8bc79df3a14687cab41479a` found that both `POST /api/runs`
and `PATCH /api/runs` called `resolveMutationAuth` before rejecting a mismatched
Origin. With a valid five-minute stateless bootstrap, that resolver can consume
the bootstrap and materialize the durable 30-day session. The later Origin
failure then flowed through `attachFreshSession`, returning the newly created
session and CSRF cookies to a request that had already failed the Origin
boundary.

Both handlers now call `verifyOriginHost` before `resolveMutationAuth`. This
preserves the existing `ORIGIN_MISMATCH` error code, public message, and 401
status, while ensuring the rejected request cannot invoke auth resolution,
consume the bootstrap, create a durable session, read its body, touch the
saved-run store, or emit `Set-Cookie`.

The regression invokes both POST and PATCH with a mismatched Origin and a
request shape that would otherwise pass the CSRF inputs. Each response retains
the existing 401 `ORIGIN_MISMATCH` shape, the mutation resolver is called zero
times, the body reader and relevant store mutation are called zero times, and
the response has no `Set-Cookie` header.

The adjacent mutating runs endpoints were inspected. Claim and DELETE use
`resolveAuth`, not the stateless-bootstrap-upgrading `resolveMutationAuth`, and
therefore do not share this materialization-and-cookie defect. Their ordering
is unchanged to avoid broadening the fix beyond the reviewed failure mode.

Focused replacement-head validation passed: the route Origin/quota and bounded
body suites passed 2 files / 12 tests; `@wcdraft/web` typecheck passed; scoped
ESLint, Prettier, and `git diff --check` passed. No browser, broad root gate,
external database, or email-provider action was run in this fix-forward.

Head `6143463e1eac584cc8bc79df3a14687cab41479a` and any review result tied to it
are invalidated. Focused validation, fresh exact-head RED re-review, and
protected CI must repeat on the replacement commit.

## Risks and required review focus

- Migration `0013` backfills every saved run and creates two indexes. Production
  migration timing and lock behavior must be observed through the controlled
  migration lane before application deploy readiness is claimed.
- The stateless bootstrap is a new auth boundary. Independent review must
  re-execute tamper, expiry, concurrency, replay-after-promotion, and cookie
  attribute tests at the exact commit.
- Saved-run quota enforcement relies on scope-row locking and the existing
  combined outer transaction for anonymous artifact claims. Independent review
  should re-execute the deterministic claim/save and pin/save interleavings and
  challenge the account-before-session lock order for cycles.
- Email provider timeout means delivery outcome can be unknown after the local
  deadline; sign-in tokens are intentionally removed on provider failure,
  while reset rows honestly retain `unknown` for an ambiguous timeout.

## Carryovers

- Fresh-session independent review, exact-SHA re-execution, protected CI,
  production migration/deploy observation, and live verification remain open.
- Browser verification is owned by the separate browser lane and is not claimed
  here.
