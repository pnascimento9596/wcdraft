# PWA launch hardening closeout

Date: 2026-06-28
Branch: `ws-ux/pwa-launch-hardening-20260628`
Original base before local work: `23056b3`
Rebased base before push: `eed5c4e`
Runtime data after rebase: `runtime-data-2.8.0`
Risk tier: YELLOW (`apps/web` UI/share/runtime hardening; no schema, ETL, rating, or sim semantic changes)

## Outcome

Local implementation and validation passed. Production verification is intentionally not recorded here because it must happen after this branch is squash-merged and deployed.

## What changed

- First-run seed collision guard: new locally generated run nonce is included in the parent seed while replay tokens still preserve byte-identical seed behavior.
- Share cold acquisition: recipient share pages get an acquisition CTA, narrative/caption/SVG/OG surfaces, tokenized replay URLs, and server-signed OG preview links.
- Signed-share safety: incoming `og=` values are no longer reused client-side; share URL/caption/card/native/social affordances stay unavailable while signing is pending and fail open to token-only sharing only after an explicit signing error.
- Narrative labeling: share and signed OG narratives are rebuilt with display labels, preventing raw internal placeholders such as `Unavailable` or `WC2026-*` on public surfaces.
- WCAG hardening: contrast tokens were adjusted and guarded with AA token tests.
- Compact draft layout: post-reveal mobile order puts candidates before the pitch/formation panel, and reveal focus moves to the candidate/search panel on compact screens.
- Loading and a11y polish: draft loading now renders a setup-shaped skeleton; draft transient states keep a page-level heading; scrollable share captions are keyboard-focusable.

## Validation

- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/pwa-launch-source.test.ts`
  - PASS: 1 file, 3 tests.
- `pnpm --filter @wcdraft/web exec tsc --noEmit`
  - PASS.
- `pnpm --filter @wcdraft/web lint`
  - PASS.
- `pnpm format:check`
  - PASS.
- `git diff --check`
  - PASS.
- `pnpm --filter @wcdraft/web build`
  - PASS. Known warnings only: webpack chunk-cycle warnings and edge-runtime static-generation warning.
- Browser matrix against local production server `http://127.0.0.1:3019`
  - PASS: seed uniqueness, replay-safe share URL/OG route, pending-signing disabled state, recipient CTA/narrative/caption, compact candidate-before-formation order, no horizontal overflow.
  - Screenshots: 16 total under `docs/reports/pwa-launch-hardening-2026-06-28/screenshots/` for loading, post-reveal, share author, and share recipient at 360×800 and 390×844 in light/dark.
  - Local `/api/og/sign` returned `HTTP 429` because local `DATABASE_URL`/durable rate-limit env was absent; the browser verifier used an offline local signature for OG route/image proof. Production signing remains a post-deploy live gate.
- axe-core
  - PASS: axe-core 4.12.1 on 6 mobile states: draft setup, post-reveal, and share recipient in light/dark at 390×844.
- Root `pnpm typecheck`
  - PASS after rebase: 8/8 tasks, 0 cached, 2m55.071s.
- Root `pnpm lint`
  - PASS after rebase: 5/5 tasks, 3 cached, 2.833s.
- Root `pnpm test`
  - PASS after rebase: 8/8 tasks, 2 cached, 2m58.178s.
  - Web Vitest: 70 files passed / 1 skipped; 745 tests passed / 1 skipped.
  - `game-flow-playwright`: PASS.
- Root `pnpm build`
  - PASS after rebase: 4/4 tasks, 3 cached, 1m40.264s.
  - Known warnings only: webpack chunk-cycle warnings and edge-runtime static-generation warning.

## Review trail

Fresh review found P2 issues during the lane:

- Reuse of unverified incoming `og=` values.
- Raw/unlabeled share and signed-OG narratives.
- Pending-signing share race that exposed token-only URLs before signing settled.
- Compact reveal focus landing on the formation area after mobile order moved candidates first.

All four were fixed and covered by source guards, unit tests, axe, or browser verification.

## Carryovers

- Production `/api/og/sign` must be verified live after deploy because local durable rate-limit env is intentionally absent in this worktree.
- The webpack chunk-cycle and edge-runtime static-generation warnings remain pre-existing build warnings; this lane did not address them.
