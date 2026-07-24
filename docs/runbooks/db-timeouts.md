# Database client timeouts

Runtime route handlers use `@neondatabase/serverless` WebSocket `Pool`
(not node-postgres). Timeouts are set in `packages/db/src/client.ts` via
options that driver types declare on `ClientConfig` / `PoolConfig`.

## Chosen values

| Knob                      | Value     | Why                                                                                                                                                              |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionTimeoutMillis` | 5_000 ms  | Fail fast if the Neon WebSocket handshake hangs instead of occupying a serverless invocation until platform kill.                                                |
| `idleTimeoutMillis`       | 10_000 ms | Release idle pooled clients in short-lived serverless isolates; avoids holding Neon slots after the handler returns.                                             |
| `statement_timeout`       | 8_000 ms  | Postgres-enforced query ceiling. Surfaces a typed driver/Postgres error rather than a silent hang.                                                               |
| Heavy-route `maxDuration` | 10 s      | Set on ranked attempt, runs save, challenge verify, OG sign, lineup, and leaderboard submit so the **DB timeout always fires before** Vercel kills the function. |

Invariant: `statement_timeout` (8 s) < `maxDuration` (10 s).

## Plan limits

`maxDuration = 10` is valid on every current Vercel plan that runs this app
(Hobby default max is 10 s; Pro/Enterprise allow higher). Do not raise
`maxDuration` without verifying the project’s plan ceiling in the Vercel
dashboard — an unsupported value fails deploy config (Red tier).

## Migrator

`openMigratorDb()` uses a 60 s `statement_timeout` and the same 5 s connect
timeout. Migrations are CLI-owned and may legitimately run longer than a
route handler.

## Diagnosis

If a route returns 500 with `error_class: "timeout"` / `"database"` in the
structured `[request]` log and a `correlation_id` on the response, check:

1. Neon project health / connection string (pooled vs direct).
2. Slow query in the statement that ran under that correlation id.
3. Whether `maxDuration` was lowered below `statement_timeout` (would hide
   the DB error behind a platform kill).

## Related

- Heavy-route exports: `apps/web/app/api/**/route.ts` (`export const maxDuration = 10`)
- Pool builder: `buildRuntimePoolConfig` in `packages/db/src/client.ts`
