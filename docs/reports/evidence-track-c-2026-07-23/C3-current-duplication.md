# C3 — Current-basis duplication attribution

**Date:** 2026-07-23  
**Base:** `a1beaaaaa2fe0377128d0b1434aa47d2bda5adca`  
**Risk:** Green — measurement only; no encoding change

## Method

Instrument: `packages/data/scripts/measure-bundle-field-attribution.mts`.

For each of 12,219 ratings, compare Career top-level fields to `basis_ratings.current` field-by-field. A field is **duplicated** when both sides present and `JSON.stringify` equal. Bytes are `Buffer.byteLength(JSON.stringify({[key]: value}))` for the Current copy (honest double-count of structural quotes/braces per key; relative family shares are valid).

Families: identity · provenance · metadata · channels · overall · components · remainder.

## Family decoded-byte attribution (per-key sum)

| Family         | Career top-level |  Current basis |
| -------------- | ---------------: | -------------: |
| identity       |          872,913 |        872,913 |
| provenance     |        2,315,047 |      2,313,432 |
| metadata       |        1,345,793 |      1,357,798 |
| channels       |          733,146 |        733,140 |
| overall        |          171,066 |        171,066 |
| **components** |   **25,330,094** | **25,330,094** |
| remainder      |                0 |              0 |

Player-card families (shared once, not dual-basis) and top-level nations/managers/tournaments are outside the Career/Current duplication question; see JSON for those.

## Duplication totals

### With `components` present (shipped)

| Quantity                              |                           Bytes |
| ------------------------------------- | ------------------------------: |
| Duplicated Current-copy decoded bytes |                  **29,548,803** |
| Career-only field bytes               |                      (see JSON) |
| Current diverged / only               |                      (see JSON) |
| Dup ratio vs Current family sum       | ~**high** — components dominate |

Duplication **by family** (Current copy of equal fields):

| Family     |      Dup bytes |
| ---------- | -------------: |
| components | **25,330,094** |
| provenance |      2,291,784 |
| identity   |        872,913 |
| channels   |        698,657 |
| metadata   |        195,209 |
| overall    |        160,146 |

**~85.7% of measured Career↔Current equal-field duplication is `components`.**

### Without `components` (hypothetical post-C2)

| Quantity                              |         Bytes |
| ------------------------------------- | ------------: |
| Duplicated Current-copy decoded bytes | **4,218,709** |

Non-component residual duplication (~4.2 MB decoded of equal identity/provenance/channel/overall/metadata copies) is the true addressable surface for a delta-encoding / expand-at-load proposal.

## Wire (brotli)

Fair full-bundle re-encode at quality 11: stripping components alone drops re-encoded brotli by **~45.6%** (see C2). Per-family brotli is not separately stable (cross-key dictionary effects); use full-bundle deltas for wire claims.

## Sequencing vs C2

**If both C2 and a Current-delta lane are considered: run C2 first.**

1. C2 removes ~25 MB × 2 of components and collapses ~85% of the measured duplication total.
2. C3 after C2 leaves a **~4.2 MB** equal-field residual — still real, but an order of magnitude smaller, and may or may not clear a Red schema bar on its own.
3. Opening delta-encoding **before** C2 would encode mostly components noise and force a second schema churn when components drop.

## Verdict

- **Duplication claim confirmed** for identity/provenance/metadata/channels/overall **and** massively for components.
- **Do not open a Red encoding lane on the with-components arithmetic alone.**
- **Re-evaluate residual ~4.2 MB after a C2 PROCEED ship** before scoping expand-at-load.

## Reproduction

```bash
pnpm exec tsx packages/data/scripts/measure-bundle-field-attribution.mts
# see c3_families.duplication.{with_components,without_components}
```
