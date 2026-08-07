# Post-Ship Verification — Anchor Skew · Parse Gate · Fleet State

- **Date:** 2026-08-07
- **Production tip:** `dc25918` (`feat(data): RF-01 drop Rating.components[] …`)
- **Pre-Lane-C tip:** `a6a7d18` (Lane B head)
- **Live health:** `https://www.wcdraft.com/api/health` → `ok:true`, build sha `dc25918`, schema `runtime-data-2.11.0`, engine `engine-2026.07.18-basis-aware-tiering`, ratings `wc-perf-6.6.0` / `proj-career-5.6.0`
- **Live manifest:** `https://www.wcdraft.com/data/wcdraft/runtime-data-2.11.0/manifest.json` byte-matches in-repo `packages/data/src/generated/manifest.json` draft-pool + scenario shas
- **Risk:** Green (docs + evidence only; no product/runtime change)
- **Worktree:** `/tmp/ws-verify-post-ship` on `ws-meta/post-ship-verify`

---

## V1 — Token version-skew blast radius

### Anchor map (code truth)

`versionsAgree` (`packages/core/src/run-token.ts:610–619`) is a strict 6-way conjunction:

| Token key | Current field      | Meaning                                  |
| --------- | ------------------ | ---------------------------------------- |
| `sv`      | `schema_version`   | runtime-data contract                    |
| `dv`      | `dataset_version`  | ETL output revision                      |
| `rv`      | `rating_version`   | `historical+projected` composite         |
| `ev`      | `engine_version`   | sim/draft engine                         |
| `uv`      | `ruleset_version`  | scoring ruleset                          |
| `hv`      | `data_bundle_hash` | `draft_pool.sha256+scenario_2026.sha256` |

**Terminology correction:** in code, `hv` is **not** historical rating. Historical rating lives inside `rv` as `wc-perf-*`. The dispatch premise that “`hv` = historical rating” does not match the implementation.

### Composed anchors: pre-Lane-C (`a6a7d18` / retained 2.10) vs current (`dc25918` / 2.11)

| Anchor                | Pre (`a6a7d18`)                         | Post (`dc25918` / live)                 | Agree? |
| --------------------- | --------------------------------------- | --------------------------------------- | ------ |
| `sv` schema_version   | `runtime-data-2.10.0`                   | `runtime-data-2.11.0`                   | **NO** |
| `dv` dataset_version  | `2026-07-01`                            | `2026-07-01`                            | YES    |
| `rv` rating_version   | `wc-perf-6.6.0+proj-career-5.6.0`       | `wc-perf-6.6.0+proj-career-5.6.0`       | YES    |
| `ev` engine_version   | `engine-2026.07.18-basis-aware-tiering` | `engine-2026.07.18-basis-aware-tiering` | YES    |
| `uv` ruleset_version  | `ruleset-2026.06.04`                    | `ruleset-2026.06.04`                    | YES    |
| `hv` data_bundle_hash | `ae5376c9…d07+50c45d0e…6fd`             | `67d9e89f…552+4d47812b…969`             | **NO** |

### Why `hv` moves (in-scope for RF-01, not rating/engine drift)

1. **draft_pool** sha changes because components were stripped (primary, expected). Decoded 68,380,413 → 17,744,663 bytes.
2. **scenario_2026** sha changes with **identical payload size** (75,325 bytes); sole content diff is the embedded `schema_version` stamp `2.10.0` → `2.11.0`.
3. Score-distribution / salt-map also re-stamp draft-pool sha and advance the Daily window; those are **not** part of the `hv` composite, but confirm regen hygiene.

### Token mint matrix

Reconstructed **16** representative tokens stamped with **pre-Lane-C anchors only** (no product code path required):

- Prefixes: `t3.` and `t4.`
- Configs: default (`career` / `all_time` / `squad_first` / classic) and non-default (`current` / `modern` / `position_first` / hidden)
- Presence combos: no `mp`/no `a`, `mp` only, `a` only, both

**Result:** all 16 share the identical comparison pattern `sv:false, dv:true, rv:true, ev:true, uv:true, hv:false`. `versionsAgree` → **false** against current. `mp`/`a` presence does not affect the version conjunction.

