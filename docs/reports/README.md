# docs/reports — review & gate reports

Landing zone for independent-review reports, gate re-executions, and lane final reports
that deserve repo permanence (investigations stay in `docs/investigations/`).

- Naming: `<topic>-YYYY-MM-DD.md`.
- A report records: subject SHA(s) · gates re-executed with REAL counts · verdict
  (blockers vs non-blocking) · carryovers. Never assert a gate you did not run.
- Red-tier reviews must state the pinned head SHA the verdict applies to.
