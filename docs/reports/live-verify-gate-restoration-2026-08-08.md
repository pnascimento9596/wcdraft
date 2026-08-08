# Live-verify gate restoration (2026-08-08)

## Outcome

**PRE-MERGE SCRIPT GATE PASS — merge is not yet authorized.** The corrected
definition, forbidden-set assertion, and tests are implemented locally. The
mandatory retroactive production check against `340a608` passed before merge;
the independent anti-circularity execution and exact-head reviews remain
required.

Baseline verified from current sources rather than prior reports:

- freshly fetched `origin/main`: `340a6080e0a304442595ccf68be7646a402ca546`;
- live `/api/health` build: the same SHA, `db=ready`, `auth=ready`;
- runtime schema `runtime-data-2.11.0`;
- engine `engine-2026.07.18-basis-aware-tiering`;
- season `season-2026-squad-depth`;
- production Neon server identity: project `rapid-wind-87431051`, branch
  `br-blue-heart-aqcejtyf`, primary and not in recovery.

Unit D itself was strictly read-only, and no forbidden/user-attributable/product-
visible row was mutated while gathering this report. One expired session was
reaped by the existing sweep during an earlier candidate gate execution; that
permitted maintenance event is disclosed below. All SQL was executed with
`default_transaction_read_only=on`; full email addresses were neither printed
nor persisted.

**Credential-handling incident:** after the successful checks, a local attempt
to keep the Neon URI out of the `psql` argument vector passed it through
`PGDATABASE`. `psql` interpreted the URI as a database name and echoed a
credential-bearing fragment in the private task output before any connection,
SQL, or production HTTP request occurred. The value is not committed, persisted
in a receipt, or repeated here. The experiment was reverted. Rotating that
production role without coordinating the live Vercel environment could cause an
outage, so no rotation was attempted in this lane; owner-coordinated rotation is
an open human action.

## Unit A — corrected definition

“Non-writing” now means **no durable user-attributable or product-visible
artifact**, not “no incidental database write of any kind.”

Forbidden: leaderboard entries (ranked or casual), ranked attempts, accounts,
magic-link tokens, email sends, durable active sessions, saved runs, and any
other durable user-attributable or product-visible row.

Explicitly permitted: existing expired-session reaping, rate-limit counter row
creation/increment, and 300-second stateless CSRF bootstrap cookies that mint no
durable session.

Distinguishing test: **would a single anonymous visitor loading the site cause
this same write?** If yes, the incidental maintenance is permitted. A durable,
user-attributable, or product-visible artifact remains forbidden regardless of
trigger.

### OWNER RATIFICATION

The corrected definition — not the superseded physical-no-write wording — is
what has awaited owner adoption into the canonical doc set since PR #342. This
lane does not edit that canonical set.

## Unit B — script and assertions

`scripts/live-verify-production.sh` now:

- snapshots the production forbidden set before its first HTTP request and from
  an `EXIT` finalizer after the last attempted check;
- verifies the read-only count connection's server-reported Neon project and
  branch identity;
- counts sessions **only** as
  `SELECT count(*) FROM sessions WHERE expires_at > clock_timestamp()`;
- compares `leaderboard_entries`, `ranked_attempts`, `users` (reported as
  accounts), `saved_runs`, `magic_link_tokens`, and active sessions;
- records expired-session, rate-limit-row, and rate-limit-event totals as
  permitted observations but excludes them from equality;
- resolves the expected build commit from the supplied SHA or live health and
  derives the expected health anchors and active season from that commit's Git
  tree, with no hardcoded deployment SHA or anchor;
- retains health/auth, CSRF bootstrap, four-board equality, archived-season,
  typed `409 DIFFERENT_BUILD`, and OG-health checks; and
- accepts the existing stateless `wcdraft_sid` only at `Max-Age=300` (or a
  deletion at zero), rejects a durable sid TTL, and redacts cookie/CSRF values
  from retained receipts and failure output.

The CI contract has two behavior cases:

1. total sessions decrease because one expired row is reaped, active sessions
   stay fixed, and rate-limit observations advance -> **the assertion passes**;
