import { openMigratorDb } from "../src/client.ts";
import { assertNeonBranchIdentity, NeonBranchIdentityError } from "./neon-branch-guard.ts";

async function main(): Promise<void> {
  const { db, pool } = openMigratorDb();
  try {
    const target = await assertNeonBranchIdentity(
      {
        intendedBranchId: process.env.NEON_EPHEMERAL_BRANCH_ID,
        apiKey: process.env.NEON_API_KEY,
        projectId: process.env.NEON_PROJECT_ID,
      },
      { verifiedHandle: db },
    );
    console.log(
      `[db:branch:verify] PASS — branch=${target.branchId} endpoint=${target.endpointId}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(
    "[db:branch:verify] FAILED",
    err instanceof NeonBranchIdentityError
      ? err.message
      : "branch verification failed; protected diagnostics are not printed",
  );
  process.exit(1);
});
