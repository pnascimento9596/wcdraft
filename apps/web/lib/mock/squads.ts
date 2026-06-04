// ILLUSTRATIVE MOCK squad fixtures for the WS-D screen scaffold.
//
// Real historical national-team squads (1970–2010) give the screens authentic
// names, positions and clubs. The numeric RATINGS are OUR game's 0..100 design
// channels (a game mechanic, not a factual claim about a player); appearance /
// goal counts are plausible illustrative values for the demo. All cards are
// minted through `buildCardId` / `buildManagerCardId` so the fixtures obey the
// contract's branded-id rule. Replaced by real ETL output at WS-D-integration.
//
// tournament_id is the tournament YEAR (a positive integer) for legibility.

import { buildCardId, buildManagerCardId, type Award, type Position } from "@wcdraft/core";
import type { ManagerCard, PlayerCard, SquadFixture } from "./types";

const NATION_NAME: Record<string, string> = {
  bra: "Brazil",
  ned: "Netherlands",
  ita: "Italy",
  fra: "France",
  arg: "Argentina",
  esp: "Spain",
};

/** Look up a single authored card across all squads (used to seed locked picks). */
export function findCard(player_id: string, year: number): PlayerCard {
  for (const sq of SQUADS) {
    if (sq.year !== year) continue;
    const p = sq.players.find((pl) => pl.player_id === player_id);
    if (p) return p;
  }
  throw new Error(`mock findCard: no card for ${player_id}:${year}`);
}

// Compact row → PlayerCard. Tuple order kept tight so the data table reads like
// a squad sheet.
type PRow = [
  player_id: string,
  name: string,
  full_name: string,
  shirt: number | null,
  listed: Position | null,
  eligible: Position[],
  club: string | null,
  apps: number | null,
  goals: number | null,
  captain: boolean | null,
  rating: [overall: number | null, att: number, mid: number, def: number, gk: number, cov: number],
  awards?: Award[],
];

function buildSquad(
  year: number,
  nation_id: string,
  rows: PRow[],
  coachRow: [
    manager_id: string,
    name: string,
    matches: number | null,
    placement: number | null,
    rating: [overall: number | null, pedigree: number, experience: number],
  ] | null,
): SquadFixture {
  const nation_name = NATION_NAME[nation_id] ?? nation_id;
  const players: PlayerCard[] = rows.map((r) => {
    const [player_id, name, full_name, shirt, listed, eligible, club, apps, goals, captain, rt, awards] =
      r;
    const [overall, attack, midfield, defense, goalkeeping, coverage] = rt;
    return {
      card_id: buildCardId(player_id, year),
      player_id,
      tournament_id: year,
      year,
      name,
      full_name,
      nation_id,
      nation_name,
      shirt_number: shirt,
      position_listed: listed,
      eligible_positions: eligible,
      club_at_tournament: club,
      appearances: apps,
      goals,
      awards: awards ?? null,
      captain,
      rating: { overall, attack, midfield, defense, goalkeeping, coverage },
    };
  });

  let coach: ManagerCard | null = null;
  if (coachRow) {
    const [manager_id, name, matches, final_placement, [overall, pedigree, experience]] = coachRow;
    coach = {
      manager_card_id: buildManagerCardId(manager_id, year),
      manager_id,
      tournament_id: year,
      year,
      name,
      nation_id,
      nation_name,
      matches,
      final_placement,
      rating: { overall, pedigree, experience },
    };
  }

  return {
    tournament_id: year,
    year,
    nation_id,
    nation_name,
    label: `${nation_name} · ${year}`,
    players,
    coach,
  };
}

const tt = (d: string): Award => ({ award_type: "all_tournament_team", description: d });
const boot = (d: string): Award => ({ award_type: "golden_boot", description: d });
const ball = (d: string): Award => ({ award_type: "golden_ball", description: d });

