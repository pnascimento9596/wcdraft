# @wcdraft/data

Runtime data layer for wcdraft. Publishes three deterministic compact
artifacts built from the committed ETL output, plus typed loaders for
browser and Node consumers.

> **Game language:** the project refers to the sport as **football**, never
> "soccer". No official-competition marks, names, or likenesses are used.
> wcdraft is **not affiliated with, endorsed by, or sponsored by any
> official competition or governing body, any participating national
> football association, club, or player.** The not-affiliated disclaimer
> is also shipped on every `RuntimeDataManifest` for the UI to surface.

## Bundles

Artifacts live in `src/generated/` and are mirrored to
`apps/web/public/data/wcdraft/` by `scripts/copy-web-assets.mjs` so Next.js
can serve them as static assets. The manifest, scenario bundle, and compact-size
report are tracked; the oversized draft pool is regenerated on demand and locked
by the tracked manifest/report fingerprints.

| File                         | Shape                 | Purpose                                                                                                                              |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest.json`              | `RuntimeDataManifest` | Schema/dataset/rating/engine/ruleset version anchors + per-bundle sha256/bytes/gzip/brotli + attribution.                            |
| `draft-pool.compact.json`    | `DraftPoolBundle`     | All draftable player + manager cards (1930–2026) + per-card ratings + lookup tables (`nation_by_card_id`, `tournaments`, `nations`). |
| `scenario-2026.compact.json` | `Scenario2026Bundle`  | The 48 real 2026 teams + the published 2026 bracket (groups + knockout slots) + team display names.                                  |

The committed `reports/compact-size.json` records measured raw / gzip /
brotli sizes for each bundle; `size-budget.json` pins the brotli ceiling
(measured brotli + 15% headroom). The data golden test fails if any bundle
exceeds the committed budget.

## Browser delivery contract

Browser clients fetch runtime data from a schema-versioned path:

```text
/data/wcdraft/<runtime-data-schema>/manifest.json
/data/wcdraft/<runtime-data-schema>/draft-pool.compact.json.br
/data/wcdraft/<runtime-data-schema>/scenario-2026.compact.json
```

The fixed legacy paths under `/data/wcdraft/{manifest,draft-pool,scenario}...`
are still mirrored for old clients and server-side filesystem readers, but new
browser code must use the versioned base path exported by
`@wcdraft/data/client`. This removes the mid-deploy hard-fail window where newly
deployed code can receive an edge-cached manifest from a previous runtime schema.

`draft-pool.compact.json.br` is a max-quality Brotli encoding of the exact
`draft-pool.compact.json` bytes fingerprinted by the manifest. Next.js serves
that static file with:

- `Content-Encoding: br`
- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: public, max-age=31536000, immutable`

The browser transparently decompresses it, so `fetch(...).json()` still returns
the normal `DraftPoolBundle`. The invariant is:

```text
sha256(brotli_decompress(draft-pool.compact.json.br))
  == RuntimeDataManifest.bundles.draft_pool.sha256
```

The service worker receives concrete versioned precache URLs from generated
`/sw-version.js` and precaches the compressed draft-pool artifact, not the raw
96 MiB JSON path.

## Retained runtime data

`src/retained-runtime-data/<runtime-data-schema>/` stores the compressed
draft-pool artifact plus manifest and scenario bundle for retained schemas.
`copy-web-assets.mjs` validates every retained directory by decompressing the
`.br` artifact and checking it against its manifest fingerprint, then copies
retained versions alongside the current generated version.

This retention is the atomic-versioning contract for future schema/data bumps:
a client built against version `N` can continue resolving `N` assets after
version `N+1` deploys, while new clients fetch `N+1` from a different path. Keep
at least the immediately previous shipped runtime-data schema retained whenever
the runtime data version changes.

## Loaders

