-- Per-config leaderboard filters.
--
-- Existing rows are backfilled ONLY when they belong to the current season at
-- migration time and the stored token cleanly exposes the config. Rows that are
-- old-season, malformed, or internally inconsistent keep NULL config columns
-- and are excluded by exact-config board filters.

ALTER TABLE "leaderboard_entries" ADD COLUMN "draft_order" text;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "era" text;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD COLUMN "rating_basis" text;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "__wcdraft_leaderboard_token_json"("token" text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  payload text;
  normalized text;
  json_text text;
BEGIN
  IF "token" LIKE 't1.%' OR "token" LIKE 't2.%' THEN
    payload := substring("token" from 4);
  ELSE
    RETURN NULL;
  END IF;

  IF payload IS NULL OR length(payload) = 0 THEN
    RETURN NULL;
  END IF;

  normalized := replace(replace(payload, '-', '+'), '_', '/');
  normalized := normalized || repeat('=', (4 - length(normalized) % 4) % 4);

  BEGIN
    json_text := convert_from(decode(normalized, 'base64'), 'UTF8');
    RETURN json_text::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;--> statement-breakpoint

WITH decoded AS (
  SELECT
    "id",
    "__wcdraft_leaderboard_token_json"("token") AS body
  FROM "leaderboard_entries"
  WHERE "season_key" = 'engine-2026.06.16-merit-v4.4_wc-perf-6.4.0+proj-career-5.4.0_2026-06-04_ruleset-2026.06.04_f79ba870'
),
config AS (
  SELECT
    "id",
    body->>'md' AS token_mode,
    CASE body->>'v'
      WHEN '1' THEN 'squad_first'
      WHEN '2' THEN body->>'df'
      ELSE NULL
    END AS draft_order,
    CASE body->>'v'
      WHEN '1' THEN 'all_time'
      WHEN '2' THEN body#>>'{ef,id}'
      ELSE NULL
    END AS era,
    CASE body->>'v'
      WHEN '1' THEN 'career'
      WHEN '2' THEN body->>'rb'
      ELSE NULL
    END AS rating_basis,
    body
  FROM decoded
  WHERE body IS NOT NULL
)
UPDATE "leaderboard_entries" AS e
SET
  "draft_order" = c.draft_order,
  "era" = c.era,
  "rating_basis" = c.rating_basis
FROM config AS c
WHERE e."id" = c."id"
  AND c.token_mode = e."draft_mode"
  AND c.draft_order IN ('squad_first', 'position_first')
  AND c.era IN ('all_time', 'post_2000', 'post_2010', 'modern')
  AND c.rating_basis IN ('career', 'current')
  AND (
    c.body->>'v' = '1'
    OR (
      c.body->>'v' = '2'
      AND (
        (c.era = 'all_time' AND c.body#>>'{ef,min}' = '1930' AND c.body#>>'{ef,max}' = '2026')
        OR (c.era = 'post_2000' AND c.body#>>'{ef,min}' = '2002' AND c.body#>>'{ef,max}' = '2026')
        OR (c.era = 'post_2010' AND c.body#>>'{ef,min}' = '2014' AND c.body#>>'{ef,max}' = '2026')
        OR (c.era = 'modern' AND c.body#>>'{ef,min}' = '2018' AND c.body#>>'{ef,max}' = '2026')
      )
    )
  );--> statement-breakpoint

DROP FUNCTION IF EXISTS "__wcdraft_leaderboard_token_json"(text);--> statement-breakpoint

ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_draft_order_chk" CHECK ("draft_order" IS NULL OR "draft_order" IN ('squad_first', 'position_first'));--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_era_chk" CHECK ("era" IS NULL OR "era" IN ('all_time', 'post_2000', 'post_2010', 'modern'));--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_rating_basis_chk" CHECK ("rating_basis" IS NULL OR "rating_basis" IN ('career', 'current'));--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_config_complete_chk" CHECK (
  ("draft_order" IS NULL AND "era" IS NULL AND "rating_basis" IS NULL)
  OR ("draft_order" IS NOT NULL AND "era" IS NOT NULL AND "rating_basis" IS NOT NULL)
);--> statement-breakpoint

DROP INDEX IF EXISTS "leaderboard_entries_top_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leaderboard_entries_top_idx"
  ON "leaderboard_entries" USING btree (
    "season_key",
    "mode",
    "draft_mode",
    "draft_order",
    "era",
    "rating_basis",
    "verified_score" DESC,
    "created_at" ASC,
    "id"
  )
  WHERE "leaderboard_entries"."hidden_at" IS NULL;
