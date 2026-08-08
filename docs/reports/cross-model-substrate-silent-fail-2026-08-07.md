# Cross-model review — substrate silent-fail audit (2026-08-07)

**Reviewer role:** second independent fresh-context Red-tier review (cross-model fallback path)  
**Implementer ≠ this reviewer**  
**Worktree:** `/tmp/ws-fix-substrate-audit`  
**Commit under review:** `7f90cd223d6a23a301e031e70e6dfe18a6e2b28c`  
**PR:** https://github.com/pnascimento9596/wcdraft/pull/345  
**Also re-reviewed:** PR #344 Unit B health-probe design at `0f795aba43dfb686a402d2e152b1d8fe261154c3`

---

## Verbatim verdict

STATUS: PASS

### Concerns (non-blocking)

1. **Per-id fallback swallows all errors** (`sessions.ts` catch bodies). A transient connection failure mid-loop looks like “deleted N of M” with no log. Acceptable for best-effort expiry; optional first-failure debug log would improve incident forensics without changing control flow.
2. **Poison id is reselected every sweep** (not skipped). Batch fails → per-id retry fails → leave row. Bounded extra work (one failed DELETE per sweep while poison remains). Comment that the next sweep “will skip it again” is slightly imprecise; behavior is retry-and-fail, not SELECT exclusion. Harmless.
3. **Single-flight is process-local** and joins the first caller’s options/`statementTimeoutMs`. Production always uses the default via `app/api/health/route.ts`; no mismatch today. Document if other callers are added.
4. **Pool-acquire hang before `set_config`:** LOCAL timeout never applies until a connection is obtained; `inFlightProbe` stays set until the hung work settles. Concurrent health polls correctly share that promise and surface `degraded` via Promise.race (no fabricated green, no stacked probes). Tradeoff is intentional.
5. **Sequential per-id fallback** can add up to ~250 round-trips on CSRF when a poison id is in the selected set. Rare and bounded; monitor CSRF p99 only if more poison rows appear.
6. **Auth `unconfigured` remains non-blocking** (`ok: true` when secret/DB missing but no error/degraded). Honest (payload says `unconfigured`, never `ready`). Intentional for local/dev; not a green lie for substrate failure.
7. **Poison integration test mutates constraints** (DROP/ADD NOT VALID on PGlite) then truncates rows only. Constraints end restored as NOT VALID (same shape as 0012). File-local; fine given pass.

---

## Check matrix (re-executed against code)

### 1. Best-effort sweep cannot abort CSRF (route try/catch) — PASS

Evidence: `apps/web/app/api/auth/csrf/route.ts`

- Dedicated try/catch around `await sweepExpiredSessions(deps)` (lines 44–52).
- On failure: structured `logSecurityEvent({ code: "AUTH_UNEXPECTED_ERROR", … })` only; control continues to session validate / bootstrap mint.
- Cookie-less bootstrap remains pure crypto (`createBootstrapCsrf`); no durable mint on GET.
- Regression: `csrf-route-bootstrap.test.ts` — “still bootstraps when the expiry sweep throws”.
- Defense in depth: PR #345 also makes batch delete failures non-throwing when per-id fallback completes; SELECT failures still contained by the route catch.

### 2. Per-id fallback unfreezes expiry when poison ranked binding blocks SET NULL — PASS

Evidence: `apps/web/lib/auth/sessions.ts` `sweepExpiredSessions`

- Select: `expires_at <= now` ordered `expires_at ASC, id ASC`, limit bounded 1..1000.
- Try batch `DELETE … WHERE id IN (…)` + `returning`.
- On any batch failure: sequential per-id delete; per-id CHECK/cascade failures swallowed; count of successful deletes returned.
- Mechanism matches production poison class: `leaderboard_entries.session_id` `ON DELETE SET NULL` re-validates `leaderboard_entries_ranked_attempt_binding_chk` (NOT VALID does not exempt later UPDATEs).
- Integration proof: `bootstrap-csrf.test.ts` “still reaps safe expired sessions when one id is blocked by pre-binding ranked SET NULL”:
  - Seeds poison + safe expired + live.
  - Inserts pre-binding ranked row under temporarily dropped checks, re-adds NOT VALID checks.
  - Proves solo delete of poison fails with check/Failed query.
  - `sweepExpiredSessions` returns `1`; remaining `["live-ok", "poison-expired"]`.

### 3. Health probe: LOCAL statement_timeout + single-flight; no session mint; no writes — PASS

**PR #344 baseline (`0f795ab`):**

