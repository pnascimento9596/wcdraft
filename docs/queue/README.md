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

| Item                                                      | Tier / mode                       | One-line                                                                                                                   |
| --------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [q-001-micro-yellow-bundle](q-001-micro-yellow-bundle.md) | Yellow · SELF-SERVE:YELLOW        | Five small verified polish debts (synergy float, narrative labels, sim-golden ledger note, prettier sweep, U3 carryovers)  |
| [q-002-mv2-12-candidate](q-002-mv2-12-candidate.md)       | Red · DISPATCH-ONLY · SUPERSEDED  | Historical MV2-12 audit trail; merit-v3 shipped the replacement season                                                     |
| [q-003-f4-remaining](q-003-f4-remaining.md)               | Red · DISPATCH-ONLY               | Leaderboard ranked lane remains dark; casual board and account light-up are live                                           |
| [q-004-accounts-activation](q-004-accounts-activation.md) | HUMAN-ONLY · DONE                 | Accounts/email activation completed in prod via #108/#109; historical credential checklist retained                        |
| [q-006-draft-config](q-006-draft-config.md)               | Red · DISPATCH-ONLY               | Draft config wave: Position First, era presets, Career/Current basis, leaderboard policy                                   |
| [q-008-micro-yellow-2](q-008-micro-yellow-2.md)           | Yellow · SELF-SERVE:YELLOW · DONE | Micro-bundle 2: OG mark gold re-ink, CI push+PR dedupe, auth error-body scrub (q-003 item), surname disambiguation (q-005) |
