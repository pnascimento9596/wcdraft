# Narrow-viewport collision coverage and runner headroom

Date: 2026-07-16

Risk: YELLOW (no escalation trigger crossed)

Base: `7e6c2c3d3da1a0cedc19883ffdfa1847ac4f652f`

## Summary

This lane replaces surface-named collision checks with a default-closed browser assertion over
every App Router page. The exact general assertion is:

```sh
pnpm --filter @wcdraft/web verify:narrow-collisions
```

It currently covers 264 deterministic cells: 22 route/state recipes × 3 narrow viewports
(`320x568`, `360x800`, `390x844`) × 2 themes × 2 engines. The final implementation run passed
264/264 with zero failures and zero known-failure entries.

The reported fixed lower-left `N` is not shipped wcdraft UI. Measurement identified it as the
Next.js 16.2.10 development-tools button (`Open Next.js Dev Tools`) inside `nextjs-portal`. It
reproduced in every one of the 24 requested unsuppressed development cells and is absent from a
production `next start` build. The gate therefore suppresses development chrome with a
request-nonce-bearing style, positively verifies that the stylesheet attached and the portal is
hidden, then scans product geometry. Product layout is not distorted to make room for vendor
development chrome.

The general gate found and closed real product collisions that the prior named checks missed:
mobile draft-app-bar controls, sticky draft actions, squad-review actions, results recap text,
How-to-Play numerals, and overlapping 44px formation hit targets. The last defect was visible
only in WebKit at 320px after Chromium rounded past the intersection. No colour value changed.

## Architect-delegated decisions

### Treat the reported `N` as development chrome, not product geometry

The least-behavior-changing interpretation is to prove and suppress the Next.js development
overlay inside the harness rather than reserve shipped screen space for a control that production
does not render. This preserves product geometry and still prevents a false green: the gate fails
if suppression is disabled, the request nonce is unavailable, the nonce does not match, the
stylesheet is rejected, the portal remains visible, or the dev control reaches collision
hit-testing.

### Isolate collision validity from unrelated responsive gates

`verify:narrow-collisions` fails on console/page/HTTP errors, invalid dev-overlay suppression, and
every unexpected Class A or Class B finding. Existing target-size, one-screen, overflow, axe, and
mode-dock contracts continue to run in their own full responsive and one-screen gates. Mixing
those pre-existing contracts into the collision-only command would make the new general
assertion's cardinality and failure cause ambiguous; separating them does not weaken either gate.

### Sample settled deterministic states

The first full WebKit runs revealed duplicate slot-machine trees during daily-route hydration.
Those trees genuinely intersected for a transient frame but were absent after the route settled.
Collision mode now uses the harness's bounded network-idle settle (with explicit opt-out for the
intentionally pending fixture) before measuring. A Playwright execution-context/navigation race
is retried exactly once only after re-waiting, re-preparing the fixture, and reapplying suppression;
a second race or any other exception fails. No transient or product collision is allowlisted.

### Keep the disk floor hard and the recovery target best-effort

The dispatch makes 30 GiB the standing floor, requires conservative leave-if-unsure cleanup, and
explicitly allows an honest finding when safe reclamation cannot restore more headroom. Therefore
the least-behavior-changing interpretation is to fail a job only below the 30 GiB floor after
bounded cleanup, while retaining 36 GiB as the threshold that starts cleanup and emitting a CI
warning if marker-proven agent artifacts cannot restore it. Making the target a second hard floor
would force deletion of unmarked, owner-owned, uncertain, or in-flight paths to get CI green.

### Preserve fail-closed secret scanning with clean branch history

