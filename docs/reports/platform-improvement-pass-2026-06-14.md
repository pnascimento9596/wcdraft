# Platform improvement pass — 2026-06-14

Full-platform "what could be better" scan + triage + fix-forward. Base `origin/main`
`b676b84` (moved to `4810b27` during the pass as the PRs below landed). Coordinated with the
in-flight artifact-migration PR **#131** (`ws-meta/oversized-merit-v4`, removes oversized
generated blobs from git) — **not duplicated**; the runtime data-delivery finding below is
flagged for that lane / owner decision rather than re-implemented here.

## Outcome

Four bounded fix-forward PRs shipped to production and live-verified; one owner-contractual
class (ratings coverage) plus five measured engineering proposals stopped for a decision.

| PR | Tier | Axis | Status |
| --- | --- | --- | --- |
| **#133** SEO surface + themed error states | Yellow | SEO + functionality | **MERGED** `ae6be47`, live-verified |
| **#134** light/dark AA contrast + 44px tap targets | Yellow | a11y + mobile | **MERGED** `337c40a`, live-verified |
| **#135** security response headers | Yellow | security | **MERGED** `4810b27`, live-verified (4 headers on prod) |
| **#136** perf: parallel data fetch + lazy MemoryReveal | Yellow | performance | **MERGED** `7044aa6`, live-verified |

All Reds and the ratings-coverage class were **NOT** self-merged during the
original pass — they are proposals below.

Follow-up status, 2026-06-14: Security Proposals E and F were cleared in the
bounded security follow-up documented at
`docs/reports/security-ef-csp-share-integrity-2026-06-14.md`. The current
implementation enforces a nonce CSP in production, keeps preview/dev in
report-only mode by default, logs CSP reports at `POST /api/csp-report`, and
treats browser-minted share-token `og` summaries as untrusted for server-rendered
metadata/OG cards.

## Measured baseline (production build, mobile)

Captured from a clean `pnpm build` of `apps/web` and live `curl` against www.wcdraft.com.

- **Client JS: ~1.4 MB raw across all chunks.** Critical first-load chunks (raw → brotli q11):
  framework 185 KB → **49.8 KB**, main 134 KB → 32.9 KB, polyfills 110 KB → 34.3 KB, shared
  3710 217 KB → 48.5 KB, 211054d6 195 KB → 52.5 KB. Draft route page chunk 41.8 KB raw. **JS is
  reasonable and not the bottleneck.**
- **Data bundle `draft-pool.compact.json`: 87 MB raw → 5.0 MB brotli on the Vercel wire**
  (`content-encoding: br`, verified). This single asset is **~10× the entire JS payload** and is
  the dominant first-play / LCP cost on mobile. It is also in the service-worker precache list
  (`public/sw.js:59`), so first visitors download it in the background on SW install.
- No analytics/third-party JS, no `html-to-image`/canvas in the share path, no eager barrel
  imports — the JS side is already clean.

**Lab CWV note (honesty):** full Lighthouse/LCP/INP/CLS lab runs were **not** executed this
pass. The bundle + wire measurements above are the real LCP-driving inputs, and the LCP-dominant
lever (the 5 MB data fetch) is owner-contractual (Proposal B) — so the shipped PRs (metadata /
CSS / headers / a small fetch reorder) are expected to be CWV-neutral, and no before→after CWV
delta is claimed for them rather than fabricating numbers.

## What shipped (before → after)

