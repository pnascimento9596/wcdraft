# Season 2 S7 — same-seed friend challenge

## Outcome

Local YELLOW implementation on `ws-f4/season2-s7-friend-challenge`, based on
exact integration SHA `71a4408482b2cb7f619dac9ad4f83a1716935c6c`. It is ready
for CI and independent exact-head review through a PR targeting
`season/squad-depth`; it is not merged to `main` and is not shipped to
production.

Results and Share now expose a same-seed friend challenge. A recipient can open
the link, inspect the exact configuration, complete the same draw, and compare
against the challenger only when the server can re-derive that score from the
shared token on the current build.

## Architect-delegated proof design

The challenge deliberately does not create a second replay format or durable
challenge store:

- the existing canonical `t3`/`t4` run token remains the sole authority for
  seed, formation, draft mode, order, basis, era, picks, and replay score;
- a compact `fc1.<token-sha256>.<hmac>` proof binds the exact raw token under a
  domain-separated message;
- the proof is exactly 112 characters: lowercase `fc1`, 64 lowercase hex
  characters, and exactly 43 canonical unpadded base64url characters;
- challenger score derivation delegates to the unchanged
  `verifyRunTokenForOg` path rather than trusting URL or client state;
- the existing `WCDRAFT_OG_SIGNING_SECRET` is reused. There is no new secret,
  database, schema, migration, token-codec expansion, or retained-runtime
  artifact.

The proof parser rejects uppercase prefix/hash text, padding, underlength or
overlength fields, extra dots, trailing data, and non-canonical final base64
bits. The verification route requires JSON, checks declared and streamed body
size, applies the shared database-backed rate limiter, validates the raw-token
hash and HMAC with constant-time comparisons, and keeps a separate
8,192-character cap on the whole escaped challenge URL.

## Replay, build skew, Daily, and ranked boundaries

Current-build challenges persist the exact formation, mode, order, basis, era,
and seed. The completed run record stores only `{ token, proof }` as friend
metadata and never creates ranked attempt metadata. Creation and parsing both
reject a record that tries to combine friend and ranked state; the leaderboard
UI also treats friend runs as casual-only. Existing server validation continues
to reject ranked submissions whose disclosed seed differs from the run.

On version skew, the route authenticates the token and configuration but
returns `DIFFERENT_BUILD` with no challenger score. The recipient may still
play the disclosed configuration without receiving a misleading comparison.
Daily challenges fail closed unless the disclosed date is within the currently
published Daily coverage.

The compact token has no verified challenger identity. All challenge surfaces
therefore use the literal fallback `a friend`; no display name or account claim
is invented.

## Honest comparison copy

The head-to-head result says:

> Your friend’s score was re-derived from the shared token; your completed run
> used the same seed and build.

That wording separates the two facts actually proven: the server re-derived
the challenger's score from the authenticated token, and the recipient
completed a run configured from the same seed under the current build. It does
not claim simultaneous play, opponent identity, ranked eligibility, or a
database-backed challenge record.

## React and UI review

The asynchronous verifier paths in the CTA, loader, and Results comparison use
abort controllers; temporary status timers are cleared on unmount. The
verification response is a discriminated type, so score and configuration are
only consumed in the states that provide them.

A first production-browser pass exposed a contradictory `Ranked-capable` pill
after the challenge had already been made casual-only. The active mobile draft
used a standalone `SpinStage` shell that bypassed the main app bar, so changing
only the app-bar branch did not fix every surface. A shared
`draftModeCueForRun` resolver now drives both paths with explicit priority:
Daily, casual-only, ranked, then the ordinary mode cue. A focused regression
test preserves normal Classic `Ranked-capable` copy while requiring friend
Classic to show `Casual`. All evidence from the pre-fix browser pass was
invalidated and regenerated.

## Production browser proof

The final proof ran against `next start` on port 3028 and covers four surfaces
for each viewport/theme combination:

1. Results challenge CTA;
2. recipient setup;
3. active same-seed draft;
4. completed head-to-head comparison.

