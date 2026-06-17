# wcdraft

A deterministic World Cup draft simulator: spin World Cup squads, draft one
player per spin plus a manager, simulate the 2026 bracket, and compare runs.

Current production anchors are recorded in
[`STATE.md`](STATE.md). Accounts/email sign-in is live. Leaderboard submission
uses server replay; ranked submissions require a signed-in account, while casual
submissions can stay anonymous-with-claim.

## Disclaimer

**Not affiliated with, endorsed by, or associated with any official competition or
governing body**, including any football federation. "World Cup" is used
descriptively. All trademarks belong to their respective owners.

## Monorepo map

```
wcdraft/
├── apps/
│   └── web/            # Next.js App Router game, auth, share, leaderboard UI
├── packages/
│   ├── core/           # Domain contracts, deterministic draft/sim engine, RNG
│   ├── data/           # Runtime compact bundles, loaders, data integrity tests
│   └── db/             # Drizzle schema, migrations, Neon branch checks
├── etl/                # Deterministic Python ETL and ratings pipeline
├── turbo.json          # Turborepo task pipelines (build/lint/typecheck/test)
├── pnpm-workspace.yaml # pnpm workspaces (apps/*, packages/*)
└── tsconfig.base.json  # Shared strict TypeScript config
```

### Workspaces

| Package         | Path            | Purpose                                                 |
| --------------- | --------------- | ------------------------------------------------------- |
| `@wcdraft/web`  | `apps/web`      | Next.js game, share/results, auth, and leaderboard app. |
| `@wcdraft/core` | `packages/core` | Domain contracts, deterministic draft/sim engine, RNG.  |
| `@wcdraft/data` | `packages/data` | Compact runtime data, loaders, integrity/golden gates.  |
| `@wcdraft/db`   | `packages/db`   | Database schema, migrations, and rollback checks.       |
| `wcdraft-etl`   | `etl`           | Deterministic Python ETL and rating generation.         |

## Determinism

`@wcdraft/core` exposes the single source of randomness for the engine:

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

The draft and sim engine also avoid wall-clock state and hidden entropy. Runtime
share tokens carry version anchors so stale runs fail honestly instead of being
silently re-simulated against a different season.

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

## Data Attribution

Runtime data in `@wcdraft/data` derives from committed, pinned sources and is
redistributed with attribution. The shipped manifest records source revisions,
license URLs, bundle hashes, and byte sizes.

- **The Fjelstul World Cup Database** — Joshua C. Fjelstul (CC-BY-SA).
- **Wikipedia** 2026 squad/draw/bracket snapshots (CC-BY-SA).
- **RSSSF** match-archive appearance supplements, used with acknowledgement.

No proprietary player-rating feeds are ingested. Absences are preserved as
`null` or omitted when a field is not applicable for an era; the ETL and compact
builder must not fabricate zeroes.

See `packages/data/src/generated/manifest.json` and
[`packages/data/README.md`](packages/data/README.md).

## License

TBD for source code. Ingested CC-BY-SA data carries ShareAlike obligations
independent of the code license; keep attribution visible in redistributed
runtime bundles and UI surfaces.
