# q-008 — micro-Yellow bundle 2

- **Tier:** Yellow (display/CI/error-body hygiene; no schema/rating/sim semantics) ·
  **Mode:** `SELF-SERVE:YELLOW`.
- **Status:** DONE — worked in one wave on `ws-ux/q-008-micro-yellow-2`.

## Items

1. **OG card brand-mark re-ink** — `apps/web/public/og/share-default.svg` carried an
   emerald-inked copy of the brand mark; the canonical mark
   (`apps/web/public/brand/wcdraft-mark.svg`) is all-gold. Re-inked the inline mark
   strokes/fills to the shared `#gold` gradient (geometry unchanged; OG SVGs can't
   `<use>` external files in social scrapers, so inline stays).
2. **CI duplicate push+PR runs** — `.github/workflows/ci.yml` already had per-ref
   `concurrency` cancellation; the remaining duplication was a push to an integration
   branch (`merit-*` / `engine-*` / `season-*`) that also has an open PR — both events
   ran the same head. Added a `dedupe` gate job: push-event runs skip when an open PR
   has that branch as head (the `pull_request` run — the one branch protection reads —
   always proceeds). No gate weakened; triggers only deduped.
3. **q-003 carryover: auth error-body scrub** — `jsonError` surfaced
   `SECRET_MISCONFIGURED` detail (env-var name + secret-generation command) to the
   client. Now: generic client body (`"Server configuration error."`), full detail to
   server logs via `console.error`. Tests pin the scrub.
4. **q-005: surname-collision disambiguation** — `common_name` collisions across
   DISTINCT `player_id`s in the pool (e.g. Cesare vs Paolo "Maldini") now render a
   disambiguated display name on all card surfaces via a pre-computed
   `displayNameByCardId` index (given-name initial "C. Maldini" when the short name is
   the surname token; full name otherwise or when initials still collide). Same player,
   many cards = not a collision (year shows era). Display-only; `playerCardView.name`
   is the single seam, so draft pool, pitch chips, and reveal all inherit it.

## Done-when

All four shipped in one PR, full Yellow validation + CI green, screenshots for the UI
items, STATE.md updated same-PR.
