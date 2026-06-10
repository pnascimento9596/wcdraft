# ws-ux/mobile-polish-2 — tap stability, synergy visibility, screen compaction

Presentation-only wave (Yellow). No changes to the simulation engine, data bundles,
ratings, draft logic, leaderboard server code, or the `blindCardRatingView` seam.
Screenshots in `shots/` (390-wide mobile viewport, both themes).

## Item 1 — P0: first tap near LOCK PICK eaten by iOS Safari toolbar reflow

Root cause matches the owner's two screenshots (URL bar expanded vs minimized pill):
the page was sized against the **dynamic** viewport (`min-height: 100dvh` on
`.draftShell`/`.reviewShell`), so Safari's toolbar collapse on first interaction grew
the layout box and reflowed the page mid-tap.

- `.draftShell`/`.reviewShell` `min-height` → `100svh` (small-viewport box is stable
  across toolbar states; the lock bar itself was already `position: fixed; bottom: 0`
  with `env(safe-area-inset-bottom)` padding).
- `touch-action: manipulation` on `.lockBar` and its buttons (kills the double-tap-zoom
  tap delay).
- `vh` audit: the only classic-vh left was `.sheet { max-height: 75vh }` → `75dvh`
  (sheet must respect the live toolbar state, opposite trade to the shell). All other
  viewport units in app styles were already `dvh` and are intentionally untouched
  outside the draft shells.

**Manual verification required (CI cannot test this):** on a real iPhone (Safari
in-browser AND installed PWA): open a draft, scroll the candidate list up/down so the
toolbar collapses/expands, then single-tap LOCK PICK and CHOOSE SLOT from each state.
Each first tap must register (no dead first tap, no bar jump under the finger).
Verified in this lane via desktop emulation only: fixed bar flush at viewport bottom,
`touch-action: manipulation` computed on the bar.

## Item 2 — inactive synergy graph on the reveal pitch

`SynergyResult.linked_pairs` already carries the FULL formation adjacency (one row per
adjacent pair, `linked` flagging live edges) — so this is read-path-only:

- `buildSynergySegments` gains `includeInactive` (default false) emitting unlinked
  pairs as `{linked: false, nation_id: null}` segments; the defensive guards on ACTIVE
  edges are unchanged (a `linked:true` row with an unfilled endpoint can only ever
  render as inactive, never active — locked by a new test).
- `Pitch` gains `showInactiveEdges`, enabled on the Memory reveal and the review
  screen only; the in-draft pitch is untouched (no idle mesh while slots are empty).
- Idle line style: repurposed the previously-unused `.synergyLineIdle` —
  `color-mix(in srgb, var(--ink-300) 22%, transparent)`, 1px non-scaling, no glow.
  Idle lines paint below live emerald edges. Verified quiet-but-legible on BOTH themes
  (`reveal-pitch-dark.png` / `reveal-pitch-light.png`; light contrast checked against
  the post-#68 token ramp).

## Item 3 — mode-select compaction

Header subtitle + italic pool note merged into one lede line; the three feature
bullets per card are now single-line inline chips; card descriptions compacted to two
lines; tighter padding/type at ≤430px; `grid-auto-rows: 1fr` keeps both cards uniform
height. LIVE badge and START affordances kept.

Measured at 390×664 (Safari chrome accounted for): `modeGrid` bottom = **595px** in
both themes → header + both cards fully visible, zero scroll
(`mode-{dark,light}-390x664.png`).

## Item 4 — formation picker compaction + card-system unification

- Tiles are now horizontal: 56px mini-pitch (5/6 aspect preserved — no position
  distortion) left, name + lock CTA right; ~60–76px tall. All six shapes sit in the
  top third of one 390×844 screen (`formation-{dark,light}-390x844.png`).
- Blurb prose REMOVED from the tile (it truncated mid-sentence — noise without
  information). `FormationOption.blurb` stays in the data layer.
- Card-system unification with mode select: same 14px radius (12px ≤430px), 1px chalk
  border, 3px left accent bar, mono uppercase CTA. Cross-referenced comments on
  `.modeCard` / `.formationCard`. Selected/pending state keeps the high-contrast ember
  border + ring.

## Item 5 — manager "RATING UNAVAILABLE" pill removed everywhere

polish-1 removed it from the manager CANDIDATE ROW only; the `ManagerSlot` card kept
it and that card renders on draft, review AND the Memory reveal (the owner's Okada
screenshot). Surfaces checked (`rg -i "rating unavailable"` + every `ManagerSlot` /
`ManagerCandidate` call site):

- `manager-slot.tsx` (draft preview/committed, review, memory-reveal) — pill removed;
  draft-time preview keeps a plain "Preview" chip (that state IS information).
- `candidate-card.tsx` ManagerCandidate — already clean (polish-1).
- Share card / results / history — no manager rating-absence strings found.
- Stale honest-state comments updated (`manager-traits.ts`, `manager-slot.tsx`,
  `game.module.css`); the invariant is unchanged: managers carry no rating and we
  never fabricate one — absence is structural, so it is no longer labelled.

Verified live: 0 "rating unavailable" matches in the rendered reveal DOM, both themes.

## Item 6 — reveal outcome banner seam

Kept the editorial inverted plate (intentional brand contrast). Seam treatment:
hairline border in the plate's own ink (`currentColor` mix, works inverted in both
themes) + 1px outer ring against the page tone + card shadow, on top of the existing
emerald top rule and 14px panel radius. Reads as a designed insert rather than a
rendering glitch (`results-hidden-dark-top.png`, `results-classic-light-top.png`).

## Item 7 — safe-area / bench clipping

`.results` (the reveal/results scroll column) now ends with
`calc(12px + env(safe-area-inset-bottom))` padding. Terminal-element audit: draft /
review shells (96px lock-bar reservation), spin shell, sheet, share, history and
board screens already carry safe-area bottom padding — no other gaps found.

## Item 8 — player-list card accent consolidation

The gold top band was `.candRare::before` (rare-pick marker, ENGINE-V2 E-2) stacking
on the provenance left stripe. Consolidated to one accent axis per edge, per the
established encoding (provenance = left-edge hue; gold = pick/win moments):

- Rare in the list = inline gold "Rare" chip beside the name (with title text),
  matching the captain-chip pattern; the spin-stage rare glow + RARE MOMENT panel are
  untouched.
- Selected card keeps the full gold ring (`candRowSelected`) — the Souness treatment.
- The gold top band is gone; no information lost, and a rare card can now show its
  provenance stripe AND rare status without the double-bar collision.

Not screenshot-verified (rare spins are probabilistic); covered by markup/CSS review.

## Gates (all run in /tmp/mobile-polish-2, fresh worktree off 48d87c0)

- `pnpm --filter @wcdraft/web test` — 528 passed / 1 skipped (synergy-overlay suite
  extended +2 tests).
- Root `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green
  (core 302, web 528, data 50).
- Goldens: `test:golden test:golden:draft` (core), `test:golden:data
  test:golden:integration` (data), `test:golden:leaderboard` (web) — all green.
- ETL untouched.
