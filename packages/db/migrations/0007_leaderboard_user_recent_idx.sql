CREATE INDEX IF NOT EXISTS "leaderboard_entries_user_recent_idx"
  ON "leaderboard_entries" USING btree (
    "user_id",
    "season_key",
    "mode",
    "created_at" DESC NULLS LAST
  )
  WHERE "leaderboard_entries"."user_id" IS NOT NULL;
