# Lane B RF-02 — GLM 5.2 MAX adversarial review

- Model: `ollama-cloud/glm-5.2` via OpenCode CLI (`--variant max`) — **Ollama Pro Cloud, not OpenCode Go**
- Branch: `ws-core/resim-kernel`
- Date: 2026-08-07

## Implementer triage

- **STATUS accepted: PASS.** No blockers.
- W1/W2 informational (message drop on OG path is intentional parity).
- G1/G2 pre-existing coverage gaps — deferred, not regressions.
- Local re-exec: 172 tests across OG/validate/lineup/submit green; web typecheck clean.

## Structured verdict (GLM)

STATUS: PASS\*\*

Verified against the actual extraction on branch `ws-core/resim-kernel` (uncommitted: 2 modified + 1 new file). Re-ran all six kernel-consumer test files (121 tests, all pass), `tsc --noEmit` clean, `eslint --max-warnings=0` clean.

### BLOCKERS

None.

### WARNINGS

None material.

**W1 (informational, not a defect):** The kernel's `reason` union is `"ILLEGAL_PICK" | "SIM_FAILURE"`. The OG adapter widens this to `"MALFORMED" | "UNSUPPORTED_VERSION" | "WRONG_SEASON" | "ILLEGAL_PICK" | "SIM_FAILURE"` and forwards `resim.reason` directly. TypeScript structural narrowing confirms the kernel's two values are a subset of the OG union, so the assignment `reason: resim.reason` typechecks (confirmed by passing `tsc`). No runtime risk.

**W2 (informational):** Error-message parity differs by design between the two adapters and is CORRECT. The OG adapter intentionally drops `resim.message` (its rejected shape has no `message` field, matching the pre-extraction `catch {}` that discarded the message). The validate adapter forwards `resim.message` into `rejected(resim.reason, resim.message)`, matching the pre-extraction `err instanceof Error ? err.message : String(err)`. The existing OG tests assert strict `.toEqual({ status: "rejected", reason: "ILLEGAL_PICK" })` and still pass — confirming no `message` leaks into the OG rejected shape.

### NITS

**N1:** `verify-and-resim-run-token.ts:27` imports `type { RunRecordV1 }` and the kernel constructs a `record` object inline (lines 68-77). This ephemeral `RunRecordV1` construction is identical to both originals. It's a code smell that the kernel builds a full record just to feed `buildSimWorldInputs`, but it matches the pre-extraction contract exactly — changing it would be out of scope and risk a behavior delta. Leave as-is.

**N2:** `RunRecordV1` import is type-only and used only for the local `record` literal annotation. The kernel could omit the explicit type annotation (inference would work), but keeping it aids readability and matches the originals. No action needed.

### COVERAGE_GAPS

**G1 (pre-existing, not introduced here):** No SIM_FAILURE test exists for the **OG** path (`run-og.test.ts` has zero `SIM_FAILURE` assertions; only `submit-route.test.ts:575` covers SIM_FAILURE for validate). The kernel's outer-catch → SIM_FAILURE branch is exercised for validate via the route test (broken server scenario) but is NOT exercised for OG. This gap predates the extraction — the original OG also had no SIM_FAILURE test — so it's not a regression. Recommend a follow-up OG SIM_FAILURE test (e.g., feed a scenario that causes `runTournamentFull` to throw after a valid replay) to close the gap now that both consumers share the seam. Low priority since the classification logic is identical and the validate path covers it.

**G2 (pre-existing):** No test asserts the v1/v2 → ILLEGAL_PICK path through the **validate** adapter specifically (the kernel doc claims v1/v2 fail as ILLEGAL_PICK via `reconcileRunToken`). The behavior is identical to pre-extraction (validate never had an explicit v1/v2 filter; it relied on `reconstructPickedDraftFromToken` throwing). Existing validate tests cover MALFORMED_TOKEN for unparseable tokens but not the "decodes successfully as v1/v2, then fails replay" case. Not a regression; recommend a follow-up test.

### RECOMMENDED_FIXES

1. **(Optional, low priority)** Add one OG SIM_FAILURE test and one validate v1/v2→ILLEGAL_PICK test to close G1/G2. These are pre-existing gaps, not blockers for this extraction.

