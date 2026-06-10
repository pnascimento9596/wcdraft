# docs/queue — backlog mirror

This queue MIRRORS verified open work; it is not an autonomous work source. The canonical
planning layer stays in the Claude.ai project docs + `docs/plans/*` — only actionable,
verified items get a queue file.

Rules (binding, from `CLAUDE.md`):

- **RED items are dispatch-only** — the Lead Architect authors the task prompt; never
  self-served from the queue file.
- Only items marked `SELF-SERVE:GREEN` or `SELF-SERVE:YELLOW` may be worked from a
  one-liner.
- Every item carries: self-contained spec · done-when · risk tier · evidence required.
- When an item ships, move its file's status to DONE in the same PR (and update STATE.md).

## Index

| Item                                                      | Tier / mode                     | One-line                                                                                                                  |
| --------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [q-001-micro-yellow-bundle](q-001-micro-yellow-bundle.md) | Yellow · SELF-SERVE:YELLOW      | Five small verified polish debts (synergy float, narrative labels, sim-golden ledger note, prettier sweep, U3 carryovers) |
| [q-002-mv2-12-candidate](q-002-mv2-12-candidate.md)       | Red · DISPATCH-ONLY · CANDIDATE | Next merit-model iteration — verified deferred threads, no authored spec yet                                              |
| [q-003-f4-remaining](q-003-f4-remaining.md)               | Red · DISPATCH-ONLY             | F-4 leaderboard remainder: U4/U5/U6 lanes in flight (reference only), U7 ranked lane dark, light-up checklist             |
| [q-004-accounts-activation](q-004-accounts-activation.md) | HUMAN-ONLY                      | Resend API key + sender domain verify — Paulo only, never agent-served                                                    |
