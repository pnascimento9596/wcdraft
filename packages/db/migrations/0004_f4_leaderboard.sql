DROP INDEX IF EXISTS "leaderboard_entries_top_idx";--> statement-breakpoint
ALTER TABLE "ranked_attempts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "draft_mode" text NOT NULL;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "display_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_entries_session_idx" ON "leaderboard_entries" USING btree ("session_id") WHERE "leaderboard_entries"."session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx" ON "leaderboard_entries" USING btree ("season_key","mode","verified_score" DESC NULLS LAST,"created_at","id") WHERE "leaderboard_entries"."hidden_at" IS NULL;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_draft_mode_chk" CHECK ("leaderboard_entries"."draft_mode" IN ('classic', 'hidden'));--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_display_name_chk" CHECK (char_length("leaderboard_entries"."display_name") BETWEEN 3 AND 24);--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_ranked_user_chk" CHECK ("leaderboard_entries"."mode" <> 'ranked' OR "leaderboard_entries"."user_id" IS NOT NULL);