Protected CI run `29533755666` passed the static, full verify/build, and golden jobs but correctly
failed its incremental Gitleaks job on a credential-shaped synthetic HMAC input introduced in the
lane's first historical commit. The value is used only to produce a deterministic browser fixture;
it is never loaded from an environment, accepted by a deployed route, or used as a production
credential. Even so, an executable browser script is the wrong place for a lasting scanner
exception. The fixture now uses the explicit low-entropy placeholder `fixture`, `.gitleaks.toml`
is unchanged, and the branch is rebuilt as one commit directly on the unchanged base so the
flagged historical object is outside the PR scan range. This keeps the secret gate fail-closed
without adding a path, rule, commit, or fingerprint allowlist.

## U0 evidence

The complete blocking inventory remains at `/tmp/u0-collision-findings.md`; raw receipts are under
`/tmp/u0-collision/`.

### 3.1 `N` verdict

Confirmed in all 24 unsuppressed development cells: 3 viewports × 2 themes × 2 engines × 2
motion modes. The element is `nextjs-portal::shadow [data-nextjs-dev-tools-button]`, accessible
name `Open Next.js Dev Tools`. The portal is fixed to the lower-left viewport; its shadow button
paints over the in-flow `Squad warnings` panel. It makes the sampled warning text unreadable at
the covered points, but it is vendor development chrome. Production `next start` contains no
`nextjs-portal`.

### 3.2 literal report-only inventory

The evidence-only pass covered 252 cells (21 initially enumerated deterministic states × 3
viewports × 2 themes × 2 engines) and emitted 808 literal Class A hits, 0 Class B hits. Of those,
212 named the Next development-tools button. The remainder included true overlaps plus sticky
shell, same-control composition, and transient-state hits. U2 expanded the durable inventory to
22 states by separating author and recipient share recipes. The final 264-cell strict run has
zero unexpected findings and zero known failures, so 808/808 literal U0 findings are either fixed
or adjudicated by reusable semantic patterns; 0 are deferred.

### 3.3 raster carryover

The carryover is **real, not a phantom**. All 12 tracked artifacts are unconditionally regenerated
by `apps/web/scripts/generate-icons.mjs`, invoked by both `predev` and `prebuild`:

| Artifact                                     | Regenerated |
| -------------------------------------------- | ----------- |
| `apps/web/public/brand/logo-header.png`      | Yes         |
| `apps/web/public/icons/icon-32.png`          | Yes         |
| `apps/web/public/icons/icon-64.png`          | Yes         |
| `apps/web/public/icons/icon-120.png`         | Yes         |
| `apps/web/public/icons/icon-152.png`         | Yes         |
| `apps/web/public/icons/apple-touch-icon.png` | Yes         |
| `apps/web/public/icons/icon-192.png`         | Yes         |
| `apps/web/public/icons/icon-512.png`         | Yes         |
| `apps/web/app/icon.png`                      | Yes         |
| `apps/web/app/apple-icon.png`                | Yes         |
| `apps/web/public/favicon.ico`                | Yes         |
| `apps/web/app/favicon.ico`                   | Yes         |

This is an exposure finding, not a claim that current Darwin and Linux output bytes differ. None
of the 12 files changed in this lane.

### 3.4 disk attribution

The initial U0 snapshot had 27,537,176 KiB (**26.26 GiB**) free, below the 30 GiB floor. The
largest WCDraft-relevant source was accumulated disposable `/private/tmp` material, not the
active runner checkout. Measured consumers were:

| Consumer                          |                                       Size | Ownership and action                            |
| --------------------------------- | -----------------------------------------: | ----------------------------------------------- |
| `/private/tmp`                    | 31.881 GiB total; about 23 GiB agent-named | Reclaim explicit completed paths only           |
| 13 detached reviewer/repro clones |                                  17.06 GiB | Agent/CI-owned candidates                       |
| `/private/tmp/wcdraft-ci-*`       |                       4.516 GiB / 509 dirs | Agent/CI test scratch; bounded retention source |
| runner installation               |                                  3.515 GiB | Active agent/CI installation; retained          |
| runner `_work`                    |               2.774 GiB, 2.771 GiB `_tool` | Active tooling; retained                        |
| runner cache                      |                                  2.521 GiB | Active shared runner cache; retained            |
| shared Playwright cache           |                                  1.834 GiB | Shared/uncertain; retained                      |
| owner WCDraft `.turbo`            |                                  3.036 GiB | Owner checkout; never touched                   |
| AP portal `.next`                 |                                  3.524 GiB | Other project; never touched                    |
| system CoreSimulator              |                                  3.040 GiB | Owner/system toolchain; never touched           |
| Colima estate                     |                         29.897 GiB by `du` | Active other-project containers; never touched  |

