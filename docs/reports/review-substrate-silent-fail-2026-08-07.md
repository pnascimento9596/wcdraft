# Independent Red-tier review — substrate silent-fail audit

**Date:** 2026-08-07  
**Reviewer:** fresh-context re-executing reviewer (not implementer)  
**Worktree:** `/tmp/ws-fix-substrate-audit`  
**Branch:** `ws-fix/substrate-silent-fail-audit`  
**HEAD under review:** `7f90cd223d6a23a301e031e70e6dfe18a6e2b28c`  
**Base:** `origin/main` @ `0f795aba43dfb686a402d2e152b1d8fe261154c3`

## Verdict

# **PASS**

No blockers. Gates re-executed green. Fix is correctly scoped: sweep progress under poison cascade/CHECK, probe cancellation + single-flight, docs/STATE honesty. CSRF best-effort containment preserved; probe remains application-row read-only; no engine/schema/migration/artifact change.

---

## Scope inspected

| Path                                                     | Role                                                  |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `apps/web/lib/auth/sessions.ts`                          | per-id fallback on batch delete failure               |
| `apps/web/lib/health/auth-probe.ts`                      | `SET LOCAL statement_timeout` + process single-flight |
| `apps/web/app/api/auth/csrf/route.ts`                    | outer best-effort sweep (unchanged; verified)         |
| `apps/web/lib/health/readiness.ts`                       | Promise.race timeout → degraded (unchanged; verified) |
| `packages/db/migrations/0012_*.sql` + `0009_*.sql`       | NOT VALID ranked binding CHECK + SET NULL semantics   |
| `apps/web/lib/auth/__tests__/bootstrap-csrf.test.ts`     | poison-session integration (PGlite)                   |
| `apps/web/lib/health/__tests__/auth-probe.test.ts`       | tx/set_config shape + single-flight                   |
| `apps/web/lib/health/__tests__/readiness.test.ts`        | health mapping regression                             |
| `docs/reports/substrate-silent-fail-audit-2026-08-07.md` | Unit A/B/C report                                     |
| `STATE.md`                                               | ground-truth note                                     |

**Diff footprint:** 6 files, +449 / −20. No `packages/core`, `packages/data` ETL artifacts, no migrations, no schema TS, no production-mutating scripts.

---

## Gates re-executed (this session)

```text
pnpm --filter @wcdraft/db build
  → tsc -p tsconfig.build.json  (exit 0)

pnpm --filter @wcdraft/web exec vitest run \
  lib/auth/__tests__/bootstrap-csrf.test.ts
  → Test Files 1 passed · Tests 5 passed · ~150s wall (PGlite + migrations)

pnpm --filter @wcdraft/web exec vitest run \
  lib/health/__tests__/auth-probe.test.ts
  → Test Files 1 passed · Tests 4 passed · exit 0

pnpm --filter @wcdraft/web exec vitest run \
  lib/health/__tests__/readiness.test.ts
  → Test Files 1 passed · Tests 9 passed · exit 0
```

**Aggregate:** **18/18** required tests **PASS** (re-executed here; not trusted from prior claims).

---

## Mechanism review

### Unit B — `sweepExpiredSessions` per-id fallback

**Defect proven in code + test:**

1. Ranked `leaderboard_entries.session_id` is `ON DELETE SET NULL` (0004).
2. `leaderboard_entries_ranked_attempt_binding_chk` is `NOT VALID` (0012) — exempts pre-existing bad rows at ADD time only; **any later UPDATE must satisfy the check**.
3. Deleting a session referenced by a pre-binding ranked row (`mode='ranked'`, `attempt_id IS NULL`) triggers SET NULL UPDATE → CHECK fails → multi-id `DELETE … IN (…)` aborts entirely.
4. Ordered sweep (`expires_at ASC, id ASC`) keeps the poison id first forever → freeze of expiry hygiene after #341 outer catch restored CSRF minting.

**Fix:** try batch delete; on any failure, sequential per-id deletes with isolated catches. Safe ids reap; poison remains. Return count is honest partial progress.

**Caller contract:** `GET /api/auth/csrf` still wraps sweep in try/catch + security log (`csrf/route.ts:44–52`). Inner catch improves hygiene; it does **not** replace outer best-effort. Sweep still cannot abort cookie-less bootstrap.

