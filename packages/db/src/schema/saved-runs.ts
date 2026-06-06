// F-1 — saved_runs.
//
// Stores the RECONSTRUCTION TOKEN, never trusted client state. F-3 will
// re-simulate from this token on read or on claim to derive `verified_result`.
// `version_anchors` is a column-only stub in F-1; F-4 will populate it (and
// derive `leaderboard_entries.season_key` from the same anchors embedded in
// the token).
//
// `owner_user_id` is NULLABLE so anonymous sessions can save runs that get
// claimed later. `claim_state` distinguishes the two for F-3 UI and for
// anon-history reaping policy. The DB-level CHECK constraint enforces the
// closed enum so a row written without going through the F-3 application
// layer cannot silently land an unknown state.
//
// Dedupe is via a UNIQUE CONSTRAINT with NULLS NOT DISTINCT (Postgres 15+)
// so two anonymous rows (owner_user_id IS NULL) with the same token are
// rejected. The default Postgres NULLS-DISTINCT semantics make a plain
// unique index toothless against the DEFAULT pre-auth case (verified by an
// independent reviewer on Neon). Anonymous-first is the load-bearing path,
// so the constraint is non-negotiable. NULLS NOT DISTINCT is compatible
// with the anon→account claim flow: claiming re-keys NULL→user_id, which
// remains unique by the new key.
//
// FLAG for F-3: decide whether anonymous saved_runs should be session-scoped
// vs global-per-token. If scoped, that's an additive index change (add
// session_id, drop the global anon dedupe). Leaderboard dedupe stays
// global-effective regardless.
import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.ts";

export const savedRuns = pgTable(
  "saved_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
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
    unique("saved_runs_owner_token_uq")
      .on(t.ownerUserId, t.token)
      .nullsNotDistinct(),
    check(
      "saved_runs_claim_state_chk",
      sql`${t.claimState} IN ('anonymous', 'claimed')`,
    ),
  ],
);

export type SavedRun = typeof savedRuns.$inferSelect;
export type NewSavedRun = typeof savedRuns.$inferInsert;
