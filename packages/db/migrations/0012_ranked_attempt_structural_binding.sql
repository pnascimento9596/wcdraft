-- Audit S1 B3: make ranked-attempt binding structural and durable.
--
-- A narrowly scoped trigger was considered, but it would only validate
-- leaderboard writes and would not prevent a later ranked_attempts update from
-- invalidating the consumed-attempt claim. The persisted witnesses plus a
-- composite FK enforce user/season/full-config equality and consumed_at for the
-- lifetime of the leaderboard row. The two new columns carry only dimensions
-- not already persisted by leaderboard_entries.
ALTER TABLE "leaderboard_entries" ADD COLUMN "attempt_formation_id" text;
--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "attempt_consumed_at" timestamp with time zone;
--> statement-breakpoint
-- Preserve every existing attempt-backed row by deriving, never inventing,
-- its missing binding witnesses. Attempt-less casual rows remain NULL.
UPDATE "leaderboard_entries" AS "entry"
   SET "attempt_formation_id" = "attempt"."formation_id",
       "attempt_consumed_at" = "attempt"."consumed_at"
  FROM "ranked_attempts" AS "attempt"
 WHERE "entry"."attempt_id" = "attempt"."id";
--> statement-breakpoint
-- MATCH SIMPLE foreign keys skip validation when any referencing column is
-- NULL. This CHECK closes that gap for every newly written ranked row.
-- Migration 0009 deliberately preserved pre-binding ranked rows with a
-- NOT VALID constraint, so this stronger replacement must do the same: legacy
-- rows that cannot be derived remain visible and unchanged, while PostgreSQL
-- still enforces a NOT VALID constraint for every INSERT or UPDATE.
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_ranked_attempt_binding_chk"
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
--> statement-breakpoint
CREATE UNIQUE INDEX "ranked_attempts_binding_uq"
  ON "ranked_attempts" USING btree (
    "id",
    "user_id",
    "season_key",
    "formation_id",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    "consumed_at"
  );
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  DROP CONSTRAINT "leaderboard_entries_attempt_id_ranked_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "leaderboard_entries"
  ADD CONSTRAINT "leaderboard_entries_ranked_attempt_binding_fk"
  FOREIGN KEY (
    "attempt_id",
    "user_id",
    "season_key",
    "attempt_formation_id",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    "attempt_consumed_at"
  )
  REFERENCES "public"."ranked_attempts" (
    "id",
    "user_id",
    "season_key",
    "formation_id",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    "consumed_at"
  )
  ON DELETE restrict
  ON UPDATE restrict
  NOT VALID;