**Test quality:** PGlite test drops/re-adds the two NOT VALID CHECKs to seed a production-shaped legacy ranked row, proves single-id delete fails, then asserts sweep deletes 1 (`safe-expired`) and leaves `poison-expired` + `live-ok`. Matches real cascade semantics better than a mock throw.

### Unit C — health auth probe

1. **`SET LOCAL statement_timeout`** via `set_config(..., true)` inside `db.transaction` — server-side cancel of stuck statements; GUC does not leak past tx end. Cap `min(AUTH_PROBE_TIMEOUT_MS, options)` = 2s.
2. **Process single-flight** — concurrent `/api/health` share one in-flight promise; no N-stack of probe txs under load.
3. **Still application read-only:** select limit 1 + `SELECT '1'::text AS ok` shape canary. No session mint; no insert/update/delete of app rows. `set_config` is session GUC only.
4. **Fallback:** if handle lacks `transaction` (unit mocks), bare probes still run without LOCAL timeout — correct for tests; production `getDb()` is drizzle neon-serverless Pool with `transaction`.
5. **Caller race retained:** `resolveAuthHealthStatus` still Promise.races the probe → `"degraded"` on timeout, never fabricates ready.

### Unit A — onset (docs only)

Report classifies onset as option **(2)** (data-shape trigger after poison session expiry 2026-07-21T20:24:09.686Z), not day-one #244. Sign-up path requires CSRF bootstrap (code path agrees: form → `ensureCsrfToken` / mutation CSRF). Investigation artifact (86 non-poison expired sessions deleted on primary via neonctl branch DSN mis-resolution) is disclosed honestly. No code in this commit mutates production.

---

## Invariant confirmations (required)

| Check                                                         | Result                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| No production mutation code in the ship set                   | **Yes** — app code is sweep resilience + probe bound; report only documents prior investigation artifact |
| No engine / schema / migration / runtime-data artifact change | **Yes** — web auth/health + docs/STATE only                                                              |
| Probe still read-only for application rows                    | **Yes** — select + execute canary; LOCAL timeout only                                                    |
| Sweep still best-effort on CSRF path                          | **Yes** — outer try/catch unchanged; inner catch cannot throw past outer                                 |

---

## Blockers

**None.**

---

## Warnings (non-blocking)

1. **Silent per-id catch of all error classes.** Fallback swallows CHECK failures _and_ transient driver errors without log. Acceptable for best-effort sweep; observability gap if batch+all-per-id fail → permanent silent zero. Prefer debug/security log of first fallback failure later.
2. **Poison id is not skipped — it is reselected every sweep.** Comment “next sweep will skip it again” is slightly imprecise: select still includes it; batch fails; per-id fails. Cost is one extra failed DELETE per CSRF sweep while poison lives. Data repair (out of scope, correctly deferred) closes it.
3. **Worst-case CSRF latency under batch poison:** up to ~250 sequential deletes after a failed batch. Rare and bounded; monitor CSRF p99 if more poison shapes appear.
4. **Single-flight captures first caller’s `statementTimeoutMs`.** Production always uses default 2s via health route — fine today.
5. **Pool-acquire hang before `set_config`:** LOCAL timeout not yet applied; single-flight holds the hung promise → health reports degraded via race (correct, not green-lie). Documented tradeoff.
6. **Poison test mutates constraints on shared PGlite and `reset()` only TRUNCATEs.** Test re-adds both NOT VALID CHECKs to production-equivalent definitions before asserting; file-local only; other files spawn their own DB. Fragile if a later test in the same file assumed VALID constraints — not a ship risk today.

---

## Risk tier gate notes

- **Red** (auth substrate / CSRF-adjacent / health). Independent re-execution of stated gates completed with **PASS**.
- Fix-forward not required.
- SHA under review for any merge pin: **`7f90cd223d6a23a301e031e70e6dfe18a6e2b28c`**. Any later commit voids this PASS.

---

## Outcome

**PASS** — approve for Red merge path at SHA `7f90cd2` subject to remaining project process (CI green, SHA-pinned squash, live-verify after deploy). Carryovers: poison ranked row data repair; optional sweep fallback logging; CSRF p99 watch while poison exists.
