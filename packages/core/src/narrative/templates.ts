// Pre-authored narrative templates, grouped by OUTCOME CLASS.
//
// STATIC CONTENT — every line below is authored prose committed as DATA. There
// is NO runtime language model anywhere in the narrative path: selection reads
// this bank, threads the run's narrative sub-seed to choose a variant, and
// fills `{TOKEN}` placeholders deterministically. (The prose was drafted with
// AI assistance OFFLINE and then frozen here — see WS-E.)
//
// HOUSE STYLE:
//   - "football", never "soccer".
//   - No official competition marks, no real competition names, no trademarked phrases.
//   - Original copy; evocative but token-safe (a missing token renders as the
//     honest-state sentinel without breaking the sentence's grammar).
//
// TOKENS (see `TokenName`): {TEAM_NAME} {MANAGER} {TOP_SCORER} {FINAL_HERO}
// {VILLAIN} {OPPONENT} {KEY_MOMENT} {RECORD}.

import type { NarrativeTemplate, OutcomeClass } from "../types/narrative.js";
import type { RunResult } from "../types/run.js";

/**
 * The full template bank. The order here is STABLE and is the order template
 * selection indexes into (per outcome class), so reordering this array would
 * change which variant a given sub-seed selects — treat it as golden data.
 */
export const NARRATIVE_TEMPLATES: readonly NarrativeTemplate[] = [
  // ─── CHAMPION_UNDEFEATED (a clean 8-0) ──────────────────────────────────────
  {
    id: "champ_undefeated_01",
    outcome_class: "CHAMPION_UNDEFEATED",
    text: "Eight matches, eight wins, not a single setback. {TEAM_NAME} marched through the tournament unbeaten and untroubled, lifting the trophy on a flawless {RECORD}. {TOP_SCORER} led the line all summer and {FINAL_HERO} settled the final against {OPPONENT}.",
  },
  {
    id: "champ_undefeated_02",
    outcome_class: "CHAMPION_UNDEFEATED",
    text: "Perfection. {TEAM_NAME} won the lot — {RECORD} — and never once trailed when it mattered. {MANAGER} built a side that simply did not lose, and {FINAL_HERO} crowned it all in the final.",
  },
  {
    id: "champ_undefeated_03",
    outcome_class: "CHAMPION_UNDEFEATED",
    text: "They came, they conquered, they never blinked. A spotless {RECORD} carried {TEAM_NAME} to glory, with {TOP_SCORER} terrorising defences from the first whistle of the group stage to the last of the final.",
  },
  {
    id: "champ_undefeated_04",
    outcome_class: "CHAMPION_UNDEFEATED",
    text: "No team laid a glove on them. {TEAM_NAME} swept to the title on a {RECORD} that will be hard to ever better, sealing the final past {OPPONENT} with {KEY_MOMENT} from {FINAL_HERO}.",
  },
  {
    id: "champ_undefeated_05",
    outcome_class: "CHAMPION_UNDEFEATED",
    text: "An unbeaten champion is a rare thing, and {TEAM_NAME} earned every word of it. {MANAGER}'s side closed out a {RECORD} campaign with {TOP_SCORER} finishing as the tournament's defining forward.",
  },
  {
    id: "champ_undefeated_06",
    outcome_class: "CHAMPION_UNDEFEATED",
    text: "Start to finish, faultless. {TEAM_NAME} lifted the trophy with a {RECORD} nobody could touch, and when the final tightened, {FINAL_HERO} made sure {OPPONENT} had no answer.",
  },
  {
    id: "champ_undefeated_07",
    outcome_class: "CHAMPION_UNDEFEATED",
    text: "History will record a clean {RECORD}, but those who watched will remember the swagger. {TEAM_NAME} were champions in every round, {TOP_SCORER} the constant threat, the final won without a tremor.",
  },

  // ─── CHAMPION_WITH_DRAWS (won it, but dropped points / needed a shootout) ────
  {
    id: "champ_draws_01",
    outcome_class: "CHAMPION_WITH_DRAWS",
    text: "Champions, the hard way. {TEAM_NAME} finished a {RECORD} run that asked everything of them, surviving {KEY_MOMENT} before {FINAL_HERO} sent them past {OPPONENT} in the final.",
  },
  {
    id: "champ_draws_02",
    outcome_class: "CHAMPION_WITH_DRAWS",
    text: "It was never comfortable, and that is what made it sweet. {TEAM_NAME} ground out a {RECORD} title with {TOP_SCORER} dragging them through the tight ones and {MANAGER} holding his nerve from the touchline.",
  },
  {
    id: "champ_draws_03",
    outcome_class: "CHAMPION_WITH_DRAWS",
    text: "They wobbled, they recovered, they won. A {RECORD} campaign and {KEY_MOMENT} along the way could not stop {TEAM_NAME} from getting their hands on the trophy.",
  },
  {
    id: "champ_draws_04",
    outcome_class: "CHAMPION_WITH_DRAWS",
    text: "Champions are not always flawless — sometimes they are just relentless. {TEAM_NAME} dropped points but never their belief, and {FINAL_HERO} had the final word against {OPPONENT}.",
  },
  {
    id: "champ_draws_05",
    outcome_class: "CHAMPION_WITH_DRAWS",
    text: "A {RECORD} that hides a hundred small dramas. {TEAM_NAME} were taken to the brink more than once, but {TOP_SCORER} kept answering and the trophy came home all the same.",
  },
  {
    id: "champ_draws_06",
    outcome_class: "CHAMPION_WITH_DRAWS",
    text: "When the knockout rounds bit hardest, {TEAM_NAME} bit back. {KEY_MOMENT} could have ended it; instead {MANAGER}'s side pushed on to a {RECORD} title.",
  },

  // ─── FINAL_LOSS (reached the final, lost it) ─────────────────────────────────
  {
    id: "final_loss_01",
    outcome_class: "FINAL_LOSS",
    text: "So close they could touch it. {TEAM_NAME} reached the final on a {RECORD} run, but {OPPONENT} had the last word and the trophy slipped away. {TOP_SCORER} gave everything; it was not quite enough.",
  },
  {
    id: "final_loss_02",
    outcome_class: "FINAL_LOSS",
    text: "One match from immortality, and it ended in heartbreak. {TEAM_NAME} fell to {OPPONENT} in the final, {VILLAIN} the name they will not soon forget.",
  },
  {
    id: "final_loss_03",
    outcome_class: "FINAL_LOSS",
    text: "Runners-up is a cruel title for a brilliant run. {TEAM_NAME} did everything but win the last game, and {KEY_MOMENT} in the final will haunt the quiet hours.",
  },
  {
    id: "final_loss_04",
    outcome_class: "FINAL_LOSS",
    text: "They wrote a wonderful story and someone else got the ending. {MANAGER}'s {TEAM_NAME} lost the final to {OPPONENT}, but a {RECORD} campaign is no small thing to carry home.",
  },
  {
    id: "final_loss_05",
    outcome_class: "FINAL_LOSS",
    text: "The final asks a different question, and this time {TEAM_NAME} could not answer it. {TOP_SCORER} carried them all the way to the showpiece; {OPPONENT} carried off the prize.",
  },
  {
    id: "final_loss_06",
    outcome_class: "FINAL_LOSS",
    text: "A silver medal and a thousand what-ifs. {TEAM_NAME} stood toe to toe with {OPPONENT} in the final and came up a moment short.",
  },

  // ─── SF_EXIT (out in the semi-finals) ────────────────────────────────────────
  {
    id: "sf_exit_01",
    outcome_class: "SF_EXIT",
    text: "The final was in sight and then it was gone. {TEAM_NAME} bowed out in the semi-finals to {OPPONENT}, a {RECORD} run ending one step from the showpiece.",
  },
  {
    id: "sf_exit_02",
    outcome_class: "SF_EXIT",
    text: "Among the last four and proud of it, even through the disappointment. {TEAM_NAME} ran into {OPPONENT} in the semis, and {VILLAIN} proved the difference.",
  },
  {
    id: "sf_exit_03",
    outcome_class: "SF_EXIT",
    text: "A semi-final is a fine place to lose and a painful one all the same. {TOP_SCORER} dragged {TEAM_NAME} to the brink of the final before {OPPONENT} shut the door.",
  },
  {
    id: "sf_exit_04",
    outcome_class: "SF_EXIT",
    text: "So near the final, so far from forgetting it. {KEY_MOMENT} turned the semi-final, and {TEAM_NAME} were left to wonder what might have been.",
  },
  {
    id: "sf_exit_05",
    outcome_class: "SF_EXIT",
    text: "{MANAGER}'s side reached the last four on merit and left it with regret. A {RECORD} campaign deserved a final; {OPPONENT} decided otherwise.",
  },

  // ─── QF_EXIT (out in the quarter-finals) ─────────────────────────────────────
  {
    id: "qf_exit_01",
    outcome_class: "QF_EXIT",
    text: "The quarter-final is where the tournament gets serious, and there {TEAM_NAME} met their match. {OPPONENT} ended a {RECORD} run with {TOP_SCORER} unable to find the breakthrough.",
  },
  {
    id: "qf_exit_02",
    outcome_class: "QF_EXIT",
    text: "Eight teams left, and {TEAM_NAME} were not among the four that went on. {KEY_MOMENT} settled a tense quarter-final in {OPPONENT}'s favour.",
  },
  {
    id: "qf_exit_03",
    outcome_class: "QF_EXIT",
    text: "A last-eight exit stings precisely because the dream had grown real. {TEAM_NAME} fell to {OPPONENT}, with {VILLAIN} the tormentor on the day.",
  },
  {
    id: "qf_exit_04",
    outcome_class: "QF_EXIT",
    text: "They reached the quarter-finals and ran out of road. {MANAGER}'s {TEAM_NAME} can hold their heads high after a {RECORD} campaign that promised more.",
  },
  {
    id: "qf_exit_05",
    outcome_class: "QF_EXIT",
    text: "The quarter-final door was ajar and then it slammed. {TOP_SCORER} fought to the last, but {OPPONENT} had just a little more.",
  },

  // ─── R16_EXIT (out in the round of 16) ───────────────────────────────────────
  {
    id: "r16_exit_01",
    outcome_class: "R16_EXIT",
    text: "Out of the group and into the knockouts, but no further. {TEAM_NAME} fell in the round of 16 to {OPPONENT}, their {RECORD} run ending earlier than they had hoped.",
  },
  {
    id: "r16_exit_02",
    outcome_class: "R16_EXIT",
    text: "The first knockout hurdle proved the last. {KEY_MOMENT} sent {TEAM_NAME} home in the round of 16, with {TOP_SCORER} left to rue the fine margins.",
  },
  {
    id: "r16_exit_03",
    outcome_class: "R16_EXIT",
    text: "A place in the last sixteen is progress; losing it is still a wound. {OPPONENT} edged {TEAM_NAME}, and {VILLAIN} did the damage.",
  },
  {
    id: "r16_exit_04",
    outcome_class: "R16_EXIT",
    text: "{MANAGER}'s side cleared the group and stumbled at the next step. The round of 16 was as far as {TEAM_NAME} went, on a {RECORD} run with plenty to build on.",
  },
  {
    id: "r16_exit_05",
    outcome_class: "R16_EXIT",
    text: "Knockout football is unforgiving, and {TEAM_NAME} learned it in the round of 16. {OPPONENT} advanced; the dream paused for another four years.",
  },

  // ─── R32_EXIT (out in the round of 32) ───────────────────────────────────────
  {
    id: "r32_exit_01",
    outcome_class: "R32_EXIT",
    text: "Into the knockouts and straight back out. {TEAM_NAME} exited in the round of 32 to {OPPONENT}, a brief but honest {RECORD} campaign.",
  },
  {
    id: "r32_exit_02",
    outcome_class: "R32_EXIT",
    text: "The opening knockout tie proved a bridge too far. {KEY_MOMENT} undid {TEAM_NAME} in the round of 32, with {TOP_SCORER}'s goals not quite enough.",
  },
  {
    id: "r32_exit_03",
    outcome_class: "R32_EXIT",
    text: "They qualified, they competed, and then {OPPONENT} sent them home. The round of 32 was the end of the line for {TEAM_NAME}, {VILLAIN} the difference.",
  },
  {
    id: "r32_exit_04",
    outcome_class: "R32_EXIT",
    text: "A first taste of knockout pressure, and {TEAM_NAME} could not hold on. {MANAGER}'s side fell in the round of 32 after a {RECORD} run.",
  },
  {
    id: "r32_exit_05",
    outcome_class: "R32_EXIT",
    text: "Reaching the knockouts was the floor, not the ceiling — but the ceiling came fast. {OPPONENT} ended {TEAM_NAME}'s tournament in the round of 32.",
  },

  // ─── GROUP_EXIT (out in the group, but won at least once) ─────────────────────
  {
    id: "group_exit_01",
    outcome_class: "GROUP_EXIT",
    text: "A win was not enough to carry them through. {TEAM_NAME} bowed out in the group stage on a {RECORD} that flattered to deceive, with {TOP_SCORER} the bright spot.",
  },
  {
    id: "group_exit_02",
    outcome_class: "GROUP_EXIT",
    text: "Three group games, some hope, and an early flight home. {TEAM_NAME} found a result or two but {KEY_MOMENT} summed up a campaign that never caught fire.",
  },
  {
    id: "group_exit_03",
    outcome_class: "GROUP_EXIT",
    text: "They showed they belonged and still went out. A {RECORD} group stage was not enough for {TEAM_NAME}, and {MANAGER} will know it could have been more.",
  },
  {
    id: "group_exit_04",
    outcome_class: "GROUP_EXIT",
    text: "The group stage giveth and the group stage taketh away. {TEAM_NAME} mixed a win with the wrong results elsewhere and were gone before the knockouts.",
  },
  {
    id: "group_exit_05",
    outcome_class: "GROUP_EXIT",
    text: "Fine margins, hard lessons. {TOP_SCORER} gave {TEAM_NAME} something to cheer, but a {RECORD} group return sent them home early.",
  },

  // ─── GROUP_WINLESS (out in the group with zero wins) ──────────────────────────
  {
    id: "group_winless_01",
    outcome_class: "GROUP_WINLESS",
    text: "No wins, no escape. {TEAM_NAME} finished the group stage on a {RECORD} without a victory to show for it, a chastening tournament from first whistle to last.",
  },
  {
    id: "group_winless_02",
    outcome_class: "GROUP_WINLESS",
    text: "A tournament to forget. {TEAM_NAME} left the group stage winless, {KEY_MOMENT} about the only thing worth replaying from a difficult three games.",
  },
  {
    id: "group_winless_03",
    outcome_class: "GROUP_WINLESS",
    text: "Sometimes the gap is simply too wide. {TEAM_NAME} went out at the group stage without a win, and {MANAGER} faces hard questions on the long road back.",
  },
  {
    id: "group_winless_04",
    outcome_class: "GROUP_WINLESS",
    text: "Three matches, no wins, an early exit. {TEAM_NAME} could not find the result that mattered, and a {RECORD} group stage tells the whole sorry story.",
  },
  {
    id: "group_winless_05",
    outcome_class: "GROUP_WINLESS",
    text: "Even {TOP_SCORER} could not spark a win. {TEAM_NAME} departed the group stage with nothing but lessons, the campaign over before it began.",
  },
];

