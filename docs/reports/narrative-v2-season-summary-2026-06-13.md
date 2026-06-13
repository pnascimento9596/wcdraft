# Narrative v2 Deterministic Expansion

Branch: `feature/narrative-v2`
Base: `origin/main` `88ae0c3b6294b3f35ca973371d59ce7ef42a1d6f`
Candidate engine stamp: `engine-2026.06.13`
Status: candidate only. No merge, deploy, or live production verification has
occurred for this branch.

## Scope

Narrative v2 expands the deterministic results narration inside `packages/core`.
It is not a live language-model feature and it does not call any server or
client-side generator at render time. The same run seed and match result bytes
select the same template family, variant, and entity slots.

Template count moves from 49 fallback templates to 99 total templates:

- 49 existing outcome-class fallback templates remain registered.
- 50 new scenario templates were added across 25 scenario families, two variants
  per family.
- Scenario templates are selected before fallback templates when their real
  event or lineup condition is present and outcome-compatible.

The lane intentionally does not change sim math, ratings, draft sampling,
synergy, schemas, scoring, or data bundle contents. The engine stamp moves
because `RunResult.narrative.template_id` and `filled_text` are replay-visible
bytes.

## Architecture - Narrative

The narrative path remains a pure derived layer:

1. `deriveNarrativeFacts(run, matches)` reads only `RunResult` plus typed
   `MatchResult` events and lineups. It derives scenario spotlights, key
   moments, top scorer, final hero, villain, nemesis team, and the narrative
   sub-seed.
2. `selectNarrativeTemplate(run, facts)` walks the ordered scenario spotlight
   list. Selection of a variant uses `facts.narrative_seed` plus the selected
   family name, so repeated runs are byte-identical.
3. `resolveNarrativeTokens(run, facts, labels, template)` fills the selected
   family slots. Missing entities resolve honestly to `Unavailable`; raw ids
   are used only when the display label map lacks a known name.
4. `buildNarrative(run, matches, labels?)` returns the persisted narrative
   payload: `template_id`, `narrative_seed`, and `filled_text`.

Priority is intentionally outcome-led:

- perfect 8-0 champion and shootout stories are highest priority;
- extra-time, comeback, and non-shootout elimination exits are next;
- player/event highlights such as hat-tricks, late winners, bench impact,
  defensive wall, midfield control, era spread, and debut-tournament core then
  compete by deterministic priority.

One implementation fix came out of real-sample probing: production
`RunResult.record` is W-D-L, so perfect-run detection uses
`wins === 8 && draws === 0 && losses === 0`; the `{RECORD}` token renders the
player-facing W-L display record.

## Surface Inventory - Results Narrative

Surface: `/play/results`, the narrative paragraph in
`apps/web/components/game/results-screen.tsx`.

Data owner:

- Core owns scenario detection, template selection, token semantics, and the
  persisted narrative payload.
- Web owns display labels only. `buildNarrativeLabels` now fills player names
  through `playerCardView(...).name` and manager names through
  `managerCardView(...).name`, preserving the surname-disambiguation seam.

Display contract:

- The selected `template_id` does not change when labels are supplied.
- Names come from actual event, lineup, draft, manager, or opponent records.
- If a slot cannot be resolved, the prose degrades to `Unavailable` or the raw
  id rather than inventing a player, stat, or event.
- The displayed record is W-L, matching the results summary surface.
- No static copy uses the forbidden product lexicon, and no new narrative prose
  uses official marks.

## Scenario Families

The committed family set is:

`dominant_blowout`, `narrow_one_nil`, `comeback_from_behind`,
`extra_time_winner`, `shootout_drama`, `clean_sheet_masterclass`,
`hat_trick_hero`, `multi_goal_hero`, `demolition_margin_four`,
`low_event_grind`, `manager_masterstroke`, `defensive_wall`,
`midfield_control`, `perfect_run_milestone`, `elimination_heartbreak`,
`era_clash`, `debut_tournament_core`, `bench_impact`, `cross_era_matchup`,
`final_hero`, `early_breakthrough`, `late_winner`, `red_card_resilience`,
`penalty_miss_redemption`, `keeper_penalty_save`.

No lower-aggregate upset or xG claim was added because the current
`MatchResult` contract does not expose those facts. The replacement families
are event-derived and do not fabricate unavailable signals.

