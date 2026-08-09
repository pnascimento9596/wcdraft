# Production live-verify (corrected non-writing definition)

Standing constraint for every post-deploy check on `www.wcdraft.com`.

## Standing constraint (in-repo)

“Non-writing” means **no durable user-attributable or product-visible artifact**.
It does not mean that an ordinary anonymous request must be physically incapable
of triggering routine maintenance.

### Forbidden

Production live-verify must never create, delete, consume, or otherwise cause a
change to any of these forbidden-set artifacts:

- leaderboard entries, ranked or casual;
- ranked attempts;
- accounts, magic-link tokens, or email sends;
- durable active sessions (`sessions.expires_at > clock_timestamp()`);
- saved runs; or
- any other durable row attributable to a user or visible on a product surface.

### Explicitly permitted incidental maintenance

The following side effects are permitted because the same work can be triggered
by a single ordinary anonymous visitor request and does not create a durable
user-attributable or product-visible artifact:

- expired-session reaping through the existing session sweep;
- rate-limit counter row creation or increment; and
- stateless CSRF bootstrap cookies with `Max-Age=300`, which expire on their own
  and mint no durable session.

The bootstrap currently emits a 300-second stateless value under the
`wcdraft_sid` cookie name as well as the CSRF/bootstrap cookies. The name alone
does not make it a durable session: `Max-Age=300` plus an unchanged active-session
DB count is permitted; a longer-lived sid or a new active `sessions` row is
forbidden.

### Distinguishing test

For any side effect not listed above, ask: **would a single anonymous visitor
loading the site cause this same write?** If yes, the incidental maintenance is
permitted. If the effect creates or changes a durable, user-attributable, or
product-visible artifact, it is forbidden regardless of what triggered it.
The durable-artifact rule wins when the two clauses appear to conflict. Record
the adjudication and its evidence in the lane report.

Accepting-path coverage (“a valid run inserts a row”) therefore remains
**pre-merge**, on disposable substrate:

| Path                   | Where                                                                                                                                                     | What it proves                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepting write        | Pre-merge CI / local — PGlite-backed `apps/web/lib/leaderboard/__tests__/submit-route.test.ts` (and any guarded ephemeral-Neon exercise of the same path) | A valid submission inserts a row, returns 201, and reports an honest rank                                                                                        |
| Production live-verify | Against `www.wcdraft.com`                                                                                                                                 | SHA-derived health anchors, public reads, stateless CSRF bootstrap, a typed rejected submit, and unchanged forbidden-set counts without creating product residue |

This definition is load-bearing for the merge -> deploy -> live-verify ->
auto-revert safety contract. The `live_verify_xi` row created during PR #340
was forbidden because it was a durable public-board artifact. An expired-session
row reaped by `GET /api/auth/csrf` is permitted maintenance and must not disable
the gate.

## OWNER RATIFICATION

**The corrected definition in this runbook and `STATE.md` — not the original
physical-no-write wording — is what has awaited adoption into the canonical
owner doc set since PR #342.** That ratification is an owner action. Build
agents must not edit the canonical doc set while carrying this lane.

## Rejection probe and bounded rate-limit exposure

**Probe:** cookie-less anonymous `POST /api/leaderboard/submit` with the
committed pre-basis skew fixture
`apps/web/lib/game/__tests__/fixtures/run-token-skew.json` ->
`shipped_pre_basis_t3.token`.

**Expected:** HTTP **409** with wire code **`DIFFERENT_BUILD`**.

This probe shape bounds rate-limit exposure rather than relying on a run-count
cadence. `validateSubmissionCheap` rejects the stale six-anchor conjunction
before `rateLimiter.checkSubmit`, so the probe does not increment the submit
limiter while that locked gate order holds. Before sending the probe, the script
reads the submit route from the target deployment SHA and fails closed if this
order has moved. The script records rate-limit row and event totals as permitted
observations but deliberately does **not** assert that they are unchanged. This
makes concurrent ordinary traffic non-fatal and keeps any future exposure
visible in the receipt.

Do not substitute an accepting current-build token on production. Do not pass
`display_alias` or `display_name`, either of which could become a public artifact
if a future route regression accepted the request.

## Forbidden-set assertion

The script takes direct read-only production-DB snapshots before the first HTTP
request and in an `EXIT` finalizer after the last attempted assertion. It requires
these counts to remain identical:

- `leaderboard_entries`;
- `ranked_attempts`;
- `users` (reported as `accounts`);
- `saved_runs`;
- `magic_link_tokens`; and
- **active, non-expired sessions only:**
  `SELECT count(*) FROM sessions WHERE expires_at > clock_timestamp()`.

It intentionally does not compare total session rows. An expired row may be
deleted by the permitted sweep between snapshots without moving the active
session count. `auth_rate_limits` is outside the forbidden set and is never part
of the equality assertion.

