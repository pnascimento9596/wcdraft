# Era Closeout Doc-Set Refresh

Date: 2026-06-15
Base: post-purge `origin/main` `a7580ea1728844a6c7d4c33998baff14d2a23dde`
Status: docs-only closeout refresh after branch/PR graveyard cleanup, history purge,
and live production reconciliation.

## Outcome

The named canonical docs are still not present as repo files. This report is the
owner-filed artifact for the refreshed canonical set, and `STATE.md` is the
in-repo truth surface updated in the same change.

- Build State: bumped to v10. Supersedes v9.
- Architecture: bumped to v6. Supersedes v5.
- Roadmap: bumped to v6. Supersedes v5.
- Surface Inventory: bumped to v6. Supersedes v5.

All claims below were reconciled against the live production manifest and current
post-purge `origin/main`, not carried forward from memory.

## Live Reconciliation Spot-Check

Production readback from `https://www.wcdraft.com/data/wcdraft/manifest.json` and
the versioned runtime path
`/data/wcdraft/runtime-data-2.3.0/manifest.json` returned byte-identical
manifests on 2026-06-15.

| Field                                   | Live value                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| manifest status / bytes / sha256        | `200` / `6,401` / `126a77fba59e9bf432b0163c6691a79eb3e70d93d037f7a8f92bad0a14de16ea`                  |
| schema_version                          | `runtime-data-2.3.0`                                                                                  |
| engine_version                          | `engine-2026.06.14-merit-v4.1`                                                                        |
| rating_version_historical               | `wc-perf-6.1.0`                                                                                       |
| rating_version_projected                | `proj-career-5.1.0`                                                                                   |
| dataset_version                         | `2026-06-04`                                                                                          |
| ruleset_version                         | `ruleset-2026.06.04`                                                                                  |
| draft-pool raw bytes / sha256           | `101,026,822` / `f0f76fd3c2f8d003a3ee5062957220c591431e37fc6ea54daa689c6e992e11b7`                    |
| draft-pool served Brotli bytes / sha256 | `1,429,691` / `b7422612f3dd8284dac92b74949a232e6d381367dadb84b75846fe091cbd5fcf`                      |
| draft-pool manifest Brotli metadata     | `1,429,760` normalized bucket                                                                         |
| scenario raw bytes / sha256             | `108,775` / `bd362cb7a509b8081ec7febf440749217fe94f7fc7d14d9431ce28347803f420`                        |
| leaderboard season key                  | `engine-2026.06.14-merit-v4.1_wc-perf-6.1.0+proj-career-5.1.0_2026-06-04_ruleset-2026.06.04_11cbbd5e` |

Runtime census from the same manifest:

| Count                  |                                                      Value |
| ---------------------- | ---------------------------------------------------------: |
| player cards / ratings |                                                     12,219 |
| manager cards          |                                                        501 |
| teams                  |                                                         48 |
| knockout slots         |                                                         62 |
| legends                |                                                        295 |
| Career basis           | 11,292 measured; 541 career-stature-estimate; 386 baseline |
| Current basis          |   11,831 measured; 0 career-stature-estimate; 388 baseline |

## Build State v10

Current live season is merit-v4.1:

- Runtime data: `runtime-data-2.3.0`.
- Engine: `engine-2026.06.14-merit-v4.1`.
- Historical ratings: `wc-perf-6.1.0`.
- Projected ratings: `proj-career-5.1.0`.
- Dataset/ruleset: `2026-06-04` / `ruleset-2026.06.04`.
- Leaderboard season key:
  `engine-2026.06.14-merit-v4.1_wc-perf-6.1.0+proj-career-5.1.0_2026-06-04_ruleset-2026.06.04_11cbbd5e`.

merit-v4 is the base rating-methodology rebuild now superseded by the live
merit-v4.1 data anchor. merit-v4 introduced the public national-team-strength
prior, objective `club_honors`, the `wc-perf-6.0.0` / `proj-career-5.0.0`
season, and the removal of the old raw-only `0.62` ceiling shelf.

merit-v4.1 is the current live ratings season. It adds pool-wide
objective-achievement staging for active 2026 cards, reduces the
league-of-employment prior from a dominant context to smooth context
(`FW/MF/DF/GK` weights `0.31/0.34/0.31/0.28` to `0.18/0.20/0.18/0.16`),
caps the projected objective-record pathway at `0.70`, and expands material
headroom coverage from AFC `0/7` to `7/7`, CONCACAF `0/5` to `5/5`, and CAF
`2/8` to `4/8`.

