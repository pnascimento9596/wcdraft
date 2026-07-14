# Season 2 S5 — pre-lock fit teaching

## Outcome

Implemented locally on `ws-f4/season2-s5-fit-teaching` from the exact pinned
integration head `cdf16b4f7f795302cc44106c58626383dd56c9e7`. This YELLOW unit
is not merged or shipped. PR CI and the orchestrator-owned integration merge
remain outstanding; merging the integration branch to `main` remains a
separate production action.

## User-visible behavior

Classic, Open Draft, and Daily now render one compact teaching chip on every
visible player choice. The chip names the target line and that card's projected
contribution in the slot the lock action would currently use, for example
`MID +2.3 pre-Synergy`. An off-natural assignment adds explicit context such as
`DF → CM · reduced fit`; a severe mismatch says `severe fit penalty`. Target
line shape follows the existing position-shape language. There is no modal,
animation, or new interaction.

The chip fails closed when its inputs are not public. Memory and Blind Open do
not render it, a rating-blinded view cannot produce it, and manager choices
have no chip API or markup. The configured rating basis is preserved at the
existing adapter boundary: Career views project Career channels and Current
views project Current channels.

## Architect-delegated decisions

1. **Exact display mapping.** The engine-exported
   `projectSlotContribution` remains the only fit/channel calculation. S5 maps
   its internal compatibility-weighted target channel to one card's fixed-XI,
   pre-Synergy line contribution by dividing by 11. Only that display-scale
   value is rounded, to one decimal. The internal raw score never crosses the
   view-model boundary. Rounded equality is presented as an honest tie; the
   mapping cannot invert engine ordering.
2. **Basis authority.** S5 accepts `PlayerCardView`, not runtime ratings. The
   existing adapter therefore remains the sole Career/Current selector and S5
   cannot accidentally reach around the configured basis.
3. **Slot authority.** A selected candidate's manual slot is first, a
   position-first locked target is second, and candidate-specific default lock
   context is third. The default is the same extracted resolver now used by
   the real lock path: prefer an open starter while one exists, then maximize
   canonical compatibility with stable squad order as the tie-break.
4. **Fit language.** Compatibility `1` is natural, `0.75.. <1` is reduced,
   and `<0.75` is severe. These labels expose the graduated engine fit already
   governing the projection; they do not introduce legality or a new score.
5. **Manager boundary.** Manager choice remains deliberately unscored. The
   engine has no equivalent player slot-contribution contract for a manager,
   so inventing a parallel number would violate the honesty requirement.

## Implementation inventory

- `apps/web/lib/game/fit-teaching.ts` — pure mode gate, shared default-slot
  resolver, slot-context resolution, and the minimal engine-to-display mapper.
- `apps/web/components/game/draft-screen/index.tsx` — wires each visible
  candidate to its current honest slot context and reuses the same default
  resolver for locking.
- `apps/web/components/game/candidate-card.tsx` — optional player-only chip
  markup, accessible full label, visible pre-Synergy qualifier, and fit copy.
- `apps/web/components/game/game-styles/draft-polish.module.css` and
  `apps/web/components/game/game.module.css` — token-based compact styles,
  established shapes, mobile wrapping, and selected-row contrast correction.
- `apps/web/lib/game/__tests__/fit-teaching.test.ts` — runtime-data projection
  parity, ordering, basis, context, mode, off-natural, and manager boundaries.
- `apps/web/scripts/verify-responsive-layout-browser.mts` — a deterministic
  off-natural Classic surface plus a per-surface viewport screenshot option,
  leaving other surfaces' full-page capture contract unchanged.

## Executable evidence

Focused S5 tests pass 11/11 in one file. They project every runtime player into
the same CM context under both Career and Current bases, compare every chip
value to the engine function's exact display mapping, and prove that display
ordering never inverts engine ordering. Separate tests pin adapter basis,
default/locked/manual slot precedence, visible Classic/Open/Daily markup,
absent Memory/Blind Open markup, off-natural copy/shape, and manager absence.