### #133 — SEO surface + themed error states (Yellow)
A public, traffic-receiving site was missing its core discoverability surfaces.
- **Before:** `curl /robots.txt` → **404**, `/sitemap.xml` → **404**; home had no canonical /
  structured data; transient `/play/*` routes indexable; no themed 404 (the `/leaderboard`-when-
  dark path hit Next's bare default).
- **After (live on prod):** `app/robots.ts` + `app/sitemap.ts` (7 stable public routes,
  deterministic); home `alternates.canonical` + WebSite/VideoGame JSON-LD; `noindex` on transient
  `/play/{draft,results,review,history}` + tokenless `/play/share` + `/settings`; themed
  `app/not-found.tsx` + `app/global-error.tsx`; home era copy reconciled `1930–2022 plus 2026` →
  `1930–2026`.
- **Key safety call:** `robots.txt` deliberately leaves `/play/share` and `/api/og` crawlable so
  the just-shipped per-run social-card unfurls keep working (social scrapers respect robots.txt;
  a blanket `/play/` or `/api/` block would break them). `noindex` on share does not block OG
  scraping.

### #134 — light/dark AA contrast + 44px tap targets (Yellow)
Real WCAG AA failures on the default light theme + two sub-44px controls.

| Element | Before | After |
| --- | --- | --- |
| `p a` links / `.eyebrow` / `.mobile-menu__num` (emerald on cream) | **1.66:1** ✗ | 5.2–5.8:1 ✓ |
| `.hero h1 .accent` / `.stat__num .accent` (large emerald) | 1.66:1 ✗ (fails 3:1) | 5.8:1 ✓ |
| `:focus-visible` outline | 1.66:1 ✗ | 5.8:1 ✓ (WCAG 1.4.11) |
| light `--ink-faint` muted text | **3.18:1** ✗ | 4.6:1+ ✓ |
| dark `--ink-faint` (on panel) | 4.03:1 ✗ | 4.9:1+ ✓ |

New `--accent-text` token (light `#116647` = the codebase's already-shipped light
`--ember-bright`, so brand-consistent; dark `#54e3ab`) for text/icons/focus-rings; `--accent`
stays the brand fill. Ratios independently recomputed in review. `.setupSegBtn` + `.targetChip`
→ `min-height: 44px`. Verified in both themes at 390×844 (screenshots in PR).

### #135 — security response headers (Yellow)
`next.config.mjs` set only SW cache headers. Added global `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()`. **HSTS not
added** — the Vercel platform already sets it (verified). Full CSP deferred (Proposal F).
`X-Frame-Options` governs iframing, not `<img>` OG embeds — social cards unaffected.

### #136 — perf: parallel data fetch + lazy MemoryReveal (Yellow)
- `lib/game/data.ts`: manifest + draft-pool now load via `Promise.all` (independent static URLs)
  instead of serially — removes one manifest round-trip from the first-play critical path.
- `components/game/results-screen.tsx`: `MemoryReveal` (hidden-mode-only) is now `next/dynamic`
  lazy-loaded, so Classic-mode players don't ship/parse its chunk on the results route.
- Behavior-preserving (data goldens + integration + web suites green).

## Surface Inventory

| Surface | Change |
| --- | --- |
| `/robots.txt` | **NEW** — `app/robots.ts` |
| `/sitemap.xml` | **NEW** — `app/sitemap.ts` |
| 404 (any unmatched route) | **NEW** themed page — `app/not-found.tsx` |
| Root error boundary | **NEW** themed page — `app/global-error.tsx` |
| `/` (home) | canonical + JSON-LD; era copy reconciled |
| `/play/{draft,results,review,history}`, `/play/share` (tokenless), `/settings` | `noindex` meta |
| All routes | 4 new security response headers |
| Shell light/dark theme | `--accent-text` token; `--ink-faint` lifted both themes; AA-clean |
| Draft setup pills + position-first chips | 44px min tap target |
| `/play/results` | MemoryReveal lazy-loaded (hidden mode only) |

## Owner-contractual proposals (NOT implemented — decisions for the owner)

### A. Ratings coverage — pool-wide objective-achievement staging (merit-v4.1) — **HIGHEST**
**Diagnose-only audit; ratings are owner-contractual.** Hypothesis (Al-Dawsari / non-European
standouts flattened) **CONFIRMED, with two corrections.**

- **Coverage is curated, not pool-wide.** The active objective-achievement headroom set
  (`etl/merit/raw/active/club-season-honors.json`) is a hand-picked **26-player list** (12 UEFA,
  5 CONMEBOL, 4 CONCACAF, 2 AFC via caps only, 1 CAF via caps). Continental-club-title
  (`club_season_honors`) facts staged for **AFC: 0, CAF: 0, CONCACAF: 0**; continental-cup MVPs:
  **0 players**; domestic-league top-scorer: **0** as a class.
- **Quantified flattening:** scanning all 48 2026 squads for any `career_stature_estimate`
  (headroom) card — **every one of the 7 AFC and 5 CONCACAF squads has ZERO headroom**; CAF 6/8
  have none (only Salah/Egypt + Mané/Senegal escape, via the historical archive). UEFA 11/16 and
  CONMEBOL 3/6 have headroom.
- **Al-Dawsari (`P-70583`) correction:** his **2022** card is actually **86** (top of the Saudi
  squad — raw tournament performance separates him), so the "flat 7-card pile at 79" probe was
  wrong for 2022. The flattening bites the **projected 2026** card: **77, mid-pile**, with zero
  staged honor facts (absent from `career_stature.json`, `source_facts.json`,
  `source_facts_active.json`). The 2026 Saudi squad's top card is a 23-y-o RB at **88** whose
  rating comes from playing club football in Italy.
- **Mechanism:** historical — `weight = 0` with no staged facts collapses the blend to the
  raw-only path, capped at `RAW_ONLY_GLOBAL_CEILING = 0.62` unless a Golden-Ball-class award
  unlocks headroom (`etl/src/wcdraft_etl/rating.py`). **Projected 2026** — the dominant lever is
  the **club-league nation-code prior** `LEAGUE_STRENGTH` (`rating_2026.py`, weighted ~0.31):
  ENG/ESP 1.00, GER/ITA/FRA 0.90, **KSA 0.58**. So Son Heung-min (144 caps, multi-time Asian POY,
  PL Golden Boot) renders **85**, below teammates at 88 who play in Europe.
- **Proposed merit-v4.1 (DO NOT IMPLEMENT — owner decision):** pool-wide objective-achievement
  fact staging using the **same licensing-clean, non-fan-vote sources already in-repo** — RSSSF
  POY archives (`etl/merit/raw/rsssf/{afr,as,sam}-poy.html`), Wikipedia (CC-BY-SA) continental-
  title finals + continental-cup MVP pages, and the pinned century-caps snapshot. Four objective
  classes: continental-club-title winners (final participation, citation-backed), continental-cup
  MVPs, caps/goals record-holders, domestic-league top-scorers-by-goals. ~**150–250 facts over
  60–100 players** (matches the design doc's own §3.4 estimate); prioritize the 12 AFC+CONCACAF
  zero-headroom squads.
  - **Excluded** (CLAUDE.md guardrails): fan votes (UEFA TOTY already removed), proprietary/game
    ratings, monthly awards. Every row citation-backed; conservative linker; ambiguous names
    withheld.
  - **Red-tier implications:** moves `career-stature` + both `rating_version`s + runtime compact
    bytes; needs canary regen (zero pick-flip proof), ETL byte-determinism, all `test:golden:*`
    re-pass, and a λ re-fit **before** re-locking realism bands (never re-lock to pass). This is a
    curation-session series — the rating **code already supports it**; only the staged **facts**
    are missing.
  - **Open question for the owner:** even pool-wide honor staging won't lift non-honored genuine
    starters in weak-league nations — the `LEAGUE_STRENGTH` prior still dominates the rest of the
    squad. Whether to revisit that prior's weight is a separate, deeper rating-semantics decision.

### B. Data delivery — 5 MB → ~1.4 MB on the wire (coordinate with #131) — **HIGHEST perf lever**
Vercel serves `draft-pool.compact.json` at **5.0 MB brotli** (on-the-fly, low quality), but a
max-quality pre-compressed artifact is **1.4 MB** (per #131's own artifact proof) — a **~3.6×**
reduction on the single dominant mobile payload. Options: serve a committed `.br` via a route/
header that sets `Content-Encoding: br`, or split the bundle (lightweight draft index +
on-demand detail). **Red** (touches the SW precache + data-delivery contract) and overlaps the
#131 artifact lane — recommend folding into that lane rather than a parallel change.
Recommendation: **do it** — it is the biggest single mobile snappiness win available.

**Observed during this pass's live verification (transient, but real):** loading prod
`/play/draft` *mid-deploy* surfaced a `RUNTIME DATA UNAVAILABLE — manifest schema_version
mismatch — got "runtime-data-2.0.0", expected "runtime-data-2.2.0"` error — the freshly-deployed
code (expecting `2.2.0`) was briefly served against an edge-cached `2.0.0` manifest. It
self-resolved within ~2 min once the deploy propagated (reload rendered the draft UI correctly;
current served manifest, committed manifest, and code all agree at `2.2.0`). Not caused by this
pass's PRs (none touch the data schema) and not a standing breakage — but it means **every
data-version bump has a short window where mid-deploy page loads can hard-fail the game**. Worth
folding into B's atomic-versioned-delivery design (e.g. version the data URL/path so old and new
manifests coexist during propagation rather than overwriting a fixed filename).

### C. OG edge route parses the full 83 MB pool per cold render
`app/api/og/run/route.tsx` (runtime `edge`) calls `loadDraftPoolBundle()` + full `buildGameData`
on every cache-miss share render — risking edge OOM/timeout on cold/unique tokens. It only needs
the cards referenced by the decoded token. Bounded fix exists but it imports the shared
`buildGameData` (sim-adjacent), so verify the OG model doesn't depend on full-pool indexes →
Yellow→Red. Recommendation: narrow to token-referenced cards (or the split bundle from B).

### D. Sim worker payload clones the full nation map per Simulate
`lib/game/simulate.ts` posts `world.nationByCardId` (full 12,219-entry / ~296 KB map) + all 48
opponent squads to the worker via structured clone on **every** Simulate, though the sim only
walks the user's path. **Red** (sim inputs — needs golden/determinism re-run to prove byte-
identical). Recommendation: narrow `world` to squad+opponent-path card_ids before `postMessage`.

### E. Share-token `og` summary is self-attested, not integrity-signed
`lib/game/run-token.ts` — the W/L/GF/GA/champion summary in a share token is range-bounded and
internally coherent but **not signed**, so a hand-crafted token for a *legal* draft could display
a fictional-but-plausible record on the share card. **Not a leaderboard cheat** (the board
re-sims server-side). Fixing it means re-simming in the OG edge route, which violates the
documented no-server-sim firewall there — **owner decision** on the cost/firewall tradeoff.

**Follow-up status:** cleared by the security E/F follow-up. Because current
tokens are minted in the browser, a server-held HMAC cannot sign the browser-
computed summary without either exposing the secret or adding a signing oracle.
Server-rendered OG metadata now treats `og` as self-attested/untrusted and uses
the neutral static card instead.

### F. Full Content-Security-Policy
#135 added the four cheap headers; a full CSP needs careful allowances for `next/font`, the
`next/og` Satori path, and the theme inline script. Recommend a scoped follow-up (report-only
mode first, then enforce).

**Follow-up status:** cleared by the security E/F follow-up with a per-request
nonce CSP emitted from `apps/web/proxy.ts`, preview/dev report-only by default,
production enforcement by default, and observable reports via
`POST /api/csp-report`.

## Remaining bounded a11y items (identified, ready, not landed this pass)

Honest disclosure — these are bounded (not contractual) but were scoped out of #134 to keep that
PR a high-confidence, fully-measurable CSS unit. Each is a small, ready follow-up:
- **SR text alternatives:** synergy delta arrows (`synergy-bar.tsx`) need an `aria-label`/visually-
  hidden "up/down"; collapsed candidate rows (`candidate-card.tsx`) omit the rating-provenance
  (`badge_label`) for screen readers; the spin result/tagline (`slot-machine.tsx`) should share one
  `aria-live` region.
- **Focus management:** account-menu popover + draft slot-picker sheet lack focus trap / initial-
  focus / restore / Escape; screen transitions (spin→lineup) don't move focus to the new heading.
- **Perf (hot path):** `CandidateCard` is unmemoized with an inline `onSelect` closure — `React.memo`
  + a stable callback would cut keystroke re-renders on the draft list (deferred because it touches
  the 1435-line draft-screen selection wiring and deserves dedicated interaction testing).

## Axes coverage

1. **Performance/snappiness** — measured baseline; #136 shipped (parallel fetch + lazy reveal);
   the dominant lever (data delivery) is Proposal B; OG-edge/sim-payload are C/D.
2. **Mobile UX/jank** — #134 (touch targets); the existing 100svh shell, reduced-motion handling,
   and candidate-grid overflow were audited and found already-solid.
3. **Accessibility** — #134 (AA contrast both themes, focus-ring, tap targets); SR/focus follow-ups
   listed above.
4. **Functionality gaps** — #133 (themed 404/global-error removes the one dead end; era copy).
   Audit found loading/error/empty/skew states already comprehensive.
5. **Tech debt** — codebase is unusually clean (zero TODO/FIXME, zero `: any` in runtime web,
   timing-safe auth). Safe dep bumps available (`next` 16.2.7→16.2.9, `@types/react` patch) — not
   bundled here.
6. **SEO** — #133 (robots/sitemap/canonical/JSON-LD/noindex).
7. **Security** — #135 (headers). Auth/session/CSRF/leaderboard-re-sim/rate-limiting/share-token
   decode all audited as **strong, no holes**; CSP is Proposal F; share-token integrity is E.
8. **Ratings spot-audit** — Proposal A (diagnose-only, confirmed, merit-v4.1 proposed).
