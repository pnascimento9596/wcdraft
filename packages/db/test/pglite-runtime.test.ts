import { describe, expect, it } from "vitest";
import { withMigratedPglite } from "./_pglite.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";

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
      ).rejects.toThrow(/leaderboard_entries_dedupe_uq|duplicate key/i);
    });
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
      ).rejects.toThrow(/leaderboard_entries_ranked_user_chk|check constraint/i);
    });
  });

  it("accepts a user-owned leaderboard entry matching the new index path", async () => {
    await withMigratedPglite(async ({ client }) => {
      await client.exec(`
        INSERT INTO users (id, email, username)
        VALUES ('${USER_ID}', 'player@example.com', 'player_one')
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
