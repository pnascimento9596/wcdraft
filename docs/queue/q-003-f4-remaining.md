# q-003 — F-4 leaderboard: remaining work

- **Tier:** Red (leaderboard/auth/schema surface) · **Mode:** DISPATCH-ONLY.
- **Status:** OPEN only for residual constraint validation / pre-binding cleanup.
  Casual leaderboard, account light-up, account-required ranked submissions, and
  **server-issued ranked attempts** are live surfaces; DC-8 tracks per-config
  ranked/casual boards.
- Shipped: U1 (#67) · U2 (#69) · U3 (#70) · U6 claim bridge (#71, `b34a700`) ·
  U4 UI (#74, `6f76c10`) · U5 abuse hardening (#72) — all on main, routes dark
  behind `LEADERBOARD_ENABLED` at ship time, later lit.
- Shipped later: Season 1 B1+B2 ranked-attempt lifecycle
  (`/api/ranked/attempt` issuance/consume, structural binding migration 0012).
  Evidence: `docs/reports/audit-s1-b1-b2-ranked-attempt-lifecycle-2026-07-11.md`
  and `apps/web/app/api/ranked/attempt/route.ts`.

## Not started / residual

- **`VALIDATE CONSTRAINT` on ranked-attempt binding checks** — blocked by
  residual pre-binding rows. Evidence Track C (2026-07-23) counted **1** ranked
  `leaderboard_entries` row that fails the structural binding predicate
  (`attempt_id` NULL; id `4dc1df8e-530d-47c3-9364-5e6beea571a2`, created
  2026-06-21). Report:
  `docs/reports/evidence-track-c-2026-07-23/C4-q003-residual.md`.
  Zero residuals would unlock a controlled VALIDATE window; non-zero requires
  remediation first. Still DISPATCH-ONLY Red.
- ~~Server-issued ranked attempts (`/api/ranked/attempt` issuance/consume)~~
  **SHIPPED** in Season 1 B1+B2 — do not re-open as “deferred”.
- ~~Scrub env-var names and secret-generation hints from auth-route JSON error bodies~~
  DONE via q-008 micro-Yellow bundle 2 (`jsonError` scrubs `SECRET_MISCONFIGURED`
  detail to server logs; generic client body). Original item:
  env-var names and secret-generation hints in auth-route JSON error bodies
  (AuthError SECRET_MISCONFIGURED currently surfaces the var name via jsonError). Generic
  client body; detail to server logs only. One-liner, fold into the next F-4/auth lane.
  (Ledgered from PR #79 carryover via ws-ux/club-coverage — docs-only append.)

## Light-up checklist (historical — completed for casual/account light-up)

Completed before the 2026-06-12 measurement in `STATE.md`: prod migrations are
current through 0004, `LEADERBOARD_ENABLED` is set in Vercel Production,
casual submit/board/me are live, and accounts/email sign-in is live. Later
ranked work made account-required ranked submissions and server-issued ranked
attempts live surfaces.

## Done-when

Residual pre-binding ranked rows are remediated and binding constraints are
validated, **or** an explicit grandfather policy is dispatched. Casual/account/
ranked board light-up remains tracked in `STATE.md` and DC-8.

## Evidence required

Per the plan: route-level tests with injected deps, gate-order locks, golden leaderboard
suite, live sanity transcript at flip time. For VALIDATE: residual count zero (or
remediation proof) before `VALIDATE CONSTRAINT`.
