# Production verifier incident — 2026-08-09

Status: **OPEN — Unit A candidate; Unit B diagnosis and Unit C production
re-verification are intentionally gated on this change merging first.**

## Incident boundary

The post-merge production verifier failed at `2026-08-09T07:53:04Z` with
`psql` status 2 on the first forbidden-count snapshot. It made no HTTP request
and captured no before snapshot. PR #348's credential containment behaved as
designed, but it erased both provider streams and left no category, so the
historical failure cannot be diagnosed from that receipt alone.

Current source was re-fetched before this lane. `origin/main` was
`f4d2da2e8ce27815fe5ce394be71104791f51e55`; PR #348 was merged at `c671755`
and the credential-rotation record at `f4d2da2`. Live Neon metadata bound the
observed production compute to project `rapid-wind-87431051` and branch
`br-blue-heart-aqcejtyf`. It recorded `last_active=2026-08-09T07:53:05Z`, one
second after the failed verifier timestamp, and later recorded suspension at
`2026-08-09T07:59:16Z`. This is evidence for a resume/connection-phase event,
not yet a root-cause verdict.

## Unit A — credential-safe diagnosability

`scripts/ci/external-tool-diagnostics.sh` is the shared classifier and renderer.
Captured stdout/stderr stay in mode-0600 private directories. Quiet, text-mode
pattern checks select exactly one category:

- `connection_refused`
- `timeout`
- `authentication_failure`
- `tls`
- `dns`
- `permission_denied`
- `query_error`
- `unknown`

No input substring is rendered. Recognized categories produce a fixed line with
the tool, phase, exact exit status, category, retryability, and an allowlisted
diagnostic token. `unknown` emits those same fixed fields with
`provider_output_withheld_unclassified`; the provider streams remain withheld.
Namespace, tool, and phase labels are exact allowlists too, so even accidental
caller metadata cannot become a reflection channel.
This restores operational meaning without making the safety of a redactor
depend on guessing every possible credential shape.

The production verifier adds an explicit read-only connection warm-up. Each
attempt has `PGCONNECT_TIMEOUT=10`; only `connection_refused`, `timeout`, and
`dns` can retry, with at most three attempts and 1-second/2-second backoff.
Forbidden-count snapshots, HTTP probes, and assertions remain single-shot. A
failed assertion is never replayed.

The Neon restore/Vercel rollback tooling sources the same classifier. Its
mutation rule is unchanged: a failed or timed-out restore request is classified
but never retried blindly.

## Unit A test evidence

The focused contracts pass locally:

- `scripts/ci/live-verify-production.test.sh`: credential-bearing
  connection failure preserves status/category; unclassifiable output degrades
  to `unknown`; all eight categories render fixed diagnostics from
  credential-bearing streams; hostile caller metadata is withheld; the
  successful output is unchanged; warm-up stops at three attempts; assertion
  SQL executes once; cookie-less CSRF requires exactly the three named
  bootstrap cookies, each with `Max-Age=300`.
- `scripts/ci/neon-vercel-recovery-runbook.test.sh`: classified and unknown
  credential-bearing curl failures surface no credential, URI, host, or
  authorization shape; success is unchanged; all 68 negative mutation cases,
  all four vendor sinks, and all six route orderings remain intact.
- Repository envelope: typecheck 9/9 tasks, lint 6/6 tasks, tests 9/9 tasks,
  build 5/5 tasks. Browser aggregates were 218/0 responsive-shell metrics,
  288/0 collision metrics, and 216/0 one-screen-fit metrics.

The full validation, exact-head reviews, protected CI, merge, and post-merge
verifier results are recorded in the PR body and in the follow-up disposition
update; they are not predeclared here.

## Unit E — standing secret-scan policy

`docs/runbooks/secret-scan-output-safety.md` now requires every implementation,
review, incident, and verification scan to compare exact values in process and
emit counts/classifications only. Raw matching lines, records, fragments, and
context are forbidden. Canonical owner-document adoption remains an owner
decision.

## Architect-delegated decisions

### Split implementation from incident closeout

The dispatch requires Unit A to merge before Units B and C, while the repository
requires review and CI before a Red merge. This lane therefore uses two ordered
PRs: the first ships Unit A plus the standing scan policy; the second records
the post-merge diagnosis, independent verifier rerun, and final `STATE.md`
disposition. This is the only interpretation that does not either diagnose with
unmerged tooling or claim a closeout before production evidence exists.

### Render canonical diagnostics, not redacted provider excerpts

Arbitrary provider prose has an open-ended secret grammar. Even a broad
replacement regex can preserve an unknown token fragment. The implementation
therefore retains the classified semantics and discards the prose: fixed
diagnostic tokens are a stricter form of sanitization and restore all requested
operational categories. Only genuinely unclassifiable streams degrade to the
withheld-output behavior.

### Warm the connection seam; never retry assertions

The chosen 3 × 10-second envelope is bounded, comfortably above Neon's
documented typical cold-start latency, and small enough to fail a real outage
promptly. Retrying only `SELECT 1` prevents a transient resume race from
manufacturing a failed gate while preserving the one-shot meaning of both count
snapshots and every product assertion.

## Required follow-up before closure

After Unit A is merged and deployed:

1. verify the plan and effective suspension setting from live Neon API truth;
2. validate the verifier's protected local target and runtime role without
   surfacing its URI, host, or credential;
3. reproduce a suspended direct connection and record safe timing/category
   evidence;
4. rule in or out local DNS/network, password-file, and fleet-teardown overlap;
5. run the complete production verifier, and repeat after the compute crosses
   the effective suspend threshold if scale-to-zero is implicated;
6. obtain a fresh GLM 5.2 maximum-reasoning reviewer rerun and compare its
   independent observations to the script verdict; and
7. update this report and `STATE.md` with an explicit CLOSED or OPEN result.
