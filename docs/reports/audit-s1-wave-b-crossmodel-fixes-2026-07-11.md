# Audit S1 Wave B cross-model fix-forward

Date: 2026-07-11

Risk: RED — auth and operator migration controls

Base: `890db10e32462473778778d2b1d4dedc9feb4d29`

Branch: `ws-f4/audit-s1-wave-b-review-fixes`

## Review provenance

The Wave B boundary review used the owner's Ollama Cloud subscription through
OpenCode: `ollama-cloud/glm-5.2`, variant/max thinking. It did not use the
OpenCode Go subscription. The verbatim FAIL transcript is retained outside the
repository at `/tmp/audit-s1-crossmodel-wave-b.md`; its review packet is
`/tmp/audit-s1-wave-b-review-packet.md`.

## Findings and closure

1. **Stale migration operator truth.** `STATE.md` still described 12 migrations
   through 0011, while the journal and production were at 14 through 0013. The
   production-migration workflow input default and failure-runbook example also
   named 0012. The binding attestations/defaults now name the verified 14-entry
   tail `0013_audit_s1_auth_abuse`. Historical 0012 release receipts remain
   historical. Runtime exact-main and exact-tail enforcement is unchanged.
2. **No distinct-identifier-per-IP magic-link cap.** Magic-link requests now
   allow at most five distinct normalized identifiers per hashed IP per hour,
   below the existing ten-request/hour coarse IP limit. The existing
   `auth_rate_limits` table is reused without schema movement. A hashed per-IP
   counter row is created and locked `FOR UPDATE` inside the caller's transaction
   before a hashed IP+identifier marker is inserted. Only the first marker
   increments the locked counter. This statement ordering is deliberate for
   PostgreSQL READ COMMITTED: an `ON CONFLICT` waiter gets a fresh snapshot before
   locking/reading the counter, avoiding a stale-snapshot allowed result. Tests
   cover repeat requests, sixth-distinct rejection, concurrent same-pair
   count-once, and two concurrent first requests for the same sixth identifier;
   both reject and the durable count is exactly six. Raw email and IP values are
   not stored.
3. **Password victim-quota poisoning.** Password login previously consumed the
   identifier bucket before the IP bucket in separate calls. Both checks now run
   in one transaction, with coarse IP first and an immediate return on block, so
   a blocked source cannot consume the victim identifier allowance. Credential
   and rate-limit responses otherwise remain unchanged.
4. **Verify POST parsed before Origin validation.** The route now invokes the
   shared `verifyOriginHost` before constructing runtime dependencies or calling
   `formData`. A route regression proves a hostile Origin does not parse the
   body, construct dependencies, call token/session consumption, or attach a
   cookie.

## Validation

- Focused auth/PGlite and verify-route suites: 4 files, 40/40 tests.
- DB package: 4 files, 161/161 tests.
- Final direct web Vitest: 99 files passed, 1 expected skip; 1,074 passed,
  1 expected skip.
- Final forced monorepo typecheck: 8/8 tasks, 0 cached.
- Final forced monorepo lint: 5/5 tasks, 0 cached.
- Final forced monorepo build: 4/4 tasks, 0 cached; Next.js generated 40/40 pages.
- Game-flow Playwright: PASS.
- Responsive browser harness: 204 metrics / 0 failures (84 desktop, 56 mobile,
  40 interaction targets, 24 mode/setup).
- Canonical generated-data materialization produced zero tracked fingerprint
  diff.
- Prettier and `git diff --check`: PASS. Local `actionlint` was unavailable;
  the executable workflow contract passed under Node 22 and protected CI remains
  authoritative for the static workflow lane.

Two initial invocations were setup-only failures and are not counted as product
evidence: focused Vitest ran before workspace package outputs existed (zero test
bodies), and direct `vitest run` initially bypassed generated raw-data
materialization (860 tests passed while 18 suites failed import). After package
build/materialization, the canonical commands above passed.

The initial protected-CI static job at head
`fe4ac21bdf68c5e0b3eb8c34c2196c916abc4d89` then failed honestly because the
production-migration shell contract still required the old 0012 literal in the
runbook. The operator files were already correct at 0013; the companion fixture
was stale. The fix-forward keeps the 0012 classifier scenarios as generic
historical inputs, derives the current tag from the committed journal, extracts
the workflow input default, requires those values to match exactly, and checks
the runbook dispatch argument against the same derived tail. The failed CI head
is not release evidence. The exact failing shell contract now passes under Node
22.22.3, Bash syntax passes, the affected focused auth suites remain 40/40, and
exact replacement-head CI is mandatory.

## Risk and handoff

The distinct-cap helper requires a transaction because the per-IP row lock must
span marker insertion and counter increment; both magic-link call sites share the
transactional quota helper. The change adds rows but no schema. Rate-limit lazy
sweep already removes expired windows. Independent exact-head RED review,
protected PR CI, SHA-pinned merge, deployment observation, production live
verification, and Wave B cross-model re-review are mandatory after this
implementation PR; this lane does not merge, deploy, send email, or access an
external database.
