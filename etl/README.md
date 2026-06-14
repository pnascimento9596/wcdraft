# wcdraft-etl

Python ETL that ingests the **Fjelstul World Cup Database** (CC-BY-SA 4.0) into
canonical, normalized JSON tables under `etl/output/`, with identity-QA
regression guards and an honest-state coverage report.

This is **WS-A Phase-1a**: the data foundation (ingest → normalize → identity-QA
→ coverage). It deliberately does **not** import `packages/core` — the pipeline
emits JSON the app loads. The contract-shaped emit into `packages/data`, and the
rating / era-normalization, are later workstreams.

## Attribution & licensing (CC-BY-SA 4.0 — ShareAlike)

> Contains information from **The Fjelstul World Cup Database (v1.2.0)** by
> **Joshua C. Fjelstul, Ph.D.**, © 2023 Joshua C. Fjelstul, Ph.D., used under
> **CC-BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/legalcode).
> Source: https://www.github.com/jfjelstul/worldcup (pinned commit
> `f41e9437a007498bdbf3751305818101f96cb6fb`).
>
> **Modifications by wcdraft:** normalized into canonical nation / player / card
> / manager / tournament tables; derived coarse positions, per-card goal /
> appearance / award aggregates and a per-card coverage score; added a curated
> historical-entity / alias reference for nations. No upstream values were
> altered, imputed, or back-filled; absent signals are preserved as `null`.

⚠️ **ShareAlike propagates.** Any data product derived from this database
(a packaged player table, a ratings dataset) inherits **CC-BY-SA 4.0** and must
be redistributed under it. Escalate to product/legal before any closed-source
distribution of derived data.

The exact attribution string also lives in `output/manifest.json`,
`output/COVERAGE.md`, and `wcdraft_etl.source.ATTRIBUTION` (single source of truth).

## Honest-state rule

A signal absent for an era is `null` — never `0`, `false`, or `""`. The loader
reads every cell as a string with no NA coercion; each transform decides, per
column, what missing means. Specifically:

- `shirt` — `0` is the upstream "no squad number" sentinel (pre-1954) → `null`.
- `appearances` — native Fjelstul match data starts **1970**; pre-1970 values are
  **sourced from RSSSF starting XIs** by the WS-A supplement (see below) and
  tagged via `appearances_source` (`fjelstul_match_events` / `rsssf_starting_xi`).
  A pre-1970 card whose lineup name could not be unambiguously linked stays
  `null` (never `0`) and is emitted to `output/supplement/link_review.json`.
- `goals` — excludes own goals (credited to the scorer but not *their* goal).
- `club_at_tournament` — **no upstream column** → always `null`, never fabricated
  (Wikipedia club/caps/DOB enrichment is a separate, sequenced follow-on lane).
- manager `birth_date` — **no upstream column** → always `null`.
- **assists, minutes** — do not exist at any era → omitted entirely, never
  invented; in particular pre-1970 minutes are **not** synthesised as matches×90.

See `output/COVERAGE.md` for per-era availability, the two era cliffs (1954
shirts, 1970 match events), row counts, and null-rate per nullable column.

## WS-A supplement — sourced pre-1970 appearances (RSSSF)

The base ingestion is pure Fjelstul, which has no match-level appearances before
1970 — leaving every pre-1970 card with `appearances = null` and forcing ~933
defenders/keepers onto the rating's null path. The **WS-A supplement** closes
that gap by **sourcing the real fact** from the RSSSF World Cup match archive and
**linking** it to the canonical `player_id` — it never invents a value:

- Pre-1970 World Cups allowed **no substitutes**, so a player's tournament
  appearances = the number of his team's matches whose **starting XI** lists him.
  We parse that, deterministically, from committed raw RSSSF snapshots.
- Raw pages are pinned under `etl/supplement/raw/rsssf/` with a
  `fetch_manifest.json` recording each URL + sha256 + retrieval date. Parsing and
  linking are pure functions of those bytes + the canonical tables, so the
  overlay reproduces **byte-for-byte offline** (no network on the build path).
- Each lineup surname is linked to exactly one squad card (family name + initial
  disambiguation). Anything not uniquely linkable — a transliteration variant, a
  surname collision an initial can't split, a squad RSSSF romanizes beyond
  recognition — is **withheld (`null`) and emitted to the review list**, not
  guessed. 1,573 cards sourced; 225 review items; minutes/assists stay absent.