// ─── BRAZIL 1970 — the rolled squad on the demo's current spin ───────────────
export const BRAZIL_1970 = buildSquad(
  1970,
  "bra",
  [
    ["bra-felix", "Félix", "Félix Miélli Venerando", 1, "GK", ["GK"], "Fluminense", 6, 0, false, [74, 12, 18, 30, 76, 0.7]],
    ["bra-carlos-alberto", "Carlos Alberto", "Carlos Alberto Torres", 4, "DF", ["DF"], "Santos", 6, 1, true, [88, 60, 72, 90, 12, 0.9], [tt("Team of the Tournament")]],
    ["bra-brito", "Brito", "Hércules Brito Ruas", 3, "DF", ["DF"], "Flamengo", 6, 0, false, [80, 30, 48, 84, 10, 0.8]],
    ["bra-piazza", "Piazza", "Wilson da Silva Piazza", 5, "DF", ["DF", "MF"], "Cruzeiro", 6, 0, false, [82, 40, 70, 83, 10, 0.8]],
    ["bra-everaldo", "Everaldo", "Everaldo Marques da Silva", 16, "DF", ["DF"], "Grêmio", 6, 0, false, [79, 42, 56, 80, 10, 0.75]],
    ["bra-clodoaldo", "Clodoaldo", "Clodoaldo Tavares de Santana", 5, "MF", ["MF"], "Santos", 6, 1, false, [84, 58, 85, 72, 10, 0.85]],
    ["bra-gerson", "Gérson", "Gérson de Oliveira Nunes", 8, "MF", ["MF"], "São Paulo", 5, 1, false, [89, 70, 92, 64, 10, 0.9], [tt("Team of the Tournament")]],
    ["bra-rivelino", "Rivelino", "Roberto Rivelino", 11, "MF", ["MF", "FW"], "Corinthians", 6, 3, false, [90, 86, 90, 55, 10, 0.92]],
    ["bra-jairzinho", "Jairzinho", "Jair Ventura Filho", 7, "FW", ["FW"], "Botafogo", 6, 7, false, [92, 92, 70, 40, 10, 0.95], [tt("Team of the Tournament")]],
    ["bra-pele", "Pelé", "Edson Arantes do Nascimento", 10, "FW", ["FW", "MF"], "Santos", 6, 4, false, [97, 96, 90, 45, 12, 0.98], [ball("Golden Ball"), tt("Team of the Tournament")]],
    ["bra-tostao", "Tostão", "Eduardo Gonçalves de Andrade", 9, "FW", ["FW"], "Cruzeiro", 6, 2, false, [88, 86, 72, 40, 10, 0.9]],
    ["bra-paulo-cezar", "Paulo Cézar", "Paulo Cézar Lima", 17, "MF", ["MF", "FW"], "Botafogo", 4, 0, false, [80, 74, 78, 48, 10, 0.7]],
    ["bra-roberto-miranda", "Roberto", "Roberto Lopes Miranda", 20, "FW", ["FW"], "Botafogo", 3, 2, false, [77, 79, 52, 32, 10, 0.6]],
    ["bra-marco-antonio", "Marco Antônio", "Marco Antônio Feliciano", 13, "DF", ["DF"], "Fluminense", 2, 0, false, [75, 38, 58, 76, 10, 0.6]],
    ["bra-fontana", "Fontana", "José Guilherme Baldocchi", 2, "DF", ["DF"], "Palmeiras", 1, 0, false, [74, 30, 46, 77, 10, 0.55]],
    ["bra-edu", "Edu", "Jonas Eduardo Américo", 21, "FW", ["FW", "MF"], "Santos", 1, 0, false, [78, 78, 66, 40, 10, 0.55]],
  ],
  ["bra-mgr-zagallo", "Mário Zagallo", 6, 1, [90, 94, 78]],
);

