# merit-v4 Independent Red-Tier Review — 2026-06-13

Outcome: **BLOCKED / not approved for merge**.

Reviewer role: fresh-session independent Red-tier reviewer for the `merit-v4` ratings rebuild candidate in `/tmp/merit-v4`.

Reviewed inputs:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/reports/merit-v4-ratings-rebuild-2026-06-13.md`
- RepoPrompt git status/diff/log against `origin/main`
- Direct repository searches in generated/source JSON artifacts where available

## Findings first

### Blocker 1 — Required Red-tier gates were not re-executable in this session

The review request requires this reviewer to independently re-run, at minimum:

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`
- `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`
- `cd etl && ruff check src tests && pytest -q`
- `pnpm --filter @wcdraft/data test:realism:heavy`
- `git diff --check`

This Agent Mode session exposes RepoPrompt read/edit/git APIs, but no shell/command execution tool. Because I could not execute those commands myself, I cannot satisfy the Red-tier independent-review gate. I am therefore **not approving this candidate for merge**.

I am explicitly not relying on the implementer report's claimed passing gates as independent evidence. Those claims may be accurate, but Red-tier requires re-execution by the independent reviewer.

### Blocker 2 — Candidate changes are not represented by `HEAD`; they are working-tree changes

RepoPrompt git status reports:

- Worktree: `merit-v4@b4d7fe8`
- Main checkout: `main@b4d7fe8`
- Branch relationship: `merit-v4 → origin/main`
- Working tree: `57 modified · 39 untracked`

RepoPrompt git diff against `origin/main` reports:

- `57 files` changed in tracked diff
- `+1,551,854 / -234,824`
- This tracked diff omits the 39 untracked files listed by status, including the implementer report itself and new generated/source artifacts.

This means the implementer report's claim that `HEAD`, `origin/main`, and merge-base all equal `b4d7fe89a4c6ceb71071d6ee530eae4b4436815d` can be true only because the candidate is currently an uncommitted working-tree candidate on top of `origin/main`, not because a reviewable branch commit contains the candidate. That is a release-process blocker for Red-tier SHA-pinned approval: there is no candidate commit SHA containing the changes to approve or pass to `gh pr merge --squash --match-head-commit <sha>`.

Practical consequence: before final approval, the candidate must be committed/pushed or otherwise materialized as a stable reviewable SHA, and the independent gate suite must be re-run against that exact SHA/worktree state. Any post-review commit voids approval under `CLAUDE.md` / `AGENTS.md`.

### No source-code blockers independently proven beyond process/gate blockage

I did not identify a concrete code/data defect from the limited read-only inspection I could perform. However, because required gates and full JSON spot-check computations could not be executed, this review cannot clear the candidate.

## Gate evidence / counts

### Contract and report inspection

Read successfully:

- `CLAUDE.md`, lines 1–82
- `AGENTS.md`, lines 1–82
- `docs/reports/merit-v4-ratings-rebuild-2026-06-13.md`, lines 1–277

Relevant Red-tier contract points confirmed from `CLAUDE.md` / `AGENTS.md`:

- Red-tier scope includes ETL/rating, sim/engine, draft/synergy semantics, leaderboard, deploy/env, and user-facing security.
- Red-tier gate requires a fresh-session independent reviewer who re-executes the gates.
- Owner approval is SHA-pinned; any commit after approval voids it.
- Rating-version bumps require canary regeneration and proof of pick changes/equality as applicable.
- ETL output must be deterministic and committed output must be byte-stable after clean rebuild.

### Git alignment / diff evidence

RepoPrompt `git status` evidence:

```text
Worktree `merit-v4`: merit-v4@b4d7fe8
Main checkout: `/Users/paulo/Projects/wcdraft` (main@b4d7fe8)

merit-v4 → origin/main

57 modified · 39 untracked
```

RepoPrompt `git diff --compare origin/main --detail files --detect-renames` evidence:

```text
Compare: origin/main
57 files (+1551854 -234824)
Status: M:57
```

RepoPrompt `git log --count 5` top commit evidence:

```text
b4d7fe8 docs: adopt orphaned-but-real agent contract, investigations, merit-l...
aa8a5ff chore(repo): harden .gitignore against agent scratch + root review ca...
e734211 feat(core): expand deterministic narrative scenarios
c195f87 feat(web): render per-run share OG images
88ae0c3 Run merit-v3.1 curation season (#125)
```

Assessment:

