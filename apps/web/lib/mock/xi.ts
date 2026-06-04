// ILLUSTRATIVE MOCK completed draft — the "Your XI" the review / results / share
// screens render. A real draft yields 16 players + 1 manager, each from a UNIQUE
// (nation, year) spin; this fixture honours that uniqueness invariant (no two
// cards share a tournament-nation pair). Built on the 4-3-3 the draft locked.
//
// As with the rest of lib/mock: real names, OUR game's 0..100 ratings, plausible
// illustrative counts. No engine calls.

import {
  FORMATION_TEMPLATES,
  buildCardId,
  buildManagerCardId,
  slotPositionLine,
  type FormationTemplate,
  type Position,
} from "@wcdraft/core";
import type { ManagerCard, PitchSlot, PlayerCard } from "./types";

export const XI_FORMATION: FormationTemplate = FORMATION_TEMPLATES["4-3-3"]!;

const NATION_NAME: Record<string, string> = {
  bra: "Brazil",
  ita: "Italy",
  deu: "Germany",
  fra: "France",
  esp: "Spain",
  ned: "Netherlands",
  arg: "Argentina",
  eng: "England",
  urs: "Soviet Union",
};

interface Pick {
  slot_id: string;
  player_id: string;
  year: number;
  nation_id: string;
  name: string;
  full_name: string;
  shirt: number | null;
  listed: Position;
  eligible: Position[];
  club: string | null;
  apps: number | null;
  goals: number | null;
  rating: [number, number, number, number, number];
}

function card(p: Pick): PlayerCard {
  const [overall, attack, midfield, defense, goalkeeping] = p.rating;
  return {
    card_id: buildCardId(p.player_id, p.year),
    player_id: p.player_id,
    tournament_id: p.year,
    year: p.year,
    name: p.name,
    full_name: p.full_name,
    nation_id: p.nation_id,
    nation_name: NATION_NAME[p.nation_id] ?? p.nation_id,
    shirt_number: p.shirt,
    position_listed: p.listed,
    eligible_positions: p.eligible,
    club_at_tournament: p.club,
    appearances: p.apps,
    goals: p.goals,
    awards: null,
    captain: false,
    rating: { overall, attack, midfield, defense, goalkeeping, coverage: 0.95 },
  };
}

// Per-slot compatibility is "ideal" by construction here (best-fit picks), so we
// set position_compatibility = 1 and no warnings; the live draft screen computes
// these dynamically via lib/mock/draft.placeCard.
function fill(slot_id: string, slot_position: PitchSlot["slot_position"], channel: "L" | "C" | "R", c: PlayerCard): PitchSlot {
  return {
    slot_id,
    is_starter: true,
    slot_position,
    line: slotPositionLine(slot_position),
    channel,
    card: c,
    position_compatibility: 1,
    warnings: [],
  };
}

const STARTER_PICKS: Pick[] = [
  { slot_id: "4-3-3.GK", player_id: "urs-yashin", year: 1966, nation_id: "urs", name: "Yashin", full_name: "Lev Yashin", shirt: 1, listed: "GK", eligible: ["GK"], club: "Dynamo Moscow", apps: 4, goals: 0, rating: [94, 14, 30, 36, 95] },
  { slot_id: "4-3-3.LB", player_id: "bra-roberto-carlos", year: 2002, nation_id: "bra", name: "Roberto Carlos", full_name: "Roberto Carlos da Silva", shirt: 6, listed: "DF", eligible: ["DF"], club: "Real Madrid", apps: 7, goals: 0, rating: [89, 70, 76, 84, 10] },
  { slot_id: "4-3-3.LCB", player_id: "ita-baresi", year: 1994, nation_id: "ita", name: "Baresi", full_name: "Franco Baresi", shirt: 6, listed: "DF", eligible: ["DF"], club: "Milan", apps: 5, goals: 0, rating: [90, 46, 70, 92, 10] },
  { slot_id: "4-3-3.RCB", player_id: "deu-beckenbauer", year: 1974, nation_id: "deu", name: "Beckenbauer", full_name: "Franz Beckenbauer", shirt: 5, listed: "DF", eligible: ["DF", "MF"], club: "Bayern", apps: 7, goals: 0, rating: [95, 60, 84, 92, 10] },
  { slot_id: "4-3-3.RB", player_id: "bra-cafu", year: 1994, nation_id: "bra", name: "Cafu", full_name: "Marcos Evangelista de Morais", shirt: 14, listed: "DF", eligible: ["DF"], club: "São Paulo", apps: 6, goals: 0, rating: [86, 64, 72, 82, 10] },
  { slot_id: "4-3-3.CDM", player_id: "deu-matthaus", year: 1990, nation_id: "deu", name: "Matthäus", full_name: "Lothar Matthäus", shirt: 10, listed: "MF", eligible: ["MF"], club: "Inter", apps: 7, goals: 4, rating: [93, 80, 92, 78, 10] },
  { slot_id: "4-3-3.LCM", player_id: "fra-zidane", year: 2006, nation_id: "fra", name: "Zidane", full_name: "Zinédine Zidane", shirt: 10, listed: "MF", eligible: ["MF", "FW"], club: "Real Madrid", apps: 7, goals: 3, rating: [95, 86, 96, 56, 10] },
  { slot_id: "4-3-3.RCM", player_id: "esp-xavi", year: 2010, nation_id: "esp", name: "Xavi", full_name: "Xavi Hernández", shirt: 8, listed: "MF", eligible: ["MF"], club: "Barcelona", apps: 7, goals: 0, rating: [93, 70, 96, 60, 10] },
  { slot_id: "4-3-3.LW", player_id: "ned-cruyff", year: 1974, nation_id: "ned", name: "Cruyff", full_name: "Johan Cruyff", shirt: 14, listed: "FW", eligible: ["FW", "MF"], club: "Barcelona", apps: 7, goals: 3, rating: [96, 95, 92, 48, 12] },
  { slot_id: "4-3-3.ST", player_id: "bra-pele", year: 1970, nation_id: "bra", name: "Pelé", full_name: "Edson Arantes do Nascimento", shirt: 10, listed: "FW", eligible: ["FW", "MF"], club: "Santos", apps: 6, goals: 4, rating: [97, 96, 90, 45, 12] },
  { slot_id: "4-3-3.RW", player_id: "bra-garrincha", year: 1962, nation_id: "bra", name: "Garrincha", full_name: "Manuel Francisco dos Santos", shirt: 7, listed: "FW", eligible: ["FW"], club: "Botafogo", apps: 6, goals: 4, rating: [94, 94, 80, 42, 10] },
];

