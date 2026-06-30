# wcdraft — Agent Operating Contract

Monorepo: pnpm 11.5.1 + Turbo (Node ≥22) — `apps/web` (Next.js → Vercel), `packages/core`
(draft + sim engine), `packages/data` (compact runtime bundles), `packages/db` (Drizzle/Neon),
`etl/` (Python, intentionally NOT a pnpm workspace member). `STATE.md` + `docs/plans/*` are
repo truth — but verify any doc claim against code before relying on it.

## ⚠ Merge = ship

Merging to `main` auto-deploys to PRODUCTION (Vercel → www.wcdraft.com). There is no staging
gate. Treat every merge as a live ship; run live sanity after risky merges.

## Workflow

- One task = one fresh `/tmp` worktree off freshly-fetched main:
  `git fetch origin && git worktree add /tmp/<task> -b ws-<area>/<topic> origin/main`.
- Branch names: `ws-<area>/<topic>` (established areas: f4, merit, ux, core, fix, mem, meta).
- Conventional commits (`feat(web): …`, `fix(rating): …`, `docs(plans): …`).
- Stage with explicit paths: `git add <path>…` — NEVER `git add -A`/`-u`, never `git stash`.
- PRs squash-merge into `main`. Main moves while you work — rebase before merge.
- Update `STATE.md` in the SAME change that merges (counts, versions, flags you moved).

## Risk tiers

| Tier       | Scope                                                                                                                            | Gate                                                                                                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Green**  | docs, mechanical chores, no runtime change                                                                                       | CI green → self-merge                                                                                                                                                                                                                                                               |
| **Yellow** | bounded UI/impl, display-only, no schema/rating/sim semantics                                                                    | full validation + CI green → self-merge                                                                                                                                                                                                                                             |
| **Red**    | schema/migrations, ETL/rating, sim/engine, draft/synergy semantics, auth, leaderboard, deploy/env, anything user-facing-security | fresh-SESSION independent reviewer who RE-EXECUTES the gates (a sub-agent diff read does NOT qualify) → fix-forward to PASS → squash pinned via `gh pr merge --squash --match-head-commit <sha>` → deploy → live-verify on `www.wcdraft.com` → auto-revert on any failed live check |

Fix-forward → re-review loops on Red are normal, not a failure. Review PASS is
SHA-pinned: any commit pushed after review voids it — re-verify, re-pin. There
is no human approval gate at any tier. Safety comes from implementer≠reviewer
separation, machine-adjudicated gates, SHA-pinned merge, deploy observation, and
live-verify-with-auto-revert.

## Standing invariants

- Golden tests for ANY core-logic change (RNG, draft, sim, compact data, leaderboard
  validation). New `test:golden:*` scripts MUST be registered in root `turbo.json` `tasks`
  or CI never runs them.
- Every rating-version bump: regen the strategic-pick canary (`WCDRAFT_CANARY_REGEN=1` —
  the golden embeds `rating_version`) and prove pick equality (zero pick flips).
- λ re-fit (engine calibration) BEFORE re-locking realism bands; never re-lock bands to
  make a red gate pass.
- Licensing/terminology guardrails live in the project instructions: no
  fan-vote/proprietary-ratings ingestion; terminology is "Synergy" (not Chemistry),
  "manager" (not coach), "football" — no FIFA branding on shipped surfaces.
- ETL is deterministic: committed `etl/output/*` must be byte-stable after a clean rebuild;
  no LLMs and no fabrication in the intake path; absent signals stay null
  (honest-state null ≠ 0).

## Honesty

- Never fabricate test results, benchmark numbers, review verdicts, or merge/deploy status.
  Unknown stays flagged as unknown.
- Never stop silently: blocked = report the evidence (command, output, SHA) and what is
  needed to unblock.

## Queue discipline (`docs/queue/`)

- The queue is a backlog MIRROR seeded from verified open items — not an autonomous work
  source.
- Items marked **RED are dispatch-only**: the Lead Architect authors the task prompt; they
  are never self-served from the queue file.
- Only items explicitly marked `SELF-SERVE:GREEN` or `SELF-SERVE:YELLOW` may be worked from
  a one-liner ("work docs/queue/<item>.md").

## Validation (narrowest first)

1. `pnpm --filter <pkg> test` for the package you touched.
2. Root: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
3. Golden: `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`,
   `… test:golden:data test:golden:integration --filter=@wcdraft/data`,
   `… test:golden:leaderboard --filter=@wcdraft/web`.
4. ETL (if touched): `cd etl && ruff check src tests && pytest -q` (use a venv; CI also
   rebuilds and diffs `etl/output`).
5. Heavy realism (`WCDRAFT_REALISM_HEAVY=1`) runs in CI for CI-config changes,
   relevant `main` pushes, and the nightly heavy workflow. For engine/data changes,
   run it locally before merge unless that exact lane already re-ran the heavy gate.

## Final report format

Outcome first (shipped/blocked + SHA/PR), then: gates run with REAL counts · what changed ·
risks and carryovers flagged honestly · open questions. Review/gate reports go in
`docs/reports/`.
