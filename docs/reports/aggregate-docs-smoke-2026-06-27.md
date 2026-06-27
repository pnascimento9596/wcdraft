# Aggregate docs-only smoke - 2026-06-27

Temporary verification PR for the aggregate branch-protection lane.

Expected CI behavior:

- `static · format · contracts` runs.
- `secrets · incremental scan` runs.
- heavy CI jobs skip.
- `required · aggregate gates` reports success.
