# q-006 - draft config wave

- **Tier:** Red (token, draft engine, sampling, rating basis, sim calibration,
  leaderboard policy) · **Mode:** DISPATCH-ONLY.
- **Status:** PLANNED - see
  [`docs/plans/draft-config-2026-06-10.md`](../plans/draft-config-2026-06-10.md).

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
| DC-1 | `t2` token schema + `t1` compatibility + fuzz/PREV skew fixtures | Red review                        |
| DC-2 | era preset filtering, pool census, sampling goldens              | Red review                        |
| DC-3 | Position First target-selection state machine + replay           | Red review                        |
| DC-4 | config UX dark wiring + share badges + Memory leak tests         | Yellow/Red by touched surface     |
| DC-5 | MV2-12 link-seam prerequisite                                    | Red review                        |
| DC-6 | MV2-12b dual-basis materialization                               | Red review                        |
| DC-7 | selected-basis sim inputs + shared lambda validation             | Red review                        |
| DC-8 | leaderboard config policy/schema/API/UX                          | Red review, HUMAN policy decision |
| DC-9 | integration season merge and anchor/golden re-lock               | Red review + human approval       |

## Blockers / Decisions

- **HUMAN:** leaderboard config policy. Plan default: ranked accepts only
  `Classic + Squad First + Career + All-time`; other configs are casual/share
  in v1.
- **HUMAN:** era slider in/out. Plan default: out of v1.
- **HUMAN:** confirm rating-basis labels and copy: `Career` and `Current`.
- **Dependency:** `Current` implementation waits for MV2-12b and the Audit-2
  identity-link prerequisite called out in `q-002`.
- **Integration branch:** plan default is an implementation integration branch
  such as `engine-draft-config`, with one season-style merge/re-lock.

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
- MV2-12b dual-basis compact/runtime integrity;
- shared-lambda realism validation for shipped basis configs;
- leaderboard replay/policy tests once Paulo answers the HUMAN policy decision.
