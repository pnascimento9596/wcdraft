# q-003 — F-4 leaderboard: remaining work

- **Tier:** Red (leaderboard/auth/schema surface) · **Mode:** DISPATCH-ONLY.
- **Status:** OPEN — tracks the remainder of `docs/plans/f4-leaderboard-2026-06-10.md` §9.
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

## Light-up checklist (go-live, after U4+U5 land — HUMAN decision to flip)

1. Re-verify Neon prod migrations current (0000–0004 applied as of 2026-06-10).
2. Set `LEADERBOARD_ENABLED=1` in Vercel prod (env-add → needs a redeploy; watch the
   env-add/auto-deploy race documented in the prod-provisioning lane).
3. Live-dark sanity first: before the flag, routes must 404 bare; after, submit/board/me
   behave per U3 contract (anon submit OK while `LEADERBOARD_REQUIRE_ACCOUNT` unset).
4. Board page link-up is U4's last step (plan keeps the page unlinked until U4+U5 pass
   live-dark sanity).
5. STATE.md flag table updated in the same change.

## Done-when

U4/U5/U6 merged (their own Red reviews), U7 either shipped-dark or explicitly deferred by
plan amendment, light-up executed and verified live, STATE.md current.

## Evidence required

Per the plan: route-level tests with injected deps, gate-order locks, golden leaderboard
suite, live sanity transcript at flip time.
