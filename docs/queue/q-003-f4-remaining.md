# q-003 — F-4 leaderboard: remaining work

- **Tier:** Red (leaderboard/auth/schema surface) · **Mode:** DISPATCH-ONLY.
- **Status:** OPEN only for the old server-issued ranked-attempt model. Casual
  leaderboard, account light-up, and account-required ranked submissions are
  live surfaces; DC-8 now tracks per-config ranked/casual boards.
- Shipped: U1 (#67) · U2 (#69) · U3 (#70) · U6 claim bridge (#71, `b34a700`) ·
  U4 UI (#74, `6f76c10`) · U5 abuse hardening (#72) — all on main, routes dark
  behind `LEADERBOARD_ENABLED`.

## Not started / deferred

- **Server-issued ranked attempts** (`/api/ranked/attempt` issuance/consume) —
  deferred. The current ranked board uses the account-required submit gate and
  server replay; it does not mint server seeds.
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
ranked work made account-required ranked submissions a live surface; only the
server-issued ranked-attempt model remains deferred here.

## Done-when

The server-issued ranked-attempt model either ships behind a new explicit
dispatch or remains deferred. Casual/account/ranked board light-up is tracked in
`STATE.md` and DC-8.

## Evidence required

Per the plan: route-level tests with injected deps, gate-order locks, golden leaderboard
suite, live sanity transcript at flip time.