### User-facing behavior (pre-2.11 token on current build)

| Surface                                                 | Mechanism                                                                                         | What the user sees                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay / reconstruction (`run-screen-loader` → results) | `versionSkew`                                                                                     | Title: **“This shared run is from a different build”**. Message refuses silent re-sim; asks sender to refresh link. **No fabricated score.** |
| Share screen                                            | same `versionSkew`                                                                                | Same title/message (share-screen wording). **No fabricated card.**                                                                           |
| OG sign / render                                        | `verifyRunTokenForOg` → `WRONG_SEASON` → `/api/og/sign` **422** `{ok:false,error:"WRONG_SEASON"}` | No dynamic per-run OG from a skewed token. Share metadata falls back to **default** OG image (not a fake verified score).                    |
| Friend challenge                                        | `DIFFERENT_BUILD`                                                                                 | Draft note: challenge seed/setup still usable, **scores not compared**. Results head-to-head: **“Different build”** + recipient score only.  |
| Leaderboard lineup inspector                            | maps `WRONG_SEASON` → `DIFFERENT_BUILD`                                                           | **404** with: _“This run was created on a different build, so it cannot be inspected here.”_ Honest code, not a generic empty 404 body.      |
| Leaderboard submit / re-sim                             | `WRONG_SEASON` 409                                                                                | Title **“Different season”**; board refuses the run; no persistence of skewed token scores.                                                  |

Every path refuses silent re-sim / fabricated numbers. Lineup’s 404 is the intentional `DIFFERENT_BUILD` wire code with explicit copy — not a silent failure.

### V1 verdict

**Neither pure (a) nor pure (b) as worded.** Closest honest adjudication:

- **`sv` diverges** — expected schema bump.
- **`hv` (`data_bundle_hash`) diverges** — expected for a payload-diet regen (draft-pool bytes + scenario schema stamp). Lane C’s own review already predicted `sv` + `hv` movement on golden regen.
- **`ev` does NOT diverge.** Engine remains `engine-2026.07.18-basis-aware-tiering` on live health and both manifests.
- **`rv` does NOT diverge.** Historical `wc-perf-6.6.0` and projected `proj-career-5.6.0` unchanged. (If “hv” in a prior verbal report meant historical rating, that claim is **false** for pre-Lane-C tokens.)
- **Not (b):** Lane C did **not** move engine or rating anchors outside RF-01 scope.
- **Extended (a):** skew is the honest conjunction of schema + bundle-hash movement only. Blast radius = all surfaces that gate on `versionsAgree` for tokens minted on 2.10.

**No remediation in this lane.**

---

## V2 — Preregistered parse gate closure

### Instrument

Reproduced Track C’s profile from `docs/reports/evidence-track-c-2026-07-23/parse-timing.json`:

- Host: sequential `JSON.parse` medians (7 samples, 1 warmup)
- Throttled proxy: **3 busy ESM worker threads** contending for CPU while measuring (5 samples)
- Inputs: **retained 2.10** vs **shipped 2.11** `draft-pool.compact.json.br` (actual retained/shipped bytes — not a synthetic strip)

Committed JSON: `docs/reports/parse-timing-2.11-vs-2.10-2026-08-07.json`.

### Measured actuals (this host, 2026-08-07, node v24.11.0 darwin arm64)

| Profile                          | 2.10 median   | 2.11 median  | Improvement    |
| -------------------------------- | ------------- | ------------ | -------------- |
| Host                             | **145.24 ms** | **29.20 ms** | **−116.04 ms** |
| Throttled/proxy (3 busy workers) | **143.33 ms** | **29.24 ms** | **−114.09 ms** |

| Artifact       | 2.10        | 2.11                 |
| -------------- | ----------- | -------------------- |
| Decoded bytes  | 68,380,413  | 17,744,663 (−74.05%) |
| Brotli bytes   | 1,311,661   | 713,942 (−45.57%)    |
| Decoded sha256 | `ae5376c9…` | `67d9e89f…`          |

### Gate

