# wcdraft

A deterministic World Cup draft simulator — pick squads, simulate tournaments, compare outcomes.

> **Status: WS-0 foundation scaffold.** This repository currently contains only
> the monorepo skeleton, tooling, and the deterministic RNG primitive. There is
> **no** domain model, data, ETL, draft, or simulation logic yet. Domain
> data-contract types (Player, Rating, Sim, DraftState, MatchResult, …) are
> deferred to **WS-0b**, pending an oracle review.

## Disclaimer

**Not affiliated with, endorsed by, or associated with any official competition or
governing body**, including any football federation. "World Cup" is used
descriptively. All trademarks belong to their respective owners.

## Monorepo map

```
wcdraft/
├── apps/
│   └── web/            # Next.js (App Router) front end — placeholder stub page
├── packages/
│   ├── core/           # Deterministic primitives. Today: the seeded RNG.
│   │                   #   (single source of randomness — no domain types yet)
│   └── data/           # Curated datasets + loaders (empty skeleton; CC-BY-SA — see its README)
├── etl/                # Python ETL project (empty skeleton; standalone, not a pnpm workspace)
├── turbo.json          # Turborepo task pipelines (build/lint/typecheck/test)
├── pnpm-workspace.yaml # pnpm workspaces (apps/*, packages/*)
└── tsconfig.base.json  # Shared strict TypeScript config
```

### Workspaces

| Package         | Path            | Purpose                                            |
| --------------- | --------------- | -------------------------------------------------- |
| `@wcdraft/web`  | `apps/web`      | Front end (Next.js App Router). Stub page for now. |
| `@wcdraft/core` | `packages/core` | Deterministic RNG primitive; domain types later.   |
| `@wcdraft/data` | `packages/data` | Datasets + access helpers (empty skeleton).        |
| `wcdraft-etl`   | `etl`           | Python ETL (empty skeleton, standalone).           |

## Determinism

`@wcdraft/core` exposes the **single source of randomness** for the whole system:

```ts
import { createRng } from "@wcdraft/core";

const rng = createRng("any-seed"); // string | number
rng.next(); // float in [0, 1)
rng.int(6); // integer in [0, 6)
rng.pick(["a", "b"]); // uniform element
```

It uses a documented, platform-stable pure-JS PRNG (cyrb128 string→seed +
sfc32 generator) and touches **no** `Date`, `Math.random`, or `crypto`. A given
seed produces a byte-identical sequence on every platform — enforced by a
committed golden fixture (`packages/core/test/fixtures/rng-golden.json`) and a
path-selected golden test (`packages/core/src/rng.golden.test.ts`) that
re-derives the sequence at runtime and is run as a dedicated CI job.

## Getting started

Prerequisites: **Node ≥ 22**, **pnpm ≥ 11** (via Corepack), and (for `etl`)
**Python ≥ 3.11**.

> **Native build scripts:** pnpm 10+ blocks dependency postinstall scripts by
> default. We pre-approve exactly one — `sharp` (a native image pipeline pulled
> in transitively by Next.js) — via `allowBuilds: { sharp: true }` in
> `pnpm-workspace.yaml`, so installs are non-interactive and deterministic in CI.

```bash
corepack enable
pnpm install

pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build

# Front end dev server
pnpm --filter @wcdraft/web dev

# Regenerate the golden RNG fixture (only on an intentional RNG change)
pnpm --filter @wcdraft/core gen:golden
```

## Data attribution (placeholder)

Datasets in `@wcdraft/data` are expected to derive from **CC-BY-SA** sources:

- **The Fjelstul World Cup Database** — Joshua C. Fjelstul (CC-BY-SA).
- **Wikipedia / Wikidata** (CC-BY-SA).

CC-BY-SA requires **attribution** and **ShareAlike** redistribution. Exact
source URLs, snapshot dates, license versions, and attribution strings will be
recorded in `packages/data/` before any data is committed. See
[`packages/data/README.md`](packages/data/README.md).

## License

TBD. (Note: ingested CC-BY-SA data carries ShareAlike obligations independent of
the code license — see above.)
