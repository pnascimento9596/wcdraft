-- F-4 U1 — down-migration paired with 0004_f4_leaderboard.sql.
--
-- Restores the exact 0003-snapshot shape:
--   leaderboard_entries loses display_name / session_id / draft_mode /
--   hidden_at (and their CHECKs + FK + partial indexes), the F-1 top index
--   (season_key, mode, verified_score) comes back, and
--   ranked_attempts.user_id relaxes to F-1 nullable.
--
-- Data caveat (documentary, tables are empty while F-4 is dark): rows
-- inserted under 0004 lose their board identity (display_name) and anon
-- ownership (session_id) on rollback — un-recoverable from the row itself
-- (display_name is not in the token). A populated-DB rollback therefore
-- means the casual board is effectively reset; the t1.* token +
-- verified_score survive for audit.
--
-- Order matters: indexes/constraints that depend on the new columns drop
-- before the columns themselves; the restored F-1 index is recreated last.

DROP INDEX IF EXISTS "leaderboard_entries_session_idx";
DROP INDEX IF EXISTS "leaderboard_entries_top_idx";

ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_ranked_user_chk";
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_display_name_chk";
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_draft_mode_chk";
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_session_id_sessions_id_fk";

ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "hidden_at";
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "display_name";
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "session_id";
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "draft_mode";

-- Restore the F-1 top-N index shape (0000_init emit).
CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx"
  ON "leaderboard_entries" USING btree ("season_key","mode","verified_score");

-- Relax RANKED-IS-ACCOUNT-REQUIRED back to the F-1 nullable scaffold.
ALTER TABLE "ranked_attempts" ALTER COLUMN "user_id" DROP NOT NULL;
