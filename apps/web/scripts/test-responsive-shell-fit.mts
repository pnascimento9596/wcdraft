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
const interactionSurfaces = ["home", "results", "share-author", "history", "settings"].join(",");
const modeSetupSurfaces = [
  "mode-select-checking",
  "mode-select-available",
  "mode-select-unavailable",
  "mode-select-timeout",
  "draft-setup",
].join(",");
const mobileNavSurfaces = "mobile-menu-open";

type ProcessExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly at: string;
  readonly expected: boolean;
};

type NextDevServer = {
  readonly baseUrl: string;
  readonly exited: Promise<ProcessExit>;
  readonly persistDiagnostics: (outDir: string) => Promise<{
    readonly logPath: string;
    readonly exitPath: string;
  }>;
  readonly stop: () => Promise<void>;
};

type AuditMetric = {
  readonly surface?: string;
  readonly shellRule?: boolean;
  readonly noScrollGate?: "pass" | "fail" | "n-a";
  readonly horizontalOverflow?: boolean;
  readonly modeDockInitialClearance?: number | null;
  readonly modeDockTerminalClearance?: number | null;
  readonly axeViolations?: readonly unknown[];
  readonly navWraps?: readonly unknown[];
  readonly smallTargets?: readonly unknown[];
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

async function waitForProcessExit(
  proc: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      proc.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    proc.once("exit", onExit);
  });
}

