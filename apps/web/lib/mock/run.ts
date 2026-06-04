// ILLUSTRATIVE MOCK 8-match run for the sim-results + share screens.
//
// Each match carries a typed `MatchEvent[]` event log (the contract's source of
// truth); the box-score display lines are DERIVED from that log via
// `deriveBox` — the same events→summary derivation the contract mandates, so the
// scaffold demonstrates the real data flow on mock data. No engine is called:
// these events are authored, not simulated. The real sim lands at integration.

import {
  buildCardId,
  type GoalEvent,
  type MatchEvent,
  type MatchRound,
  type ShootoutKick,
} from "@wcdraft/core";
import { XI_BENCH, XI_STARTERS } from "./xi";

// Display-name + card lookup for every drafted player (both sides resolved via
// per-match name maps below).
const PLAYER_META = new Map<string, { name: string; card_id: string }>();
for (const s of [...XI_STARTERS, ...XI_BENCH]) {
  if (s.card) PLAYER_META.set(s.card.player_id, { name: s.card.name, card_id: s.card.card_id });
}

const ROUND_LABEL: Record<MatchRound, string> = {
  G1: "Group · Match 1",
  G2: "Group · Match 2",
  G3: "Group · Match 3",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  F: "Final",
};

export type Period = "1H" | "2H" | "ET1" | "ET2";

interface GoalLine {
  side: "user" | "opp";
  player_id: string;
  /** Display name (covers opp players not in our fixtures). */
  name: string;
  assist_id?: string;
  assist_name?: string;
  minute: number;
  period: Period;
  pen?: boolean;
}

interface CardLine {
  side: "user" | "opp";
  player_id: string;
  name: string;
  card: "yellow" | "red";
  minute: number;
  period: Period;
}

interface SubLine {
  side: "user" | "opp";
  out_id: string;
  out_name: string;
  in_id: string;
  in_name: string;
  minute: number;
  period: Period;
  reason: "tactical" | "injury";
}

interface InjuryLine {
  side: "user" | "opp";
  player_id: string;
  name: string;
  minute: number;
  period: Period;
  tournament_ending: boolean;
}

interface MatchSpec {
  round: MatchRound;
  opponent: string;
  opp_nation: string;
  reg: [number, number];
  et?: [number, number];
  pens?: [number, number];
  goals: GoalLine[];
  cards?: CardLine[];
  subs?: SubLine[];
  injuries?: InjuryLine[];
}

const cardIdFor = (side: "user" | "opp", player_id: string): string => {
  const meta = PLAYER_META.get(player_id);
  if (meta) return meta.card_id;
  // Opponent (or unmapped) players get a synthetic 2026 card id.
  return buildCardId(`${side}-${player_id}`, 2026) as string;
};

const PERIOD_ORDER: Record<Period, number> = { "1H": 0, "2H": 1, ET1: 2, ET2: 3 };

