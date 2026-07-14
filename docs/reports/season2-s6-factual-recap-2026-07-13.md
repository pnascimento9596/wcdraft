# Season 2 S6 — post-run factual recap

Date: 2026-07-13

Branch: `ws-f4/season2-s6-factual-recap`

Initial base: `cdf16b4f7f795302cc44106c58626383dd56c9e7`

Final integration base: `3af456d6957d5203f93144bb94e6365ba9d75a6f`

Risk: YELLOW (bounded Results UI and pure presentation adapter)

## Outcome

Results now includes a mobile-first **Why it went this way** dossier. It reads
the persisted run record and per-match `MatchTeamFacts` only. It does not call
simulation, strength projection, Synergy, manager, fit, or rating helpers.

The recap renders:

- the final played match's persisted post-tactical line strengths (or active
  strength when the outcome bypassed the tactical seam);
- the exact count and names of below-natural-fit starters when compatibility is
  present on the persisted unchanged sheet;
- the final match's persisted active Synergy multiplier and shipped nation
  clusters, with nation names resolved through the existing `GameData` index;
- persisted manager presence, nation-link, and applied tactical tiers in
  bounded display terms;
- every persisted bench activation, labelled as a slot/line contribution delta
  rather than an aggregate strength claim;
- every short-handed availability event, grouped by played match;
- honest empty states: `No activations` or `—`.

Bench activations and short-handed rows link to the corresponding persisted
availability entry in the existing match event log. The link opens that match
and targets an id composed from both `match_id` and `event_id`, avoiding an
unstated cross-match event-id uniqueness assumption. Player and nation labels
use existing display indexes; an unresolved identity renders `—`, never a raw
id.

## Architect-delegated decision

S4's optional compact `arrangement` persists canonical card order but does not
persist per-destination position compatibility. `MatchTeamFacts` likewise does
not carry starter-fit rows. Recomputing compatibility from the current runtime
bundle on Results would violate S6's persisted-facts boundary and could silently
reinterpret an old record.

Therefore:

- an unchanged/as-drafted sheet uses the exact persisted
  `draft.squad[].position_compatibility` rows;
- a record carrying `arrangement` renders
  `— · not recorded for this arranged XI` for this channel;
- S6 does not add a run-record/token field or change S4's codec. A future
  versioned contract may persist arranged starter fit if product value warrants
  the schema cost.

This is the least-behavior-changing honest display. It preserves S4's codec,
does not infer missing facts, and distinguishes unavailable evidence from a
real zero.

## Copy boundary

The recap makes only factual statements. In particular, activation consequences
are named **slot contribution** deltas. It never attributes aggregate
base-to-active strength movement to one activation, and it contains no
counterfactual language such as “would have won,” “cost you,” or “should have.”

## UI and accessibility

The implementation preserves WCDraft's dense broadcast-tactics visual system:
emerald marks factual structure and event-log interaction; gold remains
reserved for existing pick/win semantics. All values use the existing Space
Grotesk token, tabular numerals, CSS custom-property colors, and existing panel
radii. Event-log links have a 44 px minimum target.

The React best-practices checklist found no new mirrored state, effects,
waterfalls, conditional hooks, unstable reorderable keys, or untyped handlers.
The presentation adapter is pure and memoized once at the Results boundary;
the recap component is a named semantic component with native sections,
headings, lists, definitions, and anchors.

## Browser evidence

Production-build captures are committed under
`docs/reports/season2-s6-factual-recap-2026-07-13/playwright/`:

- Results at 390x844, light and dark;
- Results at 360x800, light and dark;
- `responsive-season2-s6-final.json` with 4/4 metrics passing and zero axe,
  console, horizontal-overflow, small-target, or navigation-wrap failures.

The opt-in interaction proof under `playwright-interaction/` uses fixed seed
`resp-recap-1` (one G2 activation, two G3 activations). For each mobile
viewport and theme it begins with G2 collapsed, clicks the first recap
`Event log` anchor, and asserts all of the following before capture:

- the URL hash exactly equals the match+event target;
- the owning match changes from `aria-expanded=false` to `true`;
- the target is no longer below a `[hidden]` ancestor;
- the target is visible and its box is inside the viewport.

That proof passes **4/4** with the same zero-failure responsive and axe metrics.

The captures were generated against `next start` on port 3027 with
`LEADERBOARD_ENABLED=1` after a successful production build. Both mobile sizes
were visually inspected in light and dark; the recap stays within the Results
column with no clipping or compositor corruption.

## Validation

Measured after rebasing onto exact integration head
`3af456d6957d5203f93144bb94e6365ba9d75a6f`:

- focused factual recap: **10/10**;
- focused Results/first-load regression set: **26/26** across 3 files;
- root typecheck: **8/8** Turbo tasks;
- root lint: **5/5** Turbo tasks;
- root test: **8/8** Turbo tasks in 8m3.119s:
  - core: **423/423**;
  - data: **183 passed, 9 expected skips**;
  - DB: **161/161**;
  - marketing: **69/69**;
  - web: **1,257 passed, 1 expected skip**;
  - game-flow Playwright: PASS;
  - responsive shell tail: **218 metrics, 0 failures**;
- root production build: **4/4** Turbo tasks and **40/40** routes/pages;
  existing non-fatal Webpack circular-chunk and Edge/static-generation
  warnings only;
- generated-data check: PASS; **10,973** rating rows and compact artifacts
  reproduce without a committed diff;
- repository Prettier check: PASS;
- scoped production browser layout proof: **4/4**, zero axe, console,
  horizontal-overflow, small-target, or navigation-wrap failures;
- scoped event-log interaction proof: **4/4**, the same zero-failure metrics,
  and every hash, expansion, hidden-state, visibility, and viewport assertion
  passed.

The inherited S5 integration tip also completed GitHub Actions run
`29300799853` successfully at exact SHA `3af456d6957d5203f93144bb94e6365ba9d75a6f`,
including realism, ETL, DB, secrets, and required aggregate gates.

Superseded diagnostic: an early full web run completed Vitest (1,242 passed,
1 expected skip) and game flow, then was invalidated in the mode-setup
responsive phase when the in-progress hidden-panel CSS correction triggered a
dev-server navigation during `page.evaluate`. No pass is claimed from that
mixed-head run; the exact post-rebase full gate is required.

## Scope and risk

No rating, offer, engine, RNG, simulation, Synergy, manager semantics, token
codec, auth, leaderboard validation, schema, ETL, compact data, or generated
runtime artifact changed. The only behavioral extension outside the new recap
is that persisted availability events now appear in the already-existing match
event detail, providing a real target for the recap's event-log links.

Carryover: arranged-XI starter fit remains unavailable until a future versioned
persisted fact exists. This is surfaced explicitly rather than recomputed.