// ─── Other squads — provide variety for the already-drafted XI + bench. ──────
export const NETHERLANDS_1974 = buildSquad(
  1974,
  "ned",
  [
    ["ned-jongbloed", "Jongbloed", "Jan Jongbloed", 8, "GK", ["GK"], "FC Amsterdam", 7, 0, false, [78, 14, 30, 28, 80, 0.8]],
    ["ned-suurbier", "Suurbier", "Wim Suurbier", 20, "DF", ["DF"], "Ajax", 7, 0, false, [82, 52, 64, 82, 10, 0.82]],
    ["ned-haan", "Haan", "Arie Haan", 13, "MF", ["MF", "DF"], "Ajax", 7, 2, false, [85, 66, 86, 76, 10, 0.85]],
    ["ned-rijsbergen", "Rijsbergen", "Wim Rijsbergen", 17, "DF", ["DF"], "Feyenoord", 6, 0, false, [80, 36, 58, 82, 10, 0.78]],
    ["ned-krol", "Krol", "Ruud Krol", 12, "DF", ["DF"], "Ajax", 7, 0, false, [86, 56, 70, 86, 10, 0.88], [tt("Team of the Tournament")]],
    ["ned-jansen", "Jansen", "Wim Jansen", 16, "MF", ["MF"], "Feyenoord", 7, 0, false, [83, 58, 84, 74, 10, 0.83]],
    ["ned-neeskens", "Neeskens", "Johan Neeskens", 13, "MF", ["MF"], "Ajax", 7, 5, false, [90, 82, 90, 70, 10, 0.92], [tt("Team of the Tournament")]],
    ["ned-vanhanegem", "Van Hanegem", "Wim van Hanegem", 8, "MF", ["MF"], "Feyenoord", 7, 1, false, [88, 74, 90, 60, 10, 0.9], [tt("Team of the Tournament")]],
    ["ned-rep", "Rep", "Johnny Rep", 16, "FW", ["FW"], "Ajax", 7, 4, false, [86, 86, 66, 38, 10, 0.86]],
    ["ned-cruyff", "Cruyff", "Johan Cruyff", 14, "FW", ["FW", "MF"], "Barcelona", 7, 3, true, [96, 95, 92, 48, 12, 0.97], [ball("Golden Ball"), tt("Team of the Tournament")]],
    ["ned-rensenbrink", "Rensenbrink", "Rob Rensenbrink", 12, "FW", ["FW"], "Anderlecht", 6, 2, false, [85, 85, 70, 36, 10, 0.84]],
    ["ned-vandekerkhof", "R. van de Kerkhof", "René van de Kerkhof", 18, "MF", ["MF", "FW"], "PSV", 5, 0, false, [80, 74, 76, 50, 10, 0.7]],
  ],
  ["ned-mgr-michels", "Rinus Michels", 7, 2, [92, 90, 82]],
);

export const ITALY_1982 = buildSquad(
  1982,
  "ita",
  [
    ["ita-zoff", "Zoff", "Dino Zoff", 1, "GK", ["GK"], "Juventus", 7, 0, true, [90, 12, 26, 34, 92, 0.95], [tt("Team of the Tournament")]],
    ["ita-gentile", "Gentile", "Claudio Gentile", 6, "DF", ["DF"], "Juventus", 6, 0, false, [86, 36, 56, 90, 10, 0.88]],
    ["ita-cabrini", "Cabrini", "Antonio Cabrini", 3, "DF", ["DF"], "Juventus", 7, 1, false, [85, 56, 68, 84, 10, 0.86], [tt("Team of the Tournament")]],
    ["ita-collovati", "Collovati", "Fulvio Collovati", 5, "DF", ["DF"], "Milan", 6, 0, false, [80, 30, 52, 82, 10, 0.78]],
    ["ita-scirea", "Scirea", "Gaetano Scirea", 4, "DF", ["DF", "MF"], "Juventus", 7, 0, false, [88, 52, 76, 88, 10, 0.9]],
    ["ita-bergomi", "Bergomi", "Giuseppe Bergomi", 19, "DF", ["DF"], "Inter", 4, 0, false, [82, 40, 60, 84, 10, 0.7]],
    ["ita-tardelli", "Tardelli", "Marco Tardelli", 14, "MF", ["MF"], "Juventus", 7, 2, false, [87, 76, 86, 74, 10, 0.88]],
    ["ita-oriali", "Oriali", "Gabriele Oriali", 13, "MF", ["MF"], "Inter", 7, 0, false, [82, 58, 82, 72, 10, 0.8]],
    ["ita-conti", "Conti", "Bruno Conti", 16, "MF", ["MF", "FW"], "Roma", 7, 0, false, [86, 80, 86, 56, 10, 0.86], [tt("Team of the Tournament")]],
    ["ita-rossi", "Rossi", "Paolo Rossi", 20, "FW", ["FW"], "Juventus", 7, 6, false, [91, 92, 64, 36, 10, 0.93], [ball("Golden Ball"), boot("Golden Boot"), tt("Team of the Tournament")]],
    ["ita-graziani", "Graziani", "Francesco Graziani", 19, "FW", ["FW"], "Fiorentina", 6, 0, false, [82, 82, 58, 38, 10, 0.78]],
    ["ita-altobelli", "Altobelli", "Alessandro Altobelli", 18, "FW", ["FW"], "Inter", 5, 1, false, [83, 84, 60, 36, 10, 0.76]],
  ],
  ["ita-mgr-bearzot", "Enzo Bearzot", 7, 1, [88, 90, 84]],
);