/** Build the typed event log + meta for one match from its authored spec. */
function buildMatch(spec: MatchSpec, index: number) {
  const match_id = `m${index}`;
  const names: Record<string, string> = {};
  const events: MatchEvent[] = [];
  let n = 0;
  const eid = () => `${match_id}-e${n++}`;

  // Goals, in chronological order, with running cumulative score_after.
  const goals = [...spec.goals].sort(
    (a, b) => PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period] || a.minute - b.minute,
  );
  let u = 0;
  let o = 0;
  for (const g of goals) {
    if (g.side === "user") u++;
    else o++;
    names[g.player_id] = g.name;
    if (g.assist_id && g.assist_name) names[g.assist_id] = g.assist_name;
    const base = {
      event_id: eid(),
      minute: g.minute,
      period: g.period,
      side: g.side,
    } as const;
    if (g.pen) {
      events.push({
        ...base,
        type: "pen_scored",
        taker_card_id: cardIdFor(g.side, g.player_id) as GoalEvent["scorer_card_id"],
        taker_player_id: g.player_id,
        score_after: { user: u, opp: o },
      });
    } else {
      events.push({
        ...base,
        type: "goal",
        scorer_card_id: cardIdFor(g.side, g.player_id) as GoalEvent["scorer_card_id"],
        scorer_player_id: g.player_id,
        assist_card_id: g.assist_id ? (cardIdFor(g.side, g.assist_id) as GoalEvent["scorer_card_id"]) : null,
        assist_player_id: g.assist_id ?? null,
        score_after: { user: u, opp: o },
      });
    }
  }

  for (const c of spec.cards ?? []) {
    names[c.player_id] = c.name;
    events.push({
      event_id: eid(),
      minute: c.minute,
      period: c.period,
      side: c.side,
      type: c.card,
      card_id: cardIdFor(c.side, c.player_id) as GoalEvent["scorer_card_id"],
      player_id: c.player_id,
    });
  }

  for (const s of spec.subs ?? []) {
    names[s.out_id] = s.out_name;
    names[s.in_id] = s.in_name;
    events.push({
      event_id: eid(),
      minute: s.minute,
      period: s.period,
      side: s.side,
      type: "sub",
      in_card_id: cardIdFor(s.side, s.in_id) as GoalEvent["scorer_card_id"],
      in_player_id: s.in_id,
      out_card_id: cardIdFor(s.side, s.out_id) as GoalEvent["scorer_card_id"],
      out_player_id: s.out_id,
      reason: s.reason,
    });
  }

  for (const inj of spec.injuries ?? []) {
    names[inj.player_id] = inj.name;
    events.push({
      event_id: eid(),
      minute: inj.minute,
      period: inj.period,
      side: inj.side,
      type: "injury",
      card_id: cardIdFor(inj.side, inj.player_id) as GoalEvent["scorer_card_id"],
      player_id: inj.player_id,
      tournament_ending: inj.tournament_ending,
    });
  }

  const userTotal = spec.reg[0] + (spec.et ? spec.et[0] : 0);
  const oppTotal = spec.reg[1] + (spec.et ? spec.et[1] : 0);
  let outcome: "W" | "D" | "L";
  if (spec.pens) outcome = spec.pens[0] > spec.pens[1] ? "W" : "L";
  else if (userTotal > oppTotal) outcome = "W";
  else if (userTotal < oppTotal) outcome = "L";
  else outcome = "D";

  let shootout: { user: number; opp: number; sequence: ShootoutKick[] } | null = null;
  if (spec.pens) {
    shootout = { user: spec.pens[0], opp: spec.pens[1], sequence: [] };
  }

  return {
    match_id,
    match_index: index,
    round: spec.round,
    round_label: ROUND_LABEL[spec.round],
    opponent: spec.opponent,
    opp_nation: spec.opp_nation,
    reg: spec.reg,
    et: spec.et ?? null,
    shootout,
    outcome,
    events,
    names,
  };
}

export type MatchBox = ReturnType<typeof buildMatch>;

// Derived box-score display lines from a match's event log.
export interface BoxLine {
  name: string;
  minute: number;
  period: Period | "shootout";
  detail?: string;
}
export interface DerivedBox {
  userGoals: BoxLine[];
  oppGoals: BoxLine[];
  cards: (BoxLine & { card: "yellow" | "red"; side: "user" | "opp" })[];
  subs: (BoxLine & { off: string; side: "user" | "opp" })[];
  injuries: (BoxLine & { side: "user" | "opp"; ending: boolean })[];
}

/** Derive the rendered box score from the typed event log (contract data flow). */
export function deriveBox(m: MatchBox): DerivedBox {
  const nameOf = (id: string | null): string => (id ? (m.names[id] ?? id) : "—");
  const out: DerivedBox = { userGoals: [], oppGoals: [], cards: [], subs: [], injuries: [] };
  for (const e of m.events) {
    if (e.type === "goal" || e.type === "pen_scored") {
      const pid = e.type === "goal" ? e.scorer_player_id : e.taker_player_id;
      const assist = e.type === "goal" && e.assist_player_id ? `assist ${nameOf(e.assist_player_id)}` : undefined;
      const line: BoxLine = {
        name: nameOf(pid),
        minute: e.minute,
        period: e.period as Period,
        detail: e.type === "pen_scored" ? "pen" : assist,
      };
      if (e.side === "user") out.userGoals.push(line);
      else out.oppGoals.push(line);
    } else if (e.type === "yellow" || e.type === "red") {
      out.cards.push({ name: nameOf(e.player_id), minute: e.minute, period: e.period as Period, card: e.type, side: e.side });
    } else if (e.type === "sub") {
      out.subs.push({ name: nameOf(e.in_player_id), off: nameOf(e.out_player_id), minute: e.minute, period: e.period as Period, side: e.side });
    } else if (e.type === "injury") {
      out.injuries.push({ name: nameOf(e.player_id), minute: e.minute, period: e.period as Period, side: e.side, ending: e.tournament_ending });
    }
  }
  return out;
}

