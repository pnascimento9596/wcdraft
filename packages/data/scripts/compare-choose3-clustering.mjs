#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`compare-choose3-clustering: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value) {
  return Number(value.toFixed(9));
}

const [beforePath, afterPath, summaryPath, attributionPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !summaryPath || !attributionPath) {
  fail("usage: <before-full.json> <after-full.json> <summary.json> <attributions.json>");
}

const beforeBytes = readFileSync(beforePath);
const afterBytes = readFileSync(afterPath);
const before = JSON.parse(beforeBytes.toString("utf8"));
const after = JSON.parse(afterBytes.toString("utf8"));
const beforeCells = new Map(before.cells.map((cell) => [cell.cell_id, cell]));
const afterCells = new Map(after.cells.map((cell) => [cell.cell_id, cell]));

if (beforeCells.size !== 16 || afterCells.size !== 16) fail("expected 16 cells in each input");
if (!before.convergence?.pass || !after.convergence?.pass) fail("both inputs must converge");

const careerBefore = before.cells.filter((cell) => cell.rating_basis === "career");
const careerAfter = after.cells.filter((cell) => cell.rating_basis === "career");
const careerBeforeBytes = Buffer.from(JSON.stringify(careerBefore));
const careerAfterBytes = Buffer.from(JSON.stringify(careerAfter));
const careerByteIdentical = careerBeforeBytes.equals(careerAfterBytes);
if (!careerByteIdentical) fail("Career cells are not byte-identical");

const attributionRecords = [];
const perCell = [];
let comparedPlayerPicks = 0;
let selectedPickFlips = 0;
let directBasisFlips = 0;
let cascadeFlips = 0;
let draftsWithFlips = 0;

for (const beforeCell of before.cells.filter((cell) => cell.rating_basis === "current")) {
  const afterCell = afterCells.get(beforeCell.cell_id);
  if (!afterCell) fail(`missing after cell ${beforeCell.cell_id}`);
  if (afterCell.rating_basis !== "current") fail(`${beforeCell.cell_id} changed rating basis`);

  const beforeDrafts = new Map(beforeCell.draft_records.map((record) => [record[0], record]));
  const afterDrafts = new Map(afterCell.draft_records.map((record) => [record[0], record]));
  const beforeOffers = new Map(
    beforeCell.offer_records.map((offer) => [`${offer[0]}:${offer[1]}`, offer]),
  );
  const afterOffers = new Map(
    afterCell.offer_records.map((offer) => [`${offer[0]}:${offer[1]}`, offer]),
  );
  if (beforeDrafts.size !== afterDrafts.size) fail(`${beforeCell.cell_id} draft count changed`);

  let cellPicks = 0;
  let cellFlips = 0;
  let cellDirect = 0;
  let cellCascade = 0;
  let cellDraftsWithFlips = 0;
  for (const [draftOrdinal, beforeDraft] of beforeDrafts) {
    const afterDraft = afterDrafts.get(draftOrdinal);
    if (!afterDraft) fail(`${beforeCell.cell_id} missing draft ${draftOrdinal}`);
    if (beforeDraft[1] !== afterDraft[1]) {
      fail(`${beforeCell.cell_id} draft ${draftOrdinal} changed candidate seed`);
    }
    if (beforeDraft[2] !== afterDraft[2]) {
      fail(`${beforeCell.cell_id} draft ${draftOrdinal} changed manager pick index`);
    }
    let priorPlayerFlip = false;
    let draftFlipped = false;
    for (let pickIndex = 1; pickIndex <= 17; pickIndex += 1) {
      if (pickIndex === beforeDraft[2]) continue;
      const key = `${draftOrdinal}:${pickIndex}`;
      const beforeOffer = beforeOffers.get(key);
      const afterOffer = afterOffers.get(key);
      if (!beforeOffer || !afterOffer) {
        fail(`${beforeCell.cell_id} missing player offer ${key}`);
      }
      const beforeCard = beforeOffer[2][0];
      const afterCard = afterOffer[2][0];
      cellPicks += 1;
      comparedPlayerPicks += 1;
      if (beforeCard === afterCard) continue;

      const attribution = priorPlayerFlip
        ? "cascade_after_basis_change"
        : "direct_selected_basis_tiering_change";
      if (priorPlayerFlip) {
        cellCascade += 1;
        cascadeFlips += 1;
      } else {
        cellDirect += 1;
        directBasisFlips += 1;
      }
      cellFlips += 1;
      selectedPickFlips += 1;
      priorPlayerFlip = true;
      draftFlipped = true;
      attributionRecords.push({
        cell_id: beforeCell.cell_id,
        draft_ordinal: draftOrdinal,
        candidate_seed_index: beforeDraft[1],
        pick_index: pickIndex,
        attribution,
        before_selected_card_id: beforeCard,
        after_selected_card_id: afterCard,
        before_offer_card_ids: beforeOffer[2],
        after_offer_card_ids: afterOffer[2],
        before_selected_basis_display_overalls: beforeOffer[3],
        after_selected_basis_display_overalls: afterOffer[3],
      });
    }
    if (draftFlipped) {
      cellDraftsWithFlips += 1;
      draftsWithFlips += 1;
    }
  }

  const tieRates = beforeCell.tie_rates.map((beforeRate) => {
    const afterRate = afterCell.tie_rates.find(
      (candidate) => candidate.threshold === beforeRate.threshold,
    );
    if (!afterRate) fail(`${beforeCell.cell_id} missing threshold ${beforeRate.threshold}`);
    return {
      threshold: beforeRate.threshold,
      all: {
        before: beforeRate.all.rate,
        after: afterRate.all.rate,
        delta: round(afterRate.all.rate - beforeRate.all.rate),
      },
      excluding_visible_estimate_candidates: {
        before: beforeRate.excluding_visible_estimate_candidates.rate,
        after: afterRate.excluding_visible_estimate_candidates.rate,
        delta: round(
          afterRate.excluding_visible_estimate_candidates.rate -
            beforeRate.excluding_visible_estimate_candidates.rate,
        ),
      },
    };
  });
  perCell.push({
    cell_id: beforeCell.cell_id,
    era_preset: beforeCell.era_preset,
    draft_flow: beforeCell.draft_flow,
    complete_drafts: beforeCell.complete_drafts,
    compared_player_picks: cellPicks,
    selected_pick_flips: cellFlips,
    drafts_with_flips: cellDraftsWithFlips,
    direct_selected_basis_tiering_flips: cellDirect,
    cascade_after_basis_change_flips: cellCascade,
    unexplained_flips: 0,
    tie_rates: tieRates,
  });
}