const BENCH_PICKS: ReadonlyArray<[slot_id: string, slot_position: PitchSlot["slot_position"], pick: Pick]> = [
  ["bench.0", "GK", { slot_id: "bench.0", player_id: "eng-banks", year: 1966, nation_id: "eng", name: "Banks", full_name: "Gordon Banks", shirt: 1, listed: "GK", eligible: ["GK"], club: "Leicester City", apps: 6, goals: 0, rating: [90, 14, 28, 34, 91] }],
  ["bench.1", "CB", { slot_id: "bench.1", player_id: "ita-maldini", year: 2002, nation_id: "ita", name: "Maldini", full_name: "Paolo Maldini", shirt: 3, listed: "DF", eligible: ["DF"], club: "Milan", apps: 4, goals: 0, rating: [92, 56, 74, 90, 10] }],
  ["bench.2", "CM", { slot_id: "bench.2", player_id: "fra-platini", year: 1984, nation_id: "fra", name: "Platini", full_name: "Michel Platini", shirt: 10, listed: "MF", eligible: ["MF", "FW"], club: "Juventus", apps: 5, goals: 9, rating: [93, 88, 92, 50, 10] }],
  ["bench.3", "ST", { slot_id: "bench.3", player_id: "deu-muller", year: 1970, nation_id: "deu", name: "Müller", full_name: "Gerd Müller", shirt: 13, listed: "FW", eligible: ["FW"], club: "Bayern", apps: 6, goals: 10, rating: [93, 95, 64, 36, 10] }],
  ["bench.4", "ST", { slot_id: "bench.4", player_id: "arg-maradona", year: 1986, nation_id: "arg", name: "Maradona", full_name: "Diego Armando Maradona", shirt: 10, listed: "FW", eligible: ["FW", "MF"], club: "Napoli", apps: 7, goals: 5, rating: [98, 97, 96, 50, 12] }],
];

/** The completed XI as pitch slots, in template order. */
export const XI_STARTERS: PitchSlot[] = XI_FORMATION.slots.map((s) => {
  const pick = STARTER_PICKS.find((p) => p.slot_id === s.slot_id)!;
  return fill(s.slot_id, s.slot_position, s.channel, card(pick));
});

export const XI_BENCH: PitchSlot[] = BENCH_PICKS.map(([slot_id, slot_position, pick]) => ({
  slot_id,
  is_starter: false,
  slot_position,
  line: slotPositionLine(slot_position),
  channel: "C" as const,
  card: card(pick),
  position_compatibility: 1,
  warnings: [],
}));

export const XI_MANAGER: ManagerCard = {
  manager_card_id: buildManagerCardId("bra-mgr-zagallo", 1970),
  manager_id: "bra-mgr-zagallo",
  tournament_id: 1970,
  year: 1970,
  name: "Mário Zagallo",
  nation_id: "bra",
  nation_name: "Brazil",
  matches: 6,
  final_placement: 1,
  rating: { overall: 90, pedigree: 94, experience: 78 },
};

/** Default user team name. */
export const DEFAULT_TEAM_NAME = "Your XI";