## Sample Narratives

These samples were generated from the real compact-data bundles and real match
engine after applying display labels. They are samples for approval review, not
additional committed fixtures.

### Perfect 8-0

Seed: `wcdraft:narrative-v2-perfect-strong:215`
Draft policy: legal strong-picker over the real draft catalog using
`createDraft`, `pickManager`, and `pickPlayer`; the default auto-draft namespace
`wcdraft:narrative-v2-sample:0..11999` did not produce a perfect 8-0.
Template: `scn_perfect_run_milestone_01`
Record: `8-0-0` raw, `8-0` displayed

Narrative:

> Perfect really means perfect here: 8-0, trophy won, and no result left to
> explain away. Messi closed the final against Belgium; Messi carried the
> threat through the whole run.

Path: G1 3-2, G2 2-1, G3 1-0, R32 6-1, R16 0-0 win, QF 2-0, SF 2-1, F 1-0.

### Shootout

Seed: `wcdraft:narrative-v2-sample:18`
Draft policy: default auto-draft over the real draft catalog
Template: `scn_shootout_drama_02`
Record: `1-1-2` raw, `1-2` displayed

Narrative:

> In the round of 32, the match went all the way to penalties, where it shrank
> to breath, boots, and nerve. The shootout finished 2-4, with L. Millar in the
> sequence.

Path: G1 0-0, G2 1-0, G3 0-3, R32 0-0 after extra time, penalties 2-4.

### Elimination

Seed: `wcdraft:narrative-v2-sample:0`
Draft policy: default auto-draft over the real draft catalog
Template: `scn_elimination_heartbreak_01`
Record: `0-0-3` raw, `0-3` displayed

Narrative:

> The exit came in the decisive group match, and it came with a scoreline that
> will sit badly: 3-4. Doudera was the name on the other side of the heartbreak.

Path: G1 0-3, G2 0-4, G3 3-4.

## Golden Relocks

Narrative v2 relocks narrative bytes only:

- `packages/core/src/narrative.golden.test.ts` now pins all 25 scenario
  families with explicit full narrative payloads.
- `packages/core/package.json` wires `src/narrative.golden.test.ts` into
  `@wcdraft/core test:golden`.
- `packages/data/test/fixtures/e2e-real-run-golden.json` moves the real-data
  E2E narrative from an old fallback template to `scn_elimination_heartbreak_02`.
- `packages/data/test/fixtures/era-presets-golden.json`,
  `packages/data/test/realism/strategic-pick-canary-golden.json`, and
  `apps/web/lib/leaderboard/__tests__/fixtures/leaderboard-validate-golden.json`
  move from `engine-2026.06.12` to `engine-2026.06.13`.

Compact data was rebuilt. `draft-pool.compact.json` and
`scenario-2026.compact.json` hashes stayed unchanged; only the manifest stamp
and manifest-derived size report moved.

## Validation Log

Completed:

- `pnpm --filter @wcdraft/core exec vitest run src/narrative.golden.test.ts` -
  64 passed.
- `pnpm --filter @wcdraft/core exec vitest run src/narrative.golden.test.ts src/sim.golden.test.ts` -
  117 passed.
- `pnpm --filter @wcdraft/data test:golden:integration` - 22 passed.
- `pnpm exec turbo run test:golden test:golden:draft test:golden:data test:golden:integration test:golden:leaderboard` -
  9/9 tasks passed:
  core golden 67, draft golden 40, data golden/data 31, integration 22,
  leaderboard golden 6.
- `pnpm exec turbo run typecheck lint test build` - 19/19 tasks passed:
  core test 366, data test 65 passed / 7 skipped, db test 79, web test
  665 passed / 1 skipped, marketing-x test 64; web build passed with the
  existing Next/Webpack circular chunk warnings only.
- `pnpm --filter @wcdraft/data test:realism:heavy` - 7 passed.
- `git diff --check` - clean.
- `pnpm exec prettier --check $(git diff --name-only -- '*.ts' '*.tsx' '*.json' '*.md')` -
  clean.
- Changed-line lexicon/IP grep across new prose/templates - no matches.

Required before approval:

- independent Red review in a fresh clone/worktree;
- exact published head SHA posted in the PR/approval handoff.
