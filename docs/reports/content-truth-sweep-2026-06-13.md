# Site-wide content truth sweep

Branch: `ws-ux/content-truth`
Recovered commit: `6257ee225cf25cef81319ef76fef808d1c109127` (`fix(web): align launched content truth`)
Base verified for this recovery: `7519bf15b45f8ded4991c2260791f3c9c6d38e13` (`origin/main`)
Execution date: 2026-06-12 America/New_York
Report filename: requested as `content-truth-sweep-2026-06-13.md`; the policy effective date uses the verified execution date above.

Rebase note: the recovered worktree path was missing, but the commit object was still present. A remote
branch named `ui/ux-basis-wave` already pointed at unrelated current-rating-basis work, so this recovery
used the new CLAUDE-style branch above instead of overwriting that remote. The rebase conflicted in
`apps/web/app/how-to-play/page.tsx` and `apps/web/components/game/draft-screen.tsx`; both conflicts were
resolved to current `origin/main` because current main already had the more accurate launched copy and
live Career/Current rating-basis controls. Those two files are therefore not part of the final diff.

## Scope

This Yellow-lane sweep covers user-visible content and display-only truth defects:

- Privacy Policy rewrite at `/privacy`, derived from current code paths instead of boilerplate.
- Public route and game-flow copy sweep for unfinished-product markers.
- Contact route verification to concrete `mailto:` targets.
- Source and rendered-output grep commands for reviewer re-execution.

This makes the policy code-accurate for the current product. Formal legal/counsel review remains on the owner's human backlog before paid marketing; this change does not claim lawyer review.

## Privacy policy claim map

Every substantive collection/processing claim in `apps/web/app/privacy/page.tsx` is backed by the code references below.

