# Draft-config season — E1+E2+E3 chained build report (2026-06-11)

**Spec of record:** `docs/plans/draft-config-2026-06-10.md`.
**Integration branch:** `engine-draft-config` off `origin/main` `b41b8e0`.
**Process:** Lead-Architect-sanctioned single-session chained build; sub-unit
PRs self-merged into the integration branch on green CI; ONE consolidated
fresh-session review covers the cumulative branch diff (this report scopes
it). The season merge to main remains full Red (independent review + owner
approval).

## Outcome

All three units SHIPPED to the integration branch:

| Unit | PR | Squash SHA on `engine-draft-config` |
| ---- | -- | ----------------------------------- |
| E1 / DC-1 — `t2.` token & config schema | #94 | `8be0627` |
| E2 / DC-2 — era-preset bounded sampling | #95 | `7d5803b` |
| E3 / DC-3 — position-first state machine | #96 | (head `088629a` + docs commit; merged on green CI) |

Owner ratifications honored: ranked = canonical config only; era presets only
(no slider); naming Career/Current; integration branch `engine-draft-config`.
The rating-basis VALUE stays excluded (gated on merit-v3/MV2-12b) — its token
field ships now, locked to default, so no second token evolution is needed.

## Per-unit summary

### E1 / DC-1 — token & config schema (plan §A)

- `t2.<base64url>` body: `{v:2, rid, fid, ps, tn, md, df, rb, ef:{id,min,max},
  pl, sv..hv}`. `ef` carries RESOLVED bounds; decode rejects bounds that
  disagree with the build's `ERA_PRESETS` table (a relabel/tamper cannot
  reinterpret old tokens). Per-pick `ts` target field: required + coherent
  under `position_first` (`ts === s` / `"manager"`), optional-but-coherent
  under `squad_first`.
- `t1.` decode-compat forever: decodes AS the default config; the committed
  leaderboard t1 goldens still ACCEPT (canonical-by-compatibility proof).
  Encode emits `t2.` for every new run.
- `DraftState` stores `draft_flow` / `rating_basis` / `era_preset` explicitly
  (plan §G — config is never inferred from URL state). `createDraft` REFUSES
  config the build does not implement; `rating_basis: "current"` is refused at
  create AND at token replay (no fake fallback).
- Future `t3.` links get an honest "newer version" notice on results/share
  (`isNewerRunTokenVersion`); the API keeps `MALFORMED_TOKEN` for undecodable
  tokens (documented choice — wire-code union unchanged).
- Committed PREV-skew fixtures (plan §A list, all four classes) +
  `gen:token-skew` generator with decoder self-checks
  (`apps/web/lib/game/__tests__/fixtures/run-token-skew.json`).
- Leaderboard: new `NON_CANONICAL_CONFIG` (HTTP 422) gate directly after the
  season check — O(1), before name/replay. Negative tests per axis
  (`rb: current`, each non-default `ef`, `df: position_first` with coherent
  `ts` log) + gate-order lock. **Scope note for review:** canonical means the
  three NEW axes; the pre-existing Classic/Memory `md` lanes remain accepted
  exactly as the live board does today (changing `md` policy is DC-8,
  HUMAN-gated).

### E2 / DC-2 — era presets (plan §B)

- `filterDraftDataset(dataset, preset)` (pure, year-bounded, inclusive) +
  `buildDraftCatalog(dataset, era_preset)`; catalog carries an `era` stamp +
  `hasRareEra`. `createDraft` cross-checks preset vs catalog stamp — a draft
  can never record a preset its catalog did not enforce.
- Era masses recompute inside the filtered catalog via the UNCHANGED E-1
  algorithm; all-modern presets collapse to 0/1 mass through the existing
  single-era branch (analytic tests: 0.10/0.90 all-time, 0/1 modern presets).
  With-replacement + global dedup + depletion-advance untouched;
  `draw_probability` is per-preset-true by construction.
- Web: `getCatalogForEra` — **all_time returns `gameData.catalog` by object
  identity**; non-default catalogs build lazily once per (GameData, preset).
  Threaded through run creation, the pick transitions (fixed mid-build — see
  "found-and-fixed" below), and token replay.
