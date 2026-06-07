ALTER TABLE "saved_runs" DROP CONSTRAINT "saved_runs_owner_token_uq";--> statement-breakpoint
ALTER TABLE "saved_runs" ADD COLUMN "session_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_runs" ADD CONSTRAINT "saved_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_runs_session_idx" ON "saved_runs" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_runs_owner_token_uq" ON "saved_runs" USING btree ("owner_user_id","token") WHERE "saved_runs"."owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_runs_session_token_uq" ON "saved_runs" USING btree ("session_id","token") WHERE "saved_runs"."owner_user_id" IS NULL AND "saved_runs"."session_id" IS NOT NULL;