export const FRANCE_1998 = buildSquad(
  1998,
  "fra",
  [
    ["fra-barthez", "Barthez", "Fabien Barthez", 16, "GK", ["GK"], "Monaco", 7, 0, false, [87, 14, 28, 34, 88, 0.92]],
    ["fra-thuram", "Thuram", "Lilian Thuram", 15, "DF", ["DF"], "Parma", 7, 2, false, [88, 52, 68, 88, 10, 0.9], [tt("Team of the Tournament")]],
    ["fra-blanc", "Blanc", "Laurent Blanc", 5, "DF", ["DF"], "Marseille", 6, 1, false, [86, 50, 72, 86, 10, 0.88]],
    ["fra-desailly", "Desailly", "Marcel Desailly", 8, "DF", ["DF", "MF"], "Chelsea", 6, 0, false, [87, 48, 72, 88, 10, 0.89]],
    ["fra-lizarazu", "Lizarazu", "Bixente Lizarazu", 3, "DF", ["DF"], "Bayern", 7, 0, false, [84, 58, 70, 82, 10, 0.85]],
    ["fra-deschamps", "Deschamps", "Didier Deschamps", 7, "MF", ["MF"], "Juventus", 7, 0, true, [85, 50, 84, 76, 10, 0.86]],
    ["fra-petit", "Petit", "Emmanuel Petit", 17, "MF", ["MF"], "Arsenal", 6, 1, false, [85, 64, 84, 74, 10, 0.85]],
    ["fra-zidane", "Zidane", "Zinédine Zidane", 10, "MF", ["MF", "FW"], "Juventus", 6, 2, false, [95, 86, 96, 56, 10, 0.96], [tt("Team of the Tournament")]],
    ["fra-karembeu", "Karembeu", "Christian Karembeu", 14, "MF", ["MF", "DF"], "Real Madrid", 5, 0, false, [81, 56, 78, 74, 10, 0.74]],
    ["fra-djorkaeff", "Djorkaeff", "Youri Djorkaeff", 6, "FW", ["FW", "MF"], "Inter", 6, 1, false, [86, 84, 84, 50, 10, 0.86]],
    ["fra-guivarch", "Guivarc'h", "Stéphane Guivarc'h", 9, "FW", ["FW"], "Auxerre", 4, 0, false, [76, 76, 52, 34, 10, 0.66]],
    ["fra-henry", "Henry", "Thierry Henry", 12, "FW", ["FW"], "Monaco", 6, 3, false, [88, 88, 70, 38, 10, 0.84]],
    ["fra-trezeguet", "Trezeguet", "David Trezeguet", 20, "FW", ["FW"], "Monaco", 5, 1, false, [83, 85, 58, 34, 10, 0.7]],
  ],
  ["fra-mgr-jacquet", "Aimé Jacquet", 7, 1, [86, 88, 80]],
);

