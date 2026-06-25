# Trusted Per-Run OG Share Images — Red Lane Report

Date: 2026-06-15  
Branch: `og-trusted`  
Base: `origin/main` `c805adaac770166d36188056dfd91fd049049049af2`

## Outcome

Candidate implementation is local-green after fresh-context review found an
Edge import-isolation blocker and the lane was fixed forward. The lane restores
per-run OpenGraph share images without trusting browser-minted result claims.
Merge SHA, deployment id, live checks, and revert status are recorded in the
final operator report after production verification.

## Architecture Decision

Chosen: **B — sign at share-time, verify cheap at render.**

Both candidate designs need the same trust primitive: re-derive the run from the
token with the existing deterministic engine, reject illegal pick logs, and use
the canonical server-computed result instead of the token's self-attested `og`
summary.

Option A would put re-derivation in `/api/og/run`. That route is Edge today and
the recent perf fix deliberately removed draft-pool/sim imports from the OG
path. Reintroducing validation data plus the tournament engine at render time
would put the cold-render path back near the full-data/sim boundary and make the
social crawler cost proportional to uncached unique image URLs.

Option B keeps the expensive proof on `POST /api/og/sign` in the Node runtime:

1. The completed share screen mints the normal self-contained replay token.
2. The browser posts `{ run }` to `POST /api/og/sign`.
3. The server loads validation data, decodes the token, checks current versions,
   reconstructs the draft from the seed/spins/picks, and runs the existing
   tournament engine once.
4. The server signs a canonical `RunOgModel` plus `sha256(run)` and current data
   versions with `WCDRAFT_OG_SIGNING_SECRET`.
5. `/play/share?run=...&og=...` emits dynamic metadata only when `og=` looks like
   a signed OG payload.
6. `/api/og/run` stays Edge, loads only the manifest/mark/fonts, verifies the
   HMAC, token hash, and versions, and renders the signed canonical model.

Firewall framing: this is verification-only server work for a shared artifact,
equivalent in category to leaderboard re-sim. It is not the interactive game
loop, not per-view sim work, and not a signing oracle because unsigned claims are
never signed without re-derivation.

## Runtime And Cost Measurement

- Signed sample from the real token fixture: `run` length `1,683`, signed OG
  length `3,284`, full share path length `4,987`.
- Local route proof in `run-og.test.ts`: two signed `/api/og/run` fetches for the
  same URL returned `200`, `Cache-Control: public, max-age=31536000, immutable`,
  byte-identical PNG bytes, under the asserted `500 KB` cap, and under the
  `3,000 ms` cold+warm test budget.
- Edge route source guard: `/api/og/run` does not import `getValidationData`,
  `loadDraftPoolBundle`, `buildGameData`, `buildSimWorldInputs`,
  `runTournamentFull`, or `runSimulation`.
- Sign endpoint responses are `Cache-Control: no-store`; generated image URLs
  are cache-keyed by deployment/build data plus manifest data hash and rendered
  images are immutable.
- `POST /api/og/sign` bounds repeated server work with an in-process
  token+secret cache for accepted signed payloads and a per-IP throttle for
  repeated uncached attempts before re-sim work.
- `POST /api/og/sign` reads request bodies through a byte-bounded stream reader,
  so headerless oversized malformed bodies return `413 BODY_TOO_LARGE` without
  first materializing an unbounded string.
- Untrusted display fields are normalized into the canonical render model before
  signing; a canonical model that still fails signed-payload validation returns
  `422 CANONICAL_MODEL_INVALID` instead of a 500.
- First fresh-context review failed because the Edge route source imported broad
  `game/data` and `run-token` modules. Fix-forward split lightweight
  `versions.ts` and `run-og-constants.ts`, removed token decoding from
  `/api/og/run`, and left signing/replay/sim work only in the Node signer path.
- Post-fix Edge artifact proof: `apps/web/.next/server/app/api/og/run/route.js`
  measured `425,566` bytes. Grep over the built route for
  `getValidationData|loadDraftPoolBundle|buildGameData|buildDraftCatalog|reconstructDraftFromToken|createDraft|pickPlayer|pickManager|buildSimWorldInputs|runTournamentFull|buildRunScenario|goal_points|CHAMPION_UNDEFEATED|RunTokenError|narrative|tournament|draft_pool|draft-pool`
  returned no matches. The route source map's app/game sources were only
  `run-og-constants.ts`, `run-og-image.tsx`, `run-og-signing.ts`, and
  `versions.ts`, plus `@wcdraft/data/client`.

New server-only environment variable:

- `WCDRAFT_OG_SIGNING_SECRET` — set in Vercel Production on 2026-06-15; value is
  not recorded.

## Surface Inventory

