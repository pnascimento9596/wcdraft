# WS-A supplement — sourced pre-1970 World Cup appearances

> Pre-1970 World Cup tournament appearances sourced from the Rec.Sport.Soccer Statistics Foundation (RSSSF) match archive (https://www.rsssf.org/), used with acknowledgement. Each appearance count is the number of a team's matches whose starting XI (no substitutes existed pre-1970) lists the player, transcribed from the committed RSSSF snapshots and linked to the canonical player_id on name + nation + tournament. Unlinkable names are withheld (null) and emitted for human review; minutes and assists remain unavailable and are never synthesised.

- **Source:** Rec.Sport.Soccer Statistics Foundation (RSSSF) — Free use with acknowledgement (RSSSF terms)
- **Sourced field:** `player_tournaments.appearances` (pre-1970), `appearances_source = "rsssf_starting_xi"`
- **Cards sourced:** 1,573 (3,905 total appearances)
- **Review items (withheld, not guessed):** 225


## Per-tournament

| Tournament | Matches (parsed/known) | Teams linked | Cards sourced | Review |
|---|---|---|---|---|
| WC-1930 | 18/18 | 13/13 | 169/245 | 22 |
| WC-1934 | 17/17 | 16/16 | 183/342 | 25 |
| WC-1938 | 18/18 | 15/15 | 183/320 | 29 |
| WC-1950 | 22/22 | 13/13 | 170/281 | 23 |
| WC-1954 | 26/26 | 14/16 (unresolved: KOR, TUR) | 195/350 | 38 |
| WC-1958 | 35/35 | 16/16 | 225/352 | 23 |
| WC-1962 | 32/32 | 16/16 | 225/352 | 25 |
| WC-1966 | 32/32 | 15/16 (unresolved: KLD) | 223/352 | 40 |

## Review breakdown (these stay `null` — never invented)

- **ambiguous_collision** (2): two squad-mates share the surname and the RSSSF initial did not uniquely pick one — left null, not guessed
- **ambiguous_no_initial** (17): two squad-mates share the surname and RSSSF gave no initial to split them — left null, not guessed
- **nation_unresolved** (54): RSSSF team's surnames did not overlap any squad enough to assign a nation (heavily romanized squad) — whole team withheld
- **no_canonical_match** (152): RSSSF surname not found in the linked squad (usually a transliteration / nickname variant) — left null, not guessed

Each review row in `link_review.json` carries the tournament, RSSSF team code, the raw surname/initial, and any canonical candidate ids, so a human can resolve it without re-deriving the link.

