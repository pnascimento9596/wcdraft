# Final polish U1: OG endpoint hardening

## Outcome

Implementation complete on `ws-f4/final-polish-u1-og`, based on
`c102142deffcfbe72bef7b1456d5e091e5869462` (`origin/main` at lane creation). This
report is an implementer handoff only: merge, deployment, live verification,
fresh-context review, and cross-model review remain outside this branch's authority.

## Contract and changes

- `/api/og/sign` now requires the normalized media type `application/json` before
  body access. Missing or non-JSON media types return `415` with
  `{ "ok": false, "error": "UNSUPPORTED_MEDIA_TYPE" }` and `Cache-Control: no-store`.
- The request-body byte ceiling, run-token validation, durable rate limit, replay,
  signing, challenge-proof generation, and cache behavior are unchanged.
- Background preview signing and the user-triggered challenge-proof request now use
  one shared OG-sign client. Fetching, streamed response reading, and JSON decoding
  all occur inside the caller's existing 4,000 ms budget.
- The shared client rejects a declared or streamed response above 12,624 bytes
  before JSON parsing. The ceiling is the maximum signed OG envelope (12,000), the
  maximum challenge proof (112), and 512 bytes of JSON framing headroom.
- Preview failures retain the existing three-attempt schedule and fail soft to the
  static `og-default` experience; replay/copy/native-share actions remain usable.

No token codec, signing format, verification semantics, core/data behavior, schema,
auth/CSRF policy, or OG-card layout changed.

## Regression evidence

- Added absent and wrong content-type cases that use a request whose `body` getter
  throws, proving the route returns `415` without touching the body.
- Added a held-open preview response-body case. Before the implementation it made
  only one request and never reached the soft fallback; after the implementation it
  exhausts three bounded attempts and exposes the static preview state.
- Added an oversized valid-JSON preview response case. Before the implementation it
  was accepted as a signed preview; after the implementation it is rejected and
  fails soft after the existing retry schedule.
- Kept the challenge-proof held-body timeout case on a real streaming `Response`,
  proving the shared decoder preserves the authoritative path's timeout behavior.

## Validation

- `pnpm install --frozen-lockfile`: pass.
- Focused Vitest (`run-og`, mounted share resilience, mounted challenge-proof
  timeout, PWA source guard): 45 passed across 4 files.
- Full web Vitest: 1,315 passed, 1 skipped across 127 files.
- `pnpm check:generated`: pass; deterministic bundle check reported 12,219 player
  cards, 501 manager cards, and 48 teams.
- Root `pnpm typecheck`: 9/9 tasks passed.
- Root `pnpm lint`: 6/6 tasks passed.
- Root `pnpm test`: 9/9 tasks passed. Package totals were 2,158 passed and 10
  skipped; game-flow Playwright passed; responsive-shell metrics were 218 checked,
  0 failures (desktop 84, mobile 56, interactions 40, mode setup 30, mobile nav 8).
- Root `pnpm build`: 5/5 tasks passed. Next generated 40/40 static pages and runtime
  trace verification found 8/8 current-schema files for both `/api/og/sign` and
  `/api/challenge/verify`.
- `git diff --check`: pass before handoff.

The production build emitted webpack circular-chunk warnings and an edge runtime
static-generation warning, but completed successfully. No secrets or credentials
were printed, logged, or committed.

## Review and live gates

U1 is security-adjacent/Red. A fresh-context reviewer must re-execute the gates at
the exact PR head, and the orchestrator must also obtain the required cross-model
spot review. After a SHA-pinned merge, live verification must prove:

1. non-JSON `/api/og/sign` returns the typed `415` response;
2. valid JSON still produces a signed OG that renders `200 image/png`;
3. the friend-challenge round trip remains `VERIFIED`.

No production mutation or live verification was performed from this implementer
branch.

## Risks and rollback

The behavioral blast radius is limited to OG-sign request media-type validation and
the two browser consumers of that endpoint. A server response exceeding the derived
12,624-byte client cap will now fail soft rather than render a dynamic preview; the
server-side signed envelope contract remains capped at 12,000 characters. Rollback
is a single squash revert of this U1 commit; no migration or data rollback is needed.
