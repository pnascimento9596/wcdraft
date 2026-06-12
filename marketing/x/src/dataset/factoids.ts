// Legend/era factoids derived from the SHIPPED dataset — factual stat lines
// only. Honest-state applies to marketing: a factoid claims only fields that
// are present (non-null) on the card; absent signals stay unspoken (never
// rendered as 0 or invented). No likenesses, no crest/kit imagery — text from
// our own committed data, surfaced through our brand assets only.

import { loadMarketingGameData, type MarketingGameData } from "../engine/game-data.ts";
import { pickIndex } from "../compose/rng.ts";

const POSITION_WORD: Record<string, string> = {
  GK: "goalkeeper",
  DF: "defender",
  MF: "midfielder",
  FW: "forward",
};

export interface Factoid {
  /** True, dataset-backed sentence. Never includes a feature claim or a link. */
  text: string;
  /** Card the factoid was derived from (audit / dedup). */
  card_id: string;
  nation_code: string | null;
  year: number;
}

interface CardFacts {
  card_id: string;
  name: string;
  nation_name: string;
  nation_code: string | null;
  year: number;
  position: string | null;
  legend: boolean;
  goals: number | null;
  appearances: number | null;
}

let legendCache: CardFacts[] | null = null;

function factsFor(gd: MarketingGameData, cardId: string): CardFacts | null {
  const c = gd.playerByCardId.get(cardId);
  if (!c) return null;
  const rating = gd.ratingByCardId.get(cardId);
  const nation = gd.nationById.get(c.nation_id);
  const name = c.common_name.trim().length > 0 ? c.common_name.trim() : c.full_name;
  return {
    card_id: cardId,
    name,
    nation_name: nation?.canonical_name ?? c.nation_id,
    nation_code: nation?.code ?? null,
    year: c.tournament_id,
    position: c.primary_position ? (POSITION_WORD[c.primary_position] ?? null) : null,
    legend: rating?.legend === true,
    goals: typeof c.goals === "number" ? c.goals : null,
    appearances: typeof c.appearances === "number" ? c.appearances : null,
  };
}

/** All legend-flagged cards, sorted by card_id for deterministic selection. */
export function legendCards(gd: MarketingGameData = loadMarketingGameData()): CardFacts[] {
  if (legendCache) return legendCache;
  const out: CardFacts[] = [];
  for (const r of gd.bundle.ratings) {
    if (r.legend === true) {
      const f = factsFor(gd, r.card_id);
      if (f) out.push(f);
    }
  }
  out.sort((a, b) => (a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0));
  legendCache = out;
  return out;
}

/** Test seam. */
export function clearFactoidCache(): void {
  legendCache = null;
}

function renderLegendFactoid(f: CardFacts): string {
  // Lead with the dataset-backed legend signal; add a true scoring/appearance
  // clause only when the field is present.
  const flag = f.nation_code ? ` (${f.nation_code})` : "";
  const base = `${f.name}${flag} — a wcdraft all-time legend from the ${f.year} World Cup squad`;
  if (f.goals !== null && f.goals > 0) {
    return `${base}, ${f.goals} goal${f.goals === 1 ? "" : "s"} that tournament.`;
  }
  if (f.position) {
    return `${base}: a ${f.position} you can draft into your all-time XI.`;
  }
  return `${base}.`;
}

function renderEraFactoid(f: CardFacts): string {
  const flag = f.nation_code ? ` (${f.nation_code})` : "";
  const role = f.position ?? "player";
  if (f.appearances !== null && f.appearances > 0) {
    return `${f.name}${flag}, ${f.year}: a ${role} with ${f.appearances} appearance${f.appearances === 1 ? "" : "s"} that World Cup — in the wcdraft pool.`;
  }
  return `${f.name}${flag}: the ${f.year} World Cup ${role}, draftable in wcdraft.`;
}

/** Deterministically pick a TRUE legend factoid from the dataset for a seed. */
export function pickLegendFactoid(
  seed: string,
  gd: MarketingGameData = loadMarketingGameData(),
): Factoid {
  const pool = legendCards(gd);
  if (pool.length === 0) throw new Error("no legend cards in dataset");
  const f = pool[pickIndex(seed, pool.length)]!;
  return {
    text: renderLegendFactoid(f),
    card_id: f.card_id,
    nation_code: f.nation_code,
    year: f.year,
  };
}

/** Deterministically pick a TRUE era/position factoid from the dataset for a seed. */
export function pickEraFactoid(
  seed: string,
  gd: MarketingGameData = loadMarketingGameData(),
): Factoid {
  const pool = legendCards(gd);
  if (pool.length === 0) throw new Error("no cards for era factoid");
  const f = pool[pickIndex(`era:${seed}`, pool.length)]!;
  return {
    text: renderEraFactoid(f),
    card_id: f.card_id,
    nation_code: f.nation_code,
    year: f.year,
  };
}

export interface DailySpin {
  nation_name: string;
  nation_code: string | null;
  year: number;
}

/**
 * Pick a REAL (nation, year) squad present in the pool for the daily-challenge
 * prompt. Drawn from legend cards so the named squad-year is recognisable and
 * guaranteed to exist in the dataset.
 */
export function pickDailySpin(
  seed: string,
  gd: MarketingGameData = loadMarketingGameData(),
): DailySpin {
  const pool = legendCards(gd);
  if (pool.length === 0) throw new Error("no cards for daily spin");
  const f = pool[pickIndex(`spin:${seed}`, pool.length)]!;
  return { nation_name: f.nation_name, nation_code: f.nation_code, year: f.year };
}
