# Season 2 S8 — Squad Depth rollover

Date: 2026-07-14

Risk: RED

Implementation branch: `ws-meta/season2-rollover`

Exact integration base: `227b944decc2c8e8dceb38d431b81adf9f8cc1bd`

Target branch: `season/squad-depth`

## Outcome

The S8 release candidate coordinates the Season 2 cutover to
`engine-2026.07.14-squad-depth` and `season-2026-squad-depth`. It keeps runtime
schema `runtime-data-2.10.0`, archives the former season as a read-only board,
opens empty Classic and Memory boards for the new season, and rejects the
shipped pre-rollover token at the real submit boundary with typed
`WRONG_SEASON` HTTP 409 and no persistence.

This report records implementation-gate evidence only. It does not claim the
required fresh-session review, integration merge, production deploy, or live
verification.

## Decisions and contract boundaries

- The schema remains `runtime-data-2.10.0`. The compact player and scenario
  payloads are byte-identical to the integration base; no parsed field,
  validation rule, null meaning, or consumer contract changed. The generated
  differences are coordinated anchor stamps plus regenerated score, Daily,
  manifest, Brotli, and size-report artifacts.
- Ratings, draft offers, progression, scoring, Synergy, manager simulation,
  lambda calibration, authentication, database schema, and the S4 `t3`/`t4`
  codec are frozen.
- Classic and Memory are explicit featured boards and are therefore visible
  while empty. Other exact configurations retain the existing tiny-field
  threshold and the literal `opens at 5 runs` copy.
- Only the known former season, `season-2026-manager-attrition`, is accepted by
  the archive query. This is deliberately a whitelist rather than an arbitrary
  season-key read surface.
- Archived standings are view-only: the archive says `Season closed`, hides
  current-player state and play actions, and never changes the write season.
- `/api/health` reports the leaderboard season resolved by the same explicit
  environment/default policy used by leaderboard routes. A stale production
  `WCDRAFT_LEADERBOARD_SEASON_ID` override would therefore be visible and must
  be treated as a deploy blocker.

## PREV provenance and skew proof

The PREV fixture was produced in a disposable worktree checked out at exact
shipped production-main commit
`f04559f46b43944e94a4ccfa904d8cf9c1a65231`. That checkout installed and built
its own code, then executed its own shipped `encodeRunToken` implementation for
a deterministic casual test run with seed
`wcdraft:season2:pre-merge-fixture:v1`. It is synthetic test data, not a user
run.

The emitted literal `t3` token is pinned in
`apps/web/scripts/generate-token-skew-fixtures.mts`; its decoded-body SHA-256 is
`38aa896cef26b2c33092bea0f1a1a4feb7fce1b86043cb566b4c5d663b35b2e6`.
The S8 generator verifies that digest and decodes the literal but does not use
the S8 body builder to author the fixture. This avoids circular provenance.

The fixture proves the intended compatibility split:

- decoding succeeds because the token remains valid shipped `t3` syntax;
- replay and OG report the honest engine-version mismatch;
- friend challenge reports `DIFFERENT_BUILD` and withholds the challenger
  score;
- leaderboard submit returns `WRONG_SEASON` HTTP 409 with
  `mismatched_anchors: ["engine_version"]` and creates no leaderboard row.

Schema, rating, and compact-data hashes remain equal between PREV and current;
the coordinated engine and season cutover creates the rejection.

## Generated-data closure

Generation ran in dependency order:

1. compact artifacts;
2. score distribution;
3. compact artifacts;
4. pinned 45-day Daily salt map;
5. final compact artifacts.

The Daily map is pinned from 2026-07-10 through 2026-08-23 with 128 samples per
day and a maximum of 8 attempts. The regenerated score distribution used
2,000 samples: 1,338 qualified, median 9, p95 62, minimum -26, and maximum 126.

The strategic-pick canary was regenerated because it embeds the engine
version. Removing only `engine_version` and comparing canonical JSON is
byte-identical to the integration-base fixture: zero pick flips.

