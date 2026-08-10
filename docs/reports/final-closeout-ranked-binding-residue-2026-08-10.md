# Final closeout — ranked binding, residue, snapshots, and infrastructure hygiene

- Date: 2026-08-10
- Repository: `pnascimento9596/wcdraft`
- Risk: RED — production DDL, production DML, and irreversible branch deletion
- Implementation PR: #352
- Implementation head: `04e8c3d1ce05c0ecef26f558e8737c214500452c`
- Implementation merge: `60b7078e65669a235eb325dac95a79f3149c649a`

## Outcome

The owner-dispatched runtime and data closeout is complete. Migration 0014 is
applied at 15/15, both ranked-attempt CHECKs are scoped to the one genuine
historical row and `VALID`, the poison session is gone, `chezwizz.session_id`
is null by design with every other column preserved, expired-session sweeping
works as one batch without fallback, every residue disposition is settled, and
the two old snapshots are deleted. Production and B0 are the only Neon
branches. Two production verifiers passed, including one from a
control-plane-confirmed cold compute.

This change records Unit E only. It changes no engine, RNG, rating, codec,
runtime-data schema version, compact artifact, application behavior, or
canonical owner document.

## Unit A — CI and fleet hygiene

- Queued main run `31335136311` targeted exact production SHA
  `02fccf088ae60d295cfe83cb955b80414709b850`. The fleet was restored and the
  run was allowed to complete successfully instead of being canceled. A real
  exact-main result was stronger evidence than replacing the pending signal
  with a cancellation.
- GitHub initially listed 25 offline `wcdraft-linux-*` registrations and zero
  online. The reconciled teardown removed all 25 and read back 0 total / 0
  online.
- Host controller `/Users/paulo/runners/wcdraft/stop.sh` now waits for every
  WCDraft runner to be offline, requires zero WCDraft containers, re-resolves
  exact offline `wcdraft-linux-*` registrations immediately before DELETE,
  fails closed on ambiguous responses, and requires a final zero read-back.
  `bash -n` and a real start/stop cycle passed. Its post-change SHA-256 is
  `b5949a509dec7b601104e3daab5f1100e117caa60ebd7b6283f24b683e046a2b`.
- No AP Audit or BiotraxIQ runner, registration, or container was changed.
  Colima remained up.

## Unit B — ranked binding constraint

### B0 rollback substrate

Fresh production child `br-bold-grass-aqb9vex2`
(`pre-final-closeout-b0-20260810T034000Z`) was created before any lane DDL or
DML. It is a child of production `br-blue-heart-aqcejtyf`, parent LSN
`0/7963B18`, parent timestamp `2026-08-09T20:54:17Z`, and creation timestamp
`2026-08-10T03:38:17Z`.

Immediate production/B0 parity was exact: leaderboard entries 4, ranked
attempts 0, users 6, saved runs 317, magic links 18, active sessions 41, and
expired sessions 2. The complete `chezwizz` row fingerprint matched and its
session reference was present in both.

Retain B0 through 2026-08-17 inclusive. Delete it on or after 2026-08-18
without further owner adjudication unless the owner objects.

### Premise and predicate

Before migration, both overlapping checks were `NOT VALID`:

- `leaderboard_entries_ranked_attempt_chk`: ranked rows require an attempt;
- `leaderboard_entries_ranked_attempt_binding_chk`: ranked rows require the
  complete attempt/user/config/consumption witness.

The related nine-column composite FK was also `NOT VALID` and had zero
violators. The sole attempt-less ranked row was exact primary key
`4dc1df8e-530d-47c3-9364-5e6beea571a2`; no second violating row existed.

`leaderboard_entries.created_at` has a database default but is not generated or
identity, and both application insertion paths explicitly supply it. A date
predicate was therefore forgeable and rejected. The migration gives both
overlapping checks this exact exemption:

```sql
id = '4dc1df8e-530d-47c3-9364-5e6beea571a2'::uuid
OR <the prior check expression>
```

The occupied primary key cannot match a future generated row, opens no date or
season class, and references no `session_id` or other cascade-mutated column.
Both checks needed the same exemption; leaving the older check unchanged would
have reproduced the cascade abort. The composite FK was intentionally left
unchanged because it had zero violators and did not participate in this
cascade.

### Rehearsal and review proof

The implementer used production child `br-silent-pond-aqje94gr`. The fresh
Codex reviewer independently used `br-long-cloud-aq209wth`; the Ollama Cloud
GLM 5.2/MAX reviewer independently used `br-small-leaf-aqx9o0mb`. Every branch
was bound by the #346 same-handle guard, used `neondb_owner`, and was deleted
with an absent read-back.