### Parity verification (adversarial tasks 1–7)

1. **Behavior parity (OG):** Original `verifyRunTokenForOg` used bare `catch {}` (discarded message) for both ILLEGAL_PICK and SIM_FAILURE, returning `{ status: "rejected", reason: "..." }` with no message. New adapter does the same — `resim.reason` forwarded, `resim.message` dropped. OG tests at `run-og.test.ts:474, 754` assert strict equality and pass. ✓

2. **Behavior parity (validate):** Original forwarded `err.message` via `rejected("ILLEGAL_PICK", err instanceof Error ? err.message : String(err))` for both the pre-sim and post-sim reconcile catches, and `rejected("SIM_FAILURE", err.message)` for the outer catch. The kernel captures identically (`err instanceof Error ? err.message : String(err)`) and validate forwards via `rejected(resim.reason, resim.message)`. HTTP mapping unchanged (`ILLEGAL_PICK: 422`, `SIM_FAILURE: 500` in `SUBMIT_ERROR_HTTP_STATUS`). ✓

3. **Gate ordering:** `submissionPreflight` runs FIRST in `validateSubmission` (lines 351-352). BAD_ATTEMPT is a route-layer gate (step 6) interleaved by the caller between preflight and kernel — unchanged. The kernel is invoked AFTER preflight returns `status: "ok"`. OG runs MALFORMED → UNSUPPORTED_VERSION → WRONG_SEASON before the kernel (lines 34-41). No early kernel invocation. ✓

4. **Circular imports / purity:** Kernel imports only `@wcdraft/core`, `@wcdraft/data`, and sibling `./data` (type), `./run-record` (type), `./run-token`, `./simulate`. None import back to the kernel. The OG→validate (type-only) and validate→kernel edges create no cycle. Kernel is pure: no I/O, no clock, no ambient state — deterministic over `(token, gameData, scenario)`. ✓

5. **Legacy v1/v2 vocabulary:** Remains ILLEGAL_PICK, not MALFORMED. A v1/v2 token reaching the kernel triggers `reconstructPickedDraftFromToken` → `RunTokenError("legacy token version cannot replay...")` → caught by kernel's first catch → ILLEGAL_PICK. OG filters v1/v2 as UNSUPPORTED_VERSION before the kernel (unchanged). Validate has no explicit v1/v2 filter (unchanged from original) and relies on the same reconcile throw. ✓

6. **Nested try/catch semantics:** The kernel preserves the EXACT nested structure: outer try wraps `buildSimWorldInputs` + `buildRunScenario` + `runTournamentFull` + inner try; inner try wraps `reconcileRunToken(token, gameData, result.matches)`; inner catch → ILLEGAL_PICK; outer catch → SIM_FAILURE. This matches both originals precisely. The critical invariant — a post-sim reconcile failure classifies as ILLEGAL_PICK (not SIM_FAILURE) because it indicates a forged `mp`/`a` fact, not an engine fault — is preserved. ✓

7. **Missing consumers / duplicated blocks:** The only other `runTournamentFull` callers are `simulate.ts` (the canonical `runSimulation` pipeline used by `run-screen-loader.ts` for display replay — a DIFFERENT pipeline that uses `virtualRecordFromToken` + async sim + `reconcileRunToken` for mp/a validation, not verification) and test harnesses (`_harness.ts` builds expected scores; ceremony tests). No duplicated verification block remains. The `run-screen-loader.ts:128` `reconcileRunToken(decoded.token, gameData, simulation.matches)` is the display-replay mp/a check and is correctly NOT migrated (it's not a verification path; it has different error semantics — returns `{ kind: "invalidToken", reason: ... }`). ✓

### CONFIDENCE

**High.** Reviewed the actual uncommitted diff plus all four dependent source files (`run-token.ts`, `tournament.ts`, `types/run.ts`, `simulate.ts`), the original pre-extraction `run-og-server.ts` and `validate.ts` via `git show HEAD`, executed the six relevant test suites (121/121 pass), typecheck, and lint. The extraction is a faithful mechanical move with zero behavior delta. The only gaps are pre-existing test coverage holes (G1/G2) that this extraction neither creates nor worsens.
