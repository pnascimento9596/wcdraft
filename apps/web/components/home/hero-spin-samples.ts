import { flagSrcForNationId } from "@/lib/game/flags";

export interface HeroSpinSample {
  readonly id: string;
  readonly nationId: string;
  readonly nationName: string;
  readonly nationCode: string;
  readonly tournamentId: number;
  readonly year: number;
  readonly drawProbability: number;
  readonly card: {
    readonly cardId: string;
    readonly playerId: string;
    readonly name: string;
    readonly fullName: string;
    readonly position: "GK" | "DF" | "MF" | "FW";
    readonly shirtNumber: number | null;
    readonly club: string | null;
    readonly overall: number;
  };
}

// Tiny curated sample from the generated runtime draft pool. The displayed overall
// mirrors the top-level runtime rating used by draft cards, not manual override rows.
// Keep this list hand-curated so the homepage never imports the full runtime pool.
export const HERO_SPIN_SAMPLES: readonly HeroSpinSample[] = [
  {
    id: "croatia-2018-modric",
    nationId: "T-18",
    nationName: "Croatia",
    nationCode: "HRV",
    tournamentId: 2018,
    year: 2018,
    drawProbability: 0.021,
    card: {
      cardId: "P-29491:2018",
      playerId: "P-29491",
      name: "Modrić",
      fullName: "Luka Modrić",
      position: "MF",
      shirtNumber: 10,
      club: "Real Madrid",
      overall: 97,
    },
  },
  {
    id: "italy-2006-buffon",
    nationId: "T-41",
    nationName: "Italy",
    nationCode: "ITA",
    tournamentId: 2006,
    year: 2006,
    drawProbability: 0.024,
    card: {
      cardId: "P-11392:2006",
      playerId: "P-11392",
      name: "Buffon",
      fullName: "Gianluigi Buffon",
      position: "GK",
      shirtNumber: 1,
      club: "Juventus",
      overall: 91,
    },
  },
  {
    id: "japan-2022-maeda",
    nationId: "T-44",
    nationName: "Japan",
    nationCode: "JPN",
    tournamentId: 2022,
    year: 2022,
    drawProbability: 0.026,
    card: {
      cardId: "P-30206:2022",
      playerId: "P-30206",
      name: "Maeda",
      fullName: "Daizen Maeda",
      position: "FW",
      shirtNumber: 25,
      club: "Celtic",
      overall: 72,
    },
  },
  {
    id: "brazil-1970-alberto",
    nationId: "T-09",
    nationName: "Brazil",
    nationCode: "BRA",
    tournamentId: 1970,
    year: 1970,
    drawProbability: 0.007,
    card: {
      cardId: "P-25829:1970",
      playerId: "P-25829",
      name: "Alberto",
      fullName: "Carlos Alberto",
      position: "DF",
      shirtNumber: 4,
      club: "Santos",
      overall: 90,
    },
  },
];

export function flagSrcForSample(sample: HeroSpinSample): string | null {
  return flagSrcForNationId(sample.nationId);
}
