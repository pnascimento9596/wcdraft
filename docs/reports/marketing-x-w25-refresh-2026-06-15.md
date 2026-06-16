# @WCDraft X W25 refresh report - 2026-06-15

## Outcome

Yellow content/docs lane prepared on `ws-brand/marketing-x-w25`.

Base merge state resolved first: all required marketing files were present on
`origin/main` at `b67d1e54bac8b16e9eee4a5a4bc1d39a2e343907`, so the fallback
`ws-brand/marketing-assets` branch was not needed.

## Content

- Created `marketing/x/packs/pack-2026-W25.md`.
- Preserved `marketing/x/packs/pack-2026-W24.md` as opening-week history with a
  supersession note.
- Regenerated `marketing/x/playbook/wcdraft-x-playbook.docx` and
  `marketing/x/playbook/wcdraft-x-playbook.pdf` from W25 plus the committed reply
  and quote banks.
- Updated `marketing/x/playbook/build_playbook.py` so the pack path and post count
  are explicit and the rendered playbook reconciles the source pack count.
- Added `.gitattributes` for DOCX/PDF binary handling so `git diff --check` does
  not inspect valid binary internals as text.
- Updated `STATE.md` with the X lane and current W25 pack state.

## Fixture Grounding

Fixture hooks were refreshed for the Jun 16-22 frame using the provided dispatch
frame plus live schedule checks:

- FIFA match schedule page:
  `https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums`
- FIFA Group I page:
  `https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/group-i-focus-teams-fixtures-standings`
- FIFA Group K page:
  `https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/group-k-focus-teams-fixtures-standings`
- ESPN schedule page:
  `https://www.espn.com/soccer/story/_/id/48939282/2026-fifa-world-cup-fixtures-results-match-schedule-group-stage-knockout-rounds-bracket`
- Al Jazeera schedule page:
  `https://www.aljazeera.com/sports/2026/6/11/world-cup-2026-full-match-schedule-groups-teams-and-start-times`

## Rating Copy

Live runtime manifest check passed:

- `schema_version`: `runtime-data-2.5.0`
- `engine_version`: `engine-2026.06.15-merit-v4.3`
- `rating_version_historical`: `wc-perf-6.3.0`
- `rating_version_projected`: `proj-career-5.3.0`
- `ratings`: `12219`
- `legend_count`: `295`

The refreshed W25 pack does not introduce specific numeric player ratings,
top-rated lists, 9N claims, or rating comparisons. Dataset factoids were generated
from the current local v4.3 data bundle and then checked for character counts.
No drifted rating numbers were changed because there were no numeric rating claims
to correct.

## Counts

- W25 pack blocks: `42`
- Day distribution: Monday-Sunday, `6` blocks each
- Result spotlights: `0` current blocks; no real current replay-checked token was
  available, so the pack keeps the honest empty spotlight note.
- Over-280 posts: `0`
- W25 wcdraft.com links: `https://www.wcdraft.com/play` only; live HEAD returned
  `200`.

## Validation

- `pnpm --filter @wcdraft/marketing-x typecheck`
- `pnpm --filter @wcdraft/marketing-x lint`
- `pnpm --filter @wcdraft/marketing-x test` - 7 files / 64 tests passed
- `marketing/x/playbook/build_playbook.py` - parsed 42 blocks; over-280 none;
  wrote DOCX/PDF
- DOCX zip validation - OK
- PDF validation via `pypdf` - 14 pages, W25 labels present, W24 labels absent
- W25 pack count script - 42 blocks, no count errors, no over-280 posts
- Live URL checks - `/`, `/play`, `/how-to-play` returned `200`
- `git diff --check` - passed
- `pnpm exec turbo run typecheck lint test build --force` - 19/19 tasks passed,
  0 cached, 2m58.549s

Forced test counts:

- `@wcdraft/core`: 22 files / 366 tests passed
- `@wcdraft/db`: 2 files / 79 tests passed
- `@wcdraft/data`: 9 files passed / 1 skipped; 74 tests passed / 7 skipped
- `@wcdraft/marketing-x`: 7 files / 64 tests passed
- `@wcdraft/web`: 62 files passed / 1 skipped; 694 tests passed / 1 skipped

## Risks and Carryovers

- Organic posting is unblocked by this pack.
- Paid promotion remains blocked on trademark counsel.
- Any future live-score or injury hook still needs immediate source verification
  before posting.
- Result spotlight posting still requires a real current share token that has been
  replay-checked; none was fabricated here.
