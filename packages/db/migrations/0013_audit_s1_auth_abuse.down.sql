ALTER TABLE "saved_runs" DROP CONSTRAINT IF EXISTS "saved_runs_payload_bytes_chk";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DROP CONSTRAINT IF EXISTS "magic_link_tokens_delivery_status_chk";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DROP CONSTRAINT IF EXISTS "magic_link_tokens_purpose_chk";
--> statement-breakpoint
DROP INDEX IF EXISTS "saved_runs_session_unpinned_eviction_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "saved_runs_owner_unpinned_eviction_idx";
--> statement-breakpoint
ALTER TABLE "saved_runs" DROP COLUMN IF EXISTS "pinned_at";
--> statement-breakpoint
ALTER TABLE "saved_runs" DROP COLUMN IF EXISTS "payload_bytes";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DROP COLUMN IF EXISTS "delivery_correlation_id";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DROP COLUMN IF EXISTS "delivery_attempted_at";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DROP COLUMN IF EXISTS "delivery_status";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DROP COLUMN IF EXISTS "purpose";
