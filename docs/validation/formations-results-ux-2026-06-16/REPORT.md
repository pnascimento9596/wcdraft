# ws-f4/formations-results-ux — YELLOW UI/UX wave (2026-06-16)

Formation lock-page redesign + two new formation shapes + results-page redesign.

## Part A — Formations

**A1 — two new shapes (the one gameplay-data item):**

- `4-1-4-1` (GK · 4 DF · 1 DM · 4 MF · 1 FW) and `3-4-2-1` (GK · 3 DF · 4 MF · 2 AM · 1 FW)
  added to `packages/core/src/types/formation.ts` `FORMATION_TEMPLATES`. Both use only
  existing `SlotPosition` roles — **no new slot-role lookup entries were needed**
  (`slotPositionLine` and `POSITION_COMPATIBILITY_FACTORS` already cover every role used).
- `FormationSchema` already accepts both (3-or-4 parts summing to 10); the draft state
  machine, best-XI, synergy adjacency, and sim all key off `FORMATION_TEMPLATES[id]`, so
  the additions flow through unchanged.
- Adjacency re-locked in `formation-adjacency.golden.test.ts`: hand-written
  `EXPECTED_ADJACENCY` fixtures added for both shapes (derived from the documented rule and
  cross-checked by the test's independent rule-satisfaction + canonical/sorted/endpoint
  structural assertions). Count guard updated 6 → 8.
- **New validity proof** `packages/data/test/new-formations-validity.test.ts`: for each new
  shape, on REAL compact data — `autoDraft` → fieldable XI with exactly one recognised GK →
  `DraftState` schema clean → full `runTournamentFull` → completed, schema-valid `RunResult`
  - `MatchResult[]`. (8 tests; not a byte-pinned golden — asserts seed-independent
    invariants.)
- Web exposure: `SUPPORTED_FORMATION_IDS` + `FORMATION_BLURBS` extended (now 8);
  `/public/brand/formations.json` mini-pitch rows added (index-aligned to core slots);
  `formation-layout.test.ts` updated (8-id order; the two ids promoted out of the
  unsupported tripwire list).

**A2 — picker redesign:**

- Removed the emerald left-accent rail (`border-left: 3px solid var(--accent)`).
- Calm equal vertical tiles: 1px border + soft elevation, no coloured side-rail. Mini-pitch
  enlarged (56→92px base / 78px mobile) as the visual focus; formation id is the hero label;
  emerald is reserved for the `LOCK THIS SHAPE` CTA + hover/focus ring (interaction only).
- Position=SHAPE preserved in the mini-pitch (GK □ / DF △ / MF ◇ / FW ○).
- DRAFT SETUP disclosure unchanged. 44px targets (cards are full tiles). Dark+light parity.

## Part B — Results page

- **B1 fonts:** results surface is now SANS throughout — base family `Sora`
  (`--font-sans`), big numbers/headers `Saira Condensed` (`--font-condensed`). Both loaded
  via `next/font` in `layout.tsx` (new vars; Newsreader usage elsewhere untouched).
  Narration is upright Sora, not serif.
- **B2 contrast:** the outcome plate INVERTS the page theme (dark plate in light theme,
  cream plate in dark theme). Raw emerald failed AA on the cream plate. Fixed: eyebrow + W–L
  now use the plate's own ink (`currentColor`); the decorative strip is gold (canonical), not
  emerald; `.matchTag` moved off raw emerald to a neutral chip; the gold perfect-run record
  got a 1px ink edge so it clears AA on the cream plate too. **axe: 0 violations both themes.**
- **B3 overflow:** narration wraps cleanly (`overflow-wrap: anywhere`); match rows truncate
  — round label + opponent name ellipsis, score/chevron never shrink — so "vs ENG England"
  and long narration no longer spill.
- **B4 top-scorer flag:** `TopScorerView` gained `nation_id/code/name` (resolved via the
  same card→nation path as starters/bench); rendered with `MiniNationFlag`, which owns the
  honest fallback (real flag → nation-code chip → "-"). Null nation → no flag, never a wrong
  one.
- **B5 redesign:** cleaner hero (eyebrow · gold strip · scoreline · W–L · config badges),
  legible 4-up stat grid (Scored / Conceded / Top-scorer+flag / Shootout-wins), muted
  shootout/placement chip, truncating match list — coherent and on-brand in both themes
  (gold for win/legend, emerald for interaction only, sans throughout). All within existing
  run data; no invented stats.

## Validation

- `pnpm typecheck` — PASS. `pnpm build` (turbo, 4/4) — PASS.
- Core: 376/376 (incl. re-locked formation-adjacency). Data: 82/82 (incl. 8 new
  formation-validity tests). Touched web units (formation-layout, results-adapters,
  config-badges, full-path-final, era-config): 60/60.
- axe-core 4.10.2 (wcag2a/2aa/21a/21aa): **0 violations** — picker light+dark, results
  light+dark.
- Screenshots: `screens/` — picker + results, 390×844 + 360×800, both themes.

### Honest carry-overs / notes

- The match outcome W/D/L badge palette (loss = emerald fill) is pre-existing and passes AA
  (emerald fill + dark ink); left unchanged to avoid scope creep + new AA risk. It is the one
  remaining decorative-emerald spot on results; flagged, not changed.
- Adjacency fixtures for the two new shapes were generated from the rule's own derivation and
  validated by the test's independent structural assertions (rule-satisfaction, canonical
  form, real endpoints) — same validation a hand-enumeration would receive.
