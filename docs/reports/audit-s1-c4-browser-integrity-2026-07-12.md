# Audit S1 C4 — browser runtime-data integrity

Date: 2026-07-12
Risk: RED
Branch: `ws-f4/audit-s1-runtime-digest`
Base: `06b5f914dc3253bda17b9ac8fa93cae0fc127b63`

## Outcome

The browser loader now authorizes every required or deferred runtime bundle
with the one manifest selected for the session. It checks the exact decoded
byte length and SHA-256 before decoding, parsing, constructing `GameData`, or
recording version anchors. Integrity failures fail closed as typed
`RuntimeDataIntegrityError` values and are translated to stable player-facing
copy without technical details.

Required pool, optional Daily metadata, deferred scenario, and optional score
distribution all use the selected manifest. C3's service-worker handoff remains
before revision-bearing requests, D1's shared request budget/signal remains in
force, and C5's current and retained artifact bytes/paths are unchanged.

## Fresh review and fix-forward

The first independent exact-head review at
`929ae522284fb870ab2613f718b60b176fe34aa9` returned **FAIL**. The complete raw
review is `/tmp/audit-s1-c4-review-929ae52.md` in the implementation environment
(SHA-256 `321a67c80d9c0f5fe8a052ef6829fb6717e8264a60f85d7e09dfae84c61d263d`).
It identified three release blockers:

1. the decoded 130 MB path had no committed browser performance/memory gate;
2. runtime-data error panels outside draft setup lacked an explicit Home action;
3. optional Daily/reference loaders failed soft without retaining the typed
   technical cause in the console.

Fix-forward adds a reproducible real-Chrome benchmark, mounted Retry + Home
coverage across Draft, History, Review, Results, and Share, and fail-soft tests
that prove the typed Daily/reference cause remains available to operators while
the player still receives `false`/`null`. It also rewrites one synthetic test
expectation that gitleaks classified as a generic key; the focused gitleaks scan
now reports no leaks.

Any fix-forward commit voids the first review. A second fresh exact-head review
must re-execute the gates and return PASS before merge.

The second fresh review at `93bfce16b72543af2f5e80e0c42b091c60693f61`
closed all four substantive defects and independently reproduced the benchmark,
but correctly returned **FAIL** because `git diff --check` found Markdown
hard-break spaces on this report's Date/Risk/Branch lines. Its raw report is
`/tmp/audit-s1-c4-rereview-93bfce1.md` (SHA-256
`d59a7985c9adf7e642df754e21bcd795894f6c5647d92364600526cae6b29c7b`). The
spaces are removed in the next fix-forward. Because that changes the SHA, a
third fresh exact-head review remains mandatory even though the reviewer found
no additional runtime blocker.

## Decoded-byte benchmark

Command (against a production Next server built from the candidate):

```sh
BASE_URL=http://127.0.0.1:51778 pnpm --filter web benchmark:runtime-data-browser
```

The executable gate launches a fresh Chrome process for each case, constrains
the V8 old-space ceiling to 1 GiB, loads the real `/play/draft` route and exact
versioned Brotli asset, waits for interactive setup, verifies the browser saw
130,545,042 decoded bytes, and samples the full descendant process-tree RSS. It
requires setup readiness within 10 seconds and sampled process-tree RSS below
3,000 MiB. The RSS figure includes Chrome, renderer, GPU/network helpers, and
the small benchmark Node parent; it is intentionally conservative.

| Case                                    | Setup ready | Resource | Decoded bytes | Settled JS heap | Peak sampled process RSS |
| --------------------------------------- | ----------: | -------: | ------------: | --------------: | -----------------------: |
| Desktop 1366×768                        |    1,588 ms |   146 ms |   130,545,042 |          83 MiB |                2,641 MiB |
| Mobile 390×844, touch, 1 GiB V8 ceiling |    1,551 ms |   146 ms |   130,545,042 |          90 MiB |                2,661 MiB |

The earlier review's Node proxy measured the new verify/decode/parse loader at
518 ms and +894 MiB RSS versus 324 ms and +645 MiB for `Response.json()`
(+194 ms / +249 MiB). That proxy exposed the risk; the production-browser gate
above is the release adjudication. E1 will subsequently reduce the decoded
artifact from 130 MB to approximately 68 MB, but C4 does not rely on that future
change to pass.

WebKit/Safari memory instrumentation is not available in this runner and is
recorded as **NOT RUN**, not inferred from Chrome. The mobile Chrome case is the
bounded mobile-profile evidence for this unit.

## Validation

- first exact-head reviewer re-executed data integrity/binding: 11/11;
- first exact-head reviewer re-executed web focused: 23/23;
- first exact-head reviewer additional SW/reference/run-loader: 42/42;
- fix-forward focused data integrity/binding: 11/11;
- fix-forward focused mounted/diagnostic coverage: 15/15;
- data and web typechecks pass;
- real-browser benchmark passes both cases;
- focused gitleaks scan of the flagged test reports no leaks.
- complete fix-forward root test: 8/8 tasks, 1,929 executed tests with ten
  expected opt-in skips, game-flow green, responsive adjudication 218/0;
- root typecheck 8/8, lint 5/5, build 4/4, generated-artifact check and
  formatting pass.

Dedicated golden runs from the unchanged runtime implementation pass core
69+42, data 54+22, and leaderboard 6. Protected CI, second fresh exact-head
review, merge, deployment observation, and production live proof remain
required at the final candidate.
