# Production verifier incident — 2026-08-09

Status: **CLOSED.** The incident opened at `2026-08-09T07:53:04Z` is closed
with two complete verifier passes from independently confirmed-suspended
production computes. Both passed the connection phase on attempt 1, every HTTP
and database assertion passed single-shot, and every forbidden count was
identical before and after each run.

## Summary

The verifier was passing libpq `options` containing
`default_transaction_read_only=on` and `statement_timeout=8000` through Neon's
pooled endpoint. The retained private provider stream from a valid cold
reproduction identified the failure as the pooler rejecting that startup
parameter. The same runtime-role credential and the same startup options passed
from a confirmed-cold direct endpoint and reported both settings active. This
confirms the pooler hypothesis; it was not an application, credential, query,
or production-data failure.

The verifier now derives Neon's direct endpoint from an exact `-pooler` host
suffix before launching `psql` and establishes `BEGIN READ ONLY` plus a
transaction-local statement timeout after connecting. Read-only enforcement is
therefore preserved without asking the transaction pooler to forward an
unsupported startup parameter. The production application's pooled connection
is unchanged.

This report reconciles the final verifier disposition. The credential cutover,
role grants, owner reset, branch-by-branch neutralization, and exposure record
remain authoritative in
[`neon-credential-rotation-2026-08-09.md`](./neon-credential-rotation-2026-08-09.md).
The underlying read-only branch identity and snapshot comparisons remain in
[`neon-branch-targeting-guardrail-2026-08-08.md`](./neon-branch-targeting-guardrail-2026-08-08.md).

## Unit A — private diagnostic retention

Surfaced output and retained diagnostics are separate channels:

- Surfaced failures still contain only allowlisted namespace, tool, phase,
  exit status, category, retryability, and fixed diagnostic token. Provider
  stdout/stderr never enters a transcript, committed file, PR body, report, or
  reviewer receipt.
- On first use, raw `psql` stdout and stderr are appended verbatim to a
  mode-`0600` file inside a mode-`0700` host directory under `/tmp`, outside the
  repository. The script prints only the retained file path.
- A successful verifier removes the exact retained file and directory it
  created. A failed verifier leaves them for private operator inspection. The
  operator cleanup command and lifecycle are documented in
  [`secret-scan-output-safety.md`](../runbooks/secret-scan-output-safety.md).
- Reviewers are expressly prohibited from opening or reproducing retained
  diagnostic contents. They review the renderer, permissions, lifecycle, and
  simulated secret-bearing tests instead.

The focused regression injects credential-shaped stdout and stderr. It proves
that surfaced output contains none of those shapes; the private file contains
both streams verbatim; its file and parent modes are `0600` and `0700`; the
announcement is path-only; failure retains the file; and success removes its
private diagnostic path.

One valid failed reproduction remains deliberately retained for operator
inspection at:

`/tmp/wcdraft-live-verify-diagnostics.fhqQWk/psql-failures.log`

Its file mode is `0600` and its parent mode is `0700`. This report does not
reproduce its contents. All successful comparison and full-verifier runs
removed their own diagnostic paths.

## Unit B — pooler hypothesis and root cause

### Connection mechanism before the fix

The verifier used libpq's `PGOPTIONS` environment variable, specifically
startup `options` for `default_transaction_read_only=on` and an 8-second
statement timeout. This is a connection-startup mechanism, not a post-connect
`SET`. Its target was the runtime role's pooled Neon endpoint.

### Cold comparison

| Probe                                       | Confirmed state                                                          | Endpoint | Result                               | Private classification                           |
| ------------------------------------------- | ------------------------------------------------------------------------ | -------- | ------------------------------------ | ------------------------------------------------ |
| Historical pooled mechanism                 | Suspended at `2026-08-09T19:19:17Z`; fresh activity began at `19:22:14Z` | Pooled   | `psql` exit 2 on first SQL operation | `query_error`; pooler rejected startup `options` |
| Same credential and same historical options | Suspended again at `2026-08-09T19:27:17Z`                                | Direct   | Passed                               | Read-only `on`; statement timeout `8s`           |

The actual retained error says that the pooler rejected the `options` startup
parameter. That is its classification and operational meaning. A direct quote
is intentionally omitted because the provider line also contains endpoint
material; the inspection found zero exact password matches and one endpoint
match. The fixed surfaced renderer exposed none of it.

An initial harness attempt paired the newly direct-only password-file entry
with an intentionally overwritten pooled host and therefore produced a local
password-file lookup mismatch. That diagnostic path was privately inspected
and removed. It is not counted as product evidence. The valid pooled
reproduction corrected the password-file host before the cold attempt and is
the retained evidence described above.

### Fix

