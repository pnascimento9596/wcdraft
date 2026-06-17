# q-006 - draft config wave

- **Tier:** Red (token, draft engine, sampling, rating basis, sim calibration,
  leaderboard policy) · **Mode:** DISPATCH-ONLY.
- **Status:** PARTLY SHIPPED / OPEN - see
  [`docs/plans/draft-config-2026-06-10.md`](../plans/draft-config-2026-06-10.md).

> **Current reality 2026-06-17:** DC-1 token/config schema, DC-2 era presets,
> DC-3 Position First, DC-4 share/config-badge/copy polish, and selected-basis
> runtime exposure have shipped. DC-8 is dispatched as a Red per-config
> leaderboard lane: every legal casual or ranked run posts to its exact
> `mode × draft_order × era × rating_basis` board, with ranked still requiring
> sign-in.

## Spec

Implement the pre-draft configuration wave defined in the plan:

- Draft mode: `Squad First` (current behavior) vs `Position First`.
- Rating basis: `Career` vs `Current` (owner naming; never "Prime").
- Era filter: v1 presets only (`All-time`, `Post-2000`, `Post-2010`, `Modern`);
  no free range slider unless a later plan revises the measured validity
  constraints.

The implementation units are dispatch-only:

| Unit | Scope                                                            | Gate                              |
| ---- | ---------------------------------------------------------------- | --------------------------------- |
| DC-1 | `t2` token schema + `t1` compatibility + fuzz/PREV skew fixtures | SHIPPED                           |
| DC-2 | era preset filtering, pool census, sampling goldens              | SHIPPED                           |
| DC-3 | Position First target-selection state machine + replay           | SHIPPED                           |
| DC-4 | config UX dark wiring + share badges + Memory leak tests         | SHIPPED for setup/badges/copy     |
| DC-5 | MV2-12 link-seam prerequisite                                    | SUPERSEDED by merit-v3 U0         |
| DC-6 | MV2-12b dual-basis materialization                               | SHIPPED by merit-v3 V6            |
| DC-7 | selected-basis sim inputs + shared lambda validation             | Red review                        |
| DC-8 | leaderboard config policy/schema/API/UX                          | Red review, DISPATCHED 2026-06-17 |
| DC-9 | integration season merge and anchor/golden re-lock               | Red review + human approval       |

## Blockers / Decisions

- **Resolved 2026-06-17:** leaderboard config policy is per-config for both
  casual and ranked; ranked remains account-required.
- **HUMAN:** era slider in/out. Plan default: out of v1.
- **HUMAN:** confirm rating-basis labels and copy: `Career` and `Current`.
- **Dependency:** Current rows exist in runtime data. Leaderboard posts must
  persist the replay-derived basis and must not reuse Career or silently fall
  back when a Current token is submitted.
- **Integration branch:** `engine-draft-config` carried DC-1..3; future
  selected-basis/leaderboard work should dispatch under a fresh Red lane.

## Done-when

- The Lead Architect dispatches specific units from the plan.
- Every shipped unit lands through its required tier gate.
- The selected implementation set merges through a single reviewed
  integration/season merge with anchors, token replay, goldens, realism, and
  leaderboard policy aligned.

## Evidence required

Per `docs/plans/draft-config-2026-06-10.md`:

- token fuzz + PREV skew fixtures;
- era preset pool census and parameterized sampling goldens;
- Position First transition and replay goldens;
- Memory leak tests for every new UI affordance;
- runtime dual-basis compact integrity (shipped by merit-v3) plus selected-basis
  sim/leaderboard validation before exposing Current;
- shared-lambda realism validation for shipped basis configs;
- leaderboard replay/policy tests for per-config casual and ranked boards.
