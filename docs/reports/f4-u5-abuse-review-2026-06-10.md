# F-4 U5 abuse controls — independent RED review (PR #72)

- **Subject:** `ws-f4/u5-abuse` (pre-rebase head `dad8e7a`, based on `06cca91`),
  re-integrated onto main `63a403d` (#73) → **verified rebased head `9c71219`**
  (clean rebase, zero conflicts). Verdict applies to `9c71219` plus this docs-only
  commit (no code delta).
- **Reviewer posture:** fresh clone in `/tmp`, all gates re-executed, cruxes probed
  with live code — nothing taken from the PR description on trust.
- **Verdict: PASS — 0 blockers.** HOLD for Lead Architect approval before squash-merge
  (pinned `--match-head-commit`).

## Crux #1 — limiter atomicity: VERIFIED (probed, not reasoned)

- `consumeRateLimit` is one statement: `INSERT … ON CONFLICT (bucket_key,
  window_start) DO UPDATE SET count = count + 1 … RETURNING count`. No app-side
  read-modify-write window exists.
- **Real-Postgres probe (docker postgres:16, two genuinely separate connections):**
  seeded a bucket to cap−1=5; session 1 ran the upsert inside an open transaction
  (returned 6) and held it; session 2's identical upsert **blocked 2340 ms** on the
  row lock, then returned **7** — not 6. At cap 6, exactly one of two concurrent
  submits passes. A 20-connection parallel burst returned counts exactly
  `1..20` — all distinct, zero lost updates.
- **PGlite probe through `createDbSubmitRateLimiter` itself:** two in-flight
  `checkSubmit` calls at count 5 → exactly one allowed; the denied one carried the
  exact window remainder. 20 concurrent raw upserts → counts `1..20`, exactly 6 allowed.
- **Window boundaries:** last ms of a window still counts in it; first ms of the next
  resets; Retry-After clamps to a 1 s minimum at the boundary (probed).
- **Midnight double-increment claim:** demonstrated live — at UTC midnight the 1 h and
  24 h floors coincide; a SHARED kind would land both upserts on one row (count 2
  contamination). The implemented per-window kinds produce 3 distinct rows, count 1 each.
- **F-2 unchanged:** `lib/auth/rate-limit.ts` diff is type-only (the
  `RateLimitBucketKind` union + doc comment; zero runtime lines). All F-2 auth suites
  pass un-edited, incl. pre-existing `rate-limit.test.ts` (6).

## Crux #2 — IP key trustworthiness: NOT a finding on this platform

Vercel's official request-headers doc (checked 2026-06-10, doc last updated
2025-12-13): on production Vercel **overwrites `x-forwarded-for` entirely** — "we
currently overwrite the X-Forwarded-For header and do not forward external IPs. This
restriction is in place to prevent IP spoofing." Client-appended hops never survive;
custom XFF requires the Enterprise "trusted proxy" add-on. www.wcdraft.com serves
directly from Vercel with no fronting proxy, so the first hop `readClientIp` takes is
platform-set and the 30/h IP cap is **not header-spoofable** here.

**Carryover (non-blocking):** this trust is platform-coupled. Fronting Vercel with a
CDN/proxy later would collapse all traffic into the proxy's IP (over-limiting — the
safe direction, but it breaks the cap's usefulness); migrating off Vercel would make
the first hop client-controlled. Worth a one-line comment at `readClientIp`.

## Caps vs plan / Retry-After / budget: VERIFIED

