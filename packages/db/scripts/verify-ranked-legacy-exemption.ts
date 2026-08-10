// Re-executable 0014 proof for a fresh production-derived ephemeral branch.
//
// This script is deliberately mutation-capable only after the #346 Neon
// branch guard proves that the open direct handle belongs to the explicitly
// named ephemeral branch. It never prints connection material or the opaque
// session id. The proof applies the committed down migration, reapplies the
// up migration, rejects a non-exempt attempt-less ranked insert, and rehearses
// the historical expired-session cascade.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";

import { openMigratorDb } from "../src/client.ts";
import { assertNeonBranchIdentity } from "./neon-branch-guard.ts";

const LEGACY_ID = "4dc1df8e-530d-47c3-9364-5e6beea571a2";
const NEGATIVE_ID = "00000000-0000-4000-8000-000000000014";
const EXPECTED_EXPIRY = "2026-07-21T20:24:09.686Z";
const CHECK_NAMES = [
  "leaderboard_entries_ranked_attempt_binding_chk",
  "leaderboard_entries_ranked_attempt_chk",
] as const;

interface ConstraintRow {
  [key: string]: unknown;
  conname: string;
  convalidated: boolean;
  definition: string;
}

interface LegacyRow {
  [key: string]: unknown;
  full_md5: string;
  stable_md5: string;
  session_id: string | null;
  session_expires_at: Date | string | null;
}

