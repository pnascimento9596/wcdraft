ALTER TABLE "users" DROP COLUMN IF EXISTS "password_set_at";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
