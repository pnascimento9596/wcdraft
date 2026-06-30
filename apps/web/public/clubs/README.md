# Club crest assets

This directory contains the deliberately small club-crest asset set used by the
draft card club line.

The resolver is conservative by design: a wrong crest is worse than no crest.
Only exact normalized club strings listed in `manifest.json` can resolve to an
asset, and those assets render only on 2026 projected cards. Historical cards
use the monogram fallback even when the club entity is otherwise clear, because
the current club logo is not an at-tournament historical crest.

## Source and license

The bundled SVGs come from Wikimedia Commons file URLs recorded in
`manifest.json`. Each bundled asset passed all of these checks on 2026-06-30:

- Commons metadata reported `Public domain` usage terms.
- The file MIME was `image/svg+xml`.
- A static scan found no `<script>`, event-handler attributes, `<foreignObject>`,
  external `<image>` references, or external hrefs.
- Oversized SVGs were excluded rather than optimized blindly.

Several files carry a Commons `trademarked` restriction note. That is why the
app keeps the independence disclaimer and treats these as nominative identity
marks, not affiliation or endorsement.

## Matching policy

Normalization folds accents, case, punctuation, and leading legal abbreviations
such as `FC`, `AFC`, `AC`, `AS`, `CF`, `CD`, `SC`, `SV`, and `RC`. After that,
matching is exact. Ambiguous strings such as `Nacional`, `America`, `Racing`,
`Athletic`, `Real`, `Universidad`, and `Olimpia` are pinned to fallback unless a
future manifest entry can prove the exact club entity.