- New `auth-probe.ts`: read-only sessions select (same order/limit shape as sweep select, limit 1) + `SELECT '1'::text` execute shape canary.
- `cookieSecretIsConfigured` (≥32 decoded base64url bytes).
- Wired from `app/api/health/route.ts` via `probeAuthBootstrapDependencies(getDb(), Date.now())`.
- `readiness.resolveAuthHealthStatus`: Promise.race vs `AUTH_PROBE_TIMEOUT_MS` (2s); timeout → `degraded`; throw → `error`; success → `ready`.
- No insert/update/delete of application rows; no session mint.

**PR #345 extension (`7f90cd2`):**

- Real server-side cancel: `db.transaction` + `set_config('statement_timeout', <ms>, true)` (LOCAL) before read-only probes; timeout clamped to `AUTH_PROBE_TIMEOUT_MS`.
- Fallback to bare probes only when `transaction` is absent (unit-test mocks).
- Process-local single-flight (`inFlightProbe`) so concurrent `/api/health` share one in-flight probe; test-only `__resetAuthProbeSingleFlightForTests`.
- Still no application-row writes / no session mint (`set_config` is session-local GUC only).

Pool default `statement_timeout` remains 8s (`packages/db` RUNTIME_POOL_TIMEOUTS); LOCAL 2s tightens the probe path as intended. Promise.race alone does not cancel Neon Pool queries; LOCAL does.

### 4. Honest degraded/error (no fabricated green) — PASS

Evidence: `apps/web/lib/health/readiness.ts` + tests

| Condition                      | auth.status                    | ok / HTTP                                         |
| ------------------------------ | ------------------------------ | ------------------------------------------------- |
| Missing DB and/or empty secret | `unconfigured`                 | non-blocking (`ok` true if not error/degraded)    |
| Weak non-empty secret          | `error`                        | `ok: false` 503                                   |
| Probe not wired                | `unconfigured`                 | not `ready`                                       |
| Probe throws                   | `error`                        | `ok: false` 503; body scrubbed of driver messages |
| Probe times out                | `degraded`                     | `ok: false` 503                                   |
| Probe OK + schema OK           | `ready`                        | `ok: true` 200                                    |
| Probe OK + schema mismatch     | `ready` + `db.schema_mismatch` | `ok: false` 503                                   |

`authIsBlocking` = `error | degraded` only. Never maps failure to `ready`. Tests cover throw, timeout, weak secret, missing secret, happy path.

### 5. No engine/schema/artifact change — PASS

Diff `0f795ab..7f90cd2` / PR #345 paths only:

- `STATE.md`
- `apps/web/lib/auth/sessions.ts`
- `apps/web/lib/auth/__tests__/bootstrap-csrf.test.ts`
- `apps/web/lib/health/auth-probe.ts`
- `apps/web/lib/health/__tests__/auth-probe.test.ts`
- `docs/reports/substrate-silent-fail-audit-2026-08-07.md`

No `packages/core`, `packages/data`, `packages/db` schema/migrations, ETL, or generated artifacts.

PR #344 Unit B added health wiring + readiness auth status only (plus forensics/residue docs and live-verify script); no engine/rating/sim/schema artifact changes in the Unit B surface re-reviewed here.

---

## Gates re-run (this review)

Command requested:

```bash
pnpm --filter @wcdraft/web exec vitest run lib/health/__tests__/ lib/auth/__tests__/bootstrap-csrf.test.ts
```

Combined invocation hit the wrapper timeout after health files passed (import/PGlite cold-start contention observed in this environment). Re-executed as equivalent focused files:

| Suite                                       | Result                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `lib/health/__tests__/auth-probe.test.ts`   | **4/4 pass**                                         |
| `lib/health/__tests__/readiness.test.ts`    | **9/9 pass**                                         |
| `lib/auth/__tests__/bootstrap-csrf.test.ts` | **5/5 pass** (includes poison ranked SET NULL sweep) |

**Total: 18/18 pass** (same set as the requested command).

---

## Scope notes (out of this review’s blocking bar)

- Onset reconciliation (option 2) in `docs/reports/substrate-silent-fail-audit-2026-08-07.md` is consistent with the code mechanism; not re-litigated as a ship gate.
- Poison session remaining until owner binding-data decision is documented carryover, not a regression of this fix.
- Investigation artifact (accidental non-poison expiry cleanup via neonctl DSN) is honesty documentation only.

---

## Summary

All five conforming checks pass. CSRF remains non-aborting on sweep failure; per-id fallback restores expiry progress past ranked-binding poison; health probe gains real Postgres cancel + single-flight without mint/writes; degraded/error stay non-green; no engine/schema/artifact surface in the lane.

STATUS: PASS