// ─── THE 8-MATCH RUN — a champion campaign with ET + a shootout for variety. ──
const SPECS: MatchSpec[] = [
  {
    round: "G1",
    opponent: "Mexico",
    opp_nation: "mex",
    reg: [3, 0],
    goals: [
      { side: "user", player_id: "bra-pele", name: "Pelé", minute: 18, period: "1H", assist_id: "fra-zidane", assist_name: "Zidane" },
      { side: "user", player_id: "ned-cruyff", name: "Cruyff", minute: 51, period: "2H" },
      { side: "user", player_id: "bra-garrincha", name: "Garrincha", minute: 77, period: "2H" },
    ],
    cards: [{ side: "opp", player_id: "mex-1", name: "Álvarez", card: "yellow", minute: 64, period: "2H" }],
  },
  {
    round: "G2",
    opponent: "Croatia",
    opp_nation: "cro",
    reg: [2, 1],
    goals: [
      { side: "opp", player_id: "cro-1", name: "Kovač", minute: 9, period: "1H" },
      { side: "user", player_id: "fra-zidane", name: "Zidane", minute: 39, period: "1H" },
      { side: "user", player_id: "bra-pele", name: "Pelé", minute: 88, period: "2H", pen: true },
    ],
    subs: [{ side: "user", out_id: "bra-garrincha", out_name: "Garrincha", in_id: "arg-maradona", in_name: "Maradona", minute: 70, period: "2H", reason: "tactical" }],
  },
  {
    round: "G3",
    opponent: "Japan",
    opp_nation: "jpn",
    reg: [4, 1],
    goals: [
      { side: "user", player_id: "arg-maradona", name: "Maradona", minute: 12, period: "1H" },
      { side: "user", player_id: "ned-cruyff", name: "Cruyff", minute: 33, period: "1H" },
      { side: "opp", player_id: "jpn-1", name: "Endo", minute: 45, period: "1H" },
      { side: "user", player_id: "bra-pele", name: "Pelé", minute: 58, period: "2H" },
      { side: "user", player_id: "deu-matthaus", name: "Matthäus", minute: 81, period: "2H", pen: true },
    ],
  },
  {
    round: "R32",
    opponent: "Portugal",
    opp_nation: "por",
    reg: [2, 0],
    goals: [
      { side: "user", player_id: "bra-garrincha", name: "Garrincha", minute: 26, period: "1H" },
      { side: "user", player_id: "fra-zidane", name: "Zidane", minute: 69, period: "2H", assist_id: "esp-xavi", assist_name: "Xavi" },
    ],
  },
  {
    round: "R16",
    opponent: "Germany",
    opp_nation: "deu",
    reg: [1, 1],
    et: [1, 0],
    goals: [
      { side: "opp", player_id: "deu-1", name: "Klose", minute: 37, period: "1H" },
      { side: "user", player_id: "bra-pele", name: "Pelé", minute: 73, period: "2H" },
      { side: "user", player_id: "arg-maradona", name: "Maradona", minute: 104, period: "ET1" },
    ],
    injuries: [{ side: "user", player_id: "bra-cafu", name: "Cafu", minute: 96, period: "ET1", tournament_ending: false }],
  },
  {
    round: "QF",
    opponent: "England",
    opp_nation: "eng",
    reg: [1, 1],
    et: [0, 0],
    pens: [4, 2],
    goals: [
      { side: "user", player_id: "ned-cruyff", name: "Cruyff", minute: 22, period: "1H" },
      { side: "opp", player_id: "eng-1", name: "Kane", minute: 84, period: "2H", pen: true },
    ],
    cards: [{ side: "user", player_id: "deu-matthaus", name: "Matthäus", card: "yellow", minute: 58, period: "2H" }],
  },
  {
    round: "SF",
    opponent: "France",
    opp_nation: "fra",
    reg: [3, 1],
    goals: [
      { side: "user", player_id: "bra-pele", name: "Pelé", minute: 14, period: "1H" },
      { side: "opp", player_id: "fra-1", name: "Mbappé", minute: 30, period: "1H" },
      { side: "user", player_id: "fra-zidane", name: "Zidane", minute: 55, period: "2H" },
      { side: "user", player_id: "ned-cruyff", name: "Cruyff", minute: 90, period: "2H" },
    ],
  },
  {
    round: "F",
    opponent: "Argentina",
    opp_nation: "arg",
    reg: [2, 1],
    goals: [
      { side: "user", player_id: "bra-pele", name: "Pelé", minute: 27, period: "1H" },
      { side: "opp", player_id: "arg-1", name: "Messi", minute: 61, period: "2H" },
      { side: "user", player_id: "arg-maradona", name: "Maradona", minute: 79, period: "2H", assist_id: "ned-cruyff", assist_name: "Cruyff" },
    ],
  },
];