/**
 * Templates indexed by outcome class, in the stable array order above. Built
 * once at module load; the per-class arrays are what selection draws from.
 */
const TEMPLATES_BY_CLASS: Readonly<Record<OutcomeClass, readonly NarrativeTemplate[]>> = (() => {
  const groups: Record<OutcomeClass, NarrativeTemplate[]> = {
    CHAMPION_UNDEFEATED: [],
    CHAMPION_WITH_DRAWS: [],
    FINAL_LOSS: [],
    SF_EXIT: [],
    QF_EXIT: [],
    R16_EXIT: [],
    R32_EXIT: [],
    GROUP_EXIT: [],
    GROUP_WINLESS: [],
  };
  for (const t of NARRATIVE_TEMPLATES) {
    groups[t.outcome_class].push(t);
  }
  return groups;
})();

/**
 * Return the (non-empty, stably-ordered) template bank for an outcome class.
 * @throws Error if a class somehow has no templates — a packaging bug, caught
 *   loudly rather than silently producing an empty narrative.
 */
export function templatesForClass(outcome: OutcomeClass): readonly NarrativeTemplate[] {
  const bank = TEMPLATES_BY_CLASS[outcome];
  if (bank.length === 0) {
    throw new Error(`no narrative templates registered for outcome class: ${outcome}`);
  }
  return bank;
}

