# F-4 Leaderboard — Deep Plan (RED planning phase)

**Date:** 2026-06-10 · **Repo state investigated:** `main` @ `877f7bf` ·
**Status:** design only — NO implementation, NO schema changes in this PR.

**Identity decision (Paulo):** anonymous-first with account-claim. Submissions
carry a display name + the `t1.` token; the F-3 anon→account claim machinery is
the later bridge. The identity boundary is a single swappable gate so
auth-gating is a config flip, not a rebuild (§5.3).

All file:line citations below are against `877f7bf` and were read directly,
not assumed.

---

## 0. Investigation summary — what the repo actually gives us

The whole anti-cheat design hangs on one verified fact: **a full token replay
through `packages/core` IS the draft-legality proof.**

| Fact                                                                                                                                                                                                                                                                                           | Citation                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `t1.` token = `t1.<base64url(JSON)>`, carries `{v, rid, fid, ps (parent_seed), tn, md, pl (17 picks), sv, dv, rv, ev, uv, hv}`; no signature; ≤ 8192 chars; `decodeRunToken` returns `null` on any malformation                                                                                | `apps/web/lib/game/run-token.ts:48-81`, `run-token.ts:221-240`                                                                                   |
| `versionsAgree` = strict 6-anchor conjunction: `schema_version`, `dataset_version`, `rating_version`, `engine_version`, `ruleset_version`, `data_bundle_hash`                                                                                                                                  | `apps/web/lib/game/run-token.ts:243-252`                                                                                                         |
| Current anchor values: `runtime-data-1.1.0` / `2026-06-04` / `wc-perf-4.2.1+proj-career-3.0.0` / `engine-2026.06.09` / `ruleset-2026.06.04` / `<sha256+sha256>`                                                                                                                                | `packages/data/src/generated/manifest.json:62-86`, composed at `apps/web/lib/game/data.ts:122-131`                                               |
| Spin candidates derive ONLY from `(draft_seed, prior picks, catalog)`: `deriveSubseed(parent_seed, "draft")` → sfc32 stream → one `rng.next()` per spin → weighted (T,N) draw → canonically-sorted roster minus picked players. No `Date.now`/`Math.random` anywhere in core (ESLint-enforced) | `packages/core/src/rng.ts:17-20,214-240`, `packages/core/src/draft.ts:519-558,567-602,625-670`                                                   |
| `pickPlayer` **rejects any card not in the active spin's `rolled_card_ids`**, plus tournament match, global player dedup, manager strand-guard, slot vacancy                                                                                                                                   | `packages/core/src/draft.ts:890-952`                                                                                                             |
| `reconstructDraftFromToken` replays the token's pick log through `createDraft` + `pickPlayer`/`pickManager` and throws `RunTokenError` at the first illegal pick; replayed `DraftState` is byte-equal to origin (test-locked)                                                                  | `apps/web/lib/game/run-token.ts:262-300`, `apps/web/lib/game/__tests__/run-token.test.ts:167-175`                                                |
| Sim entry: `runTournamentFull(draft, scenario, seed, world)`; `run.score` is an **integer** ("Final leaderboard points") with transparent `score_breakdown`                                                                                                                                    | `packages/core/src/engine/tournament.ts:171-197`, `packages/core/src/types/run.ts:126-129`                                                       |
| `packages/core` is pure Node-compatible (single export condition, no browser/Worker APIs); `packages/data` has explicit `/node` and default static-JSON exports; the web app's Worker usage is an apps/web wrapper only (`sim.worker.ts`), not a core dependency                               | `packages/core/package.json:9-12`, `packages/data/package.json:9-21`, `apps/web/lib/game/simulate.ts:271-292`, `apps/web/lib/game/sim.worker.ts` |
| F-1 tables `ranked_attempts` + `leaderboard_entries` exist, migrated, constraint-tested; **no F-4 route handlers exist**                                                                                                                                                                       | `packages/db/src/schema/ranked-attempts.ts:14-38`, `packages/db/src/schema/leaderboard-entries.ts:40-71`, migrations `0000_init`                 |
| F-2 sessions: opaque signed `wcdraft_sid` cookie (HMAC-SHA256, `AUTH_COOKIE_SECRET`), anon sessions have `user_id NULL`, 30-day TTL; CSRF = double-submit (`wcdraft_csrf` cookie + `x-csrf-token` header vs per-session `csrf_secret`) + Origin/Host check                                     | `apps/web/lib/auth/sessions.ts:30,39-96`, `apps/web/lib/auth/csrf.ts:35-76`                                                                      |
| F-3 claim: `claimAnonRuns` re-keys anon `saved_runs` (drop-conflicts-then-transfer), hooked into verify POST + explicit `/api/runs/claim` retry; ship-dark gate = `isAuthEnabled()` (both `RESEND_API_KEY` + `AUTH_EMAIL_FROM` set)                                                            | `apps/web/lib/game/saved-runs-store.ts:273-305`, `apps/web/app/api/auth/verify/route.ts:103-109`, `apps/web/lib/auth/auth-enabled.ts:28-33`      |
| Existing rate limiting: DB-backed sliding-window buckets (`auth_rate_limits`, SHA-256-hashed email/IP keys), used only by magic-link today (3/15 min per email, 10/h per IP)                                                                                                                   | `apps/web/lib/auth/rate-limit.ts:40-65`, `apps/web/lib/auth/magic-link.ts:30-32,62-83`                                                           |
| Vercel: `vercel.json` sets only framework/build/install; **no** route segment configs anywhere under `app/api/**` → Node runtime, platform-default `maxDuration`; no middleware file                                                                                                           | `apps/web/vercel.json:1-6`, search of `apps/web/app/api/**`                                                                                      |
| Migrations: drizzle-kit generate → `packages/db/migrations/<tag>.sql` with **hand-paired `<tag>.down.sql>`**; CI applies + round-trips them on an ephemeral Neon branch (path-gated on `packages/db/**`)                                                                                       | `packages/db/drizzle.config.ts:17-20`, `packages/db/scripts/rollback-check.ts:29,251-256`, `.github/workflows/ci.yml:131-247`                    |