async function stopProcess(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  if (await waitForProcessExit(proc, 5_000)) return;
  proc.kill("SIGKILL");
  if (!(await waitForProcessExit(proc, 5_000))) {
    throw new Error(
      `child process ${proc.pid?.toString() ?? "unknown"} did not exit after SIGKILL`,
    );
  }
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

async function startNextDev(): Promise<NextDevServer> {
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
  let stopRequested = false;
  let exitState: ProcessExit | null = null;
  const diagnosticDirs = new Set<string>();
  const append = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString()}`.slice(-200_000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  const exited = new Promise<ProcessExit>((resolve) => {
    proc.once("exit", (code, signal) => {
      exitState = {
        code,
        signal,
        at: new Date().toISOString(),
        expected: stopRequested,
      };
      resolve(exitState);
    });
  });
  await waitForServer(baseUrl, proc).catch(async (err) => {
    await stopProcess(proc);
    await restoreNextEnv();
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n\n${logs}`);
  });
  const persistDiagnostics = async (outDir: string) => {
    diagnosticDirs.add(outDir);
    const logPath = path.join(outDir, "next-server.log");
    const exitPath = path.join(outDir, "next-server-exit.json");
    await writeFile(logPath, logs);
    await writeFile(
      exitPath,
      JSON.stringify(
        {
          pid: proc.pid ?? null,
          status: exitState ? "exited" : "running",
          exitCode: exitState?.code ?? null,
          signal: exitState?.signal ?? null,
          expected: exitState?.expected ?? null,
          exitedAt: exitState?.at ?? null,
          capturedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return { logPath, exitPath };
  };
  return {
    baseUrl,
    exited,
    persistDiagnostics,
    stop: async () => {
      stopRequested = true;
      try {
        await stopProcess(proc);
        await Promise.all(
          Array.from(diagnosticDirs, async (outDir) => await persistDiagnostics(outDir)),
        );
      } finally {
        await restoreNextEnv();
      }
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
  server: NextDevServer;
  phase: string;
  surfaces: string;
  viewports: string;
}): Promise<{ metrics: number; failures: number; outDir: string }> {
  const outDir = await mkdtemp(path.join(tmpdir(), `wcdraft-${opts.phase}-`));
  const proc = spawn(process.execPath, [tsxBin, "scripts/verify-responsive-layout-browser.mts"], {
    cwd: appRoot,
    env: {
      ...process.env,
      BASE_URL: opts.server.baseUrl,
      WCDRAFT_RESPONSIVE_OUT_DIR: outDir,
      WCDRAFT_RESPONSIVE_PHASE: opts.phase,
      WCDRAFT_RESPONSIVE_STRICT: "1",
      WCDRAFT_RESPONSIVE_DEV_SERVER: "1",
      WCDRAFT_HIDE_DEV_OVERLAY: "1",
      WCDRAFT_RESPONSIVE_SURFACES: opts.surfaces,
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
  const auditExited = new Promise<number | null>((resolve) => proc.once("exit", resolve));
  const outcome = await Promise.race([
    auditExited.then((code) => ({ kind: "audit" as const, code })),
    opts.server.exited.then((exit) => ({ kind: "server" as const, exit })),
  ]);
  if (outcome.kind === "server") {
    await stopProcess(proc);
    const diagnostics = await opts.server.persistDiagnostics(outDir);
    throw new Error(
      [
        `Next dev server exited during responsive audit ${opts.phase}`,
        `exit code=${String(outcome.exit.code)} signal=${String(outcome.exit.signal)}`,
        `server log=${diagnostics.logPath}`,
        `server exit=${diagnostics.exitPath}`,
        output,
      ].join("\n\n"),
    );
  }
  const diagnostics = await opts.server.persistDiagnostics(outDir);
  const code = outcome.code;
  if (code !== 0) {
    throw new Error(
      [
        `responsive shell audit ${opts.phase} failed with code ${String(code)}`,
        `server log=${diagnostics.logPath}`,
        `server exit=${diagnostics.exitPath}`,
        output,
      ].join("\n\n"),
    );
  }
  const resultPath = path.join(outDir, `responsive-${opts.phase}.json`);
  const result = JSON.parse(await readFile(resultPath, "utf8")) as {
    metrics: AuditMetric[];
  };
  const failures = result.metrics.filter((metric) => {
    if (metric.shellRule === true && metric.noScrollGate !== "pass") return true;
    if (metric.horizontalOverflow === true) return true;
    if (metric.surface?.startsWith("mode-select") === true) {
      if (metric.modeDockInitialClearance === null) return true;
      if (metric.modeDockTerminalClearance === null) return true;
      if ((metric.modeDockInitialClearance ?? 0) < 0) return true;
      if ((metric.modeDockTerminalClearance ?? 0) < 0) return true;
    }
    if ((metric.axeViolations?.length ?? 0) > 0) return true;
    if ((metric.navWraps?.length ?? 0) > 0) return true;
    if ((metric.smallTargets?.length ?? 0) > 0) return true;
    if ((metric.consoleErrors?.length ?? 0) > 0) return true;
    return false;
  }).length;
  return { metrics: result.metrics.length, failures, outDir };
}

await copyWebAssets();
const server = await startNextDev();
try {
  const desktop = await runAudit({
    server,
    phase: "ci-desktop-shell",
    surfaces: shellSurfaces,
    viewports: "1024x768,1280x800,1366x768,1440x900,1512x982,1920x1080",
  });
  const mobile = await runAudit({
    server,
    phase: "ci-mobile-shell",
    surfaces: shellSurfaces,
    viewports: "360x800,390x844,667x375,768x1024",
  });
  const interactions = await runAudit({
    server,
    phase: "ci-interaction-targets",
    surfaces: interactionSurfaces,
    viewports: "667x375,768x1024,1024x768,1366x768",
  });
  const modeSetup = await runAudit({
    server,
    phase: "ci-mode-setup",
    surfaces: modeSetupSurfaces,
    viewports: "360x800,390x844,667x375",
  });
  const mobileNav = await runAudit({
    server,
    phase: "ci-mobile-nav",
    surfaces: mobileNavSurfaces,
    viewports: "360x800,390x844,667x375,768x1024",
  });
  console.log(
    [
      `responsive-shell-fit: ok`,
      `desktop metrics=${desktop.metrics} failures=${desktop.failures} out=${desktop.outDir}`,
      `mobile metrics=${mobile.metrics} failures=${mobile.failures} out=${mobile.outDir}`,
      `interactions metrics=${interactions.metrics} failures=${interactions.failures} out=${interactions.outDir}`,
      `mode-setup metrics=${modeSetup.metrics} failures=${modeSetup.failures} out=${modeSetup.outDir}`,
      `mobile-nav metrics=${mobileNav.metrics} failures=${mobileNav.failures} out=${mobileNav.outDir}`,
    ].join(" - "),
  );
} finally {
  await server.stop();
}