Acceptance anchors now live:

- Heung-min Son 2026: `90`.
- Salem Al-Dawsari 2026: `86`.
- Christian Pulisic 2026: `88`.
- Pooled runtime `90+`: `290 / 12,219 = 2.373%`.

The known remaining ratings gap is deliberately deferred: CAF still has honest
misses for Ghana, Ivory Coast, South Africa, and Tunisia under the current
conservative linker and source surface. That is a roadmap carryover, not a hidden
regression.

The platform pass is fully shipped:

- #133: SEO surface plus themed 404/error pages.
- #134: light/dark AA contrast fixes and 44px touch targets.
- #135 and #138: response headers, then full nonce CSP with report intake and
  unsigned share-summary neutralization.
- #136 and #142: performance and data delivery, including parallel fetch,
  lazy `MemoryReveal`, sim-payload narrowing, and versioned Brotli runtime data.
- #139: a11y/focus follow-up and `CandidateCard` / `ManagerCandidate`
  memoization.
- #140: safe patch dependency bump.
- #143: trusted per-run OG re-derivation and signing.

History purge is complete. Current shared history no longer contains the two
large generated JSON blobs:

| Purged path                                           |           Max historical size |
| ----------------------------------------------------- | ----------------------------: |
| `packages/data/src/generated/draft-pool.compact.json` | 100,702,891 bytes / 96.04 MiB |
| `etl/output/ratings.json`                             |  95,222,758 bytes / 90.81 MiB |

Backup ref:
`refs/backup/pre-purge-2026-06-15-0244Z` points to pre-purge main
`431aaec5ed960389c75da299895a77fd4bc9009d`.

Fresh clone size moved from `.git` `98,668` KB / working clone `229,196` KB to
`.git` `82,284` KB / working clone `212,812` KB. The local rewritten clone before
post-push reclone measured `.git` `72,312` KB / working clone `202,840` KB.

All collaborators and agents must re-clone. Old clones now diverge from rewritten
`main`.

## Architecture v6

### Rating Architecture

merit-v4 supersedes the merit-v3.1 rating methodology. Historical ratings now
combine individual tournament merit with a public national-team-strength prior
from World Football Elo all-years plus official FIFA ranking snapshots from 1994
onward. The prior replaces the old nation-blind raw-only `0.62` ceiling with a
smooth `(tournament, nation)` ceiling range from `0.500` to `0.625`. Awards and
material career stature can still overrun the prior.

The `club_honors` input family is active for public-factual internal inputs:
major club trophies, continental club titles, league top-scorer by goals, and
world-record or era-defining transfer facts. Fan votes, proprietary ratings,
subjective club/player-of-year routes, EA/FC/FIFA-style ratings, and inferred or
fabricated facts remain excluded.

merit-v4.1 adds a conservative projected objective-record path for active 2026
cards. It requires linked objective evidence or membership in the explicitly
under-covered AFC/CAF/CONCACAF squad set and is capped at `0.70` material weight.
The league-strength prior remains visible but no longer dominates objective
individual record.

### Data Delivery And Atomic Versioning

The current runtime data base is
`/data/wcdraft/runtime-data-2.3.0/`. The versioned surface contains:

- `manifest.json`
- `draft-pool.compact.json.br`
- `scenario-2026.compact.json`

The fixed legacy `/data/wcdraft/*` paths remain copied for old clients and server
filesystem readers. Future runtime-data updates must retain at least the
immediately previous versioned directory across N+1 deploys so already-open
clients can finish from the data version they started with.

The integrity contract is the raw manifest hash and each bundle's raw SHA-256.
The served `.br` artifact may differ from the normalized manifest Brotli metadata
bucket; decompression must match the manifest draft-pool SHA.

### Trusted OG Contract

Dynamic share cards are now trusted per-run derivations. `/play/share` begins
with the replay URL and requests a signed `og=` model from `POST /api/og/sign`.
The signer runs in Node, validates the replay token against the current manifest,
reconstructs the legal draft path, runs the deterministic tournament engine, and
signs only the canonical OG render model plus a hash of the exact `run=` token.