The raw deletion commands reconcile to the 24 exact agent/CI-owned candidates in the pre-deletion
inventory; the later U3 section records that path-level proof and corrects an inaccurate
hand-written result. The observed `df` windows remain machine-wide measurements, however.
Concurrent unrelated agent work, measurement churn, and cutoff timing mean that claiming either
delta as exclusively reclaimed by this lane would still be false precision.

## U1/U2 implementation

### General definition

- Class A scans every visible control and substantive text range at its centroid plus four inset
  corners. `elementFromPoint` must return the owner, an ancestor, or a descendant.
- Class B separately enumerates visible painted `pointer-events:none` elements—including
  `aria-hidden` decoration, because ARIA does not suppress paint—checks true clipped rectangle
  intersections, temporarily enables hit-testing to verify stacking, and records only paint that
  is actually above a target.
- Receipts include stable selectors and semantic names (including native `label` associations),
  target rectangle, occluder rectangle, true
  intersection rectangle, sample point, document/nested scroll state, position, z-index, and
  semantic relationship flags.
- Discovery scans the document at bounded scroll positions plus every visible nested vertical
  scroller. App Router page inventory and route-to-recipe inventory are asserted against the
  filesystem so a new page fails closed until it gets a deterministic recipe.

### Pattern allowlist

There are two reusable patterns and **no surface-named entry**:

1. `same-interactive-composition` — sibling paint layers inside one semantic control share that
   control's hit target; the control border box is still adjudicated independently.
2. `scrolling-under-app-shell` — after user-equivalent scrolling, content may pass beneath a
   semantic fixed/sticky header or explicitly marked app shell; arbitrary positioned layers and
   every initial-paint overlap remain blocking.

The initially proposed formation-corner pattern was deleted after receipts proved that it hid
real overlapping 44px buttons. `NARROW_COLLISION_KNOWN_FAILURES` is empty.

### Geometry fixes

- Mobile app-bar columns and child min-widths prevent Draft/mode-chip collisions.
- Draft lock-bar positioning and scroll clearance prevent the bar from covering slot/OVR content.
- Review actions collapse to two columns and then one at 320px.
- Results recap becomes one column below 380px.
- How-to-Play numerals are explicitly decorative and pointer-transparent, while a reserved
  right-hand text gutter prevents their paint from intersecting headings or copy.
- Pick number/value spacing is explicit.
- Capped review pitches and all ≤340px squad pitches gain vertical space so 44px formation hit
  targets do not intersect, without changing canonical formation coordinates or golden snapshots.

## U3 recovery and drift control

The authoritative pre-deletion record is `/tmp/u3-recovery-inventory.json`: 24 exact
`agent/CI-owned` candidates totaling 18,375,704 KiB, plus 16 explicit skips. Its write completed at
05:18:33Z before the first successful deletion at 05:18:40Z. The authoritative reconciliation is
`/tmp/u3-recovery-correction.json`; it supersedes both the arithmetically incorrect
`/tmp/u3-recovery-execution.json` total and the path-inaccurate `/tmp/u3-recovery-result.json`.

