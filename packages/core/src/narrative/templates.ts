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

import type {
  NarrativeScenarioFamily,
  NarrativeTemplate,
  OutcomeClass,
} from "../types/narrative.js";
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

  // ─── SCENARIO-AWARE FAMILIES (deterministic, event-derived) ────────────────
  {
    id: "scn_dominant_blowout_01",
    outcome_class: "ANY",
    scenario_family: "dominant_blowout",
    text: "The run found its stride in {SCENARIO_ROUND}: a {SCENARIO_SCORE} win {SCENARIO_METHOD}, a {SCENARIO_MARGIN}-goal cushion, and {SCENARIO_PLAYER} at the front of the charge.",
  },
  {
    id: "scn_dominant_blowout_02",
    outcome_class: "ANY",
    scenario_family: "dominant_blowout",
    text: "{SCENARIO_ROUND} was the match that announced {TEAM_NAME}. {SCENARIO_PLAYER} helped turn it into a {SCENARIO_SCORE} statement, the kind of margin that makes the bracket look twice.",
  },
  {
    id: "scn_narrow_one_nil_01",
    outcome_class: "ANY",
    scenario_family: "narrow_one_nil",
    text: "Not every step was loud. {SCENARIO_ROUND} was won 1-0, {SCENARIO_PLAYER} supplying the thin line between control and trouble.",
  },
  {
    id: "scn_narrow_one_nil_02",
    outcome_class: "ANY",
    scenario_family: "narrow_one_nil",
    text: "The quiet win mattered. In {SCENARIO_ROUND}, {TEAM_NAME} protected a 1-0 edge and let {SCENARIO_PLAYER}'s finish carry the day.",
  },
  {
    id: "scn_comeback_from_behind_01",
    outcome_class: "ANY",
    scenario_family: "comeback_from_behind",
    text: "The tournament bent toward trouble before {TEAM_NAME} bent it back. In {SCENARIO_ROUND}, the match became a comeback, with {SCENARIO_PLAYER} dragging the scoreline to {SCENARIO_SCORE}.",
  },
  {
    id: "scn_comeback_from_behind_02",
    outcome_class: "ANY",
    scenario_family: "comeback_from_behind",
    text: "Behind on the board, not beaten in the match. {TEAM_NAME} turned {SCENARIO_ROUND} around {SCENARIO_METHOD}, and {SCENARIO_PLAYER} was on the page where the response began.",
  },
  {
    id: "scn_extra_time_winner_01",
    outcome_class: "ANY",
    scenario_family: "extra_time_winner",
    text: "Extra time did not blur the story; it sharpened it. {SCENARIO_PLAYER} found the decisive touch in {SCENARIO_ROUND}, pushing {TEAM_NAME} through {SCENARIO_METHOD}.",
  },
  {
    id: "scn_extra_time_winner_02",
    outcome_class: "ANY",
    scenario_family: "extra_time_winner",
    text: "The legs were heavy and the margin was still there to win. {SCENARIO_PLAYER} settled {SCENARIO_ROUND} after extra time, a {SCENARIO_SCORE} verdict that felt earned.",
  },
  {
    id: "scn_shootout_drama_01",
    outcome_class: "ANY",
    scenario_family: "shootout_drama",
    text: "Penalties wrote their own chapter in {SCENARIO_ROUND}. {SCENARIO_PLAYER} was tied to the final walk from the spot as the shootout finished {SCENARIO_SCORE}.",
  },
  {
    id: "scn_shootout_drama_02",
    outcome_class: "ANY",
    scenario_family: "shootout_drama",
    text: "In {SCENARIO_ROUND}, the match went all the way to penalties, where it shrank to breath, boots, and nerve. The shootout finished {SCENARIO_SCORE}, with {SCENARIO_PLAYER} in the sequence.",
  },
  {
    id: "scn_clean_sheet_masterclass_01",
    outcome_class: "ANY",
    scenario_family: "clean_sheet_masterclass",
    text: "The defence had a name at its base: {SCENARIO_PLAYER}. {TEAM_NAME} stacked clean sheets across the run, with {SCENARIO_ROUND}'s {SCENARIO_SCORE} shutout the clearest proof.",
  },
  {
    id: "scn_clean_sheet_masterclass_02",
    outcome_class: "ANY",
    scenario_family: "clean_sheet_masterclass",
    text: "Every run needs a match where the door stays locked. {SCENARIO_PLAYER} kept it that way in {SCENARIO_ROUND}, part of a {SCENARIO_CLEAN_SHEETS}-clean-sheet campaign.",
  },
  {
    id: "scn_hat_trick_hero_01",
    outcome_class: "ANY",
    scenario_family: "hat_trick_hero",
    text: "{SCENARIO_PLAYER} did not just score; he took the match home. {SCENARIO_GOALS} goals in {SCENARIO_ROUND} turned the score into {SCENARIO_SCORE} and the headline into his.",
  },
  {
    id: "scn_hat_trick_hero_02",
    outcome_class: "ANY",
    scenario_family: "hat_trick_hero",
    text: "There are team wins, and then there are matches seized by one finisher. {SCENARIO_PLAYER}'s {SCENARIO_GOALS}-goal burst in {SCENARIO_ROUND} gave {TEAM_NAME} that kind of day.",
  },
  {
    id: "scn_multi_goal_hero_01",
    outcome_class: "ANY",
    scenario_family: "multi_goal_hero",
    text: "{SCENARIO_PLAYER} delivered the repeat blow in {SCENARIO_ROUND}, scoring {SCENARIO_GOALS} as {TEAM_NAME} shaped a {SCENARIO_SCORE} result.",
  },
  {
    id: "scn_multi_goal_hero_02",
    outcome_class: "ANY",
    scenario_family: "multi_goal_hero",
    text: "When {SCENARIO_ROUND} asked for a finisher, {SCENARIO_PLAYER} answered twice. Those {SCENARIO_GOALS} goals gave the run a sharper edge.",
  },
  {
    id: "scn_demolition_margin_four_01",
    outcome_class: "ANY",
    scenario_family: "demolition_margin_four",
    text: "{SCENARIO_ROUND} was not a contest for long. {TEAM_NAME} finished it {SCENARIO_SCORE}, a {SCENARIO_MARGIN}-goal demolition that reset the tournament's volume.",
  },
  {
    id: "scn_demolition_margin_four_02",
    outcome_class: "ANY",
    scenario_family: "demolition_margin_four",
    text: "The biggest swing came in {SCENARIO_ROUND}: {SCENARIO_SCORE}, {SCENARIO_METHOD}, and a margin wide enough to leave no argument.",
  },
  {
    id: "scn_low_event_grind_01",
    outcome_class: "ANY",
    scenario_family: "low_event_grind",
    text: "The grind was real in {SCENARIO_ROUND}. Few chances, no waste, and {SCENARIO_PLAYER} making the decisive touch in a {SCENARIO_SCORE} win.",
  },
  {
    id: "scn_low_event_grind_02",
    outcome_class: "ANY",
    scenario_family: "low_event_grind",
    text: "{TEAM_NAME} also knew how to win without spectacle. In {SCENARIO_ROUND}, it was a low-event squeeze, settled {SCENARIO_SCORE} by {SCENARIO_PLAYER}.",
  },
  {
    id: "scn_manager_masterstroke_01",
    outcome_class: "ANY",
    scenario_family: "manager_masterstroke",
    text: "{MANAGER} found a lever in {SCENARIO_ROUND}. {SCENARIO_PLAYER} came from the bench as the match tilted, and {TEAM_NAME} walked out with a {SCENARIO_SCORE} win.",
  },
  {
    id: "scn_manager_masterstroke_02",
    outcome_class: "ANY",
    scenario_family: "manager_masterstroke",
    text: "The touchline mattered in {SCENARIO_ROUND}. {MANAGER}'s change introduced {SCENARIO_PLAYER}, and the match finished {SCENARIO_SCORE} in {TEAM_NAME}'s favour.",
  },
  {
    id: "scn_defensive_wall_01",
    outcome_class: "ANY",
    scenario_family: "defensive_wall",
    text: "{SCENARIO_PLAYER} and {SCENARIO_PLAYER_TWO} gave the run its hard edge. The defensive wall held in {SCENARIO_ROUND}, where {TEAM_NAME} kept the score at {SCENARIO_SCORE}.",
  },
  {
    id: "scn_defensive_wall_02",
    outcome_class: "ANY",
    scenario_family: "defensive_wall",
    text: "Before the forwards could decorate it, {SCENARIO_PLAYER} and {SCENARIO_PLAYER_TWO} protected it. {SCENARIO_ROUND}'s clean sheet was not accidental.",
  },
  {
    id: "scn_midfield_control_01",
    outcome_class: "ANY",
    scenario_family: "midfield_control",
    text: "{SCENARIO_PLAYER} gave {TEAM_NAME} the rhythm in {SCENARIO_ROUND}. The match finished {SCENARIO_SCORE}, but the control started in midfield.",
  },
  {
    id: "scn_midfield_control_02",
    outcome_class: "ANY",
    scenario_family: "midfield_control",
    text: "The scoreboard says {SCENARIO_SCORE}; the match tape points to {SCENARIO_PLAYER}. {SCENARIO_ROUND} was managed through midfield before it was finished up front.",
  },
  {
    id: "scn_perfect_run_milestone_01",
    outcome_class: "CHAMPION_UNDEFEATED",
    scenario_family: "perfect_run_milestone",
    text: "Perfect really means perfect here: {RECORD}, trophy won, and no result left to explain away. {FINAL_HERO} closed the final against {SCENARIO_OPPONENT}; {TOP_SCORER} carried the threat through the whole run.",
  },
  {
    id: "scn_perfect_run_milestone_02",
    outcome_class: "CHAMPION_UNDEFEATED",
    scenario_family: "perfect_run_milestone",
    text: "Eight matches, eight wins, a champion's clean line. {TEAM_NAME} made {RECORD} feel inevitable, with {FINAL_HERO} turning the final past {SCENARIO_OPPONENT}.",
  },
  {
    id: "scn_elimination_heartbreak_01",
    outcome_class: "ANY",
    scenario_family: "elimination_heartbreak",
    text: "The exit came in {SCENARIO_ROUND}, and it came with a scoreline that will sit badly: {SCENARIO_SCORE}. {SCENARIO_PLAYER} was the name on the other side of the heartbreak.",
  },
  {
    id: "scn_elimination_heartbreak_02",
    outcome_class: "ANY",
    scenario_family: "elimination_heartbreak",
    text: "{TEAM_NAME}'s tournament ended in {SCENARIO_ROUND}, {SCENARIO_SCORE} against {SCENARIO_OPPONENT}. The last whistle made the round feel final.",
  },
  {
    id: "scn_era_clash_01",
    outcome_class: "ANY",
    scenario_family: "era_clash",
    text: "This was a {SCENARIO_ERA_NOTE} dressing room: {SCENARIO_PLAYER} from one football age, {SCENARIO_PLAYER_TWO} from another, both pulled into the same run.",
  },
  {
    id: "scn_era_clash_02",
    outcome_class: "ANY",
    scenario_family: "era_clash",
    text: "{TEAM_NAME} looked like a cross-era argument in motion. The {SCENARIO_ERA_NOTE} spread put {SCENARIO_PLAYER} and {SCENARIO_PLAYER_TWO} in the same XI.",
  },
  {
    id: "scn_debut_tournament_core_01",
    outcome_class: "ANY",
    scenario_family: "debut_tournament_core",
    text: "The modern core was not decoration. {SCENARIO_PLAYER} and the 2026 group gave {TEAM_NAME} a present-tense spine inside the wider all-era build.",
  },
  {
    id: "scn_debut_tournament_core_02",
    outcome_class: "ANY",
    scenario_family: "debut_tournament_core",
    text: "A run this old-and-new still had a 2026 pulse. {SCENARIO_PLAYER} stood for the debut-tournament core that kept the side current.",
  },
  {
    id: "scn_bench_impact_01",
    outcome_class: "ANY",
    scenario_family: "bench_impact",
    text: "The bench was not just cover. {SCENARIO_PLAYER} changed {SCENARIO_ROUND}, helping push the match to {SCENARIO_SCORE}.",
  },
  {
    id: "scn_bench_impact_02",
    outcome_class: "ANY",
    scenario_family: "bench_impact",
    text: "In {SCENARIO_ROUND}, the match needed a second wave, and {SCENARIO_PLAYER} supplied it. The rotation note became a result note at {SCENARIO_SCORE}.",
  },
  {
    id: "scn_cross_era_matchup_01",
    outcome_class: "ANY",
    scenario_family: "cross_era_matchup",
    text: "{SCENARIO_ROUND} carried the feel of a cross-era matchup: {SCENARIO_PLAYER} and {SCENARIO_PLAYER_TWO} on one side of the timeline, {SCENARIO_OPPONENT} on the other.",
  },
  {
    id: "scn_cross_era_matchup_02",
    outcome_class: "ANY",
    scenario_family: "cross_era_matchup",
    text: "The bracket gave {TEAM_NAME} a modern opponent in {SCENARIO_OPPONENT}; the XI answered with a {SCENARIO_ERA_NOTE} blend led by {SCENARIO_PLAYER} and {SCENARIO_PLAYER_TWO}.",
  },
  {
    id: "scn_final_hero_01",
    outcome_class: "ANY",
    scenario_family: "final_hero",
    text: "Finals remember names. This one remembered {SCENARIO_PLAYER}, whose final touch helped settle {SCENARIO_SCORE}.",
  },
  {
    id: "scn_final_hero_02",
    outcome_class: "ANY",
    scenario_family: "final_hero",
    text: "{SCENARIO_PLAYER} became the final's answer. {SCENARIO_SCORE} was the scoreline; the moment belonged to the player who made it count.",
  },
  {
    id: "scn_early_breakthrough_01",
    outcome_class: "ANY",
    scenario_family: "early_breakthrough",
    text: "{TEAM_NAME} did not wait for permission in {SCENARIO_ROUND}. {SCENARIO_PLAYER}'s early breakthrough gave the match its first shape.",
  },
  {
    id: "scn_early_breakthrough_02",
    outcome_class: "ANY",
    scenario_family: "early_breakthrough",
    text: "The first punch in {SCENARIO_ROUND} came early, from {SCENARIO_PLAYER}. After that, {TEAM_NAME} had a match to manage rather than chase.",
  },
  {
    id: "scn_late_winner_01",
    outcome_class: "ANY",
    scenario_family: "late_winner",
    text: "Late winners change the temperature of a run. {SCENARIO_PLAYER} found one in {SCENARIO_ROUND}, and the {SCENARIO_SCORE} result carried extra weight.",
  },
  {
    id: "scn_late_winner_02",
    outcome_class: "ANY",
    scenario_family: "late_winner",
    text: "{SCENARIO_ROUND} was still alive late, which made {SCENARIO_PLAYER}'s winner feel bigger than one goal. The board read {SCENARIO_SCORE}; the run read belief.",
  },
  {
    id: "scn_red_card_resilience_01",
    outcome_class: "ANY",
    scenario_family: "red_card_resilience",
    text: "A red card to {SCENARIO_PLAYER} should have made {SCENARIO_ROUND} tilt away. Instead {TEAM_NAME} held together and still reached a {SCENARIO_SCORE} result.",
  },
  {
    id: "scn_red_card_resilience_02",
    outcome_class: "ANY",
    scenario_family: "red_card_resilience",
    text: "The hardest minutes came after {SCENARIO_PLAYER}'s dismissal. {TEAM_NAME} absorbed them in {SCENARIO_ROUND}, turning chaos into {SCENARIO_SCORE}.",
  },
  {
    id: "scn_penalty_miss_redemption_01",
    outcome_class: "ANY",
    scenario_family: "penalty_miss_redemption",
    text: "{SCENARIO_PLAYER} had to live with a missed penalty in {SCENARIO_ROUND}, then helped write the recovery. The match still finished {SCENARIO_SCORE}.",
  },
  {
    id: "scn_penalty_miss_redemption_02",
    outcome_class: "ANY",
    scenario_family: "penalty_miss_redemption",
    text: "The spot kick did not go, but the head did not drop. {SCENARIO_PLAYER} stayed in the story as {TEAM_NAME} recovered to {SCENARIO_SCORE}.",
  },
  {
    id: "scn_keeper_penalty_save_01",
    outcome_class: "ANY",
    scenario_family: "keeper_penalty_save",
    text: "{SCENARIO_PLAYER} owned the penalty moment in {SCENARIO_ROUND}. One save, one swing, and a {SCENARIO_SCORE} result that had his gloves on it.",
  },
  {
    id: "scn_keeper_penalty_save_02",
    outcome_class: "ANY",
    scenario_family: "keeper_penalty_save",
    text: "Penalty saves are not footnotes. {SCENARIO_PLAYER}'s stop in {SCENARIO_ROUND} gave {TEAM_NAME} the room to finish {SCENARIO_SCORE}.",
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
    if (t.scenario_family === undefined && t.outcome_class !== "ANY") {
      groups[t.outcome_class].push(t);
    }
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
 * Return scenario templates for a fired family and current outcome. Scenario
 * templates can either opt into a specific outcome class or use "ANY".
 */
export function templatesForScenarioFamily(
  outcome: OutcomeClass,
  family: NarrativeScenarioFamily,
): readonly NarrativeTemplate[] {
  return NARRATIVE_TEMPLATES.filter(
    (t) =>
      t.scenario_family === family && (t.outcome_class === "ANY" || t.outcome_class === outcome),
  );
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
