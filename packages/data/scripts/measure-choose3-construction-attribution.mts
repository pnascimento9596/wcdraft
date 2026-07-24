#!/usr/bin/env node
/**
 * Evidence-only companion to analyze-choose3-clustering.mts.
 * Measures (1) offer-construction spread extraction vs remaining squad pool
 * and (2) pool-level exclusion of estimate cards (not post-hoc offer filtering).
 * Calls production createDraft/stepDraft/etc; does not reimplement tier selection.
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
  DraftTargetDeadEndError,
  filterDraftDataset,
  isDraftComplete,
  pickManager,
  pickPlayer,
  selectDraftTarget,
  stepDraft,
  type DraftCatalog,
  type DraftDataset,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
  type RatingBasis,
} from "../../core/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUNDLE = path.join(ROOT, "packages/data/src/generated/draft-pool.compact.json.br");
const MANIFEST = path.join(ROOT, "packages/data/src/generated/manifest.json");
const N = 1024;
const ESTIMATE = new Set(["career_stature_estimate", "baseline_anchor_estimate"]);
const THRESHOLDS = [0, 1, 2, 3] as const;

interface Rating {
  card_id: string;
  overall: number | null;
  overall_basis: string;
  basis_ratings: { current: { overall: number | null; overall_basis: string } };
}

function readBundle() {
  const compressed = readFileSync(BUNDLE);
  // Prefer unstripped backup if present (C2b may have stripped working tree)
  const backup = "/tmp/c2b-backup/draft-pool.compact.json.br";
  let bytes = compressed;
  try {
    bytes = readFileSync(backup);
  } catch {
    /* use working tree */
  }
  const raw = brotliDecompressSync(bytes);
  return {
    bundle: JSON.parse(raw.toString("utf8")) as {
      player_cards: any[];
      manager_cards: any[];
      ratings: Rating[];
      tournaments: Record<string, { year: number }>;
    },
    compressed_sha256: createHash("sha256").update(bytes).digest("hex"),
    decoded_bytes: raw.length,
  };
}

