#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
const claude = readFileSync(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");

if (agents !== claude) {
  process.stderr.write(
    "AGENTS.md and CLAUDE.md drifted. Keep the operating contract byte-identical or intentionally replace the drift check.\n",
  );
  process.exit(1);
}

process.stdout.write("check-agent-contracts: ok\n");
