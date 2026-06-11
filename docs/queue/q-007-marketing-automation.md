# q-007 - marketing automation

- **Tier:** Yellow by default; Red if secrets, posting permissions, or external-account policy expand.
- **Mode:** DISPATCH-ONLY.
- **Status:** PLANNED - see [`docs/plans/marketing-x-2026-06.md`](../plans/marketing-x-2026-06.md).

## Spec

Build the organic X poster described in the marketing plan:

- GitHub Actions scheduled workflow.
- In-repo content queue at `docs/marketing/queue/*.md`.
- Dry-run mode by default.
- X API v2 posting with OAuth 1.0a user-context credentials from repository Actions secrets:
  `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.
- Queue validation before posting:
  - required fields present;
  - scheduled time due;
  - media paths exist and are repo-owned;
  - Daily Draft posts include a real `https://www.wcdraft.com/play/share?run=t1...` URL;
  - no player photos, likenesses, official marks, or affiliation-implying copy.

## Blockers / Decisions

- **HUMAN:** paid promotion / X Premium advertising remains blocked on trademark counsel.
- **HUMAN:** Paulo confirms final queue file front matter before implementation.
- **Dependency:** a deterministic daily token-generation/replay process must exist before automated Daily Draft posts can publish.

## Done-when

- Dry-run workflow can select a due queue item and print exactly what would be posted.
- Publish mode posts one manually approved test item from the queue.
- Failed validation exits non-zero without calling X.
- Secrets are referenced only by name and never logged.
- Docs include rollback: disable the Actions workflow or set all queue items to `status: paused`.

## Evidence required

- Workflow run logs for dry-run and one approved publish test.
- Unit tests or script-level checks for queue validation.
- Proof that a malformed/missing share URL blocks Daily Draft posts.
- Proof that no generated content touches paid promotion settings.
