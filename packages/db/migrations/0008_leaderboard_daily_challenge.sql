ALTER TABLE "leaderboard_entries" ADD COLUMN "challenge_type" text DEFAULT 'season' NOT NULL;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "challenge_date" text;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "rating_version" text;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_dedupe_uq";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_challenge_type_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_challenge_type_chk"
  CHECK ("leaderboard_entries"."challenge_type" IN ('season', 'daily'));
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_daily_mode_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_daily_mode_chk"
  CHECK ("leaderboard_entries"."challenge_type" <> 'daily' OR "leaderboard_entries"."mode" = 'casual');
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_challenge_date_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_challenge_date_chk"
  CHECK (
    ("leaderboard_entries"."challenge_type" = 'season' AND "leaderboard_entries"."challenge_date" IS NULL)
    OR
    ("leaderboard_entries"."challenge_type" = 'daily' AND "leaderboard_entries"."challenge_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  );
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_rating_version_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_rating_version_chk"
  CHECK ("leaderboard_entries"."rating_version" IS NULL OR char_length("leaderboard_entries"."rating_version") BETWEEN 1 AND 256);
--> statement-breakpoint
DROP INDEX IF EXISTS "leaderboard_entries_top_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx"
  ON "leaderboard_entries" USING btree (
    "season_key",
    "challenge_type",
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_entries_daily_top_idx"
  ON "leaderboard_entries" USING btree (
    "challenge_type",
    "challenge_date",
    "mode",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    "verified_score" DESC NULLS LAST,
    "created_at",
    "id"
  )
  WHERE "leaderboard_entries"."hidden_at" IS NULL
    AND "leaderboard_entries"."challenge_type" = 'daily';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leaderboard_entries_season_dedupe_uq"
  ON "leaderboard_entries" USING btree (
    "season_key",
    "mode",
    "user_id",
    "token"
  )
  NULLS NOT DISTINCT
  WHERE "leaderboard_entries"."challenge_type" = 'season';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leaderboard_entries_daily_identity_uq"
  ON "leaderboard_entries" USING btree (
    "challenge_date",
    "mode",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    COALESCE("user_id"::text, "session_id", "display_alias")
  )
  WHERE "leaderboard_entries"."challenge_type" = 'daily'
    AND "leaderboard_entries"."hidden_at" IS NULL;