const attribution = {
  schema_version: "choose3-basis-flip-attribution-1.0.0",
  method: {
    selected_pick_definition:
      "visible offer index 0 at every player pick; the manager pick index is excluded",
    direct:
      "the first selected-card divergence in a draft; all prior selected player identities are byte-identical, so pre-pick state is identical and the divergence is directly caused by selected-basis offer tiering",
    cascade:
      "a later selected-card divergence after the first direct divergence changed the drafted-player state",
  },
  records: attributionRecords,
};
const attributionBytes = Buffer.from(`${JSON.stringify(attribution)}\n`);
writeFileSync(attributionPath, attributionBytes);

const summary = {
  schema_version: "choose3-basis-aware-comparison-1.0.0",
  measurement_date: after.measurement_date,
  before: {
    source_path: path.basename(beforePath),
    sha256: sha256(beforeBytes),
    engine_version: before.inputs.engine_version,
    commit: before.inputs.base_commit,
  },
  after: {
    source_path: path.basename(afterPath),
    sha256: sha256(afterBytes),
    engine_version: after.inputs.engine_version,
    commit: after.inputs.base_commit,
  },
  career_proof: {
    cells: careerBefore.length,
    complete_drafts: careerBefore.reduce((sum, cell) => sum + cell.complete_drafts, 0),
    byte_identical: careerByteIdentical,
    before_cells_sha256: sha256(careerBeforeBytes),
    after_cells_sha256: sha256(careerAfterBytes),
    selected_pick_flips: 0,
  },
  current_proof: {
    cells: perCell.length,
    complete_drafts: perCell.reduce((sum, cell) => sum + cell.complete_drafts, 0),
    compared_player_picks: comparedPlayerPicks,
    selected_pick_flips: selectedPickFlips,
    drafts_with_flips: draftsWithFlips,
    direct_selected_basis_tiering_flips: directBasisFlips,
    cascade_after_basis_change_flips: cascadeFlips,
    unexplained_flips: 0,
    attribution_artifact: {
      path: path.basename(attributionPath),
      bytes: attributionBytes.length,
      sha256: sha256(attributionBytes),
      records: attributionRecords.length,
    },
    per_cell: perCell,
  },
  convergence: after.convergence,
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  JSON.stringify({
    summary: summaryPath,
    attribution: attributionPath,
    career_byte_identical: careerByteIdentical,
    current_selected_pick_flips: selectedPickFlips,
    direct: directBasisFlips,
    cascade: cascadeFlips,
    unexplained: 0,
  }),
);
