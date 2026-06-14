# a11y + perf follow-ups — 2026-06-14

Branch: `ws-ux/a11y-perf-followups-20260614`  
Base: `origin/main` `4c22e375dc605f0a401d84d836b0b379fe8856a3`

## Outcome

The bounded a11y follow-ups and `CandidateCard` hot-path perf item from
`docs/reports/platform-improvement-pass-2026-06-14.md` are implemented on this branch.

No schema, rating, sim, compact data, leaderboard, auth, or draft-engine semantics changed.

## Surface Inventory

Changed runtime surfaces:

- Draft setup: light-theme wordmark accent now uses readable emerald text; setup labels/notes use readable ink after axe found contrast failures.
- Draft spin stage: result heading, tagline, and rare-pick announcement are announced through one polite live region.
- Draft lineup: spin-to-lineup transition moves focus to the formation heading.
- Draft candidate rows: collapsed player rows expose rating provenance (`badge_label`) to screen readers.
- Synergy bar: delta arrows keep the visual glyph but add explicit up/down text for assistive tech.
- Draft slot picker sheet: dialog has `aria-modal`, initial focus, Tab trap, Escape close, and focus restore to `Choose slot`.
- Account menu popover: initial focus, Tab trap, Escape close, and focus restore to the trigger.
- Candidate list perf path: `CandidateCard` and `ManagerCandidate` are memoized; draft-screen selection callbacks are stable instead of per-row inline closures.

Committed visual proof:

- `docs/screenshots/ws-a11y-perf-followups-2026-06-14/390x844-slot-sheet.png`
- `docs/screenshots/ws-a11y-perf-followups-2026-06-14/390x844-post-lock.png`
- `docs/screenshots/ws-a11y-perf-followups-2026-06-14/360x800-slot-sheet.png`
- `docs/screenshots/ws-a11y-perf-followups-2026-06-14/360x800-post-lock.png`
- `docs/screenshots/ws-a11y-perf-followups-2026-06-14/position-first-target.png`

## Verification

Focused package artifacts:

- `pnpm --filter @wcdraft/data build` — PASS
- `pnpm --filter @wcdraft/db build` — PASS

Focused web checks:

- `pnpm --filter @wcdraft/web typecheck` — PASS
- `pnpm --filter @wcdraft/web lint` — PASS
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/a11y-focus-perf.test.ts lib/game/__tests__/club-coverage.test.ts lib/game/__tests__/synergy-display-rounding.test.ts` — PASS, 3 files / 13 tests
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/position-first-web.test.ts lib/game/__tests__/full-path-final.test.ts lib/game/__tests__/tap-stability.test.ts` — PASS, 3 files / 19 tests
- Combined post-instrumentation clean run:
  `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/a11y-focus-perf.test.ts lib/game/__tests__/club-coverage.test.ts lib/game/__tests__/synergy-display-rounding.test.ts lib/game/__tests__/position-first-web.test.ts lib/game/__tests__/full-path-final.test.ts lib/game/__tests__/tap-stability.test.ts` — PASS, 6 files / 32 tests

Build:

- `pnpm --filter @wcdraft/web build` — PASS on Next `16.2.7`
- Existing warnings only: two circular chunk dependency warnings and the existing edge-runtime static-generation warning.

Root gates:

- `pnpm typecheck` — PASS, Turbo 8/8 tasks successful.
- `pnpm lint` — PASS, Turbo 5/5 tasks successful.
- `pnpm test` — PASS, Turbo 8/8 tasks successful:
  - `@wcdraft/core`: 366 passed
  - `@wcdraft/data`: 65 passed / 7 skipped
  - `@wcdraft/db`: 79 passed
  - `@wcdraft/marketing-x`: 64 passed
  - `@wcdraft/web`: 678 passed / 1 skipped
- `pnpm build` — PASS, Turbo 4/4 tasks successful; existing Next warnings only.

Browser + axe:

Local production server:

```bash
WCDRAFT_SITE_URL=http://127.0.0.1:3032 pnpm --filter @wcdraft/web exec next start -H 127.0.0.1 -p 3032
node /tmp/wcdraft-browser-tools/ux-a11y-interactions.cjs http://127.0.0.1:3032 /tmp/wcdraft-ux-a11y-shots
```

Result:

```json
{
  "ok": true,
  "results": [
    {
      "label": "390x844",
      "flow": "classic",
      "axe": [
        { "label": "390x844: formation select", "violations": 0, "passes": 25 },
        { "label": "390x844: lineup selected", "violations": 0, "passes": 26 },
        { "label": "390x844: slot sheet", "violations": 0, "passes": 26 }
      ],
      "selection": "pass",
      "lockPick": "pass",
      "sort": "pass"
    },
    {
      "label": "360x800",
      "flow": "classic",
      "axe": [
        { "label": "360x800: formation select", "violations": 0, "passes": 25 },
        { "label": "360x800: lineup selected", "violations": 0, "passes": 26 },
        { "label": "360x800: slot sheet", "violations": 0, "passes": 26 }
      ],
      "selection": "pass",
      "lockPick": "pass",
      "sort": "pass"
    },
    { "label": "position-first", "target": "pass" }
  ]
}
```

Interaction coverage from the browser script:

- Formation lock -> spin -> reveal -> lineup focus.
- Search keystroke + sort select.
- Player selection.
- Slot sheet open, initial focus, repeated Tab containment, Escape close, focus restore, reopen, slot choose.
- Lock pick -> next spin ready.
- Position-first setup -> target select -> spin ready.

## Render Measurement

Measurement harness:

```bash
node /tmp/wcdraft-browser-tools/candidate-render-measure.cjs <base-url> <label>
```

Method:

- Both builds used the same temporary browser-only counter inside `CandidateCard`.
- Baseline was a detached `origin/main` worktree at `4c22e375dc605f0a401d84d836b0b379fe8856a3`.
- Current branch used the memoized/stable-callback implementation.
- The measured action was a whitespace search keystroke (`" "`) after lineup reveal. `search.trim()` remains empty, so the visible candidate list is unchanged; this isolates unrelated parent state re-render behavior.

Results:

| Build | Visible player rows before | Visible player rows after | `CandidateCard` renders after whitespace keystroke |
| --- | ---: | ---: | ---: |
| baseline `origin/main` | 23 | 23 | 23 |
| memo + stable callback branch | 23 | 23 | 0 |

Delta: `23 -> 0` row renders for the no-op keystroke scenario.

## Risks / Carryovers

- The account menu focus trap is source-locked and type/lint covered, but the auth-enabled signed-in menu was not live-exercised in browser because local auth is dark by default.
- The perf measurement used temporary instrumentation removed before the clean build and before commit.
- No data/runtime/generated contract changed; golden data gates were not required for this Yellow UI/perf branch.