That is **16/16 surfaces** across 390x844 and 360x800 in light and dark. Every
surface has zero WCAG A/AA axe violations, zero horizontal overflow, and zero
small-target failures. The four complete cases all prove identical seed draws.
The script additionally asserts the exact token and 112-character proof,
recipient configuration persistence, absence of `ranked_attempt`, and absence
of `Ranked-capable` on both setup and active-draft surfaces. The fixture link is
1,524 characters, within the 8,192-character cap.

Both mobile sizes were visually inspected in light and dark. The parent
architect independently inspected regenerated setup and active-draft captures;
both display `Classic · Casual` without clipping. The setup app bar also exposes
the complete accessible name `Draft mode: Classic · Casual`; this closes an
exact-head review failure at `e9c5fd60dad24e7141cc85dda153c61bef4a68d7`
where the app bar had styled adjacent words without the visible separator and
omitted the Casual cue from its accessible name. That failed review is preserved
at `/tmp/season2-s7-exact-review-e9c5fd6.md` with SHA-256
`01b590f0fd51f993f0c1a749f01d816ed94cd040cba5cb2793a889bed9eef354`.
The machine-readable proof and 16 PNG captures are in
`docs/reports/season2-s7-friend-challenge-2026-07-13/playwright/`.

## Validation

Measured on the exact integration base above:

- focused friend/run-record/OG/leaderboard/privacy regression set: **194/194**
  across 7 files;
- web typecheck: PASS;
- web lint: PASS;
- web production build: PASS, **40/40** routes/pages; existing non-fatal
  circular-chunk and Edge warnings only;
- production browser proof: **16/16 surfaces**, 4/4 same-seed cases, and zero
  axe A/AA, overflow, or small-target failures;
- root typecheck: **8/8** Turbo tasks in 1.946s;
- root lint: **5/5** Turbo tasks in 2.666s;
- root test: **8/8** Turbo tasks in 7m55.143s:
  - core: **423/423**;
  - data: **183 passed, 9 expected skips**;
  - DB: **161/161**;
  - marketing: **69/69**;
  - web: **1,273 passed, 1 expected skip**;
  - game-flow Playwright: PASS;
  - responsive shell: **218 metrics, 0 failures** — 84 desktop, 56 mobile,
    40 interaction, 30 mode-setup, and 8 mobile-navigation metrics;
- root production build: **4/4** Turbo tasks in 16.546s and **40/40**
  routes/pages; existing non-fatal circular-chunk and Edge/static-generation
  warnings only;
- core goldens: **69/69**, plus draft goldens **42/42**;
- data goldens: **59/59**, plus integration goldens **22/22**;
- leaderboard golden: **6/6**;
- generated-data check: PASS; **10,973** rating rows and compact artifacts
  reproduced without an unintended tracked diff;
- repository Prettier and `git diff --check`: PASS.

The first full root attempt exited 1 in web Vitest after **1,272 passed, 1
failed, and 1 expected skip**. The exhaustive public-route privacy inventory
correctly discovered the new `POST /api/challenge/verify` surface, but its
expected method list and response exercise had not been extended. The
fix-forward registers the route and runs its real validation response through
the no-email payload/header assertions. That narrow privacy sweep passed 1/1,
the consolidated focused set passed 194/194, and the corrected full root chain
above exited 0. No pass is claimed from the initial failed run.

## Scope, risks, and carryovers

This change affects a user-facing sharing and replay boundary, but does not
change engine, scoring, offer, RNG, simulation, rating, Synergy, manager,
schema, auth, ETL, compact-data, or generated-runtime semantics.

The canonical replay token makes a challenge URL materially longer; the
measured fixture is 1,524 characters. It remains below the explicit 8 KiB cap,
but clients with unusually restrictive URL handling remain the primary
compatibility risk. Version-skew and unavailable historical Daily cases prefer
an explicit unavailable comparison over a guessed score. Challenger identity
remains intentionally unknown until a future authenticated identity contract
exists.

Unit S6 is the exact integration base: PR #273 merged as
`71a4408482b2cb7f619dac9ad4f83a1716935c6c`, and GitHub Actions run
`29302919688` succeeded at that SHA. That is integration-branch evidence only;
neither S6 nor S7 is claimed shipped to `main` or production here.