| Policy claim | Policy lines | Code evidence |
| ------------ | ------------ | ------------- |
| Effective date is real and no longer a pre-launch placeholder.                                                                                                                                          | `apps/web/app/privacy/page.tsx:16`                                           | Current execution date from environment: 2026-06-12 America/New_York.                                                                                                                                                    |
| Email is the only account identity; auth is magic-link based.                                                                                                                                           | `apps/web/app/privacy/page.tsx:32`                                           | `packages/db/src/schema/users.ts:3-11`; `apps/web/lib/auth/magic-link.ts:86-139`; `apps/web/lib/auth/magic-link.ts:158-202`.                                                                                             |
| Magic-link rows store token hash, email, expiry, consumed time.                                                                                                                                         | `apps/web/app/privacy/page.tsx:32-36`                                        | `packages/db/src/schema/magic-link-tokens.ts:4-20`; `apps/web/lib/auth/magic-link.ts:96-139`; `apps/web/lib/auth/magic-link.ts:158-185`.                                                                                 |
| Sessions use session id, CSRF secret, expiry, and cookies named `wcdraft_sid` and `wcdraft_csrf`.                                                                                                       | `apps/web/app/privacy/page.tsx:32-36`, `apps/web/app/privacy/page.tsx:71-78` | `packages/db/src/schema/sessions.ts:19-23`; `apps/web/lib/auth/sessions.ts:28-54`; `apps/web/lib/auth/csrf.ts:8-25`; `apps/web/lib/auth/handler-helpers.ts:177-217`.                                                     |
| Completed runs may be mirrored to the server under an anonymous session or signed-in account; server-saved runs may include run token, run id, parent seed, version anchors, summary, claim state, and timestamps. | `apps/web/app/privacy/page.tsx:38-42`                                        | `apps/web/components/game/review-screen.tsx:450-454`; `apps/web/lib/game/save-mirror.ts:3-6`; `apps/web/lib/game/save-mirror.ts:86-99`; `packages/db/src/schema/saved-runs.ts:32-48`; `apps/web/app/api/runs/route.ts:23-81`; `apps/web/lib/game/saved-runs-store.ts:72-154`. |
| Local browser run history uses localStorage keys for records, index, and counter.                                                                                                                       | `apps/web/app/privacy/page.tsx:38-42`, `apps/web/app/privacy/page.tsx:79-84` | `apps/web/lib/game/run-record.ts:132-167`; `apps/web/lib/game/run-record.ts:205-262`; `apps/web/lib/game/run-record.ts:579-592`.                                                                                         |
| Saved server history is capped to recent rows per account or anonymous session.                                                                                                                         | `apps/web/app/privacy/page.tsx:112-120`                                      | `apps/web/lib/game/saved-runs-store.ts:32`; `apps/web/lib/game/saved-runs-store.ts:119-164`; `apps/web/app/api/runs/route.ts:43-47`.                                                                                     |
| Local delete is not server delete; server delete is separate and scoped.                                                                                                                                | `apps/web/app/privacy/page.tsx:121-124`                                      | `apps/web/app/api/runs/[id]/route.ts:3-9`; `apps/web/app/api/runs/[id]/route.ts:60`; `apps/web/lib/game/saved-runs-store.ts:224-233`.                                                                                    |
| Current leaderboard posts store season, mode, draft mode, display name, run token, verified score, score breakdown, account/session link, and timestamps. Ranked attempt ids exist in dormant schema but are not collected by the current casual submit path. | `apps/web/app/privacy/page.tsx:44-47`                                        | `packages/db/src/schema/leaderboard-entries.ts:65-80`; `apps/web/lib/leaderboard/submit-route.ts:109-116`; `apps/web/lib/leaderboard/submit-route.ts:167-189`; `apps/web/lib/leaderboard/store.ts:287-303`. |
| Leaderboard submit currently accepts casual mode; ranked exists at schema/API gate level but is not marketed in UI.                                                                                     | `apps/web/components/leaderboard/board-views.tsx:45-47`                      | `apps/web/lib/leaderboard/submit-route.ts:95-116`; `packages/db/src/schema/leaderboard-entries.ts:101-115`.                                                                                                              |
| Leaderboard local storage only remembers last display name and compact submitted-token memory.                                                                                                          | `apps/web/app/privacy/page.tsx:79-84`                                        | `apps/web/lib/leaderboard/submit-state.ts:97-157`.                                                                                                                                                                       |
| Share links are self-contained run tokens.                                                                                                                                                              | `apps/web/app/privacy/page.tsx:49-51`                                        | `apps/web/lib/game/run-token.ts:1-13`; `apps/web/lib/game/run-token.ts:217-273`; `apps/web/components/game/share-screen.tsx:275-304`.                                                                                    |
| Optional share intents open external share URLs only when the user chooses them.                                                                                                                        | `apps/web/app/privacy/page.tsx:49-51`                                        | `apps/web/components/game/share-screen.tsx:315-324`; `apps/web/components/game/share-screen.tsx:431-458`; `apps/web/lib/game/share-adapters.ts:192-224`.                                                                 |
| Rate-limit buckets are hashed from email/IP/session values.                                                                                                                                             | `apps/web/app/privacy/page.tsx:53-56`                                        | `apps/web/lib/auth/rate-limit.ts:9-14`; `apps/web/lib/auth/rate-limit.ts:54-62`; `apps/web/lib/auth/magic-link.ts:102-113`; `apps/web/lib/auth/handler-helpers.ts:148-150`.                                              |
| Resend is the transactional email provider when configured.                                                                                                                                             | `apps/web/app/privacy/page.tsx:104-107`                                      | `apps/web/lib/auth/email.ts:44-82`; `apps/web/lib/auth/email.ts:101-105`; `apps/web/lib/auth/handler-helpers.ts:104-111`.                                                                                                |
| Vercel hosts the web app and may process standard request/server logs.                                                                                                                                  | `apps/web/app/privacy/page.tsx:99-101`                                       | `apps/web/vercel.json:1-6`; standard hosting-log processing is inferred from Vercel hosting.                                                                                                                             |
| No passwords, social sign-in IDs, payment/billing records, paid entitlements, ad targeting, analytics trackers, player photos, likeness rights, or biometric data are collected by the current product. | `apps/web/app/privacy/page.tsx:60-69`                                        | Positive auth schema is email-only: `packages/db/src/schema/users.ts:3-11`. No payment/monetization tables: `packages/db/README.md:49`; `packages/db/test/migrations.golden.test.ts:192`. The absence check in the source sweep below finds no current collection path for those categories. |
| Data attribution points to the existing attribution route and CC BY-SA sources.                                                                                                                         | `apps/web/app/privacy/page.tsx:126-131`                                      | `apps/web/app/attribution/page.tsx:20-35`; `packages/data/src/generated/manifest.json:3`.                                                                                                                                |
| Contact/privacy requests route to the contact page.                                                                                                                                                     | `apps/web/app/privacy/page.tsx:134-139`                                      | `apps/web/app/contact/page.tsx:20-29`.                                                                                                                                                                                   |

