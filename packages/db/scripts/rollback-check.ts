// F-1 — apply → rollback round-trip check, against the Neon DIRECT URL.
//
// 1. Apply ALL up-migrations (`drizzle-orm/neon-serverless/migrator`).
// 2. Run every paired `*.down.sql` in REVERSE journal order.
// 3. Assert the public schema is empty (no tables, no Drizzle bookkeeping).
//
// Exits non-zero on any step failure. Designed to run on a disposable Neon
// branch (NEVER prod) so a botched down-migration cannot damage production.
//
// Invocation: `pnpm --filter @wcdraft/db db:rollback-check`.
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { sql } from "drizzle-orm";
import { openMigratorDb } from "../src/client.ts";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
  version: string;
  breakpoints: boolean;
}
interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readJournal(): Journal {
  const journalUrl = new URL("../migrations/meta/_journal.json", import.meta.url);
  const raw = readFileSync(journalUrl, "utf8");
  return JSON.parse(raw) as Journal;
}

function readDown(tag: string): string {
  const downUrl = new URL(`../migrations/${tag}.down.sql`, import.meta.url);
  return readFileSync(downUrl, "utf8");
}

async function main(): Promise<void> {
  const { db, pool } = openMigratorDb();
  const migrationsFolder = new URL("../migrations", import.meta.url).pathname;
  try {
    // 1) APPLY
    console.log("[db:rollback-check] step 1/3 — applying all up-migrations");
    await migrate(db, { migrationsFolder });

    // 2) ROLLBACK in reverse order
    const journal = readJournal();
    const ordered = [...journal.entries].sort((a, b) => b.idx - a.idx);
    console.log(
      `[db:rollback-check] step 2/3 — running ${ordered.length.toString()} down-migration(s) in reverse`,
    );
    for (const entry of ordered) {
      const downSql = readDown(entry.tag);
      console.log(`  ↩ ${entry.tag}.down.sql`);
      await db.execute(sql.raw(downSql));
    }

    // 3) ASSERT EMPTY public schema (no user tables, no drizzle bookkeeping)
    console.log("[db:rollback-check] step 3/3 — asserting public schema is empty");
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `);
    const remaining = result.rows.map((r) => r.table_name);
    if (remaining.length > 0) {
      throw new Error(
        `rollback-check: public schema is not empty after rollback. Remaining tables: ${remaining.join(", ")}`,
      );
    }

    const drizzleSchema = await db.execute<{ schema_name: string }>(sql`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'drizzle'
    `);
    if (drizzleSchema.rows.length > 0) {
      throw new Error(
        "rollback-check: drizzle bookkeeping schema still present after rollback. " +
          "Down-migration must drop it (see 0000_init.down.sql).",
      );
    }

    console.log("[db:rollback-check] OK — apply → rollback round-trip clean");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[db:rollback-check] FAILED", err);
  process.exit(1);
});
