# Neon credential transport hardening — Unit B (2026-08-08)

## Outcome

**CANDIDATE PASS — not merged or shipped yet.** Against fetched production base
`799535fd662bbd90891dc2a0d4a50ecb8e10f83d`, the two proven command-line
credential exposures are removed without changing the Neon branch guard or the
production live-verification assertions:

- the live verifier no longer supplies a credential-bearing URI to `psql`;
- the Neon restore runbook no longer expands the Neon API key into `curl` argv;
- both external-tool failure paths withhold raw provider diagnostics; and
- simulated failures containing complete credential-shaped diagnostics emit no
  URI, password, API key, endpoint, or credential fragment.

At `2026-08-09T02:11Z`, the candidate verifier also passed against the live
production branch and deployed SHA using the actual current URI shape. That was
an additional pre-merge compatibility proof, not a substitute for the mandatory
post-merge live verification.

This unit changes no schema, migration, engine, rating, RNG, draft, simulation,
codec, runtime-data artifact, leaderboard semantics, or production credential.
Unit A must not begin until this unit has passed independent review, merged, and
deployed.

## External-process credential audit

| Site                                                                                                                                                                | Secret/process boundary before this change                                                                                                                                                                                                                                    | Adjudication                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/live-verify-production.sh:54-171`                                                                                                                          | `LIVE_VERIFY_DATABASE_URL` was expanded as the first `psql` argv value. A failed client could reflect the URI in task output.                                                                                                                                                 | **Proven defect; fixed.** The URI is parsed over Python stdin, removed from the environment, and split into non-secret libpq variables plus a private mode-0600 `PGPASSFILE`. `psql` receives no connection-string argv. Both stdout and stderr are captured and discarded on failure, followed by a constant diagnostic. |
| `docs/runbooks/production-live-verify.md:124-145`                                                                                                                   | `neonctl` receives only the non-secret branch/project identifiers in argv. Its connection URI stdout is captured directly into the verifier environment; the value is not an argument. The Neon API key, when configured for `neonctl`, is an environment credential.         | **Sound; catalogued.** No refactor. The runbook now documents the transient handoff, private password file, cleanup, and no-`set -x` requirement.                                                                                                                                                                         |
| `docs/runbooks/neon-restore-vercel-rollback.md:170-229,394-499,659-692`                                                                                             | Five Neon API calls expanded `Authorization: Bearer $NEON_API_KEY` into `curl` argv, readable by same-host process inspection.                                                                                                                                                | **Proven defect; fixed.** A private mode-0600 curl config carries the header; the shell unsets `NEON_API_KEY` before spawning curl. Only the config path appears in argv. A failed response body and stderr are captured, erased, and replaced by a constant failure message.                                             |
| `.github/workflows/production-db-migrate.yml:132-204`                                                                                                               | GitHub supplies `NEON_API_KEY` as a step environment secret. Embedded Node reads it from `process.env` and uses in-process `fetch`; the returned URI is masked and written to a mode-0600 protected file.                                                                     | **Sound; catalogued.** No secret is passed in argv, outputs, or the job summary.                                                                                                                                                                                                                                          |
| `.github/workflows/production-db-migrate.yml:206-295`                                                                                                               | The mode-0600 direct URL is loaded into `DATABASE_URL_UNPOOLED` for `pnpm` migration/status processes. Their complete output is redirected to protected receipts; failure surfaces a constant message, and the final step removes the URL and receipts.                       | **Sound; catalogued.** Environment transport is intentional and no secret-bearing command argument is constructed.                                                                                                                                                                                                        |
| `.github/workflows/ci.yml:642-770` and `packages/db/scripts/neon-branch-create.ts:21-200`                                                                           | GitHub injects the Neon API key as step environment state. Branch lifecycle uses in-process `fetch`; generated pooled/unpooled URLs go only to a mode-0600 env file, which later child processes receive through environment variables. Top-level failure output is constant. | **Sound; catalogued.** Branch ID/project ID outputs are non-secret.                                                                                                                                                                                                                                                       |
| `packages/db/src/client.ts:60-94`, `packages/db/scripts/migrate.ts:14-56`, `packages/db/scripts/migrate-status.ts:52-95`, and `packages/db/drizzle.config.ts:13-18` | Runtime, status, migration, and Drizzle configuration read the connection URL from `process.env` and give it directly to the in-process Neon/Drizzle client.                                                                                                                  | **Sound; catalogued.** No external database client argv exists. Protected errors do not print driver diagnostics.                                                                                                                                                                                                         |
| `packages/db/scripts/neon-branch-guard.ts:197-255`, `packages/db/scripts/neon-branch-delete.ts:19-100`, and `packages/db/scripts/verify-neon-branch.ts:7-14`        | The API key is read from environment and used by in-process `fetch`/`node:https`; identifiers alone appear in logs. Top-level handlers suppress protected diagnostics.                                                                                                        | **Sound; catalogued.** The #346 identity guard is unchanged.                                                                                                                                                                                                                                                              |
| `packages/db/package.json:28`                                                                                                                                       | `drizzle-kit generate` is an external CLI, but this repository's generation command is offline and the config only reads a URL if a DB-touching Drizzle command is deliberately used.                                                                                         | **Sound; catalogued.** No connection string is interpolated into the package script argv.                                                                                                                                                                                                                                 |
| Repository-wide executable and workflow search                                                                                                                      | No other executable `psql`, `pg_dump`, `pg_restore`, `neonctl --api-key`, `curl` bearer expansion, or connection-URI command argument was found.                                                                                                                              | **No additional proven case.** Documentation references and synthetic test fixtures were classified separately rather than rewritten.                                                                                                                                                                                     |

## Implementation details

### `psql`

The live verifier's existing `LIVE_VERIFY_DATABASE_URL` interface remains for
operator compatibility. Internally it now:

1. feeds the value over stdin to a constant-error URI parser;
2. accepts only PostgreSQL URI schemes, a complete host/user/password/database,
   and Neon's relevant `sslmode`/`channel_binding` parameters;
3. writes discrete parser outputs and a correctly escaped mode-0600 password
   file under a private `/tmp/wcdraft-live-verify-db.*` directory;
4. unsets the URI and competing libpq password/service variables;
5. calls `psql` with `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, TLS variables,
   and `PGPASSFILE`, while retaining the pre-existing read-only and timeout
   `PGOPTIONS`; and
