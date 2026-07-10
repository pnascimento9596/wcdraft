-- Reversible metadata/constraint rollback. No leaderboard row is deleted.
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_ranked_attempt_binding_fk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT IF EXISTS "leaderboard_entries_ranked_attempt_binding_chk";
--> statement-breakpoint
DROP INDEX IF EXISTS "ranked_attempts_binding_uq";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "attempt_consumed_at";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP COLUMN IF EXISTS "attempt_formation_id";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  ADD CONSTRAINT "leaderboard_entries_attempt_id_ranked_attempts_id_fk"
  FOREIGN KEY ("attempt_id") REFERENCES "public"."ranked_attempts"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ranked_attempts"
  DROP CONSTRAINT "ranked_attempts_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "ranked_attempts"
  ADD CONSTRAINT "ranked_attempts_session_id_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id")
  ON DELETE cascade ON UPDATE no action;
