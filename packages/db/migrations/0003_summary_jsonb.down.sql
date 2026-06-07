-- F-3.5 — down-migration paired with 0003_summary_jsonb.sql.
--
-- The summary column is purely additive (jsonb nullable), so the down is
-- a straight column drop. Older runs that landed BEFORE this migration
-- have summary IS NULL; F-3.5+ runs would lose their display metadata on
-- rollback (the t1.* token + version_anchors survive on saved_runs, so a
-- subsequent re-apply could backfill summary from the token + a client-
-- side or server-side render — but that's a manual recovery, not part of
-- the down).
ALTER TABLE "saved_runs" DROP COLUMN IF EXISTS "summary";