6. erases all private files on normal exit and through the existing live-gate
   finalizer.

The SQL remains the same and the server-reported project/branch identity
comparison is untouched.

### Neon API `curl`

The DR runbook prepares one private curl config containing the authorization
header, immediately unsets the API-key variable, and routes all five Neon API
calls through `neon_api_curl`. URLs, restore payloads, operation polling,
preserved-branch identity checks, application/DB ordering, and mutation guards
are unchanged. The config and captured command output are outside the incident
receipt directory and are removed on exit. Successful JSON response bodies
continue to reach the caller's existing receipt redirections unchanged.

## Validation run

- `bash -n` on the live verifier and both changed shell contracts: **3/3
  passed**.
- `scripts/ci/live-verify-production.test.sh`: **PASS**. Proved the URI is unset
  before the mock `psql`, the password file is mode 0600, argv contains no URI
  or password, simulated credential-bearing stdout/stderr is absent from surfaced
  output, cleanup removes the private directory, an expired-session reap remains
  permitted, and forbidden-count movement remains rejected.
- `scripts/ci/neon-vercel-recovery-runbook.test.sh`: **PASS**. Proved the curl
  config is mode 0600, the API key is unset before the mock curl, simulated
  credential-bearing response and stderr are absent from argv/output, all **68** existing
  negative mutation cases remain fail-closed, all **6** route orderings remain
  locked, and the CI registration remains present.
