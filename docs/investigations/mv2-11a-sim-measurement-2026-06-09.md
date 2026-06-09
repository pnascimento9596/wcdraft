# MV2-11a — Sim-impact MEASUREMENT (read-only sizing for the MV2-11b refit)

**Date:** 2026-06-09
**Base:** merit-v2 integration tip `a9864c2` ("MV2-7-lite — legend runtime plumbing")
**Status:** Investigation only. **No change** to `calibration.ts`, ratings, channels, or any committed compact. The compact used below was built locally in an isolated `/tmp` worktree and **discarded**.

---

## 1. Purpose

Size the MV2-11b sim refit. The new merit-v2 channels (stature-dominant, `wc-perf-4.1.0` historical + `proj-career-3.0.0` 2026) are **not yet reflected in the committed compact** — the shipped `src/generated/*.compact.json` is still `wc-perf-3.0.0` (388 baseline-anchor / 0 stature). Regenerating it is MV2-10's job. So the realism harnesses, which statically import the committed compact, are today measuring the **old** channels.

This investigation answers one question: **how far do the realism gates drift once the new channels actually drive the sim**, and is MV2-11b therefore (a) a one-constant λ nudge, (b) a fit-calibration re-run + re-lock, or (c) a structural refit needing the GPT-5.5 Pro oracle.

## 2. Method

1. Created an isolated detached worktree at `a9864c2` in `/tmp` (never committed).
2. Built a **temp compact** locally from the current merit-v2 ETL ratings (`etl/output/ratings.json` = `wc-perf-4.1.0`, `ratings_2026.json` = `proj-career-3.0.0`). This is also a dry-run of MV2-10's regen.
   - The build's hard `baseline_anchor_estimate === 388` gate was relaxed to **387** *locally only* (the new ETL emits 387 — the pre-existing 387/388 drift). This is the gate MV2-10 will re-lock; irrelevant to the realism read.
   - Temp compact verified to carry the new channels: manifest `wc-perf-4.1.0` / `proj-career-3.0.0`, `career_stature_estimate=485`, **Pelé-1966 atk 93 (OVR 95)**.
3. Ran both realism harnesses against the temp compact:
   - **Symmetric:** `packages/data/test/realism-modern-norms.golden.test.ts` — coherent nation-XI vs nation-XI sweep over the 48 × 2026 teams (3,006 matches). Measures the **2026 projected channels**.
   - **Asymmetric:** `packages/data/test/realism/realism.gate.test.ts` (`WCDRAFT_REALISM_HEAVY=1`, N=2000) — `strategicAutoDraft` drafted-XI vs 2026 opponents. Drafts from the **full pool** (historical greats carry the `wc-perf-4.1.0` lift).
   - **Faithfulness:** `packages/core/src/faithfulness.test.ts` (engine behavior, synthetic strengths).

All RNG is seeded; sample sizes pinned. Numbers below are deterministic at `a9864c2`.

## 3. Results — symmetric modern-norms sweep (2026 nation-XIs, N=3,006)

| Metric | Pinned norm | Tolerance band | **Actual (new channels)** | Δ vs norm | Verdict |
|---|---|---|---|---|---|
| goals/game | 2.54 | [2.478, 2.594] | **2.209** | **−0.327** | ✗ below (−0.27 below band floor) |
| draws % | 24.7 | [22.88, 26.52] | **28.24** | **+3.54 pp** | ✗ above |
| margin ≥ 4 % | 4.9 | [4.12, 5.70] | **3.69** | **−1.22 pp** | ✗ below |
| KO → ET % | 33.0 | [29.61, 36.48] | **37.20** | **+4.16 pp** | ✗ above |
| KO → shootout % | 21.4 | [18.43, 24.43] | **25.20** | **+3.77 pp** | ✗ above |

**5 / 5 out of band.**

## 4. Results — asymmetric `strategicAutoDraft` gate (drafted XI, N=2000)

| Metric | Pinned norm | vs-norm band | **Actual** | Δ vs norm | Locked shape-band (old strategic landing) | Verdict vs locked |
|---|---|---|---|---|---|---|
| goals/game | 2.54 | ±0.032 | **2.254** | −0.286 | one-sided floor **2.40** | ✗ **below floor** |
| draws % | 24.7 | ±1.11 | **27.10** | +2.40 pp | center 22.67 ± 1.50 | ✗ (+4.43 pp out) |
| margin ≥ 4 % | 4.9 | ±0.43 | **3.85** | −1.05 pp | center **9.02** ± 1.50 | ✗ (collapsed) |
| KO → ET % | 33.0 | ±1.50 | **34.44** | +1.44 pp | center 30.92 ± 5.00 | ✓ (wide band) |
| KO → shootout % | 21.4 | ±1.31 | **22.41** | +1.01 pp | center 20.32 ± 4.00 | ✓ (wide band) |

Old → new on the strategic landing: goals 2.477 → **2.254**; draw 22.67% → **27.10%**; **margin≥4 9.02% → 3.85%** (the largest single move); KO→ET 30.92% → 34.44%; shootout 20.32% → 22.41%.

