import { describe, it } from "vitest";

// GOLDEN INVARIANT (WS-0c depth-layer contract, WS-A implementation):
//   MANAGER ENTITY RESOLUTION yields ONE stable Manager.manager_id for a
//   human coach who managed multiple national federations across tournaments.
//   The canonical multi-nation manager is Carlos Alberto Parreira: six World
//   Cups across FIVE different nations (Kuwait, UAE, Brazil, Saudi Arabia,
//   South Africa, then Brazil again). ONE manager_id, MANY manager_card_ids.
//
// The current ETL output (etl/output/managers.json + manager_tournaments.json)
// already exhibits this — manager_id "M-311" has six ManagerTournament rows
// across five distinct nation_ids. THIS test re-asserts the invariant inside
// the core data contract once the WS-A manager-resolution pipeline is wired
// to the contract types in `types/manager.ts`.
//
// WHY THIS IS A CONTRACT-LEVEL GUARDRAIL: the WS-0c 17-spin draft picks a
// MANAGER on at most one spin. If manager-ER splits a single human into two
// manager_ids by mistake, the same human could appear in TWO different
// (tournament, nation) spins' `rolled_manager_card_id`s — letting the user
// re-draft "the same coach" disguised. If manager-ER merges two humans into
// one manager_id by mistake, real history is silently rewritten.
//
// FIXTURING DEFERRED: WS-A wires the ETL output (manager_id="M-311",
// 6 ManagerTournament rows) through the contract types here.

describe.skip("manager identity — multi-nation manager resolves to ONE manager_id", () => {
  it.skip("Carlos Alberto Parreira (M-311) resolves to ONE manager_id across 6 World Cups / 5 nations", () => {
    // FIXTURE TODO (WS-A):
    //   - Parse etl/output/managers.json via ManagerSchema; locate manager_id
    //     "M-311" — assert ONE row.
    //   - Parse etl/output/manager_tournaments.json via ManagerTournamentSchema;
    //     filter to manager_id === "M-311".
    //   - Assert: 6 ManagerTournament rows.
    //   - Assert: 5 DISTINCT nation_ids across those rows (Brazil appears
    //     twice — 1994 and 2006 — confirming both the multi-nation invariant
    //     AND the repeat-nation case).
    //   - Assert: every row's manager_card_id === buildManagerCardId("M-311",
    //     row.tournament_id).
    //   - Assert: the manager_card_ids are all DISTINCT (one per tournament).
    //   - Assert: a draft seeded to roll EACH of those 6 (tournament, nation)
    //     pairs would offer "M-311" as `rolled_manager_card_id` on every one
    //     of those spins UNTIL the user drafts the coach — then it disappears
    //     from later spins (the at-most-one-manager invariant).
  });

  it.skip("two ManagerTournament rows with the same manager_id but different nation_ids both validate", () => {
    // FIXTURE TODO (WS-A):
    //   - Hand-build two ManagerTournament fixtures:
    //       { manager_id: "M-311", tournament_id: 1994, nation_id: "bra", ... }
    //       { manager_id: "M-311", tournament_id: 1998, nation_id: "sau", ... }
    //   - Assert both parse via ManagerTournamentSchema.
    //   - Assert their manager_card_ids round-trip cleanly via parseManagerCardId.
  });
});
