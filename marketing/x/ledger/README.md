# Marketing post ledger

`posts.ledger.jsonl` is the append-only, COMMITTED record of every LIVE published
post (one JSON line each: `content_hash`, `x_post_id`, `text`, timestamp, day).
It is the idempotency backbone — the poster refuses to publish a `content_hash`
already present here, so a re-run or a double cron fire can never double-post.

The GitHub Actions workflow commits new lines back to `main` after a live run.
Dry-run output never lands here; it goes to `../artifacts/` instead.

Rollback: set queue items to `status: "paused"`, or set repo variable
`MARKETING_PAUSED=true` to halt all posting.