2. an account count moves -> **the assertion fails**.

It also locks the submit route's cheap `DIFFERENT_BUILD` preflight ahead of
`rateLimiter.checkSubmit`, including a runtime source check against the exact
target deployment SHA before the probe is sent. That probe shape is the
rate-limit bounding mechanism: it consumes zero submit-rate-limit budget while
the locked order holds. A spoofed identifier and a fragile run-cadence allowance
were rejected as less reliable alternatives.

## Unit C — mandatory ordering

### Pre-merge retroactive live-verify for `340a608`

**PASS before merge.** The corrected script ran against production while live
health still reported `340a6080e0a304442595ccf68be7646a402ca546`.

| Assertion               | Result                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health/build            | 200, `ok=true`, `db=ready`, `auth=ready`, exact `340a608`                                                                                                              |
| SHA-derived anchors     | schema `runtime-data-2.11.0`, engine `engine-2026.07.18-basis-aware-tiering`, dataset `2026-07-01`, ratings/ruleset/draft hash and season all matched Git at `340a608` |
| CSRF                    | 200, 300-second stateless bootstrap/CSRF/sid cookies, no active durable session created                                                                                |
| Current Classic casual  | 0 -> 0, identical IDs                                                                                                                                                  |
| Current Memory casual   | 0 -> 0, identical IDs                                                                                                                                                  |
| Current Classic ranked  | 0 -> 0, identical IDs                                                                                                                                                  |
| Archived Classic casual | 0 -> 0, identical IDs; archive API readable                                                                                                                            |
| Rejection               | HTTP 409, `DIFFERENT_BUILD`, mismatches `schema_version`, `engine_version`, `data_bundle_hash`                                                                         |
| OG health               | 200, `ok=true`                                                                                                                                                         |
| Forbidden counts        | entries 4, attempts 0, accounts 6, saved runs 317, magic links 18, active sessions 44 — unchanged                                                                      |
| Permitted observations  | expired sessions 1 -> 1; rate-limit rows 66 -> 66; rate-limit events 72 -> 72                                                                                          |

Receipt directory (mode 0700; cookie/CSRF values redacted):
`/tmp/wcdraft-live-verify-340a608-20260808-final`.

An earlier development execution is not counted as the gate: the candidate
script incorrectly treated the existing 300-second stateless `wcdraft_sid`
bootstrap value as durable. Its DB finalizer independently showed active
sessions unchanged at 44 and one permitted expired-session reap (2 -> 1),
proving the assertion—not production—was wrong. The implementation was
fix-forwarded to distinguish TTL/stateless bootstrap from a durable row and to
redact all cookie/CSRF receipt values before the recorded PASS.

### Fresh reviewer independent execution and comparison

**PENDING.** The reviewer must execute health/anchors, CSRF response and cookie
lifetime, board equality, typed rejection, and forbidden-set counts by hand.

### Post-merge live-verify

**NOT RUN — no merge yet.**

## Unit D — `chezwizz` owner identification (read-only)

### Verdict: `LIKELY_GENUINE`

The evidence is substantially more consistent with a real legacy player than
with the known production-review automation shapes. This is classification
only; no deletion, constraint operation, migration, or remediation is proposed
or performed.

#### Owning account

| Field                     | Read-only production result                           |
| ------------------------- | ----------------------------------------------------- |
| Username                  | `chezwizz`                                            |
| Email domain              | `gmail.com` (domain only; local part withheld)        |
| Account created           | `2026-06-21T20:24:09.680662Z`                         |
| Verified                  | No (`email_verified_at IS NULL`)                      |
| Saved runs                | 1                                                     |
| Sessions                  | 1 total: 0 active, 1 expired                          |
| Other leaderboard entries | 0                                                     |
| Ranked attempts           | 0                                                     |
| Magic-link history        | 1 sign-in token, consumed 15.6 seconds after creation |

The sole session was created `2026-06-21T20:23:50.043Z`, belongs to this
account, expired `2026-07-21T20:24:09.686Z`, and is the expired session retained
through the historical ranked row's foreign-key/constraint interaction.

