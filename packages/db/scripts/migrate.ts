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
import { assertNeonBranchIdentity, NeonBranchIdentityError } from "./neon-branch-guard.ts";

async function main(): Promise<void> {
  const mutationTarget = process.env.NEON_MUTATION_TARGET;
  if (mutationTarget !== "ephemeral" && mutationTarget !== "production") {
    throw new Error(
      "[db:migrate] refusing to run; NEON_MUTATION_TARGET must be explicitly set to ephemeral or production",
    );
  }
  const { db, pool } = openMigratorDb();
  const migrationsFolder = new URL("../migrations", import.meta.url).pathname;
  try {
    // The production release workflow has its own exact-primary target
    // resolver. Any path explicitly targeting an ephemeral branch must prove
    // it on the same DB handle before migrating.
    if (mutationTarget === "ephemeral") {
      const target = await assertNeonBranchIdentity(
        {
          intendedBranchId: process.env.NEON_EPHEMERAL_BRANCH_ID,
          apiKey: process.env.NEON_API_KEY,
          projectId: process.env.NEON_PROJECT_ID,
        },
        { verifiedHandle: db },
      );
      console.log(
        `[db:migrate] guard PASS — branch=${target.branchId} endpoint=${target.endpointId}`,
      );
    }
    console.log(`[db:migrate] applying migrations from ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
    console.log("[db:migrate] OK — all migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    "[db:migrate] FAILED",
    err instanceof NeonBranchIdentityError ||
      (err instanceof Error && err.message.startsWith("[db:migrate] refusing"))
      ? err.message
      : "migration failed; protected diagnostics are not printed",
  );
  process.exit(1);
});
