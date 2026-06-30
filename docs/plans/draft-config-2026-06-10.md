# Draft Config - Deep Plan (RED planning phase)

**Date:** 2026-06-10
**Branch:** `ws-plan/draft-config` off `origin/main` at `dbc1f0a`
**Status:** historical design with current amendments. DC-1 token/config schema,
DC-2 era presets, DC-3 Position First, DC-4 setup/badge/copy polish, and
selected-basis runtime exposure have shipped. DC-8 was dispatched on
2026-06-17 as a Red per-config leaderboard lane: both casual and ranked accept
every legal config, and ranked remains account-required but per-config.

This plan adds pre-draft configuration on top of the existing Classic / Memory
mode select:

- **Draft mode:** `Squad First` (today: spin squad -> pick entity -> choose slot)
  or `Position First` (choose target slot -> spin squad -> fill that slot).
- **Rating basis:** `Career` or `Current`. Owner naming is pinned here:
  `Career` means career-best / full-career stature; `Current` means
  at-that-World-Cup-year strength. Do not call the second axis "Prime".
- **Era filter:** preset year windows over the spin pool. v1 uses presets only;
  no free range slider in v1.

The repo is the authority over this plan. Required source reading was
completed against the branch above: `CLAUDE.md`, `docs/plans/f4-leaderboard-2026-06-10.md`,
`docs/reports/mv212-ratings-audit-2026-06-10.md`,
`docs/reports/mv212-face-validity-2026-06-10.md`,
`docs/queue/q-002-mv2-12-candidate.md`, and the live token, draft,
rating, sim-calibration, leaderboard, and Memory-mode code paths. I could not
find a repo file literally named "Architecture & Data Contract v4"; the
matching contract sections are currently distributed across `apps/web/lib/game/run-token.ts`,
`packages/core/src/types/draft.ts`, `packages/core/src/draft.ts`,
`packages/core/src/types/rating.ts`, `packages/core/SIM_CALIBRATION.md`,
`etl/RATING_METHODOLOGY.md`, and `etl/RATING_METHODOLOGY_2026.md`.

## Repo Facts This Plan Depends On

- `t1.` tokens carry `{v,rid,fid,ps,tn,md,pl,sv,dv,rv,ev,uv,hv}` and replay
  through `reconstructDraftFromToken`; `versionsAgree` is the strict six-anchor
  conjunction. Source: `apps/web/lib/game/run-token.ts`.
- Current draft state is a deterministic 17-spin state machine. Each spin is a
  with-replacement, era-weighted draw over `(tournament_id,nation_id)` pairs.
  Pre-1998 years get 10% aggregate mass only when both rare and modern eras
  are present; if a filtered catalog contains only one era, that era receives
  100%. Source: `packages/core/src/draft.ts`.
- A complete draft is 16 player picks plus exactly one manager. The manager
  occupies `DraftState.manager_card_id`, not a squad slot. Out-of-position and
  no-GK are soft warnings, not draft blockers. Source:
  `packages/core/src/types/draft.ts`, `packages/core/src/draft.ts`.
- `overall` is display-only. The sim consumes only `attack`, `midfield`,
  `defense`, and `goalkeeping`. Display curves reshape `overall` only; they
  must not be used to fix sim channels. Source: `packages/core/src/types/rating.ts`,
  `etl/src/wcdraft_etl/rating.py`, `etl/src/wcdraft_etl/rating_2026.py`.
- The realism gate measures a competent drafted-XI population through
  `strategicAutoDraft`, and the heavy gate is intentionally not multiplied
  over every UI mode. Source: `packages/data/test/realism/draft-policies.ts`,
  `packages/data/test/realism/realism.gate.test.ts`.
- F-4 season semantics derive from the six version anchors. DC-8 leaderboard
  storage now records `draft_mode`, `draft_order`, `era`, and `rating_basis` as
  exact filter columns. Source:
  `docs/plans/f4-leaderboard-2026-06-10.md`,
  `apps/web/lib/leaderboard/season.ts`,
  `packages/db/src/schema/leaderboard-entries.ts`.

## A. Token And Replay

**Decision: introduce `t2.` with `t1` decode compatibility. Do not extend
`t1.`.**

