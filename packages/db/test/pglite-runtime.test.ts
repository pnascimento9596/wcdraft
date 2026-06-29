import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { withMigratedPglite } from "./_pglite.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

describe("@wcdraft/db pglite runtime", () => {
  it("applies committed migrations and exposes the user recent leaderboard index", async () => {
    await withMigratedPglite(async ({ client }) => {
      const indexes = await client.query<{ indexname: string; indexdef: string }>(
        `
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'leaderboard_entries'
            AND indexname = 'leaderboard_entries_user_recent_idx'
        `,
      );

      expect(indexes.rows).toHaveLength(1);
      const index = indexes.rows[0];
      expect(index?.indexdef).toMatch(/user_id, season_key, mode, created_at DESC/);
      expect(index?.indexdef).toMatch(/WHERE \(user_id IS NOT NULL\)/);
    });
  });

  it("enforces anonymous leaderboard dedupe with NULLS NOT DISTINCT", async () => {
    await withMigratedPglite(async ({ client }) => {
      await client.exec(`
        INSERT INTO leaderboard_entries (
          season_key,
          mode,
          draft_mode,
          draft_order,
          era,
          rating_basis,
          display_alias,
          token,
          verified_score
        )
        VALUES (
          'season-a',
          'casual',
          'classic',
          'squad_first',
          'all_time',
          'career',
          'anon_one',
          'same-token',
          100
        )
      `);

      await expect(
        client.exec(`
          INSERT INTO leaderboard_entries (
            season_key,
            mode,
            draft_mode,
            draft_order,
            era,
            rating_basis,
            display_alias,
            token,
            verified_score
          )
          VALUES (
            'season-a',
            'casual',
            'classic',
            'squad_first',
            'all_time',
            'career',
            'anon_two',
            'same-token',
            101
          )
        `),
      ).rejects.toThrow(/leaderboard_entries_season_dedupe_uq|duplicate key/i);
    });
  });

  it("allows the same daily token for different anonymous sessions", async () => {
    await withMigratedPglite(async ({ client }) => {
      await client.exec(`
        INSERT INTO sessions (id, csrf_secret, expires_at)
        VALUES
          ('daily-session-a', 'csrf-a', now() + interval '1 day'),
          ('daily-session-b', 'csrf-b', now() + interval '1 day')
      `);

      for (const sessionId of ["daily-session-a", "daily-session-b"]) {
        await client.exec(`
          INSERT INTO leaderboard_entries (
            season_key,
            challenge_type,
            challenge_date,
            rating_version,
            mode,
            draft_mode,
            draft_order,
            era,
            rating_basis,
            session_id,
            display_alias,
            token,
            verified_score
          )
          VALUES (
            'season-a',
            'daily',
            '2026-06-29',
            'ratings-a',
            'casual',
            'classic',
            'squad_first',
            'all_time',
            'career',
            '${sessionId}',
            'daily_alias',
            'same-daily-token',
            100
          )
        `);
      }

      const rows = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM leaderboard_entries WHERE challenge_type = 'daily'`,
      );
      expect(rows.rows).toEqual([{ count: "2" }]);
    });
  });

  it("rejects daily ranked rows even when a user is present", async () => {
    await withMigratedPglite(async ({ client }) => {
      await client.exec(`
        INSERT INTO users (id, email, username)
        VALUES ('${USER_ID}', 'daily-ranked@example.com', 'daily_ranked')
      `);

      await expect(
        client.exec(`
          INSERT INTO leaderboard_entries (
            season_key,
            challenge_type,
            challenge_date,
            rating_version,
            mode,
            draft_mode,
            draft_order,
            era,
            rating_basis,
            user_id,
            token,
            verified_score
          )
          VALUES (
            'season-daily-ranked',
            'daily',
            '2026-06-29',
            'ratings-a',
            'ranked',
            'classic',
            'squad_first',
            'all_time',
            'career',
            '${USER_ID}',
            'daily-ranked-token',
            120
          )
        `),
      ).rejects.toThrow(/leaderboard_entries_daily_mode_chk|check constraint/i);
    });
  });

  it("preserves the existing anonymous casual row when applying the daily challenge migration", async () => {
    const client = await PGlite.create();
    try {
      await applyMigrationsThrough(client, "0007");
      await client.exec(`
        INSERT INTO leaderboard_entries (
          season_key,
          mode,
          draft_mode,
          draft_order,
          era,
          rating_basis,
          display_alias,
          token,
          verified_score
        )
        VALUES (
          'engine-2026.06.28-merit-v4.6_wc-perf-6.6.0+proj-career-5.6.0_2026-06-04_ruleset-2026.06.04_aa7256a5',
          'casual',
          'classic',
          'squad_first',
          'all_time',
          'career',
          'wow',
          'wow-token',
          35
        )
      `);

      await applyMigrationFile(client, "0008_leaderboard_daily_challenge.sql");

      const rows = await client.query<{
        display_alias: string;
        verified_score: number;
        challenge_type: string;
        challenge_date: string | null;
      }>(`
        SELECT display_alias, verified_score, challenge_type, challenge_date
        FROM leaderboard_entries
        WHERE display_alias = 'wow'
      `);
      expect(rows.rows).toEqual([
        {
          display_alias: "wow",
          verified_score: 35,
          challenge_type: "season",
          challenge_date: null,
        },
      ]);
    } finally {
      await client.close();
    }
  });

  it("rolls back the daily migration after valid duplicate daily-token rows", async () => {
    const client = await PGlite.create();
    try {
      await applyMigrationsThrough(client, "0008");
      await client.exec(`
        INSERT INTO sessions (id, csrf_secret, expires_at)
        VALUES
          ('rollback-daily-a', 'csrf-a', now() + interval '1 day'),
          ('rollback-daily-b', 'csrf-b', now() + interval '1 day')
      `);
      await client.exec(`
        INSERT INTO leaderboard_entries (
          season_key,
          challenge_type,
          challenge_date,
          rating_version,
          mode,
          draft_mode,
          draft_order,
          era,
          rating_basis,
          display_alias,
          token,
          verified_score
        )
        VALUES (
          'season-rollback',
          'season',
          NULL,
          'ratings-a',
          'casual',
          'classic',
          'squad_first',
          'all_time',
          'career',
          'season_survivor',
          'season-survivor-token',
          55
        )
      `);
      for (const sessionId of ["rollback-daily-a", "rollback-daily-b"]) {
        await client.exec(`
          INSERT INTO leaderboard_entries (
            season_key,
            challenge_type,
            challenge_date,
            rating_version,
            mode,
            draft_mode,
            draft_order,
            era,
            rating_basis,
            session_id,
            display_alias,
            token,
            verified_score
          )
          VALUES (
            'season-rollback',
            'daily',
            '2026-06-29',
            'ratings-a',
            'casual',
            'classic',
            'squad_first',
            'all_time',
            'career',
            '${sessionId}',
            'daily_rollback',
            'same-daily-token',
            75
          )
        `);
      }

      await applyMigrationFile(client, "0008_leaderboard_daily_challenge.down.sql");

      const seasonRows = await client.query<{ token: string }>(`
        SELECT token
        FROM leaderboard_entries
        WHERE display_alias = 'season_survivor'
      `);
      expect(seasonRows.rows).toEqual([{ token: "season-survivor-token" }]);

      const dailyRows = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM leaderboard_entries
        WHERE token = 'same-daily-token'
      `);
      expect(dailyRows.rows).toEqual([{ count: "0" }]);

      const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conname = 'leaderboard_entries_dedupe_uq'
      `);
      expect(constraints.rows).toEqual([{ conname: "leaderboard_entries_dedupe_uq" }]);
    } finally {
      await client.close();
    }
  });

  it("enforces ranked leaderboard rows have a user", async () => {
    await withMigratedPglite(async ({ client }) => {
      await expect(
        client.exec(`
          INSERT INTO leaderboard_entries (
            season_key,
            mode,
            draft_mode,
            draft_order,
            era,
            rating_basis,
            display_alias,
            token,
            verified_score
          )
          VALUES (
            'season-ranked',
            'ranked',
            'classic',
            'squad_first',
            'all_time',
            'career',
            'ranked_alias',
            'ranked-token',
            120
          )
        `),
      ).rejects.toThrow(/leaderboard_entries_ranked_(user|attempt)_chk|check constraint/i);
    });
  });

  it("accepts a user-owned leaderboard entry matching the new index path", async () => {
    await withMigratedPglite(async ({ client }) => {
      await client.exec(`
        INSERT INTO users (id, email, username)
        VALUES ('${USER_ID}', 'player@example.com', 'player_one')
      `);

      await client.exec(`
        INSERT INTO ranked_attempts (
          id,
          user_id,
          season_key,
          formation_id,
          draft_mode,
          draft_order,
          era,
          rating_basis,
          issued_parent_seed,
          nonce,
          window_expires_at
        )
        VALUES (
          '00000000-0000-4000-8000-000000000002',
          '${USER_ID}',
          'season-user',
          '4-3-3',
          'classic',
          'squad_first',
          'all_time',
          'career',
          'seed-user',
          'nonce-user-000000',
          now() + interval '1 hour'
        )
      `);

      await client.exec(`
        INSERT INTO leaderboard_entries (
          season_key,
          mode,
          draft_mode,
          draft_order,
          era,
          rating_basis,
          user_id,
          attempt_id,
          token,
          verified_score
        )
        VALUES (
          'season-user',
          'ranked',
          'classic',
          'squad_first',
          'all_time',
          'career',
          '${USER_ID}',
          '00000000-0000-4000-8000-000000000002',
          'user-token',
          140
        )
      `);

      const rows = await client.query<{ token: string }>(
        `
          SELECT token
          FROM leaderboard_entries
          WHERE user_id = '${USER_ID}'
            AND season_key = 'season-user'
            AND mode = 'ranked'
          ORDER BY created_at DESC
        `,
      );

      expect(rows.rows).toEqual([{ token: "user-token" }]);
    });
  });
});

async function applyMigrationsThrough(client: PGlite, lastPrefix: string): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && !name.endsWith(".down.sql"))
    .filter((name) => name.slice(0, 4) <= lastPrefix)
    .sort();
  for (const file of files) {
    await applyMigrationFile(client, file);
  }
}

async function applyMigrationFile(client: PGlite, fileName: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, fileName), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) await client.exec(trimmed);
  }
}
