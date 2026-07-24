# C2 — `Rating.components[]` reachability + payload attribution

**Date:** 2026-07-23  
**Base:** `a1beaaaaa2fe0377128d0b1434aa47d2bda5adca`  
**Risk:** Green — measurement only; no schema change  

## Preregistered decision rule (written before measurement)

Dropping `components` requires a `runtime-data` schema bump, manifest regeneration, retention rotation (current + 2 prior), service-worker data-cache revision, and a full golden re-lock.

**Proceed only if** measurement shows **≥15% reduction in decoded pool size** **or** **≥100 ms reduction in `JSON.parse` wall time on a throttled mid-tier mobile profile**.

Bar is not moved after seeing numbers.

## (a) Static reachability

Instrument: `packages/data/scripts/measure-components-reachability.mts`  
AST sweep over `apps/web` + `packages/core` for property access, element access, destructure, object literal, shorthand, rating-ish spread.

**Result:** **0 runtime reads** of `Rating.components` in web or core production source.

| Classification | Count | Notes |
| -------------- | ----: | ----- |
| runtime | **0** | — |
| schema-type-only | 2 | `packages/core/src/schemas/rating.ts`, `schemas/manager.ts` |
| test-only | 7 | fixtures constructing empty `components: []` |
| unrelated-name | (filtered) | React `components/` imports, Synergy narrative, ScoreComponent locals |

### Offline / data-package hits (outside the AST roots but material)

| File | Class | Role |
| ---- | ----- | ---- |
| `packages/data/scripts/build-compact-data.mjs` | offline-ETL-build | emits + asserts `components` |
| `packages/data/scripts/analyze-g1v1-coherence.mjs` | offline | `rating.components.some(manual_rating_override)` |
| `packages/data/test/compact-data.integrity.test.ts` | test-only | same manual-override probe |
| `packages/data/test/merit-v42.acceptance.test.ts` | test-only | signal lookup via `row.components` |

**Static verdict:** production **sim, draft, and web UI do not read** `Rating.components`. The field is schema/ETL/offline-integrity surface.

## (b) Dynamic falsification

On a throwaway working tree state only (restored after): stripped `components` from every Career + Current rating in `draft-pool.compact.json(.br)`, wrote uncompressed JSON for loaders.

| Suite | Result | Meaning |
| ----- | ------ | ------- |
| Strategic-pick canary | **PASS** (1/1) | **Zero pick flips** |
| Daily seed salt-map golden (uncached vitest) | **PASS** (8/8, ~48 s) | **Byte-identical** salt path / Daily derivation |
| Core golden (rng + narrative) | **PASS** 69/69 | — |
| Draft golden pack | **PASS** 42/42 | Offer path stable |
| Integration (e2e + era presets) | **PASS** 22/22 | — |
| `compact-data.integrity` | **FAIL** 1 test | `r.components.some(...)` — offline integrity **does** read components |
| `compact-data.golden` | FAIL (env) | missing `etl/output/ratings.json` in disposable clone — not a components signal |
| Leaderboard golden | FAIL (env) | `@wcdraft/data/client` not built — not a components signal |

**Dynamic verdict for sim/offer premise:** **TRUE zero-reads.** Daily golden unchanged + canary zero flips ⇔ strip does not move simulation-derived or pick order surfaces.

**Caveat:** dropping the field still requires rehoming the **manual_override** integrity probe (today keyed off `components`).

Throwaway strip was restored; product fingerprints unchanged.

## (c) Payload attribution

Instrument: `packages/data/scripts/measure-bundle-field-attribution.mts`  
Shipped pool: **68,380,413** decoded bytes · **1,311,661** brotli bytes · 12,219 ratings.

### Components size

| Metric | Career | Current | Total |
| ------ | -----: | ------: | ----: |
| Decoded bytes in `components` keys | 25,330,094 | 25,330,094 | **50,660,188** |
| Share of shipped decoded pool | — | — | **74.09%** |

Full JSON round-trip strip:

| | With | Without | Δ |
| - | ---: | ------: | -: |
| Decoded | 68,380,413 | 17,744,663 | **−50,635,750 (−74.05%)** |
| Brotli q=11 re-encode | 1,311,661-class | −597,739 vs with | **−45.6% wire** on re-encode |

### Parse timing (median of ≥5 runs)

| Profile | With | Without | Δ |
| ------- | ---: | ------: | -: |
| Host (darwin arm64, Node 22) | ~250–452 ms | ~50–121 ms | **−200 to −331 ms** |
| Contended proxy (3 busy workers) | **995 ms** | **157 ms** | **−838 ms** |

Host platform is the self-hosted runner analogue for this agent machine. Contended workers are a **proxy** for mid-tier thermal throttle — not a real mobile SoC profile; method recorded in `parse-timing.json`. Even the host alone clears the **100 ms** bar.

### Decision bars

| Bar | Required | Observed | Pass? |
| --- | -------- | -------- | ----- |
| Decoded pool −≥15% | 15% | **74.05%** | **YES** |
| Throttled parse −≥100 ms | 100 ms | **~838 ms** (proxy); host **≥200 ms** | **YES** |

## Verdict: **PROCEED**

Dropping `components` clears the preregistered bar by a wide margin. Real prize is **decode/parse/heap**, not wire (though wire also shrinks ~45% on fair re-brotli).

**Churn cost (honest):** schema bump + manifest + retention + SW cache revision + golden re-lock + rehome integrity manual-override detection. Justified by measured heap/parse win.

**Not done in this lane:** no schema change, no drop.

## Reproduction

```bash
pnpm exec tsx packages/data/scripts/measure-components-reachability.mts
pnpm exec tsx packages/data/scripts/measure-bundle-field-attribution.mts
# strip falsification: delete components from ratings, write json+br, run canary + daily golden, restore
```