export const ARGENTINA_1986 = buildSquad(
  1986,
  "arg",
  [
    ["arg-pumpido", "Pumpido", "Nery Pumpido", 18, "GK", ["GK"], "River Plate", 7, 0, false, [82, 12, 26, 32, 84, 0.85]],
    ["arg-cuciuffo", "Cuciuffo", "José Luis Cuciuffo", 13, "DF", ["DF"], "Vélez", 6, 0, false, [80, 38, 56, 82, 10, 0.76]],
    ["arg-ruggeri", "Ruggeri", "Oscar Ruggeri", 19, "DF", ["DF"], "River Plate", 7, 0, false, [85, 42, 60, 86, 10, 0.86]],
    ["arg-brown", "Brown", "José Luis Brown", 6, "DF", ["DF"], "Deportivo Español", 7, 1, false, [82, 44, 58, 84, 10, 0.8]],
    ["arg-olarticoechea", "Olarticoechea", "Julio Olarticoechea", 9, "DF", ["DF", "MF"], "Boca Juniors", 5, 0, false, [80, 54, 70, 78, 10, 0.74]],
    ["arg-giusti", "Giusti", "Ricardo Giusti", 14, "MF", ["MF"], "Independiente", 7, 0, false, [82, 56, 82, 74, 10, 0.82]],
    ["arg-batista", "Batista", "Sergio Batista", 12, "MF", ["MF"], "Argentinos Jrs", 7, 0, false, [82, 54, 82, 72, 10, 0.8]],
    ["arg-burruchaga", "Burruchaga", "Jorge Burruchaga", 7, "MF", ["MF", "FW"], "Nantes", 7, 2, false, [86, 80, 86, 56, 10, 0.86]],
    ["arg-maradona", "Maradona", "Diego Armando Maradona", 10, "FW", ["FW", "MF"], "Napoli", 7, 5, true, [98, 97, 96, 50, 12, 0.99], [ball("Golden Ball"), tt("Team of the Tournament")]],
    ["arg-valdano", "Valdano", "Jorge Valdano", 11, "FW", ["FW"], "Real Madrid", 7, 4, false, [86, 86, 66, 40, 10, 0.86]],
    ["arg-enrique", "Enrique", "Héctor Enrique", 15, "MF", ["MF"], "River Plate", 5, 0, false, [80, 62, 80, 64, 10, 0.72]],
    ["arg-tapia", "Tapia", "Carlos Tapia", 20, "MF", ["MF", "FW"], "Boca Juniors", 3, 0, false, [78, 70, 76, 52, 10, 0.6]],
  ],
  ["arg-mgr-bilardo", "Carlos Bilardo", 7, 1, [85, 88, 78]],
);

export const SPAIN_2010 = buildSquad(
  2010,
  "esp",
  [
    ["esp-casillas", "Casillas", "Iker Casillas", 1, "GK", ["GK"], "Real Madrid", 7, 0, true, [92, 14, 30, 36, 93, 0.96], [tt("Team of the Tournament")]],
    ["esp-ramos", "Ramos", "Sergio Ramos", 15, "DF", ["DF"], "Real Madrid", 7, 0, false, [88, 56, 70, 88, 10, 0.9]],
    ["esp-pique", "Piqué", "Gerard Piqué", 3, "DF", ["DF"], "Barcelona", 7, 0, false, [88, 50, 72, 89, 10, 0.9]],
    ["esp-puyol", "Puyol", "Carles Puyol", 5, "DF", ["DF"], "Barcelona", 7, 1, false, [87, 48, 66, 89, 10, 0.88]],
    ["esp-capdevila", "Capdevila", "Joan Capdevila", 11, "DF", ["DF"], "Villarreal", 7, 0, false, [82, 56, 68, 82, 10, 0.82]],
    ["esp-busquets", "Busquets", "Sergio Busquets", 16, "MF", ["MF"], "Barcelona", 7, 0, false, [88, 56, 90, 78, 10, 0.88]],
    ["esp-alonso", "Alonso", "Xabi Alonso", 14, "MF", ["MF"], "Real Madrid", 7, 0, false, [89, 66, 92, 72, 10, 0.9]],
    ["esp-xavi", "Xavi", "Xavi Hernández", 8, "MF", ["MF"], "Barcelona", 7, 0, false, [93, 70, 96, 60, 10, 0.95], [tt("Team of the Tournament")]],
    ["esp-iniesta", "Iniesta", "Andrés Iniesta", 6, "MF", ["MF", "FW"], "Barcelona", 7, 2, false, [94, 84, 95, 58, 10, 0.95], [tt("Team of the Tournament")]],
    ["esp-villa", "Villa", "David Villa", 7, "FW", ["FW"], "Barcelona", 7, 5, false, [90, 91, 72, 40, 10, 0.92], [tt("Team of the Tournament")]],
    ["esp-pedro", "Pedro", "Pedro Rodríguez", 18, "FW", ["FW", "MF"], "Barcelona", 6, 0, false, [83, 82, 76, 44, 10, 0.78]],
    ["esp-torres", "Torres", "Fernando Torres", 9, "FW", ["FW"], "Liverpool", 6, 0, false, [85, 86, 64, 36, 10, 0.8]],
    ["esp-fabregas", "Fàbregas", "Cesc Fàbregas", 10, "MF", ["MF"], "Arsenal", 6, 0, false, [87, 74, 90, 58, 10, 0.82]],
  ],
  ["esp-mgr-delbosque", "Vicente del Bosque", 7, 1, [89, 90, 86]],
);

