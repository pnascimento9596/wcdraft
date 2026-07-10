import { getDb } from "@wcdraft/db";

import { handleHealthGet, readLatestAppliedMigration } from "@/lib/health/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleHealthGet({
    databaseUrl: process.env.DATABASE_URL,
    buildSha: process.env.VERCEL_GIT_COMMIT_SHA,
    readLatestMigration: () => readLatestAppliedMigration(getDb()),
  });
}