Reason: `md` was display-only. The new axes include two engine-affecting
surfaces (`draft_flow`, `era`) and one sim-input surface (`rating_basis`).
Overloading `t1.` would make old tokens and config-bearing tokens
indistinguishable at the schema boundary and would invite default inference in
the anti-cheat path. `t2.` gives the replay code a clean discriminator while
keeping old links honest.

`t1.` compatibility rule:

- A valid `t1.` token decodes as config:
  `{ md: token.md, draft_flow: "squad_first", rating_basis: "career", era_preset: "all_time" }`.
- If its six anchors match the receiving build, it must replay exactly.
- If any anchor differs, it is a normal stale/wrong-season token. The UI may
  say the run was made on a different data/build only because the six anchors
  prove that. It must not imply that all old `t1.` tokens are intrinsically
  unreplayable.

`t2.` body shape:

```ts
type DraftFlow = "squad_first" | "position_first";
type RatingBasis = "career" | "current";
type EraPresetId = "all_time" | "post_2000" | "post_2010" | "modern";

interface RunTokenV2Body {
  v: 2;
  rid: string;
  fid: string;
  ps: string;
  tn: string;

  // Existing Classic / Memory visibility mode.
  md: "classic" | "hidden";

  // New config axes. Preset carries resolved bounds so future label changes
  // cannot silently reinterpret old tokens.
  df: DraftFlow;
  rb: RatingBasis;
  ef: { id: EraPresetId; min: number; max: number };

  // 17 spin-index entries. Squad-first entries may omit target_slot_id because
  // the target is chosen after the squad reveal; position-first entries must
  // carry it and replay must select it before rolling candidates.
  pl: RunTokenPickV2[];

  sv: string;
  dv: string;
  rv: string;
  ev: string;
  uv: string;
  hv: string;
}

type RunTokenPickV2 = { k: "m"; ts?: "manager" } | { k: "p"; c: string; s: string; ts?: string };
```

For `df: "position_first"`, `ts` is required on every pick. Player picks must
have `ts === s`; manager picks must have `ts === "manager"`. Replay fails
loudly if a position-first token tries to pick into a slot that was not
selected before the spin. For `df: "squad_first"`, `ts` is optional and ignored
for replay compatibility.

Version-skew behavior by class:

| Token class         | Same anchors                   | Different anchors              | Bad/future schema              |
| ------------------- | ------------------------------ | ------------------------------ | ------------------------------ |
| local `run-v1-*` id | Local lookup only; not a token | Missing/stale local record     | Not applicable                 |
| malformed `t1.`     | `MALFORMED_TOKEN`              | `MALFORMED_TOKEN`              | `MALFORMED_TOKEN`              |
| valid `t1.`         | Replay as default config       | `WRONG_SEASON` / skew notice   | Not applicable                 |
| malformed `t2.`     | `MALFORMED_TOKEN`              | `MALFORMED_TOKEN`              | `MALFORMED_TOKEN`              |
| valid `t2.`         | Replay exact config            | `WRONG_SEASON` / skew notice   | Not applicable                 |
| future `t3.`        | unsupported newer-token notice | unsupported newer-token notice | unsupported newer-token notice |

Fuzz/test surface:

- Decode rejects unknown `df`, `rb`, `ef.id`, non-canonical `ef` bounds,
  missing `ts` on position-first entries, manager `ts` not equal to `"manager"`,
  player `ts !== s`, >17 or <17 picks, and oversized payloads.
- Anchor fuzz flips each of `sv,dv,rv,ev,uv,hv` individually for both `t1` and
  `t2`; every flip yields `WRONG_SEASON`, never replay.
- Compatibility property: a current-anchor `t1` fixture and the equivalent
  `t2` default-config fixture produce byte-identical `DraftState` and sim
  output.
- Config property: `t2` fixtures for `position_first`, `current`, and each era
  preset replay through the same public transition functions the live UI uses.
- PREV skew fixtures to commit:
  - existing previous-build valid `t1` token;
  - previous-build valid `t2` default config;
  - previous-build valid `t2` non-default config;
  - current-anchor `t2` with one config field tampered after encode.

