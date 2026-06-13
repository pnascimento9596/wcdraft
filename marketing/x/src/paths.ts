// Filesystem anchors for the marketing/x package. Everything the poster
// reads (features manifest, content queue) or writes (ledger, dry-run
// artifacts) is resolved relative to the package root so the CLI behaves the
// same from any cwd (local shell, vitest, GitHub Actions).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** marketing/x/ — `src/paths.ts` sits one level below the package root. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const FEATURES_PATH = resolve(PACKAGE_ROOT, "features.json");
export const QUEUE_DIR = resolve(PACKAGE_ROOT, "queue");
export const LEDGER_DIR = resolve(PACKAGE_ROOT, "ledger");
export const LEDGER_PATH = resolve(LEDGER_DIR, "posts.ledger.jsonl");
export const ENGAGEMENT_LEDGER_PATH = resolve(LEDGER_DIR, "engagement.ledger.jsonl");
export const ARTIFACTS_DIR = resolve(PACKAGE_ROOT, "artifacts");
export const FIXTURES_DIR = resolve(PACKAGE_ROOT, "src", "__tests__", "fixtures");
