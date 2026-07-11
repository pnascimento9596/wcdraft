ALTER TABLE "magic_link_tokens" ADD COLUMN "purpose" text DEFAULT 'signin' NOT NULL;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "delivery_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "delivery_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "delivery_correlation_id" text;--> statement-breakpoint
ALTER TABLE "saved_runs" ADD COLUMN "payload_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_runs" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
-- Backfill the exact UTF-8 serialization of every persisted payload-bearing
-- column. Runtime inserts use this same expression before quota enforcement.
UPDATE "saved_runs"
SET "payload_bytes" =
  octet_length(convert_to("token", 'UTF8'))
  + COALESCE(octet_length(convert_to("version_anchors"::text, 'UTF8')), 0)
  + COALESCE(octet_length(convert_to("verified_result"::text, 'UTF8')), 0)
  + COALESCE(octet_length(convert_to("summary"::text, 'UTF8')), 0)
  + COALESCE(octet_length(convert_to("run_id", 'UTF8')), 0)
  + COALESCE(octet_length(convert_to("parent_seed", 'UTF8')), 0)
  + octet_length(convert_to("claim_state", 'UTF8'));--> statement-breakpoint
CREATE INDEX "saved_runs_owner_unpinned_eviction_idx" ON "saved_runs" USING btree ("owner_user_id","created_at","id") WHERE "saved_runs"."owner_user_id" IS NOT NULL AND "saved_runs"."pinned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "saved_runs_session_unpinned_eviction_idx" ON "saved_runs" USING btree ("session_id","created_at","id") WHERE "saved_runs"."owner_user_id" IS NULL AND "saved_runs"."session_id" IS NOT NULL AND "saved_runs"."pinned_at" IS NULL;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_purpose_chk" CHECK ("magic_link_tokens"."purpose" IN ('signin', 'verification', 'reset'));--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_delivery_status_chk" CHECK ("magic_link_tokens"."delivery_status" IN ('unknown', 'pending', 'delivered', 'failed', 'not_eligible'));--> statement-breakpoint
ALTER TABLE "saved_runs" ADD CONSTRAINT "saved_runs_payload_bytes_chk" CHECK ("saved_runs"."payload_bytes" >= 0);