## B. Era Filter x Sampling x RARE

**Decision: v1 ships four presets and no free range slider.**

Preset bounds:

| Preset    |    Bounds | Years included | Player cards | Manager cards | Squad pairs | Coarse eligible coverage                  |
| --------- | --------: | -------------- | -----------: | ------------: | ----------: | ----------------------------------------- |
| All-time  | 1930-2026 | 23 tournaments |       12,219 |           501 |         537 | GK 1,547 / DF 3,875 / MF 3,994 / FW 3,317 |
| Post-2000 | 2002-2026 | 7 tournaments  |        5,757 |           193 |         240 | GK 724 / DF 1,933 / MF 1,979 / FW 1,323   |
| Post-2010 | 2014-2026 | 4 tournaments  |        3,549 |            96 |         144 | GK 436 / DF 1,189 / MF 1,204 / FW 835     |
| Modern    | 2018-2026 | 3 tournaments  |        2,813 |            64 |         112 | GK 340 / DF 945 / MF 928 / FW 680         |

Measured from `packages/data/src/generated/draft-pool.compact.json` on this
branch. Every v1 preset has enough pair depth and coarse position coverage for
a 17-spin draft. `2026-only` is explicitly invalid today: it has 1,246 player
cards and 48 squad pairs but **zero manager cards**, so it cannot satisfy the
complete-draft manager requirement.

Sampling rule:

- Build a filtered `DraftDataset` / `DraftCatalog` for the selected preset.
- With-replacement semantics stay unchanged.
- Year weighting is recomputed inside the filtered catalog using the existing
  algorithm:
  - both rare and modern years present -> pre-1998 aggregate mass 10%, modern
    aggregate mass 90%;
  - rare empty -> modern aggregate mass 100%, no RARE class;
  - modern empty in a future range -> rare aggregate mass 100%; the UI must
    call this a pre-1998 pool, not pretend it is a 10% "rare" surprise.

Draw-probability display:

- Keep `Spin.draw_probability` as the source of truth. It already includes
  deterministic depletion-advance weight.
- The spin reveal displays the selected era preset and the effective
  probability. For all-modern presets, do not show a "Rare 0%" badge; the
  honest copy is "Modern pool".
- For all-time, keep the RARE moment copy because pre-1998 really is a 10%
  class in the configured pool.

Golden strategy:

- Use one parameterized committed fixture containing one deterministic draft
  per preset, rather than four unrelated golden files. This keeps diffs
  inspectable while proving all preset catalogs.
- Add analytic tests for era mass split in each preset (`0.10/0.90` for
  all-time; `0/1` for the all-modern presets).
- Add a real-data preset census test locking player cards, manager cards,
  pairs, and coarse eligible counts. This catches accidental range drift or
  2026 manager backfill changes that affect validity.
- Keep the existing default e2e golden on all-time. Add a lighter e2e smoke
  for `modern` to prove filtered catalogs still produce complete, replayable
  drafts without multiplying full e2e fixtures across every preset.

## C. Position-First State Machine

**Decision: Position First is a core state-machine mode, not just UI order.**

Reason: the user commits the target slot before seeing the squad. If the
engine merely lets the UI ask for a slot first while persisted state already
contains all candidate squads, the token cannot replay the commitment boundary
and the mode is only cosmetic.

State-machine delta:

- `DraftState` gains a draft-flow field: `"squad_first" | "position_first"`.
  The default is `"squad_first"`.
- `Spin` gains target-slot state for position-first:
  - `target_slot_id: string | "manager" | null`;
  - a lifecycle equivalent to `awaiting_slot -> pending -> picked` for
    position-first spins. Squad-first spins start at `pending` as today.
- New transition: `selectDraftTarget(catalog, state, slot_id)`.
  - Valid only for the active position-first spin before candidates are
    revealed.
  - The selected target is immutable once chosen.
  - The spin then consumes the normal spin-index RNG draw and rolls the squad.
- Existing `pickPlayer` / `pickManager` remain the pick transitions, but under
  position-first they must verify the pick matches the selected target.

What "spin for this slot" samples:

- The selected player slot does **not** change era weights and does **not**
  filter by rating or position. It uses the same era-weighted `(T,N)` squad
  draw as Squad First, then presents the rolled squad with the target slot
  locked.
- The selected slot changes presentation and assignment only:
  - candidate rows show compatibility against the locked target;
  - the lock action fills only that target;
  - sorting may default to target-fit within Classic, but Memory must not
    sort by any rating-derived signal.
- The manager is a selectable target named `manager`. Choosing it rolls a
  squad and exposes only that squad's manager candidate when present.

Manager and no-GK rules:

- At most one manager remains a hard rule. The manager target disappears after
  a manager is drafted.
- A complete draft still requires exactly one manager. The target selector
  must force or strongly gate the manager target when failing to take it would
  strand completion.
- No-GK remains soft. Selecting a GK slot does not hard-filter to GK cards.
  Outfielders can still fill GK with the existing compatibility warning and
  sim penalty; this avoids making old/modern thin squads silently impossible.

Dead-end handling:

- Normal player-slot spins should not dead-end: any unpicked player in the
  rolled squad is viable because position mismatch is soft.
- Manager target can be invalid for a range with no managers. That target is
  disabled before spin with an explicit message; this is why `2026-only` is not
  a v1 preset.
- If a selected target produces no candidate because of catalog corruption or
  a future free-range edge, the spin is **not consumed**. The UI shows a
  blocking "No candidate for that target in this configured pool" state and
  lets the user return to target selection. There is no automatic reroll and
  no hidden seed advance.

Golden plan:

- Core transition goldens for both flows from the same seed:
  - squad-first output remains byte-identical to today;
  - position-first records `target_slot_id` before each reveal and rejects
    out-of-target picks;
  - manager target cannot be picked twice;
  - strand guard forces manager when required;
  - no-GK remains warning-only.
- Token replay goldens for position-first must call `selectDraftTarget` before
  each pick and fail if token `ts` and final assigned slot diverge.

Memory-mode blind set against new UI:

- Target selector: allowed. Slot names, formation positions, empty/filled
  state, and compatibility shape are in the keep set.
- Candidate list after spin: must use the existing `blindCardRatingView` seam.
  No OVR, channels, coverage, legend gold, provenance hue, or basis badge.
- Sort controls: Memory may offer name and position/fit sorts only. No OVR,
  channel, badge, "recommended", or best-for-slot ordering if that ordering
  reads ratings.
- Target-fit percentages are allowed because `positionCompatibility` is a
  pure eligibility x slot-position lookup and is already in Memory's keep set.
- Draw probability and era label are allowed; they are sampling metadata, not
  rating strength.
- Share/replay of a Memory + Position First run reveals after simulation as
  Memory does today, but the draft replay must preserve the target-slot log.

## D. Rating Basis x MV2-12

**2026-06-12 update:** merit-v3 has now shipped the dual-basis runtime data
(`basis_ratings.current`) under `runtime-data-2.0.0`. The original decision
below still applies to product exposure: `rating_basis: "current"` must remain
disabled until selected-basis sim inputs, canaries/goldens, and leaderboard
policy are dispatched and reviewed as Red work. No fake fallback to Career.

**Original decision: the `rating_basis` axis is sequenced after MV2-12b lands.**

This is load-bearing. MV2-12 audits found that the current career-stature path
and the at-tournament / active-career paths are not cleanly separable enough
to expose as a product toggle:

- Audit-1 confirmed active-career recognition absence and youth double penalty.
- Audit-2 added a P0 identity-link defect for 17 minted 2026 cards and an
  within-archive era/eligibility bias. `q-002` now says a small Red link-seam
  fix belongs before or alongside 12b.

Therefore:

- `Career` / `Current` copy and token schema can be designed now.
- Runtime exposure of `rb: "current"` is gated on the selected-basis sim and
  leaderboard-policy work, even though merit-v3 now emits Current rows.
- No implementation unit may fake Current by reusing today's `overall_basis`
  or by suppressing career badges only.

Materialization on top of 12b:

- ETL emits per-card dual internal ratings:
  - `career`: career-best / full-career stature for this player card;
  - `current`: at-that-World-Cup-year strength for the card's tournament year
    or for 2026's current projected tournament context.