Each proof established:

- apply reaches 15 applied / 0 pending;
- both CHECKs become `VALID`, while the composite FK stays `NOT VALID` with
  zero violators;
- a different attempt-less ranked insert is rejected with zero residue;
- an explicit collision on the protected primary key is rejected by the PK;
- down restores both exact prior definitions as `NOT VALID` without DML;
- re-up succeeds and preserves the historical row;
- deleting the poison session succeeds, changes expired backlog exactly
  `2 -> 1`, and changes only `chezwizz.session_id`.

Both exact-head verdicts were `PASS` and are persisted verbatim in PR #352's
body. Both independently chose RETAIN for `redacted@example.invalid`.

### Production apply

PR #352 squash-merged at
`60b7078e65669a235eb325dac95a79f3149c649a`. Production migration workflow
`31356925656` re-bound dispatch, event, checkout, remote main, journal tail,
primary branch, direct endpoint, and the single expected owner role before
DDL. Its safe receipt was:

- exact SHA binding PASS;
- journal index 14 / total 15;
- exactly one primary/default branch, one direct read-write endpoint, and one
  `neondb_owner` role;
- preflight 14 applied / 1 pending;
- postflight 15 applied / 0 pending.

Production read-back showed both scoped checks `VALID`, the composite FK still
`NOT VALID` with zero violators, and the complete `chezwizz` fingerprint still
equal to B0 through Unit B.

## Unit C — poison session and residue

### Poison and sweep

Immediately before DML, production still had exactly two expired sessions. The
poison session was first under the application sweep's deterministic
`(expires_at, id)` order. The second was a newer anonymous expired session with
one saved-run reference; its complete safe metadata was recorded in PR #352
before deletion.

The application `sweepExpiredSessions` function ran in one runtime-role
transaction with `limit=1`. Internal assertions made every failed postcondition
roll back the transaction. Actual receipt:

- branch `br-blue-heart-aqcejtyf`;
- role `wcdraft_runtime_20260809`;
- expired backlog `2 -> 1`;
- active sessions `41 -> 41`;
- deleted rows 1;
- delete calls 1 — no per-id fallback;
- historical row count 1;
- `chezwizz.session_id` cleared;
- fingerprint excluding `session_id` preserved;
- routine expired session and saved-run reference retained at C1;
- referential orphan count 0.

The first live verifier's ordinary CSRF bootstrap then reaped the remaining
routine expired session (`1 -> 0`). Its saved-run row remained; only the
session reference cleared through `ON DELETE SET NULL`. Saved-run count stayed 317.

### Residue dispositions

`redacted@example.invalid` was retained. Its account has no username, password,
verification, sessions, owned saved runs, leaderboard entries, or attempts. It
has one consumed sign-in magic link with unknown delivery status. The dispatch
referenced a named PR #344 3-of-5 rubric that is not persisted in #344's body or
committed report. The closest durable five U2 attribution signals score only
2/5: automation-shaped identifier and absence of owned artifacts are true;
known automation window, direct verifier provenance, and fixture provenance
are unproven. The consumed link is counterevidence. The controlling
leave-if-unsure rule therefore requires RETAIN.

`wow`, `testt`, and `team3` were retained by explicit owner decision. Final
read-back found all three rows present. Counts stayed leaderboard entries 4,
users 6, ranked attempts 0, saved runs 317, and magic links 18. Referential
orphan count was zero.

## Unit D — irreversible snapshot deletion

Deletion began only after production migration/read-back, Unit C transaction
read-back, exact deployment readiness, main CI success, and the first live
verifier PASS.

Immediately before each DELETE, Neon control-plane reads established that the
target:

- was the exact named ready child of production;
- was neither primary nor default;
- had zero child branches;
- had no non-terminal operation.

The 1,000-operation audit window reached back to 2026-07-13, before either
target branch was created on 2026-08-07, and therefore covered each target's
complete possible operation lifetime. No project operation was in flight.

Deletion results:

- `br-autumn-hill-aqswkxii` / `pre-u2-lb-residue-20260807T204810Z`: DELETE
  succeeded; direct GET returned HTTP 404; list read-back absent.
- `br-dark-math-aqyfztzk` / `pre-unit-c-residue-20260807T225034Z`: independent
  preflight repeated after the first deletion; DELETE succeeded; direct GET
  returned HTTP 404; list read-back absent.

Final branch inventory is exactly:

1. `br-blue-heart-aqcejtyf` — `production`, primary/default;
2. `br-bold-grass-aqb9vex2` — B0 rollback branch with the dated disposition
   above.

## Deployment and live verification

