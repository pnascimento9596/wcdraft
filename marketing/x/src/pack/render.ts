// Render a WeekPack to a single clean, copy-paste markdown file. Each post is
// its own fenced block so the owner can select + copy the exact text into the
// X composer, then use the native Schedule button.

import { X_HANDLE } from "../config.ts";
import { DAY_NAMES, type PackPost, type WeekPack } from "./generate.ts";

function renderPost(index: number, p: PackPost): string {
  const note = p.note ? ` — _${p.note}_` : "";
  const label = p.family.replace(/_/g, " ");
  return [
    `**${index}. ${label} · ${p.char_count}/280 chars**${note}`,
    "",
    "```",
    p.text,
    "```",
    "",
  ].join("\n");
}

export function renderWeekPackMarkdown(pack: WeekPack): string {
  const lines: string[] = [];
  lines.push(`# ${X_HANDLE} — X content pack · week ${pack.iso_label}`);
  lines.push("");
  lines.push(
    `${pack.total} ready-to-paste posts. Open each block in the X web composer, paste, and use the **native Schedule** button to spread them across the week. Every post is already checked for terminology, feature-truth, and the 280-char limit. Nothing here needs the X API.`,
  );
  lines.push("");
  lines.push(
    `Pacing guide: ~1–2 posts/day on quiet days, 2 on a match day. You do NOT have to post all of these — pick the strongest and schedule them. Skip or reorder freely.`,
  );
  lines.push("");

  for (let d = 0; d < pack.days.length; d += 1) {
    const day = pack.days[d]!;
    if (day.length === 0) continue;
    lines.push(`## ${DAY_NAMES[d]}`);
    lines.push("");
    day.forEach((p, i) => lines.push(renderPost(i + 1, p)));
  }

  lines.push(`## Result spotlights`);
  lines.push("");
  if (pack.spotlights.length === 0) {
    lines.push(
      "_No result-spotlight posts this week — drop a real, replay-checked share token into `marketing/x/queue/` (a `result_spotlight` item) to include narrated runs here._",
    );
    lines.push("");
  } else {
    lines.push(
      "_Post these when you (or a player) have a strong real run. The record is computed from the actual share token — never invented._",
    );
    lines.push("");
    pack.spotlights.forEach((p, i) => lines.push(renderPost(i + 1, p)));
  }

  return lines.join("\n") + "\n";
}