The verifier uses the direct Neon endpoint. If its protected runtime-role input
has Neon's `-pooler` hostname form, the private parser removes only that exact
Neon routing suffix before `psql` starts; the application URL is not changed.
Every SQL call clears startup `PGOPTIONS`, opens `BEGIN READ ONLY`, and applies
the 8-second timeout with transaction-local `SET LOCAL`. Each snapshot also
verifies server-reported Neon project and branch identities against explicit
expected values.

The script accepts the connection string only through
`LIVE_VERIFY_DATABASE_URL`, parses it over stdin into discrete libpq settings
plus a private mode-0600 `PGPASSFILE`, unsets the URI before spawning `psql`, and
also removes inherited `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and
`NEON_API_KEY` values that `psql` does not need. It never places the URI or
password in child-process argv. A first read-only
`SELECT 1` warms the connection with a fixed 10-second libpq connect timeout and
at most three attempts (1-second then 2-second backoff). Only
connection-refused/reset, timeout, and DNS classifications retry; snapshots and
assertions never retry.

Failed streams are copied verbatim into one mode-0600 file under a mode-0700
host directory outside the checkout and receipt directory. Surfaced diagnostics
remain strictly fixed: one of `connection_refused`, `timeout`,
`authentication_failure`, `tls`, `dns`, `permission_denied`, `query_error`, or
`unknown`, plus allowlisted tool/phase/status/retryability fields. On overall
success the retained file and directory are removed. On failure they persist for
operator inspection and the final stderr line is the path only. No agent or
reviewer may print or reproduce the contents; reviewers use simulations and
permission/lifecycle checks. After private inspection, remove exactly the file
and its empty parent as specified in
`docs/runbooks/secret-scan-output-safety.md`.

## How to run

Run from a checkout whose Git object database contains the target deployment
commit. Resolve the production primary branch explicitly. Acquire the existing
least-privilege runtime-role URL from protected operator configuration; a pooled
Neon input is accepted because the verifier privately normalizes it to the
corresponding direct endpoint.

```bash
set -euo pipefail

NEON_PROJECT_ID=rapid-wind-87431051
PRODUCTION_BRANCH_ID="$(
  neonctl branches list --project-id "$NEON_PROJECT_ID" --output json |
    jq -er '[.[] | select(.default == true and .primary == true)] |
      if length == 1 then .[0].id else error("expected one production primary") end'
)"

: "${DATABASE_URL:?load the protected runtime-role DATABASE_URL first}"
LIVE_VERIFY_DATABASE_URL="$DATABASE_URL" \
LIVE_VERIFY_EXPECTED_NEON_PROJECT_ID="$NEON_PROJECT_ID" \
LIVE_VERIFY_EXPECTED_NEON_BRANCH_ID="$PRODUCTION_BRANCH_ID" \
./scripts/live-verify-production.sh "${EXPECTED_DEPLOY_SHA:-}"
```

Pass the expected deployment SHA as the optional positional argument (or as
`EXPECTED_SHA`). If omitted, the script discovers `.build.sha` from live health.
In both cases it resolves that Git commit and derives the expected data anchors
and active leaderboard season from files at that SHA; no production SHA, schema,
engine, season, or data hash is hardcoded in the script.

Do not enable shell tracing (`set -x`) around credential acquisition or this
invocation. The URI assignment is intentionally transient and must never be
copied into a terminal transcript or receipt.

The script then:

1. normalizes the verifier transport to the direct endpoint and warms only that
   connection through a bounded transaction-read-only probe;
2. captures the forbidden-set DB snapshot before any production HTTP request;
3. requires `GET /api/health` to be green, including `auth.status == "ready"`,
   and requires the build SHA, six published anchors, and season to match the
   target Git commit;
4. requires cookie-less `GET /api/auth/csrf` to return 200 with all three
   300-second bootstrap cookies and no durable session;
5. snapshots current Classic casual, Memory casual, Classic ranked, and the
   archived `season-2026-manager-attrition` board;
6. posts the stale-token rejection probe and requires typed
   `409 DIFFERENT_BUILD`;
7. re-reads the same boards and requires identical entry-ID sets;
8. checks the leaderboard archive surface and read-only OG health; and
9. always captures an after snapshot, requiring the forbidden counts to be
   identical while treating expired-session and rate-limit deltas as permitted
   observations.

Exit is non-zero on any failed assertion. After a new code deploy, follow the
Red auto-revert path for a genuine live failure. For the pre-merge retroactive
check of an already-shipped build, follow the dispatch-specific stop rule rather
than reflexively reverting unrelated safety work.

## What this does **not** cover

- Accepting insert, rank computation, claim, or ranked-attempt consumption —
  those remain pre-merge tests.
- Neon restore / Vercel rollback mechanics — see
  `neon-restore-vercel-rollback.md`.
- Schema or migration failures — see `prod-migration-failure.md`.