- Preregistered bar: **≥100 ms** parse improvement on throttled/proxy profile.
- Measured: **114.09 ms** → **PASS / gate closed**.
- Note on absolute levels: Track C’s contended medians were higher (~995 ms → ~157 ms, −838 ms) under a synthetic strip on a different day/load. This re-run’s busy-worker proxy did not inflate host times as aggressively on this machine (3 workers on 8-core M-class host leave headroom). **The instrument is reproducible; the absolute contended magnitude is environment-sensitive.** The bar comparison uses the same method family and still clears ≥100 ms.

No retune, re-encode, or payload change.

---

## V3 — Fleet / Colima state

### Observed (2026-08-07 ~15:40–15:45 UTC-4)

| Fact                                  | Evidence                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colima                                | **Running** (`colima status`), profile `default`, aarch64, **8 CPU / 16 GiB / 100 GiB**, docker runtime                                              |
| Host RAM for Colima VM                | `com.apple.Virtualization.VirtualMachine` ~**1.6 GiB RSS**; limactl helpers small                                                                    |
| wcdraft runner fleet                  | **DOWN** — zero `wcdraft*` containers; supervisors idle under `/Users/paulo/runners/wcdraft/`                                                        |
| biotraxiq GitHub Actions runner       | **Host-native** at `/Users/paulo/actions-runner-biotraxiq` — agent **`biotraxiq-m4`**, repo `pnascimento9596/BiotraxIQ`. **Not** a Colima container. |
| biotraxiq workloads **inside Colima** | **12 containers** — Postgres/MinIO for demos, PR CI DBs, cap-audit, hotfix, terminal variants (`biotraxiq-*`)                                        |
| Other Colima consumers                | `ap-audit-1`, `ap-audit-2` (GitHub runners), `ap-audit-local-pg`                                                                                     |

### Topology adjudication

Standing understanding (“biotraxiq operates its own GHA runner on the host, not in Colima”) is **true for the Actions runner process**, but **incomplete**: biotraxiq **does** depend on Colima for local/demo/PR Postgres and MinIO containers.

**Constraint applied:** because biotraxiq-owned containers depend on Colima, this lane **changed nothing** — Colima left **UP**. Never stop/restart/reconfigure biotraxiq-owned resources.

### Lifecycle rule (for next closeout)

1. **wcdraft GHA fleet** = on-demand only: start via `/Users/paulo/runners/wcdraft/start.sh`, stop via `stop.sh` after the lane. Idle wcdraft containers must not remain.
2. **Colima** may only be stopped when **no non-wcdraft workloads** need it. Before `colima stop`, inventory `docker ps` for `biotraxiq-*`, `ap-audit-*`, or any other non-wcdraft names. If any exist → **leave Colima up** and report the conflict.
3. **Never** touch `/Users/paulo/actions-runner-biotraxiq`, biotraxiq containers, or ap-audit runners from a wcdraft lane.

---

## Architect-delegated decisions

1. **`hv` naming in the (a)/(b) fork.** Interpreted against code: `hv` = `data_bundle_hash`. Historical rating is `rv`. Closing V1 as extended-(a): expected `sv`+`hv` only; not (b).
2. **V2 instrument.** Used retained 2.10 vs shipped 2.11 files (not synthetic strip) because that is what production skews against post-ship; method family matches Track C’s recorded 3-busy-worker proxy.
3. **V3 Colima.** Presence of biotraxiq containers ⇒ no stop. Also noted ap-audit runners as additional Colima dependents.

## Risks / carryovers

- Pre-2.11 share/challenge/leaderboard tokens remain skewed until users re-run on 2.11 (honest by design; retention keeps 2.10 bytes for offline/compat windows, not for current-anchor re-sim).
- Contended-parse absolute ms are host-sensitive; future bars should pin machine class or report both host and proxy with environment metadata (already done here).
- Colima still holds ~16 GiB VM allocation + ~1.6 GiB host RSS while biotraxiq DBs idle — owner decision whether to reclaim outside wcdraft process.

## Git

Docs-only PR from this worktree; no product code, schema, or data-artifact mutation.
