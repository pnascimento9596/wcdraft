# @wcdraft/data

Runtime data layer for wcdraft. Publishes three deterministic compact
artifacts built from the committed ETL output, plus typed loaders for
browser and Node consumers.

> **Game language:** the project refers to the sport as **football**, never
> "soccer". No FIFA marks, names, or likenesses are used. wcdraft is **not
> affiliated with, endorsed by, or sponsored by FIFA, the FIFA World Cup,
> any participating national football association, club, or player.** The
> not-affiliated disclaimer is also shipped on every `RuntimeDataManifest`
> for the UI to surface.

## Bundles

All artifacts live in `src/generated/` (committed) and are mirrored to
`apps/web/public/data/wcdraft/` by `scripts/copy-web-assets.mjs` so Next.js
can serve them as static assets.

| File | Shape | Purpose |
|------|-------|---------|
| `manifest.json` | `RuntimeDataManifest` | Schema/dataset/rating/engine/ruleset version anchors + per-bundle sha256/bytes/gzip/brotli + attribution. |
| `draft-pool.compact.json` | `DraftPoolBundle` | All draftable player + manager cards (1930–2026) + per-card ratings + lookup tables (`nation_by_card_id`, `tournaments`, `nations`). |
| `scenario-2026.compact.json` | `Scenario2026Bundle` | The 48 real 2026 teams + the published 2026 bracket (groups + knockout slots) + team display names. |

The committed `reports/compact-size.json` records measured raw / gzip /
brotli sizes for each bundle; `size-budget.json` pins the brotli ceiling
(measured brotli + 15% headroom). The data golden test fails if any bundle
exceeds the committed budget.

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

- The builder reads only committed inputs (`etl/output/*.json`).
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
  `baseline_anchor_estimate` count other than 388.

Two runs of `pnpm --filter @wcdraft/data run build:compact` produce
byte-identical files. The golden test enforces this.

## Honest state, preserved on the runtime layer

`appearances`, `goals`, `caps`, `intl_goals`, `matches`, `final_placement`,
`captain`, `overall`, `birth_date`, `position_listed`, `shirt_number`,
`club_at_tournament` — every nullable upstream field stays `null` when the
source did not record it. **NEVER coerced to `0`.**

`RuntimeRating.overall_basis === "baseline_anchor_estimate"` flags the 388
historical cards whose `overall` came from an era-anchor estimate instead
of measured tournament performance. UI surfaces this as a coverage badge —
the number is never rendered as a measured value.

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
  - "2026 FIFA World Cup squads" (oldid `1357762108`),
  - "2026 FIFA World Cup draw" (oldid `1357747592`),
  - "2026 FIFA World Cup knockout stage" (oldid `1357752786`),
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
# 1. Rebuild the compact bundles from the committed ETL output.
pnpm --filter @wcdraft/data run build:compact

# 2. Mirror them into apps/web (also runs automatically pre-build).
pnpm --filter @wcdraft/data run copy:web-assets

# 3. Validate (determinism + size budget + schema integrity).
pnpm --filter @wcdraft/data run test
```

If a regeneration grows a bundle beyond its committed budget, the golden
test fails. Re-measure with `reports/compact-size.json`, justify the
growth, and bump `size-budget.json` in the same PR.
