// CLI: mint a fresh, replay-checked sample share token against the CURRENT
// bundle. Use this to refresh queue/004-result-spotlight-sample.json after a
// dataset/rating/engine version bump (the committed token embeds version
// anchors and honest-skips once they drift). Prints the record + token JSON.
//
//   pnpm gen:fixture [seed]

import { autoDraft } from "@wcdraft/core";
import { loadMarketingGameData, simulateDraft } from "../engine/game-data.ts";
import { buildTokenBodyFromDraft, encodeRunTokenV2 } from "../engine/token.ts";

const seed = process.argv[2] ?? "wcdraft:mkt:scan:17";
const gd = loadMarketingGameData();
const draft = autoDraft({
  run_id: "sample",
  parent_seed: seed,
  formation_id: "4-3-3",
  mode: "classic",
  team_name: "Azteca XI",
  dataset_version: gd.versions.dataset_version,
  rating_version: gd.versions.rating_version,
  engine_version: gd.versions.engine_version,
  dataset: gd.draftDataset,
});
const run = simulateDraft(gd, draft, seed);
const token = encodeRunTokenV2(buildTokenBodyFromDraft(draft, gd, seed));
console.log(
  JSON.stringify({ seed, record: run.record, is_champion: run.is_champion, token }, null, 2),
);
