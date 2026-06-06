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
- Initial migration (`migrations/0000_init.sql`) that creates all six tables in
  one transaction, plus a hand-authored down-migration
  (`migrations/0000_init.down.sql`) that drops them in FK-safe order.
- A migration runner (`scripts/migrate.ts`) and rollback-check
  (`scripts/rollback-check.ts`) that apply against a Neon **branch** (never
  prod).
- A Neon client module (`src/client.ts`) using `@neondatabase/serverless` so
  later sub-units (F-2 auth, F-3 history, F-4 leaderboard verify) can
  `import { getDb } from "@wcdraft/db"` from Vercel route handlers.

## What is NOT in F-1

- **No route handlers** in `apps/web/app/api/*` — that's F-2/F-3/F-4.
- **No derivation logic** for `saved_runs.version_anchors` (jsonb column only)
  or `leaderboard_entries.season_key` (text column only). F-4 will derive
  `season_key` from the run token's embedded anchors so the imminent rating
  recalibration opens a new season automatically.
- **No edits** to `packages/core/src/schemas/leaderboard.ts` — F-4 will replace
  that claimed-score schema with a token-only submission shape.
- **No monetization tables** (`entitlements`, `stripe_events`). Monetization is
  deferred entirely per the revised Phase F plan.
- **No automatic migrations at app startup.** Migrations are explicit CLI
  invocations only.

## Env vars

Two URLs are needed; both must live in a **gitignored** local env file
(`.env.local` at the repo root — already covered by `.gitignore`'s `.env.*`
pattern):

| Var                      | URL kind                              | Used by                                                              |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`           | Neon **pooled** (`...-pooler.neon.tech`)   | Runtime route handlers (later sub-units) via `getDb()`               |
| `DATABASE_URL_UNPOOLED`  | Neon **direct/unpooled** (`...neon.tech`)  | `scripts/migrate.ts` and `scripts/rollback-check.ts` (CLI migrations) |

Always target a Neon **branch**, never prod, for apply/rollback checks.

## Commands

```bash
# Regenerate SQL from the Drizzle schema (no DB required).
pnpm --filter @wcdraft/db db:generate

# Apply all pending up-migrations (needs DATABASE_URL_UNPOOLED).
pnpm --filter @wcdraft/db db:migrate

# Round-trip check: apply all, then run each down-migration in reverse, then
# assert the public schema is empty. Exits non-zero on any failure.
pnpm --filter @wcdraft/db db:rollback-check
```

## Cost firewall

DB access is reserved for the three engagement/retention surfaces only. There
is no per-game DB call; the client sim path is untouched. Adding new DB
consumers requires re-justifying the firewall.
