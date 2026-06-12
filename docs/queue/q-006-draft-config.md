# q-006 - draft config wave

- **Tier:** Red (token, draft engine, sampling, rating basis, sim calibration,
  leaderboard policy) · **Mode:** DISPATCH-ONLY.
- **Status:** PARTLY SHIPPED / OPEN - see
  [`docs/plans/draft-config-2026-06-10.md`](../plans/draft-config-2026-06-10.md).

> **Current reality 2026-06-12:** DC-1 token/config schema, DC-2 era presets,
> DC-3 Position First, and DC-4 share/config-badge/copy polish have shipped.
> The shipped runtime data now materializes both Career and Current rows in
> `basis_ratings.current`, but product exposure of `rating_basis: "current"`
> still requires the selected-basis sim/runtime/leaderboard policy work below.

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
| DC-8 | leaderboard config policy/schema/API/UX                          | Red review, HUMAN policy decision |
| DC-9 | integration season merge and anchor/golden re-lock               | Red review + human approval       |

## Blockers / Decisions

- **HUMAN:** leaderboard config policy. Plan default: ranked accepts only
  `Classic + Squad First + Career + All-time`; other configs are casual/share
  in v1.
- **HUMAN:** era slider in/out. Plan default: out of v1.
- **HUMAN:** confirm rating-basis labels and copy: `Career` and `Current`.
- **Dependency:** Current rows exist in runtime data, but selected-basis sim
  input, canaries/goldens, and leaderboard policy remain Red scope. Do not
  flip Current by reusing Career or by silently falling back.
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
- leaderboard replay/policy tests once Paulo answers the HUMAN policy decision.