### 0.1 Measured re-sim cost (the cost-firewall number)

Benchmarked on the dev machine (Darwin arm64, Node v22.22.3) against built
`packages/core` + `packages/data` dist, real bundles, N=30 full validations
(replay 17 picks → `buildRunScenario` → `runTournamentFull`):

| Phase                                                             | p50        | p95         | max     |
| ----------------------------------------------------------------- | ---------- | ----------- | ------- |
| replay 17 picks (`createDraft` + `pickPlayer`×16 + `pickManager`) | 6.3 ms     | 15.8 ms     | 16.2 ms |
| `buildRunScenario`                                                | ~0 ms      | ~0 ms       | 0.2 ms  |
| `runTournamentFull`                                               | 0.9 ms     | 2.9 ms      | 4.5 ms  |
| **total per submission**                                          | **7.6 ms** | **17.0 ms** | 17.3 ms |

One-time per process: module load + bundle JSON parse ≈ 140 ms, catalog +
SimWorld build ≈ 9 ms. (Replay dominates because each pick re-derives pending
spins, `packages/core/src/draft.ts:625-670`; the sim itself is ~1 ms.)

**Conclusion:** server re-sim is _cheap_. Verification is synchronous-friendly
(no queue, no pending state), and DoS via re-sim is a rate-limiting problem,
not a compute problem. Vercel serverless cold start adds the ~150 ms warmup;
the 34 MB `draft-pool.compact.json` static import is well inside Vercel's
250 MB function limit and the default 1 GB memory.

---

## 1. Threat model

