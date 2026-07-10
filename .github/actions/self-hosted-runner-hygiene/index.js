const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const isPost = process.env.STATE_wcdraftRunnerHygiene === "registered";
const phase = isPost ? "finish" : "start";
const script = join(process.env.GITHUB_WORKSPACE, "scripts/ci/self-hosted-runner-hygiene.sh");
const result = spawnSync("/bin/bash", [script, phase], { stdio: "inherit" });

if (!isPost) {
  appendFileSync(process.env.GITHUB_STATE, "wcdraftRunnerHygiene=registered\n", {
    encoding: "utf8",
  });
  const cacheRoot = join(process.env.RUNNER_TOOL_CACHE, "wcdraft-cache");
  appendFileSync(
    process.env.GITHUB_ENV,
    [
      `PLAYWRIGHT_BROWSERS_PATH=${join(cacheRoot, "ms-playwright")}`,
      `PNPM_CONFIG_STORE_DIR=${join(cacheRoot, "pnpm-store")}`,
      `UV_CACHE_DIR=${join(cacheRoot, "uv")}`,
      "",
    ].join("\n"),
    { encoding: "utf8" },
  );
}

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
