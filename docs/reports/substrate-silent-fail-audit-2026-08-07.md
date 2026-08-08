# Defect-class audit — silent substrate failures + onset reconciliation (2026-08-07)

**Production at investigation start:** `0f795ab` · schema `runtime-data-2.11.0` ·
engine `engine-2026.07.18-basis-aware-tiering` · season `season-2026-squad-depth`.

**Lane:** investigation-first; code changes only where a reachable defect was proven.

---

## Unit A — Outage onset resolution

### Verdict: **(2)** — the sweep did **not** begin throwing at #244

Sign-ups on **2026-07-17** and **2026-07-20** **do** traverse CSRF bootstrap.
They are **not** consistent with a Jul-11 always-fatal sweep. The actual
trigger is a **data-shape / cascade interaction** that only fires once a
specific expired session enters the sweep selection.

### (1) is false — sign-up requires CSRF bootstrap

| Step          | Evidence                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Client mount  | `apps/web/app/sign-up/sign-up-form.tsx` calls `ensureCsrfToken()`                                      |
| Client submit | `postJson("/api/auth/sign-up", …)` → `readOrFetchCsrfToken` → `GET /api/auth/csrf` when cookie missing |
| Server        | `POST /api/auth/sign-up` → `ensureMutationSession` + `verifyCsrfDoubleSubmit`                          |

Mutations that require double-submit CSRF (non-exhaustive): sign-up, magic-link
request, password login/reset, sign-out, runs save/claim/pin, leaderboard submit
(when a session cookie is present), profile mutations. Cookie-less casual
leaderboard submit short-circuits before CSRF (`identity-gate.ts`) — that path
was already reconciled in the prior forensics for PR #340.

### (2) holds — trigger identified (not a dependency bump)

| Fact                                   | Evidence                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Always-awaited sweep introduced        | `890db10` / PR #244 (2026-07-11) — raw CTE `db.execute`                                                                                                                              |
| Sign-ups after #244                    | Jul 17 + Jul 20 (forensics + live users table)                                                                                                                                       |
| Driver versions stable                 | `@neondatabase/serverless@1.1.0`, `drizzle-orm@0.45.2` from #244 through #341; #289 only bumped test-only `@electric-sql/pglite`                                                     |
| Binding CHECK added                    | `0012` / `86bba8d` / PR #236 (2026-07-10) — `leaderboard_entries_ranked_attempt_binding_chk` **NOT VALID**                                                                           |
| Poison session                         | `tEau21nADcucAH7BGmxgkIZHirnjAxSmxbbNs8H8f0o` · `expires_at = 2026-07-21T20:24:09.686Z` · referenced by ranked entry `4dc1df8e-…` (chezwizz, `attempt_id` NULL)                      |
| Failure mechanism                      | `DELETE sessions` → `ON DELETE SET NULL` on `leaderboard_entries.session_id` → Postgres re-validates the NOT VALID CHECK on UPDATE → check fails → **entire multi-id DELETE aborts** |
| Ordered sweep always hits poison first | `ORDER BY expires_at ASC, id ASC` — poison is the oldest expired row                                                                                                                 |

**Earliest code-capable onset after data condition is live:**
**2026-07-21T20:24:09.686Z** (poison session expiry). From that moment, any
`GET /api/auth/csrf` that awaited the CTE/batch sweep without containment
failed closed with 500 — until #341 made the sweep best-effort
(`98e0368`, 2026-08-07T20:01Z).

**Vercel log floor remains:** retained CSRF 500s start **2026-08-07T01:23:45.609Z**.
Earlier 500s are consistent with this mechanism but **not retained** in CLI
history. Outage window is still stated as **at least ~18.1h on Aug 7**, with
**code-capable full-auth failure likely from Jul 21 20:24Z** once the poison
session was expired and selected first.

**Not a dependency-bump trigger.** No Neon driver version change explains it.
Session-table growth is not required — a single poisoned id freezes the batch.

### Investigation artifact (honest)

While validating on what was intended to be an ephemeral Neon branch
(`br-steep-pine-aq5o5xdv`), `neonctl connection-string --branch-id …`
returned the **primary** endpoint host (`ep-sparkling-credit-aqff218p`), so
**86 non-poison expired sessions were deleted on production**. Impact:

- Live sessions, users (6), leaderboard rows (4), saved_runs (317) intact
- Poison session + chezwizz ranked row **retained** (delete still fails)
- Casual `wow` entry lost `session_id` via intended `ON DELETE SET NULL`
- Equivalent to what a healthy sweep would have done for non-poison ids

Snapshots `br-autumn-hill-aqswkxii` / `br-dark-math-aqyfztzk` were **not**
deleted. No accounts created. No VALIDATE of ranked binding.

---

## Unit B — Defect class

### B1 — Raw `db.execute` / non-query-builder SQL (runtime paths)