Secondary gate breakages (all re-lock naturally with the refit): per-policy run-count lock drifted; goals-floor failed; the greedy-overall CI guard failed (KO→ET 26.28% drifted *inside* strategic's wide ±5 band). `synergy.mult=1.0103`, `mgr.mod=1.0000`, `coverage≈0.95` — **unchanged**, so the drift is purely channel-distribution, not synergy/manager.

## 5. Root cause (both harnesses agree)

The λ map is `λ_for = clamp(BASE + SPREAD·(attack − defResist)/100, MIN, MAX)` with `defResist = W_DEF·def + W_GK·gk` (W_DEF=0.70, W_GK=0.30, BASE=0.85, SPREAD=6.5).

The stature-dominant model **lifted the defense and GK channels** (MV2-3/3.5 closed the DF/GK under-credit). The asym telemetry is the smoking gun — strategic XI channel means:

```
attack=44.83  midfield=47.86  defense=46.69  goalkeeping=23.68
```

Defense (46.69) is now essentially level with attack (44.83). So `attack − defResist ≈ 44.83 − (0.70·46.69 + 0.30·23.68) = 44.83 − 39.79 ≈ 5.0` — a tiny gap → **λ collapses toward its floor → goal volume drops ~13%**. Everything else is the downstream cascade of too-few goals: more 0-0/1-1 ties → more draws, more KO→ET, more shootouts, and fewer ≥4 margins. The 2026 reconcile (MV2-5) additionally compressed the inter-team spread, reinforcing the draw-up / blowout-down shape.

λ was calibrated (E-3a refit) against the **old** channel distribution; it is now mis-tuned to the lifted def/GK inputs. **The engine math is unchanged — only the input distribution moved.**

## 6. Faithfulness read

**Engine faithfulness (synthetic): 11/11 PASS.** The four-channel dominance + synergy amplification proofs all hold:
- **Elite ceiling** — 99/99/99/99 vs 50 wins ≥85% & <100%, `maxGoalsFor ≥ 6`, `margin4plus > 10%`: the engine still supports a credible 8-0 with high-but-not-certain probability. Elite channel levels are reachable in the new pool (97 cards OVR ≥ 96, top atk = 99), so uniformly-elite + high-synergy can still both *reach* and *win* a blowout.
- **Dominance-not-certainty** — 85 vs 60 lands win-rate in [65%, 95%): strong-on-paper neither loses its edge nor becomes certain.
- **Legibility** — high-att/weak-def gives more goals for *and* against (swingy); strong-GK measurably lowers goals-against.
- **No-inversion** — the underdog never wins ≥ the favorite.

**Population faithfulness under the new channels: degraded by mis-calibration, not by the engine.** Because λ collapsed, at the population level favorites *under-convert* dominance (draw weak teams more than they should — draws up), and high-scoring blowouts are rare (margin≥4 collapsed 9.0% → 3.85%). The "high-att/weak-def → swingy" dynamic is damped because the def-channel floor lifted (few squads are genuinely weak-def anymore). This is exactly the symptom the λ re-fit removes; it is not an engine-logic fault.

## 7. SIZING VERDICT — (b) moderate fit-calibration re-run + atomic re-lock

**Not (a).** The gates are far out, not near-band: symmetric goals/game is ~0.27 *below the band floor* (≈ 4–5 band-half-widths), and all 5 symmetric metrics + the asym goals-floor + 2 shape bands fail. A single λ-constant nudge cannot land this.

**(b) is the right size.** The defect is one well-understood mechanism (def/GK lift collapsing `attack − defResist`), and the five metrics are **correlated through the goal-level lever** — restoring goal volume (raise `BASE`, and likely re-widen `SPREAD` / rebalance `W_DEF` to recover the compressed spread that drives margin≥4) cascades draws, KO→ET, shootout, and margin≥4 back toward their norms simultaneously. The purpose-built tool already exists: `packages/data/scripts/fit-calibration.mjs` — a deterministic seeded coordinate-descent over `{SPREAD, w_def, w_gk, γ_mid, BASE, MIN, MAX, n}` against the symmetric norms, **subject to the D4 faithfulness assertions staying green** (~3–4 min/run). The asym gate's own header documents this as the intended "E-4 RE-LOCK" path: re-run at the same N + seed prefix, copy the new landings + Wilson half-widths into `asym-realism-golden.json`, re-lock the symmetric bands, all atomically with the engine-output change.

**MV2-11b concrete steps:**
1. Re-run `fit-calibration.mjs` on the new-channel temp compact → new λ tuple.
2. Re-lock the symmetric bands in `realism-modern-norms.golden.test.ts` and the asym landings + greedy-guard separation in `asym-realism-golden.json` (atomic with the λ change).
3. Regenerate the compact (the MV2-10 dependency) so the gates run on shipped data; re-lock the 387 anchor count.

**Escalate to (c) — GPT-5.5 Pro oracle — only if** the coordinate-descent fit cannot *jointly* satisfy the five norms **and** keep the D4 faithfulness bands green. The specific risk to watch: the compressed inter-team spread (margin≥4 = 3.7–3.85% well under 4.9%) may require a `SPREAD` increase large enough to threaten the elite-ceiling / no-inversion faithfulness bands — i.e. goals-volume and blowout-rate may not both be reachable without a structural change (e.g. a stature-aware spread term or a defense-channel rescale). There is **no evidence of that conflict yet**, and the E-3a fit previously landed all five with these same levers on a similar-shaped problem — so (b) is the first attempt, and the fit run itself will reveal whether (c) is forced.

---

### Appendix — reproduction (isolated, uncommitted)

```
git worktree add --detach /tmp/wt a9864c2
cd /tmp/wt && pnpm install --frozen-lockfile && pnpm --filter @wcdraft/core build
# local-only: relax EXPECTED_BASELINE_ANCHOR_ESTIMATE 388 → 387 in build-compact-data.mjs
pnpm --filter @wcdraft/data run build:compact            # temp compact, new channels
pnpm --filter @wcdraft/data exec vitest run test/realism-modern-norms.golden.test.ts
WCDRAFT_REALISM_HEAVY=1 pnpm --filter @wcdraft/data exec vitest run test/realism/realism.gate.test.ts
pnpm --filter @wcdraft/core exec vitest run src/faithfulness.test.ts
```
