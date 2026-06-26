import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GAME_STYLE_PARTIALS = [
  "shared.module.css",
  "draft-base.module.css",
  "review-base.module.css",
  "results.module.css",
  "share.module.css",
  "draft-shell.module.css",
  "review.module.css",
  "draft-spin.module.css",
  "history.module.css",
  "draft-polish.module.css",
] as const;

export function readGameCssSource(): string {
  return GAME_STYLE_PARTIALS.map((filename) =>
    readFileSync(
      fileURLToPath(new URL(`../../../components/game/game-styles/${filename}`, import.meta.url)),
      "utf8",
    ),
  ).join("\n");
}
