// Read-only migration status check for CI and operator verification.
//
// This script never invokes the migrator and never mutates the database. It
// reads drizzle.__drizzle_migrations, compares the applied row count with the
// committed migration journal, and exits non-zero when migrations are pending
// or when the migration table has more rows than this checkout knows about.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { openMigratorDb } from "../src/client.ts";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

interface AppliedMigrationRow extends Record<string, unknown> {
  id: number;
  hash: string;
  created_at: string | Date;
}

function readJournal(): Journal {
  const journalUrl = new URL("../migrations/meta/_journal.json", import.meta.url);
  return JSON.parse(readFileSync(journalUrl, "utf8")) as Journal;
}

function formatCreatedAt(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function readAppliedMigrations(
  db: Awaited<ReturnType<typeof openMigratorDb>>["db"],
): Promise<AppliedMigrationRow[]> {
  const exists = await db.execute<{ exists: boolean }>(sql`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS "exists"
  `);
  if (!exists.rows[0]?.exists) return [];

  const applied = await db.execute<AppliedMigrationRow>(sql`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `);
  return applied.rows;
}

async function main(): Promise<void> {
  const journal = readJournal();
  const { db, pool } = openMigratorDb();
  try {
    const applied = await readAppliedMigrations(db);
    if (applied.length > journal.entries.length) {
      throw new Error(
        `[db:migrate:status] database has ${applied.length.toString()} applied migrations, ` +
          `but this checkout only knows ${journal.entries.length.toString()}.`,
      );
    }

    const appliedEntries = journal.entries.slice(0, applied.length);
    const pendingEntries = journal.entries.slice(applied.length);

    console.log(
      `[db:migrate:status] applied=${appliedEntries.length.toString()} ` +
        `pending=${pendingEntries.length.toString()} total=${journal.entries.length.toString()}`,
    );
    for (const [index, entry] of appliedEntries.entries()) {
      const row = applied[index];
      if (!row) {
        throw new Error(`[db:migrate:status] missing applied row for ${entry.tag}`);
      }
      console.log(
        `  applied ${entry.idx.toString().padStart(4, "0")} ${entry.tag} ` +
          `(db id=${row.id.toString()}, created_at=${formatCreatedAt(row.created_at)})`,
      );
    }
    for (const entry of pendingEntries) {
      console.log(`  pending ${entry.idx.toString().padStart(4, "0")} ${entry.tag}`);
    }

    if (pendingEntries.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("[db:migrate:status] FAILED; protected diagnostics are not printed");
  process.exit(1);
});
