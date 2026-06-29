ALTER TABLE "ranked_attempts" ADD COLUMN "season_key" text;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD COLUMN "formation_id" text;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD COLUMN "draft_mode" text;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD COLUMN "draft_order" text;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD COLUMN "era" text;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD COLUMN "rating_basis" text;
--> statement-breakpoint
UPDATE "ranked_attempts"
   SET "season_key" = COALESCE("season_key", 'legacy-unbound'),
       "formation_id" = COALESCE("formation_id", 'legacy'),
       "draft_mode" = COALESCE("draft_mode", 'classic'),
       "draft_order" = COALESCE("draft_order", 'squad_first'),
       "era" = COALESCE("era", 'all_time'),
       "rating_basis" = COALESCE("rating_basis", 'career');
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ALTER COLUMN "season_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ALTER COLUMN "formation_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ALTER COLUMN "draft_mode" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ALTER COLUMN "draft_order" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ALTER COLUMN "era" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ALTER COLUMN "rating_basis" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_season_key_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_season_key_chk"
  CHECK (char_length("ranked_attempts"."season_key") BETWEEN 1 AND 256);
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_formation_id_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_formation_id_chk"
  CHECK (char_length("ranked_attempts"."formation_id") BETWEEN 1 AND 64);
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_draft_mode_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_draft_mode_chk"
  CHECK ("ranked_attempts"."draft_mode" IN ('classic', 'hidden'));
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_draft_order_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_draft_order_chk"
  CHECK ("ranked_attempts"."draft_order" IN ('squad_first', 'position_first'));
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_era_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_era_chk"
  CHECK ("ranked_attempts"."era" IN ('all_time', 'post_2000', 'post_2010', 'modern'));
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_rating_basis_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_rating_basis_chk"
  CHECK ("ranked_attempts"."rating_basis" IN ('career', 'current'));
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_seed_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_seed_chk"
  CHECK (char_length("ranked_attempts"."issued_parent_seed") BETWEEN 1 AND 256);
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_nonce_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_nonce_chk"
  CHECK (char_length("ranked_attempts"."nonce") BETWEEN 16 AND 128);
--> statement-breakpoint
ALTER TABLE "ranked_attempts" DROP CONSTRAINT IF EXISTS "ranked_attempts_window_chk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts" ADD CONSTRAINT "ranked_attempts_window_chk"
  CHECK ("ranked_attempts"."window_expires_at" > "ranked_attempts"."issued_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ranked_attempts_user_seed_idx"
  ON "ranked_attempts" USING btree ("user_id", "issued_parent_seed");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ranked_attempts_user_config_idx"
  ON "ranked_attempts" USING btree (
    "user_id",
    "season_key",
    "formation_id",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    "issued_at"
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_entries_attempt_idx"
  ON "leaderboard_entries" USING btree ("attempt_id")
  WHERE "leaderboard_entries"."attempt_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leaderboard_entries_ranked_attempt_uq"
  ON "leaderboard_entries" USING btree ("attempt_id")
  WHERE "leaderboard_entries"."attempt_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_ranked_attempt_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_ranked_attempt_chk"
  CHECK ("leaderboard_entries"."mode" <> 'ranked' OR "leaderboard_entries"."attempt_id" IS NOT NULL)
  NOT VALID;
