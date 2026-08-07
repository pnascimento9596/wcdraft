# Unit A — CSRF outage forensics (2026-08-07)

**Read-only investigation.** No code or production data changed by this report.
Production HEAD at investigation: `d9f4073` (`runtime-data-2.11.0` /
`engine-2026.07.18-basis-aware-tiering` / `season-2026-squad-depth`).

## Outcome (short)

| Question                                                                         | Answer                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When was always-awaited sweep introduced?                                        | **`890db10` / PR #244**, merged **2026-07-11T17:16:01-04:00**                                                                                                                       |
| When was the 500 fixed?                                                          | **`98e0368` / PR #341**, merged **2026-08-07T20:01:45Z**; deploy READY ~`2026-08-07T20:01:48Z`                                                                                      |
| Earliest **observed** CSRF 500 in Vercel logs                                    | **`2026-08-07T01:23:45.609Z`**                                                                                                                                                      |
| Outage window (observed)                                                         | **At least ~18.1 hours** (01:23Z → last 500 19:29Z; fix deploy 20:01Z)                                                                                                              |
| Log retention limit                                                              | Vercel CLI historical query returns **no CSRF 500s before 2026-08-07T01:23Z** even with `--since 90d` / limit 100 — treat onset as **≥ that timestamp**, not earlier                |
| Did real-user auth go to zero for the whole post-#244 period?                    | **No.** Sign-ups + email verification succeeded **2026-07-17** and **2026-08-07 wait: Jul 20** under the same CTE sweep code                                                        |
| Did real-user auth go to zero in the **observed** outage window (Aug 7 pre-fix)? | **Yes for durable sessions / accounts / magic-links / ranked.** Zero of those minted between 01:23Z and the fix. Four anon durable sessions appear only **after** the fix (20:08Z+) |
| Ranked board empty because of this outage?                                       | **No evidence that outage emptied ranked.** Ranked attempts table is **0 rows for all time**; sole ranked leaderboard row is **2026-06-21** (pre-sweep, `NULL attempt_id`)          |

---

## 1. Onset — code side

### Sweep added (always-awaited on bootstrap)