`prepare_psql_credentials` now removes only an exact `-pooler` suffix from the
first DNS label of a Neon hostname. It passes discrete libpq fields and a
private `PGPASSFILE`, clears inherited database/API credential variables, and
launches `psql` with an explicitly empty `PGOPTIONS`. Each read executes inside
`BEGIN READ ONLY`, applies `SET LOCAL statement_timeout = '8s'`, executes the
query, and commits. The application continues to use the transaction pooler;
only this snapshot-counting verifier selects direct connectivity.

## Unit C — two cold production gates

Both runs targeted `https://www.wcdraft.com` and exact production build
`1f89c6fc7db6751924397b157e6ef11e3c21b76f`. The production compute was queried
through Neon control-plane state and confirmed suspended before each run. No
manual warm-up request preceded either verifier.

| Evidence            | Cold run 1                                                     | Cold run 2             |
| ------------------- | -------------------------------------------------------------- | ---------------------- |
| Confirmed suspended | `2026-08-09T19:32:47Z`                                         | `2026-08-09T19:40:32Z` |
| Verifier interval   | `19:34:35Z–19:34:41Z`                                          | `19:40:53Z–19:40:58Z`  |
| Connection warm-up  | attempt `1/3`                                                  | attempt `1/3`          |
| Exit                | 0                                                              | 0                      |
| Database identity   | project `rapid-wind-87431051`, branch `br-blue-heart-aqcejtyf` | same                   |
| Accounts            | 6 → 6                                                          | 6 → 6                  |
| Active sessions     | 42 → 42                                                        | 42 → 42                |
| Leaderboard entries | 4 → 4                                                          | 4 → 4                  |
| Magic-link tokens   | 18 → 18                                                        | 18 → 18                |
| Ranked attempts     | 0 → 0                                                          | 0 → 0                  |
| Saved runs          | 317 → 317                                                      | 317 → 317              |

Every assertion passed in both runs:

- health returned the exact full SHA, `db.status=ready`, and
  `auth.status=ready`;
- the six run-token anchors matched Git-derived source: schema
  `runtime-data-2.11.0`, dataset `2026-07-01`, historical rating
  `wc-perf-6.6.0`, engine `engine-2026.07.18-basis-aware-tiering`, ruleset
  `ruleset-2026.06.04`, and draft-pool hash; projected rating
  `proj-career-5.6.0` was independently matched too;
- active season was `season-2026-squad-depth`;
- cookie-less CSRF returned 200 with exactly `wcdraft_bootstrap`,
  `wcdraft_sid`, and `wcdraft_csrf`, each at `Max-Age=300`, with no durable
  session;
- classic casual, hidden casual, classic ranked, and archived classic board
  payload ID sets were unchanged; all four were empty in both snapshots;
- archived season `season-2026-manager-attrition` remained API-readable;
- a deliberately stale submission returned typed `409 DIFFERENT_BUILD` with
  the three expected mismatched anchors (`schema_version`, `engine_version`,
  `data_bundle_hash`);
- OG health returned `ok=true`; and
- the complete six-table forbidden set remained byte-equivalent by sorted JSON
  counts before and after each run.

Permitted observations were also recorded rather than hidden. Expired sessions
changed 3 → 1 in run 1 and 1 → 1 in run 2; rate-limit state remained 66 rows and
72 events in both before/after pairs. These are excluded from the forbidden
set by contract and do not alter the verdict.

**Closure statement:** the production-verifier incident opened at
`2026-08-09T07:53:04Z` is **CLOSED with evidence**. The two independently cold
runs passed all connection and assertion gates with unchanged forbidden
snapshots.

## Unit D — repository reconciliation

- Credential rotation is complete. Production uses least-privilege runtime
  role `wcdraft_runtime_20260809`; the retained production owner credential was
  reset and remains reserved for the owner/migration workflow.
- Live control-plane retrieval confirms that production and both retained
  snapshots have branch-specific current owner credentials. Pairwise password
  and endpoint comparisons were distinct without surfacing their values.
- Snapshot branches `br-autumn-hill-aqswkxii` and
  `br-dark-math-aqyfztzk` remain independently reset and retained. This lane
  neither deleted nor mutated them.
- The historical cold reproduction at approximately `15:30Z` remains part of
  the incident sequence. Neon activity records show suspension at
  `15:29:16Z`, fresh compute activity at `15:30:02Z`, and suspension again at
  `15:35:16Z`.
- The formerly opaque failure is now attributed to the pooled endpoint's
  rejection of startup `options`. Direct verifier connectivity plus
  transaction-scoped read-only enforcement fixes it without weakening the
  branch guard, live assertions, surfaced-output policy, or read-only safety.
- Canonical owner documents were not edited. Ratification remains an explicit
  owner action.

## Files

