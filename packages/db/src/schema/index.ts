// F-1 — schema barrel.
//
// Drizzle-kit's `generate` reads this entrypoint (see drizzle.config.ts:
// schema = "./src/schema/index.ts"). Adding a new table = new module + a
// re-export here.
export * from "./users.js";
export * from "./magic-link-tokens.js";
export * from "./sessions.js";
export * from "./saved-runs.js";
export * from "./ranked-attempts.js";
export * from "./leaderboard-entries.js";
