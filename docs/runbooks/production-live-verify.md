# Production live-verify (non-writing)

Standing constraint for every post-deploy check on `www.wcdraft.com`.

## Standing constraint (in-repo)

**Production live-verify must never create leaderboard rows, ranked attempts, or
accounts.** Accepting-path coverage ("a valid run inserts a row") belongs
**pre-merge**, on disposable substrate:

| Path                   | Where                                                                                                                                                    | What it proves                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepting write        | Pre-merge CI / local — PGlite-backed `apps/web/lib/leaderboard/__tests__/submit-route.test.ts` (and any ephemeral Neon exercise of the same insert path) | A valid submission inserts a row, returns 201, rank is honest                                                                                                     |
| Production live-verify | Post-deploy against `www.wcdraft.com`                                                                                                                    | Health + anchors, public board **reads**, and a **deliberately rejected** submit that proves the route is live and gate ordering fires **without** creating a row |

This is load-bearing for the merge → deploy → live-verify → auto-revert safety
contract. Writing production board residue during verification (as PR #340 did
with alias `live_verify_xi`) pollutes the public board and forces irreversible
data cleanup.

> **OWNER RATIFICATION:** this constraint is committed in-repo (`STATE.md` + this
> runbook). Ratifying it into the canonical owner doc set is an owner decision
> and is not performed by build agents.

## Rejection probe (chosen)

**Probe:** cookie-less anonymous `POST /api/leaderboard/submit` with the
committed pre-basis skew fixture
`apps/web/lib/game/__tests__/fixtures/run-token-skew.json` →
`shipped_pre_basis_t3.token`.

**Expected:** HTTP **409** with wire code **`DIFFERENT_BUILD`** (cheap preflight
step 3 — `versionsAgree` fails on schema/engine/hash anchors before replay,
sim, or insert).

**Rationale (stable + cheapest):**

1. Fixture is committed and regenerated via `pnpm --filter @wcdraft/web gen:token-skew`.
2. Rejection is cheap-gate only — no re-sim, no rate-limit identity burn beyond
   anonymous.
3. Cookie-less anonymous path does **not** mint a durable session (identity gate
   returns `{sessionId:null,userId:null}` when no `wcdraft_sid` is present), so
   the probe creates neither accounts nor sessions.
4. `DIFFERENT_BUILD` is the same typed rejection PR #340 aligned across submit /
   OG / friend-challenge / lineup for version-anchor skew.

Do **not** substitute an accepting current-build token on production. Do **not**
pass `display_alias` / `display_name` that would be persisted on accept.

## How to run

From a clean checkout of the deployed SHA (or any SHA that still carries this
runbook + script):

```bash
set -euo pipefail
./scripts/live-verify-production.sh
# optional: BASE_URL=https://www.wcdraft.com ./scripts/live-verify-production.sh
```

The script:

1. `GET /api/health` — requires `ok == true`, `db.status == "ready"`, and records
   the 6 data anchors + active `leaderboard.season_key`.
2. Snapshots public board row counts / entry ids for featured Classic casual,
   Memory casual, Classic ranked on the current season, plus the archived
   `season-2026-manager-attrition` Classic casual board.
3. Posts the rejection probe (cookie-less, no alias).
4. Asserts HTTP 409 + `error == "DIFFERENT_BUILD"`.
5. Re-reads the same boards and asserts **identical** entry id sets (no new row,
   no missing row).
6. Fetches `/leaderboard` HTML and asserts archive "Season closed" copy remains
   present (read-only archive surface).

Exit non-zero on any failure. On failure after a code deploy, follow the Red
auto-revert path (git/Vercel). This script never mutates the database; if a
future change accidentally starts writing, stop and clean up under a separate
U2-style data lane with a Neon snapshot first
(`docs/runbooks/neon-restore-vercel-rollback.md`).

## What this does **not** cover

- Accepting insert, rank computation, claim, or ranked-attempt consumption —
  those stay in pre-merge tests.
- Neon restore / Vercel rollback mechanics — see
  `neon-restore-vercel-rollback.md`.
- Schema or migration failures — see `prod-migration-failure.md`.