/**
 * Classify a run into exactly one `OutcomeClass`. Reads ONLY the authoritative
 * summary fields persisted on the run (champion flag, undefeated flag, record
 * counts, reached round) — no event scanning needed for the coarse class.
 *
 * A champion plays all eight matches; a clean 8-0 (no draws, no losses, no
 * shootout) is CHAMPION_UNDEFEATED, anything else won is CHAMPION_WITH_DRAWS.
 * Non-champions classify by the furthest round reached, with the group stage
 * split on whether any win was recorded.
 */
export function classifyOutcome(run: RunResult): OutcomeClass {
  if (run.is_champion) {
    const cleanSweep =
      run.undefeated_regulation &&
      run.draws === 0 &&
      run.losses === 0 &&
      run.shootout_wins === 0 &&
      run.shootout_losses === 0;
    return cleanSweep ? "CHAMPION_UNDEFEATED" : "CHAMPION_WITH_DRAWS";
  }

  switch (run.reached_round) {
    case "F":
      return "FINAL_LOSS";
    case "SF":
      return "SF_EXIT";
    case "QF":
      return "QF_EXIT";
    case "R16":
      return "R16_EXIT";
    case "R32":
      return "R32_EXIT";
    case "G1":
    case "G2":
    case "G3":
      return run.wins > 0 ? "GROUP_EXIT" : "GROUP_WINLESS";
    default: {
      // Exhaustiveness guard — a new MatchRound must be classified explicitly.
      const _exhaustive: never = run.reached_round;
      throw new Error(`unclassifiable reached_round: ${String(_exhaustive)}`);
    }
  }
}