#### Ranked row

| Field           | Value                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| ID              | `4dc1df8e-530d-47c3-9364-5e6beea571a2`                                                                |
| Created         | `2026-06-21T21:17:55.346Z`                                                                            |
| Full season key | `engine-2026.06.16-merit-v4.4_wc-perf-6.4.0+proj-career-5.4.0_2026-06-04_ruleset-2026.06.04_f79ba870` |
| Mode            | ranked                                                                                                |
| Config          | Classic · Squad First · All-time · Career · 4-4-2                                                     |
| Verified score  | 23                                                                                                    |
| Attempt         | `NULL`                                                                                                |
| Token           | decodable `t2`, 1,679 characters                                                                      |

The token decodes to `run_id=run-v1-2`, parent seed
`wcdraft:run:v1:run-v1-2:4-4-2`, default team name `Your XI`, 16 distinct player
picks plus one manager, and the exact six runtime anchors shipped at the time.
The account's one saved run was created 56.7 seconds before the ranked entry,
has the same token/run id/seed, is claimed to the account, and carries a normal
2-1 run summary with three named key picks. The exact seed is absent from the
repository's fixture corpus. The account uses a normal consumer domain and has
none of the `prodreview-*`, `codex-live-*`, `example.invalid`, or
`wcdraft.invalid` markers seen in known automation residue.

#### How a ranked row exists with zero lifetime attempts

The mechanism is determinable from Git plus the row's anchors. The token's
schema, dataset, engine, ratings, ruleset, and both bundle hashes match commit
`4fb3589637dd1d6268402781d899f67c5fc7847b`, the production head preceding the
row. At that revision, the submit route required an account for `mode=ranked`
but called `insertAcceptedEntry` without issuing, checking, consuming, or
passing an attempt. `attempt_id` was nullable and the only structural ranked
check required a non-null user. Server-issued ranked-attempt binding did not
ship until `33fff711c187d01f5835f3eaab712b983435b1b1` on 2026-06-29. Therefore the
legacy route legitimately wrote this ranked row with `attempt_id NULL` while
the unused `ranked_attempts` table remained empty.

## Architect-delegated decisions

1. **Prefer the current disposable-clone contract over the dispatch snapshot.**
   Fresh `origin/main` requires every implementer/reviewer/cross-model clone to
   use `create:disposable-clone`. The initially created clean raw worktree was
   removed before editing and replaced with a registered disposable clone. This
   preserves the fresher repository lifecycle control without changing product
   behavior.

2. **Apply the anonymous-visitor test with a durable-artifact override.** A
   write common to one ordinary anonymous load is permitted only when it is
   maintenance and not durable/user-attributable/product-visible. This resolves
   the apparent overlap in favor of the dispatch's pollution-prevention intent.

3. **Make direct production counts mandatory and identity-pinned.** Board reads
   alone cannot detect a hidden/out-of-window insert. Requiring a read-only DB
   URL plus expected Neon project/branch IDs is the least behavior-changing way
   to obtain complete table counts without adding a product endpoint or
   weakening the #346 branch guard.

4. **Treat expired and rate-limit totals as observations, not invariants.** The
   equality object contains active sessions and the other forbidden tables only.
   Keeping permitted totals beside it in the receipt demonstrates what happened
   without recreating the policy deadlock.

5. **Bound rejection traffic by gate shape.** The stale six-anchor fixture is
   rejected before the submit limiter, so repeated compliant runs do not
   accumulate toward its cap. The script verifies that ordering from the target
   deployment SHA before posting, rather than trusting its own checkout. This is
   stronger than a cadence rule and avoids spoofing client-IP headers or
   creating per-run identifier rows.

6. **Classify `chezwizz` as likely genuine, not certain.** A consumer-domain
   account, consumed sign-in link, claimed same-token saved run, normal draft
   sequence, and historical code path are affirmative genuine-use signals. No
   single signal proves a human operated the browser, so `LIKELY_GENUINE` is the
   honest classification rather than certainty.
