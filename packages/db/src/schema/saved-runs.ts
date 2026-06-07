// F-1 → F-3.5 — saved_runs.
//
// SCOPING (F-3): the row's identity scope is "owner_user_id when set, else
// session_id". Account rows dedupe per-user, anon rows dedupe per-session
// (see the two partial unique indexes below).
//
// DISPLAY METADATA (F-3.5): the new `summary` jsonb column carries the
// display-ready subset the client computes at save time (team name,
// record, formation, top 3 stars, is_champion, seed). The server stores it
// opaquely; the client (server-history-provider) reads it back to render
// real records. Honest-state contract: a row WITHOUT summary renders "—"
// in the UI — never fabricated. Older rows (pre-F-3.5) and rows where the
// client save mirror raced ahead of the simulation also surface as "—".
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.ts";
import { sessions } from "./sessions.ts";

export const savedRuns = pgTable(
  "saved_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    token: text("token").notNull(),
    versionAnchors: jsonb("version_anchors"),
    verifiedResult: jsonb("verified_result"),
    // F-3.5 — display-ready summary {team_name, display_record, formation_name,
    // key_picks[3], is_champion, seed, created_seq, updated_seq}. Nullable so
    // pre-F-3.5 rows still surface (rendered as "—").
    summary: jsonb("summary"),
    runId: text("run_id"),
    parentSeed: text("parent_seed"),
    claimState: text("claim_state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saved_runs_owner_created_idx").on(t.ownerUserId, t.createdAt),
    index("saved_runs_session_idx").on(t.sessionId),
    uniqueIndex("saved_runs_owner_token_uq")
      .on(t.ownerUserId, t.token)
      .where(sql`${t.ownerUserId} IS NOT NULL`),
    uniqueIndex("saved_runs_session_token_uq")
      .on(t.sessionId, t.token)
      .where(sql`${t.ownerUserId} IS NULL AND ${t.sessionId} IS NOT NULL`),
    check(
      "saved_runs_claim_state_chk",
      sql`${t.claimState} IN ('anonymous', 'claimed')`,
    ),
  ],
);

export type SavedRun = typeof savedRuns.$inferSelect;
export type NewSavedRun = typeof savedRuns.$inferInsert;
