# q-001 — micro-Yellow polish bundle

- **Tier:** Yellow · **Mode:** `SELF-SERVE:YELLOW`
- **Status:** OPEN
- **Origin:** verified non-blocking findings from the season-merge live verification,
  PR #62 review, and the F-4 U3 independent review.

Five small, display/docs-only debts. One branch (`ws-ux/micro-yellow-1` or similar),
one PR; each fix is independent — drop any that turns out to be load-bearing and note it.

## Spec

1. **Reveal synergy float** — hidden-mode (Memory) reveal shows an unrounded synergy
   value (observed live: `18.649350649350648`). Round/format at the display seam only;
   classic mode and stored run records untouched.
2. **Narrative label coverage** — narrative honest-fallback renders raw card ids
   ("P-08566's") / "Unavailable" when the labels map lacks an entry (pre-existing,
   observed live). Fix the label-map coverage or the fallback copy at the display layer;
   do NOT touch the narrative package's generation semantics.
3. **generate-sim-golden exceptions ledger** — `packages/core/scripts/generate-sim-golden.ts`
   header still states the unconditional "diff → engine_version bump" rule; the second
   sanctioned exception (PR #62 family) is un-annotated. Docs/comment change only:
   annotate the bump-ledger exceptions honestly.
4. **Prettier sweep of `apps/web/lib/leaderboard/`** — known drift (~12 files; prettier
   --check is NOT a CI gate). Run prettier on that directory only, zero logic diff
   (verify with `git diff -w` reading + tests).
5. **U3's five non-blocking carryovers** (from the PR #70 independent review):
   (a) submit-route comment overclaims "same DB snapshot as the insert" — fix comment to
   say rank is a second statement (honest CURRENT rank); (b) `MAX_SUBMIT_BODY_BYTES`
   compares `raw.length` chars, not bytes — compare byte length; (c) live+cookie+missing
   `AUTH_COOKIE_SECRET` throws a plain `Error` (500) — make it a typed AuthError with the
   same status; (d) prettier drift — covered by the lib/leaderboard sweep above; (e) light→dark flag flip can serve a stale board
   for ≤30s+SWR120 — add cache-control note or shorten s-maxage on the board route
   (document the choice; dark 404 is never cached, so security posture is unchanged).

## Done-when

- All five addressed (or explicitly dropped with reason in the PR body).
- No rating/sim/schema/auth semantics change; `@wcdraft/web` suite green; root
  typecheck/lint/test/build green; golden suites untouched and green.
- STATE.md updated in the same PR.

## Evidence required

Per-package test counts before/after · `git diff` scoped to the named surfaces ·
for item 1, a screenshot or DOM extract of the rounded reveal value.
