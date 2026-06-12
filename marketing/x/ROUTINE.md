# @WCDraft — the weekly + daily routine (zero-API)

Everything here is done by hand in the X web app. **No API, no automation posting.**
(Automated posting needs paid X API credits the account doesn't have, and
browser-automation posting is against X's rules — so we don't do it.) The tooling
in this folder just _writes the words for you_; you paste and schedule them yourself.

---

## Once a week — ~15 minutes

1. **Get this week's pack.** A new file appears every Monday at
   `marketing/x/packs/pack-YYYY-WW.md` (the GitHub Action generates it; you can also
   run `pnpm --filter @wcdraft/marketing-x run gen:pack` yourself). It holds ~40
   ready-to-paste posts for the week, grouped by day, each with its character count.
2. **Open the X web composer** (the "Post" button → it opens the composer with a
   calendar/clock **Schedule** icon).
3. **Pick the strongest ~7–10 posts** for the week — you do NOT post all 40. Favour:
   one feature pitch + one daily challenge most days; a factoid or result spotlight
   when you want variety; 2 on a real match day.
4. For each chosen post: **copy the block, paste into the composer, click the
   Schedule (clock) icon, pick a day/time, and Schedule.** Spread them out — mornings
   (≈9–11am ET) for daily challenges, later for factoids. Don't bunch them on the hour.
5. **Result spotlights:** only post one when you (or a player) have a genuinely good
   run. Open your run's **Share** screen on the site, copy that link, and use it — the
   pack's sample spotlight shows the format. Never post a made-up record.

That's the whole week. The pack already guarantees terminology, feature-truth, and the
280-char limit, so there's nothing to double-check on wording.

---

## Once a day — ~2 minutes

1. **Open notifications/mentions.**
2. **Reply only to people who engaged you** (a mention, reply, or quote). For each,
   find the matching scenario in `marketing/x/reply-bank.md`, copy a variant, tweak a
   word if you like, and reply. Rotate variants so you don't repeat yourself.
   - One reply per person per day. Never reply to abuse or spam — just move on.
3. **Optional, when you have a minute — quote-posts.** Open a link from the
   "Discovery" section of `marketing/x/quote-bank.md`, find a good public post, and
   **quote-post** it (quote with your own comment) using a variant from that file.
   Cap yourself at ~3/day. Never @-reply someone who hasn't engaged you, and never
   put down another game.

---

## Hard rules (don't break these)

- **Never claim affiliation** with any competition or governing body. We're fan-made.
  (The account bio carries the disclaimer — leave it in place.)
- **Never disparage another game.** Lead with what _we_ do.
- **Never post a fabricated result.** Records come from a real run's share link only.
- **Terminology:** "football" (not soccer), "manager" (not coach), "Synergy" (not
  Chemistry), nominative "World Cup" only — no other marks.
- **No images of players, kits, crests, or trophies.** Text + our own brand assets only.

---

## If X API credits are ever added later

The automated poster (`run-poster` / `run-engagement`) and the GitHub Actions live-post
path are fully built and tested — they're just **dormant behind `MARKETING_PAUSED=true`**.
If you ever load credits: set repo var `MARKETING_PAUSED` to `false`, set `MARKETING_LIVE`
to `true`, and start with `MARKETING_DAILY_CAP=3`. Until then, the pack routine above is
the operating model.
