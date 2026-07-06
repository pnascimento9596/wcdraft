import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));
const nextBin = require.resolve("next/dist/bin/next");
const tsxBin = require.resolve("tsx/cli");
const copyWebAssetsScript = fileURLToPath(
  new URL("../../../packages/data/scripts/copy-web-assets.mjs", import.meta.url),
);
const host = "127.0.0.1";

const shellSurfaces = [
  "daily-spin",
  "spin-stage",
  "position-target",
  "classic-pick",
  "open-roster-pick",
  "blind-open-roster-pick",
  "squad-review",
].join(",");

type AuditMetric = {
  readonly shellRule?: boolean;
  readonly noScrollGate?: "pass" | "fail" | "n-a";
  readonly horizontalOverflow?: boolean;
  readonly axeViolations?: readonly unknown[];
  readonly navWraps?: readonly unknown[];
  readonly consoleErrors?: readonly unknown[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      assert(address && typeof address === "object", "failed to allocate test server port");
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function snapshotFile(
  filePath: string,
): Promise<{ path: string; contents: Uint8Array | null }> {
  try {
    return { path: filePath, contents: await readFile(filePath) };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { path: filePath, contents: null };
    }
    throw err;
  }
}

async function restoreFile(snapshot: { path: string; contents: Uint8Array | null }): Promise<void> {
  if (snapshot.contents === null) {
    await rm(snapshot.path, { force: true });
    return;
  }
  await writeFile(snapshot.path, snapshot.contents);
}

async function stopProcess(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => proc.once("exit", () => resolve())),
    delay(5_000).then(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }),
  ]);
}

async function waitForServer(baseUrl: string, proc: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError = "server did not respond";
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Next dev server exited early with code ${proc.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/play`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Next dev server: ${lastError}`);
}

async function startNextDev(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await findFreePort();
  const baseUrl = `http://${host}:${port}`;
  const nextEnvSnapshot = await snapshotFile(nextEnvPath);
  let restoredNextEnv = false;
  const restoreNextEnv = async () => {
    if (restoredNextEnv) return;
    restoredNextEnv = true;
    await restoreFile(nextEnvSnapshot);
  };
  const proc = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", host, "--port", String(port)],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        LEADERBOARD_ENABLED: process.env.LEADERBOARD_ENABLED ?? "1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const append = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString()}`.slice(-12_000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  await waitForServer(baseUrl, proc).catch(async (err) => {
    await stopProcess(proc);
    await restoreNextEnv();
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n\n${logs}`);
  });
  return {
    baseUrl,
    stop: async () => {
      await stopProcess(proc);
      await restoreNextEnv();
    },
  };
}

async function copyWebAssets(): Promise<void> {
  const proc = spawn(process.execPath, [copyWebAssetsScript], {
    cwd: appRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-12_000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  const code = await new Promise<number | null>((resolve) => proc.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`copy-web-assets failed with code ${code}\n\n${output}`);
  }
}

async function runAudit(opts: {
  baseUrl: string;
  phase: string;
  viewports: string;
}): Promise<{ metrics: number; failures: number; outDir: string }> {
  const outDir = await mkdtemp(path.join(tmpdir(), `wcdraft-${opts.phase}-`));
  const proc = spawn(process.execPath, [tsxBin, "scripts/verify-responsive-layout-browser.mts"], {
    cwd: appRoot,
    env: {
      ...process.env,
      BASE_URL: opts.baseUrl,
      WCDRAFT_RESPONSIVE_OUT_DIR: outDir,
      WCDRAFT_RESPONSIVE_PHASE: opts.phase,
      WCDRAFT_RESPONSIVE_STRICT: "1",
      WCDRAFT_RESPONSIVE_SURFACES: shellSurfaces,
      WCDRAFT_RESPONSIVE_VIEWPORTS: opts.viewports,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-20_000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  const code = await new Promise<number | null>((resolve) => proc.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`responsive shell audit ${opts.phase} failed with code ${code}\n\n${output}`);
  }
  const resultPath = path.join(outDir, `responsive-${opts.phase}.json`);
  const result = JSON.parse(await readFile(resultPath, "utf8")) as {
    metrics: AuditMetric[];
  };
  const failures = result.metrics.filter((metric) => {
    if (metric.shellRule === true && metric.noScrollGate !== "pass") return true;
    if (metric.horizontalOverflow === true) return true;
    if ((metric.axeViolations?.length ?? 0) > 0) return true;
    if ((metric.navWraps?.length ?? 0) > 0) return true;
    if ((metric.consoleErrors?.length ?? 0) > 0) return true;
    return false;
  }).length;
  return { metrics: result.metrics.length, failures, outDir };
}

await copyWebAssets();
const server = await startNextDev();
try {
  const desktop = await runAudit({
    baseUrl: server.baseUrl,
    phase: "ci-desktop-shell",
    viewports: "1280x800,1440x900,1512x982,1920x1080",
  });
  const mobile = await runAudit({
    baseUrl: server.baseUrl,
    phase: "ci-mobile-shell",
    viewports: "390x844,360x800",
  });
  console.log(
    [
      `responsive-shell-fit: ok`,
      `desktop metrics=${desktop.metrics} failures=${desktop.failures} out=${desktop.outDir}`,
      `mobile metrics=${mobile.metrics} failures=${mobile.failures} out=${mobile.outDir}`,
    ].join(" - "),
  );
} finally {
  await server.stop();
}
