# F-4 leaderboard light-up — live verification report (2026-06-10Z)

**Outcome: LIVE.** The casual leaderboard is live on production (www.wcdraft.com) behind
`LEADERBOARD_ENABLED=1`. All live checks passed. Executed under Lead-Architect dispatch
(q-003 light-up checklist); ranked + accounts surfaces verified still dark.

- Serving deployment: `dpl_4NJa4gay4GY1mZUr7Nnje2Qbv5h4`
  (`wcdraft-b4q82bzow-…vercel.app`), git deploy of main `48d87c0` (#75), READY and
  aliased to www.wcdraft.com / wcdraft.com.
- Flag: `LEADERBOARD_ENABLED=1`, Production target, type **plain** (deliberately
  non-sensitive — see incident below). `LEADERBOARD_REQUIRE_ACCOUNT` stays unset
  (anonymous-first casual posture).

## Pre-conditions verified before the flip

- PR #72 (U5 rate limiter) MERGED on main as `bdcfe36` (2026-06-10T19:47:18Z); the
  then-current aliased prod deployment (`dpl_HJzFUCDX1dT4rcVWJTsSi8gkTeue`) was built
  from exactly that SHA.
- `LEADERBOARD_ENABLED` absent from `vercel env ls production` (only `DATABASE_URL`,
  `AUTH_COOKIE_SECRET`).
- Live-dark re-confirmed at flip time: `/api/leaderboard/board` → 404, `/leaderboard` → 404.
- Neon migrations 0000–0004: per STATE.md (verified 2026-06-10) + functionally re-proven
  by the live 201 insert below.

## Incident during the flip (resolved): flag never reached the build

Two independent traps made the naive flip (env-add → redeploy) a silent no-op — the
surface stayed dark across three deployment attempts:

1. **Sensitive-by-default env**: `vercel env add` stored the var as type `sensitive`
   (project policy). Sensitive vars are runtime-only — invisible to `next build` — and the
   leaderboard gating is partly build-time (static layout bakes `leaderboardEnabled` for
   nav; flag-off route handlers return 404 before touching the request, so Next prerenders
   them dark). Fix: re-created as type `plain` (it is a non-secret "1").
2. **Turbo strict env on Vercel**: the build runs `pnpm turbo run build` and Vercel runs
   turbo in strict env mode — project env vars not declared in `turbo.json` are STRIPPED
   from the build. Turbo warns about exactly this in the build logs. Fix: PR #75
   (`48d87c0`) declares `LEADERBOARD_ENABLED` + `LEADERBOARD_REQUIRE_ACCOUNT` in the root
   `build` task `env` (CI green → self-merge; same trap class as the registered
   `test:golden:*` invariant). Declared env also joins the turbo task hash, so future flag
   flips bust the build cache instead of replaying a stale prerender.

`DATABASE_URL` / `AUTH_COOKIE_SECRET` are unaffected: runtime-only reads, and Vercel
injects runtime env into functions independently of turbo. They stay sensitive and
undeclared on purpose.

**Carryover for q-004 (accounts activation):** the auth env family
(`RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_BASE_URL`) will hit the SAME two traps —
`authEnabled` is baked into the static layout the same way. Declare them in
`turbo.json` `build.env` and store as plain/non-sensitive (or at minimum verify build
visibility) when that lane lights up.

## Live verification (all on https://www.wcdraft.com, fresh browser session)

| # | Check | Result |
|---|-------|--------|
| 1 | `/leaderboard` renders, honest empty state | PASS — "No verified entries yet", season strip `engine-2026.06.09_wc-perf-4.2.1+proj-career-3.0.0_2026-06-04_ruleset-2026.06.04_ac3ca8c8` (matches STATE.md pins) |
| 2 | Nav shows Leaderboard entry | PASS — Play · History · **Leaderboard** · How to Play · Settings · Privacy |
| 3 | Real classic run → submit | PASS — full 17-spin draft played through the UI (4-3-3, XI 11/11, bench 5/5, manager 1/1), simulated (group exit, 3 matches), submitted as "Paulo" → **201**, `verified_score:-9` with full breakdown, `duplicate:false`, `rank:1`; board row `1 · Paulo · You · Classic · -9 pts`; entry `73ec6278-c38e-48ff-b645-c86c710caa62` |
| 4 | Resubmit same token | PASS — **200**, `duplicate:true`, same entry id, rank 1 ("already on the board" path) |
| 5 | Hidden (Memory) run → submit | PASS — masked draft confirmed live (cards show `—OVR—`), full 17-spin hidden run, post-sim reveal, submit → **201**, `draft_mode:"hidden"`, `verified_score:10`, rank 1; board shows **Memory** badge; entry `4e0b4a55-8ef0-45d1-a3f5-f6e03aced519` |
| 6 | `/me` highlight for anon session | PASS — `/api/leaderboard/me` → 200 with `best` (hidden, 10) + `rank:1` + `recent` (both entries); board shows **You** chip + "Your best this season: 10 pts · rank #1" banner |
| 7 | Best-entry-per-identity + draft-mode filter | PASS — All shows the better hidden entry (10); Classic filter shows the classic entry (-9) |
| 8 | Pre-season token (honest different-build path) | PASS — fixture-derived token with `ev:"engine-2026.06.04"` → **409** `WRONG_SEASON`, `mismatched_anchors:["engine_version"]`; no entry created |
| 9 | Ranked surfaces dark | PASS — board tab "Ranked — soon" disabled-dark; `POST submit {mode:"ranked"}` → **403** `BAD_ATTEMPT` "ranked submissions are not open" |
| 10 | Accounts surfaces absent | PASS — no sign-in affordance (layout `authEnabled:false`); `/signin` 404; `/api/auth/signin` 404; `/api/auth/csrf` 200 (substrate up, accounts dark) |

Console across the whole session: **zero application errors**. Two non-app entries, both
assessed: (a) one browser-logged 401 on `/api/leaderboard/me` on the FIRST page view of a
cookie-less browser — this is the designed no-identity answer; `fetchMyPresence` treats
`!r.ok` as "no presence" and the UI renders the plain board (the browser logs any non-2xx
fetch on its own); (b) repeated Next.js CSS-preload warnings (pre-existing, cosmetic).

Rate limiter deliberately NOT probed to exhaustion on prod (per dispatch); 429/Retry-After
behavior is covered by the U5 suite (`submit-rate-limiter-db.test.ts`, real-postgres
atomicity probe) merged with #72.

## Rollback

Unset `LEADERBOARD_ENABLED` (vercel env rm) + redeploy. API routes go dark immediately at
request time (the 404 gate is request-time and the dark 404 is uncached), but note: the
nav link and `/leaderboard` page gating are baked at build time, so the REDEPLOY is what
darkens them — with #75 merged the env change correctly busts the build cache. No defect
observed; rollback not executed.

## Deployment timeline (for the audit trail)

- `dpl_HJzFUCDX…` — auto-deploy of #72 (`bdcfe36`), the pre-flip baseline (dark).
- `dpl_HWxte1AJ…` (vercel redeploy) and `dpl_9x57RcjN…`, `dpl_Bdts3DMX…` (fresh git
  deploys via API) — flip attempts that stayed dark; diagnosis chain: cache → runtime →
  **sensitive env (build-invisible)** → **turbo strict env stripping** (root causes 1+2
  above).
- `dpl_4NJa4gay4GY1mZUr7Nnje2Qbv5h4` — auto-deploy of #75 (`48d87c0`), LIVE, verified.
