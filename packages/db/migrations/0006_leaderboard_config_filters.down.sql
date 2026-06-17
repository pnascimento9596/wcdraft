-- Roll back per-config leaderboard filter columns to the 0005 shape.
--
-- Rows inserted after 0006 lose their explicit config columns on rollback, but
-- token + draft_mode remain for audit/replay. Production rollback of a failed
-- deploy should happen before accepting sustained new traffic on the bad build.

DROP INDEX IF EXISTS "leaderboard_entries_top_idx";

ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_config_complete_chk";
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_rating_basis_chk";
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_era_chk";
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_draft_order_chk";

ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "rating_basis";
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "era";
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "draft_order";

CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx"
  ON "leaderboard_entries" USING btree (
    "season_key",
    "mode",
    "verified_score" DESC NULLS LAST,
    "created_at",
    "id"
  )
  WHERE "leaderboard_entries"."hidden_at" IS NULL;