- Caps 6/h + 20/d identity, 30/h IP = plan §5.2 exactly; limiter sits at the plan's
  pipeline step 6 slot (the route's rate-limit seam, gate order untouched).
- Identity = `userId ?? sessionId`: probed — one account over rotating sessions shares
  one bucket (7th denied). **Anon visitors who rotate sessions get fresh identity
  buckets; the 30/h IP cap is the binding bound for them** (documented behavior,
  matches plan §4 board identity).
- Retry-After exactness: suite asserts 50 min / 20 h / 3600 s cases to the second;
  probe added the boundary 1 s clamp.
- Deny path = exactly 1 query, probed: on a denied 7th attempt only `lb-identity-1h`
  advanced (7); daily + IP buckets stayed at 6. Allow path = 3 queries (+1 sweep on
  1-in-50) — inside the plan's "4 cheap queries + 1 insert" Neon budget.

## Privacy + sweep + fail-closed: VERIFIED

- `bucket_key` = `<kind>:` prefix + SHA-256 of the value — the kind is a plaintext
  prefix outside the hash, which gives the same no-cross-bucket-collision guarantee as
  hashing it in (distinct kinds → distinct keys), and the suite asserts
  `^lb-(identity|ip)-1[hd]:[0-9a-f]{64}$` with no raw session/user/IP plaintext.
- Sweep: 1-in-50 allowed submits, 48 h retention (2× longest window), fires/holds at
  the threshold, deletes only expired rows, failure never flips a decision — all
  re-run green. Note: the sweep also clears stale F-2 `email`/`ip` rows (windows
  ≤ 1 h, so 48 h retention is safe for them).
- **Fail-closed mutation test:** flipped the catch block to fail-open
  (`return { allowed: true }`) → **2 tests failed** (unit deny + route e2e asserting
  429/Retry-After 60 **and no row inserted**); reverted, 60/60 green. The "503 would
  be more honest but needs route changes" note is ACCEPTED as a carryover, not fixed here.

## Blocklist: VERIFIED

- Mechanism in `display-name.ts` unchanged (fold extracted verbatim as
  `foldForBlocklist`; matcher loop identical). Hygiene tests lock matcher-form
  invariants + behavior sentinels, not contents.
- Documented exclusions probed live: Modrić (with diacritic), Modric, Nazir, Benazir,
  Slutsky, Hitchcock, Alcock, Dickson, Riddick, Hassan, Passi all **pass**; documented
  accepted-FPs (Spicer, Kike García, Greg Dyke, therapist, Shittu) all **reject** —
  exactly per the severity rule.
- New accepted-FP found: **"Torpedo"** (⊂ `pedo`, e.g. Torpedo Moscow) — consistent
  with the documented severity rule; add to the KNOWN ACCEPTED FALSE POSITIVES list
  next time the file is touched (non-blocking).

## Scope + gates (all re-executed at `9c71219`, fresh clone)

- Diff = 8 files, all `apps/web`; `packages/core` + `packages/db` **EMPTY**. Route
  diff = deps-builder swap (+ hoisted `db`/`now` consts); handler logic untouched.
  Pre-existing gate-order lock tests **un-edited** (the only touched existing test
  file, `submit-route.test.ts`, is import + appended describe block only).
- `pnpm exec turbo run lint typecheck` — **11/11**.
- `pnpm test` — **952 passed**: web **526/1 skip** (was 451 at the pre-rebase base;
  main moved with #74 UI + #71 claim tests), core 302/3 skip, data 50/7 skip, db 74.
- Goldens: core RNG **3** + draft **37**; data **28** + integration **10**;
  leaderboard **5** — all green.
- `pnpm run build` — 4/4. ETL untouched (not run, per protocol). Heavy realism gates in CI.

## Non-blocking notes for the ledger

1. PR body says "submit-rate-limiter-db.test.ts (25)" — the file has **12 tests**
   (the "+29 net" total is still correct: 12 + 15 blocklist + 2 route).
2. F-2's file comment calls the mechanism "sliding-window"; it is a **fixed
   clock-aligned window** (floor of now). Burst worst case ≈ 2× cap across a boundary
   (e.g. 12 in 61 min). Pre-existing naming, plan-specified reuse — characterization
   only.
3. `consumeRateLimit` lowercases values before hashing — case-distinct IDs would share
   a bucket; over-denies, never under-denies. Theoretical only.
4. Carryovers accepted: fail-closed 429 (vs 503), platform-coupled XFF trust,
   "Torpedo" FP doc line.