function migrationStatements(name: string): string[] {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[ranked-legacy-proof] ${message}`);
}

async function main(): Promise<void> {
  expect(
    process.env.NEON_MUTATION_TARGET === "ephemeral",
    "NEON_MUTATION_TARGET must be exactly ephemeral",
  );
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
      `[ranked-legacy-proof] guard PASS — branch=${target.branchId} endpoint=${target.endpointId}`,
    );

    const roleResult = await db.execute<{ current_user: string }>(sql`SELECT current_user`);
    expect(roleResult.rows[0]?.current_user === "neondb_owner", "expected neondb_owner role");

    const loadConstraints = async (): Promise<ConstraintRow[]> => {
      const result = await db.execute<ConstraintRow>(sql`
        SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname IN (
          'leaderboard_entries_ranked_attempt_binding_chk',
          'leaderboard_entries_ranked_attempt_chk',
          'leaderboard_entries_ranked_attempt_binding_fk'
        )
        ORDER BY conname
      `);
      return result.rows;
    };

    const loadLegacy = async (): Promise<LegacyRow> => {
      const result = await db.execute<LegacyRow>(sql`
        SELECT
          md5(to_jsonb(entry)::text) AS full_md5,
          md5((to_jsonb(entry) - 'session_id')::text) AS stable_md5,
          entry.session_id,
          session.expires_at AS session_expires_at
        FROM leaderboard_entries AS entry
        LEFT JOIN sessions AS session ON session.id = entry.session_id
        WHERE entry.id = ${LEGACY_ID}::uuid
      `);
      expect(result.rows.length === 1, "expected exactly one historical row");
      return result.rows[0]!;
    };

    const loadExpiredCount = async (): Promise<number> => {
      const result = await db.execute<{ count: number }>(sql`
        SELECT count(*)::integer AS count
        FROM sessions
        WHERE expires_at <= clock_timestamp()
      `);
      const count = result.rows[0]?.count;
      expect(Number.isInteger(count), "expired-session count was unavailable");
      return count!;
    };

    const initialConstraints = await loadConstraints();
    const initialChecks = initialConstraints.filter((row) =>
      CHECK_NAMES.includes(row.conname as (typeof CHECK_NAMES)[number]),
    );
    expect(initialChecks.length === 2, "expected both ranked CHECK constraints");
    for (const check of initialChecks) {
      expect(check.convalidated, `${check.conname} was not VALID`);
      expect(check.definition.includes(LEGACY_ID), `${check.conname} lacks exact-id exemption`);
      expect(!/session_id/iu.test(check.definition), `${check.conname} references session_id`);
      expect(!/created_at/iu.test(check.definition), `${check.conname} references created_at`);
    }
    const bindingFk = initialConstraints.find(
      (row) => row.conname === "leaderboard_entries_ranked_attempt_binding_fk",
    );
    expect(bindingFk?.convalidated === false, "related composite FK validity unexpectedly changed");

    const violators = await db.execute<{ count: number; exact: boolean }>(sql`
      SELECT
        count(*)::integer AS count,
        bool_and(id = ${LEGACY_ID}::uuid) AS exact
      FROM leaderboard_entries
      WHERE mode = 'ranked' AND attempt_id IS NULL
    `);
    expect(
      violators.rows[0]?.count === 1 && violators.rows[0]?.exact === true,
      "attempt-less ranked set was not the single expected historical row",
    );

    const initialLegacy = await loadLegacy();
    expect(initialLegacy.session_id !== null, "historical row no longer references its session");
    expect(
      initialLegacy.session_expires_at != null &&
        new Date(initialLegacy.session_expires_at).toISOString() === EXPECTED_EXPIRY,
      "historical session expiry did not match the dispatched target",
    );
    const expiredBefore = await loadExpiredCount();

    for (const statement of migrationStatements("0014_ranked_binding_legacy_exemption.down.sql")) {
      await db.execute(sql.raw(statement));
    }
    const downConstraints = (await loadConstraints()).filter((row) =>
      CHECK_NAMES.includes(row.conname as (typeof CHECK_NAMES)[number]),
    );
    expect(downConstraints.length === 2, "down migration lost a ranked CHECK");
    for (const check of downConstraints) {
      expect(!check.convalidated, `${check.conname} down state was unexpectedly VALID`);
      expect(!check.definition.includes(LEGACY_ID), `${check.conname} down state kept exemption`);
    }
    expect(
      (await loadLegacy()).full_md5 === initialLegacy.full_md5,
      "down migration changed the historical row",
    );
    console.log("[ranked-legacy-proof] down migration PASS — prior NOT VALID state restored");

    for (const statement of migrationStatements("0014_ranked_binding_legacy_exemption.sql")) {
      await db.execute(sql.raw(statement));
    }
    const revalidatedChecks = (await loadConstraints()).filter((row) =>
      CHECK_NAMES.includes(row.conname as (typeof CHECK_NAMES)[number]),
    );
    expect(
      revalidatedChecks.length === 2 && revalidatedChecks.every((row) => row.convalidated),
      "up migration did not revalidate both ranked CHECKs",
    );
    expect(
      (await loadLegacy()).full_md5 === initialLegacy.full_md5,
      "up migration changed the historical row",
    );
    console.log("[ranked-legacy-proof] up migration PASS — both ranked CHECKs VALID");

    const negativeCollision = await db.execute<{ count: number }>(sql`
      SELECT count(*)::integer AS count
      FROM leaderboard_entries
      WHERE id = ${NEGATIVE_ID}::uuid OR token = 'ranked-legacy-negative-probe'
    `);
    expect(negativeCollision.rows[0]?.count === 0, "negative probe identity already exists");
    await db.execute(sql`
      DO $negative_probe$
      DECLARE
        legacy_user_id uuid;
      BEGIN
        SELECT user_id INTO STRICT legacy_user_id
        FROM leaderboard_entries
        WHERE id = '4dc1df8e-530d-47c3-9364-5e6beea571a2'::uuid;

        BEGIN
          INSERT INTO leaderboard_entries (
            id, season_key, mode, draft_mode, draft_order, era, rating_basis,
            user_id, token, verified_score
          ) VALUES (
            '00000000-0000-4000-8000-000000000014'::uuid,
            'ranked-legacy-negative-season',
            'ranked',
            'classic',
            'squad_first',
            'all_time',
            'career',
            legacy_user_id,
            'ranked-legacy-negative-probe',
            999
          );
          RAISE EXCEPTION 'non-exempt attempt-less ranked insert unexpectedly succeeded';
        EXCEPTION WHEN check_violation THEN
          NULL;
        END;
      END
      $negative_probe$
    `);
    const negativeResidue = await db.execute<{ count: number }>(sql`
      SELECT count(*)::integer AS count
      FROM leaderboard_entries
      WHERE id = ${NEGATIVE_ID}::uuid OR token = 'ranked-legacy-negative-probe'
    `);
    expect(negativeResidue.rows[0]?.count === 0, "negative probe left residue");
    console.log("[ranked-legacy-proof] negative insert PASS — rejected with no residue");

    const deleted = await db.execute<{ id: string }>(sql`
      DELETE FROM sessions
      WHERE id = (
        SELECT session_id
        FROM leaderboard_entries
        WHERE id = ${LEGACY_ID}::uuid
      )
      RETURNING id
    `);
    expect(deleted.rows.length === 1, "historical expired session delete count was not one");
    const finalLegacy = await loadLegacy();
    expect(finalLegacy.session_id === null, "ON DELETE SET NULL did not clear session_id");
    expect(
      finalLegacy.stable_md5 === initialLegacy.stable_md5,
      "historical row changed outside session_id",
    );
    const expiredAfter = await loadExpiredCount();
    expect(expiredAfter === expiredBefore - 1, "expired-session backlog delta was not exactly -1");
    console.log(
      `[ranked-legacy-proof] cascade PASS — expired backlog ${expiredBefore.toString()} -> ${expiredAfter.toString()}; only session_id changed`,
    );
    console.log("[ranked-legacy-proof] PASS");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("[ranked-legacy-proof] FAIL — protected diagnostics are not printed");
  process.exit(1);
});