export const RUN_MATCHES: MatchBox[] = SPECS.map((s, i) => buildMatch(s, i));

export interface RunSummary {
  team_name: string;
  reached_round: MatchRound;
  is_champion: boolean;
  undefeated_regulation: boolean;
  record: string;
  wins: number;
  draws: number;
  losses: number;
  shootout_wins: number;
  goals_for: number;
  goals_against: number;
  top_scorer: { name: string; goals: number } | null;
  seed: string;
  narrative: string;
}

function summarize(matches: MatchBox[]): RunSummary {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let shootout_wins = 0;
  let goals_for = 0;
  let goals_against = 0;
  let undefeated_regulation = true;
  const scorerGoals = new Map<string, { name: string; goals: number }>();

  for (const m of matches) {
    const gf = m.reg[0] + (m.et ? m.et[0] : 0);
    const ga = m.reg[1] + (m.et ? m.et[1] : 0);
    goals_for += gf;
    goals_against += ga;
    if (m.outcome === "W") wins++;
    else if (m.outcome === "D") draws++;
    else losses++;
    if (m.shootout) {
      undefeated_regulation = false;
      if (m.outcome === "W") shootout_wins++;
    }
    for (const e of m.events) {
      if ((e.type === "goal" || e.type === "pen_scored") && e.side === "user") {
        const pid = e.type === "goal" ? e.scorer_player_id : e.taker_player_id;
        const prev = scorerGoals.get(pid) ?? { name: m.names[pid] ?? pid, goals: 0 };
        prev.goals += 1;
        scorerGoals.set(pid, prev);
      }
    }
  }

  const top = [...scorerGoals.values()].sort((a, b) => b.goals - a.goals)[0] ?? null;
  return {
    team_name: "Your XI",
    reached_round: "F",
    is_champion: true,
    undefeated_regulation,
    record: `${wins}-${losses}`,
    wins,
    draws,
    losses,
    shootout_wins,
    goals_for,
    goals_against,
    top_scorer: top,
    seed: "wcd-1970-legends-7c4a",
    narrative:
      "Seventeen spins of history, one impossible XI. Pelé led the line with a tournament for the ages, " +
      "Cruyff drifted in from the left to pull the strings, and a quarter-final shootout against England " +
      "was the only blemish on the march. In the final, a substitute named Maradona settled it — your " +
      "all-time XI lifts the trophy.",
  };
}

export const RUN_SUMMARY: RunSummary = summarize(RUN_MATCHES);

/** Period label for box-score timestamps. */
export function periodTag(period: Period | "shootout"): string {
  switch (period) {
    case "1H":
      return "";
    case "2H":
      return "";
    case "ET1":
    case "ET2":
      return " (ET)";
    case "shootout":
      return " (pens)";
  }
}
