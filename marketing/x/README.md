# @wcdraft/marketing-x — organic X automation (q-007)

Deterministic content engine for the **@WCDraft** account. Organic only; channel-agnostic
by design (the composer + `features.json` aren't X-specific, so Instagram/TikTok port lanes
can reuse them).

## Operating model: ZERO-API content packs

@WCDraft has **no X API credits** (posting and search both return 402 `CreditsDepleted`)
and the owner will not buy them, so **there is no automated posting**. Instead this package
generates ready-to-paste content the owner schedules by hand via X's native composer:

- **`pnpm gen:pack`** → `packs/pack-YYYY-WW.md` — a week of ~40 posts (feature pitches,
  daily seeded challenges, dataset factoids, result spotlights), grouped by day, char-counted.
- **`pnpm gen:banks`** → `reply-bank.md` + `quote-bank.md` — pre-written replies (by
  scenario) and quote-post templates + `x.com/search?q=…` discovery links.
- **`ROUTINE.md`** — the owner's weekly 15-min + daily 2-min flow (no API step).
- `marketing-x.yml` regenerates the pack + banks every Monday and commits them to main.

The live API poster (`run-poster`/`run-engagement`) + X client below stay **built, tested,
and DORMANT** behind `MARKETING_PAUSED=true`; they activate only if API credits are ever
loaded. **Browser-automation posting is forbidden** (X ToS / account-ban risk).

## What it does

- **Phase A — posting** (works on the Free API tier). Four template families, all drawing
  rotating claims from the committed **truth manifest** `features.json`:
  - `daily_challenge` — "Today's spin: <nation> <year>" + a real squad-year from the dataset.
  - `result_spotlight` — narrated from a **real, replay-checked share token** (decoded,
    version-checked, and re-simulated against the shipped bundle; the record matches the live
    app exactly — proven by an app-parity check). Honest-state: a foreign/older-build token is
    skipped, never faked.
  - `factoid` — factual legend/era stat lines from the shipped dataset (only non-null fields).
  - `feature_pitch` — pure feature-forward pitch of a live differentiator.
- **Phase B — inbound** (needs Basic tier). Auto-replies only to people who engaged us, ≤1/user/day,
  no thread spirals, abuse never answered. Share-token mentions get a reply built from a real stat in
  **their** run.
- **Phase C — outbound** (needs Basic tier). Quote-posts + follows only, capped (3 QP/day, 20 follows/day),
  never an @-reply to a non-engager. `UNSOLICITED_REPLIES` ships **false** (suspension risk; owner-only flip).

The live API tier is detected by probe. **@WCDraft is currently Free tier**, so Phases B/C ship
**code-complete but gated OFF** with an honest log line; Phase A is unaffected.

## Guardrails (enforced in code + tested)

- **Banned lexicon** (`lexicon.ts`): no "chemistry"/"soccer"/"coach"/FIFA mark; no affiliation/endorsement
  claims. Run on every rendered post.
- **Feature-truth** (`features.ts`): a post may only reference a feature whose `status` is `live` in
  `features.json`. Planned features (e.g. the Current rating basis) cannot be claimed.
- **Idempotency**: the committed ledger (`ledger/posts.ledger.jsonl`) keys posts by content hash — a
  re-run or double cron fire can never double-post.
- **Per-day cap** (default 6, code-clamped) and a **kill switch** (`MARKETING_PAUSED=true`).

## Run it

```sh
# Dry-run one slot (writes artifacts/dry-run-<day>.jsonl):
pnpm --filter @wcdraft/marketing-x run compose

# Probe the live tier + confirm the account (source creds first; values never printed):
set -a; . ~/.wcdraft-x.env; set +a; pnpm --filter @wcdraft/marketing-x run probe-tier

# Engagement (gated on Basic tier):
pnpm --filter @wcdraft/marketing-x run engage
```

Live posting requires `MARKETING_LIVE=true` AND credentials in the environment.

## Rollback

- Set repo variable **`MARKETING_PAUSED=true`** — halts both jobs.
- Or set queue items to `status: "paused"`.
- Or disable the `marketing-x` GitHub Actions workflow.

## Updating feature truth

When a feature ships, changes, or is removed, update `features.json` (`status` + `claim` + `verify`).
A stale entry becomes a false post; the review gate cross-checks every `live` entry against the
production site.
