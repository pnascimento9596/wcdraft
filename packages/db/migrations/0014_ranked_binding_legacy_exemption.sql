-- Final closeout for the sole genuine ranked row that predates server-issued
-- attempt binding. Production evidence identifies exactly primary key
-- 4dc1df8e-530d-47c3-9364-5e6beea571a2, created 2026-06-21; attempt binding
-- did not ship until 2026-06-29. The exact occupied primary key is the
-- narrowest boundary: it admits no date range, season class, or future UUID.
--
-- A date boundary is deliberately rejected. created_at has a database default
-- but is not generated/identity, and the application insert path explicitly
-- supplies it, so database structure does not make a historical date cutoff
-- unforgeable. Neither exemption references session_id (or any other column
-- changed by session deletion), so ON DELETE SET NULL cannot make the legacy
-- row fall out of its own exemption during the cascade.
--
-- Both legacy NOT VALID checks must receive the same carve-out. Scoping only
-- the wider binding check would leave ranked_attempt_chk able to abort that
-- same session cascade when it rechecks the attempt-less historical row.
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT "leaderboard_entries_ranked_attempt_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT "leaderboard_entries_ranked_attempt_binding_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  ADD CONSTRAINT "leaderboard_entries_ranked_attempt_chk"
  CHECK (
    "leaderboard_entries"."id" = '4dc1df8e-530d-47c3-9364-5e6beea571a2'::uuid
    OR "leaderboard_entries"."mode" <> 'ranked'
    OR "leaderboard_entries"."attempt_id" IS NOT NULL
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  ADD CONSTRAINT "leaderboard_entries_ranked_attempt_binding_chk"
  CHECK (
    "leaderboard_entries"."id" = '4dc1df8e-530d-47c3-9364-5e6beea571a2'::uuid
    OR "leaderboard_entries"."mode" <> 'ranked'
    OR (
        "leaderboard_entries"."attempt_id" IS NOT NULL
        AND "leaderboard_entries"."user_id" IS NOT NULL
        AND "leaderboard_entries"."attempt_formation_id" IS NOT NULL
        AND "leaderboard_entries"."draft_order" IS NOT NULL
        AND "leaderboard_entries"."era" IS NOT NULL
        AND "leaderboard_entries"."rating_basis" IS NOT NULL
        AND "leaderboard_entries"."attempt_consumed_at" IS NOT NULL
      )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  VALIDATE CONSTRAINT "leaderboard_entries_ranked_attempt_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  VALIDATE CONSTRAINT "leaderboard_entries_ranked_attempt_binding_chk";