The first cleanup removed five inventory candidates totaling 6,398,420 KiB. Available space moved
from 30,577,056 KiB immediately before that cleanup to 33,898,988 KiB immediately after, a
**3,321,932 KiB observed machine-wide delta**. The later cleanup removed the remaining 19
inventory candidates totaling 11,977,284 KiB. One 43,652 KiB browser-evidence directory was removed
immediately before the later exact `df` window; the remaining 18 were the only `deleted_kib=` paths
in that window. Available space moved from 29,836,956 KiB to 36,937,336 KiB around those 18
deletions, a **7,100,380 KiB observed machine-wide delta**. Directory-size totals and `df` deltas
remain separate because concurrent APFS activity makes byte attribution unsafe.

The 24 pre-inventoried deletions were:

```text
/private/tmp/wcdraft-review-u1-fixforward-b9406df
/private/tmp/wcdraft-review-u5-b9406df
/private/tmp/terrace-final-rereview-a9f21e0-clone-20260715
/private/tmp/wcdraft-pre-s2-verify-f045
/private/tmp/wcdraft-prev-repro-f04559f-review
/private/tmp/wcdraft-s4-red-review-53f0b2f-20260713-a
/private/tmp/wcdraft-s7-exact-review-9151147
/private/tmp/wave2-r4-review-59872a1
/private/tmp/wave2-r3-final-review-8ca5dc9.6GNJ2u
/private/tmp/wcdraft-s7-exact-review-63c2fef
/private/tmp/wave2-fresh-review-r1-clone
/private/tmp/wcdraft-s4-glm-9aa1c59
/private/tmp/wcdraft-canary-repro-d44ea31-review
/private/tmp/terrace-final-review-one-screen-78b2c604
/private/tmp/terrace-review-u1-fixforward-b9406df
/private/tmp/terrace-closeout-u4-matrix-b9406df
/private/tmp/terrace-closeout-one-screen-final-unit
/private/tmp/terrace-closeout-one-screen-dock-fix
/private/tmp/terrace-review-u1-proof
/private/tmp/terrace-review-u4-0a96010-evidence
/private/tmp/terrace-closeout-one-screen-post-u5
/private/tmp/terrace-closeout-one-screen
/private/tmp/terrace-closeout-one-screen-rerun2
/private/tmp/terrace-closeout-one-screen-final2
```

The original result JSON incorrectly substituted eleven `terrace-closeout-u5-*` names for the
eleven small, pre-inventoried Terrace paths actually present in the raw deletion output. No lane
deletion command or output names those substituted paths, so their separate disappearance is not
claimed by this lane. The result also substituted `/private/tmp/wcdraft-prev-s2-verify-f045` for
the first window's actual `/private/tmp/wcdraft-prev-repro-f04559f-review`. The reconciliation
preserves these errors explicitly rather than treating the hand-written result as execution truth.
The raw commands and their outputs prove that every path this lane actually deleted was in the
pre-deletion inventory, classified agent/CI-owned, and rechecked for active use; no owner-owned or
uncertain path appears in a deletion output.

