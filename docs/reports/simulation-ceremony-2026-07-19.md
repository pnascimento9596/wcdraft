# Simulation ceremony — RED delivery report

Date: 2026-07-19

Branch: `ws-ux/simulation-ceremony`

Base: `1c17802ba4366a8e9a5a8bfc4dda7bf87071803a`

## Outcome

Pre-merge candidate complete. This report records the implementation and local review envelope. The production deployment SHA, Vercel READY observation, and live run evidence are intentionally recorded in a documentation-only closeout after the SHA-pinned merge and live verification; until then this is not a shipped verdict.

## U0 — verified contracts

- `runTournamentFull` computes the tournament synchronously. The user path is `G1`, `G2`, `G3`, `R32`, `R16`, `QF`, `SF`, `F`, stopping at the first knockout loss. The unchanged engine consumes its RNG-derived substreams inside that single call.
- Before this lane the module worker returned one terminal `done` message. The client already owned prewarm/reuse, request identity, cancellation/termination, timeout, stale-message rejection, busy/double-start rejection, and synchronous main-thread fallback.
- START previously locked the rendered run revision, computed and persisted the complete simulation, then navigated directly to Results. Results still consumes the same persisted simulation contract; the ceremony is presentation inside the existing handoff lifecycle.
- The truthful five-node mapping is by `MatchResult.round`: `R32 → R16 → QF → SF → F` (normally match indexes 3–7). The approved source's duplicate R16 label conflicted with the shipped 2026 tournament contract, so the first node is the architect-delegated `R32`; the R16-exit fixture is an R32 win followed by the real R16 loss. Group exit lights no knockout node.
- `advanced === true` is the real knockout-win signal. A loss lights only that real node; later nodes remain `none`. Final gold additionally requires the real champion terminal state.
- Existing determinism authority is the sim golden set plus the RNG decision sequence. This lane added an observed full-tournament derived-subseed trace because the prior generic RNG golden did not cover the complete tournament decision path.

## U1/U3 — approved design and honest seam

- The approved trophy, hero, advancement path, Terrace palette, Archivo metrics, tabular numerals, pulse/settle motion, single polite live region, and 44px Skip are retained. Existing Terrace variables replace literals where real tokens exist. The approved bright rim `#f5c95f` and selected-harness foreground `#05130c` have no existing token and remain exact, with file/value/count-scoped contract tests.
- Production passes `showHarness={false}`. A/B/C fixtures exist only in the retained owner-review harness. The production model accepts real streamed `MatchResult[]` plus the eventual unchanged terminal simulation; no canned outcome is reachable from the shipped caller.
- Each worker-client-validated match is published immediately. Review reconciles by authoritative `matchIndex`, so a partial worker prefix followed by main-thread fallback is replaced in place rather than duplicated.
- A node reveals at `max(aesthetic beat, observed real-result arrival)`. Node state and score come from the streamed real result even before terminal persistence. The terminal object remains required for final aggregate/status authority and navigation.
- Visual resolve is separate from navigation: champion `[520,820,1120,1420,1760] / 2100ms`; semi-final loss `[520,820,1120,1520,null] / 1860ms`; corrected R16 loss `[520,900,null,null,null] / 1440ms`. Navigation remains gated by terminal persistence, all played nodes being visible, and the full `3200ms` floor.
- Real rendered fixtures prove champion `100%` gold, semi-final loss `75%` non-gold, and R16 loss `50%` non-gold. Losing paths never light later nodes and show the real decisive score/status.
- Reduced motion keeps the same paced cadence while transition durations collapse and pulses/settle animations are suppressed.
- The ceremony portals to `document.body`, marks every covered sibling `inert` and `aria-hidden`, locks body scroll, and restores exact prior attributes plus overflow value/priority on cleanup. Skip remains outside the inert subtree.
- The global Terrace button rule is `!important`; component-scoped computed-style regressions prove the approved Skip `.08em`, harness control `-.01em`, and button weight `800` win the real cascade.

## U2 — delivery and byte identity

Chosen mechanism: compute once, then stream a typed replay of the already-computed real results. The worker performs the same single unchanged `runTournamentFull` call, posts ordered `{kind:"match", request_id, matchIndex, result}` messages for real indexes `0..7`, then posts the unchanged terminal payload. The client validates schema, request identity, strict index/order, count, and JSON equality between the full stream and terminal matches.

- RNG decision trace: 34 observed `deriveSubseed` calls; locked SHA-256 `3316c5487b1b150b8df1f051a4e88d582443876629d275f65cab5de2ceb6df77`.
- Focused sim golden + decision trace: 2 files, 54/54 passed; no re-lock command used.
- Core engine production diff: zero files.
- Tracked golden, fixture, ETL output, and runtime-data diff: zero files.
- Runtime manifest anchors remain `runtime-data-2.10.0`, `engine-2026.07.18-basis-aware-tiering`, `wc-perf-6.6.0`, `proj-career-5.6.0`; draft-pool raw SHA remains `ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`.

## Local gates

- Root typecheck: 9/9 tasks passed.
- Root lint: 6/6 tasks passed.
- Root build: 5/5 tasks passed. Next emitted the repository's existing webpack circular-chunk warnings; build and runtime-data trace verification completed successfully.
- Root package tests before browser matrices: core 428, data 185 (9 skipped), database 161, web 1,397 (1 skipped), marketing 69, mobile 7 — all executed assertions passed.
- Heavy realism: 1 file, 10/10 passed; no band re-lock.
- Explicit goldens: core 111, data 81, leaderboard 6 — all passed without regeneration.
- Strict ceremony collision group: 84/84 cells, zero failures, Chromium + WebKit, 320/360/390, light + dark, normal + reduced motion.
- Full collision inventory: 288/288 cells, zero failures. Scanner controls: 14/14 expected outcomes; non-inert positives fire and inert/separated/transparent negatives remain clear.
- Browser lifecycle: forced native-worker failure occurs after the first real match message; main-thread fallback persists the exact run complete and reaches Results. Cancellation invokes the real Back handler, terminates the worker, restores `ready`, persists no simulation, and produces no late Results navigation.

## Review history

- Fix-forward review at `c5c76e1` failed because streamed content was buffered until terminal persistence, outcome-specific resolve beats were collapsed, component-render acceptance was absent, and the harness was simplified. All were corrected; that review was not reused.
- Fix-forward review at `b22d750` failed because the global `button` tracking rule overrode approved ceremony tracking at computed style. Component-scoped cascade pins and mounted computed-style coverage corrected it; that review was not reused.
- Final fresh-context U2, U3, U4 and GLM 5.2 boundary verdicts are SHA-pinned to the report-bearing head and must all be PASS before merge.

## Ship and live closeout

Pending pre-merge. Required closeout evidence: squash merge with `--match-head-commit`; Vercel READY; `/api/health` and `/api/og/health`; real Career Classic ceremony/full floor/results/token replay; known losing live run partial/non-gold/honest status; reduced-motion completion; Skip without data mutation; live collision/one-screen matrix. Any failed live check triggers an automatic revert.

## Risks and carryovers

- The worker stream is intentionally a replay after the unchanged synchronous computation. It creates honest result arrival/pacing without introducing async boundaries into engine RNG consumption.
- Direct WebKit audits that inject axe-core styles report the site's CSP blocking the verifier's injected inline stylesheet. The production-equivalent strict collision mode does not inject that style and is clean in both engines; this is verifier instrumentation, not a runtime exception.
- No rating, draft-pool, schema, leaderboard, auth, canonical document (other than `STATE.md`), or engine semantic changed.

HUMAN ACTIONS: none expected.