- The worktree and main checkout are both reported at `b4d7fe8`.
- The candidate diff is a dirty working tree, not committed branch history ahead of `origin/main`.
- The implementer report's alignment claim is therefore materially incomplete for Red-tier release approval: it confirms no rebase is needed for the checked-out commit, but it does not provide a candidate SHA containing the changed files.

### Required command gates

Not run by this reviewer due missing command execution tool in this session:

| Gate | Independent reviewer result |
| --- | --- |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | **NOT RUN — blocker** |
| `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core` | **NOT RUN — blocker** |
| `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data` | **NOT RUN — blocker** |
| `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web` | **NOT RUN — blocker** |
| `cd etl && ruff check src tests && pytest -q` | **NOT RUN — blocker** |
| `pnpm --filter @wcdraft/data test:realism:heavy` | **NOT RUN — blocker** |
| `git diff --check` | **NOT RUN — blocker** |

The implementer report claims these passed, including counts such as root package tests and ETL `297 passed`, but I did not independently verify them.

## JSON/source spot checks performed

Because there is no shell/JSON query runner in this session, I could not compute aggregate counts such as exact `0.62` count, 90+ rarity, weak-nation share, or squad distributions directly from JSON. I did perform targeted RepoPrompt content searches in generated/source artifacts.

### Objective/source-fact anchors found

Searches in `etl/output/merit/source_facts.json` / related merit output found supporting source-fact records for several reported anchors:

- Son source fact present: Premier League claim that Son Heung-min and Mohamed Salah shared the 2021/22 Golden Boot with 23 goals.
- Gareth Bale source facts present: `player_id` `P-63927`, `player_name` `Gareth Bale`, `source_id` `research_objective_club_honors`, and Real Madrid official-profile claim that he won five European Cups between 2014 and 2022.
- Zlatan Ibrahimović source facts present: `player_id` `P-80105` with multiple Sweden annual-recognition rows.
- Erling Haaland active-career facts present: `player_id` `P-W26-0477`, `player_name` `Erling Haaland`, active staging row, and active source facts including `active_club_season_honors`, ESM, FIFPRO, etc.

These searches support the presence of source-fact inputs, but they do **not** independently verify final display ratings, final card rows, or population statistics.

### Card ID searches

Searches for historical card IDs such as `P-77335:2022`, `P-63927:2022`, and `P-80105:2002` did not find direct string matches in `packages/data/src/generated` or `etl/output`. `P-W26-0477:2026` was found in `packages/data/src/generated/scenario-2026.compact.json` as a 2026 scenario entry.

This suggests historical compact/runtime artifacts may encode IDs differently or not retain those exact `player_id:year` strings in searchable JSON. I did not infer final values from missing string matches.

### Required aggregate spot checks not completed

The following user-requested spot checks remain **not independently verified** by this reviewer:

- Son/Bale/Ibrahimovic/Haaland final rating values from generated JSON
- 88-wall reduction / exact 88 display count
- exact `raw_only_score == 0.62` count
- exact `raw_only_ceiling == 0.62` count
- 90+ rarity counts/shares
- weak-nation share
- South Korea 2022 squad-wall distribution and top-card claim
- Saudi Arabia 2022 squad-wall distribution and max-cluster claim

Reason: no shell/JSON execution tool was available to compute these safely from the large generated JSON artifacts.

## Residual risks / open questions

1. **Materialization risk:** The candidate should be committed/pushed as a stable SHA before Red-tier approval. Approving an uncommitted working tree is not compatible with SHA-pinned approval or `--match-head-commit` protection.
2. **Untracked-file risk:** `39` untracked files include source/output artifacts that appear material to the candidate. They are not included in tracked `git diff` output and must be explicitly staged/committed if intended for ship.
3. **Gate-evidence risk:** All required gates must be re-run by an independent reviewer with command execution available. Implementer-reported pass counts are insufficient for this Red-tier review.
4. **Data-stat risk:** The headline population and squad-wall claims remain unverified by this reviewer and need direct JSON computation before approval.
5. **Production-risk reminder:** Per contract, merge to `main` auto-deploys production. If this candidate proceeds after a valid independent review, it still requires explicit SHA-pinned human approval, squash merge with `--match-head-commit`, deploy READY confirmation, and live sanity checks.

## Recommendation

Do **not** approve or merge this candidate from the current state.

Recommended next step:

1. Stage explicit intended paths only and create a candidate commit/PR SHA containing all tracked and currently untracked intended artifacts.
2. Start a fresh independent review session with shell command execution available.
3. Re-run the full required gate suite and direct JSON spot-check scripts against that exact SHA.
4. If clean, request explicit owner SHA-pinned approval and merge only with `gh pr merge --squash --match-head-commit <sha>`.
