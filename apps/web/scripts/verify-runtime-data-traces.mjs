#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SERVER_RUNTIME_DATA_SCHEMA_VERSION,
  SERVER_RUNTIME_DATA_TRACE_ROUTES,
} from "./runtime-data-trace-contract.mjs";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DATA_DIR = join(
  WEB_ROOT,
  "public",
  "data",
  "wcdraft",
  SERVER_RUNTIME_DATA_SCHEMA_VERSION,
);

function filesBelow(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

const expectedFiles = filesBelow(RUNTIME_DATA_DIR);
if (expectedFiles.length === 0) {
  throw new Error(`runtime-data trace verification: no files found in ${RUNTIME_DATA_DIR}`);
}

for (const route of SERVER_RUNTIME_DATA_TRACE_ROUTES) {
  const tracePath = join(WEB_ROOT, ".next", "server", "app", route.slice(1), "route.js.nft.json");
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));
  if (!Array.isArray(trace.files)) {
    throw new Error(`runtime-data trace verification: ${tracePath} has no files array`);
  }

  const tracedFiles = new Set(trace.files.map((file) => resolve(dirname(tracePath), file)));
  const missing = expectedFiles.filter((file) => !tracedFiles.has(file));
  if (missing.length > 0) {
    throw new Error(
      `runtime-data trace verification: ${route} is missing ${missing.length} file(s):\n` +
        missing.map((file) => `- ${relative(WEB_ROOT, file)}`).join("\n"),
    );
  }

  process.stdout.write(
    `runtime-data trace verification: ${route} includes ${expectedFiles.length}/${expectedFiles.length} ` +
      `${SERVER_RUNTIME_DATA_SCHEMA_VERSION} file(s)\n`,
  );
}