export const BRAZIL_2002 = buildSquad(
  2002,
  "bra",
  [
    ["bra02-marcos", "Marcos", "Marcos Roberto Silveira", 1, "GK", ["GK"], "Palmeiras", 7, 0, false, [86, 14, 28, 34, 87, 0.9]],
    ["bra02-cafu", "Cafu", "Marcos Evangelista de Morais", 2, "DF", ["DF"], "Roma", 7, 0, true, [88, 64, 74, 84, 10, 0.9], [tt("Team of the Tournament")]],
    ["bra02-lucio", "Lúcio", "Lúcio", 3, "DF", ["DF"], "Bayer Leverkusen", 7, 1, false, [86, 52, 68, 88, 10, 0.88]],
    ["bra02-roque-junior", "Roque Júnior", "Roque Júnior", 4, "DF", ["DF"], "Milan", 7, 0, false, [82, 40, 56, 84, 10, 0.8]],
    ["bra02-roberto-carlos", "Roberto Carlos", "Roberto Carlos da Silva", 6, "DF", ["DF"], "Real Madrid", 7, 0, false, [89, 70, 76, 84, 10, 0.92], [tt("Team of the Tournament")]],
    ["bra02-edmilson", "Edmílson", "Edmílson", 5, "MF", ["MF", "DF"], "Lyon", 4, 0, false, [82, 52, 80, 80, 10, 0.74]],
    ["bra02-gilberto-silva", "Gilberto Silva", "Gilberto Aparecido da Silva", 8, "MF", ["MF"], "Atlético Mineiro", 7, 0, false, [84, 56, 84, 76, 10, 0.84]],
    ["bra02-kleberson", "Kléberson", "José Kléberson Pereira", 18, "MF", ["MF"], "Atlético Paranaense", 6, 0, false, [82, 66, 82, 64, 10, 0.78]],
    ["bra02-ronaldinho", "Ronaldinho", "Ronaldo de Assis Moreira", 11, "MF", ["MF", "FW"], "Paris Saint-Germain", 7, 2, false, [92, 88, 92, 50, 10, 0.92]],
    ["bra02-rivaldo", "Rivaldo", "Rivaldo Vítor Borba Ferreira", 10, "FW", ["FW", "MF"], "Barcelona", 7, 5, false, [91, 90, 88, 48, 10, 0.92], [tt("Team of the Tournament")]],
    ["bra02-ronaldo", "Ronaldo", "Ronaldo Luís Nazário de Lima", 9, "FW", ["FW"], "Inter", 7, 8, false, [95, 96, 76, 40, 10, 0.96], [ball("Golden Ball"), boot("Golden Boot"), tt("Team of the Tournament")]],
    ["bra02-denilson", "Denílson", "Denílson de Oliveira", 19, "FW", ["FW", "MF"], "Real Betis", 6, 0, false, [82, 82, 78, 44, 10, 0.74]],
  ],
  ["bra02-mgr-scolari", "Luiz Felipe Scolari", 7, 1, [88, 90, 80]],
);

/** All authored squads. */
export const SQUADS: SquadFixture[] = [
  BRAZIL_1970,
  NETHERLANDS_1974,
  ITALY_1982,
  FRANCE_1998,
  ARGENTINA_1986,
  SPAIN_2010,
  BRAZIL_2002,
];
