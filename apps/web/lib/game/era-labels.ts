import { ERA_PRESETS, type EraPresetId } from "@wcdraft/core";

const ERA_PRESET_NAMES: Record<EraPresetId, string> = {
  all_time: "All-time",
  post_2000: "Post-2000",
  post_2010: "Post-2010",
  modern: "Modern",
};

function yearRangeLabel(id: EraPresetId): string {
  const preset = ERA_PRESETS[id];
  const max =
    Math.floor(preset.min_year / 100) === Math.floor(preset.max_year / 100)
      ? String(preset.max_year).slice(2)
      : String(preset.max_year);
  return `${preset.min_year}–${max}`;
}

export const ERA_PRESET_LABELS: Readonly<Record<EraPresetId, string>> = Object.freeze({
  all_time: `${ERA_PRESET_NAMES.all_time} (${yearRangeLabel("all_time")})`,
  post_2000: `${ERA_PRESET_NAMES.post_2000} (${yearRangeLabel("post_2000")})`,
  post_2010: `${ERA_PRESET_NAMES.post_2010} (${yearRangeLabel("post_2010")})`,
  modern: `${ERA_PRESET_NAMES.modern} (${yearRangeLabel("modern")})`,
});
