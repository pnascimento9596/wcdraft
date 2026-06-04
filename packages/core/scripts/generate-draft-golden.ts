/**
 * Regenerate the golden DRAFT fixture (WS-C).
 *
 * Run via the package script (uses tsx, no build step required):
 *   pnpm --filter @wcdraft/core run gen:golden:draft
 *
 * Writes test/fixtures/draft-golden.json — the recorded, byte-stable output of
 * `autoDraft` over the deterministic `buildDraftFixture()` squad set. The golden
 * test (src/draft.golden.test.ts) RE-DERIVES the draft from the same fixture and
 * deep-equals it against this committed recording; it never self-compares.
 *
 * Only regenerate INTENTIONALLY when the draft engine's deterministic output is
 * deliberately changed — a diff here means the 17-spin sequence drifted, which
 * must be reviewed (and, for a shipped engine, would bump engine_version).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { autoDraft } from "../src/index.ts";
import { buildDraftFixture } from "../src/draft.fixture.ts";

const { dataset, params } = buildDraftFixture();
const draft = autoDraft({ ...params, dataset });

const fixture = {
  _comment:
    "GOLDEN FIXTURE — recorded deterministic output of @wcdraft/core autoDraft over buildDraftFixture(). Do not hand-edit; regenerate via scripts/generate-draft-golden.ts only when the draft engine's deterministic output intentionally changes.",
  draft,
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "test", "fixtures", "draft-golden.json");
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");
console.log(`wrote ${outPath}`);
