#!/usr/bin/env node
/**
 * Evidence-only companion to analyze-choose3-clustering.mts.
 * Measures (1) offer-construction spread extraction vs remaining squad pool
 * and (2) pool-level exclusion of estimate cards (not post-hoc offer filtering).
 * Calls production createDraft/stepDraft; does not reimplement tier selection.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import {
  activeSpin,
  buildDraftCatalog,
  createDraft,
  isDraftComplete,
  stepDraft,
  type DraftCatalog,
  type DraftDataset,
  type DraftFlow,
  type EraPresetId,
  type RatingBasis,
} from "../../core/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUNDLE = path.join(ROOT, "packages/data/src/generated/draft-pool.compact.json.br");
const MANIFEST = path.join(ROOT, "packages/data/src/generated/manifest.json");
const BACKUP_BUNDLE = "/tmp/c2b-backup/draft-pool.compact.json.br";
const N = 1024;
const ESTIMATE = new Set(["career_stature_estimate", "baseline_anchor_estimate"]);
const THRESHOLDS = [0, 1, 2, 3] as const;

interface BasisRating {
  overall: number | null;
  overall_basis: string;
}

interface Rating {
  card_id: string;
  overall: number | null;
  overall_basis: string;
  basis_ratings: { current: BasisRating };
}

interface PlayerCard {
  card_id: string;
  player_id: string;
  tournament_id: number;
  nation_id: string;
  eligible_positions: string[];
}

interface ManagerCard {
  manager_id: string;
  tournament_id: number;
  nation_id: string;
}

interface TournamentMeta {
  year: number;
}

interface Bundle {
  player_cards: PlayerCard[];
  manager_cards: ManagerCard[];
  ratings: Rating[];
  tournaments: Record<string, TournamentMeta>;
}

interface Manifest {
  dataset_version: string;
  rating_version_historical: string;
  rating_version_projected: string;
  engine_version: string;
}

interface ChoiceOverall {
  career: number | null;
  current: number | null;
}

function readBundleBytes(): Buffer {
  try {
    return readFileSync(BACKUP_BUNDLE);
  } catch {
    return readFileSync(BUNDLE);
  }
}

function readBundle(): { bundle: Bundle; compressed_sha256: string; decoded_bytes: number } {
  const bytes = readBundleBytes();
  const raw = brotliDecompressSync(bytes);
  return {
    bundle: JSON.parse(raw.toString("utf8")) as Bundle,
    compressed_sha256: createHash("sha256").update(bytes).digest("hex"),
    decoded_bytes: raw.length,
  };
}

function buildDataset(bundle: Bundle, excludeCardIds?: ReadonlySet<string>): DraftDataset {
  const ratingByCardId = new Map(bundle.ratings.map((r) => [r.card_id, r]));
  return {
    players: bundle.player_cards
      .filter((c) => !excludeCardIds?.has(c.card_id))
      .map((c) => ({
        player_id: c.player_id,
        tournament_id: c.tournament_id,
        nation_id: c.nation_id,
        eligible_positions:
          c.eligible_positions as DraftDataset["players"][number]["eligible_positions"],
        choice_overall: {
          career: ratingByCardId.get(c.card_id)?.overall ?? null,
          current: ratingByCardId.get(c.card_id)?.basis_ratings.current.overall ?? null,
        },
      })),
    managers: bundle.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    tournaments: Object.entries(bundle.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

function selectedOverall(r: Rating, basis: RatingBasis): number | null {
  return basis === "current" ? r.basis_ratings.current.overall : r.overall;
}

function selectedBasisName(r: Rating, basis: RatingBasis): string {
  return basis === "current" ? r.basis_ratings.current.overall_basis : r.overall_basis;
}

function pairwiseWithin(values: readonly number[], thr: number): boolean {
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (Math.abs(values[i]! - values[j]!) <= thr) return true;
    }
  }
  return false;
}

function choiceOverallForBasis(
  choice: ChoiceOverall | number | null | undefined,
  basis: RatingBasis,
): number | null {
  if (choice == null) return null;
  if (typeof choice === "number") return choice;
  return basis === "current" ? choice.current : choice.career;
}

function runCell(
  catalog: DraftCatalog,
  ratingById: ReadonlyMap<string, Rating>,
  cardMeta: ReadonlyMap<string, PlayerCard>,
  cardIdOf: (playerId: string, tournamentId: number) => string,
  manifest: Manifest,
  era: EraPresetId,
  basis: RatingBasis,
  flow: DraftFlow,
  label: string,
) {
  const thrHits = Object.fromEntries(THRESHOLDS.map((t) => [String(t), 0])) as Record<
    string,
    number
  >;
  const thrWithEst = Object.fromEntries(THRESHOLDS.map((t) => [String(t), 0])) as Record<
    string,
    number
  >;
  const thrTied = Object.fromEntries(THRESHOLDS.map((t) => [String(t), 0])) as Record<
    string,
    number
  >;
  let offers = 0;
  let sumObs = 0;
  let sumPool = 0;
  let sumRatio = 0;
  let ratioN = 0;
  let leave2 = 0;
  let near = 0;
  let tight = 0;
  const obsHist: Record<string, number> = {};
  let seed = 0;
  let done = 0;

  while (done < N) {
    const parentSeed = `wcdraft:choose3-clustering:v1:${seed.toString().padStart(6, "0")}`;
    try {
      let state = createDraft(catalog, {
        run_id: `c1-attr-${label}-${done}`,
        parent_seed: parentSeed,
        formation_id: "4-3-3",
        mode: "classic",
        team_name: "Measurement XI",
        dataset_version: manifest.dataset_version,
        rating_version: `${manifest.rating_version_historical}+${manifest.rating_version_projected}`,
        engine_version: manifest.engine_version,
        draft_flow: flow,
        rating_basis: basis,
        era_preset: era,
      });
      while (!isDraftComplete(state)) {
        if (flow !== "squad_first") throw new Error("only squad_first supported");
        const spin = activeSpin(state);
        if (spin && spin.rolled_card_ids.length === 3) {
          const ids = [...spin.rolled_card_ids];
          const ovs = ids.map((id) => selectedOverall(ratingById.get(id)!, basis)!);
          const prov = ids.map((id) => selectedBasisName(ratingById.get(id)!, basis));
          const hasEst = prov.some((p) => ESTIMATE.has(p));
          offers += 1;
          const obsSpread = Math.max(...ovs) - Math.min(...ovs);
          sumObs += obsSpread;
          obsHist[String(obsSpread)] = (obsHist[String(obsSpread)] ?? 0) + 1;
          for (const t of THRESHOLDS) {
            if (pairwiseWithin(ovs, t)) {
              thrHits[String(t)]! += 1;
              thrTied[String(t)]! += 1;
              if (hasEst) thrWithEst[String(t)]! += 1;
            }
          }
          const meta = cardMeta.get(ids[0]!)!;
          const entry = catalog.pairs.find(
            (p) => p.tournament_id === meta.tournament_id && p.nation_id === meta.nation_id,
          );
          if (entry) {
            const drafted = new Set(
              state.squad.map((s) => s.card_id).filter((x): x is string => x != null),
            );
            const poolVals: number[] = [];
            for (const card of entry.roster) {
              const cid = cardIdOf(card.player_id, card.tournament_id);
              if (drafted.has(cid)) continue;
              const ov = choiceOverallForBasis(
                card.choice_overall as ChoiceOverall | number | null | undefined,
                basis,
              );
              if (typeof ov === "number") poolVals.push(ov);
            }
            if (poolVals.length >= 2) {
              const poolSpread = Math.max(...poolVals) - Math.min(...poolVals);
              sumPool += poolSpread;
              if (poolSpread > 0) {
                sumRatio += obsSpread / poolSpread;
                ratioN += 1;
                if (obsSpread <= poolSpread - 2) leave2 += 1;
                else near += 1;
              } else {
                tight += 1;
              }
            }
          }
        }
        state = stepDraft(catalog, state);
      }
      done += 1;
    } catch {
      // reject seed
    }
    seed += 1;
    if (seed > N * 20) throw new Error(`${label} too many rejects seed=${seed} done=${done}`);
  }

  return {
    label,
    era,
    basis,
    flow,
    drafts: N,
    offers,
    pair_within_curve: Object.fromEntries(
      THRESHOLDS.map((t) => [t, thrHits[String(t)]! / Math.max(1, offers)]),
    ),
    share_of_tied_offers_with_any_estimate_card: Object.fromEntries(
      THRESHOLDS.map((t) => [
        t,
        thrTied[String(t)]! ? thrWithEst[String(t)]! / thrTied[String(t)]! : null,
      ]),
    ),
    construction: {
      mean_observed_spread: sumObs / Math.max(1, offers),
      mean_remaining_squad_pool_spread: sumPool / Math.max(1, offers),
      mean_observed_over_pool_ratio: ratioN ? sumRatio / ratioN : null,
      offers_observed_le_pool_minus_2: leave2,
      offers_observed_near_pool: near,
      offers_pool_zero_spread: tight,
      observed_spread_histogram: obsHist,
    },
  };
}

function main(): void {
  const { bundle, compressed_sha256, decoded_bytes } = readBundle();
  const sample = bundle.player_cards[0]!;
  console.error(
    "sample card_id",
    sample.card_id,
    "tid",
    sample.tournament_id,
    "pid",
    sample.player_id,
  );

  const ratingById = new Map(bundle.ratings.map((r) => [r.card_id, r]));
  const cardMeta = new Map(bundle.player_cards.map((c) => [c.card_id, c]));
  const byPlayerTournament = new Map<string, string>();
  for (const c of bundle.player_cards) {
    byPlayerTournament.set(`${c.player_id}\0${c.tournament_id}`, c.card_id);
  }
  const cardIdOf = (playerId: string, tournamentId: number): string =>
    byPlayerTournament.get(`${playerId}\0${tournamentId}`) ?? `${playerId}:${tournamentId}`;

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  const fullDataset = buildDataset(bundle);
  const careerEstimateIds = new Set(
    bundle.ratings.filter((r) => ESTIMATE.has(r.overall_basis)).map((r) => r.card_id),
  );
  console.error("career estimates", careerEstimateIds.size);

  const cells = [];
  const era = "all_time" as EraPresetId;
  for (const basis of ["career", "current"] as const) {
    const catalog = buildDraftCatalog(fullDataset, era);
    cells.push(
      runCell(
        catalog,
        ratingById,
        cardMeta,
        cardIdOf,
        manifest,
        era,
        basis,
        "squad_first",
        `${era}.squad_first.${basis}`,
      ),
    );
  }
  const exclCatalog = buildDraftCatalog(buildDataset(bundle, careerEstimateIds), era);
  cells.push(
    runCell(
      exclCatalog,
      ratingById,
      cardMeta,
      cardIdOf,
      manifest,
      era,
      "career",
      "squad_first",
      `${era}.squad_first.career.pool_exclude_career_estimates`,
    ),
  );

  const out = {
    schema_version: "choose3-construction-attribution-1.0.0",
    measurement_date: new Date().toISOString().slice(0, 10),
    n_drafts_per_cell: N,
    bundle_compressed_sha256: compressed_sha256,
    bundle_decoded_bytes: decoded_bytes,
    career_estimate_cards_excluded: careerEstimateIds.size,
    cells,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main();
