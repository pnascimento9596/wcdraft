// F-1 — schema barrel.
//
// Drizzle-kit's `generate` reads this entrypoint (see drizzle.config.ts:
// schema = "./src/schema/index.ts"). Adding a new table = new module + a
// re-export here.
export * from "./users.ts";
export * from "./magic-link-tokens.ts";
export * from "./sessions.ts";
export * from "./saved-runs.ts";
export * from "./ranked-attempts.ts";
export * from "./leaderboard-entries.ts";
export * from "./auth-rate-limits.ts";