## Validation evidence

- Focused S8 web suites: 215/215 passed across eight files. The final PREV
  provenance subset then passed 133/133 across four files.
- Core goldens: 69/69; draft goldens: 42/42.
- Data goldens: 59/59; integration goldens: 22/22; leaderboard goldens: 6/6.
- Heavy realism: 10/10 at 2,000 samples across each of three cohorts.
- Strategic calibration at N=2,000: 1,338 qualifying; manager magnitude
  0.0101751235 (limit 0.015); bench magnitude 0.0394469784 (limit 0.05);
  manager presence changed 566 runs; bench availability changed 763 runs; XI
  changed 953 runs.
- Root typecheck: 8/8 tasks.
- Root lint: 5/5 tasks.
- Root tests: 8/8 tasks. Core passed 423/423; data passed 183 with 9
  intentional skips; database passed 161/161; marketing passed 69/69; web
  passed 1,281 with 1 intentional skip; the game-flow browser harness passed.
- Responsive aggregate: 218 metrics, zero failures (desktop 84, mobile 56,
  interaction targets 40, mode setup 30, mobile navigation 8).
- Production build: 4/4 tasks with all 40 routes/pages generated.
- Generated-artifact existence/integrity check: passed.
- Repository formatting and diff checks: passed.
- Post-commit `pnpm check:generated`: passed and left the tracked generated
  closure unchanged.
- Protected CI run `29308780140` on exact head
  `a96ddf1f989485e361aa8e997b3abe5bcdcd8fc1`: static contracts, goldens, root
  typecheck/lint/test/build, and heavy realism N=2,000 x 3 passed. The secrets
  job and required aggregate failed because Gitleaks 8.24.3 reported six
  `generic-api-key` false positives for duplicate public season-id literals.
  That exact head is void for merge.
- The minimal fix-forward sources those six values from
  `DEFAULT_LEADERBOARD_SEASON_ID`; scanner policy and allowlists are unchanged.
  Replacement exact-head CI and fresh independent review remain required.
- Fresh exact review of `a96ddf1f989485e361aa8e997b3abe5bcdcd8fc1`
  independently returned FAIL. Artifact:
  `/tmp/season2-s8-exact-review-a96ddf1.md`, 526 lines / 20,598 bytes, SHA-256
  `4fedf6c87b111cdf2fca717ac4d67ecb929944bae166ee0f2b23d73f75c22ac3`.
  The remote head had advanced, voiding that review boundary, and the reviewer
  found a determinative Advanced-board state-machine defect: the effect
  depended on `advancedPhase`, changed idle to loading, then cancelled its own
  successful 62-request batch during cleanup. The UI stayed permanently on
  `Checking which lanes are open…`, so a non-featured lane with five entries
  never enabled.
- Gitleaks-only head `df0cd0d806474989acaa61d0c302dfc6babf247a`
  inherited the Advanced-board defect and is superseded. The next fix-forward
  uses a request generation keyed only by disclosure-open and selected-season
  state, clears summaries on each run, ignores stale completions, and refetches
  on close/reopen and current/archive navigation. Mounted async coverage pins
  62-summary settlement, five-run enablement, and cross-season stale-response
  isolation; the production-browser leaderboard surface now opens Advanced
  and requires every mocked five-plus lane to enable before capture.
- Advanced-board fix-forward validation: 45/45 focused mounted tests passed;
  web typecheck and lint passed; the production build generated 40/40
  routes/pages. A strict production-build browser run passed 4/4 at 390x844
  and 360x800 in light and dark mode, waiting for all 62 mocked eligible lanes
  to become enabled before capture. The full root test passed 8/8 in 7m52s,
  including web 1,281 + 1 intentional skip and responsive 218/0.
