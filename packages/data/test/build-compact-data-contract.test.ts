import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_URL = pathToFileURL(path.resolve(TEST_DIR, "../scripts/build-compact-data.mjs")).href;

describe("build-compact-data contract", () => {
  it("throws instead of deriving dataset_version from a silent zero fallback", () => {
    const probe = `
      import { deriveDatasetVersion } from ${JSON.stringify(SCRIPT_URL)};
      try {
        deriveDatasetVersion({});
        process.stdout.write("NO_THROW");
      } catch (err) {
        process.stdout.write(err instanceof Error ? err.message : String(err));
      }
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
      encoding: "utf8",
    });
    expect(out).toMatch(/cannot derive dataset_version/u);
    expect(out).toMatch(/Pass --dataset-version explicitly/u);
  });
});