- Each basis materializes the full sim-consumed rating shape:
  `{overall, attack, midfield, defense, goalkeeping, coverage, components, basis_metadata}`.
- Runtime data exposes a basis-aware rating lookup, e.g.
  `ratingByCardIdByBasis.career` and `.current`. The old single
  `ratingByCardId` may remain as a compatibility alias to `career` until the
  feature fully flips.

Display curve decision:

- Use one shared display curve fitted over the union of both basis internal
  pools, not one curve per basis.
- Reason: toggling Career vs Current should not make the same internal score
  render differently just because the user changed basis. A per-basis curve
  would make OVR percentile-like within each basis and would blur the actual
  scale difference between "career strength" and "at this World Cup".
- The display curve reshapes `overall` only. Channels remain independently
  materialized from the selected basis and never pass through the display curve.

Sim-input decision:

- The sim consumes the selected basis channels. This is not display-only:
  Career-basis Maldini plays at career strength; Current-basis Maldini plays
  at his at-that-WC-year strength.
- Use a shared lambda tuple validated against both bases. Do not introduce
  per-basis lambda in v1.
- Reason: per-basis lambda makes the config axis an engine-constant axis,
  doubles calibration artifacts, complicates token replay, and makes
  leaderboard comparison harder. A shared tuple is simpler and honest: if the
  same engine cannot clear realism for both basis populations, the basis axis
  is not ready to ship.

Calibration cost:

- Existing heavy realism is roughly 3-7 minutes per run depending on machine.
- Basis introduction requires at least two heavy validations:
  `career` and `current` under the canonical all-time Squad First policy.
- If either fails, rerun `fit-calibration.mjs` once for a shared tuple that
  satisfies both basis populations, then re-lock both basis landings atomically.

Canaries and goldens:

- Strategic-pick canary multiplies by basis because `overall` tie-breaks in
  the realism harness can flip when display OVR changes. Keep the seed count
  small but basis-explicit.
- E2E real-run golden remains default Career. Add a Current e2e smoke fixture
  after 12b to prove selected-basis channels feed the sim.
- Compact integrity tests must assert every draftable card has sim channels
  for every shipped basis, or is explicitly excluded from that basis' pool.

Legend band and badge behavior:

- Career basis may show source-derived Legend / career-stature badge.
- Current basis suppresses career-stature/Legend gold as a rating badge,
  because it leaks the other basis and misstates the at-tournament premise.
  Current can still show tournament awards and identity facts that belong to
  the card/year.
- Memory hides all rating badges in both bases through the existing blind seam.

Undefined basis honest-state:

- No fallback from missing Current to Career or Career to Current.
- If selected-basis sim channels are missing, the card is not draftable in
  that config and the pool-depth census must count the exclusion.
- If selected-basis `overall` is missing but sim channels exist, Classic renders
  `overall` as unavailable and the sim may still run; Memory remains blinded.
- Any preset whose selected-basis pool cannot complete 16 players + 1 manager
  is invalid and cannot be offered.

## E. Combinatorics And Validation Budget

Naive matrix: Classic/Memory x Squad/Position First x Career/Current x
4 era presets = 32 user-visible configurations. Do not multiply the heavy
realism gate by 32.

Orthogonal-by-construction axes:

- **Classic vs Memory:** view seam only. Existing tests prove same seed gives
  byte-identical draft and sim except `md`. New config work only needs leak
  tests for the added UI controls and token round-trip; no per-config sim gate.
- **Share badge/copy:** view-only once token replay is proven.

Axes that change core output:

- **Era preset:** changes sampled `(T,N)` pool. Needs core sampling goldens for
  every preset and one heavy realism stress run for the most shifted legal
  pool (`modern`).
- **Draft flow:** changes state transitions and the likely user-picked XI.
  Needs transition goldens and one heavy realism run for Position First under
  canonical era/basis.
- **Rating basis:** changes sim channels. Needs heavy realism for Career and
  Current, and basis-specific strategic canaries.

CI heavy matrix recommendation:

| Config                                       | Why it gates                                 |
| -------------------------------------------- | -------------------------------------------- |
| Classic + Squad First + Career + All-time    | Existing default; must stay today's behavior |
| Classic + Squad First + Career + Modern      | Era extreme stress                           |
| Classic + Position First + Career + All-time | Draft-flow stress                            |
| Classic + Squad First + Current + All-time   | Rating-basis stress after 12b                |

Estimated wall time if parallelized as separate CI jobs: still about 3-7
minutes wall-clock, with 4x runner-minute cost. Serial execution would be
about 12-28 minutes and should be avoided. If Current + Modern has a large
channel/population interaction during implementation, add it as a release
candidate manual gate, not as an always-on CI multiplier unless it catches a
real regression class.

Per-release QA matrix:

- Fast unit/render/token tests over all 32 configurations.
- Core draft goldens over both flows x four era presets.
- Token replay goldens over default `t1`, default `t2`, and one non-default
  `t2` for each changed engine axis.
- Heavy realism matrix above.
- Browser smoke for:
  - default config equals today's path;
  - non-default config summary before formation lock;
  - Position First target selection;
  - Modern era no RARE copy;
  - Memory hides every new rating/basis affordance.

## F. Leaderboard And Season Semantics [HUMAN]

Historical note: F-4 originally treated seasons as the equivalence class of the
six version anchors. That was superseded on 2026-06-29 by the explicit aggregate
season id policy; version-anchor checks remain only the submit-time runtime
compatibility gate.
Config axes fragment competitive fairness because they change the pool, the
state machine, and the sim channels.

**2026-06-17 owner decision:** use per-config boards for both lanes. Every legal
config posts to its exact board for casual and ranked. Ranked still requires a
signed-in account, but the single canonical ranked ladder no longer exists.
The default landing remains canonical for familiarity:
Classic + Squad First + Career + All-time.

Selected policy: config is a board partition, not part of the season key.

- Board partition key: `{mode, draft_mode, draft_order, era, rating_basis}`.
- Pros: every board is fair by construction; server replay reproduces config
  directly from `t2`; anti-cheat stays clean; old season logic remains the
  six-anchor season key.
- Cons: up to 32 boards per season before ranked/casual, sparse traffic, noisy
  board UX, and more "why is my score not on the main board?" confusion.

Anti-cheat implication:

- Server replay must decode `t1`/`t2`, reconstruct the exact config, reject
  stale anchors with `WRONG_SEASON`, and persist only the replay-derived config.
- The old canonical-config submit gate is removed. A `t1` token remains
  canonical by compatibility; a `t2` token posts to its own exact board.
- Memory ranked is `mode=ranked` + `draft_mode=hidden`; no standalone Memory
  ranked endpoint or separate lane model.

Board UX implication:

- `/leaderboard` exposes lane tabs and filters for Mode, Draft Order, Era, and
  Rating Basis. Filters are open by default on tab select.
- Empty configs say no runs exist for that config; no placeholder/fabricated
  rows.
- Rank copy must be scoped to the active lane+config. A single unfiltered ranked
  rank would be dishonest.

## G. Defaults, UX, And Migration

Defaults:

- `md = classic` unless the player chooses Memory.
- `draft_flow = squad_first`.
- `rating_basis = career`.
- `era_preset = all_time`.

This equals today's shipped behavior. No player who configures nothing should
see a changed spin pool, rating input, replay path, or sim result.

Pre-draft UX:

- Do not regrow the compact mode-select page.
- Keep `/play` as the two-card Classic / Memory decision.
- Put the new config on the formation-lock screen as a collapsed "Draft setup"
  summary row, defaulting to `Squad First · Career · All-time`.
- Tapping the row opens a compact bottom sheet / disclosure with three
  segmented controls:
  - Draft mode: Squad First / Position First;
  - Rating basis: Career / Current;
  - Era: All-time / Post-2000 / Post-2010 / Modern.
- `Current` is an enabled rating-basis axis only through the selected-basis
  runtime/sim path. The leaderboard must persist `rating_basis = current` from
  replayed tokens and must never silently fall back to Career.
- No free range slider in v1. The measured `2026-only` invalid case proves
  arbitrary ranges need dynamic manager and coverage validation before they can
  be safely offered.

