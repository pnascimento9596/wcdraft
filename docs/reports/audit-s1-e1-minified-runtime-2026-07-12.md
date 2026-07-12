# Audit S1 E1 — canonical minified runtime JSON

Date: 2026-07-12
Risk: RED
Branch: `ws-f4/audit-s1-minified-runtime`
Base: `26a6a9ce91e55057d7ac930c07680d3fd3104559`

## Outcome

The runtime-data schema advances from `runtime-data-2.9.0` to
`runtime-data-2.10.0`. The compact builder and the score-distribution/Daily
generators now serialize runtime JSON through one deterministic, recursively
key-sorted, minified `JSON.stringify` representation with no trailing newline.
The committed human-readable size report remains pretty-printed.

The exact 2.9 closure is retained with its manifest-derived raw and canonical
Brotli files. The two-prior-version window is now 2.8 and 2.9; 2.7 leaves the
retention set. No rating, engine, ruleset, dataset, draft, simulation, Daily
selection, score-distribution, or ETL input semantics change.

## Measured artifacts

| Artifact           | 2.9 decoded | 2.10 decoded | Reduction | 2.9 Brotli | 2.10 Brotli |
| ------------------ | ----------: | -----------: | --------: | ---------: | ----------: |
| Draft pool         | 130,545,042 |   68,380,413 |  47.6193% |  2,224,859 |   1,311,661 |
| Scenario 2026      |     108,775 |       75,325 |  30.7522% |      4,440 |       4,195 |
| Score distribution |       1,856 |        1,224 |  34.0517% |        617 |         593 |
| Daily salt map     |      26,506 |       19,016 |  28.2578% |      1,777 |       1,688 |
| Manifest           |       8,319 |        7,147 |  14.0882% |      2,201 |       2,154 |

The dispatch's 68,380,412-byte estimate described minifying the 2.9 object.
The measured 2.10 file is one byte larger because `runtime-data-2.10.0` is one
character longer than `runtime-data-2.9.0`.

Current fingerprints:

- draft raw: `ae5376c917377b00ac9dee7a166dcaceb28dd1416fc9fbe8b00b1116ca8e8d07`;
- draft Brotli: `76a5833748f34968b2666ae8c8f346d8d7e440a7f5f73f83de19c488c307b36d`;
- scenario raw: `50c45d0e9b9b56892e6bd3462988417e072ea1b08aff206fe344c3ebaccd66fd`;
- manifest raw: `d823b6f9a321fb6231cfb3cbdfa24a8e98e26773128f6513fad220810976edcc`;
- service-worker data revision: `5b0f2daf98df2038`.

## Behavioral proofs

- The generated raw JSON for all five manifest-described files equals the
  exact `JSON.stringify(JSON.parse(bytes))` form and has no trailing newline.
- Re-serializing each parsed object readably and parsing it again is deep-equal
  to the minified object.
- The retained 2.9 draft/scenario objects are deep-equal to 2.10 after only
  normalizing `schema_version`.
- A token stamped from the retained 2.9 six-anchor manifest decodes but returns
  `versionsAgree === false` against 2.10. Current-anchor replay remains
  byte-identical through the existing fresh-context replay golden.
- Canary regeneration left SHA-256
  `7b1a360798d991668d2d007d861be5f251516b931ddcb00b6514503f9d1f5c43`
  unchanged: zero pick flips.
- The complete 45-day Daily window was regenerated with its committed
  `2026-07-10` start; selected salts and measured policy results stayed locked.

## Browser measurement

The in-repo benchmark ran against the optimized candidate production server,
using fresh Chrome processes, exact versioned assets, a 1 GiB V8 old-space
ceiling, and the existing 10-second / 3,000 MiB adjudication limits.

| Case                 | C4 setup | E1 setup |            Delta | Resource |    Decoded |   Heap |  Peak RSS |
| -------------------- | -------: | -------: | ---------------: | -------: | ---------: | -----: | --------: |
| Desktop 1366x768     | 1,588 ms |   938 ms | -650 ms (-40.9%) |    70 ms | 68,380,413 | 78 MiB | 2,262 MiB |
| Mobile 390x844 touch | 1,551 ms |   858 ms | -693 ms (-44.7%) |    70 ms | 68,380,413 | 78 MiB | 2,256 MiB |

The C4 baseline used the same committed harness against its optimized
candidate build. This is an end-to-end mode-to-setup measurement, not a JSON
microbenchmark. Safari/WebKit instrumentation remains unavailable and is not
inferred from Chrome.

## Validation

- canonical/retention/manifest compatibility focused tests: 21/21;
- compact + Daily focused goldens: 24/24;
- token/replay + leaderboard focused tests: 63/63;
- canary regeneration: 1/1, zero pick flips;
- root typecheck: 8/8, zero cached;
- root lint: 5/5;
- root test: 8/8 tasks; core 391, data 182 with 9 expected skips, DB 161,
  marketing 68, web 1,156 with 1 expected benchmark skip; 1,958 executed tests,
  game-flow green, responsive matrix 218/0;
- root build: 4/4;
- core goldens: 69 + 42;
- data goldens: 59 + 22;
- leaderboard golden: 6;
- heavy realism: 9/9;
- optimized-browser benchmark: 2/2;
- `git diff --check`: clean.

An early aggregate correctly failed on the old health-anchor hash and was
fixed. Its next run completed every unit test but could not start game-flow
because an earlier local benchmark server still owned the worktree's Next dev
lock; that server was stopped and the clean aggregate above passed. A
pre-commit `check:generated` comparison correctly reported the intended
generated changes relative to `HEAD`; the post-commit determinism check remains
the authoritative form of that gate.

Fresh exact-head independent review, per-unit Ollama Cloud cross-model review,
protected CI, SHA-pinned merge, deployment observation, and production live
verification remain required.
