// Flag asset resolution for the slot-machine reveal.
//
// Runtime data exposes nations by `nation_id` (e.g. `T-03` for Argentina) and
// a non-authoritative three-letter `code` (e.g. `ARG`). There is no ISO2 in
// the contract. SVG flag assets live under `apps/web/public/flags/` and are
// named by `nation_id`, so this module is the single source of truth for
// "does this nation have a flag asset?".
//
// All 88 historical + 5 W26 nations the runtime can surface are covered.
// Provenance (and historical substitutes) are documented in
// `apps/web/public/flags/README.md` and `apps/web/public/flags/manifest.json`.

const FLAG_SRC_BY_NATION_ID: Readonly<Record<string, `/flags/${string}.svg`>> =
  Object.freeze({
    "T-01": "/flags/T-01.svg",
    "T-02": "/flags/T-02.svg",
    "T-03": "/flags/T-03.svg",
    "T-04": "/flags/T-04.svg",
    "T-05": "/flags/T-05.svg",
    "T-06": "/flags/T-06.svg",
    "T-07": "/flags/T-07.svg",
    "T-08": "/flags/T-08.svg",
    "T-09": "/flags/T-09.svg",
    "T-10": "/flags/T-10.svg",
    "T-11": "/flags/T-11.svg",
    "T-12": "/flags/T-12.svg",
    "T-13": "/flags/T-13.svg",
    "T-14": "/flags/T-14.svg",
    "T-15": "/flags/T-15.svg",
    "T-16": "/flags/T-16.svg",
    "T-17": "/flags/T-17.svg",
    "T-18": "/flags/T-18.svg",
    "T-19": "/flags/T-19.svg",
    "T-20": "/flags/T-20.svg",
    "T-21": "/flags/T-21.svg",
    "T-22": "/flags/T-22.svg",
    "T-23": "/flags/T-23.svg",
    "T-24": "/flags/T-24.svg",
    "T-25": "/flags/T-25.svg",
    "T-26": "/flags/T-26.svg",
    "T-27": "/flags/T-27.svg",
    "T-28": "/flags/T-28.svg",
    "T-29": "/flags/T-29.svg",
    "T-30": "/flags/T-30.svg",
    "T-31": "/flags/T-31.svg",
    "T-32": "/flags/T-32.svg",
    "T-33": "/flags/T-33.svg",
    "T-34": "/flags/T-34.svg",
    "T-35": "/flags/T-35.svg",
    "T-36": "/flags/T-36.svg",
    "T-37": "/flags/T-37.svg",
    "T-38": "/flags/T-38.svg",
    "T-39": "/flags/T-39.svg",
    "T-40": "/flags/T-40.svg",
    "T-41": "/flags/T-41.svg",
    "T-42": "/flags/T-42.svg",
    "T-43": "/flags/T-43.svg",
    "T-44": "/flags/T-44.svg",
    "T-45": "/flags/T-45.svg",
    "T-46": "/flags/T-46.svg",
    "T-47": "/flags/T-47.svg",
    "T-48": "/flags/T-48.svg",
    "T-49": "/flags/T-49.svg",
    "T-50": "/flags/T-50.svg",
    "T-51": "/flags/T-51.svg",
    "T-52": "/flags/T-52.svg",
    "T-53": "/flags/T-53.svg",
    "T-54": "/flags/T-54.svg",
    "T-55": "/flags/T-55.svg",
    "T-56": "/flags/T-56.svg",
    "T-57": "/flags/T-57.svg",
    "T-58": "/flags/T-58.svg",
    "T-59": "/flags/T-59.svg",
    "T-60": "/flags/T-60.svg",
    "T-61": "/flags/T-61.svg",
    "T-62": "/flags/T-62.svg",
    "T-63": "/flags/T-63.svg",
    "T-64": "/flags/T-64.svg",
    "T-65": "/flags/T-65.svg",
    "T-66": "/flags/T-66.svg",
    "T-67": "/flags/T-67.svg",
    "T-68": "/flags/T-68.svg",
    "T-69": "/flags/T-69.svg",
    "T-70": "/flags/T-70.svg",
    "T-71": "/flags/T-71.svg",
    "T-72": "/flags/T-72.svg",
    "T-73": "/flags/T-73.svg",
    "T-74": "/flags/T-74.svg",
    "T-75": "/flags/T-75.svg",
    "T-76": "/flags/T-76.svg",
    "T-77": "/flags/T-77.svg",
    "T-78": "/flags/T-78.svg",
    "T-79": "/flags/T-79.svg",
    "T-80": "/flags/T-80.svg",
    "T-81": "/flags/T-81.svg",
    "T-82": "/flags/T-82.svg",
    "T-83": "/flags/T-83.svg",
    "T-84": "/flags/T-84.svg",
    "T-85": "/flags/T-85.svg",
    "T-86": "/flags/T-86.svg",
    "T-87": "/flags/T-87.svg",
    "T-88": "/flags/T-88.svg",
    "T-W26-1": "/flags/T-W26-1.svg",
    "T-W26-2": "/flags/T-W26-2.svg",
    "T-W26-3": "/flags/T-W26-3.svg",
    "T-W26-4": "/flags/T-W26-4.svg",
    "T-W26-5": "/flags/T-W26-5.svg",
  });

/**
 * Resolve the public flag SVG URL for a runtime `nation_id`. Returns `null` if
 * no asset is bundled (defensive fallback only — every draft-pool nation
 * MUST have a flag; coverage is pinned by `flags.test.ts`).
 */
export function flagSrcForNationId(nationId: string): string | null {
  return FLAG_SRC_BY_NATION_ID[nationId] ?? null;
}

/** Read-only view of the full mapping (exported for tests). */
export function allMappedNationIds(): readonly string[] {
  return Object.keys(FLAG_SRC_BY_NATION_ID);
}
