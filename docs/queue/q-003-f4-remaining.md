# q-003 — F-4 leaderboard: remaining work

- **Tier:** Red (leaderboard/auth/schema surface) · **Mode:** DISPATCH-ONLY.
- **Status:** OPEN for U7 ranked only. Casual leaderboard, U1-U6, and account
  light-up are live; this file now tracks the ranked-lane remainder and keeps
  the light-up checklist as historical audit context.
- Shipped: U1 (#67) · U2 (#69) · U3 (#70) · U6 claim bridge (#71, `b34a700`) ·
  U4 UI (#74, `6f76c10`) · U5 abuse hardening (#72) — all on main, routes dark
  behind `LEADERBOARD_ENABLED`.

## Not started

- **U7 ranked lane** (attempt issuance/consume + dark UI tab) — dark by design; blocked on
  plan §10 product decision Q2 (ranked = account-required posture). `LEADERBOARD_REQUIRE_ACCOUNT`
  gate already exists in identity-gate.
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
casual submit/board/me are live, and accounts/email sign-in is live. Ranked
remains dark because `LEADERBOARD_REQUIRE_ACCOUNT` is intentionally unset.

## Done-when

U7 either ships dark behind the account-required attempt model or is explicitly
deferred by plan amendment. Casual/account light-up is already done and recorded
in `STATE.md`.

## Evidence required

Per the plan: route-level tests with injected deps, gate-order locks, golden leaderboard
suite, live sanity transcript at flip time.