| Surface                | Change                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Share screen           | Builds the replay URL immediately, then asynchronously obtains a signed OG payload and appends `og=` when available. If signing fails, replay still works and social unfurls stay static.                                                                                                                                |
| `/play/share` metadata | Requires both `run=` and signed `og=` before selecting `/api/og/run`; unsigned, malformed, old-version, and foreign-build inputs use the default card.                                                                                                                                                                   |
| `POST /api/og/sign`    | New Node route. Byte-bounds JSON input while streaming, requires `WCDRAFT_OG_SIGNING_SECRET`, re-derives legal picks and true result with existing validation/sim code, normalizes display fields, caches accepted signatures in-process, rate-limits repeated uncached attempts, then signs the canonical render model. |
| `/api/og/run`          | Edge route loads only manifest/mark/fonts, verifies signed payload, exact token hash, and current versions, then renders the canonical model with immutable caching. Missing/invalid inputs redirect to the static default card.                                                                                         |
| `RunOgModel`           | Names come from `playerCardView(...)`, preserving surname disambiguation and honest-state behavior.                                                                                                                                                                                                                      |
| Config/env             | `.env.example` and `turbo.json` document/cache-key `WCDRAFT_OG_SIGNING_SECRET`.                                                                                                                                                                                                                                          |

## Forgery-Proof Evidence

- Illegal-pick mutation: duplicated a selected player card id in an otherwise
  current token. `verifyRunTokenForOg(...)` returned
  `{ status: "rejected", reason: "ILLEGAL_PICK" }`; no signed model was created.
- Tampered-result mutation: changed the token's syntactically valid `og` summary
  to an impossible-looking champion result. The server accepted the legal pick
  log but computed the true summary from the existing engine, built the model
  from that true summary, and signed deterministic identical payloads for the
  same canonical model.
- Display-field mutation: changed a valid token's team name to 161 characters.
  The signer returned `200` with a signed model whose team name was normalized
  inside the 80-character render bound before signing.
- Oversized-body mutation: sent a headerless JSON body with a 9,000-character
  `run` value. The signer returned `413 BODY_TOO_LARGE` from the bounded stream
  reader.
- Unsigned forged summaries still produce the static default metadata.

## Validation

- `pnpm exec prettier --check <changed parseable files>` — PASS.
- `env WCDRAFT_OG_SIGNING_SECRET=... pnpm --dir apps/web exec vitest run lib/game/__tests__/run-og.test.ts lib/leaderboard/__tests__/public-payload-email-sweep.test.ts` — PASS, 2 files / 18 tests.
- `env WCDRAFT_OG_SIGNING_SECRET=... pnpm exec turbo run typecheck lint test build --force` — PASS, Turbo 19/19 tasks successful, 0 cached:
  - `@wcdraft/core`: 366 passed
  - `@wcdraft/data`: 73 passed / 7 skipped
  - `@wcdraft/db`: 79 passed
  - `@wcdraft/marketing-x`: 64 passed
  - `@wcdraft/web`: 693 passed / 1 skipped
  - Build: existing Next/Webpack circular chunk warnings and the known Edge
    runtime static-generation warning only.
- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core` — PASS, 67 + 40 tests.
- `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data` — PASS, 31 + 22 tests.
- `env WCDRAFT_OG_SIGNING_SECRET=... pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web` — PASS, 6 tests.
- `pnpm --filter @wcdraft/data test:realism:heavy` — PASS, 7 tests.
- `pnpm check:generated` — PASS.
- `git diff --check` — PASS.
- Fresh-context independent review of `main...og-trusted` at `029b6f6` — PASS
  with no blockers. It surfaced two warnings that were fixed forward before
  publish: long attacker-controlled display text could throw during signing, and
  the signer needed a visible bound on repeated uncached expensive attempts.
- Fresh-context independent review of amended `4fcbbfe` — FAIL on Edge
  import isolation: the built route carried replay/sim/narrative markers through
  broad imports. Fix-forward removed those imports and added post-build evidence
  above; final fresh-context review is rerun after this fix-forward.

Full-repo `pnpm format:check` remains unusable for this lane because existing
archived/generated-adjacent files outside this diff have parser/formatting
issues; the parseable changed files were checked explicitly.

## Pending Production Phase

- Fresh-context independent review over `main...og-trusted`.
- CI green on the PR.
- Squash merge with `--match-head-commit`.
- Vercel production deployment READY.
- Live checks:
  - signed completed Classic run renders per-run XI and result, not the static
    default;
  - perfect 8-0 run renders per-run;
  - Memory run renders per-run;
  - forged-result token renders the true server-derived result or neutral
    fallback, never the forged claim;
  - malformed token uses static fallback without 500;
  - repeated image fetch is byte-identical with immutable cache;
  - new build cache key is deployment/data scoped.
