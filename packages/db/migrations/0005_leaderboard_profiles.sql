ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_ci_uq" ON "users" USING btree (lower("username"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_format_chk" CHECK ("users"."username" IS NULL OR ("users"."username" = lower("users"."username") AND "users"."username" ~ '^[a-z0-9_]{3,20}$'));--> statement-breakpoint

ALTER TABLE "leaderboard_entries" ADD COLUMN "display_alias" text;--> statement-breakpoint
WITH normalized AS (
  SELECT
    "id",
    substring(
      trim(both '_' from regexp_replace(lower("display_name"), '[^a-z0-9_]+', '_', 'g'))
      from 1 for 20
    ) AS candidate
  FROM "leaderboard_entries"
),
reserved_terms(term) AS (
  VALUES
    ('admin'),
    ('api'),
    ('mod'),
    ('moderator'),
    ('official'),
    ('staff'),
    ('support'),
    ('sysop'),
    ('system'),
    ('wcdraft')
),
blocked_stems(term) AS (
  VALUES
    ('fuck'),
    ('shit'),
    ('cunt'),
    ('bitch'),
    ('asshole'),
    ('whore'),
    ('nigger'),
    ('nigga'),
    ('faggot'),
    ('kike'),
    ('spic'),
    ('chink'),
    ('wetback'),
    ('tranny'),
    ('paki'),
    ('coon'),
    ('gook'),
    ('dyke'),
    ('retard'),
    ('hitler'),
    ('pedo'),
    ('rapist')
)
UPDATE "leaderboard_entries" AS e
SET "display_alias" = CASE
  WHEN char_length(n.candidate) BETWEEN 3 AND 20
   AND replace(n.candidate, '_', '') NOT IN (SELECT term FROM reserved_terms)
   AND NOT EXISTS (
     SELECT 1
     FROM blocked_stems AS b
     WHERE replace(n.candidate, '_', '') LIKE '%' || b.term || '%'
   )
    THEN n.candidate
  ELSE 'player_' || substring(md5(e."id"::text) from 1 for 8)
END
FROM normalized AS n
WHERE n."id" = e."id";--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP CONSTRAINT IF EXISTS "leaderboard_entries_display_name_chk";--> statement-breakpoint
ALTER TABLE "leaderboard_entries" DROP COLUMN "display_name";--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_display_alias_chk" CHECK ("leaderboard_entries"."display_alias" IS NULL OR "leaderboard_entries"."display_alias" ~ '^[a-z0-9_]{3,20}$');--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_public_name_chk" CHECK ("leaderboard_entries"."user_id" IS NOT NULL OR "leaderboard_entries"."display_alias" IS NOT NULL);
