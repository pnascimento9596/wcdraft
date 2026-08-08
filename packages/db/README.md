# @wcdraft/db

**F-1 RED — schema + migrations only.** Server-only database layer for the
wcdraft engagement/retention surface (Phase F): optional auth, saved-run
history, and the leaderboard. Built on [Drizzle ORM](https://orm.drizzle.team/)
over Neon Postgres.

## What's in F-1

Greenfield additive scaffold:

- Six tables (Drizzle schema in `src/schema/`):
  `users`, `magic_link_tokens`, `sessions`, `saved_runs`, `ranked_attempts`,
  `leaderboard_entries`.
- **UNIQUE NULLS NOT DISTINCT (Postgres 15+) on anonymous-dedupe surfaces**:
  - `saved_runs (owner_user_id, token)`
  - season `leaderboard_entries (season_key, mode, user_id, token)`

  This closes the anon-spam vector an independent reviewer caught on PR #26
  — plain unique indexes on nullable columns are toothless under Postgres'
  default NULLS-DISTINCT semantics. Daily leaderboard entries intentionally use
  per-day identity uniqueness instead of token dedupe so shared daily seeds and
  replay links can submit under different identities.

- DB-level CHECK enums on `saved_runs.claim_state` (`'anonymous'|'claimed'`)
  and `leaderboard_entries.mode` (`'casual'|'ranked'`).
- Initial migration (`migrations/0000_init.sql`) creates all six tables in
  one transaction, plus a hand-authored down-migration
  (`migrations/0000_init.down.sql`) that drops in FK-safe reverse order.
- An ephemeral-branch-safe migration runner (`scripts/migrate.ts`) and a
  destructive rollback-check (`scripts/rollback-check.ts`) that requires an
  explicit `NEON_EPHEMERAL_BRANCH_ID`, `NEON_API_KEY`, and
  `NEON_PROJECT_ID` whenever the path declares an ephemeral target. The shared
  `scripts/neon-branch-guard.ts` queries Neon server identity settings through
  the exact open migration handle, then cross-checks the endpoint and branch
  against Neon API truth. Missing or ambiguous identity fails closed; the
  branch must be read-write, ready, non-primary/default, unprotected, and
  outside the protected-name denylist.
- Committed `scripts/neon-branch-create.ts` + `scripts/neon-branch-delete.ts`
  that drive the Neon API to fork ephemeral branches off the primary and
  destroy them after each round-trip.
- A Neon client module (`src/client.ts`) using `@neondatabase/serverless` so
  later sub-units (F-2 auth, F-3 history, F-4 leaderboard verify) can
  `import { getDb } from "@wcdraft/db"` from Vercel route handlers.

## What is NOT in F-1

- **No route handlers** in `apps/web/app/api/*` — that's F-2/F-3/F-4.
- **No app-server derivation logic** inside the DB package for
  `saved_runs.version_anchors` (jsonb column only) or
  `leaderboard_entries.season_key` (text column only). The web app stamps the
  active aggregate season from `WCDRAFT_LEADERBOARD_SEASON_ID` with a pinned
  default, and daily rows carry `challenge_type = 'daily'` plus a UTC
  `challenge_date`.
- **No edits** to `packages/core/src/schemas/leaderboard.ts` — F-4 will
  replace that claimed-score schema with a token-only submission shape.
- **No monetization tables** (`entitlements`, `stripe_events`). Monetization
  is deferred entirely.
- **No automatic migrations at app startup.** Migrations are explicit CLI
  invocations only, and rollback-check ALWAYS runs against an ephemeral
  branch — never prod.

## Env vars

Two **secrets** must live in your local shell env (or a gitignored file you
source; `~/.config/wcdraft/neon.env` is conventional) and as GitHub repo
secrets for CI:

| Var               | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `NEON_API_KEY`    | Drives branch lifecycle and is mandatory for rollback-check target verification.         |
| `NEON_PROJECT_ID` | Identifies the project for branch creation, deletion, and rollback-check target binding. |

`db:branch:create` writes the **per-run** DB URLs to a working env file:

| Var                        | URL kind                                 | Used by                                                               |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`             | Neon **pooled** (`...-pooler.neon.tech`) | Runtime route handlers (later sub-units) via `getDb()`                |
| `DATABASE_URL_UNPOOLED`    | Neon **direct** (`...neon.tech`)         | `scripts/migrate.ts` and `scripts/rollback-check.ts` (CLI migrations) |
| `NEON_EPHEMERAL_BRANCH_ID` | Branch ID sentinel                       | Exact branch equality check in `scripts/neon-branch-guard.ts`         |
| `NEON_MUTATION_TARGET`     | `ephemeral` or `production`              | Explicit migration target mode                                        |
| `NEON_PROJECT_ID`          | Echoed back for `db:branch:delete`       | `scripts/neon-branch-delete.ts`                                       |

The working env file is gitignored (covered by `.gitignore`'s `.env.*`
pattern). Always target a Neon **branch**, never prod, for apply/rollback
checks. Sentinel-only local reruns are intentionally unsupported: the runner
refuses without API credentials or when the connected endpoint cannot be
bound unambiguously to that sentinel.

## Local quick-start

```bash
# 1. Source your stable secrets (NEON_API_KEY + NEON_PROJECT_ID).
set -a; . ~/.config/wcdraft/neon.env; set +a

# 2. Provision an ephemeral branch + write its env file.
pnpm --filter @wcdraft/db db:branch:create .env.local

# 3. Run the round-trip.
set -a; . .env.local; set +a
pnpm --filter @wcdraft/db db:branch:verify
pnpm --filter @wcdraft/db db:migrate
pnpm --filter @wcdraft/db db:rollback-check

# 4. Tear down (deletes the ephemeral branch; safe to run on success or failure).
pnpm --filter @wcdraft/db db:branch:delete
```

## Cost firewall

DB access is reserved for the three engagement/retention surfaces only. There
is no per-game DB call; the client sim path is untouched. Adding new DB
consumers requires re-justifying the firewall.