- UI: collapsed "Draft setup" row on the formation-lock screen (plan §G;
  /play two-card select untouched; one-viewport compaction preserved). Spin
  reveal's Era tile shows the preset label (`Modern (2018–2026)`) for
  non-default pools; RARE copy cannot render there (no rare spins exist).

### E3 / DC-3 — position first (plan §C)

- Real commitment boundary: `Spin.target_slot_id` + `awaiting_slot`
  placeholder lifecycle. A position-first draft materializes NO draw before
  the target commit (sentinel placeholder shape schema-enforced — persisted
  state cannot leak an un-earned reveal).
- `selectDraftTarget` consumes the SAME per-index RNG value squad_first uses
  (cross-flow (T,N)-equality test proves it). The target never changes
  sampling — only candidate exposure (slot → players only; `manager` → that
  squad's coach only). Targets immutable once rolled.
- Dead-end handling per plan: `DraftTargetDeadEndError`, spin NOT consumed,
  no silent reroll, no hidden seed advance; the UI shows a blocking notice
  and returns to target selection.
- Manager rules: ≤1 manager unchanged; target disappears once drafted; strand
  guard — final unresolved spin with no manager admits ONLY the manager
  target (+ defensive pickPlayer guard). No-GK stays soft.
- Hidden-mode walk: target selector exposes keep-set data only (slot ids,
  positions, fill state); candidate masking rides the single
  `blindCardRatingView` seam (leak test on a rolled position-first spin —
  overall/channels null, badge `masked`). Sorting in Memory still defaults to
  name (pre-existing behavior).
- Token: `ts` emitted on every pick of a position-first run; replay walks
  `selectDraftTarget` per pick; decode rejects `ts ≠ s`, the engine rejects
  pick-vs-target divergence.

## Golden census

| Golden | Status |
| ------ | ------ |
| `packages/core/test/fixtures/draft-golden.json` | regenerated twice: E1 diff = +3 config fields; E3 diff = +17 `target_slot_id: null` lines. Zero spin/pick changes. |
| `packages/data/test/fixtures/e2e-real-run-golden.json` (seed `:29`) | regenerated twice, fields-only diffs identical in kind; sim output byte-identical. |
| `packages/data/test/fixtures/era-presets-golden.json` | NEW (E2): one deterministic draft per preset from one seed; ZERO diff under E3 (picks unchanged). Runs under `test:golden:integration` (already-registered turbo task — no new task needed). |
| Era census lock | NEW (E2): per-preset pool depth matches the plan's measured table EXACTLY (12219/501/537 · 5757/193/240 · 3549/96/144 · 2813/64/112 + coarse coverage) + `2026-only` zero-manager invalidity lock. |
| `run-token-skew.json` | NEW (E1): 4 committed PREV-skew fixtures (prev t1 / prev t2 default / prev t2 non-default / tampered current t2). |
| `leaderboard-validate-golden.json` | UNTOUCHED and green — committed t1 tokens still accept (t1-compat + no-anchor-change proof). |
| RNG / sim / lock-on-pick / position-compat goldens | untouched, green. |
| Strategic-pick canary + realism gates | untouched; heavy realism (N=2000 × 3 policies) green in CI on every unit PR. |

## Canonical-config invariance probe

- Default-config catalog: `getCatalogForEra(gd,"all_time") === gd.catalog`
  (object identity, tested), and `buildDraftCatalog(ds)` content-equals
  `buildDraftCatalog(ds,"all_time")` (tested core + data).
- Default-config token: t1 fixture and equivalent t2 default-config token
  replay to byte-identical DraftStates equal to the origin draft (tested).
- Existing-seed proofs: untouched e2e golden (seed `:29`) green throughout;
  both regenerated goldens show fields-only diffs.
- Board: every non-canonical axis value → `NON_CANONICAL_CONFIG` (negative
  tests); t1 + default-config t2 accept.

## Gates run (real counts, at the chained head)

- `turbo typecheck lint test build` (core/data/web): **core 331 · data 62 ·
  web 586 passed**, builds green.
- Golden suites: core `test:golden` 3 + `test:golden:draft` 37; data
  `test:golden:data` 28 + `test:golden:integration` 22; web
  `test:golden:leaderboard` 5.
- Token fuzz: 24-test t2 suite (decode fuzz incl. malformed-config → honest
  null, 6-anchor flip fuzz, future-version detection) + the pre-existing v1
  suite (23) green.
- Run-twice determinism: era-bounded autoDraft (core), per-preset golden
  (data), position-first walk (core) — all byte-identity.
- Leaderboard negatives: 6 canonical-config rejections + order lock.
- CI (per unit PR): full matrix green incl. heavy realism + ETL determinism.
- ETL: untouched (no `etl/` diffs this season).

## UI screenshots (390×844, light + dark)

`docs/validation/draft-config-2026-06-11/`: setup disclosure (both themes),
Position First + Modern selection, target stage spin 1 + spin 2 (both
themes), spin stage + settled reveal with `Modern (2018–2026)` era tile,
locked-target candidate list + lock bar (`Shaqiri → ST`, no slot picker).
Live-walked on the dev build (`next dev --webpack`).

## Found-and-fixed during the build

- **DC-2 pick-path catalog bug** (caught before E2 merged): the DraftBoard
  lock handler called `pickPlayer`/`pickManager` with the unfiltered
  `gameData.catalog`; under a non-default preset, pending-spin rebuilds would
  have redrawn from the FULL pool. Fixed to route through `getCatalogForEra`
  + divergence regression test (`era-config.test.ts`).

## Risks & carryovers (honest)

1. **Position-first terminal dead-end (by design, flagged for review):** a
   player who defers the manager to spin 17 can draw a final squad with no
   coach → permanent honest dead-end (no reroll per plan §C). 501 of 537
   pairs carry coaches, so this is rare and user-caused, but the run is
   unrecoverable; the UI shows the blocking notice. Squad-first's inductive
   strand guard is impossible here without breaking the commitment boundary
   or adding silent seed advances. UX mitigation (early manager nudge) is
   DC-4 territory.
2. **`md` and "canonical ranked":** the ratification names Classic in the
   canonical config; the live board currently accepts Memory submissions as
   its own lane. This build preserves the shipped `md` behavior and gates
   only the NEW axes — flagged for the DC-8 (HUMAN) leaderboard-policy
   decision.
3. **Anchor bump deferred:** engine/schema versions unchanged on the branch
   (byte-identical default behavior); the season merge (DC-9) owns the bump +
   canary/leaderboard-golden regen per the documented re-lock procedure.
   Until then, pre-season local records replay fine BY DESIGN.
4. **Share/replay config badges** (plan §G, non-default `t2` links rendering
   a config badge on results/share) are DC-4 scope — not in E1–E3; the
   recipient currently sees default-styled results for a non-default run
   (config is in the token and replays correctly; only the badge is missing).
5. **Lock-bar copy** under position-first still reads "Select a player and a
   slot…" before a candidate is chosen — harmless but DC-4 should tailor it.
6. **API future-token code:** `t3.` submissions return `MALFORMED_TOKEN`
   (not a dedicated code). UI surfaces the honest newer-version notice.

## Consolidated reviewer — re-execution scope

Cumulative diff: `git diff b41b8e0..engine-draft-config` (units #94/#95/#96).
Re-execute, fresh session:

1. `pnpm install && pnpm build`, then root `pnpm typecheck && pnpm lint &&
   pnpm test` (expect core 331 / data 62 / web 586).
2. All five golden tasks (counts above) + `WCDRAFT_REALISM_HEAVY=1` data
   heavy gate.
3. Verify BOTH golden regens are fields-only:
   `git diff b41b8e0..HEAD -- packages/core/test/fixtures/draft-golden.json
   packages/data/test/fixtures/e2e-real-run-golden.json` — every hunk is
   `draft_flow`/`rating_basis`/`era_preset`/`target_slot_id` only.
4. Adversarial probes: token tamper (ef bounds, ts coherence, anchor flips),
   board non-canonical rejections, hidden-mode leak probes on the target
   stage + rolled candidates, era census re-derivation from the bundle,
   cross-flow (T,N) equality, dead-end non-consumption (state unchanged).
5. UI: replay the screenshot walk (`next dev --webpack`), confirm default
   path unchanged (no disclosure interaction → today's flow exactly).