- Candidate pre-merge live verification: **PASS** against project
  `rapid-wind-87431051`, production branch `br-blue-heart-aqcejtyf`, and deploy
  `799535fd662bbd90891dc2a0d4a50ecb8e10f83d`. Health returned
  `db.status=ready` and `auth.status=ready`; **4/4** boards retained identical ID
  sets; the rejection stayed typed `409 DIFFERENT_BUILD`; OG health passed; and
  all **6** forbidden counts were unchanged. Before/after counts were entries 4,
  attempts 0, accounts 6, saved runs 317, magic links 18, active sessions 44.
- `TURBO_FORCE=1 pnpm typecheck`: **PASS, 9/9 tasks, 0 cached**.
- `TURBO_FORCE=1 pnpm lint`: **PASS, 6/6 tasks, 0 cached**.
- `TURBO_FORCE=1 pnpm build`: **PASS, 5/5 tasks, 0 cached**. The web
  production build generated **40/40** pages and passed both runtime traces
  (**8/8** requests each) for `/api/og/sign` and `/api/challenge/verify`.
- `TURBO_FORCE=1 pnpm test`: **NOT GREEN after two bounded attempts**. The
  first attempt reached **8/9** Turbo tasks and then observed one intermittent
  pre-existing Axe `document-title` finding in the daily-spin desktop matrix;
  every other rendered case was clean. The exact case passed once and failed
  once when replayed, while 50 direct server responses and a direct browser
  inspection all contained the expected title. The sole full-envelope rerun
  stopped earlier on a different pre-existing five-second timing limit in
  `marketing/x` (`run-from-token`, 5.73 seconds); that package had passed
  **69/69** on the first attempt, and the exact file then passed **8/8** in
  1.72 seconds in isolation. No application or UI source differs from the
  fetched base, and no orphaned test process remained. These observations do
  not waive the root test gate: protected CI and the fresh-session reviewer
  must independently re-execute it successfully before merge.
- `git diff --check`: **PASS**.

Protected CI, fresh-session review, cross-model review, merge/deploy
observation, and mandatory post-merge live verification remain pending at this
candidate stage.

## Architect-delegated decisions

**Use `PGPASSFILE`, not `PGPASSWORD`.** The dispatch permits standard environment
or service-file transport, but `PGPASSWORD` can itself be exposed through
same-host environment inspection on some operating systems. A private password
file plus discrete libpq environment fields is PostgreSQL's documented safer
mechanism and preserves every query, timeout, TLS requirement, and branch guard.

**Use a private curl config for the Neon API key.** Keeping the existing bearer
header semantics while moving only the credential source is the smallest
behavior-preserving repair. Passing the key as a general environment variable to
curl would expose it to the whole child environment; the config scopes it to the
single client invocation and leaves only a non-secret path in argv.

**Withhold raw provider diagnostics instead of regex-redacting them.** Credential
formats and provider error wording can change, and a partial endpoint/password
fragment is enough to recreate this defect class. Constant error messages plus
exit status preserve operator control flow without making a token-shape regex a
security boundary. Protected command output remains available only inside the
private transient location until it is erased.

**Harden the API-key argv site although Unit 0 did not find an API-key leak.**
Exposure evidence and transport safety are separate questions. The runbook was
a proven recurring same-host argv exposure whenever used, so leaving it in place
would violate Unit B even though the #347 incident involved only the database
role credential.

## Risks and rollback

- The URI parser deliberately fails closed on connection parameters other than
  `sslmode` and `channel_binding`. The actual production Neon URI passed the
  candidate live run. A future Neon URI shape change will produce only a
  constant configuration error until deliberately supported.
- An uncatchable `SIGKILL` can leave a mode-0600 private file in `/tmp`; normal
  success and error shell exits remove it. No credential file is stored in a
  receipt or repository.
- Code rollback is an ordinary revert of Unit B until Unit A begins. Once Unit A
  step 5 begins, credential rollback—not Git revert—is the only availability
  recovery path, per dispatch.
