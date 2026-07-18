# Post-hoc independent review — PR #316 (review-discipline repair)

**Date:** 2026-07-18  
**Repo:** `pnascimento9596/wcdraft`  
**PR:** [#316](https://github.com/pnascimento9596/wcdraft/pull/316) — `feat(ci): hygiene install drift guard + disk reclaim report`  
**Merge SHA (exact head reviewed):** `521ff6247be73de78da90cb4833482b2690baabf`  
**Base:** `dca08420fa57ff7595d7f7a0997671540e07faf4`  
**Disposable clone:** `/private/tmp/wcdraft-pr316-posthoc-PRuWqh` (via `create:disposable-clone`, detached at merge SHA)  
**Risk of original PR:** Yellow (CI scripts/tests/report/STATE only)

## Why this review exists

PR #316 merged live-green with its required lane-boundary independent review improperly
substituted as "self + CI contract proof." Standing rule: when cross-model reviewers are
unreachable, the substitution is a **second independent fresh-context subagent** — never self,
and CI is not a review. The change stays merged; this lane retroactively supplies the missing
independent verdict so the skip does not become precedent.

## Verdict

**PASS**

No product defects. No fix-forward required.

Review-of-record: **Claude Code CLI · `claude-opus-4-8` · effort `high`** (independent process,
fresh disposable clone, read-only tool allowlist).

## Reviewer attempts (verbatim outcomes)

### 1. `opencode` → GLM 5.2 max — UNREACHABLE / aborted

**Attempt A — `ollama run glm-5.2:cloud`:**

```text
Error: 429 Too Many Requests: you (pnascimento9596) have reached your weekly usage limit, upgrade for higher limits: https://ollama.com/upgrade or add extra usage: https://ollama.com/settings (ref: e6f0e726-aa1a-4a07-b0f2-fba22de05682)
```

**Attempt B — `opencode run -m opencode-go/glm-5.2 --variant max` with `--file` brief:**

```text
Error: File not found: Independent review of wcdraft PR #316 at merge 521ff62. Read the attached brief and source. Reply with VERDICT: PASS or VERDICT: FAIL and numbered defects only. No product changes.
```

**Attempt C — `opencode run --model opencode-go/glm-5.2 --variant max` with embedded brief:** hung / aborted; operator directed skip of GLM.

**Operator directive (this session):** "can't use glm, use claude code cli and opus 4.8 instead"

### 2. `xai/grok-4.5` via OpenCode — NOT invoked as review-of-record

Not used as the independent review-of-record for this post-hoc (same-family risk relative to the
lane runner; operator directed Claude Code Opus 4.8 as the substitute for the GLM step).

### 3. Claude Code CLI · `claude-opus-4-8` · `--effort high` — REACHABLE · **PASS**

**Invocation:**

```text
claude auth status → loggedIn=true, authMethod=claude.ai, subscriptionType=max
claude -p --model claude-opus-4-8 --effort high \
  --allowedTools "Read,Bash,Glob,Grep" \
  (cwd = disposable clone at 521ff62)
exit=0
```

**Verbatim outcome:**

```text
Re-read all artifacts at HEAD `521ff62`, ran the contract test, and diffed base→head. Findings:

- **Exit semantics correct**: 0 for match/skip, 1 for drift/missing-when-required, 2 for config error (missing repo source). Verified by reading and by the contract test passing (`rc=0`).
- **Red control is fixture-only**: `WCDRAFT_HYGIENE_DRIFT_FIXTURE` points at a `mktemp` dir; the drift injection appends to the fixture copy, never the live install. Test confirms.
- **No false-red on GH-hosted**: when install root is absent and `WCDRAFT_HYGIENE_DRIFT_REQUIRE` unset, `require_install` auto-defaults to 0 → clean SKIP (exit 0). The added steps also only run on `[self-hosted, macOS, ARM64, wcdraft]`, so GH-hosted never executes them regardless.
- **Symlink installed script treated as drift**: `[ -L ]` check (lines 92–96) fires before the SHA compare and exits 1.
- **STATE.md / report**: both explicitly state no product/runtime/data/schema/rating/draft/sim/auth/leaderboard/deploy contract changed; report is receipts-only and marks live engine anchor `engine-2026.07.18-basis-aware-tiering` unchanged. No fabricated product-anchor changes. Diff is scoped to ci.yml (+6), STATE.md, one report, and the two new scripts — no product/runtime files.
- Scripts are `-rwxr-xr-x` (executable, as the test asserts); referenced `install-runner-disk-maintenance.sh`, `self-hosted-runner-hygiene.sh`, `runner-disk-maintenance.sh` all present.

Non-blocking note (not a defect under the stated criteria): on a self-hosted runner where the install root legitimately does not yet exist, auto-defaulting `require=0` silently skips rather than reds — a coverage gap, but no false-red and no live mutation.

VERDICT: PASS
```

## Scope reviewed (exact head)

| Path                                                  | Role                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `scripts/ci/check-hygiene-install-drift.sh`           | SHA-256 install-vs-HEAD drift check; `HYGIENE_INSTALL_DRIFT` |
| `scripts/ci/check-hygiene-install-drift.test.sh`      | match / red control / skip / require-missing                 |
| `.github/workflows/ci.yml`                            | contract probe + live check steps                            |
| `docs/reports/disk-reclaim-tier1-tier2-2026-07-18.md` | host reclaim receipts report                                 |
| `STATE.md`                                            | hygiene install drift guard entry                            |

No installer product surface changed in the PR diff itself; host reinstall was operational (pre-merge lane work) and is re-verified below.

## Red-control re-execution (this lane)

From disposable clone at `521ff62`:

```text
$ scripts/ci/check-hygiene-install-drift.test.sh
hygiene-install-drift contract: PASS (match, simulated-drift red control, skip-when-unreachable, require-missing)
test_exit=0
```

Manual fixture red control (never mutates live install):

```text
red_control_exit=1
stderr:
HYGIENE_INSTALL_DRIFT script=self-hosted-runner-hygiene.sh repo_sha=e4411630a2984a1c3ee6ed73554d09770ba3b9e03b9d63e2c9609ddb28be2c6c installed_sha=70ee0c10f56c441fb8c4d77c115f277195c1eb15daa90a35e28e43e55fa75076 path=/tmp/wcdraft-hygiene-red-…/self-hosted-runner-hygiene.sh
::error::HYGIENE_INSTALL_DRIFT: installed self-hosted-runner-hygiene.sh diverges from repository HEAD. Re-run scripts/ci/install-runner-disk-maintenance.sh install.
LIVE_UNTOUCHED=yes
```

## Host SHA re-check + residue audit

Live install under `/Users/paulo/actions-runner-wcdraft/wcdraft-maintenance/` vs HEAD `521ff62`:

| Script                          | Repo SHA-256                                                       | Installed SHA-256 | Match |
| ------------------------------- | ------------------------------------------------------------------ | ----------------- | ----- |
| `self-hosted-runner-hygiene.sh` | `e4411630a2984a1c3ee6ed73554d09770ba3b9e03b9d63e2c9609ddb28be2c6c` | same              | yes   |
| `runner-disk-maintenance.sh`    | `b14f215a693aacfb370c6bb8d99ed8b8970e6acbb13cfc307f7cc4238838e867` | same              | yes   |

```text
$ scripts/ci/check-hygiene-install-drift.sh
hygiene-install-drift: ok script=self-hosted-runner-hygiene.sh sha=e4411630…
hygiene-install-drift: ok script=runner-disk-maintenance.sh sha=b14f215a…
hygiene-install-drift: PASS
```

LaunchAgent `gui/501/com.wcdraft.runner-disk-maintenance`: program path exact, last exit 0, runs=4 at review time.

Kickstart / interval receipts (hygiene-completed) include reinstall-era:

```json
{
  "schema": "wcdraft-runner-maintenance-v1",
  "started_at": "2026-07-18T22:07:22Z",
  "completed_at": "2026-07-18T22:07:24Z",
  "trigger": "launchd-interval",
  "status": "PASS",
  "reason": "hygiene-completed",
  "before_kb": 123216972,
  "after_kb": 123216860
}
```

Residue audit still runs (report-only warnings):

```text
runner-hygiene: unmarked-residue-audit count=29 threshold_minutes=60
```

(Observed repeatedly in `/Users/paulo/Library/Logs/com.wcdraft.runner-disk-maintenance/stdout.log` after the #315 hygiene reinstall.)

## Independent assessment (lane corroboration)

Agrees with Claude Opus 4.8 PASS:

1. Red control is env/fixture-scoped only; live install hash unchanged after red control.
2. Default require logic skips cleanly when install root is missing (no GH-hosted false red).
3. Symlinks are fail-closed as drift.
4. Diff is CI/docs/STATE only; product/runtime/schema/rating anchors untouched.
5. Non-blocking note on silent skip when install root absent on self-hosted is accepted as coverage gap, not a blocker for this post-hoc.

## Standing reminder (review discipline)

**"Unavailable in this runtime" is never satisfied by self-review.**  
The substitution ladder for a required independent review ends at a **second fresh-context
subagent**, recorded. CI green / contract-test self-execution is evidence of machine gates, not a
reviewer verdict. This report is the review-of-record for PR #316.

## Authorization boundary

This PASS covers only merge SHA `521ff6247be73de78da90cb4833482b2690baabf` as already shipped.
It does not re-open product scope. Any subsequent change to the drift-guard scripts voids this
verdict for those scripts and requires a new SHA-pinned review.