- `scripts/live-verify-production.sh`
- `scripts/ci/live-verify-production.test.sh`
- `docs/runbooks/production-live-verify.md`
- `docs/runbooks/secret-scan-output-safety.md`
- `docs/reports/production-verifier-incident-2026-08-09.md`
- `STATE.md`

## Validation run

- `shellcheck -x -e SC2034 scripts/live-verify-production.sh scripts/ci/live-verify-production.test.sh scripts/ci/external-tool-diagnostics.sh`
- `bash scripts/ci/live-verify-production.test.sh`
- `bash scripts/ci/neon-vercel-recovery-runbook.test.sh` — 68 negative mutation
  cases, four vendor sinks, and six route orderings passed
- `pnpm exec prettier --check docs/runbooks/production-live-verify.md docs/runbooks/secret-scan-output-safety.md docs/reports/production-verifier-incident-2026-08-09.md STATE.md`
- `pnpm typecheck` — 9/9 tasks
- `pnpm lint` — 6/6 tasks
- `pnpm test` — 9/9 tasks; core 429, database 152, data 162 passed/9
  skipped, marketing 69, mobile 7, and web 1,454 passed/1 skipped;
  responsive-shell 218/0, collision 288/0, and one-screen-fit 216/0
- `pnpm build` — 5/5 tasks; 40/40 static pages and both runtime-data traces
  8/8
- protected staged-diff gitleaks scan — six files, zero findings; scanner output
  suppressed and only count/classification surfaced
- Two full cold production verifier runs, with exact results in Unit C

## Not run and why

- Core/data/leaderboard golden suites: no core logic, compact data,
  leaderboard validation, schema, rating, simulation, or engine code changed.
- ETL and heavy realism: no ETL, data artifact, engine, or CI configuration
  changed.
- Migration/constraint validation: explicitly out of scope; no migration or
  ranked-binding `VALIDATE` was performed.

## Architect-delegated decisions

### Normalize only the verifier's Neon pooler hostname

The least-behavior-changing correction is to remove an exact `-pooler` suffix
only for this read-only snapshot verifier. Pointing the application at direct
connectivity would widen scope and discard useful production pooling. Accepting
arbitrary host rewriting would be unsafe. The narrow normalization matches
Neon's endpoint convention while retaining every database identity assertion.

### Enforce read-only after connection

Removing the rejected startup option without a replacement would weaken a
non-negotiable safety property. An explicit `BEGIN READ ONLY` and transaction-
local timeout are server-enforced on the same handle as each verifier query and
are compatible with both direct PostgreSQL and transaction pooling. This is
preferable to any client-only claim of read-only intent.

### Preserve the existing bounded warm-up envelope

The phrase “one bounded retry of the connection phase” was reconciled with the
explicit “per the #350 warm-up design” by preserving #350's existing maximum of
three attempts (initial attempt plus a bounded connection-only retry phase).
Changing retry cardinality would be unrelated behavior change. Assertions
remain single-shot, and both decisive cold runs passed on attempt 1.

### Do not quote provider prose containing endpoint material

The retained error was sufficient to classify and explain the cause, but its
line contained endpoint material. The dispatch permits a quote only when the
text is confirmed free of credential, host, and endpoint material. The report
therefore records the exact category and meaning, not a fragment that would
violate the surfaced-output boundary.

### Discard the invalid first harness setup from adjudication

The first diagnostic experiment mixed a direct-host password-file entry with a
pooled `PGHOST`, making libpq correctly report missing matching credentials.
That was a test-harness mismatch, not production behavior. It was privately
classified, its diagnostic path was cleaned, and the valid pooled replay was
rerun only after the password-file host matched its endpoint. Reporting both
prevents a convenient but false root-cause claim.

## Risks and carryovers

- A verifier failure intentionally leaves a sensitive private diagnostic file
  on the host until an authorized operator inspects and removes it. Mode and
  location reduce exposure; prompt lifecycle cleanup remains operationally
  important.
- Direct connectivity is correct for a snapshot-counting gate but bypasses
  PgBouncer's connection smoothing. The bounded connection warm-up remains the
  resilience mechanism for scale-to-zero.
- Vercel does not expose sensitive environment values for equality read-back.
  Current runtime-role use is established by controlled writes, health and
  privilege behavior, old-owner rejection, and current control-plane access,
  as detailed in the rotation report.

## HUMAN ACTIONS

The following owner actions remain open and were not changed by this incident
lane:

1. Decide disposition for `wow`.
2. Decide disposition for `testt`.
3. Decide disposition for `team3`.
4. Decide disposition for `redacted@example.invalid`.
5. Decide the historical chezwizz ranked-attempt binding; the poison session
   and row remain retained.
6. Decide retention/deletion timing for Neon snapshots
   `br-autumn-hill-aqswkxii` and `br-dark-math-aqyfztzk`.
7. Ratify the incident, credential-rotation, and secret-scan policy in the
   canonical owner documents.
