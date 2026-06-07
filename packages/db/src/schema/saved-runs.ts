// F-1 → F-3 — saved_runs.
//
// Stores the RECONSTRUCTION TOKEN (`t1.*`), never trusted client state.
// `version_anchors` is a column-only stub in F-1; F-4 will populate it (and
// derive `leaderboard_entries.season_key` from the same anchors embedded in
// the token).
//
// SCOPING (F-3): the row's identity scope is "owner_user_id when set, else
// session_id". F-1's global `UNIQUE NULLS NOT DISTINCT (owner_user_id, token)`
// was correct for the anti-spam vector flagged on PR #26, but it scoped
// anonymous saves GLOBALLY — two different anon sessions saving the same
// token would collide. F-3 splits the constraint into two PARTIAL unique
// indexes so:
//   - account rows dedupe per-user      → (owner_user_id, token) WHERE owner_user_id IS NOT NULL
//   - anon rows dedupe per-session      → (session_id, token)    WHERE owner_user_id IS NULL AND session_id IS NOT NULL
//
// `session_id` is a NULLABLE FK to sessions.id with ON DELETE SET NULL —
// account rows have it null (the claim step at sign-in clears it), and a
// session row being pruned doesn't blow away the user's saved runs.
//
// `claim_state` distinguishes 'anonymous' (anon row, has session_id) from
// 'claimed' (transferred to an account by the F-3 claim path); the F-1
// DB-level CHECK still enforces the closed enum.
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
    runId: text("run_id"),
    parentSeed: text("parent_seed"),
    claimState: text("claim_state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saved_runs_owner_created_idx").on(t.ownerUserId, t.createdAt),
    // Session lookup: "list this anon session's runs" + "claim all rows for this session".
    index("saved_runs_session_idx").on(t.sessionId),
    // Account-scoped dedupe.
    uniqueIndex("saved_runs_owner_token_uq")
      .on(t.ownerUserId, t.token)
      .where(sql`${t.ownerUserId} IS NOT NULL`),
    // Session-scoped anon dedupe — only applies to anonymous rows. The
    // composite predicate makes the index empty for account rows so the
    // account constraint above is the only thing dedupe'ing them.
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
