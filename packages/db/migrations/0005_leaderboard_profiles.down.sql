ALTER TABLE "leaderboard_entries" ADD COLUMN "display_name" text;--> statement-breakpoint
UPDATE "leaderboard_entries" AS e
SET "display_name" = COALESCE(
  e."display_alias",
  (
    SELECT u."username"
    FROM "users" AS u
    WHERE u."id" = e."user_id"
    LIMIT 1
  ),
  'player_' || substring(md5(e."id"::text) from 1 for 8)
);--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_public_name_chk";--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_display_alias_chk";--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_display_name_chk" CHECK (char_length("leaderboard_entries"."display_name") BETWEEN 3 AND 24);--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "display_alias";--> statement-breakpoint
DROP INDEX IF EXISTS "users_username_ci_uq";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_format_chk";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "username";
