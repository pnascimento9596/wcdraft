// F-1 — public surface of `@wcdraft/db`.
//
// Only the runtime accessor `getDb`, the migrator accessor `openMigratorDb`,
// the typed `Db` handle, and the schema re-exports are public. Route handlers
// in later sub-units do:
//
//   import { getDb, savedRuns, type NewSavedRun } from "@wcdraft/db";
//
// No browser entry: this package is server-only. Importing it from a client
// bundle will fail at runtime when `process.env` is undefined, which is the
// desired behavior (a guard rail, not a silent fallback).
export { getDb, openMigratorDb, type Db } from "./client.ts";
export * from "./schema/index.ts";
