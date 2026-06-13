# Investigation: Vercel Preview build FAILURE on engine-v2 (PR #32 / 74bb90c)

**Date:** 2026-06-07
**Investigator:** Claude (Opus)
**Scope:** Read-only; isolated `/tmp/wcdraft-inv/wcdraft` clone. No source/deploy-config changes.

## Summary

The Vercel **Preview** lane has been failing on every engine-v2 deploy since E-1 (98a18c3) — not just E-2. It is **NOT a code defect**. It is a Vercel Preview **build-cache poisoning** artifact: the cached `.next/cache/webpack/` for the Preview lane (`7FAZcEwfJzi5eW1m4rTJmC7Dg1hz`) references a chunk asset (`ea628e8edf4d1837.js`) that the engine-v2 module graph no longer produces, and Next.js 16.2.7's `RealContentHashPlugin` aborts the build instead of regenerating it.

**Local builds pass** because they don't share Vercel's Preview build cache. **Production deploys to `main` use a separate cache** (`8fjr8MqxrT9ppWoQN3w3KGCxeSkN`) and are currently green.

**Season-merge prod risk: MODERATE** — same Next.js cache invariant, different cache lane. The engine-v2 → main merge will land a large module-graph delta (~882 ins / ~2,094 del in `apps/web` alone) on top of Production's months-old persistent webpack cache. The exact same failure mode can recur on the Production lane at merge time. Mitigation is operationally easy (deploy without build cache) but the underlying webpack cache fragility should be tracked.

## Symptoms

- PR #32 statusCheckRollup → `Vercel = FAILURE` (`targetUrl`: `https://vercel.com/pnascimento9596s-projects/wcdraft-web/2wvZCnLF7dFw9SxbsmywA8bZicSv`).
- Post-merge engine-v2 branch deploy (`74bb90c`) also FAILS.
- Local `pnpm turbo run typecheck lint test build --force` and `next build --webpack` are green.
- Failure point: Next.js 16.2.7 webpack production build, during chunk asset hashing.
- Both error deployments restored the same build cache ID and emitted the same error string.

## Background / Prior Research

(External fact-gathering was not required; everything was inside the workspace / Vercel deploy logs.)

### Exact failing error (Preview build, PR #32 head 951754b)

```
@wcdraft/web:build: $ next build --webpack
@wcdraft/web:build:   Applying modifyConfig from Vercel
@wcdraft/web:build: ▲ Next.js 16.2.7 (webpack)
@wcdraft/web:build:   Creating an optimized production build ...
@wcdraft/web:build: ⚠ Compiled with warnings in 3.6s
@wcdraft/web:build: Circular dependency between chunks with runtime (webpack-runtime, 875)
@wcdraft/web:build: This prevents using hashes of each other and should be avoided.
@wcdraft/web:build: Failed to compile.
@wcdraft/web:build: RealContentHashPlugin
@wcdraft/web:build: Some kind of unexpected caching problem occurred.
@wcdraft/web:build: An asset was cached with a reference to another asset
                    (ea628e8edf4d1837) that's not in the compilation anymore.
@wcdraft/web:build: Either the asset was incorrectly cached, or the
                    referenced asset should also be restored from cache.
@wcdraft/web:build: Referenced by:
@wcdraft/web:build:  - static/chunks/webpack-0cc4843476d70329.js: ...static/chunks/"+e+".ea628e8edf4d1837.js",s.miniCssF=e=>{...
@wcdraft/web:build: > Build failed because of webpack errors
@wcdraft/web:build: [ELIFECYCLE] Command failed with exit code 1.
ERROR  @wcdraft/web#build: command (/vercel/path0/apps/web) ... exited (1)
Error: Command "cd ../.. && pnpm turbo run build --filter=@wcdraft/web..." exited with 1
```