`/api/og/run` stays Edge. It verifies the HMAC, token hash, and current versions
before rendering. Unsigned, malformed, tampered, foreign-build, old-version, or
secret-missing inputs fall back to the static default card. The Edge route must
not import the full draft pool, replay decoder, tournament simulator, or
narrative stack.

### CSP And Security Headers

CSP lives in `apps/web/proxy.ts` with per-request nonces. Production enforces the
policy; preview and development default to report-only. `/api/csp-report` accepts
bounded reports and rejects oversized bodies. The platform has response headers,
nonce wiring, unsigned-share neutralization, and trusted OG signing in place.

### Generated Artifacts

`etl/output/ratings.json` and
`packages/data/src/generated/draft-pool.compact.json` are generated artifacts, not
normal source. They are regenerated from tracked ETL inputs and compact
fingerprints by `pnpm check:generated` / `ensure-generated-artifacts`. Current
history has been rewritten to remove those generated blobs from all commits.

## Roadmap v6

Mark DONE-LIVE:

- merit-v4 rating rebuild: national-strength prior, objective `club_honors`,
  active-career damping, compact regen, lambda/realism relock, and season reset.
- merit-v4.1 coverage season: objective-achievement staging, smoothed
  league-strength prior, `0.70` cap, AFC/CONCACAF full targeted material
  coverage, CAF partial improvement, new runtime/engine/rating anchors.
- Platform pass: SEO, themed errors, AA contrast, 44px targets, CSP, safe headers,
  a11y/focus fixes, render memoization, performance/data-delivery improvements,
  safe patch dependencies.
- Atomic versioned delivery:
  `/data/wcdraft/runtime-data-2.3.0/` with a served draft-pool Brotli artifact
  measured at `1,429,691` bytes on the wire.
- Trusted OG: per-run server re-derive-and-sign architecture, unsigned fallback
  static card, no browser-trusted result summary.
- History purge: backup ref created, generated blob paths stripped, fresh clone
  verifies no remaining generated blob over 40 MB.
- PR/branch graveyard cleanup: #76 closed after its forensic report was ported
  through #144; stale merged/dead remote branches removed.

Only known ratings carryover for this closeout: CAF-4 honest misses remain
deferred for Ghana, Ivory Coast, South Africa, and Tunisia.

## Surface Inventory v6

Public surfaces to keep in the canonical inventory:

- `/`: production game surface.
- `/robots.txt` and `/sitemap.xml`: SEO surface from #133.
- Themed 404 and global error pages.
- Noindex app/helper routes that should not enter search.
- `/data/wcdraft/manifest.json`: legacy current manifest path.
- `/data/wcdraft/runtime-data-2.3.0/manifest.json`: current versioned manifest.
- `/data/wcdraft/runtime-data-2.3.0/draft-pool.compact.json.br`: versioned
  compressed draft pool; raw decompressed SHA must match the manifest.
- `/data/wcdraft/runtime-data-2.3.0/scenario-2026.compact.json`: versioned
  scenario bundle.
- `/api/og/sign`: Node signer for replay-token validation and canonical OG model
  signing; no-store and bounded by cache/throttle/body limits.
- `/api/og/run`: Edge renderer for signed OG models plus static fallback.
- `/play/share`: replay share page that requests a signed OG model while keeping
  the replay URL valid without it.
- `/api/csp-report`: bounded CSP report intake.
- Sim-worker payload surface narrowed by #142.
- Leaderboard profile/casual/ranked surfaces remain dark for ranked light-up
  until owner-controlled production flagging and live verification.

## Validation

Closeout verification already run on the rewritten main:

- Pre-purge backup ref pushed before rewrite.
- `git filter-repo` removed only generated blob paths listed above.
- Post-rewrite `git rev-list --objects --all` plus `git cat-file --batch-check`
  found no remaining generated blob over 40 MB.
- Fresh clone after force-push passed `pnpm install --frozen-lockfile`,
  `pnpm check:generated`, local-vs-live hash comparison, and `pnpm build`.
- Main CI after force-push was green for dedupe, golden RNG, realism, ETL rating,
  db path filter, and typecheck/lint/test/build.
- Main ETL workflow after force-push was green for ingest, identity QA, and
  determinism.
- Vercel production deployment succeeded, and live manifest/draft/scenario hashes
  stayed unchanged from the pre-purge production readback.

Docs-only validation for this refresh is recorded in the PR/merge that lands this
file and `STATE.md`.
