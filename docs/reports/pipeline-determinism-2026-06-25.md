# Pipeline determinism closeout — 2026-06-25

## Scope

This lane ships the completed pipeline/determinism units:

- core deterministic code-point ordering and `localeCompare` guard
- narrative tournament-year metadata consumption with backward-compatible fallback
- honest-null mismatch throws in core and ETL
- shared top-scorer implementation
- runtime bundle shape validation
- ETL emitted-row contracts
- `rating_compat` removal from career-stature intermediate artifacts
- leaderboard user recent index plus PGlite runtime migration tests

## Deferred

A7 ETL module split is deferred intentionally. It is a byte-identical maintainability
refactor and should ship as its own focused follow-up rather than expanding this
mixed RED/YELLOW lane.

## Follow-up handoff

`apps/web/lib/game/simulate.ts` must populate `SimWorld.tournamentYears` to activate
the TID-not-equal-year narrative path in app runtime. Core remains backward-compatible:
when `SimWorld.tournamentYears` is absent, narrative facts fall back to the prior
`tournament_id`-as-year behavior.

## Byte-identity

`etl/output/ratings.lock.json` remains locked at
`1084f74194c7d46c66892f4d0328d3d90a728a8cec43956564cffd2ec651f0a0`.
The compact runtime artifacts remain unchanged; the `rating_compat` deletion only
changes intermediate ETL career-stature artifacts and their review/report outputs.
