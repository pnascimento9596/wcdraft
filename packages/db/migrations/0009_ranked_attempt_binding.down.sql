ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_ranked_attempt_chk";
--> statement-breakpoint
DROP INDEX IF EXISTS "leaderboard_entries_ranked_attempt_uq";
--> statement-breakpoint
DROP INDEX IF EXISTS "leaderboard_entries_attempt_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "ranked_attempts_user_config_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "ranked_attempts_user_seed_idx";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_window_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_nonce_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_seed_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_rating_basis_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_era_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_draft_order_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_draft_mode_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_formation_id_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_season_key_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP COLUMN IF EXISTS "rating_basis";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP COLUMN IF EXISTS "era";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP COLUMN IF EXISTS "draft_order";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP COLUMN IF EXISTS "draft_mode";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP COLUMN IF EXISTS "formation_id";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP COLUMN IF EXISTS "season_key";