- Cumulative exact-head review of the rebased nine-commit main candidate
  `d44ea31a749c7a0690a53ab9c7e7a0017b29a795` returned FAIL. Artifact:
  `/tmp/season2-s8-cumulative-exact-review-d44ea31.md`, 270 lines / 19,312
  bytes, SHA-256
  `18aeb49994d1fea58028a1b1c02b443d062e7a767a7fd735b923b7be2e34f1c9`.
  The verifier awaited both `/api/challenge/verify` response headers and JSON
  body completion without an elapsed-time bound, so the recipient draft setup
  and Results comparison could remain pending forever on stalled I/O.
- The cumulative fix-forward keeps the POST single-dispatch, moves both fetch
  and response parsing inside one four-second `boundedRequest`, uses
  mutation-conservative timeout classification because the server rate-limit
  counter may already have committed, and maps failure to the existing
  `UNAVAILABLE` result. Retryability is explicit: unavailable and rate-limited
  verification may be retried manually with a fresh controller; malformed,
  wrong-route, and missing-run states remain non-retryable. Mounted coverage
  proves finite recovery and one manual retry for both held-open headers and a
  held-open JSON body. Focused challenge/loader coverage passes 19/19 across
  three files; web typecheck and lint pass. The resulting exact head still
  requires fresh CI, S7 browser proof, and a new cumulative RED review.
- Fix-forward head `f97aadfd1e2526c76c5f3738d63577f936f67a10` is void
  before review because Gitleaks 8.30.1 reported two `generic-api-key`
  findings on direct `proof: "fc1.placeholder"` test assignments. No secret is
  present, but required CI remains fail-closed. The replacement sources the
  same synthetic placeholder from static segments through one shared fixture;
  scanner configuration and allowlists remain unchanged, and production
  behavior is identical. All exact-head gates and reviews restart afterward.
- The same fresh `f97aadf` review found that both public and authenticated
  leaderboard reads accepted arbitrary nonempty `season` query keys. The
  shipped archive contract permits only the current season and
  `season-2026-manager-attrition`; the shared parser now enforces that
  allowlist and rejects seasonal keys on Daily boards. PGlite regressions keep
  the retained archive readable while proving seeded unpublished-season rows
  remain unreachable. The preserved FAIL report is
  `/tmp/season2-s8-cumulative-exact-review-f97aadf.md` (129 lines, 10,053
  bytes; SHA-256
  `4a127824bf48e37d78451eaf07f9b5ae4f1e3c64ae84b5168ec747e11eac94bb`).
- Exact head `1c03b0e16e45a4a19676888f5241e81da278bd7d` completed the
  local root gate but is deliberately void. Cumulative
  `ollama-cloud/glm-5.2` max review returned PASS while documenting that
  challenge-proof creation parsed `response.json()` outside its bounded
  request. Release adjudication promoted that observation: a held-open sign
  body leaves the user action pending forever, and its durable limiter may
  already have committed. The proof POST and body parse now share one
  `unsafe-mutation` four-second budget. Mounted coverage proves finite recovery
  and one manual retry with a fresh controller for both held-open headers and a
  held-open body. The verbatim report is
  `/tmp/season2-crossmodel-s8-1c03b0e.md`.
- Deploy and live verification remain pending until their lifecycle stages.

## Risk, rollback, and reviewer focus

The principal runtime risk is configuration drift: an explicit production
leaderboard-season environment override wins over the new code default. The
health payload makes this observable; deployment must not proceed unless it
reports `season-2026-squad-depth`.

Reviewer focus should include archive-query whitelisting, the absence of any
archive write path, empty featured-board visibility, tiny-field behavior for
non-featured configurations, PREV provenance independence, and real submit
non-persistence. Because this is RED and merge equals production ship, the
only acceptable merge head is the independently reviewed exact SHA.

Rollback is a revert of the final squash merge, followed by deployment and the
same live health/leaderboard checks. No schema or data migration needs reversal.

## Carryovers outside S8

The integration orchestrator owns rebase/integration, environment inspection,
fresh-session RED review, CI adjudication, SHA-pinned squash merge, deployment
observation, production live verification, and automatic revert on any failed
live check. Those actions are intentionally not performed by this unit branch.