| #   | Threat                                                                      | Vector                                                                                             | Defense (cite)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Fabricated picks** — hand-craft a token whose `pl` names 17 legends       | Token is unsigned JSON; trivially editable                                                         | Replay through `pickPlayer` rejects any card not in the re-derived `rolled_card_ids` for that spin (`packages/core/src/draft.ts:890`). Candidates derive only from `(parent_seed, prior picks, catalog)` (§0). An attacker would need a parent_seed whose derived spin stream _actually offers_ those picks — which is not forgery, it's playing (see T3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T2  | **Tampered results / score** — claim a score the run didn't produce         | Token carries no results; client could lie in a side-channel `claimed_score` field                 | Server score is authoritative: `verified_score` comes only from the server's own `runTournamentFull`. The submitted `claimed_score` is compared for equality and the submission is **rejected** on mismatch (honest-state: never persist a number the player didn't see).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T3  | **Seed-grinding** — offline search for god-squads                           | `parent_seed` is client-chosen in normal play; every grinded attempt is a _legitimate_ playthrough | **Quantified:** measured ~7.6 ms per full attempt single-threaded → ~130 attempts/s/core → ≈ 10⁷ attempts/day on one 8-core laptop using the public client code. So grinding is "playing a lot," accelerated ~10⁴×. It cannot be detected per-submission (the token is indistinguishable from organic play). Mitigations: (a) **casual board**: per-identity submission caps + best-entry-per-identity display bound the payoff (§4); (b) **ranked board**: server-issued seeds via `ranked_attempts` — `issued_parent_seed` minted server-side, short `window_expires_at`, single-use `consumed_at` (`packages/db/src/schema/ranked-attempts.ts:14-38`, intent documented at lines 1-9) make offline seed search impossible; within-window _pick_-search for the issued seed remains possible (that is computer-assisted play, accepted and out of scope). |
| T4  | **Duplicate / replayed submissions** — resubmit own or someone else's token | Tokens are public in share URLs                                                                    | DB-level dedupe already built: UNIQUE `(season_key, mode, user_id, token)` **NULLS NOT DISTINCT** — two anon rows with the same token cannot both insert (`packages/db/src/schema/leaderboard-entries.ts:63-65`, round-trip-tested in `packages/db/scripts/rollback-check.ts:220-229`). Submitting another player's shared token under your own identity is _not_ preventable cryptographically (tokens are unsigned, by design) — bounded by caps + dedupe; ranked mode closes it fully (attempt is bound to your session/user before play).                                                                                                                                                                                                                                                                                                               |
| T5  | **Name abuse** — slurs, impersonation, URL spam in display names            | Free-text field                                                                                    | Server-side allowlist validation + blocklist + moderation hide flag (§5.1-5.2). Raw names never interpolated into HTML (React escapes; no `dangerouslySetInnerHTML`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T6  | **DoS via expensive re-sim**                                                | POST flood at the submit route                                                                     | Cheapest-rejection-first pipeline (§2) — malformed/wrong-season/rate-limited requests never reach the 7.6 ms work; per-session + per-IP sliding-window limits reuse `auth_rate_limits` (`apps/web/lib/auth/rate-limit.ts:40-65`); CSRF + session requirement forces a cookie round-trip before any compute. At p95 = 17 ms, even 50 rps sustained ≈ 0.85 CPU-seconds/s — Vercel scales horizontally; Neon write volume (1 insert + ~3 reads per accept) is the real budget, hence rate limits sized to free tier (§5.2).                                                                                                                                                                                                                                                                                                                                    |
| T7  | **Cross-identity entry pollution** — submit under a victim's session        | —                                                                                                  | Session id is an opaque 256-bit server-minted cookie, HMAC-signed (`apps/web/lib/auth/sessions.ts:69-96`); CSRF double-submit + Origin/Host prevents cross-site forgery (`apps/web/lib/auth/csrf.ts:35-76`). Nothing new needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Non-threats (explicitly out of scope): breaking sfc32/cyrb128 (not crypto, but
irrelevant — predicting the stream doesn't help, you still must _play_ the
seed you predicted, which is T3); manipulating the engine itself (server runs
its own copy of `packages/core`).

---

## 2. Validation pipeline (anti-cheat core)

Order is strictly cheapest-rejection-first. Steps 1–6 are O(µs)–O(1 DB query);
the only CPU-bound work (7–8) runs after every cheap gate has passed.

```
POST /api/leaderboard/submit
  body: { token: string, claimed_score: number, display_name: string }

 1. Body shape + size guard (reject > 16 KB; token > 8192 chars)        → 400
 2. decodeRunToken(token) === null?                                     → 400 MALFORMED_TOKEN
    (apps/web/lib/game/run-token.ts:221 — never throws, returns null)
 3. versionsAgree(decoded, serverVersions)?                             → 409 WRONG_SEASON
    (run-token.ts:243 — strict 6-anchor conjunction; serverVersions
    composed exactly like the client does it, data.ts:122-131, from the
    same @wcdraft/data manifest the route handler imports)
 4. Identity gate (§5.3): session cookie + CSRF double-submit + Origin  → 401/403
    (reuse handler-helpers verifySession/CSRF path used by POST /api/runs)
 5. Display-name validation (§5.1)                                      → 422 INVALID_NAME
 6. Rate-limit buckets: per-session and per-IP sliding windows          → 429 RATE_LIMITED
    (auth_rate_limits upsert, lib/auth/rate-limit.ts:40-65 — 1 query each)
    [ranked mode only: load ranked_attempts row; reject if
     issued_parent_seed !== decoded.ps, expired, or consumed]           → 403 BAD_ATTEMPT
 7. DRAFT LEGALITY = full replay: reconstructDraftFromToken(decoded,    → 422 ILLEGAL_PICK
    serverGameData) (run-token.ts:262). This re-derives every spin's
    offered candidates from decoded.ps via deriveSubseed(ps,"draft")
    (rng.ts:214) and throws RunTokenError at the first pick not present
    in that spin's rolled_card_ids (draft.ts:890). ~6 ms p50.
    THIS IS THE CAN'T-SPOOF KEYSTONE — confirmed: core exposes
    everything needed (createDraft/pickPlayer/pickManager are public
    exports; run-token.ts itself is the reusable replay implementation).
 8. Deterministic re-sim: buildRunScenario({parent_seed: decoded.ps,    → 500 (bug, alert)
    teams, bracket, ruleset_version}) + runTournamentFull(draft,
    scenario, decoded.ps, world) — exactly the e2e-golden pipeline
    (packages/data/test/e2e-real-run.golden.test.ts:120-160). ~1 ms.
 9. result.run.score === claimed_score?                                 → 422 SCORE_MISMATCH
10. INSERT leaderboard_entries {season_key (§3), mode, draft_mode,
    user_id, session_id, display_name, token, verified_score,
    score_breakdown} ON CONFLICT (dedupe constraint) DO NOTHING
    → row inserted: 201 {entry}, conflict: 200 {duplicate: true}
```