function buildDataset(bundle: any, excludeEstimateCardIds?: Set<string>): DraftDataset {
  const ratingByCardId = new Map<string, Rating>();
  for (const r of bundle.ratings) ratingByCardId.set(r.card_id, r);
  const players = bundle.player_cards
    .filter((c: any) => !excludeEstimateCardIds?.has(c.card_id))
    .map((c: any) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
      choice_overall: {
        career: ratingByCardId.get(c.card_id)?.overall ?? null,
        current: ratingByCardId.get(c.card_id)?.basis_ratings.current.overall ?? null,
      },
    }));
  return {
    players,
    managers: bundle.manager_cards.map((m: any) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    tournaments: Object.entries(bundle.tournaments).map(([tid, t]: any) => ({
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
function pairwiseWithin(values: number[], thr: number): boolean {
  for (let i = 0; i < values.length; i++)
    for (let j = i + 1; j < values.length; j++)
      if (Math.abs(values[i]! - values[j]!) <= thr) return true;
  return false;
}

function firstVacant(state: DraftState): string {
  const slot = state.squad.find((s) => s.card_id === null);
  if (!slot) throw new Error("no vacant");
  return slot.slot_id;
}

function runCell(
  catalog: DraftCatalog,
  ratingById: Map<string, Rating>,
  cardMeta: Map<string, { tournament_id: number; nation_id: string }>,
  manifest: any,
  era: EraPresetId,
  basis: RatingBasis,
  flow: DraftFlow,
  label: string,
) {
  const thrHits = Object.fromEntries(THRESHOLDS.map((t) => [t, 0]));
  const thrTotal = { n: 0 };
  const thrWithEst = Object.fromEntries(THRESHOLDS.map((t) => [t, 0]));
  const thrTied = Object.fromEntries(THRESHOLDS.map((t) => [t, 0]));
  let sumObs = 0,
    sumPool = 0,
    sumRatio = 0,
    ratioN = 0,
    leftOnTable = 0,
    extracted = 0,
    poolTooTight = 0;
  const obsHist: Record<number, number> = {};
  const gapHist: Record<string, number> = {}; // observed_spread vs pool_spread buckets

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
      const drafted = new Set<string>();
      while (!isDraftComplete(state)) {
        if (flow === "squad_first") {
          const spin = activeSpin(state);
          if (spin && spin.kind === "player" && spin.rolled_card_ids.length === 3) {
            const ids = [...spin.rolled_card_ids];
            const ovs = ids.map((id) => selectedOverall(ratingById.get(id)!, basis)!);
            const prov = ids.map((id) => selectedBasisName(ratingById.get(id)!, basis));
            const hasEst = prov.some((p) => ESTIMATE.has(p));
            thrTotal.n += 1;
            const obsSpread = Math.max(...ovs) - Math.min(...ovs);
            sumObs += obsSpread;
            obsHist[obsSpread] = (obsHist[obsSpread] ?? 0) + 1;
            for (const t of THRESHOLDS) {
              if (pairwiseWithin(ovs, t)) {
                thrHits[t]! += 1;
                thrTied[t]! += 1;
                if (hasEst) thrWithEst[t]! += 1;
              }
            }
            // Available pool: same TN remaining legal roster
            const meta = cardMeta.get(ids[0]!)!;
            const entry = catalog.pairs.find(
              (p) => p.tournament_id === meta.tournament_id && p.nation_id === meta.nation_id,
            );
            if (entry) {
              const poolOvs: number[] = [];
              for (const card of entry.roster) {
                const cid = `${card.player_id}:${/* need tournament from card */ ""}`;
              }
              // DraftPlayerCard uses player_id + tournament_id; reconstruct card_id
              for (const card of entry.roster) {
                const cid = `${card.player_id}:${String(
                  // @ts-expect-error tournament_id on card
                  (card as any).tournament_id ?? meta.tournament_id,
                ).replace(/^/, "")}`;
              }
              // Use choice_overall from catalog cards + draft state drafted set
              const remaining = entry.roster.filter((card) => {
                const cardId = `${card.player_id}:${meta.tournament_id}`;
                // card_id format is P-xxx:YEAR or P-xxx:tournament — match rolled ids scheme
                return true;
              });
              // Better: use rolled ids' tournament from rating
              const tId = ratingById.get(ids[0]!)!;
              const tournamentId = (bundleCardTournament(ids[0]!, cardMeta));
              const entry2 = catalog.pairs.find(
                (p) => p.tournament_id === tournamentId && p.nation_id === meta.nation_id,
              )!;
              const poolVals: number[] = [];
              for (const card of entry2.roster) {
                const cid = buildCardId(card.player_id, card.tournament_id);
                if (drafted.has(cid)) continue;
                const ov =
                  basis === "current"
                    ? (card.choice_overall as any)?.current ??
                      (typeof card.choice_overall === "number" ? card.choice_overall : null)
                    : (card.choice_overall as any)?.career ??
                      (typeof card.choice_overall === "number" ? card.choice_overall : null);
                if (typeof ov === "number") poolVals.push(ov);
              }
              if (poolVals.length >= 2) {
                const poolSpread = Math.max(...poolVals) - Math.min(...poolVals);
                sumPool += poolSpread;
                if (poolSpread > 0) {
                  const ratio = obsSpread / poolSpread;
                  sumRatio += ratio;
                  ratioN += 1;
                  if (obsSpread <= poolSpread - 2) leftOnTable += 1;
                  else extracted += 1;
                } else poolTooTight += 1;
                const key = `${obsSpread}/${poolSpread}`;
                gapHist[key] = (gapHist[key] ?? 0) + 1;
              }
            }
            for (const id of ids) drafted.add(id);
          }
          const before = state.manager_card_id;
          state = stepDraft(catalog, state);
          if (before === null && state.manager_card_id) {
            /* manager */
          }
          // track drafted players from state
          for (const s of state.squad) if (s.card_id) drafted.add(s.card_id);
          continue;
        }
        // position_first simplified: skip construction detail (squad_first is canonical)
        if (state.manager_card_id === null) {
          try {
            state = pickManager(catalog, selectDraftTarget(catalog, state, "manager"));
            continue;
          } catch (e) {
            if (!(e instanceof DraftTargetDeadEndError)) throw e;
          }
        }
        state = selectDraftTarget(catalog, state, firstVacant(state));
        const spin = activeSpin(state)!;
        if (spin.rolled_card_ids.length === 3) {
          thrTotal.n += 1;
          const ovs = spin.rolled_card_ids.map(
            (id) => selectedOverall(ratingById.get(id)!, basis)!,
          );
          for (const t of THRESHOLDS) if (pairwiseWithin(ovs, t)) thrHits[t]! += 1;
        }
        if (spin.rolled_card_ids[0]) state = pickPlayer(catalog, state, spin.rolled_card_ids[0]!);
        for (const s of state.squad) if (s.card_id) drafted.add(s.card_id);
      }
      done += 1;
    } catch {
      /* reject seed */
    }
    seed += 1;
    if (seed > N * 10) throw new Error("too many rejects");
  }

  return {
    label,
    era,
    basis,
    flow,
    drafts: N,
    offers: thrTotal.n,
    pair_within_curve: Object.fromEntries(
      THRESHOLDS.map((t) => [t, thrHits[t]! / Math.max(1, thrTotal.n)]),
    ),
    share_of_tied_offers_with_any_estimate_card: Object.fromEntries(
      THRESHOLDS.map((t) => [t, thrTied[t]! ? thrWithEst[t]! / thrTied[t]! : null]),
    ),
    construction: {
      mean_observed_spread: sumObs / Math.max(1, thrTotal.n),
      mean_pool_spread: sumPool / Math.max(1, thrTotal.n),
      mean_observed_over_pool_ratio: ratioN ? sumRatio / ratioN : null,
      offers_leaving_ge2_on_table: leftOnTable,
      offers_extracting_near_pool: extracted,
      offers_pool_zero_spread: poolTooTight,
      observed_spread_histogram: obsHist,
    },
  };
}

function buildCardId(playerId: string, tournamentId: number): string {
  // Match core: typically `${player_id}:${year}` — check sample card_ids
  return `${playerId}:${tournamentId}`;
}
function bundleCardTournament(cardId: string, meta: Map<string, any>): number {
  return meta.get(cardId)!.tournament_id;
}

function main() {
  const { bundle, compressed_sha256, decoded_bytes } = readBundle();
  // Detect stripped
  if (!Array.isArray(bundle.ratings[0]?.components) && !("components" in bundle.ratings[0])) {
    console.error("WARN: working bundle lacks components; using backup if available");
  }
  // Fix card_id construction from actual ids
  const sample = bundle.player_cards[0];
  console.error("sample card_id", sample.card_id, "tid", sample.tournament_id, "pid", sample.player_id);

  const ratingById = new Map(bundle.ratings.map((r) => [r.card_id, r]));
  const cardMeta = new Map(
    bundle.player_cards.map((c: any) => [
      c.card_id,
      { tournament_id: c.tournament_id, nation_id: c.nation_id, player_id: c.player_id },
    ]),
  );
  // Actual card_id format
  function cardIdOf(playerId: string, tournamentId: number): string {
    // Find by lookup rather than format assumption
    for (const [cid, m] of cardMeta) {
      if (m.player_id === playerId && m.tournament_id === tournamentId) return cid;
    }
    return `${playerId}:${tournamentId}`;
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const fullDataset = buildDataset(bundle);
  const estimateIds = new Set(
    bundle.ratings
      .filter((r) => ESTIMATE.has(r.overall_basis) || ESTIMATE.has(r.basis_ratings.current.overall_basis))
      .map((r) => r.card_id),
  );
  // Career-visible estimates only (927)
  const careerEstimateIds = new Set(
    bundle.ratings.filter((r) => ESTIMATE.has(r.overall_basis)).map((r) => r.card_id),
  );
  console.error("career estimates", careerEstimateIds.size, "any-basis", estimateIds.size);

  const cells: any[] = [];
  for (const era of ["all_time"] as EraPresetId[]) {
    for (const basis of ["career", "current"] as RatingBasis[]) {
      const catalog = buildDraftCatalog(fullDataset, era);
      // Patch runCell to use cardIdOf - rewrite construction path cleanly via redefinition below
      cells.push(
        runCellPatched(
          catalog,
          ratingById,
          cardMeta,
          manifest,
          era,
          basis,
          "squad_first",
          `${era}.squad_first.${basis}`,
          cardIdOf,
        ),
      );
    }
    // Pool exclusion: remove career estimates from dataset before catalog
    const exclDataset = buildDataset(bundle, careerEstimateIds);
    const exclCatalog = buildDraftCatalog(exclDataset, era);
    cells.push(
      runCellPatched(
        exclCatalog,
        ratingById,
        cardMeta,
        manifest,
        era,
        "career",
        "squad_first",
        `${era}.squad_first.career.pool_exclude_career_estimates`,
        cardIdOf,
      ),
    );
  }

  const out = {
    schema_version: "choose3-construction-attribution-1.0.0",
    measurement_date: new Date().toISOString().slice(0, 10),
    n_drafts_per_cell: N,
    bundle_compressed_sha256: compressed_sha256,
    bundle_decoded_bytes: decoded_bytes,
    career_estimate_cards_excluded: careerEstimateIds.size,
    cells,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

// Clean patched runner
function runCellPatched(
  catalog: DraftCatalog,
  ratingById: Map<string, Rating>,
  cardMeta: Map<string, { tournament_id: number; nation_id: string; player_id: string }>,
  manifest: any,
  era: EraPresetId,
  basis: RatingBasis,
  flow: DraftFlow,
  label: string,
  cardIdOf: (p: string, t: number) => string,
) {
  const thrHits = Object.fromEntries(THRESHOLDS.map((t) => [String(t), 0]));
  let offers = 0;
  const thrWithEst = Object.fromEntries(THRESHOLDS.map((t) => [String(t), 0]));
  const thrTied = Object.fromEntries(THRESHOLDS.map((t) => [String(t), 0]));
  let sumObs = 0,
    sumPool = 0,
    sumRatio = 0,
    ratioN = 0,
    leave2 = 0,
    near = 0,
    tight = 0;
  const obsHist: Record<string, number> = {};
  let seed = 0,
    done = 0;
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
        if (flow === "squad_first") {
          const spin = activeSpin(state);
          if (spin && (spin as any).kind !== "manager" && spin.rolled_card_ids?.length === 3) {
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
                const co = card.choice_overall as any;
                const ov =
                  basis === "current"
                    ? (co?.current ?? null)
                    : (co?.career ?? (typeof co === "number" ? co : null));
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
                } else tight += 1;
              }
            }
          }
          state = stepDraft(catalog, state);
          continue;
        }
        throw new Error("only squad_first supported");
      }
      done += 1;
    } catch (e) {
      // seed reject
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

main();
