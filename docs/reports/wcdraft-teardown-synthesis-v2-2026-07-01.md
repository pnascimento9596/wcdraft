# wcdraft — Teardown Synthesis v2 (Fable set) — 2026-07-01

Three reports (Lens 1 Engine · Lens 2 UX · Lens 3 Product-Fit), all Fable-class, all pinned to `1a5fa90` / engine-2026.06.30-manager-attrition / season-2026-manager-attrition. Baseline verified stable start-and-end in all three. Deduped by Anchor; convergence = independent reports flagging the same issue.

## Headline verdicts

- **Lens 1 (engine truth): CLEAN.** 0 High, 0 Med, 10 Low (8 Objective hardening + 2 Gated documentation). Every keystone claim independently re-verified: bundle SHA byte-equality repo↔live, token 6-anchor gate at all four call sites, OG durability (no deploy-volatile inputs in HMAC or cache key), override curve-inversion intact with drift tripwires, anon-ranked double-gated (app 401 + DB constraint), board payload PII-free, best-XI/sim key internal-only, legend census 295 pinned live=repo=golden, determinism ESLint AST guard enforced in CI.
- **Lens 2 (UX): 26 findings** (2 High, 12 Med, 12 Low) — but the compact no-scroll shell, AA (893 elements, 0 violations both themes), honest-state, 44px, SHAPE/HUE, and the How-to-Play rewrite all PASSED. The craft floor is real; the findings are surface defects on top of it.
- **Lens 3 (loop): ~5 of 8 steps compound, none broken.** Cold hop is excellent (share CTA at 1.8s, tap→draft 216ms). **The share joint leaks — exactly where X traffic hits first.**
- **Difficulty feel-read (Lens 3, subjective):** rewarding-leaning; 4/6 qualified (matches ~66%); elite exposure ~12% felt right; edges = negative scores with no cushion + cryptic "Perfect 1-0 run: 108 pts". Caveat: the day's seed handed a naive bot a first-try 8-0 (FIT-11 daily-seed variance).

## Convergence map (≥2 independent reports)

- **"not applicable" name corruption → OG card** — UX-02 + FIT-01 (both High). 558 bundle occurrences; mononym legends; renders on the exact X-unfurl asset. THE launch blocker.
- **Share unfurl degradation** — UX-12 (caption link unsigned → default preview + recipient error banner) + FIT-03 (silent OG-sign failure on first load, n=1, no retry).
- **Raw season slug on public board** — UX-06 + FIT-08 ("SEASON SEASON-2026-MANAGER-ATTRITION").
- **Daily orientation** — UX-03 (mid-daily chip says "Classic · Ranked-capable") + FIT-04 (challenge anchor "beat 84 pts" dropped after the tap).
- **Pre-submit standing placeholder** — FIT-02 ("Top — of today's field" em-dash on the champion chip AND inside the tweet caption) + UX-22 (percentile absent, nothing holds its place).
- Cross-audit echo: empty/fragmented Advanced board (FIT-07; echoes old H3) — Daily default mitigates.

## Launch-blocker set (fix before X activation)

1. FIT-01/UX-02 name corruption (Red: ETL null-sentinel + regen).
2. UX-01 narrative binds the wrong player to the exit match (Red: resolver + golden `names ⊆ match participants`). Single-source but High, hard evidence, and it's the share caption.
3. FIT-02 em-dash standing in captions (Yellow: turn into "post to claim today's standing"; strip unknown standing from captions).
4. UX-12/FIT-03 signed link in caption + OG sign retry + silence recipient error banner (Yellow).
5. UX-03/04/09 daily chip + chip truncation + Classic/numeral collision (Yellow: the first two screens a cold phone sees).

## Objective fix inventory (by lane)

**RED (data/core):** FIT-01 names (ETL sentinel→null, display fallback, regen, name goldens) · UX-01 narrative match-binding + golden · adjacent GK-scores-field-goal face-validity (exclude GK from open-play opponent scorers) · ENG-04 token md↔version assert at decode · ENG-05 delete/guard dormant OG seam · ENG-09 golden the mean-score population · ENG-10 malformed-before-rate-limit ordering.
**YELLOW (web):** FIT-02 standing hook · UX-12+FIT-03 caption signing/retry/banner · UX-03 daily chip · UX-04 chip short-forms · UX-09 numeral collision · UX-06/FIT-08 human season name · jargon sweep (UX-07 "sighted", UX-15 "entity", UX-16 "STRENGTH MULT.", UX-20 seed/counter strings) · UX-05 label coverage% vs fit% · UX-08 hide false muted chips · UX-23 TOP SCORER caption · UX-24 SUBS header · UX-25 hero aria genericize · UX-10 privacy-policy password truth · UX-14 crest manifest key-mismatch + digit monograms ("M0") · FIT-05 collapse share tooling on recipient view · ENG-01 "5-2-—" · ENG-02 streak "—" · ENG-03 NON_CANONICAL_CONFIG code · ENG-06 daily-badge cosmetic forgery check.

## Gated — owner decisions (not dispatched)

- **FIT-06 (High): local no-post standing on every result** ("beat ~72% of reference drafts" from a bundle-shipped distribution) — makes the median run shareable; share volume stops scaling with rare 8-0s. Strong recommend.
- FIT-07 collapse Advanced to one headline lane until N≥5 (+ FIT-08 human season names — the naming part is dispatched as Objective).
- FIT-09 sign-in nudge at streak ≥2 (X in-app browser storage volatility).
- FIT-11 daily-seed vetting bot (purity vs curation tradeoff).
- FIT-10 rename "Perfect 1-0 run: 108 pts" (+ off captions).
- UX-11 share-card art de-plumbing (seed string + giant token URL off the card).
- UX-13 line-strength scale (rescale vs caption).
- UX-18 Open roster: collapse managers group. · UX-19 "Modern" double meaning. · UX-26 spin skip/quick-spins (85s/run tax on repeat players).
- ENG-07 historical-flag substitutes (monogram vs disclosed-substitute). · ENG-08 document choice_overall as offer-tier-only display read.

## Proven solid — protect (all three lenses)

Token versionsAgree conjunction at every call site · determinism ESLint guard · OG durability + forgery (live-probed) · anon-ranked double gate · PII-free boards · internal-score keying (both sides) · override inversion + tripwires · legend census 295 · compact no-scroll shell (844px exact at 390×844) · AA both themes (0/893) · honest-state discipline incl. Memory blind seam · 44px floor · SHAPE/HUE system · no wrong crest anywhere (monogram fallback honest) · How-to-Play rewrite scannable · cold hop (1.8s CTA, 216ms tap→draft) · Daily fronting coherent · payoff labels/narrative variety · mode-role separation (Open correctly board-less) · streak/countdown legibility.

## Audit limitations (all three, honest)

- No signed-in-surface live audit (magic-link inbox unreachable; assessed from source). Account hub/claim/delete = untested live.
- Lineup inspector untestable (season boards empty + no-submission fence).
- Lens 1 could not capture a live token via automation (spin animation); byte-identity claim rests on source + goldens.
- Next-UTC-day rollover not directly observed.

## Disposition

- Second-model teardown set: DEFERRED (owner call) — the Fable set is convergent and the marginal value is below fixing the Highs; a post-fix re-audit doubles as fix-verification on a fresh baseline.
- Two fix lanes dispatched in parallel: `wcdraft-data-truth-names-narrative-RED-lane.md` + `wcdraft-share-polish-orientation-YELLOW-lane.md`.