The final visual run used the successful root `next build --webpack` output
and an explicitly started `next start --hostname 127.0.0.1 --port 3027`
server. Before capture, `/play` returned HTTP 200 and `lsof` identified
`next-server (v16.2.9)` as the port 3027 listener. Its strict metrics file is
`docs/reports/season2-s5-fit-teaching-2026-07-13/playwright/responsive-fit-teaching-final.json`.
Across 8/8 cases it records zero horizontal overflow, zero undersized targets,
zero axe WCAG 2 A/AA violations, zero console errors, and the primary action in
the viewport.

| Surface                         | Viewport | Themes       | Evidence                                                                                      |
| ------------------------------- | -------- | ------------ | --------------------------------------------------------------------------------------------- |
| Classic pick, default contexts  | 390x844  | light + dark | `playwright/screenshots/fit-teaching-final-classic-pick-390x844-{light,dark}.png`             |
| Classic pick, default contexts  | 360x800  | light + dark | `playwright/screenshots/fit-teaching-final-classic-pick-360x800-{light,dark}.png`             |
| Selected `DF → CM`, reduced fit | 390x844  | light + dark | `playwright/screenshots/fit-teaching-final-classic-pick-off-natural-390x844-{light,dark}.png` |
| Selected `DF → CM`, reduced fit | 360x800  | light + dark | `playwright/screenshots/fit-teaching-final-classic-pick-off-natural-360x800-{light,dark}.png` |

Earlier development-server attempts were rejected after visible light-theme
capture corruption: the 390px default case rendered a black sticky-CTA region,
and a later off-natural case rendered a black header region. Those captures
were not represented as product evidence. All superseded files were removed;
the eight retained PNGs above were regenerated against the explicit
production server and visually inspected.

## Validation

- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/fit-teaching.test.ts`
  — 1/1 file, 11/11 tests.
- `pnpm --filter @wcdraft/web typecheck` — pass after verifying/materializing
  19 manifest-derived runtime files.
- `pnpm typecheck` — Turbo 8/8 tasks.
- `pnpm lint` — Turbo 5/5 tasks.
- `pnpm test` — Turbo 8/8 tasks in 7m52.918s: core 423/423; data 183 passed +
  9 expected skips; DB 161/161; marketing 69/69; web 1,244 passed + 1 expected
  skip across 115 passed files + 1 skipped file. The browser tails also pass:
  game-flow, then 218 responsive metrics with zero failures (desktop 84,
  mobile 56, interactions 40, mode setup 30, mobile nav 8).
- `pnpm build` — Turbo 4/4 tasks; Next generated all 40 pages/routes. The
  existing webpack circular-chunk and edge/static-generation warnings remain
  non-fatal.
- Strict production responsive evidence — 8/8 metrics, 0 failures on every
  measured accessibility, console, overflow, target-size, and CTA gate.
- `pnpm check:generated` — pass; 10,973 rating rows reproduced and the data
  package build typecheck completed.
- `git diff --exit-code -- packages/data etl/output apps/web/public` — clean;
  validation/build materialization changed no generated, ETL, or public asset.
- `pnpm format:check` — pass after formatting only this report and the
  generated responsive JSON.
- `git diff --check` — pass.

Core/data/leaderboard goldens, the rating canary, heavy realism, and ETL gates
are not forced for S5: this diff changes no core calculation, rating, runtime
bundle, leaderboard behavior, engine/simulation semantics, ETL, or CI config.
The focused parity test instead executes the already-exported core projection
directly against real runtime cards.

## Risks and carryovers

- One-decimal display rounding can collapse close projections into a tie, but
  cannot reverse their ordering. The UI makes no finer-grained claim.
- `pre-Synergy` is explicit in visible and accessible copy because the chip is
  a slot contribution, not a prediction of the final amplified team line or a
  counterfactual match outcome.
- Bench contexts describe how that card projects into the engine-owned bench
  role's target line; actual availability activation remains event-dependent
  and is not predicted here.
- The deterministic supplemental visual case currently selects the seeded
  C. Gamarra card by accessible name. Runtime fixture renames should fail the
  evidence case loudly rather than silently capture the wrong state.
- No open product decision remains in S5. Merge order, PR CI, and integration
  landing remain orchestrator responsibilities.
