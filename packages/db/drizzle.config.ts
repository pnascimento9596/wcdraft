// F-1 — Drizzle config for `@wcdraft/db`.
//
// `drizzle-kit generate` reads ONLY the schema files; no DB connection is
// required to produce SQL (so this config works at CI time without secrets).
//
// `dbCredentials.url` is consulted only by drizzle-kit commands that DO touch
// the database (introspect/push). We never use those — apply is handled by
// `scripts/migrate.ts` and rollback by `scripts/rollback-check.ts`, both of
// which read the env directly. The url here is kept for parity but defaults
// to an empty string so a missing secret never crashes `generate`.
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: { url },
});
