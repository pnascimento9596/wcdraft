DROP INDEX IF EXISTS "leaderboard_entries_daily_identity_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "leaderboard_entries_season_dedupe_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "leaderboard_entries_daily_top_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "leaderboard_entries_top_idx";
--> statement-breakpoint
DELETE FROM "leaderboard_entries"
WHERE "challenge_type" = 'daily';
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_rating_version_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_challenge_date_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_daily_mode_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_challenge_type_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "rating_version";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "challenge_date";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "challenge_type";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_dedupe_uq"
  UNIQUE NULLS NOT DISTINCT ("season_key", "mode", "user_id", "token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx"
  ON "leaderboard_entries" USING btree (
    "season_key",
    "mode",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    "verified_score" DESC NULLS LAST,
    "created_at",
    "id"
  )
  WHERE "leaderboard_entries"."hidden_at" IS NULL;
