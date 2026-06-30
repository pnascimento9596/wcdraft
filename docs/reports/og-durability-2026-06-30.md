# OG durability - signed run cards

Date: 2026-06-30
Branch: `ws-fix/og-durability-20260630`
Base: `origin/main` at `3e1bdc5daa0be84ff38dee09322b93ee52a8dadc`

## Scope

This lane keeps validly signed per-run OG cards alive across deploys and runtime-data or rating-version rotations. It is bounded to `apps/web` OG signing/rendering, metadata URL construction, a small OG health endpoint, and tests.

## Policy

Signed OG images are now historical artifacts. If `/api/og/run` receives a signed payload whose HMAC verifies with the stable OG secret and whose `token_hash` matches the supplied `run` token, the route renders the signed `RunOgModel` snapshot even when the payload's version anchors differ from the current manifest. The route still falls back to `og-default.png` for malformed input, missing/invalid signatures, bad HMACs, token-hash mismatches, and tampered signed payloads.

Replay remains stricter than OG rendering. The share/replay UI still rejects version-skewed run tokens instead of simulating them against current data; only the already signed image route treats the embedded model as durable historical output.

## Changes

- Removed current-manifest/version equality from `/api/og/run`; the edge render route no longer loads runtime-data or replays/simulates a run.
- Changed OG cache keys from deploy/data-bundle hashes to `ogs<signed_payload_version>.<token_hash_prefix>`, so a signed card URL is stable across deploys and data rotations.
- Kept `WCDRAFT_OG_SIGNING_SECRET` as the single server-only HMAC secret and added a scrubbed presence assertion plus `/api/og/health`.
- Extended tests for version-moved signed snapshots, missing-secret health, illegal-pick 422, tampered model rejection, bad-HMAC rejection, token-hash mismatch rejection, and the public API inventory/privacy sweep.

## Local validation

- `pnpm --filter @wcdraft/core build && pnpm --filter @wcdraft/data build && pnpm --filter @wcdraft/db build` - passed.
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-og.test.ts` - passed, 28 tests.
- `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/public-payload-email-sweep.test.ts` - passed, 1 test.
- `pnpm --filter @wcdraft/web typecheck` - passed.
- `pnpm --filter @wcdraft/web lint` - passed.
- `pnpm typecheck` - passed, 8/8 Turbo tasks.
- `pnpm lint` - passed, 5/5 Turbo tasks.
- `pnpm test` - passed, 8/8 Turbo tasks; web Vitest 74 files passed / 1 skipped, 809 tests passed / 1 skipped; `game-flow-playwright` OK.
- `pnpm build` - passed, 4/4 Turbo tasks. Next emitted existing webpack circular-chunk warnings.
- `git diff --check` - passed.

## Reviewer / ship status

Fresh-context review passed from separate clone `/private/tmp/wcdraft-og-review-195-YvebK8/wcdraft` on PR #195. The reviewer used `gh pr checkout 195`, read the PR file list/diff, and re-executed:

- `pnpm --filter @wcdraft/core build && pnpm --filter @wcdraft/data build && pnpm --filter @wcdraft/db build` - passed.
- `pnpm --filter @wcdraft/web pretest` - passed.
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-og.test.ts` - passed, 28 tests.
- `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/public-payload-email-sweep.test.ts` - passed, 1 test.
- `pnpm --filter @wcdraft/web typecheck` - passed.
- `git diff --check origin/main...HEAD` - passed.

PR #195 merged as `a65fa933dfbc1125c0f25dc9cf6c1b2af137e7a6`, but the first production Vercel deployment failed before READY because Lane B's leaderboard lineup inspector still called the old one-argument `buildRunOgCacheKey`.

Recovery PR #198 merged as `a18e492027f9c4d3b96e505c8e797ca0c2a4fcfe`. It decoupled lineup-inspector cache keys from OG image cache keys. Recovery gates passed before merge:

- `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/lineup-inspector.test.ts lib/game/__tests__/run-og.test.ts` - passed, 37 tests.
- `pnpm --filter @wcdraft/web typecheck` - passed.
- `pnpm exec turbo run build --filter=@wcdraft/web...` - passed, 4/4 tasks.
- PR #198 CI run `28470048653` - passed.
- Vercel preview for PR #198 - passed.

Production deployment `dpl_GHKXRgCL25xEd2nPPhpHq7EVjUSd` reached READY for `a18e492027f9c4d3b96e505c8e797ca0c2a4fcfe` and aliased `www.wcdraft.com`.

## Production readback

Live probes against `https://www.wcdraft.com` after `dpl_GHKXRgCL25xEd2nPPhpHq7EVjUSd` reached READY:

- `/api/og/health` returned 200 with `{ "ok": true }` and `Cache-Control: no-store`.
- The pre-deploy signed card captured from production before the deploy returned 200 `image/png`, `Cache-Control: public, max-age=31536000, immutable`, no redirect, 70,612 bytes, SHA-256 `59b743564aed1909a64c6544542790b355bd9d027231c3c6b2e884e6f90a0bd9`.
- The signed card did not match `/brand/marketing/og-default.png` (default image SHA-256 `d259977d627f01c2930e10dfdc4e628e5e1ed3b8fa97d7fd7b9007eca3444db7`).
- Tampered `og` signature returned 307 to `/brand/marketing/og-default.png` with `Cache-Control: public, max-age=300`.
- Missing `og` returned 307 to `/brand/marketing/og-default.png` with `Cache-Control: public, max-age=300`.
- `/api/og/sign` rejected malformed run input with 422 `{ "ok": false, "error": "MALFORMED" }`.
- `/api/og/sign` signed the pre-deploy run after deploy with cache key `ogs1.7fcba6ba9a81a10d186217bc66388f00` and signed payload SHA-256 `bb75ff25a8162545dfe1291bcdcd25eeb97d56671d892276c12eda32410e0199`.
- Vercel runtime errors for `/api/og/run`, `/api/og/sign`, and `/api/og/health` over the 30-minute window: none found.
