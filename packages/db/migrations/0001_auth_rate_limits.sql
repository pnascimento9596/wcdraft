CREATE TABLE IF NOT EXISTS "auth_rate_limits" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limits_pk" PRIMARY KEY("bucket_key","window_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_rate_limits_window_idx" ON "auth_rate_limits" USING btree ("window_start");