Refresh / verify the snapshots (run-once maintenance; not needed to build):

```bash
python -m wcdraft_etl.supplement.fetch          # re-download + write fetch_manifest.json
python -m wcdraft_etl.supplement.fetch --verify # check committed bytes vs manifest sha256
```

### Attribution — RSSSF (in addition to Fjelstul CC-BY-SA above)

> Pre-1970 World Cup tournament appearances are sourced from the
> **Rec.Sport.Soccer Statistics Foundation (RSSSF)** match archive
> (https://www.rsssf.org/), used with acknowledgement under the RSSSF
> free-use-with-credit terms. The full attribution string lives in
> `wcdraft_etl.supplement.RSSSF_ATTRIBUTION`, `output/manifest.json`
> (`supplement` block), `output/supplement/SUPPLEMENT.md`, and
> `supplement/fetch_manifest.json`.

## Output tables (`etl/output/`)

| Artifact | Grain | Key |
|---|---|---|
| `nations.json` | one per national entity (historical kept separate, flagged) | `nation_id` (= upstream `team_id`) |
| `players.json` | one per human | `player_id` |
| `player_tournaments.json` | one per (player, tournament) — the "card" | `card_id` = `player_id:tournament_id` |
| `managers.json` | one per human | `manager_id` |
| `manager_tournaments.json` | one per (manager, tournament, team) | `manager_tournament_id` |
| `tournaments.json` | one per tournament (men's + women's) | `tournament_id` |
| `goals.json` | event-level goals | `goal_id` |
| `appearances.json` | event-level match appearances (1970+) | `appearance_id` |
| `awards.json` | award winners | `award_winner_id` |
| `manifest.json` | source pin, attribution (Fjelstul + RSSSF), row counts | — |
| `COVERAGE.md` | coverage / null-rate report | — |
| `supplement/appearances_sourced.json` | one per linked pre-1970 card | `card_id` |
| `supplement/link_review.json` | unlinkable RSSSF names (withheld, for human review) | — |
| `supplement/SUPPLEMENT.md` | per-tournament link/coverage report | — |

Nations are keyed on `team_id`, **not** `team_code` — `DEU` collides (Germany
`T-31` vs West Germany `T-86`). Historical entities (West Germany, USSR,
Czechoslovakia, Yugoslavia, Serbia & Montenegro, Zaire, Dutch East Indies, East
Germany) each keep their own `nation_id`; we flag them `historical` and record a
successor note, but **never merge** them.

## Local setup & run

```bash
cd etl
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Point at a clone of the pinned upstream (or set WCDRAFT_WORLDCUP_DIR):
git clone https://github.com/jfjelstul/worldcup vendor/worldcup
git -C vendor/worldcup checkout f41e9437a007498bdbf3751305818101f96cb6fb

python -m wcdraft_etl        # writes etl/output/
ruff check src tests
pytest -q                    # identity-QA + determinism guards
```

Source discovery order: `$WCDRAFT_WORLDCUP_DIR` → `etl/vendor/worldcup/data-csv`
→ `~/Projects/wcdraft-recon/worldcup/data-csv`.

## Identity-QA (the dedup spine — `tests/test_identity_qa.py`)

Regression guards that must pass in CI:

- **Nation switchers** resolve to one `player_id` across two `nation_id`s:
  Puskás `P-12676` (HUN'54 + ESP'62), Monti `P-25760` (ARG'30 + ITA'34),
  Santamaría `P-70798` (URU'54 + ESP'62).
- **Manager identity** stable: Parreira `M-311` — one id across 6 tournaments /
  5 nations.
- Unique primary keys (no duplicate / collapsed humans); every card references a
  real player, nation, and tournament.
- Honest-state: pre-1970 appearances and pre-1954 shirts are `null`; `club` and
  manager `birth_date` never fabricated; own goals excluded from card tallies;
  coverage matches the era cliffs.

## Determinism

Same input commit → identical output bytes (verified byte-identical across
Python 3.11/pandas 2.2 and 3.14/pandas 3.0). CI rebuilds and runs
`git diff --exit-code -- etl/output` for tracked ETL artifacts. The oversized
historical `ratings.json` is regenerated on demand by
`python -m wcdraft_etl.rating` and locked by the tracked
`etl/output/ratings.lock.json` sha256/byte-count fingerprint, so it can stay out
of normal git without weakening determinism checks.
