# external_review/recon — REVIEW-ONLY cross-check reference

> ## ⛔ REVIEW-ONLY — NOT A RATING SOURCE
> This directory holds a **separately-produced, independent** career-strength
> ratings trail, staged **solely** as a cross-check / calibration reference.
>
> It is **NEVER** a rating source. It is **NEVER** copied per-card into our
> ratings. It is **NEVER** blended, averaged, or otherwise mixed into
> `career_stature.json`, `ratings.json`, `ratings_2026.json`, or any compact
> bundle. Our merit model remains the **single source of truth**.
>
> Permitted uses, both still to be wired (not in this PR):
> * **MV2-9 divergence cross-check** — surface big gaps. Where our model and this
>   reference disagree sharply, the divergence points at a *fact our model is
>   missing*; the fix is always **to our MODEL** (source a real fact), never to
>   copy this reference's number.
> * **MV2-8 scale-calibration anchor** — minor, global scale optimization only.

## What this is

`player_career_strength_ratings_v1_1.csv` — the **full** output (28 columns,
8,482 rows, one per men's World Cup `player_id`) of an independent career-strength
rating model built in a separate local project (`wcdraft-recon`,
`Player Career-Strength Rating Model v1.1 / Phase 3C`). It is pinned by SHA-256 in
`manifest.json` with the same pinned-bytes discipline as our merit raw snapshots.

### Why the full file, not `app_clean`

The recon project emits two variants:

| variant | cols | role |
|---|---|---|
| `player_career_strength_ratings_v1_1.csv` (**this file**) | 28 | full — keeps `rating_basis`, `source_count`, `sources_json`, `override_type`, `notes`, `birth_date`, `era_bucket` |
| `final_audit/player_career_strength_app_clean_v1_1.csv` | 19 | ingestion-trimmed — **drops** exactly those provenance columns |

Both carry identical ratings for the same 8,482 rows. A cross-check needs the
**provenance** columns (to ask *why* a number differs), so the full file is the
correct reference. `app_clean` is the per-card *ingestion* variant — explicitly
NOT what we use here, because we are cross-checking, not ingesting.

## How it was produced (source basis)

* **Structure + secondary merit score** — the Fjelstul World Cup Database
  (CC-BY-SA 4.0): players, squads, goals, matches, team appearances. The recon
  `world_cup_merit_score` is a deterministic function of this database. (The recon
  "worldcup_game" model is the World Cup **draft-game** merit model — a résumé
  score from the public match record — not a video-game rating.)
* **Anchors / overrides (~3.2% of players)** — curated public-knowledge
  career-strength claims, each citing an award / honors / editorial source:
  Ballon d'Or, South American & IFFHS player-of-the-year, FIFA governing-body
  awards, IFFHS / RSSSF century lists, the FIFA 100 living-legends list,
  Wikipedia, public consensus.
* **Remaining ~96.8%** — deterministic position/tier templates + small era and
  merit adjustments (conservative, `confidence=low`).

The full methodology + source registry + manual-review trail live **outside this
repo** at `/Users/paulo/Projects/wcdraft-recon/outputs/` (cited in
`manifest.json`). They are deliberately **not copied in**: that trail names
proprietary game-rating products *as exclusions*, and those product tokens must
not enter the firewalled ETL tree.

## IP / provenance determination — **ADMISSIBLE**

Every signal in this reference is a **public, attributable fact or editorial
recognition** (awards, caps/goals records, honors lists, all-time selections).
**No proprietary game-rating database is fetched, parsed, or referenced** in the
data trail — the recon source registry lists that product family explicitly under
*"Not used / excluded"*, and the model report repeats that these are *estimated
internal ratings, not official or third-party game ratings*.

Evidence:
* The committed CSV is **token-clean** against the canonical proprietary block
  list (`PROPRIETARY_SOURCE_TOKENS` in
  `etl/src/wcdraft_etl/merit/__init__.py`, mirrored by `_PROPRIETARY_PATTERN` in
  `etl/tests/test_rating.py`): **0 hits across all 8,482 rows**. The IP-firewall
  audit (`test_etl_source_pins_have_no_proprietary_rating_references`) now scans
  this directory and enforces that on every run.
* The only `FIFA` strings present are the **governing body's** honors (FIFA World
  Cup awards, The Best, FIFA 100) — an admissible recognition source — never the
  video-game ratings (which the block list catches and which return 0 hits).

## Firewall

`etl/tests/test_rating.py :: test_etl_source_pins_have_no_proprietary_rating_references`
scans `etl/merit/external_review/recon/` alongside the other source trees. This
directory must remain **reference data + provenance only**, with zero proprietary
rating tokens.

## NOT wired (this PR is staging only)

`stature.py`, `rating.py`, and `merit_divergence.py` are **untouched**. No rating
output changes: `career_stature.json`, `ratings.json`, `ratings_2026.json`, and
all compact bundles are **byte-identical** to merit-v2. Wiring the cross-check is
MV2-8 / MV2-9.
