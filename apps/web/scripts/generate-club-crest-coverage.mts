import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allClubCrestManifestEntries, resolveClubCrest } from "../lib/game/club-crests";

interface RuntimePlayerCardLike {
  tournament_id: number;
  club_at_tournament?: string | null;
  club?: string | null;
}

interface DraftPoolLike {
  schema_version: string;
  player_cards: RuntimePlayerCardLike[];
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "..", "..");
const DRAFT_POOL_PATH = path.join(
  REPO_ROOT,
  "packages",
  "data",
  "src",
  "generated",
  "draft-pool.compact.json",
);
const REPORT_PATH = path.join(REPO_ROOT, "docs", "reports", "real-club-crests.md");

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function row(label: string, cards: RuntimePlayerCardLike[]): string {
  const withClub = cards.filter((card) => card.club_at_tournament ?? card.club);
  const resolved = withClub.filter((card) => {
    const club = card.club_at_tournament ?? card.club;
    return resolveClubCrest(club, card.tournament_id)?.kind === "crest";
  });
  const fallback = withClub.length - resolved.length;
  return `| ${label} | ${cards.length} | ${withClub.length} | ${resolved.length} | ${fallback} | ${pct(fallback, withClub.length)} |`;
}

async function main() {
  const write = process.argv.includes("--write");
  const draftPool = JSON.parse(await readFile(DRAFT_POOL_PATH, "utf8")) as DraftPoolLike;
  const historical = draftPool.player_cards.filter((card) => card.tournament_id !== 2026);
  const projected2026 = draftPool.player_cards.filter((card) => card.tournament_id === 2026);
  const entries = allClubCrestManifestEntries();
  const uniqueAssets = new Set(entries.map((entry) => entry.crest_asset_ref));
  const sourceCount = new Set(entries.map((entry) => entry.source_url)).size;

  const report = [
    "# Real Club Crests Coverage",
    "",
    `Generated from \`${path.relative(REPO_ROOT, DRAFT_POOL_PATH)}\` (` +
      `schema \`${draftPool.schema_version}\`) and ` +
      "`apps/web/public/clubs/manifest.json`.",
    "",
    "## Method",
    "",
    "- Resolver: side lookup at render time from normalized club string plus tournament year.",
    "- Confidence threshold: exact normalized string and audited current-logo asset in the manifest.",
    "- Crest scope: current club-entity crests render only on 2026 projected cards.",
    "- Historical, ambiguous, unmapped, and missing-club rows intentionally use deterministic monograms.",
    "- Pitch slots stay flag-only; the crest lives only beside the club text on candidate cards.",
    "",
    "## Asset Sources",
    "",
    `- Wikimedia Commons public-domain SVG assets: ${uniqueAssets.size} asset files from ${sourceCount} source URLs.`,
    "- Oversized or non-SVG candidates were excluded rather than transformed blindly.",
    "",
    "## Coverage",
    "",
    "| Era | player cards | with club | resolved with real crest | monogram fallback | fallback rate |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    row("Historical 1930-2022", historical),
    row("Projected 2026", projected2026),
    row("All", draftPool.player_cards),
    "",
    "Historical fallback is expected and correct in this lane: the bundled assets are current club-entity crests, not verified at-tournament historical crests.",
    "",
    "## Schema Orthogonality",
    "",
    "- No runtime-data schema change.",
    "- No player-card schema change.",
    "- No runtime-data version bump.",
    "- No core, sim, rating, or golden behavior change.",
    "- Diff is confined to web rendering/tests/scripts/docs plus static `/clubs/` assets.",
    "",
  ].join("\n");

  if (write) {
    await writeFile(REPORT_PATH, report);
  } else {
    process.stdout.write(report);
  }
}

await main();
