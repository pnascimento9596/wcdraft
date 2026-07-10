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
          window_expires_at,
          consumed_at
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
          now() + interval '1 hour',
          '2026-07-10T12:00:00.000Z'
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
          attempt_formation_id,
          attempt_consumed_at,
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
          '4-3-3',
          '2026-07-10T12:00:00.000Z',
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

  it("rejects another user's unconsumed cross-config attempt before ranked insertion", async () => {
    await withMigratedPglite(async ({ client }) => {
      const rivalId = "00000000-0000-4000-8000-000000000003";
      const attemptId = "00000000-0000-4000-8000-000000000004";
      await client.exec(`
        INSERT INTO users (id, email, username)
        VALUES
          ('${USER_ID}', 'bound-player@example.com', 'bound_player'),
          ('${rivalId}', 'bound-rival@example.com', 'bound_rival')
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
          '${attemptId}',
          '${rivalId}',
          'season-rival',
          '3-5-2',
          'hidden',
          'position_first',
          'modern',
          'current',
          'seed-rival',
          'nonce-rival-000000',
          now() + interval '1 hour'
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
            user_id,
            attempt_id,
            attempt_formation_id,
            attempt_consumed_at,
            token,
            verified_score
          )
          VALUES (
            'season-player',
            'ranked',
            'classic',
            'squad_first',
            'all_time',
            'career',
            '${USER_ID}',
            '${attemptId}',
            '4-3-3',
            '2026-07-10T12:00:00.000Z',
            'adversarial-token',
            999
          )
        `),
      ).rejects.toThrow(/leaderboard_entries_ranked_attempt_binding_fk|foreign key/i);

      const inserted = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM leaderboard_entries WHERE token = 'adversarial-token'`,
      );
      expect(inserted.rows).toEqual([{ count: 0 }]);
    });
  });

  it("preserves pre-binding ranked rows while enforcing 0012 for every new write", async () => {
    const client = await PGlite.create();
    try {
      await applyMigrationsThrough(client, "0008");
      await client.exec(`
        INSERT INTO users (id, email, username)
        VALUES ('${USER_ID}', 'legacy-ranked@example.com', 'legacy_ranked');

        INSERT INTO leaderboard_entries (
          season_key,
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
          'season-legacy',
          'ranked',
          'classic',
          'squad_first',
          'all_time',
          'career',
          '${USER_ID}',
          'legacy-unbound-ranked-token',
          111
        )
      `);

      await applyMigrationFile(client, "0009_ranked_attempt_binding.sql");
      await applyMigrationFile(client, "0010_account_password.sql");
      await applyMigrationFile(client, "0011_email_verification.sql");

      const newAttemptId = "00000000-0000-4000-8000-000000000007";
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
          window_expires_at,
          consumed_at
        )
        VALUES (
          '${newAttemptId}',
          '${USER_ID}',
          'season-new',
          '4-3-3',
          'classic',
          'squad_first',
          'all_time',
          'career',
          'seed-new-write',
          'nonce-new-write-0000',
          now() + interval '1 hour',
          '2026-07-10T14:00:00.000Z'
        )
      `);

      await applyMigrationFile(client, "0012_ranked_attempt_structural_binding.sql");

      const legacy = await client.query<{
        attempt_id: string | null;
        attempt_formation_id: string | null;
        attempt_consumed_at: Date | null;
      }>(`
        SELECT attempt_id, attempt_formation_id, attempt_consumed_at
        FROM leaderboard_entries
        WHERE token = 'legacy-unbound-ranked-token'
      `);
      expect(legacy.rows).toEqual([
        {
          attempt_id: null,
          attempt_formation_id: null,
          attempt_consumed_at: null,
        },
      ]);

      const validation = await client.query<{ conname: string; convalidated: boolean }>(`
        SELECT conname, convalidated
        FROM pg_constraint
        WHERE conname IN (
          'leaderboard_entries_ranked_attempt_binding_chk',
          'leaderboard_entries_ranked_attempt_binding_fk'
        )
        ORDER BY conname
      `);
      expect(validation.rows).toEqual([
        {
          conname: "leaderboard_entries_ranked_attempt_binding_chk",
          convalidated: false,
        },
        {
          conname: "leaderboard_entries_ranked_attempt_binding_fk",
          convalidated: false,
        },
      ]);

      await expect(
        client.exec(`
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
            'season-new',
            'ranked',
            'classic',
            'squad_first',
            'all_time',
            'career',
            '${USER_ID}',
            '${newAttemptId}',
            'new-incomplete-ranked-token',
            222
          )
        `),
      ).rejects.toThrow(/leaderboard_entries_ranked_attempt_binding_chk|check constraint/i);

      const inserted = await client.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM leaderboard_entries
        WHERE token = 'new-incomplete-ranked-token'
      `);
      expect(inserted.rows).toEqual([{ count: 0 }]);

      await applyDownMigrationFile(client, "0012_ranked_attempt_structural_binding.down.sql");
      const survivor = await client.query<{ token: string; attempt_id: string | null }>(`
        SELECT token, attempt_id
        FROM leaderboard_entries
        WHERE token = 'legacy-unbound-ranked-token'
      `);
      expect(survivor.rows).toEqual([{ token: "legacy-unbound-ranked-token", attempt_id: null }]);
    } finally {
      await client.close();
    }
  });

  it("applies 0012 over historical rows and rolls only 0012 back without data loss", async () => {
    const client = await PGlite.create();
    try {
      await applyMigrationsThrough(client, "0011");
      const attemptId = "00000000-0000-4000-8000-000000000005";
      await client.exec(`
        INSERT INTO users (id, email, username)
        VALUES ('${USER_ID}', 'historical-player@example.com', 'historical_player');

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
          window_expires_at,
          consumed_at
        )
        VALUES (
          '${attemptId}',
          '${USER_ID}',
          'season-history',
          '4-3-3',
          'classic',
          'squad_first',
          'all_time',
          'career',
          'seed-history',
          'nonce-history-0000',
          now() + interval '1 hour',
          '2026-07-10T13:00:00.000Z'
        );

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
          'season-history',
          'ranked',
          'classic',
          'squad_first',
          'all_time',
          'career',
          '${USER_ID}',
          '${attemptId}',
          'historical-ranked-token',
          150
        );

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
          'season-history',
          'casual',
          'classic',
          'squad_first',
          'all_time',
          'career',
          'history_casual',
          'historical-casual-token',
          120
        )
      `);

      await applyMigrationFile(client, "0012_ranked_attempt_structural_binding.sql");
      const bound = await client.query<{
        attempt_formation_id: string | null;
        attempt_consumed_at: Date | null;
      }>(`
        SELECT attempt_formation_id, attempt_consumed_at
        FROM leaderboard_entries
        WHERE token = 'historical-ranked-token'
      `);
      expect(bound.rows).toHaveLength(1);
      expect(bound.rows[0]?.attempt_formation_id).toBe("4-3-3");
      expect(new Date(bound.rows[0]!.attempt_consumed_at!).toISOString()).toBe(
        "2026-07-10T13:00:00.000Z",
      );
      const casual = await client.query<{
        attempt_formation_id: string | null;
        attempt_consumed_at: Date | null;
      }>(`
        SELECT attempt_formation_id, attempt_consumed_at
        FROM leaderboard_entries
        WHERE token = 'historical-casual-token'
      `);
      expect(casual.rows).toEqual([{ attempt_formation_id: null, attempt_consumed_at: null }]);

      await applyDownMigrationFile(client, "0012_ranked_attempt_structural_binding.down.sql");
      const columns = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leaderboard_entries'
          AND column_name IN ('attempt_formation_id', 'attempt_consumed_at')
      `);
      expect(columns.rows).toEqual([]);
      const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conname = 'leaderboard_entries_attempt_id_ranked_attempts_id_fk'
      `);
      expect(constraints.rows).toEqual([
        { conname: "leaderboard_entries_attempt_id_ranked_attempts_id_fk" },
      ]);
      const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'leaderboard_entries_ranked_attempt_uq',
            'ranked_attempts_binding_uq'
          )
        ORDER BY indexname
      `);
      expect(indexes.rows).toEqual([{ indexname: "leaderboard_entries_ranked_attempt_uq" }]);
      const survivors = await client.query<{ token: string }>(`
        SELECT token
        FROM leaderboard_entries
        WHERE token IN ('historical-ranked-token', 'historical-casual-token')
        ORDER BY token
      `);
      expect(survivors.rows).toEqual([
        { token: "historical-casual-token" },
        { token: "historical-ranked-token" },
      ]);
    } finally {
      await client.close();
    }
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

async function applyDownMigrationFile(client: PGlite, fileName: string): Promise<void> {
  return applyMigrationFile(client, fileName);
}
