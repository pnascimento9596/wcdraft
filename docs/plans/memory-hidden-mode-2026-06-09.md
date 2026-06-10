# wcdraft — Memory (Hidden) Mode — Build Plan

Yellow, UI-only. The data layer is ALREADY plumbed: DraftState.mode: 'classic' | 'hidden' is typed; mode rides
the t1. token's `md` field, replay, and saved-run; the engine has ZERO mode branches; no DB migration. This
activates the second mode on the surface.

## Premise
In hidden mode the draft hides all rating SIGNALS during draft + review, so the player picks on football
knowledge (recognizing who/when), not on a visible OVR. Everything reveals after Simulate. The premise only
pays off on accurate ratings (someone who knows Maldini-1990 is elite must be rewarded) — which is why it
builds on merit-v2.

## Blind set (hidden during draft + review, hidden mode ONLY)
- OVR, channels (ATT/MID/DEF/GK)
- Coverage (numeric %, bars, expanded detail) — coverage is rating-confidence metadata, so it rides the blind
  set (Lead-Architect amendment, 2026-06-09)
- The legend gold treatment — blind it via the #56 badge seam (badge_kind), NOT a re-derived OVR≥96 check
- Provenance HUE (it leaks rating tier)
- Synergy NUMERIC (score, strength-mult, links-live count)

## Keep set (ALWAYS shown — these are how knowledge applies, not ratings)
- Player name, nation flag, World Cup year
- Position SHAPE (GK square / DF triangle / MF diamond / FW circle) — identity, not a rating
- Position-fit / compatibility numerics (slot fit %, assignment-sheet %, validation-warning compatibility
  values) — VERIFIED: `positionCompatibility` (packages/core/src/engine/compatibility.ts) is a pure
  MAX-of-eligibles table lookup over (player eligible positions × slot line); NO rating/channel/quality input
  feeds it, so it is derivable from the visible position shape (Lead-Architect amendment, 2026-06-09)
- Settled spin-stage player-pool count — structural depth info, no rating signal (Lead-Architect amendment,
  2026-06-09)
- The spin (country, year) + the RARE moment
- Synergy LINKS (lines between filled same-nation slots) — structural, derivable from visible flags; only the
  numeric hides
- Formation pitch, slot assignment, squad counter, honest "—" states

## Architecture rule (replaces "no mode conditionals in components")
- Rating-masking logic exists ONLY in `blindCardRatingView` (apps/web/lib/game/view-models.ts).
- Screen-level `draft.mode === 'hidden'` branches are permitted SOLELY for plumbing: threading
  `{ blindRatings }` through adapter calls, sort default/options, and MemoryReveal mounting (incl. the
  Memory-mode note copy). Never for rating derivation, masking, or badge logic.
- Leaf presentational components stay mode-free — they render honest-null props ("—" / empty bar) and never
  read `draft.mode`.
- Aggregates (e.g. squad-average OVR, per-line strengths) blind by aggregating over `blindCardRatingView`-folded
  views via the adapter `{ blindRatings }` opts — the masked null comes out of the seam, not a screen ternary.

## Compliance notes — post-merge fix-pass (ws-ux/seam-and-quota)
- `lineStrengthViews(idx, draft, opts?)` now mirrors `squadAverageOverall`: every channel folds through
  `ratingView(...)` (the single `blindCardRatingView` seam). Under blind, per-line `value` is honestly null and
  the screen renders the row list unconditionally — no real channel averages are computed or held in React
  state pre-reveal. `count` (filled-starter count) stays visible so labels render in both modes.
- The review-screen "Rating by line" panel is no longer guarded by a `blind ? null : <list>` ternary. The
  Memory-mode note still renders above the list under blind for honest copy.
- Persistence-warning surfacing: the standalone spin stage has no DraftAppBar, so the volatile-storage
  warning ("Draft is saved in this tab only") now renders inline above `<SpinStage>` whenever
  `persistenceWarning` is truthy. One line, centered, no layout regression on the compact density bar.

## Reveal (post-Simulate)
- Reveal the full blind set via a thin MemoryReveal wrapper around the existing surfaces (do NOT overload
  SynergyBar). Auto-expand; prefers-reduced-motion → instant (no animation).

## Resolved decisions
- Share/replay of a hidden run REVEALS on web (the sim already ran). `md` rides the t1. token; a hidden-mode
  replay reconstructs + reveals.
- NO feature flag: the Memory option surfaces only when fully wired (completeness gate — MEM-2 lands last).

## Work items
- MEM-1 mode toggle on Mode-select (Classic ships; add Memory) → DraftState.mode='hidden'.
- MEM-2 draft-screen blinding (candidate cards + picked nodes): blind set hidden, keep set shown. LANDS LAST
  (completeness gate).
- MEM-3 review-screen blinding (SynergyBar numerics + line strengths + OVRs hidden; pitch + identities + links
  shown).
- MEM-4 reveal: MemoryReveal wrapper; post-sim reveal; prefers-reduced-motion instant.
- MEM-5 share/replay + saved-run: `md` rides the t1. token; hidden-run replay reveals on web; saved-run carries
  mode.

## Scope / gates (Yellow)
- Frontend only (apps/web). No engine change, no schema change, no DB migration, no rating/sim change.
- The blind is DISPLAY-ONLY — the sim still consumes the real channels. Hidden mode changes what the USER
  sees, NEVER what the sim computes. Honest-state preserved.
- Determinism: a hidden run and a classic run from the SAME seed produce BYTE-IDENTICAL sim results (mode is
  display-only) — assert this with a test.
- typecheck + lint + component tests; screenshots @ 390×844 + 360×800 in BOTH modes (classic unchanged; hidden
  blinded; post-reveal correct).
