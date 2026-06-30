# Real Club Crests Coverage

Generated from `packages/data/src/generated/draft-pool.compact.json` (schema `runtime-data-2.9.0`) and `apps/web/public/clubs/manifest.json`.

## Method

- Resolver: side lookup at render time from normalized club string plus tournament year.
- Confidence threshold: exact normalized string and audited current-logo asset in the manifest.
- Crest scope: current club-entity crests render only on 2026 projected cards.
- Historical, ambiguous, unmapped, and missing-club rows intentionally use deterministic monograms.
- Pitch slots stay flag-only; the crest lives only beside the club text on candidate cards.

## Asset Sources

- Wikimedia Commons public-domain SVG assets: 9 asset files from 9 source URLs.
- Oversized or non-SVG candidates were excluded rather than transformed blindly.

## Coverage

| Era                  | player cards | with club | resolved with real crest | monogram fallback | fallback rate |
| -------------------- | -----------: | --------: | -----------------------: | ----------------: | ------------: |
| Historical 1930-2022 |        10973 |     10957 |                        0 |             10957 |       100.00% |
| Projected 2026       |         1246 |      1246 |                       84 |              1162 |        93.26% |
| All                  |        12219 |     12203 |                       84 |             12119 |        99.31% |

Historical fallback is expected and correct in this lane: the bundled assets are current club-entity crests, not verified at-tournament historical crests.

## Schema Orthogonality

- No runtime-data schema change.
- No player-card schema change.
- No runtime-data version bump.
- No core, sim, rating, or golden behavior change.
- Diff is confined to web rendering/tests/scripts/docs plus static `/clubs/` assets.

## Browser Proof

- `docs/reports/real-club-crests/browser-proof.json`
- Repro command from repo root:
  `python3 /Users/paulo/.codex/skills/webapp-testing/scripts/with_server.py --server "pnpm --filter @wcdraft/web start --hostname 127.0.0.1 --port 3025" --port 3025 --timeout 120 -- env BASE_URL=http://127.0.0.1:3025 pnpm --filter @wcdraft/web verify:club-crests-browser`
- Screenshots: `390x844` and `360x800`, light and dark.
- Seeded candidate rows: Bayern Munich real crest, Arsenal monogram fallback, Nacional ambiguous monogram fallback.
- Result: 0 axe violations, no horizontal overflow, reserved 16x16 crest boxes, cumulative layout shift `0`.