Notes:

- **Bounded CPU/time:** worst measured total 17.3 ms; the route sets
  `export const maxDuration = 10` (seconds) as a hard backstop — a 500×
  safety margin, present only so a pathological regression can't burn
  function-hours. Runtime stays the Node default (core needs Node, §0).
- **No queue / no pending state:** verification is synchronous within the
  request. Honest-state benefit: the UI never shows an unverified score.
- The server constructs `serverGameData` (catalog + SimWorld + versions) once
  per process from `@wcdraft/data` static imports — same warmup measured at
  ~150 ms (§0.1). `run-token.ts` currently lives in `apps/web/lib/game/` and
  is directly importable by the route handler; no extraction needed for v1.
- Step 8 cannot legitimately fail after step 7 succeeded (scenario/world are
  server-owned); any throw there is a contract bug → 500 + log, never persist.

---

## 3. Season semantics

**Rule: a season is the equivalence class of the full 6-anchor tuple** — the
exact `versionsAgree` conjunction (`run-token.ts:243-252`). Rationale: step 3
of the pipeline already rejects any token whose six anchors differ from the
server's current bundle, so "accepted into season S" and "all six anchors
equal S's tuple" are the same statement. Choosing a looser partition (e.g.
engine+rating only) would create seasons that mix mutually-incomparable
scores whenever dataset/ruleset/bundle-hash moved alone — fabricated
comparability, which violates honest-state. F-1 anticipated anchor-derived
season keys (`packages/db/src/schema/leaderboard-entries.ts:6-8`).

**Key format** (human-readable prefix + collision-proof suffix; pure function
of the manifest, zero code per season roll):

```
season_key = `${engine_version}_${rating_version}_${dataset_version}_${ruleset_version}_${sha256(all-6-joined).slice(0,8)}`
e.g. "engine-2026.06.09_wc-perf-4.2.1+proj-career-3.0.0_2026-06-04_ruleset-2026.06.04_a1b2c3d4"
```

- **Did 4.2.0→4.2.1 start a new season?** Yes. PR #64 changed
  `rating_version_historical` (and therefore `data_bundle_hash`) — two anchors
  moved, the tuple changed, new season. This is correct: 4.2.1 changed
  Maier-1966-class `overall_basis` outcomes, so a 4.2.0 score cannot be
  re-verified under 4.2.1.
- **Freeze at a bump is automatic:** after a deploy with new anchors, old-
  bundle clients fail step 3 with `WRONG_SEASON` (UI maps this to the existing
  skew-notice pattern — same honest-state language as
  `apps/web/components/game/results-screen.tsx:128-136` — prompting refresh).
  Old season rows keep their `season_key` and become read-only by construction:
  nothing can ever insert into a tuple the server no longer runs.
- **No seasons table for v1.** The board page derives the season list from
  `SELECT DISTINCT season_key` (+ a small static label map shipped with the
  web app if we want friendlier names). A `seasons` metadata table is deferred
  until we want curated names/dates (open question Q5).
- Deploy-window race (client refreshed mid-rollout): harmless — whichever
  bundle the serving function holds defines its season; both sides of a
  rollout are internally consistent.

---

## 4. Ranking design

Scoring options considered:

| Option                                                              | Pros                                                                                                                                                                                    | Cons                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Grind interaction                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **A. Engine `run.score` (existing integer, transparent breakdown)** | Already deterministic, golden-locked (`sim.golden.test.ts` asserts `score === Σ breakdown points`); zero new scoring code = zero new fabrication surface; breakdown renders as evidence | One-dimensional                                                                                                                                                                                                                                                                                                                                                                                                                                            | Grinding maximizes it, bounded by caps |
| B. W-D-L record (derivable from `matches`/`round_results`)          | Familiar                                                                                                                                                                                | Coarse (many ties); needs new derived columns                                                                                                                                                                                                                                                                                                                                                                                                              | Same as A                              |
| C. Goal differential                                                | Simple tiebreak                                                                                                                                                                         | Pathological alone (run up GD vs weak draws)                                                                                                                                                                                                                                                                                                                                                                                                               | Encourages GD-grinding                 |
| D. Perfect-run tier (8-0 flag above score)                          | Celebrates perfection                                                                                                                                                                   | Tier cliff; perfect runs become the only grind target                                                                                                                                                                                                                                                                                                                                                                                                      | Concentrates grinding                  |
| E. Squad-strength handicap (reward wins with weaker squads)         | Counters god-squad grinding directly                                                                                                                                                    | Needs a server-side squad-strength metric — and the repo just _decoupled_ display strength from sim internals (PR #62 managerModifier identity guards; best-XI internal-score decoupling in MV2-10); reintroducing a strength scalar into a ranking formula re-arms that coupling. Also opens a new grind axis: weak-rated-but-winning squads, where sim variance dominates → arguably _more_ grindable, and the formula itself becomes a fairness dispute | Shifts, doesn't reduce, grinding       |
| F. Submission caps (orthogonal)                                     | Bounds grind payoff regardless of metric                                                                                                                                                | Not a metric                                                                                                                                                                                                                                                                                                                                                                                                                                               | The actual grind mitigation            |

**Recommendation for v1: A + F.**

- Rank by `verified_score DESC`, tiebreak `created_at ASC` (first to reach it),
  then `id` for total order.
- Board displays **best entry per identity** (identity = `user_id` if claimed,
  else `session_id`); all accepted entries are retained as rows (audit +
  re-rank freedom later).
- Caps: 20 accepted submissions per identity per day (casual), enforced via
  the same `auth_rate_limits` bucket mechanism.
- Seed-grinding statement: with caps + best-per-identity, a grinder's edge
  over an honest player is bounded by (cap × days-in-season) attempts —
  visible-leaderboard inflation grows logarithmically with attempts for a
  max-statistic, and the ranked board (server-issued seeds, single-use,
  short window) is immune by construction. We accept a grindable casual
  board as "arcade" and position ranked as the competitive surface.
- D (perfect-run badge) ships as **display-only flair** (derivable from
  `score_breakdown`/aggregate at render time), not a ranking input.

---

## 5. Identity + abuse

### 5.1 Display names

- Rules (server-enforced at step 5): trim → NFC-normalize → length 3–24 →
  allowlist `[\p{L}\p{N} _.\-]` (no URLs, no control/zero-width chars, no
  leading/trailing separators) → case-folded blocklist check (small curated
  list in repo, slurs + impersonation terms like "admin", "wcdraft") →
  reject with `INVALID_NAME` + reason category (no echo of the bad value into
  logs beyond a hash). No uniqueness requirement (Q3): entries are
  identity-keyed, not name-keyed; the UI shows name + masked identity suffix.
- There is no existing name/profanity code in the repo (verified by search) —
  this is new, small, and pure (unit-testable).

### 5.2 Rate limits (Vercel/Neon free-tier reality)

Reuse `auth_rate_limits` (DB sliding-window upsert, one query per check,
hashed keys — `apps/web/lib/auth/rate-limit.ts:40-65,48`):

- submit: 6/hour + 20/day per session; 30/hour per IP (hashed
  `x-forwarded-for` first hop, same hashing as magic-link).
- board reads: no per-user limit; instead `Cache-Control: s-maxage=30,
stale-while-revalidate=120` on the GET (Vercel CDN absorbs reads; Neon sees
  ≤ 2 queries/30 s/region per board view variant).
- Budget check: Neon free tier (~190 compute-hours/mo) — at the cap-bounded
  worst case (every request 4 cheap queries + 1 insert) this is orders of
  magnitude inside budget; the binding constraint is actually _connection_
  spikes, already handled by the pooled `DATABASE_URL` client
  (`packages/db/src/client.ts:8-16`).
- `sweepOldRateLimits` exists but is never scheduled (`rate-limit.ts:72-85`);
  F-4 should piggyback a lazy sweep (probabilistic, 1-in-N submits) rather
  than add cron.

### 5.3 The swappable identity gate

One function, one config flag — the only place auth posture lives:

```ts
// apps/web/lib/leaderboard/identity-gate.ts (new)
// Resolves the submitting identity. AUTH POSTURE LIVES HERE AND ONLY HERE.
requireSubmitIdentity(req) →
  { sessionId, userId | null }   // anonymous-first (launch default)
  — validates wcdraft_sid + CSRF exactly like POST /api/runs does today
  — if LEADERBOARD_REQUIRE_ACCOUNT=1: additionally reject userId === null
    with 401 AUTH_REQUIRED (and the UI affordance switches to a sign-in
    prompt driven by the existing /api/auth/config pattern,
    apps/web/app/api/auth/config/route.ts:10-18)
```

Flipping `LEADERBOARD_REQUIRE_ACCOUNT` changes no schema, no pipeline step,
no UI component contract — only this gate's verdict and the affordance copy.

### 5.4 Claim path (anon → account)

Mirror `claimAnonRuns` (`apps/web/lib/game/saved-runs-store.ts:273-305`)
with a `claimLeaderboardEntries(sessionId, userId)`:

1. Drop anon rows whose `(season_key, mode, token)` already exists among the
   user's rows (dedupe constraint would block the transfer — same
   drop-conflicts-then-transfer shape as saved_runs).
