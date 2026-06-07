-- F-3 — down-migration paired with 0002_history_session_scope.sql.
--
-- Restore the F-1 global UNIQUE NULLS NOT DISTINCT constraint on
-- (owner_user_id, token) and drop the F-3 partial uniques + session_id
-- column.
--
-- Order matters: drop the partial uniques + session_id index first, then
-- the FK + column, then re-add the F-1 global constraint last.

DROP INDEX IF EXISTS "saved_runs_session_token_uq";
DROP INDEX IF EXISTS "saved_runs_owner_token_uq";
DROP INDEX IF EXISTS "saved_runs_session_idx";

ALTER TABLE "saved_runs"
  DROP CONSTRAINT IF EXISTS "saved_runs_session_id_sessions_id_fk";
ALTER TABLE "saved_runs"
  DROP COLUMN IF EXISTS "session_id";

-- Restore F-1's global unique constraint (NULLS NOT DISTINCT for the anon
-- anti-spam vector — the same constraint shape PR #26 landed). The naming
-- matches the F-1 emit so a fresh apply lands the same row.
ALTER TABLE "saved_runs"
  ADD CONSTRAINT "saved_runs_owner_token_uq"
  UNIQUE NULLS NOT DISTINCT ("owner_user_id", "token");