The production deployment resolved to READY and `/api/health` returned exact
build `60b7078e65669a235eb325dac95a79f3149c649a`, DB ready, auth ready, schema
`runtime-data-2.11.0`, engine
`engine-2026.07.18-basis-aware-tiering`, and season
`season-2026-squad-depth`.

First verifier receipt:
`/private/tmp/wcdraft-live-verify-unit-b-20260810T0503Z`.

- expected and actual forbidden counts before/after: accounts 6, active
  sessions 41, entries 4, magic links 18, attempts 0, saved runs 317;
- permitted expired sessions `1 -> 0`;
- four board ID sets unchanged and empty;
- typed `409 DIFFERENT_BUILD` with the three expected mismatched anchors;
- OG health PASS;
- overall PASS.

Before the final verifier, Neon control plane reported production endpoint
`ep-sparkling-credit-aqff218p` `idle` at `2026-08-10T05:09:02Z`, last active
`05:01:34Z`. No DB or production HTTP request occurred between that proof and
the verifier.

Cold final receipt:
`/private/tmp/wcdraft-live-verify-unit-d-cold-20260810T050902Z`.

- connection warm-up passed on attempt 1/3;
- exact build, health, anchors, season, boards, rejection, and OG health passed;
- forbidden counts stayed 6 / 41 / 4 / 18 / 0 / 317;
- expired sessions stayed `0 -> 0`;
- overall PASS.

## Validation

Implementation/local:

- focused DB migration/runtime: 2 files / 119 tests passed;
- focused auth sweep: 1 file / 5 tests passed;
- root typecheck: 9/9 Turbo tasks;
- root lint: 6/6 Turbo tasks;
- root test: 9/9 Turbo tasks; 2,277 package assertions plus 2 browser-contract
  assertions; game flow PASS; responsive 218 / 0; collision 288 / 0;
  one-screen 216 / 0;
- root build: 5/5 Turbo tasks; 40/40 static pages; runtime traces 8/8 per
  guarded route;
- core goldens 69 + 42; data goldens 60 + 22; leaderboard golden 6;
- generated artifacts, agent contract, migration workflow contract, Prettier,
  and `git diff --check` passed.

Protected CI:

- PR run `31355487635`: required aggregate PASS; Linux
  typecheck/lint/test/build PASS in 25m37s; static/contracts and secret scan
  PASS;
- exact-main CI `31356909068`: all ten jobs PASS, including N=2000 x 3-policy
  realism, golden RNG, DB ephemeral apply/rollback, ETL rating/determinism,
  ingest determinism, secrets, verify/build, and aggregate;
- exact-main ETL `31356909012`: detector, ingest, and Python 3.11/3.12/3.13
  rating-lock jobs all PASS;
- production migration workflow `31356925656`: PASS at exact main.

## Architect-delegated decisions

1. Scope both overlapping CHECKs, because either one alone could abort the
   cascade. This is required behavior, not adjacent constraint cleanup.
2. Leave the composite FK `NOT VALID`; it has zero violators, enforces new
   writes, and is unrelated to the session cascade.
3. Retain `redacted@example.invalid`; the persisted evidence reaches only 2/5
   and the owner explicitly required leave-if-unsure.
4. Use two PRs around the exact-main-only production migration workflow:
   executable migration first, actual production operations second, truthful
   Unit E reconciliation last.
5. Retain B0 for seven days through 2026-08-17, then permit deletion on or after
   2026-08-18 without renewed adjudication unless the owner objects.
6. Use the real sweep with `limit=1` for C1. It deterministically selected the
   poison row, proved the healed batch path, preserved the newer routine row for
   ordinary permitted maintenance, and matched the predicted poison-only
   `2 -> 1` C1 delta.

## Not run and why

- No local ETL suite: no ETL source or output changed; exact-main protected ETL
  and all three rating-lock versions passed.
- No second local heavy-realism run: no engine/data artifact changed; the
  required exact-main N=2000 x 3-policy protected lane passed.
- No canonical owner-document edit: explicitly out of scope; ratification
  remains an owner action.
- No credential rotation, Neon restore, schema-version bump, artifact rebuild,
  or engine/rating change.

## Rollback and remaining actions

- Unit B remains reversible by the committed 0014 down migration until a
  coupled rollback is selected.
- Unit C is reversible only through B0 under
  `docs/runbooks/neon-restore-vercel-rollback.md`; restore POSTs are
  non-idempotent and must never be retried blindly.
- Unit D is irreversible.
- Human actions only: inspect and remove
  `/tmp/wcdraft-live-verify-diagnostics.fhqQWk/`; ratify the corrected
  non-writing definition in the canonical owner docs. Everything else in this
  dispatch is closed.