2. `UPDATE ... SET user_id = $userId, session_id = NULL WHERE session_id =
   $sessionId AND user_id IS NULL`.
   Hooked into the same two call sites: the verify-POST
   `onAuthenticatedSessionReady` hook (`app/api/auth/verify/route.ts:103-109`)
   and the explicit `/api/runs/claim` retry route (extended or sibling route).
   Idempotent, like the existing claim.

### 5.5 Moderation / removal

- `hidden_at timestamptz` (nullable) on `leaderboard_entries`; board queries
  filter `hidden_at IS NULL`. Hiding is reversible and preserves the row
  (auditability). Hard delete only for legal demands.
- v1 moderation interface = SQL through Neon console (single-operator
  project); a guarded admin route is deferred. Display-name re-validation on
  read is NOT done (names are validated at write; blocklist updates apply to
  new rows — retroactive sweeps are a manual script).

---

## 6. API + UI surfaces

### Routes (all Node runtime, same error-envelope/jsonError conventions as

`apps/web/lib/auth/handler-helpers.ts`)

| Route                     | Method | Auth                                | Notes                                                                                                                                            |
| ------------------------- | ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/leaderboard/submit` | POST   | gate §5.3 + CSRF                    | pipeline §2; `maxDuration = 10`                                                                                                                  |
| `/api/leaderboard`        | GET    | none                                | params: `season` (default current), `mode`, `draft_mode`, `cursor` (keyset on `(verified_score, created_at, id)`), `limit ≤ 50`; CDN-cached 30 s |
| `/api/leaderboard/me`     | GET    | session                             | caller's best + recent entries for the season; uncached                                                                                          |
| `/api/ranked/attempt`     | POST   | gate (account once ranked launches) | **dark** in v1 — issues `ranked_attempts` row (server-minted seed per F-1 intent, `ranked-attempts.ts:1-9`)                                      |

### UI

- **Submit affordance (results screen, post-sim only):** appears only when
  (a) the run is complete and simulated locally, (b) the client's own
  `versionsAgree` passes against its loaded bundle, (c) not already submitted
  (local memory of submitted tokens). One name field (prefilled from last
  use, localStorage) + submit. States: idle → submitting → `accepted (rank
#N)` / `duplicate` / `wrong-season (skew notice + refresh prompt)` /
  `rejected (reason)` / `rate-limited (retry-after)`. Every state string maps
  1:1 to a server response — no invented intermediate states.
- **Board page `/leaderboard`:** season selector (current first; past seasons
  labeled read-only), mode tab (casual now; ranked tab present but disabled-
  dark), classic/hidden filter, keyset pagination ("load more"), each row =
  rank, display name, verified_score, score-breakdown popover (evidence),
  relative time. My-entry highlight via `/api/leaderboard/me` when a session
  exists.
- **Honest-state rules per field:** rank/score/breakdown render only DB rows
  (server-verified); no optimistic insertion of the user's entry before the
  201; "your rank" computed server-side in the same query snapshot as the
  page, never client-merged; if `season != current`, the submit affordance is
  absent (not disabled-with-tooltip — absent); empty board renders "no
  verified entries yet", never placeholder rows.
- **Dark vs live at launch:** live = casual board + anonymous submit + claim
  bridge. Dark = ranked attempt issuance/lane (schema + enum already exist;
  UI tab disabled; route returns 503 behind flag, same ship-dark pattern as
  `isAuthEnabled`).

---

## 7. Schema reconciliation (as-built F-1 vs needs)

As-built (verified):

- `ranked_attempts(id uuid PK, user_id uuid FK→users CASCADE, session_id text
FK→sessions CASCADE, issued_parent_seed text NOT NULL, nonce text NOT NULL,
issued_at tz NOT NULL default now, window_expires_at tz NOT NULL,
consumed_at tz NULL)` + 2 indexes (`ranked-attempts.ts:14-38`). **Fully
  sufficient for the ranked lane — no changes.**
- `leaderboard_entries(id uuid PK, season_key text NOT NULL, mode text NOT
NULL CHECK in ('casual','ranked'), user_id uuid FK→users CASCADE NULL,
token text NOT NULL, verified_score integer NOT NULL, score_breakdown
jsonb NULL, attempt_id uuid FK→ranked_attempts SET NULL, created_at tz NOT
NULL default now)` + top-N index `(season_key, mode, verified_score)` +
  UNIQUE `(season_key, mode, user_id, token)` NULLS NOT DISTINCT
  (`leaderboard-entries.ts:40-71`).

Genuine gaps → **one migration `0004_f4_leaderboard.sql` + hand-paired
`0004_f4_leaderboard.down.sql`** (repo convention, §0):

| Change                                                                                                                                  | Why                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADD `display_name text NOT NULL` + `CHECK (char_length(display_name) BETWEEN 3 AND 24)`                                                 | anonymous-first identity on the board; table is empty so NOT NULL needs no backfill                                                                                                                  |
| ADD `session_id text NULL REFERENCES sessions(id) ON DELETE SET NULL`                                                                   | anon ownership for my-entry + claim. **SET NULL, not CASCADE** (saved_runs cascades; board entries are public artifacts that must survive session expiry/sweep — the entry just becomes unclaimable) |
| ADD `draft_mode text NOT NULL CHECK (draft_mode IN ('classic','hidden'))`                                                               | token `md` is a fairness dimension (hidden drafting is blind — `apps/web/lib/game/run-token.ts:71`); stored at write so board filtering never re-parses tokens                                       |
| ADD `hidden_at timestamptz NULL`                                                                                                        | moderation §5.5                                                                                                                                                                                      |
| ADD partial index `ON leaderboard_entries (session_id) WHERE session_id IS NOT NULL`                                                    | claim UPDATE + my-entry lookup                                                                                                                                                                       |
| REPLACE `leaderboard_entries_top_idx` with `(season_key, mode, verified_score DESC, created_at ASC, id)` filtered or not on `hidden_at` | matches the exact board sort + keyset cursor; the existing ASC index serves DESC scans but not the composite tiebreak                                                                                |

Notes: the dedupe constraint stays as-is — `session_id` is deliberately NOT
in it (NULLS NOT DISTINCT global dedupe per F-1 rationale,
`leaderboard-entries.ts:17-24`, is the anti-spam we want). No new tables.
Rollback story: the paired down-migration drops the two indexes, the three
columns, and the check constraints, restoring the 0003 snapshot shape;
validated automatically by the existing ephemeral-Neon-branch CI job
(`.github/workflows/ci.yml:150-247` — path filter will trigger on
`packages/db/**`). The rollback-check script's table-empty assertions
(`rollback-check.ts` steps) should gain a leaderboard column-shape probe in
the same PR.

---

## 8. Test plan

**Negative tests, one per threat** (route-level, against a test DB per
`apps/web/lib/auth/__tests__/_test-db.ts` which already truncates these
tables):

1. T1 tampered pick: take a valid fixture token, swap one `pl[i].c` for a
   legend card not offered → 422 `ILLEGAL_PICK`; assert the error originates
   as `RunTokenError` from spin _i_ (message contract,
   `run-token.ts:288-294`).
2. T2 score tamper: valid token + `claimed_score+1` → 422 `SCORE_MISMATCH`,
   no row.
3. Wrong season: flip each of the six anchors individually (six cases) → 409
   `WRONG_SEASON` for every one (locks the conjunction; mirrors the Gate-2
   token-fuzz style, 13/13).
4. T4 duplicate: same token twice, same session → 201 then 200
   `{duplicate:true}`; same token from a _different_ anon session → blocked
   by NULLS NOT DISTINCT (200-duplicate, no second row).
5. Malformed: truncated base64, 18 picks, `v:2`, > 8192 chars → all 400 (these
   piggyback on existing `decodeRunToken` null-paths,
   `__tests__/run-token.test.ts`).
6. T5 names: too short/long, URL, zero-width, blocklisted, valid-unicode-ok →
   422/201 matrix.
7. T6: 7th submit in the hour → 429 with retry-after; bucket keys are hashed.
8. **Gate tests:** `LEADERBOARD_REQUIRE_ACCOUNT` unset → anon 201; set → anon
   401 `AUTH_REQUIRED`, account-bound session 201. Both run in the same suite
   (env injected per-test) to prove the flip is config-only.
9. Claim: anon submits → magic-link verify → entry's `user_id` set,
   `session_id` NULL; conflicting duplicate dropped (mirrors
   `saved-runs-store` claim tests).

**Golden fixture for the pipeline:** reuse the e2e-real-run seed
(`PARENT_SEED = "wcdraft:e2e-real-run:engine-v2-e3a:29"`,
`packages/data/test/e2e-real-run.golden.test.ts:56`): commit the encoded
token + expected `verified_score` + `score_breakdown` as a JSON fixture; the
validation-core golden test asserts byte-equal breakdown and score through
the _server_ pipeline. This rides the existing regen discipline (when anchors
bump, this fixture regenerates alongside the e2e golden — same PR, inspected
diff). New `test:golden:*` script must be registered in root `turbo.json`
tasks (CI gotcha, learned in WS-C).

**Determinism cross-check:** one test runs the pipeline twice in one process
and asserts identical insert payloads (no ambient state).

**Cost/load:** the bench from §0.1 is committed as a planning artifact (not
CI): re-run manually on anchor bumps. CI does not time-assert (machines vary);
instead a unit test asserts the pipeline performs **zero** network/db calls
before step 6's limiter (ordering lock via injected spies).

---

## 9. Build decomposition (ordered, risk-tiered)

| Unit                                                                                                                                                                              | Scope   | Risk                                                                 | Depends on                                                                   | Lane                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- |
| **U1** `0004` migration + down + rollback-check probe (§7)                                                                                                                        | schema  | **M** (only unit touching prod schema; ephemeral-branch CI gates it) | —                                                                            | A                    |
| **U2** validation core: `lib/leaderboard/validate.ts` (steps 1–3, 7–9 as a pure function over injected GameData), season_key derivation, name rules; golden + negative unit tests | pure TS | **L**                                                                | — (uses existing run-token/core exports)                                     | B (parallel with U1) |
| **U3** identity gate + submit route + read routes (wires U2 between gate and Drizzle insert; rate-limit buckets)                                                                  | API     | **M** (auth/CSRF surface)                                            | U1, U2                                                                       | A after U1           |
| **U4** UI: results-screen affordance + `/leaderboard` page + my-entry                                                                                                             | UI      | **L** (display-only; honest-state review checklist)                  | U3 contract (can build against mocked route from U3's typed response schema) | B                    |
| **U5** abuse hardening: caps tuning, lazy rate-limit sweep, `hidden_at` filter, blocklist file                                                                                    | API/ops | **L**                                                                | U3                                                                           | B after U3           |
| **U6** claim bridge: `claimLeaderboardEntries` + verify-hook + retry route extension + tests                                                                                      | API     | **M** (touches auth verify flow)                                     | U1, U3                                                                       | A                    |
| **U7** ranked lane (attempt issuance/consume, dark UI tab)                                                                                                                        | API/UI  | **M**                                                                | U1–U3 (+ product decision Q2)                                                | later, dark          |

Merge order: U1 → U2 → U3 → {U4, U5, U6 in parallel} → U7. U1 and U2 can be
authored simultaneously in separate PRs (no file overlap). Each unit lands
green on `main` behind the feature surface (board page unlinked until U4+U5
pass live-dark sanity), matching the repo's ship-dark conventions.

---

## 10. Open questions for the Lead Architect

1. **Casual `mode` naming:** F-1's CHECK is `('casual','ranked')`. Confirm
   the anonymous-first launch board is `mode='casual'` and `'ranked'` stays
   reserved for the server-issued-seed lane (this plan assumes yes).
2. **Ranked identity:** F-1 comments say ranked "requires a bound user"
   (`leaderboard-entries.ts:12-13`). Keep that, or allow ranked-anon once the
   gate exists? (Plan assumes ranked = account-required, which the §5.3 gate
   makes a one-line posture.)
3. **Display-name uniqueness/impersonation:** v1 proposes non-unique names
   with no reservation. Acceptable, or reserve claimed-account names?
4. **Cap values:** 6/h + 20/day per identity, 30/h per IP — gut-check these
   against expected launch traffic; they're config constants either way.
5. **Season labels:** derive-only (proposed) vs a `seasons` metadata table
   with curated display names/dates. Derive-only means season selector shows
   raw anchor-ish strings until we add a label map.
6. **Retention:** keep all non-best entries forever (audit posture, proposed)
   or sweep non-best rows of dead seasons after N months (Neon storage is
   the only pressure; currently negligible).
7. **`schema_version` in the partition:** included via the full-conjunction
   rule. If a future `runtime-data-x` bump is provably outcome-neutral, do we
   accept that it still rolls a season (proposed: yes — simplicity and
   honesty over continuity), or carve an exception then?

---

## Appendix: bench method

Built `@wcdraft/core` + `@wcdraft/data` at `877f7bf`; Node v22.22.3; script
constructs the catalog/SimWorld exactly as
`packages/data/test/e2e-real-run.golden.test.ts:64-118` does, synthesizes 30
submissions via `autoDraft` over distinct seeds, then times
`createDraft`+replay / `buildRunScenario` / `runTournamentFull` per
submission and cross-checks the replayed `DraftState` byte-equal to the
origin. Numbers in §0.1.
