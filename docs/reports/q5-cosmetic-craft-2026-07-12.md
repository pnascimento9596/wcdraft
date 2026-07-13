# Q5 cosmetic craft batch — 2026-07-12

## Collision denylist (season/squad-depth)

No Q5 target file appears on the denylist. Draft/review/results/share surfaces are
still **out of bounds** by the lane contract (Season 2 S4–S7 ownership), even when
absent from the current engine-only denylist.

## Implemented (safe shells only)

| Item                            | Surface                                 | Change                                                                          |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Mode-select tag/chip truncation | `mode-select.tsx` + `shared.module.css` | Shorten Classic/Memory tag + preview + chips; `min-width:0` + wrap-safe modeTag |
| Account run id clip             | `account.css`                           | Tighter ellipsis max-width at ≤430px                                            |

## Deferred (collision / out of scope)

| Item                             | Reason                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------- |
| 9px → ~12px position glyphs      | Draft pitch/squad (`draft-polish.module.css`) — DRAFT / S4 team-sheet territory |
| Booking-chip glyph/legend        | Results screen — S6 territory                                                   |
| Emoji → SVG lock/box-score icons | Only live on draft/results paths; no non-game shell hosts found                 |
| Results/share label craft        | Explicitly deferred (O2/O4/O5/O12)                                              |

## Screenshots

Live-verify on www after merge: `/play` mode select + `/account` at 390×844 and 360×800 both themes.
