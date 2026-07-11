# Audit S1 C6 — simulation worker prewarm and bench repair

Date: 2026-07-12
Risk: RED
Branch: `ws-f4/audit-s1-sim-worker-prewarm`
Base: `72e9c586e2fb22b70448f1b0bdbc71c6e9903ac2`

## Outcome

The review surface now prewarms one reusable module worker after runtime data
has passed C4 integrity verification. The same worker executes the run when the
player presses Simulate, then remains available until navigation/unmount or a
120-second idle timeout. A separate 120-second active-request watchdog prevents
silent workers from hanging the review CTA. Spawn, runtime, protocol, and worker-side failures
retain the yielded main-thread fallback. Cancellation never falls through to
main-thread simulation.

Monotonic request IDs prevent stale worker replies from winning. The client
rejects concurrent runs, terminates on abort, fully parses successful output,
handles `messageerror`, and removes listeners before teardown. Review owns one operation identity and one
AbortController; only the current non-aborted operation may persist results,
mirror the run, or navigate. Cleanup restores `ready` only when a durable
`simulating` status was written and no result was committed. The durable
`updated_seq` is the ownership witness for both result persistence and cleanup;
a later tab/operation that changes the record makes an older writer conflict
instead of overwriting it.

The worker output remains deterministic-parity equal to `runSimulationSync`.
No core, RNG, scoring, scenario, rating, schema, ETL, generated-data, or version
anchor semantics change.

## Browser fix-forward

The first valid post-rebase root aggregate passed all unit tests but game-flow
failed before responsive adjudication with:

```text
review/results/share flow emitted browser errors:
Illegal invocation
```

Cause: default `setTimeout`/`clearTimeout` references were stored on the client
and later called as properties, supplying the client object as the browser
Web-IDL receiver. Some browser timer implementations reject that receiver.

Fix: bind default timer functions to `globalThis` at construction. A new
receiver-strict unit test substitutes timer functions that throw `Illegal
invocation` unless called with the global receiver; it passes only with the
binding. The standalone browser game-flow and final full aggregate pass.

An earlier attempt to launch focused tests, typecheck, and lint concurrently is
excluded: all three noticed the rebased worktree's stale module state and raced
pnpm's repair, producing `ENOTEMPTY` and stale package-type errors. A single
`CI=true pnpm install --frozen-lockfile` completed cleanly before valid gates.

## Exact-head review fix-forward

The first independent exact-head review at
`1f705b919517e290f4c060979121ba9186d496d0` returned FAIL with one critical and
two high findings. The durable review artifact is
`/tmp/audit-s1-c6-review-1f705b9.md` (SHA-256
`fd07b75e3b399fce43648c693c8f0cf5425c4ab6b37c4df4c4c95c3b530d5cc1`).

- Cleanup previously used an unconditional read-modify-write and could change
  a run completed by another operation back to `ready`, producing an invalid
  record that the next load evicted. Lifecycle writes now carry the durable
  `simulating` record's exact `updated_seq`; completion and recovery require
  that same status/sequence, and non-complete transitions refuse records that
  already carry a simulation. The real regression executes
  `A: simulating -> B: simulating -> B: complete -> A: cleanup` and proves B
  remains complete and loadable.
- A matching-ID `{ kind: "done" }` without payload previously resolved with
  undefined simulation/telemetry. Worker replies now validate safe request ID,
  recognized discriminator, error string, the complete persisted-simulation
  schema, and finite/non-negative-or-null telemetry before they can settle.
- Worker `messageerror` and silent workers previously had no terminal path.
  Deserialization failures now reject and terminate with full listener cleanup;
  the active request watchdog supplies the bounded silent-worker path. Both
  flow through the existing warned, yielded main-thread fallback.

The schema parser was extracted into `simulation-payload.ts` so storage and the
worker protocol share one validator without introducing a runtime dependency
from the worker client back through run-record persistence.

## Leaderboard benchmark repair

`validate.bench.test.ts` now builds requests through the shared public body
builder used by route tests, so required `draft_mode` is present. It remains
opt-in and makes no timing assertion.

Measured command:

```sh
WCDRAFT_LEADERBOARD_BENCH=1 pnpm --filter web exec vitest run \
  lib/leaderboard/__tests__/validate.bench.test.ts --disable-console-intercept
```

Result: 30 real-bundle submissions, p50 5.6 ms, p95 11.4 ms, max 13.6 ms.
These are local telemetry, not a CI threshold or cross-machine performance
claim. The historical p50 7.6 / p95 17.0 values remain labeled as context.

## Validation

- final focused C6/leaderboard set: 5 files passed / 1 skipped, 86 tests passed /
  1 opt-in benchmark skipped;
- final worker-client coverage: 14/14;
- standalone game-flow Playwright: pass;
- opt-in leaderboard benchmark: 1/1;
- root test: 8/8 tasks, 1,951 executed tests, ten expected opt-in skips;
- web unit tests: 1,155 passed / 1 benchmark skipped;
- game-flow plus responsive adjudication: 218 metrics / 0 failures;
- root typecheck 8/8, lint 5/5, build 4/4;
- formatting and `git diff --check`: pass.

Exact-head independent review, protected CI, merge, deployment observation,
production worker-path proof, and post-main CI remain required.
