-- Restore the exact pre-0014 constraint definitions and NOT VALID states.
-- No leaderboard row is updated or deleted by this reversal.
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT "leaderboard_entries_ranked_attempt_binding_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT "leaderboard_entries_ranked_attempt_chk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  ADD CONSTRAINT "leaderboard_entries_ranked_attempt_chk"
  CHECK (
    "leaderboard_entries"."mode" <> 'ranked'
    OR "leaderboard_entries"."attempt_id" IS NOT NULL
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  ADD CONSTRAINT "leaderboard_entries_ranked_attempt_binding_chk"
  CHECK (
    "leaderboard_entries"."mode" <> 'ranked'
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