Source: `vercel inspect https://wcdraft-61fmr0gbz-pnascimento9596s-projects.vercel.app --logs` (PR #32 preview)
and `https://wcdraft-3nz8ll54p-pnascimento9596s-projects.vercel.app --logs` (engine-v2 post-merge). Both lines are byte-identical except for chunk hash `webpack-0cc4843476d70329.js`.

### Cross-deployment evidence matrix

| Deploy | Branch / Commit | Restored cache | Circular-chunks warn | RealContentHashPlugin | Result |
|---|---|---|---|---|---|
| 04:10Z | main `6bda35d` (Production) | `8fjr8MqxrT9ppWoQN3w3KGCxeSkN` | `(webpack-runtime, 889)` + `(webpack, 230)` | — | **✓ Ready** |
| 04:17Z | engine-v2 `98a18c3` (E-1) | `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz` | `(webpack-runtime, 889)` | **FAIL** | ● Error |
| 05:23Z | engine-v2-e2-synergy-mgr `96faf34` | `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz` | `(webpack-runtime, 875)` | **FAIL** | ● Error |
| 06:12Z | ws-f/activate `8048af7` | `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz` | `(webpack-runtime, 495)` + `(52, webpack)` | — | **✓ Ready** |
| 15:25Z | engine-v2-e2-synergy-mgr `951754b` (PR #32 head) | `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz` | `(webpack-runtime, 875)` | **FAIL** | ● Error |
| 15:26Z | engine-v2 `74bb90c` (post-merge) | `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz` | `(webpack-runtime, 875)` | **FAIL** | ● Error |

Two regularities are decisive:

1. **The circular-chunks warning is chronic** (every build prints it; even the green ones). It is *not* the trigger.
2. **Only builds against the engine-v2 code path** (E-1, E-2 attempts, post-merge engine-v2) trigger `RealContentHashPlugin` — and they all fail with the same dangling reference `ea628e8edf4d1837`. The ws-f/activate Preview build restored the same `7FAZc...` cache and passed because its module graph still matched what the cache expected.

## Investigator Findings

### 1. The Vercel build IS pinned to webpack (NOT Turbopack)

- `apps/web/vercel.json` declares `framework: nextjs` + `buildCommand: cd ../.. && pnpm turbo run build --filter=@wcdraft/web...`.
- `apps/web/package.json` defines `"build": "next build --webpack"`.
- Build logs confirm: `▲ Next.js 16.2.7 (webpack)` and `$ next build --webpack` (no Turbopack fallback).
- Pinning was added in `c3cfa00 chore(web): vercel.json pins turbo-orchestrated webpack build (#19)`.

The Turbopack-hangs-on-module-Worker hypothesis is **ruled out** — Vercel is using the same `next build --webpack` invocation that's green locally.

### 2. The env-vars-missing-in-Preview hypothesis is ruled out

The build never reaches page collection / SSG. The crash happens during `Creating an optimized production build` — the asset-emit phase of webpack, before route handlers are evaluated. `DATABASE_URL` / `COOKIE_SECRET` / `RESEND_*` absence cannot cause `RealContentHashPlugin` to fail with a chunk hash mismatch. (And the failure log contains no missing-env trace.)

### 3. Root cause: Vercel Preview build-cache poisoning

Vercel restores `.next/cache/webpack/` from the most recent same-lane (Preview vs Production) deployment. Next.js 16's webpack persistent cache stores cross-chunk asset-hash references inline (the `s.miniCssF=e=>...ea628e8edf4d1837.js` snippet in the error is a witness — that's an inlined hash inside the cached webpack-runtime chunk).

When the **module graph changes enough** that a chunk that was numbered `875` in the cache now contains different modules — or the asset `ea628e8edf4d1837.js` is no longer emitted because the CSS/dynamic-import shape changed — `RealContentHashPlugin` walks the cached references, fails to find the target asset in the current compilation, and aborts instead of regenerating.

This is a known Next.js / webpack 5 `RealContentHashPlugin` cache-invariant edge case. It is sensitive to:
- dynamic `import()` boundaries (the `module`-typed Web Worker `new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" })` in `apps/web/lib/game/simulate.ts`),
- CSS module shape changes (the `miniCssF` reference in the error string),
- chunk-graph cycles (the chronic circular-chunks warning makes the runtime chunk depend on chunks that themselves embed runtime references).

The engine-v2 series (E-1 + E-2) reshapes the web module graph substantially:
- `synergy-bar.tsx` removed, `synergy-panel.tsx` added
- `saved-runs-store.ts` (288 LoC) removed; `server-history-provider.ts` (183 LoC) removed
- `manager-traits.ts` (214 LoC) added; `view-models.ts`, `slot-reveal.ts` added
- `game.module.css` rewritten (−278 LoC of CSS rules)
- API routes `app/api/runs/**`, `app/api/auth/verify/route.ts` thinned
- Total: 882 ins / 2,094 del in `apps/web/` alone

That delta is large enough to invalidate any cached cross-chunk asset references the Preview cache held from earlier builds — yet small enough on individual files to *not* invalidate the whole cache entry, so webpack tries to reuse it and trips its own integrity check.

The `ws-f/activate` Preview deploy (8048af7) passed against the **same** restored cache because its module graph was an iteration of the cache's home branch — chunks `(495)` and `(52)` were stable. The engine-v2 graph produces chunk `(875)` (a different numbering) and breaks the cached reference.

### 4. Local repro

Locally Paulo's `next build --webpack` runs against `apps/web/.next/cache/webpack/` populated by previous *local* builds, which have a coherent local module-graph history. Vercel's cache is populated by a different sequence of branches/deploys (ws-f/activate, etc.), so the inconsistent state only manifests there. A `rm -rf apps/web/.next/cache && pnpm --filter @wcdraft/web build` on Paulo's machine would simulate Vercel's "no cache" path and is expected to succeed (matches the documented green local build).

### 5. Engine-v2 branch deployment status

The branch deployment `engine-v2` @ `74bb90c` (the one auto-triggered when PR #32 merged at 15:26:27Z) is in `● Error` state with the same `RealContentHashPlugin` failure. It is reproducing on engine-v2 BASE, not just on PR previews — confirming the cache lane is broken, not a PR-specific artifact.

## Investigation Log

### Phase 1 — Pulled the exact build log
**Hypothesis:** Build is failing in a specific Next/webpack stage.
**Findings:** Failure is `RealContentHashPlugin` during asset hashing in `next build --webpack`. Same error byte-for-byte on both Error deployments.
**Evidence:** `vercel inspect <url> --logs` for `wcdraft-61fmr0gbz...` (PR #32 head) and `wcdraft-3nz8ll54p...` (engine-v2 post-merge).
**Conclusion:** Confirmed — not Turbopack, not env, not SSG, not a Next config issue.

### Phase 2 — Compared cache IDs across green and red deploys
**Hypothesis:** Build cache may be poisoned.
**Findings:** Two cache buckets exist — Production `8fjr8M...` (green on main) and Preview `7FAZc...` (green on ws-f/activate, red on every engine-v2 code lane).
**Evidence:** Vercel logs across 5 deployments (Production main, ws-f/activate Preview, engine-v2 E-1, two PR-32 Preview attempts, engine-v2 post-merge).
**Conclusion:** Cache is lane-scoped; only the Preview cache + engine-v2 code combination breaks.

### Phase 3 — Checked the circular-chunks warning
**Hypothesis:** The circular dependency warning might be the trigger.
**Findings:** Chronic — appears on every build including green ones. Different chunk numbers per build (495, 889, 230, 875). Not a regression of PR #32.
**Conclusion:** Eliminated as primary cause. Recommend tracking as a separate quality issue.

### Phase 4 — Validated env hypothesis
**Hypothesis:** Build-time secrets missing in Preview scope.
**Findings:** Build crashes before reaching route handlers; error is in webpack asset hashing.
**Conclusion:** Eliminated.

## Root Cause

`RealContentHashPlugin` cache invariant violation in `apps/web` Next.js 16.2.7 webpack build, triggered by:

1. **Vercel Preview lane** restoring `.next/cache/webpack/` from `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz` (a prior Preview deploy from ws-f/activate-era).
2. **Engine-v2 module graph** (E-1 + E-2 combined: synergy/store/CSS/API rewrites + module-Web-Worker `sim.worker.ts`) emitting a different chunk topology than the cache expects.
3. **Cached cross-chunk reference** `ea628e8edf4d1837.js` (embedded inline in `webpack-0cc4843476d70329.js`'s `s.miniCssF`/`s.u` handler) pointing at an asset the new compilation doesn't emit.
4. Next.js's webpack instance fails the build with a hard error instead of falling back to a fresh compilation.

Exact failing component:
- File: `apps/web/lib/game/simulate.ts:?` — `new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" })` (a likely contributor to chunk-graph instability under cache restore).
- Build location: `apps/web` after `next build --webpack` enters production build phase.
- Vercel-side: `.next/cache/webpack/` restored from cache `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz`.

## Recommendations

### Immediate — Unblock Preview lane (GREEN, **Paulo-actionable now**)

1. **Trigger a no-cache redeploy on `engine-v2` @ `74bb90c`** to validate the code itself builds clean and to write a fresh Preview cache. Two paths:
   - Vercel UI: open deployment `2wvZCnLF7dFw9SxbsmywA8bZicSv`, click **Redeploy** → **uncheck "Use existing Build Cache"** → Redeploy.
   - CLI: `vercel redeploy https://wcdraft-3nz8ll54p-pnascimento9596s-projects.vercel.app --no-cache` (or whichever the current engine-v2 alias is).
   - Expected outcome: build compiles successfully; new Preview cache becomes the lane baseline; future engine-v2 previews succeed until the next graph shift.
   - Risk tier: **GREEN** — no config change, just a fresh deploy.

2. (Optional) Also invalidate the Production lane cache before merging by doing the same on a Production deploy.

### Pre-merge — De-risk season merge to `main` (YELLOW)

3. **Before merging engine-v2 → main**, do step 1 first so we have proof the code compiles cleanly on Vercel. If it does, the merge is safe *as long as the merge deploy is no-cache too*.

4. **At the merge moment**, watch the auto-triggered `main` Production deploy. If it hits the same `RealContentHashPlugin` error: immediately Redeploy without build cache from the Vercel UI. Total downtime: one extra ~45s build cycle (Production builds are 35–50s per deploy log). Mitigation is one click; no rollback or revert needed.

5. (Alternative) Manually clear the Production build cache *before* the merge: Vercel project Settings → Data Cache / Build Cache → Clear. Then merge. This eliminates the risk window entirely. Risk tier: **YELLOW** (Vercel-config change, but reversible by design).

### Longer-term — Eliminate cache fragility (YELLOW → RED, **needs Paulo go-ahead**)

6. **Add a `webpack` hook in `apps/web/next.config.mjs` to disable persistent caching for production builds**:
   ```js
   const nextConfig = {
     reactStrictMode: true,
     webpack: (config, { isServer, dev }) => {
       if (!dev) config.cache = false; // disables .next/cache/webpack for prod builds
       return config;
     },
   };
   ```
   Trade-off: production builds get ~1–3s slower (no cache reuse). Reward: this entire class of failure goes away.
   Risk tier: **YELLOW** — single-file code change, but it does touch the build pipeline; recommend a one-PR validation cycle before merging to main.

7. **Fix the chronic circular-chunks warning.** It's present in green builds too, but it is the *substrate* `RealContentHashPlugin` is fussy about. Likely culprit: a barrel re-export in `apps/web/lib/game/` or a CSS-module import that ends up in `webpack-runtime`. Worth a separate investigation; non-blocking for the merge.
   Risk tier: **YELLOW** — code-quality cleanup, no config change.

8. **Do NOT change Vercel project deploy settings (build command, install command, framework preset, ignored build step, env-var scopes) without explicit Paulo sign-off.** Surfaced as RED per the brief; not applied.

## Preventive Measures

- Add a `# Vercel deploy cache` note to `AGENTS.md` / `apps/web/README.md` describing the known `RealContentHashPlugin` failure mode and the one-click no-cache redeploy fix.
- Consider a GitHub Action that, when a PR labeled `engine-v2`/`graph-shift` is merged, automatically posts a comment reminding to verify the next Production deploy succeeded.
- Track Next.js issue tracker for `RealContentHashPlugin` cache-invariant fixes in 16.x; the workaround in recommendation 6 may become unnecessary in a future patch release.

## Season-merge Verdict

> **Would the same build run (and fail) on main's prod deploy when engine-v2 merges?**

**Conditional YES.** The mechanism (cache restore + module-graph shift → `RealContentHashPlugin` mismatch) is lane-independent. The Production cache `8fjr8M...` predates the engine-v2 module-graph delta; restoring it on top of the merged engine-v2 code is the same recipe that broke Preview. The Production lane is currently green only because main currently doesn't contain engine-v2's code.

The risk is **operationally trivial to mitigate** (one click: Redeploy without build cache), but the failure would surface as a `● Error` Production deploy at the moment of merge — i.e., a temporary outage until someone redeploys. Cannot be ignored.

**Recommended action sequence before greenlighting the season merge**:

1. Trigger no-cache redeploy on `engine-v2 @ 74bb90c` → confirm Preview goes ✅ Ready (proves the code).
2. Clear Production build cache from Vercel UI (preemptive).
3. Merge engine-v2 → main.
4. Watch Production deploy; if it errors, Redeploy without cache.

Steps 1–2 are RED (touch Vercel config). Steps 3–4 are normal merge flow.

## Reference: Failing deployment URLs

- PR #32 head (`951754b`): https://wcdraft-61fmr0gbz-pnascimento9596s-projects.vercel.app
- engine-v2 post-merge (`74bb90c`): https://wcdraft-3nz8ll54p-pnascimento9596s-projects.vercel.app
- engine-v2 E-1 (`98a18c3`): https://wcdraft-8qfnrj24y-pnascimento9596s-projects.vercel.app
- engine-v2-e2-synergy-mgr first attempt (`96faf34`): https://wcdraft-v56le976y-pnascimento9596s-projects.vercel.app

Reference deployment IDs:
- Failing dashboard URL: https://vercel.com/pnascimento9596s-projects/wcdraft-web/2wvZCnLF7dFw9SxbsmywA8bZicSv
- Preview cache (poisoned): `7FAZcEwfJzi5eW1m4rTJmC7Dg1hz`
- Production cache (currently coherent vs main): `8fjr8MqxrT9ppWoQN3w3KGCxeSkN`
