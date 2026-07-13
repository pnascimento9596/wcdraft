# Q4 engine-hygiene dead-code cluster — inert proof (2026-07-12)

Lane Q · Yellow · implementer: Grok 4.5 · base `origin/main` `0955b1f`.

## Items

### 1. `runTokenOgSummary` stub / vestigial token `og` field — **DEFERRED**

| Check | Result |
| ----- | ------ |
| `runTokenOgSummary` symbol | **Not present** (renamed live path) |
| Live API | `buildRunTokenOgSummary` in `apps/web/lib/game/run-token.ts` |
| Call sites | `run-og.test.ts`, OG signing/metadata path |
| Token body `og?` field | Only in **compat test types** (`V3WithVestigialOg`) asserting decode does **not** retain `og` |
| packages/core boundary | Token codec is Season-2 / core territory |

**Reason:** not inert. Removing would break OG summary construction and goldens. Token-adjacent → extra caution; defer any codec evolution to Season 2.

### 2. Leaderboard null-name `COALESCE … IS NOT NULL` filter — **IMPLEMENTED (test lock)**

| Check | Result |
| ----- | ------ |
| Production filter | Already in `boardPage` / related queries: `sql\`${PUBLIC_NAME_EXPR} IS NOT NULL\`` (`store.ts` ~361, ~472) |
| Change this unit | Add board-route test: session row with `displayAlias: null` and no username is excluded; named row ranks 1 |

Behavior-preserving hardening: filter was already live; test prevents regression.

### 3. Stale legend-census `270 → 295` comments — **NO-OP (already current)**

| Check | Result |
| ----- | ------ |
| Code comments with `270 legends` (excl. docs/STATE history/etl) | **None** |
| Live compact / methodology | 295 legends (`etl/RATING_METHODOLOGY.md`, compact build) |
| STATE.md historical rows listing 270 | Left as **historical audit trail** (not stale live claims) |

### 4. `MatchResult` goal-sum superRefine — **DEFERRED (explicit)**

Engine schema / `packages/core` / Season 2 S1 `sim.ts` territory. Out of lane.

## Collision denylist

Target files (`store.ts`, board tests, this report) are **not** on `season/squad-depth` denylist.
