# q-005 — surname-collision disambiguation on card surfaces

- **Tier:** Yellow (display-only UX; no schema/rating/sim semantics) · **Mode:**
  `SELF-SERVE:YELLOW`.
- **Status:** OPEN — filed from the MV2-12 ratings audit §E
  (`docs/reports/mv212-ratings-audit-2026-06-10.md`).

## Problem (verified in the audit)

Both Cesare Maldini (`P-34023`, WC-1962, OVR 71) and Paolo Maldini (`P-43222`,
four cards 93–94) render `common_name = "Maldini"` — the owner read the Cesare
card as Paolo. Surname collisions in the card pool are not unique to Maldini;
memory-mode reveal is the worst case (rating hidden until reveal, so the user
anchors on the famous surname).

## Scope

- Detect `common_name` collisions WITHIN the rendered pool and add a
  disambiguator on card surfaces: given-name initial (e.g. "C. Maldini") or
  full name on collision — evaluate both; tournament year is already shown on
  some surfaces and is not sufficient alone (it disambiguates era, not person).
- Data layer already carries `given_name` / `full_name`; this is a view-model /
  display concern only. No ETL, rating, or compact change.

## Done-when

Colliding-surname cards are visually distinguishable on every card surface
(draft pool, pitch chips where names render, reveal screens), with tests, and
screenshots in the PR. STATE.md untouched unless test counts move.
