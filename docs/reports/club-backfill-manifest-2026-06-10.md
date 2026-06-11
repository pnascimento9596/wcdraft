# Club-at-Tournament Backfill Manifest — staged for MV2-12b compact regen

- **Date:** 2026-06-10 · **Lane:** `ws-ux/club-coverage` (Yellow, UI + docs only)
- **Status:** STAGED — specification only. **No execution on this lane**; bundle bytes are
  byte-identical (hash evidence in the PR). Execution belongs to the MV2-12b compact-regen
  train (the next change that legitimately bumps the dataset anchor and invalidates live
  `t1.` tokens).

## Four-bucket census (measured 2026-06-10, bundle `runtime-data-1.1.0` / dataset 2026-06-04)

Population: 12,219 player cards in `draft-pool.compact.json`.

| Bucket                    |  Count | Definition / evidence                                                                                                                                                  |
| ------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Present-and-rendered      |  1,246 | All 2026 cards. `club_at_tournament` populated from the pinned Wikipedia 2026 squads revision (oldid 1357762108); rendered on the candidate-card metadata subline.       |
| Present-but-unrendered    |  **0** | `club_label` (adapters.ts) is the single seam; `candidate-card.tsx:142` renders it on every pick/lock-in surface (collapsed row + expanded detail share the subline).    |
| Absent-from-bundle        |  **0** | `build-compact-data.mjs` passes `pt.club_at_tournament ?? null` / `pt.club ?? null` through verbatim — nothing present in ETL output is dropped at compact time.         |
| Dropped-in-ETL            |  **0** | `etl/src/wcdraft_etl/cards.py:114` hard-nulls the field *because the source has no club column* — a documented honest-state null, not a mapping drop.                    |
| Source-absent             | 10,973 | Every historical card (1930–2022). The pinned Fjelstul v1.2.0 `squads.csv`/`players.csv` carry **no club column for any tournament year** (coverage 0% across all 21).  |

ETL output cross-check: `player_tournaments.json` = 13,843 cards, 0 non-null
`club_at_tournament` (the 13,843 → 12,219 gap is the 2,870 women's player-tournaments,
correctly excluded from the draft pool). `player_tournaments_2026.json` = 1,246 non-null
`club`.

## What MV2-12b must include

1. **New source pins (the only real work).** Historical club data is NOT recoverable from
   any already-pinned revision — only the 2026 squads page is pinned. The per-tournament
   English Wikipedia "«year» FIFA World Cup squads" pages list each player's club (and
   club country) in the squad tables for **all 21 tournaments 1930–2022**. Backfill =
   pin one revision oldid per tournament under `etl/sources/wikipedia_<year>/` using the
   existing `source_2026.py` mechanism (CC-BY-SA attribution + oldid pin already solved
   there).
2. **ETL mapping.** Extend the squad-table parser to emit `club` per (player, tournament);
   join onto `player_tournaments` by the existing entity-resolution key (squad row ↔
   Fjelstul player), replacing the hard null at `cards.py:114` with the parsed value.
   Honest-state stands: unresolved rows and blank cells stay null — never coerced.
3. **Compact regen.** No builder change needed — `build-compact-data.mjs` already passes
   the field through. The regen itself bumps `dataset_version` (this is *why* it is 12b
   work: the anchor change skews every live `t1.` token).
4. **Tests.** Update the census lock in
   `apps/web/lib/game/__tests__/club-coverage.test.ts` (it intentionally pins
   "club is 2026-only, 1,246/12,219" and MUST flip with the backfill). ETL byte-stability
   and golden suites per the standing Red protocol.

## Expected post-backfill coverage (estimate — to be measured at pin time, not asserted)

- Wikipedia squad tables carry a club for the overwhelming majority of entries from 1954
  onward; near-complete for 1990–2022. Expect historical coverage to land **well above
  90%** overall, with the residue concentrated in 1930–1950.
- **Genuinely unrecoverable (stays honest-absent forever):** early-era entries where the
  squad table itself is blank or marked unknown — typically amateur-era players
  (1930–1938) with no reliable club records, and a small number of disputed/unattached
  cases. These remain null by the no-fabrication invariant; no "Unknown FC" placeholder
  is ever rendered (UI omits the club line).
- Exact per-tournament counts MUST be measured from the pinned revisions during 12b and
  recorded in its report — the percentages above are planning estimates, not data.

## UI status (already shipped on this lane)

The render path is complete and club-agnostic about era: the moment the bundle carries a
club for a historical card, it displays with zero further UI work (verified by the
present/null/hidden-parity tests in `club-coverage.test.ts`).
