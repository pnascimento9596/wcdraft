# Neon credential rotation and exposure record — 2026-08-09

## Outcome

The exposed database-role credential has been rotated and is rejected by every
branch that exists in Neon project `rapid-wind-87431051`. Production now uses a
dedicated least-privilege runtime role; the retained owner role has a different
password and remains available for the existing migration workflow. Both
production-derived snapshot branches received independent owner-password
resets and were not deleted.

Unit B merged first as PR
[#348](https://github.com/pnascimento9596/wcdraft/pull/348) at
`2026-08-09T04:15:33Z`, merge SHA
`c671755b2296e021c5f58148d5e12e0ff0ceeb5d`. Unit A did not mutate a Neon role
or consumer credential until the merged Unit B deployment passed the corrected
live verifier. The final post-revocation verifier passed against that exact
build with database and authentication ready, all four board reads stable, the
typed `409 DIFFERENT_BUILD` assertion intact, OG health passing, and all six
forbidden-set counts unchanged.

Path 1 (create a new role, cut over new-first, revoke old last) was available
and used. The mechanism made a no-outage cutover possible, but the first
cutover attempt omitted the runtime health check's read privilege on
`drizzle.__drizzle_migrations`. Production returned 503 from
`2026-08-09T04:43:09.314Z` until recovery at
`2026-08-09T04:45:04.926Z`, between 1 minute 55 seconds and 1 minute 56 seconds
at the monitor's sampling precision. This was an actual availability defect and
is not described as zero downtime. The exposed
password was still valid throughout that incident, every consumer was rolled
back, the missing privilege was fixed and re-proved on a new non-production
branch, and only the second fully verified cutover proceeded to revocation.

No schema, migration, engine, RNG, rating, draft, simulation, codec,
runtime-data artifact, or leaderboard semantic changed. No deliberate
production-row mutation was made; the non-writing verifier retained its narrow
incidental-maintenance allowance, and its before/after forbidden counts were
identical. The intended production database changes were role/grant/password
operations and termination of one residual idle owner-role backend after
reset.

## Unit 0 — secret-scope assessment

Two secrets were assessed separately.

| Secret                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Disposition                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database role credential | **Proven exposed.** The same production `neondb_owner` password appeared in two private Codex task outputs. The first occurrence was in session `019fe367-eddd-7551-ac6f-10a544880d04` at `2026-08-08T23:00:18.152Z`; the second was in session `019fe426-f117-7bf3-b84d-006bd910cad9` at `2026-08-09T01:49:20.875Z`. Each was a failed JSON-parsing path after `neonctl connection-string --output json` returned a plaintext URI; neither reached `psql` or established a database connection. A later discarded reviewer reserialized the same already-revoked value six times into one private transient run log while broadly searching the original session. | Rotated unconditionally in production and both production-derived snapshots. Existing authenticated owner sessions were checked; one idle PgBouncer backend was terminated exactly, leaving zero idle owner-role pooler backends. The secret-bearing reviewer log was detected, stopped, and deleted. |
| Neon API key             | **Ruled out for the two incidents and every retained surface checked.** Exact-key scans returned zero occurrences in the checked implementer/reviewer sessions, reachable Git objects, PR #347/#348 bodies and discussions, retained receipts, and available CI logs.                                                                                                                                                                                                                                                                                                                                                                                              | Not rotated. Rotating the broader control-plane credential without evidence would have expanded availability risk and was outside the least-change response.                                                                                                                                          |

The database-role value is not reproduced here, in a PR body, in a receipt, or
in any committed file. The second task-output exposure was caused during this
lane by an operator command that assumed JSON output from the installed Neon
CLI; it is included in scope rather than omitted as an implementation
embarrassment.

### Additional lane incident — discarded reviewer log

During a discarded exact-head review, the reviewer used a broad text search
over the original JSONL task session. Because a matching JSONL record is one
long line, that search copied the already-revoked owner password into the
reviewer's private mode-0600 run log six times. An exact-value scan detected
the copies before the log was surfaced or persisted as a review receipt. The
review was stopped; the log and three reviewer-private credential directories
were removed by exact path at `2026-08-09T06:06:21Z` and are not recoverable
through this lane. The discarded review produced no verdict used by this PR.

This was not a new live-credential compromise: fresh probes had already proved
the value rejected by production and both snapshots, and the temporary proof
branch had been deleted. It was still a failure to contain revoked secret
material and is recorded as such. Final reviewer instructions prohibit raw
session-line output and permit only in-process Boolean/count results for secret
scope checks.

### Additional lane incident — runner registration tokens

At `2026-08-09T05:13:03Z`, after the database rotation, a runner-state
diagnostic printed full process command lines for two idle wcdraft runner
containers into the same private task output. Those command lines contained
two distinct repository-scoped GitHub Actions **registration tokens**. No
GitHub OAuth/PAT, repository secret, Neon API key, or database credential was
part of that output.

The affected runners were created at `04:35:43Z` and `04:37:11Z`. GitHub
documents that registration tokens expire after one hour; the later token's
maximum validity therefore ended at approximately `05:37:11Z`. GitHub exposes
no per-token revocation operation. The response was to stop the idle fleet,
terminate the two untracked direct supervisors that initially recreated the
containers, remove every `wcdraft-linux-*` container, and verify zero online
wcdraft runners at `05:18:17Z`. Colima remained up. No new CI may start before
the later token's expiry and a fresh zero-online-runner check.

The two token values occur only in the private task session's duplicated tool
records. An exact-value scan across 151 report, PR/CI-download, live-verifier,
reviewer, and monitor files found zero other hits. This incident also exposed
an on-demand-discipline defect: the two Unit B runner supervisors had remained
idle after main CI instead of being stopped immediately. Both facts are
recorded here; neither is conflated with the database-role or Neon API-key
assessment.

### Checked containment surfaces

- All objects reachable from all local Git refs were streamed through an
  exact-value scan: **0 database-password hits, 0 API-key hits**.
- Live PR #347 and #348 bodies, issue comments, reviews, and review comments:
  **0 hits** for the old password, old URI, API key, runtime password, or new
  owner password.
- **131 files** across the retained #347, Unit B, Unit A, reviewer, and health
  receipts: **0 exact-secret hits**.
- Available Actions logs for #347, #348, and the Unit B `main` push: **0
  exact-secret hits**. GitHub returned an empty ZIP for PR #348 CI attempt 1,
  the documented checkout-time runner wedge, so that attempt's job log is
  unavailable and is not claimed clean. Attempt 2 and both `main` attempts were
  available and scanned.
- PR #347's two fresh reviewer sessions and the other nearby task sessions had
  **0 password and 0 API-key hits**. The two implementer task sessions above
  each retained four duplicate serialized occurrences of the password across
  two event records.
- One later discarded review log had **6 old-password hits** caused by a raw
  session-line search. It was mode 0600, never became a review receipt, and was
  deleted at `06:06:21Z`. All accepted reviewer receipts remain exact-secret
  clean.

These checks establish the named surfaces, not universal absence from every
host-level buffer, provider-internal log, or unenumerated external system.

## Unit A — mechanism, consumers, grants, and cutover

### A0 — selected mechanism

Neon permitted creation of an additional PostgreSQL role, so Path 1 was used.
The new application role is `wcdraft_runtime_20260809`. It is login-enabled but
is not a superuser, cannot create databases or roles, cannot replicate or bypass
row-level security, and is not a member of `neon_superuser`.

The existing `neondb_owner` role was retained because
`.github/workflows/production-db-migrate.yml` obtains that role's current direct
URI from the Neon API for guarded production migrations. Deleting or replacing
the owner role would have changed the migration authority model. Its password
was reset only after production was healthy on the runtime role.

### A1 — consumer inventory and final state

| Consumer                                  | Evidence before cutover                                                                                                                                                                                                                                                                | Final state                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel project `wcdraft-web`              | One sensitive `DATABASE_URL`, scoped only to Production. No Preview or Development `DATABASE_URL` exists. Vercel does not return sensitive values for read-back.                                                                                                                       | Production-only `DATABASE_URL` was replaced from stdin with the runtime role's pooled URL and redeployed. Vercel metadata shows `updatedAt=2026-08-09T04:49:27.192Z`; production behavior plus old-owner rejection proves the active deployment is not relying on the old value. |
| GitHub Actions repository secrets         | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_API_KEY`, `NEON_PROJECT_ID`, and `TURBO_TOKEN` existed. Current workflows do not consume the two static database secrets in ordinary CI; production migration dynamically fetches the owner URI using the API key.                      | `DATABASE_URL` is the runtime pooled URL (updated `2026-08-09T04:49:26Z`). `DATABASE_URL_UNPOOLED` is the reset owner's direct URL (updated `2026-08-09T04:53:42Z`). API key/project ID were unchanged.                                                                          |
| Self-hosted wcdraft runner                | Static runner files outside `_work`, `_diag`, bundled runtime, and tool directories contained none of `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_API_KEY`, or `NEON_PROJECT_ID`. Job secrets are supplied by GitHub at runtime. The biotraxiq runner was not inspected or touched. | No stored database credential was added. Runner fleet shutdown is a closeout gate, not a credential consumer update.                                                                                                                                                             |
| Local operator configuration              | `/Users/paulo/.config/wcdraft/neon.env`, mode 0600, contained the old pooled URL plus API key/project ID. The unquoted URI also made shell sourcing unsafe because `&` was parsed as shell syntax.                                                                                     | `DATABASE_URL` is the runtime pooled URL, single-quoted and source-safe; mode remains 0600. API key/project ID are unchanged.                                                                                                                                                    |
| Repository templates                      | `.env.example` carries names/documentation only; no value. No owner-checkout `.env` or `.env.local` existed.                                                                                                                                                                           | Unchanged; no secret was added.                                                                                                                                                                                                                                                  |
| Production live verifier                  | Receives an on-demand URL from the operator. Before Unit B it expanded that URL into `psql` argv.                                                                                                                                                                                      | Still receives the URL through environment state, then parses over stdin, unsets it, and invokes `psql` with discrete libpq fields plus a private mode-0600 `PGPASSFILE`. No persistent credential.                                                                              |
| #346 branch guard and ephemeral-branch CI | Use `NEON_API_KEY` and `NEON_PROJECT_ID`; generated branch URLs live in mode-0600 transient files/environment.                                                                                                                                                                         | API key unchanged. Guard assertions unchanged.                                                                                                                                                                                                                                   |
| DR and Neon restore procedure             | Uses the API key for Neon control-plane calls, not the database role password. Before Unit B the bearer header was present in `curl` argv.                                                                                                                                             | Unit B moved the header into a private mode-0600 curl config and withholds failed provider output. No database credential consumer.                                                                                                                                              |
| Production migration                      | Neon API key retrieves the current direct owner URI; migrations use `DATABASE_URL_UNPOOLED` in child environment state.                                                                                                                                                                | Neon API returns a URI whose role/host/database/password exactly matched the reset owner credential; the static unpooled fallback secret was updated as well.                                                                                                                    |

### A2 — grants and representative queries

Before cutover, the runtime role received:

- `USAGE` on `public`;
- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on every existing application
  table in `public`;
- `USAGE`, `SELECT`, and `UPDATE` on public sequences (the current application
  schema has zero public sequences) plus matching default sequence privileges;
- matching default table privileges and `EXECUTE` default function privileges
  for future owner-created public objects;
- `USAGE` on `drizzle` and `SELECT` on
  `drizzle.__drizzle_migrations`, plus the matching default table privilege.

The role owns no database, schema, table, sequence, or migration object. Schema
ownership and DDL remain with `neondb_owner`.

The initial non-production proof completed during `04:32–04:33Z` and
established the new role's exact project/branch identity and real
application-table read/insert/update/delete behavior under rollback. It did
not exercise the `drizzle` readiness read, which caused the first-cutover
incident.

After correction, a new production-derived branch
`br-quiet-violet-aq9aqgr3` was created and independently passed the unchanged
#346 branch guard. At `2026-08-09T04:48:43Z`, as the runtime role, it executed:

- an exact project/branch/role identity query;
- a real read of all **14** `drizzle.__drizzle_migrations` rows;
- a representative application read returning **6** users;
- one insert, one update, and one delete against `auth_rate_limits`;
- an in-transaction zero-row check after the delete; and
- a rollback followed by a second zero-row persistence check.

Proof-branch deletion was requested at `2026-08-09T04:48:51Z` and finished at
`04:48:53Z`. Production was then
checked read-only as the same role: exact project `rapid-wind-87431051`, branch
`br-blue-heart-aqcejtyf`, endpoint `ep-sparkling-credit-aqff218p`, database
`neondb`, writable primary, 14 migration rows, and 6 representative user rows.

### A3 — cutover and health-before-revoke proof

All timestamps are UTC.

| Time                | Event and evidence                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `02:10:00–02:10:09` | Unit B candidate verifier passed against the old credential before merge.                                                                                                                                                  |
| `04:15:33`          | Unit B PR #348 squash-merged as `c671755b2296e021c5f58148d5e12e0ff0ceeb5d`.                                                                                                                                                |
| `04:18:11–04:18:19` | Corrected verifier passed against the merged/deployed Unit B build while the old credential was still active. Six forbidden counts: entries 4, attempts 0, accounts 6, saved runs 317, magic links 18, active sessions 44. |
| `04:30–04:33`       | Runtime role created; first non-production read/write/rollback proof passed. No consumer changed yet.                                                                                                                      |
| `04:38:51`          | Initial consumer values updated to the runtime role. Old credential retained as rollback material.                                                                                                                         |
| `04:41:10`          | First runtime-role redeployment created as Vercel deployment `dpl_FURmuyNebVrKdJRswTjZJhVtfVU6`.                                                                                                                           |
| `04:43:09.314`      | Health monitor's first `503/db=error/auth=ready` sample after alias cutover.                                                                                                                                               |
| `04:43:45–04:43:46` | Mandatory pre-revoke verifier failed at `/api/health` with 503. Its independent database snapshot still reached the declared production branch and proved all forbidden counts unchanged. **Revocation did not occur.**    |
| `04:44:13`          | Vercel, GitHub, and local consumer rollback to the old credential completed; rollback redeployment `dpl_Hu8QSZGEASKA8nS8PXn4F9vkiAmh` was started.                                                                         |
| `04:45:04.926`      | First recovered 200/ready/ready monitor sample after the rollback deployment restored the old credential. The missing `drizzle` grant had also been added but did not cause this recovery. Failed interval: 1m55s–1m56s.   |
| `04:46:38–04:48:53` | Fresh corrected A2 branch guard and real read/write/rollback proof passed; proof-branch deletion finished.                                                                                                                 |
| `04:49:26–04:49:27` | Second new-first consumer update completed.                                                                                                                                                                                |
| `04:49:34–04:51:41` | Corrected deployment `dpl_38r3h88TmNAHFyGBN9dwiwYjtVDd` built, became Ready, and acquired the production aliases.                                                                                                          |
| `04:51:50–04:51:54` | **Required health-before-revoke verifier PASS.** Database/auth ready, 4/4 boards stable, typed 409 and OG healthy, all six forbidden counts unchanged.                                                                     |
| `04:52:16`          | Separate old-owner probe still authenticated, proving rollback material remained available through the health gate.                                                                                                        |
| `04:52:48.068`      | Production `neondb_owner` reset requested once. Neon operation `43df4b3a-b198-4a70-8ce8-7c506d1f28ef` reached `finished`.                                                                                                  |
| `04:53:27`          | Old production password rejected; new owner credential authenticated to the exact project/branch/endpoint; runtime health remained ready.                                                                                  |
| `04:54:30–04:55:51` | Both snapshot branches were empirically checked, reset, and rechecked; details are in A4.                                                                                                                                  |
| `04:56:07–04:56:11` | First full post-revocation verifier PASS with all forbidden counts unchanged.                                                                                                                                              |
| `04:57:57`          | One residual idle `neondb_owner` PgBouncer backend was terminated exactly; post-check count was zero. Runtime-role sessions were not touched.                                                                              |
| `05:05:25–05:05:29` | Final full post-revocation verifier after session termination PASS; same build, ready health/auth, stable boards, typed 409, OG healthy, and unchanged forbidden counts.                                                   |

The health monitor ran from `04:39:09.128Z` through `04:56:28.666Z` and
recorded 1,776 samples: 1,584 healthy and 192 failed. There was exactly one
failure segment, all `503/error/ready`, bracketed by a healthy sample at
`04:43:08.738Z` and recovery at `04:45:04.926Z`. The lower observed failure
span was 114.993 seconds; the sampling-bound upper span was 116.188 seconds.
No failure occurred during password reset or post-reset verification.

### A4 — branch-by-branch final access state

| Branch                                                           | Old credential before branch reset | Neutralization                                                                                    | Final proof                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `br-blue-heart-aqcejtyf` (`production`)                          | Accepted at `04:52:16Z`.           | Owner reset operation started and finished at `04:52:48Z`.                                        | Old password rejected at `04:53:27Z`; new owner password connected to the exact production endpoint; runtime role healthy; residual idle owner backend terminated; final live verifier passed. |
| `br-autumn-hill-aqswkxii` (`pre-u2-lb-residue-20260807T204810Z`) | Accepted at `04:54:30Z`.           | Reset operation `380d3dcb-9ad1-44f8-9d19-16ac1033e7fe` finished after request at `04:54:43.676Z`. | Old password rejected at `04:55:11Z`; branch-specific new owner password connected to exact branch/endpoint. Branch retained.                                                                  |
| `br-dark-math-aqyfztzk` (`pre-unit-c-residue-20260807T225034Z`)  | Accepted at `04:54:30Z`.           | Reset operation `e0280278-dfe4-4a81-b7e2-14c82ad03b75` finished after request at `04:55:24.688Z`. | Old password rejected at `04:55:51Z`; branch-specific new owner password connected to exact branch/endpoint. Branch retained.                                                                  |

A live project inventory after these checks contained exactly those three
ready branches. Two lane-owned proof branches were created with one-hour expiry
and explicitly deleted after use. No CI or other ephemeral branch remained.
Snapshot retention remains an owner decision; this lane did not delete either
named snapshot.

## Unit B — connection-string and external-process hardening

The detailed audit and implementation record is
[`neon-credential-transport-hardening-2026-08-08.md`](./neon-credential-transport-hardening-2026-08-08.md).
Its candidate wording is intentionally pre-merge evidence; PR #348 and this
record supply the merge/deploy/post-merge disposition.

| Site                                                                                   | Mechanism before Unit B                                                                                          | Final disposition                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/live-verify-production.sh:54-171`                                             | Credential-bearing URI expanded into `psql` argv.                                                                | **Fixed.** Parse over stdin; discrete libpq environment fields; private 0600 `PGPASSFILE`; URI unset before spawn; failed stdout/stderr withheld and erased. |
| `docs/runbooks/production-live-verify.md:124-145`                                      | `neonctl` used API-key environment state; connection URI stdout was handed directly to the verifier environment. | **Sound; catalogued.** Transient handoff, private file, cleanup, and no-`set -x` constraints documented.                                                     |
| `docs/runbooks/neon-restore-vercel-rollback.md:170-229,394-499,659-692`                | Five API calls expanded the bearer API key into `curl` argv.                                                     | **Fixed.** Private 0600 curl config; key unset before curl; failed body/stderr withheld and erased.                                                          |
| `.github/workflows/production-db-migrate.yml:132-295`                                  | API key in job environment to in-process `fetch`; returned URI in protected 0600 file and child environment.     | **Sound; catalogued.** Constant protected failures; no secret argv or summary output.                                                                        |
| `.github/workflows/ci.yml:642-770`; `packages/db/scripts/neon-branch-create.ts:21-200` | API key in job environment to in-process `fetch`; generated URLs in protected transient env file.                | **Sound; catalogued.** Identifiers only in output.                                                                                                           |
| `packages/db/src/client.ts:60-114`; migration/status/Drizzle scripts                   | URL read from environment by in-process Neon/Drizzle clients.                                                    | **Sound; catalogued.** No external database-client argv.                                                                                                     |
| Branch guard/delete/verify scripts                                                     | API key from environment to in-process `fetch`/`https`; protected top-level errors.                              | **Sound; catalogued.** #346 identity assertions unchanged.                                                                                                   |
| Repository-wide executable/workflow search                                             | No other executable `psql`, dump/restore, `neonctl --api-key`, bearer expansion, or connection-URI argv site.    | **No additional proven case.** Documentation and synthetic fixtures classified separately.                                                                   |

The focused redaction contract simulates a failed `psql` that emits a complete
credential-bearing URI and password-shaped diagnostics. It proves that no URI,
password, endpoint, or fragment reaches argv or surfaced output, and that the
private credential directory is removed. The DR contract applies the same
failure proof to `curl`, while retaining all 68 negative mutation cases and all
6 route orderings.

Unit B validation and review at exact head
`b73a30ba9089af86fb22f6cc817b0b6720dfb784` included 3/3 shell syntax checks,
both focused contracts, typecheck 9/9, lint 6/6, test 9/9, build 5/5, format,
diff check, protected CI, fresh-session Codex PASS, and direct Ollama Cloud GLM
5.2 PASS. The persisted verdicts and receipt hashes are in PR #348's body.

## Unit C — exposure history and observability limits

The Neon organization is on the `launch` plan. Project metadata reports a
24-hour data-history retention setting; that is WAL/data restore history, not
an authentication audit log. Neon has `log_connections=on` and
`log_disconnections=on`, but its documentation makes Postgres log export,
including connection events, available through Datadog/OpenTelemetry on Scale
and directs other plans to Support. No raw historical connection log was
available through this project's Launch-plan API/CLI surfaces.

The Console monitoring data can show aggregate connection counts, including
pooled client/server counts, but not a credential, source identity, query, or
per-connection authentication record. The Neon operations API was checked for
the exposure interval; it showed compute start/suspend events and the branch
and password operations described here. Control-plane operations do not record
PostgreSQL connection attempts or prove which password authenticated.

At `2026-08-09T04:57:31Z`, `pg_stat_activity` showed current sessions only:
one idle runtime-role PgBouncer backend, the active owner `psql` audit session,
and one idle owner-role PgBouncer backend. The idle owner backend was
terminated. `pg_stat_statements` was not installed, and even if present it
would aggregate SQL by database role without source address, password, or
historical authentication identity.

**Conclusion:** no checked evidence shows use from an unexpected source. That
is not proof of no misuse. Launch-plan retention exposed no source-attributed
historical connection log for the period, aggregate graphs cannot distinguish
expected from unexpected clients, and provider-internal logs were not
available in this lane. A support request would be required to ask Neon whether
provider-side logs for the interval can be recovered.

Relevant current vendor documentation:

- [Neon compatibility and Postgres-log availability](https://neon.com/docs/reference/compatibility)
- [Neon Datadog log export and connection events](https://neon.com/docs/guides/datadog)
- [Neon operations API scope and retention](https://api-docs.neon.tech/reference/listprojectoperations)
- [Neon role password reset API](https://api-docs.neon.tech/reference/resetprojectbranchrolepassword)
- [Neon branch password inheritance and protected branches](https://neon.com/docs/guides/protected-branches)
- [GitHub self-hosted runner registration-token lifetime](https://docs.github.com/en/rest/actions/self-hosted-runners#create-a-registration-token-for-a-repository)

## Evidence bindings

The receipt paths are local operational evidence, not committed artifacts, and
contain no credential. Directory digests hash sorted relative paths and file
bytes; the monitor binding is the raw file-byte SHA-256.

| Evidence                                | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| Unit B pre-merge verifier               | `beb615d72999b5bf970ca42ed0279addbb6b52ae2673ecfce2cb7be12fc52c4b` |
| Unit B post-merge verifier              | `b8dea4e02ccf92dffc040d2abb903437c1a0d4525131115d759e24643899d192` |
| First failed pre-revoke verifier        | `7f2fd26368d19a02aae13db94a3d112fe3e6d3464f7290ba5b6b0511eed48698` |
| Corrected health-before-revoke verifier | `125389d15936a3291b5e4b704139bc1c9f97ab58ff1c7f2c742d35c3aca5efd5` |
| First post-revocation verifier          | `d273f9f7c952af60642be319990a10d11d69e6d82b5deacd7357f34b7f21e0d7` |
| Final post-session-termination verifier | `ce0f1ceb974686821344395f1f56e41aecaa86acfae77d2e5c1bdbc2ed974533` |
| 1,776-sample health monitor             | `e53cc4fe4cb965f4abcfc3bd0cc141b4643c3f17c260ddfc9fea65ff96a8481d` |

## Architect-delegated decisions

### Create a SQL-created least-privilege runtime role

Neon API/CLI-created roles receive broader Neon-managed membership. A plain SQL
role allowed the application to receive only the verified DML and readiness
privileges it actually uses. The owner role remains the migration authority,
which avoids changing workflow semantics while separating runtime compromise
from DDL authority.

### Keep and reset `neondb_owner` instead of deleting it

Production migration explicitly asks Neon for that named role. Retaining it
with a new password is the smallest compatible change; deleting it would break
migration and could disturb object ownership. The runtime deployment no longer
uses it.

### Apply the #346 identity logic to production without weakening its refusal

The #346 guard intentionally rejects default/primary/production branches, so
invoking it literally against production would always refuse. Production
verification used the same server-reported project/branch/endpoint/database
settings and authenticated Neon API endpoint/branch records, then performed a
read-only query. The guard itself was unchanged and was executed literally on
both non-production A2 proof branches.

### Do not rotate the API key without exposure evidence

The API key has wider control-plane authority and was absent from every checked
incident and retained surface. Rotating it reflexively would add branch-guard,
CI, DR, and migration failure modes without closing the proven database-secret
exposure.

### Roll back the first cutover before diagnosing forward

The first 503 occurred before revocation, so the old credential was still valid.
All consumers were restored first, then the missing `drizzle` privilege was
isolated and corrected. Continuing forward on a partly functional role would
have violated the dispatch contingency and increased the outage.

### Reset snapshot passwords; do not delete snapshots

Both snapshots demonstrably inherited and still accepted the exposed password.
Individual role resets neutralized that access while preserving data and the
owner's unresolved retention decision.

### Terminate the residual owner backend

Password rejection prevents new authentication but does not prove an already
authenticated pooler backend is gone. After observing one idle owner-role
backend, terminating that exact PID closed the residual session without
touching runtime-role connections.

### Treat the printed runner registrations as separate exposed credentials

The printed values were short-lived GitHub runner registration tokens, not the
repository's durable GitHub credential. Rotating Neon or repository secrets
would not invalidate them. The bounded response was to remove their registered
runners, stop the recreating supervisors, hold CI until the documented
one-hour expiry, monitor for unexpected registrations, and ensure future runner
inspection never prints process arguments.

### Ban raw session-line output from secret-scope review

JSONL session records can contain a credential anywhere on a matching line.
Searching them with a line-printing tool reserialized the already-revoked owner
password into a discarded reviewer log. The final review therefore performs
exact comparisons in process and emits only counts/classifications; raw
matching records and fragments are never printed.

### Persist SHA-pinned review verdicts in the PR body

The fresh and cross-model reviews must assess the exact report commit. Adding
their text to that commit afterward would change the SHA and invalidate the
verdict. Their exact unedited outputs and receipt hashes are therefore persisted
in the report PR body, as in Unit B. Merge is prohibited unless both verdicts
are exact `PASS` with numbered defects and protected CI is green at the same
head.

## Risks, limits, and unresolved owner actions

- The first cutover caused 1 minute 55 seconds to 1 minute 56 seconds of
  observed 503 responses at the monitor's sampling precision. The specific
  missing grant is fixed and covered by the corrected real-query proof, but the
  incident remains part of the production record.
- Launch-plan evidence cannot rule out historical use by an unexpected source.
  No such use was observed in the available data.
- Vercel sensitive values cannot be decrypted for direct equality read-back.
  Exact stdin writes, metadata timestamps, new-role deployment behavior, and
  old-owner rejection provide the cutover proof.
- The two production-derived snapshots remain full production-data copies.
  Their exposed passwords are neutralized; retention remains unresolved.
- Two repository runner registration tokens appeared in private task output at
  `05:13:03Z`. Their runners were removed and no unexpected runner was observed;
  CI remains held until the later token's one-hour expiry at approximately
  `05:37:11Z`.
- A discarded reviewer reserialized the revoked owner password six times into a
  private run log. The log and reviewer credential directories were deleted;
  accepted reviewer receipts must remain exact-secret clean.
- The wcdraft fleet remained idle after Unit B CI longer than the on-demand
  policy permits. The direct supervisors were stopped, containers reached zero,
  and GitHub reported zero online wcdraft runners at `05:18:17Z`. Colima stayed
  up.
- The following owner actions remain open and none was resolved in this lane:
  `wow`, `testt`, `team3`, `redacted@example.invalid`, chezwizz binding, Neon
  snapshot retention, and canonical ratification.

## Review protocol

This is a Red production-credential and availability record. A fresh-context
reviewer must independently re-execute the branch inventory, old-password
rejection on every branch, new credential connectivity, grants through real
queries on a fresh branch, production health, board reads, and ordering
timestamps. A direct Ollama Cloud GLM 5.2 maximum-thinking review must return an
exact `PASS` or `FAIL` with numbered defects. Both unedited verdicts belong in
the report PR body and are SHA-pinned.
