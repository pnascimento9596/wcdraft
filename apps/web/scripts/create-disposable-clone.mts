import { existsSync } from "node:fs";
import { appendFile, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  AGENT_TEMP_CLEANUP_MARKER,
  AGENT_TEMP_PENDING_MARKER,
  registerAgentTempCleanupPending,
} from "./agent-temp-lifecycle";

interface Options {
  branch?: string;
  label: string;
  ref: string;
  source?: string;
}

function parseArgs(args: string[]): Options {
  const options: Partial<Options> = { ref: "HEAD" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${flag}`);
    }
    if (flag === "--label" || flag === "--ref" || flag === "--source" || flag === "--branch") {
      options[flag.slice(2) as keyof Options] = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${flag}`);
  }
  if (!options.label || !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(options.label)) {
    throw new Error("--label must match [a-z0-9][a-z0-9-]{0,47}");
  }
  if (!options.ref || options.ref.startsWith("-")) {
    throw new Error("--ref must be non-empty and must not begin with '-'");
  }
  if (options.branch?.startsWith("-")) {
    throw new Error("--branch must not begin with '-'");
  }
  if (options.source?.startsWith("-")) {
    throw new Error("--source must not begin with '-'");
  }
  return options as Options;
}

function runGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git ${args[0] ?? ""} exited ${code ?? "without a status"}`));
      }
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = await runGit(["rev-parse", "--show-toplevel"]);
const configuredRoot =
  process.env.WCDRAFT_AGENT_TEMP_ROOT ?? (existsSync("/private/tmp") ? "/private/tmp" : tmpdir());
const root = await realpath(configuredRoot);
const candidate = await mkdtemp(path.join(root, `wcdraft-${options.label}-`));
await registerAgentTempCleanupPending(candidate, root);

const markComplete = [
  `WCDRAFT_AGENT_TEMP_ROOT=${shellQuote(root)}`,
  "pnpm --dir",
  shellQuote(repoRoot),
  "--filter @wcdraft/web mark:agent-temp-cleanup-ready",
  shellQuote(candidate),
].join(" ");

try {
  const source =
    options.source ??
    (await runGit(["-C", repoRoot, "remote", "get-url", "origin"]).catch(() => repoRoot));
  await runGit(["init", "--initial-branch=main", candidate]);
  await appendFile(
    path.join(candidate, ".git", "info", "exclude"),
    `${AGENT_TEMP_PENDING_MARKER}\n${AGENT_TEMP_CLEANUP_MARKER}\n`,
    "utf8",
  );
  await runGit(["-C", candidate, "remote", "add", "origin", source]);
  await runGit([
    "-C",
    candidate,
    "fetch",
    "--filter=blob:none",
    "--no-tags",
    "origin",
    options.ref,
  ]);
  if (options.branch) {
    await runGit(["-C", candidate, "checkout", "-b", options.branch, "FETCH_HEAD"]);
  } else {
    await runGit(["-C", candidate, "checkout", "--detach", "FETCH_HEAD"]);
  }
  console.log(`DISPOSABLE_CLONE_PATH=${candidate}`);
  console.log(`MARK_COMPLETE_COMMAND=${markComplete}`);
} catch (error) {
  console.error(
    `agent-temp-lifecycle: clone creation failed; registered residue preserved at ${candidate}`,
  );
  console.error(`DISPOSABLE_CLONE_PATH=${candidate}`);
  console.error(`MARK_COMPLETE_COMMAND=${markComplete}`);
  throw error;
}