Persistent-runner hygiene now makes that failure mode materially harder to repeat. It enforces a
30 GiB hard floor and a 36 GiB best-effort pre-lane target (the floor plus more than the
U0-observed maximum single-lane growth), begins bounded cleanup below the target, fails the job if
the floor is not restored, and emits a CI warning if safe cleanup cannot restore the target.
Eligible top-level temp names are limited to the measured agent namespaces
`wcdraft-*`, `terrace-*`, and `wave2-*`, must be older than 60 minutes, and must contain the exact
regular-file lifecycle marker `.wcdraft-agent-cleanup-ready` with value `cleanup-ready-v1`.
Prefix, age, and momentary process absence alone never authorize deletion: an isolated old,
unmarked `wcdraft-review-inflight-idle` probe is retained. Immediately before each marker-authorized
removal the script rejects symlinks, mount points, paths used as any process working directory,
process command references, linked worktrees whose common Git directory is external, and common
repositories that back a worktree outside the candidate. Tests exercise both linked-worktree
directions and a real sleeping process whose working directory is the candidate. This is an
operational producer-to-pruner contract, not an inert marker: completed responsive-shell audit
outputs and automatically allocated one-screen output write it only after their lifecycle
finishes, while explicit evidence output remains unmarked. The guarded
`mark-agent-temp-cleanup-ready.mts` finalizer provides the same positive handoff for a deliberately
completed lane path and rejects non-direct, symlinked, or unrecognized-prefix candidates. The
default finalizer roots match the pruner (`/private/tmp` plus Node's `TMPDIR`), with an explicit
root override for isolated tests; idempotency accepts only marker bytes that the shell consumer
also accepts and rejects trailing spaces, tabs, or carriage returns. The integration test invokes
that real finalizer, rejects a corrupt pre-existing marker, and then proves the start hook removes
its correctly marked output.

The first fresh exact-head U3 review at
`14bfccfb5e8c34be0c1187b7b05f2d6e34184695` correctly returned **FAIL** after mocking `lsof` to
exit with a diagnostic error while a completed-marker candidate was still an active process's
working directory. The old boolean pipeline treated the failed probe like an empty successful
result, and a command-only `ps` fallback could not recover a cwd absent from the process command.
The fix-forward makes the mount, Git common-dir/worktree, `lsof`, and `ps` probes result-aware:
command failures, parser failures, and impossible empty outputs preserve the candidate and emit a
warning. Adversarial tests inject status 2 for each of those four commands and prove that the
marker-authorized sentinel survives. A normal completed candidate remains removable, so the
change closes the fail-open edge without silently disabling bounded cleanup.

The 30 GiB floor is sustainable only with lane-close cleanup plus this 36 GiB recovery target; it
is not sustainable if reviewer clones and browser receipts accumulate indefinitely. No floor
reduction is needed. Xcode, simulators, DerivedData, Homebrew, containers, shared caches, the owner
checkout, and all uncertain classes remained outside the automation's eligible roots.

## Validation and reviews

- Focused responsive/collision contract: 21/21 passed, including browser proof for `aria-hidden`
  Class B paint, native label naming, fail-closed cell cardinality/identity, and rejection of
  unknown, empty, or duplicate engine filters before server startup.
- Pitch geometry and marking goldens: 20/20 passed; no snapshot relock.
- Runner hygiene contract: passed with the 30 GiB hard floor, 36 GiB best-effort recovery target, bounded
  namespace/age checks, two real browser-output marker producers, guarded lane finalizer,
  producer-to-pruner integration, idle-unmarked preservation, process-cwd guard, and
  bidirectional linked-worktree guard. Four injected diagnostic failures (`mount`, `lsof`, `ps`,
  and Git) each preserve the candidate and report the failed safety probe.
- Web typecheck: passed.
- Exact collision assertion: 264 metrics, 0 failures, 2 engines, 3 viewports, 2 themes, 4 groups.
- Full pre-remediation exact-head root gates: forced typecheck 9/9 tasks, forced lint 6/6 tasks,
  forced test 9/9 tasks, and forced build 5/5 tasks with all 40 pages and both 8/8 trace sets.
  Package totals were mobile 7, core 423, DB 161, marketing 69, data 183 plus 9 skips, and web
  1,365 plus one benchmark skip. The fixture-only remediation was then revalidated with the exact
  264-cell browser assertion, web typecheck, and the focused responsive contract (21/21).
- Clean-history Gitleaks v8.24.3 candidate range: one commit, about 100.12 KB scanned, no leaks.
- Golden suites: core 69, draft 42, data 59, integration 22, and leaderboard 6; pitch geometry
  20/20; native Chromium 180/180; native WebKit 180/180; font/accessibility 60 surfaces and 44
  targets with zero failures.

Fresh exact-head reviews and replacement protected CI remain mandatory pre-merge gates. Merge,
deployment, and production live checks necessarily occur after this report commit and are recorded
in the PR and task release handoff.