| Site                                 | SQL shape                   | Route / job           | Critical?      | Throw containment                                                                                                 |
| ------------------------------------ | --------------------------- | --------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `lib/health/auth-probe.ts`           | `SELECT '1'` + `set_config` | `/api/health`         | Probe (status) | Caught in `resolveAuthHealthStatus` → degraded/error                                                              |
| `lib/health/readiness.ts`            | migrations latest           | `/api/health`         | Yes (schema)   | Caught → `db.status=error` 503                                                                                    |
| `lib/auth/rate-limit.ts`             | UPSERT / CTE sweep          | auth + LB rate limits | Decision path  | Callers map to `RATE_LIMIT_UNAVAILABLE` / fail-closed allow=false; **sweep CTE** contained in LB/expensive-verify |
| `lib/leaderboard/store.ts`           | board page + presence       | GET leaderboard       | Yes            | Route-level                                                                                                       |
| `lib/leaderboard/claim.ts`           | USING deletes               | claim                 | Yes (claim)    | Contained in post-session hook (`AUTH_POST_SESSION_HOOK_FAILED`)                                                  |
| `lib/leaderboard/ranked-attempts.ts` | CTE sweep / consume         | ranked issue/submit   | Yes            | Route/tx                                                                                                          |
| `lib/leaderboard/lineup-route.ts`    | token select                | lineup                | Yes            | Route                                                                                                             |
| `lib/game/saved-runs-store.ts`       | eviction delete             | runs quota            | Yes            | Route                                                                                                             |
| `packages/db` scripts                | various                     | CLI only              | N/A            | CLI                                                                                                               |

**Structurally similar to the historical CTE sweep:**
`sweepOldRateLimits` (CTE DELETE + `rows[0]`). Contained at both call sites
(LB submit + expensive-verify). Not request-aborting today.

**Proven defective class member:** session sweep batch delete under ranked
binding SET NULL (not “rows undefined” — that was a prior hypothesis; the
live failure is **check constraint on cascade UPDATE**).

### B2 — Best-effort paths that can abort a request

| Path                                  | Awaited in request? | Contained?                             |
| ------------------------------------- | ------------------- | -------------------------------------- |
| `sweepExpiredSessions` on CSRF        | yes                 | **yes** after #341 (try/catch + log)   |
| Rate-limit lazy sweeps                | yes (after allow)   | **yes** (try/catch non-fatal)          |
| `onAuthenticatedSessionReady` / claim | yes                 | **yes** (`session-issue.ts` try/catch) |
| Client `save-mirror` fire-and-forget  | browser only        | client-side                            |
| Health auth probe                     | yes                 | yes (status mapping)                   |

No additional uncontained best-effort server path proven beyond the already-fixed
CSRF outer catch. The **remaining** defect was “contained but non-functional”:
sweep always failed the batch, so expiry never progressed past the poison id.

### B3 — Fix applied

`sweepExpiredSessions`: on batch `DELETE … IN (…)` failure, **per-id fallback**
so safe expired sessions are reaped and the poison id is skipped without
aborting the caller (caller already best-effort).

### B4 — Sweep functionality + backlog

| Metric           | At investigation (pre-artifact)                                                                                                                   | After accidental non-poison cleanup | After this fix (expected)                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| Expired sessions | **87**                                                                                                                                            | **1** (poison only)                 | **1** (poison remains until binding data repair — out of scope)         |
| Live sessions    | 45                                                                                                                                                | 45                                  | 45                                                                      |
| Proof            | Ephemeral intent + SQL: delete poison alone fails with `ranked_attempt_binding_chk`; delete others succeeds; unit test reaps safe + leaves poison | —                                   | PGlite test `still reaps safe expired sessions when one id is blocked…` |

The rewritten query-builder sweep was **structurally sound** but **still
non-functional in production** after #341 because the batch always included
the poison id first. CSRF bootstrap recovered; expiry hygiene did not.

---

## Unit C

### C1 — Health probe cancellation

**Implemented:**

1. **Postgres `SET LOCAL statement_timeout`** inside a probe transaction
   (`set_config(..., true)`), capped at `AUTH_PROBE_TIMEOUT_MS` (2s) — cancels
   the in-flight statement server-side (driver has no reliable AbortSignal
   cancel for neon-serverless Pool queries).
2. **Process-local single-flight** so concurrent `/api/health` polls share one
   in-flight probe and cannot stack N connections during a slow-DB episode.

Still never mints a session or writes application rows.

### C2 — Cross-model verdict (PR #344 Unit B + this lane)

See PR body / final report for the **verbatim** PASS/FAIL block produced by
the conforming cross-model pass in this lane.

---

## Architect-delegated decisions

1. **Classify onset as (2) with data-shape trigger, not (1).** Sign-up code
   path requires CSRF; Jul 17/20 successes force a post-#244 trigger. Poison
   session expiry + NOT VALID CHECK revalidation is the concrete mechanism.
2. **Do not VALIDATE ranked binding or invent an attempt for chezwizz.** Fix
   sweep resilience instead of mutating historical ranked data.
3. **Per-id fallback over hardcoding CHECK predicates in the select.** Future
   cascade/CHECK poisons get the same progress-over-freeze behavior.
4. **statement_timeout LOCAL + single-flight** for health probe (true cancel
   available via Postgres; AbortSignal not reliable on this driver).
5. **Report the accidental production expired-session cleanup honestly** as an
   investigation artifact; do not paper over it; no restore required for
   board/account integrity (poison + boards intact).
