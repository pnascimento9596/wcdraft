-- F-2 — down-migration paired with 0001_auth_rate_limits.sql.
--
-- Drop the rate-limit counter table. No FKs, no children — single DROP TABLE.
-- IF EXISTS so partial rollbacks (table already gone) stay idempotent.
DROP TABLE IF EXISTS "auth_rate_limits";