| Field               | Value                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Commit              | `890db10e32462473778778d2b1d4dedc9feb4d29`                                                                                                                                                                                                 |
| PR                  | [#244](https://github.com/pnascimento9596/wcdraft/pull/244) — `fix(auth): harden session and abuse boundaries`                                                                                                                             |
| Merge / author date | **2026-07-11** (AuthorDate `Sat Jul 11 13:16:01 2026 -0400` → **17:16:01Z**)                                                                                                                                                               |
| Change              | `GET /api/auth/csrf` switched from `ensureSession` to **stateless bootstrap** and inserted **`await sweepExpiredSessions(deps)` before any success path**. Sweep implemented as raw CTE via `db.execute` returning `result.rows[0].count`. |

### Sweep began failing (observed ≠ introduced)

The always-awaited CTE path lived from **2026-07-11** through **2026-08-07T20:01Z**. It did **not** 500 for that entire interval:

- Real accounts created + email verified **2026-07-17** (`santiarmua11@…`) and **2026-07-20** (`vlucidorio@…`) — both require CSRF bootstrap + magic-link consume.
- Magic-link rows consumed on those days and **2026-07-18**.
- Sessions continued daily through **2026-07-21**.

So **“sweep added” ≠ “sweep always throws.”** The failure mode is a later (or intermittent) throw on the CTE/`db.execute` result-shape path while the call remained always-awaited.

### Fix

| Field             | Value                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Commit            | `98e03689e8e8521e78c6d8f65ec071101c3d2871`                                                                                         |
| PR                | [#341](https://github.com/pnascimento9596/wcdraft/pull/341)                                                                        |
| Merged            | **2026-08-07T20:01:45Z**                                                                                                           |
| Production deploy | `dpl_5pRLrRzwsBuJhQdsJeoWKJJNZGDw` READY **2026-08-07T20:01:48.128Z** (sha `98e0368`)                                              |
| Change            | Sweep best-effort (log + continue); rewrite to query-builder select+delete; map substrate errors to typed 503 on DB-required paths |

**Distinction (required):**

1. **Introduced always-awaited sweep:** `890db10` / #244 / **2026-07-11**.
2. **Observed consistent production 500s:** **at least 2026-08-07T01:23:45.609Z** (log retention floor) through **2026-08-07T19:29:10.576Z** (last retained 500), remediated by **#341** at **20:01Z**.

---

## 2. Onset — observed side (Vercel runtime logs)

**Method:** `vercel logs --project wcdraft-web --environment production --no-branch --no-follow --status-code 500 --query '/api/auth/csrf' --since <window> --limit 100 --json` (authenticated CLI against project `prj_MXJxM5wTyp4rqnHPqA1Z9Ncvc17K`).

| Window (`--since`)   |   CSRF 500 count | Earliest          | Latest            |
| -------------------- | ---------------: | ----------------- | ----------------- |
| 1h (queried ~22:30Z) |                0 | —                 | —                 |
| 6h                   |               20 | 18:36:13Z         | 19:29:10Z         |
| 12h                  |               21 | 12:15:37Z         | 19:29:10Z         |
| 24h … 90d            | **36** (plateau) | **01:23:45.609Z** | **19:29:10.576Z** |

**Retention conclusion:** Expanding `--since` past ~24h does not surface any older CSRF 500. The retained set is **36 events**, all on **2026-08-07**, all `AUTH_UNEXPECTED_ERROR` / `error_class: unexpected` on `GET /api/auth/csrf`.

**State the outage as “at least X”, not overclaimed:**

> **At least ~18.1 hours of consistent CSRF 500s** from **2026-08-07T01:23:45.609Z** to last observed **2026-08-07T19:29:10.576Z**, ending when **#341** deployed at **~20:01Z**. Earlier onset is **unknowable from Vercel log retention** available to this investigation (plateau at 36 events for `--since` 24h–90d).

**Deployments that served the retained 500s:**

| Deployment                         | SHA                                    | READY                |            # of retained CSRF 500s |
| ---------------------------------- | -------------------------------------- | -------------------- | ---------------------------------: |
| `dpl_FTPqdbf5SuuemfBpm9P1VQB7T2oj` | `21b451f` (fleet docs, **2026-07-25**) | 2026-07-25T17:20:38Z |           15 (early Aug 7 morning) |
| `dpl_54njayHfgefuceYeNfkmWbvQNt94` | `2632b4c` (#335 marketing)             | 2026-08-07T11:36:37Z |                                  1 |
| `dpl_4GbPNvF7RbeCSZQBhBVNME4qbgio` | `2a3253e` (#340 honest skew)           | 2026-08-07T18:33:27Z | 20 (includes investigation probes) |

Hourly histogram (UTC, retained set): 01:00×1, 04:00×10, 05:00×4, 12:00×1, 18:00×2, 19:00×18.

**Independent probe receipt (not only logs):** `/tmp/lv-csrf.hdr` from #340 live-verify shows **`HTTP/2 500`** on `GET /api/auth/csrf` at **`date: Fri, 07 Aug 2026 18:36:28 GMT`** with `x-matched-path: /api/auth/csrf`.

---

## 3. Blast radius — database

Queried production Neon project `rapid-wind-87431051`, primary branch `br-blue-heart-aqcejtyf` (`neondb`), **2026-08-07 ~22:30Z**. Counts are **live table state** (not a historical warehouse).

### Totals at investigation time

| Table               | Count |
| ------------------- | ----: |
| users               |     9 |
| sessions            |   132 |
| magic_link_tokens   |    21 |
| ranked_attempts     | **0** |
| leaderboard_entries |     6 |
| saved_runs          |   317 |

### Window comparison

Bounds:

- **pre_window:** 2026-06-13 → 2026-07-11T17:16:01Z (sweep merge)
- **candidate_code_window:** 2026-07-11T17:16:01Z → 2026-08-07T20:01:45Z (fix merge) — _code capable of always-awaiting broken sweep_
- **post_fix:** ≥ 2026-08-07T20:01:45Z

| Metric                   | pre_window | candidate_code_window | post_fix |
| ------------------------ | ---------: | --------------------: | -------: |
| users created            |          6 |                 **2** |        0 |
| email verifications      |          1 |                 **2** |        0 |
| sessions total           |         91 |                    37 |        4 |
| sessions authed          |          2 |                 **2** |        0 |
| magic_link tokens        |         12 |                     3 |        0 |
| magic_link consumed      |          9 |                 **3** |        0 |
| ranked_attempts issued   |      **0** |                 **0** |    **0** |
| ranked_attempts consumed |      **0** |                 **0** |    **0** |
| leaderboard ranked rows  |          1 |                 **0** |        0 |
| leaderboard casual rows  |          5 |                 **0** |        0 |
| saved_runs               |        222 |                    84 |        0 |

### Users (all)

| created_utc    | email (class)                     | verified                               |
| -------------- | --------------------------------- | -------------------------------------- |
| 2026-06-12     | owner gmail                       | no                                     |
| 2026-06-15 ×3  | automation / redacted invalid     | no                                     |
| 2026-06-17     | codex-live automation             | no                                     |
| 2026-06-21     | real user (chezwizz ranked owner) | no                                     |
| 2026-07-05     | real user                         | **yes**                                |
| **2026-07-17** | real user                         | **yes** (during post-#244 code window) |
| **2026-07-20** | real user                         | **yes** (during post-#244 code window) |

### Observed outage day (2026-08-07) only

| Signal              | Count / notes                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| users created       | **0**                                                                                                        |
| email verifications | **0**                                                                                                        |
| magic_link activity | **0**                                                                                                        |
| ranked_attempts     | **0** (also lifetime 0)                                                                                      |
| leaderboard writes  | **0** remaining (PR #340’s `live_verify_xi` was later deleted by U2)                                         |
| sessions created    | **4**, all **after** fix deploy (20:08:12Z, 20:08:33Z, 20:30:21Z, 20:30:36Z), all **anonymous** durable rows |
| saved_runs          | **0** on Aug 7; 11 between Jul 22–Aug 6                                                                      |

**Plain statement:** In the **observed** Vercel-log outage window on 2026-08-07, **real-user auth activity that depends on CSRF bootstrap went to zero** (no new accounts, verifications, magic-links, or authed sessions). That is **not** true of the entire post-#244 interval (Jul 17 / Jul 20 sign-in success).

---

## 4. Reconcile known-successful paths

### PR #340 live-verify casual submit (18:36Z) while CSRF 500’d

**Not a contradiction.** Identity gate for **cookie-less casual submit** short-circuits **before CSRF**:

```text
// apps/web/lib/leaderboard/identity-gate.ts
// no session cookie → { sessionId: null, userId: null } for casual
// CSRF double-submit only enforced when a session cookie is present
```

Evidence:

- CSRF probe at **18:36:28Z** → **500** (`/tmp/lv-csrf.hdr`).
- Leaderboard row `live_verify_xi` created **18:36:28.415Z** with **`user_id` / `session_id` / `attempt_id` all NULL** — pure anonymous casual insert.
- U2 later deleted that row as automation residue.

### Prior sign-ins (Jul 17 / Jul 20)

Predate the **observed** log outage floor. They prove the CTE sweep was **not** universally fatal from #244 merge day forward. They do **not** prove CSRF was healthy on 2026-08-07 before 01:23Z (that is **outside retained logs**).

### Sibling auth routes during #341 investigation

PR #341 body: bare CSRF 500’d while `GET /api/auth/session` returned 200 `{session:null}` and other routes after `buildRuntimeDeps` could return typed `CSRF_MISSING`. That matches “DB + secret OK; only the always-awaited sweep abort killed CSRF.”

---

## 5. H3 bearing (evidence only — no product recommendation)

**Question:** Does the CSRF outage window plausibly explain an empty ranked board?

**Evidence:**

1. **`ranked_attempts` has 0 rows for the entire production lifetime** of this database — not merely during Aug 7.
2. **Exactly one ranked `leaderboard_entries` row** exists: `4dc1df8e-…`, created **2026-06-21T21:17:55Z**, owner real user (`emmettheal@…` / display path “chezwizz” in prior reports), **`attempt_id` NULL**, season key is the **old compound engine key** (not `season-2026-squad-depth`).
3. **Zero ranked leaderboard rows** were written in the post-#244 window or on Aug 7.
4. Current featured season boards are empty of **ranked** entries because **no ranked row was ever written for `season-2026-squad-depth`**, not because Aug 7 CSRF 500s deleted or blocked a stream of ranked submissions that previously existed for that season.
5. Casual season/archive rows (`wow`, `testt`, `shipmqyo*`, `team3`) all predate the observed outage (Jun 25–Jul 3).

**H3 conclusion (evidence):** The outage **can** explain why **new** ranked play on 2026-08-07 could not complete auth-gated flows, but it **does not** explain a ranked board that was **already empty for the current season for the whole pre-outage period**. Ranked attempt issuance was already **zero for all time** before the observed outage window.

---

## Unknowable / missing telemetry

| Gap                                                                         | Impact                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Vercel log retention floor ~2026-08-07T01:23Z for this query path           | True first-failure time may be earlier; window stated as **at least**            |
| No continuous CSRF success/failure metrics or synthetic monitor before #341 | Cannot plot 500 rate Jul 11–Aug 6                                                |
| No application-level security log warehouse beyond Vercel runtime logs      | Correlation IDs from #341 matrix not queryable historically beyond retained logs |
| `vercel env pull` returns empty encrypted secrets                           | Did not block Neon access (neonctl connection string)                            |

---

## Sources (primary)

- Git: `890db10`, `98e0368`, `2a3253e`; PR #244 / #341 / #340 bodies
- Vercel: production deployments API + `vercel logs` JSON (36 CSRF 500 events)
- Neon production SQL (tables listed above)
- Local probe receipts: `/tmp/lv-csrf.hdr` (500 @ 18:36:28Z)
- Code: `apps/web/app/api/auth/csrf/route.ts`, `apps/web/lib/auth/sessions.ts`, `apps/web/lib/leaderboard/identity-gate.ts`
