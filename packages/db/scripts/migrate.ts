// F-1 — apply all pending up-migrations against the Neon DIRECT (unpooled) URL.
//
// Reads from `DATABASE_URL_UNPOOLED` only — refuses to fall back to the
// pooled URL, because pooled connections reject the CREATE/ALTER inside a
// transaction the way drizzle's migrator runs them.
//
// This script is invoked via `pnpm --filter @wcdraft/db db:migrate`. It is
// NEVER auto-run at app startup. CI invokes it only on the F-1 RED PR's
// Neon-branch job; production deploys run it as a discrete release step.
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { openMigratorDb } from "../src/client.ts";

async function main(): Promise<void> {
  const { db, pool } = openMigratorDb();
  const migrationsFolder = new URL("../migrations", import.meta.url).pathname;
  console.log(`[db:migrate] applying migrations from ${migrationsFolder}`);
  try {
    await migrate(db, { migrationsFolder });
    console.log("[db:migrate] OK — all migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[db:migrate] FAILED", err);
  process.exit(1);
});
