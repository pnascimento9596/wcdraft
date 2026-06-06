-- F-1 — down-migration paired with 0000_init.sql.
--
-- Drizzle generates forward-only SQL; this file is hand-authored and read by
-- `scripts/rollback-check.ts` to round-trip apply→rollback against a Neon
-- branch (never prod) and assert the public schema is empty.
--
-- FK-safe drop order: a child must drop before its parent.
--   leaderboard_entries  → users, ranked_attempts
--   ranked_attempts      → users, sessions
--   saved_runs           → users
--   sessions             → users
--   magic_link_tokens    → users
--   users                → (root)
--
-- IF EXISTS so partial rollbacks (some tables already gone) stay idempotent.
-- DROP TABLE ... CASCADE would also work but masks ordering bugs; the
-- non-CASCADE form makes a drop-order mistake fail loudly.

DROP TABLE IF EXISTS "leaderboard_entries";
DROP TABLE IF EXISTS "ranked_attempts";
DROP TABLE IF EXISTS "saved_runs";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "magic_link_tokens";
DROP TABLE IF EXISTS "users";

-- Drizzle's bookkeeping schema is created by the migrator (drizzle.__drizzle_migrations).
-- Drop it too so a subsequent apply starts from a clean slate.
DROP SCHEMA IF EXISTS "drizzle" CASCADE;