Share/replay communication:

- Default-config links can stay quiet.
- Non-default `t2` links render a compact config badge on results/share/replay:
  e.g. `Position First · Current · Modern`.
- A recipient opening a non-default replay sees the badge before interaction,
  so they know the run did not use default pool/rules.
- If a token is stale by anchors, config badges may be displayed only after
  successful decode; no sim or rank is shown until anchors agree.

Migration:

- Existing `t1` links and saved runs decode as default config.
- New runs encode `t2` once any non-default axis is possible. It is acceptable
  to encode default new runs as `t2` too, but the compatibility tests must keep
  `t1` replay green.
- Local saved-run state should store config explicitly in `DraftState`; do not
  infer from URL query after formation lock.

## H. Unit Decomposition And Sequencing

All items below are **DISPATCH-ONLY**. Red units require fresh-session
independent review, SHA-pinned merge, deploy observation, live verification, and
auto-revert on failed live checks per `CLAUDE.md`; the docs-only planning PR
remains Green.

| Unit                       | Tier                | Status                        | Scope                                                                                             | Depends on          |
| -------------------------- | ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------- |
| DC-0 plan + queue          | Green docs          | Unblocked now                 | This plan, `q-006`, `STATE.md` note                                                               | none                |
| DC-1 token schema          | Red                 | SHIPPED                       | `t2` encode/decode, `t1` compatibility, fuzz/PREV skew fixtures                                   | DC-0                |
| DC-2 era presets           | Red                 | SHIPPED                       | filtered catalog input, preset constants, pool-depth census, era goldens                          | DC-1 preferred      |
| DC-3 position-first core   | Red                 | SHIPPED                       | target-selection state, token `ts` replay, transition goldens                                     | DC-1                |
| DC-4 config UX             | Yellow/Red boundary | SHIPPED for setup/badges/copy | formation-screen setup disclosure, share badges, Memory leak tests                                | DC-1..3             |
| DC-5 MV2-12 link seam      | Red                 | SUPERSEDED by merit-v3 U0     | fix 2026 identity-link misses called out by Audit-2                                               | q-002 dispatch      |
| DC-6 MV2-12b dual basis    | Red                 | SHIPPED by merit-v3 V6        | dual ratings, shared display curve, compact/runtime shape                                         | DC-5                |
| DC-7 rating-basis sim gate | Red                 | OPEN                          | selected-basis channels, shared lambda validation, canaries/goldens                               | DC-6                |
| DC-8 leaderboard policy    | Red                 | DISPATCHED 2026-06-17         | per-config ranked/casual boards, DB/API/board changes                                             | Paulo decision F    |
| DC-9 season merge          | Red                 | Final integration             | anchor bump, golden re-lock, full CI, independent Red review, SHA-pinned merge, live verification | DC-1..8 as selected |

Integration-branch decision:

**Yes, this wave warrants a draft-config integration branch under the
engine-season pattern.** Recommended name: `engine-draft-config` or
`season-draft-config`.

Justification:

- Era filtering and Position First change deterministic draft output and draft
  goldens.
- Rating basis changes sim inputs and likely calibration landings.
- Token `t2`, compact/runtime data, and leaderboard replay must land together
  or stay dark.
- A single integration branch allows one engine/data/rating anchor roll and
  one coherent golden re-lock at season merge, instead of shipping partial
  config semantics to production through `main`.

Implementation can still cut smaller PRs into the integration branch, but the
production merge should be one season-style merge after all selected axes are
reviewed and gated.

## Human Decision List

1. **Leaderboard policy:** resolved 2026-06-17. Both casual and ranked post to
   exact per-config boards; ranked remains account-required.
2. **Era slider:** default recommendation is **out of v1**. Presets only until
   dynamic range validation can reject invalid ranges such as `2026-only`.
3. **Rating-basis naming:** confirm UI labels exactly `Career` and `Current`.
   Copy pinned here: Career = career-best/full-career stature; Current =
   at-that-World-Cup-year basis. Never call Current "Prime".
4. **Integration branch name:** default recommendation `engine-draft-config`
   for implementation PRs, with one season-style merge/re-lock.
