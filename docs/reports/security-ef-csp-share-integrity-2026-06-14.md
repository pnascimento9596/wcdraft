# Security E/F follow-up — CSP + share-summary integrity

Base: `origin/main` `4c22e375dc605f0a401d84d836b0b379fe8856a3`.

## Outcome

Proposal F is implemented as a nonce-based CSP:
- Preview and local/dev default to `Content-Security-Policy-Report-Only`.
- Production defaults to enforcing `Content-Security-Policy`.
- `WCDRAFT_CSP_REPORT_ONLY=1` can force report-only, and `0` can force enforcement.
- Violations are observable through `POST /api/csp-report` and server logs.

Proposal E is fixed with the minimal honest mitigation, not HMAC signing. Current
share tokens are minted in the browser. A server-held HMAC cannot sign a
browser-minted result summary without either exposing the secret to the client
or adding a public signing endpoint. A signing endpoint that does not re-sim or
otherwise verify the result would sign forged summaries and preserve the
vulnerability. Re-simming to verify would violate the no-server-sim firewall this
lane was asked to preserve. Therefore server-rendered OG metadata now treats
the token `og` summary as self-attested/untrusted and falls back to the neutral
static card. The in-app share/results pages still replay the token from the pick
log and render the honest client-side result.

No new secret variable is required.

## Surface Inventory

| Surface | Change |
| --- | --- |
| All document routes | `proxy.ts` adds nonce CSP + `Reporting-Endpoints`; production enforces, preview reports only. |
| `POST /api/csp-report` | New Edge route; accepts CSP reports with byte-bounded intake, returns `413` for oversized bodies, and logs bounded/truncated report bodies. |
| `/` | JSON-LD `<script>` carries the per-request CSP nonce. |
| Root layout | Calls `connection()` so Next can attach the nonce to runtime scripts/styles per request. |
| `/play/share` metadata | Current unsigned `t2` result summaries no longer select `/api/og/run`; default OG image is used. |
| `/api/og/run` | Unsigned, forged, malformed, legacy, pre-summary, and foreign-build tokens all use the static fallback. |

## Validation

- `pnpm --filter @wcdraft/data build` — PASS; `ensure-generated-artifacts: ok`.
- `pnpm --filter @wcdraft/db build` — PASS.
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/csp-security.test.ts lib/game/__tests__/run-og.test.ts lib/leaderboard/__tests__/public-payload-email-sweep.test.ts` — PASS, 3 files / 15 tests.
- `pnpm --filter @wcdraft/web typecheck` — PASS.
- `pnpm --filter @wcdraft/web lint` — PASS.
- `pnpm --filter @wcdraft/web build` — PASS; existing Next/Webpack circular chunk warnings only.
- Root `pnpm typecheck` — PASS, Turbo 8/8 tasks successful.
- Root `pnpm lint` — PASS, Turbo 5/5 tasks successful.
- Root `pnpm test` — PASS, Turbo 8/8 tasks successful:
  - `@wcdraft/core`: 366 passed
  - `@wcdraft/data`: 65 passed / 7 skipped
  - `@wcdraft/db`: 79 passed
  - `@wcdraft/marketing-x`: 64 passed
  - `@wcdraft/web`: 679 passed / 1 skipped
- Root `pnpm build` — PASS, Turbo 4/4 tasks successful; existing Next/Webpack circular chunk warnings only.
- Local production server:
  `WCDRAFT_SITE_URL=http://127.0.0.1:3031 pnpm --filter @wcdraft/web exec next start -H 127.0.0.1 -p 3031`.
- Header proof on `/`: `Content-Security-Policy` present with nonce, plus existing `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- Runtime report proof: normal `POST /api/csp-report` returned `204` with an
  empty body; oversized streamed body returned `413` with an empty body.
- Independent review fix-forward: fresh-context reviewer found the first report
  route truncated logs but read the full body first. The route now rejects
  oversized `Content-Length` before reading and stream-reads only up to
  16,384 bytes when the header is absent or unreliable; the focused test suite
  covers normal `204`, header-based `413`, and stream-body `413`.
- Home HTML proof: JSON-LD script rendered with a nonce.
- Browser screenshot/HAR proof under enforcing CSP:
  home, draft, share, results, settings, and OG fallback rendered at 390×844 or OG-card size; all HARs had 0 4xx/5xx and 0 `/api/csp-report` posts.
- Forged-summary proof: a syntactically valid altered `og` summary decodes but `shareOgImageForRunValue(...)` returns `defaultRunOgImage()`.

## Residual risk

The neutral fallback fixes the fictional server-rendered share-card summary. It
does not preserve per-run dynamic OG cards for browser-minted tokens. Restoring
per-run dynamic OG safely requires a trusted result verifier/signer design,
which is a separate architecture change because it must not become a signing
oracle and must explicitly decide whether server-side simulation is allowed.