## Route sweep inventory

| Surface              | Hits found before sweep                                                                                                                                                | Resolution                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` home             | No unfinished-product markers in page copy.                                                                                                                            | Kept launched-state copy.                                                                                                                                                                                                                               |
| `/play` mode select  | No retired marker hit; mode copy already shows Classic and Memory as live.                                                                                             | No change.                                                                                                                                                                                                                                              |
| `/play/draft` setup  | Current `origin/main` already exposes live Career/Current rating-basis controls and no retired marker hit after the rebase.                                            | No final PR diff; the rebase conflict was resolved to current main because the recovered commit's "Career only" wording was stale after rating-basis activation.                                                                                         |
| `/play/review`       | `placeholder="Your XI"` input attribute only.                                                                                                                          | Kept; it is form placeholder text, not document-status copy.                                                                                                                                                                                            |
| `/play/results`      | No retired marker hit.                                                                                                                                                 | No change.                                                                                                                                                                                                                                              |
| `/play/share`        | No retired marker hit. Social share buttons are live external share intents.                                                                                           | No change; privacy report cites share-token behavior.                                                                                                                                                                                                   |
| `/play/history`      | No retired marker hit. Existing "unavailable" states are honest error states.                                                                                          | No change.                                                                                                                                                                                                                                              |
| `/leaderboard`       | Toolbar displayed `Ranked soon`.                                                                                                                                       | Removed the future teaser; toolbar now says `Casual leaderboard` and keeps live draft-mode filters. Local `next start` returned 404 because `LEADERBOARD_ENABLED` is unset; that is the existing server gate in `apps/web/app/leaderboard/page.tsx:22`. |
| `/sign-in`           | Auth-disabled fallback used `soon` and exposed deployment env names as product copy.                                                                                   | Rewrote to an honest unavailable state for deployments where email auth is not configured.                                                                                                                                                              |
| `/how-to-play`       | Current `origin/main` already has launched instructions for Classic/Memory, 17 picks, formation setup, synergy, results scoring, ranked/casual setup, and sharing.      | No final PR diff; the rebase conflict was resolved to current main because the recovered commit's older shorter wording omitted current live rating-basis/setup truth.                                                                                   |
| `/settings`          | "Only live control for now", "More settings unlock", Account/Notifications/Ad-free upgrade cards, `Coming soon` badges.                                                | Removed nonexistent settings and paid/ad claims; page now only exposes the real theme control with accurate non-persistence text.                                                                                                                       |
| `/privacy`           | TBD/pending legal/draft/finalized-before-launch markers; third-party sign-in overclaim; payment/ad/Stripe/AdSense overclaims; nonessential ad-cookie consent language. | Rewrote policy to current as-built account, session, gameplay, storage, leaderboard, share-token, provider, retention, and attribution truth.                                                                                                           |
| `/attribution`       | No retired marker hit.                                                                                                                                                 | No change; privacy policy cross-links it.                                                                                                                                                                                                               |
| `/contact`           | Social/community placeholder cards and "confirmed before launch" callout.                                                                                              | Removed nonexistent channels; retained concrete `mailto:hello@wcdraft.app` and `mailto:privacy@wcdraft.app` routes.                                                                                                                                     |
| Header/menu/footer   | No retired marker hit. Footer contact/privacy/attribution routes resolve.                                                                                              | No change.                                                                                                                                                                                                                                              |
| Manifest/OG metadata | No retired marker hit.                                                                                                                                                 | No change.                                                                                                                                                                                                                                              |
| Auth email templates | No retired marker hit; email copy says no account is created if the recipient did not request the link.                                                                | No change.                                                                                                                                                                                                                                              |
| 404/missing route    | No custom not-found route exists.                                                                                                                                      | Rendered missing-route check should confirm default 404 text contains no retired markers.                                                                                                                                                               |

## Source sweep commands

Run against app source and auth email/template code:

```bash
rg -n "(TBD|pending legal|finalised|finalized|before launch|will be added|in a later update|later update|scaffold|coming soon|Coming soon|\\bsoon\\b|lorem|delve|important to note|ad-free|purchase|advertising|AdSense|Stripe|third-party sign|profile options|notifications|run reminders)" apps/web/app apps/web/components apps/web/lib/auth -g '!apps/web/.next/**' -g '!apps/web/node_modules/**'
```

Result after this sweep: no matches.

Run the document-status `placeholder` check separately:

```bash
rg -n "placeholder" apps/web/app apps/web/components apps/web/lib/auth -g '!apps/web/.next/**' -g '!apps/web/node_modules/**'
```

Expected remaining source-only or form-input hits:

- `apps/web/lib/auth/auth-enabled.ts:22` - env placeholder comment.
- `apps/web/components/game/draft-screen.tsx:806` - internal `awaiting_slot` comment.
- `apps/web/components/leaderboard/board-views.tsx:6` - comment saying empty boards do not render placeholder rows.
- `::placeholder` CSS selectors for real inputs.
- Input placeholder attributes: search players, team name, email address, display name.

These are not unfinished document-status copy and are not rendered as launch-scaffold text.

## Rendered sweep plan

After build/start, crawl these routes and grep the rendered DOM text, not only source:

```text
/
/play
/play/draft
/play/review
/play/results
/play/share
/play/history
/leaderboard
/sign-in
/how-to-play
/settings
/privacy
/attribution
/contact
/__missing-content-sweep
```

Rendered target:

```text
TBD|pending legal|finalised|finalized|before launch|will be added|in a later update|later update|scaffold|coming soon|Coming soon|soon|lorem|delve|it's important to note|ad-free|purchase|advertising|AdSense|Stripe|third-party sign|profile options|notifications|run reminders
```

Expected result: zero matches in rendered route text. Legitimate game-term `draft`, honest `unavailable` states, and normal input placeholders are outside this retired-launch marker set.

## Files changed

- `apps/web/app/privacy/page.tsx`
- `apps/web/app/contact/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/app/sign-in/page.tsx`
- `apps/web/components/leaderboard/board-views.tsx`
- `apps/web/components/leaderboard/leaderboard.module.css`
- `apps/web/app/globals.css`
- `docs/reports/content-truth-sweep-2026-06-13.md`

## Validation checklist

- Initial web typecheck: failed before workspace package builds because this recovered worktree had no built `@wcdraft/core`, `@wcdraft/data`, or `@wcdraft/db` declarations. Representative error: `TS2307: Cannot find module '@wcdraft/db' or its corresponding type declarations.`
- Workspace dependency setup: pass after `pnpm --filter @wcdraft/core build`, `pnpm --filter @wcdraft/data build`, and `pnpm --filter @wcdraft/db build`.
- Web typecheck: pass, `pnpm --filter @wcdraft/web typecheck`.
- Web lint: pass, `pnpm --filter @wcdraft/web lint`.
- Web tests: pass, `pnpm --filter @wcdraft/web test` (`56 passed | 1 skipped` test files; `634 passed | 1 skipped` tests).
- Source retired-marker grep: pass, no matches:
  `rg -n '(TBD|pending legal|finalised|finalized|before launch|will be added|in a later update|later update|scaffold|coming soon|Coming soon|\bsoon\b|lorem|delve|important to note|ad-free|purchase|advertising|AdSense|Stripe|third-party sign|profile options|notifications|run reminders)' apps/web/app apps/web/components apps/web/lib/auth -g '!apps/web/.next/**' -g '!apps/web/node_modules/**'`.
- Fresh-context review loop: initial reviewer BLOCKed on two privacy-truth defects and inability to run shell-based rendered crawl in its own environment. The defects were fixed by explicitly disclosing anonymous-session server mirroring and removing current `attempt id` collection from leaderboard copy.
- Web production build for rendered crawl: pass, `WCDRAFT_SITE_URL=http://127.0.0.1:3021 pnpm --filter @wcdraft/web build`. Next emitted existing webpack circular-chunk warnings, but build completed.
- Local production server for rendered crawl: pass, `WCDRAFT_SITE_URL=http://127.0.0.1:3021 pnpm --filter @wcdraft/web exec next start -p 3021`.
- Rendered route grep: pass with 0 matches using the Playwright CLI wrapper against `document.body.innerText` for `/`, `/play`, `/play/draft`, `/play/review`, `/play/results`, `/play/share`, `/play/history`, `/leaderboard`, `/sign-in`, `/how-to-play`, `/settings`, `/privacy`, `/attribution`, `/contact`, and `/__missing-content-sweep`. `/leaderboard` and `/__missing-content-sweep` returned 404 locally; both rendered 0 retired-marker matches.
- Deployment/live Vercel verification: pending post-merge production deploy.
