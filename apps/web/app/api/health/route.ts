import { getDb } from "@wcdraft/db";

import { probeAuthBootstrapDependencies } from "@/lib/health/auth-probe";
import { handleHealthGet, readLatestAppliedMigration } from "@/lib/health/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleHealthGet({
    databaseUrl: process.env.DATABASE_URL,
    authCookieSecret: process.env.AUTH_COOKIE_SECRET,
    buildSha: process.env.VERCEL_GIT_COMMIT_SHA,
    readLatestMigration: () => readLatestAppliedMigration(getDb()),
    probeAuthBootstrap: () => probeAuthBootstrapDependencies(getDb(), Date.now()),
  });
}
