# q-003 — F-4 leaderboard: remaining work

- **Tier:** Red (leaderboard/auth/schema surface) · **Mode:** DISPATCH-ONLY.
- **Status:** OPEN (U7 only) — LIGHT-UP EXECUTED 2026-06-10Z under Lead-Architect dispatch;
  casual board LIVE on www.wcdraft.com. Tracks the remainder of
  `docs/plans/f4-leaderboard-2026-06-10.md` §9.
- Shipped: U1 (#67) · U2 (#69) · U3 (#70) · U6 claim bridge (#71, `b34a700`) ·
  U4 UI (#74, `6f76c10`) · U5 abuse hardening (#72, `bdcfe36`) · light-up enabler
  turbo build-env fix (#75, `48d87c0`) — all on main; surface LIVE behind
  `LEADERBOARD_ENABLED=1`.

## Not started

- **U7 ranked lane** (attempt issuance/consume + dark UI tab) — dark by design; blocked on
  plan §10 product decision Q2 (ranked = account-required posture). `LEADERBOARD_REQUIRE_ACCOUNT`
  gate already exists in identity-gate. Live posture verified at flip: submit `mode:"ranked"`
  → 403 BAD_ATTEMPT, board Ranked tab disabled-dark.

## Light-up checklist — EXECUTED 2026-06-10Z (report: `docs/reports/f4-lightup-verification-2026-06-10.md`)

1. ~~Re-verify Neon prod migrations current~~ ✔ 0000–0004 per STATE.md (2026-06-10) +
   functionally re-proven by the live 201 insert into `leaderboard_entries`.
2. ~~Set `LEADERBOARD_ENABLED=1` in Vercel prod~~ ✔ — set as PLAIN (non-sensitive) var;
   needed turbo.json `build.env` declaration (#75) because Vercel's strict turbo env strips
   undeclared vars from the build (gotcha documented in the report).
3. ~~Live-dark sanity before / U3 contract after~~ ✔ — 404 bare pre-flip re-confirmed at
   flip time; post-flip: 201 verified insert, 200 duplicate replay, 409 WRONG_SEASON
   (pre-season token), 403 ranked, /me 200 + You highlight, anon submit OK.
4. ~~Board page link-up~~ ✔ — nav shows Leaderboard (was already wired to the flag by U4;
   went live with the flip).
5. ~~STATE.md flag table updated in the same change~~ ✔ (this PR).

## Done-when

U4/U5/U6 merged (their own Red reviews) ✔ · light-up executed and verified live ✔ ·
STATE.md current ✔ · U7 either shipped-dark or explicitly deferred by plan amendment —
**only U7 remains**.

## Evidence required

Per the plan: route-level tests with injected deps, gate-order locks, golden leaderboard
suite ✔ (all merged with U2/U3/U5) · live sanity transcript at flip time ✔
(`docs/reports/f4-lightup-verification-2026-06-10.md`).