```ts
// Browser — lazy-load on `/play/*` routes
import { loadRuntimeData } from "@wcdraft/data/client";
const { manifest, draftPool, scenario2026 } = await loadRuntimeData();

// Node (tests, scripts)
import { loadRuntimeDataFromDisk } from "@wcdraft/data/node";
const data = await loadRuntimeDataFromDisk({ dir: "/abs/path/to/data/wcdraft" });

// Static import — tests, codegen, dev tooling only. DO NOT use from
// `apps/web` runtime code; statically importing the draft pool would
// pull ~22 MB raw JSON into the initial bundle.
import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST } from "@wcdraft/data";
```

The client loaders fail-fast if `manifest.schema_version` does not match
`RUNTIME_DATA_SCHEMA_VERSION` — that mismatch is the signal that the PWA
service-worker cache + persisted `RunRecord`s must be evicted.

## Determinism guarantees

- The builder reads deterministic ETL outputs under `etl/output/`. The oversized
  historical `ratings.json` is regenerated on demand from committed canonical
  ETL tables and locked by `etl/output/ratings.lock.json`.
- JSON is serialised with sort-by-key at every depth; arrays are
  canonically sorted at the source (cards by `card_id`, managers by
  `manager_card_id`, teams by `team_id`, groups by `group_id`, slots by
  `slot_id`).
- No timestamps or entropy enter the output. `dataset_version` is taken
  from the 2026 ETL manifest's `retrieved_date` (the most volatile pinned
  source), or passed explicitly with `--dataset-version`.
- ETL `tournament_id` strings (`"WC-1998"`) are rewritten to numeric
  runtime IDs (`1998`) everywhere, including `Team2026.squad_card_ids`.
  Source IDs are preserved on every record as `source_card_id` /
  `source_manager_card_id` / `source_tournament_id` for audit.
- `card_id` / `manager_card_id` are rebuilt through
  `buildCardId(player_id, YYYY)` / `buildManagerCardId(manager_id, YYYY)`
  so every emitted runtime ID parses through `parseCardId` /
  `parseManagerCardId`.
- The builder FAILS LOUDLY on any tournament_id not matching `WC-YYYY`,
  any draftable card with no rating, any team with an unknown nation, any
  squad card id pointing outside the emitted pool, or any historical
  `baseline_anchor_estimate` count other than 386.

Two runs of `pnpm --filter @wcdraft/data run build:compact` produce
byte-identical files. The golden test enforces this against the tracked
fingerprints.

## Honest state, preserved on the runtime layer

`appearances`, `goals`, `caps`, `intl_goals`, `matches`, `final_placement`,
`captain`, `overall`, `birth_date`, `position_listed`, `shirt_number`,
`club_at_tournament` — every nullable upstream field stays `null` when the
source did not record it. **NEVER coerced to `0`.**

`RuntimeRating.overall_basis === "baseline_anchor_estimate"` flags the 386
historical cards whose `overall` came from an era-anchor estimate instead
of measured tournament performance. `overall_basis === "career_stature_estimate"`
flags runtime cards where source-derived career/objective-record stature supplies
the headroom path: 480 historical cards plus 61 projected 2026 cards in
`runtime-data-2.3.0`. UI surfaces both as coverage badges — the number is never
rendered as a measured value.

> **2026 projected basis (merit-v4.1):** `proj-career-5.1.0` carries
> `overall_basis` through the compact runtime for projected cards. Most 2026
> cards remain on the measured/current path (`1,185` rows), but citation-backed
> objective-record standouts from the active-career table can now render as
> `career_stature_estimate` (`61` projected rows). This is intentional runtime
> visibility, not a silent fallback.

## ⚠️ Attribution obligation (CC-BY-SA 4.0)

The compact bundles are derived from the following sources and are
**redistributed under the same license** (CC-BY-SA 4.0, ShareAlike) with
attribution preserved verbatim on every `RuntimeDataManifest`:

### Historical 1930–2022

- **The Fjelstul World Cup Database (v1.2.0)** — Joshua C. Fjelstul, Ph.D.
  © 2023 Joshua C. Fjelstul, Ph.D. Used under
  [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode).
  Source: <https://www.github.com/jfjelstul/worldcup> (commit
  `f41e9437a007498bdbf3751305818101f96cb6fb`).

### Pre-1970 appearances supplement

- **Rec.Sport.Soccer Statistics Foundation (RSSSF)** — pre-1970 World Cup
  tournament-appearance counts, used with acknowledgement. Each appearance
  count is the number of a team's matches whose starting XI (no
  substitutes existed pre-1970) lists the player, transcribed from the
  committed RSSSF snapshots and linked to the canonical `player_id` on
  name + nation + tournament. Unlinkable names are withheld (null) and
  emitted for human review.

### 2026 squads, draw, bracket

- **Wikipedia (English)** under
  [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  Pinned revisions:
  - "2026 World Cup squads" (Wikipedia, oldid `1357762108`),
  - "2026 World Cup draw" (Wikipedia, oldid `1357747592`),
  - "2026 World Cup knockout stage" (Wikipedia, oldid `1357752786`),
    retrieved 2026-06-04.

### Modifications by wcdraft

The compact builder normalises the upstream sources into runtime
player/manager cards, per-card ratings, 2026 teams + bracket; canonicalises
`tournament_id` (`WC-YYYY` → numeric `YYYY`); rebuilds `card_id` and
`manager_card_id` via `buildCardId` / `buildManagerCardId`; preserves
source IDs for audit. No upstream values are altered, imputed, or
back-filled; absent signals remain `null`. Ratings are derived by
wcdraft's own era-fair, position-weighted formula from the factual career
signals; **no proprietary (e.g. EA Sports) ratings are ingested or
perturbed.** Compact bundles are redistributed under CC-BY-SA 4.0
(ShareAlike).

## Regeneration workflow

```sh
# 1. Ensure oversized generated ETL/runtime artifacts exist and match locks.
pnpm run check:generated

# 2. Rebuild the compact bundles from deterministic ETL output.
pnpm --filter @wcdraft/data run build:compact

# 3. Mirror them into apps/web (also runs automatically pre-build).
pnpm --filter @wcdraft/data run copy:web-assets

# 4. Validate (determinism + size budget + schema integrity).
pnpm --filter @wcdraft/data run test
```

If a regeneration grows a bundle beyond its committed budget, the golden
test fails. Re-measure with `reports/compact-size.json`, justify the
growth, and bump `size-budget.json` in the same PR.
