import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export const AGENT_TEMP_CLEANUP_MARKER = ".wcdraft-agent-cleanup-ready";
export const AGENT_TEMP_CLEANUP_MARKER_VALUE = "cleanup-ready-v1";
export const AGENT_TEMP_PENDING_MARKER = ".wcdraft-agent-cleanup-pending";
export const AGENT_TEMP_PENDING_MARKER_VALUE = "cleanup-pending-v1";

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function resolveAgentTempRoots(configuredRoot?: string): Promise<string[]> {
  const configuredRoots: string[] = [];
  if (configuredRoot) {
    configuredRoots.push(configuredRoot);
  } else if (process.env.WCDRAFT_AGENT_TEMP_ROOT) {
    configuredRoots.push(process.env.WCDRAFT_AGENT_TEMP_ROOT);
  } else {
    // macOS host uses /private/tmp; Linux CI/containers use os.tmpdir().
    try {
      await realpath("/private/tmp");
      configuredRoots.push("/private/tmp");
    } catch {
      // absent on Linux
    }
    configuredRoots.push(tmpdir());
  }
  const resolved: string[] = [];
  for (const root of configuredRoots) {
    try {
      resolved.push(await realpath(root));
    } catch {
      // skip missing roots rather than failing the whole resolver
    }
  }
  if (resolved.length === 0) {
    resolved.push(await realpath(tmpdir()));
  }
  return [...new Set(resolved)];
}

async function validateAgentTempCandidate(
  candidate: string,
  configuredRoot?: string,
): Promise<string> {
  const roots = await resolveAgentTempRoots(configuredRoot);
  const candidateStats = await lstat(candidate);
  if (!candidateStats.isDirectory() || candidateStats.isSymbolicLink()) {
    throw new Error(`agent-temp candidate must be a real directory: ${candidate}`);
  }
  const resolvedCandidate = await realpath(candidate);
  if (!roots.includes(path.dirname(resolvedCandidate))) {
    throw new Error(
      `agent-temp candidate must be a direct child of ${roots.join(" or ")}: ${candidate}`,
    );
  }
  if (!/^(?:wcdraft|terrace|wave2)-/u.test(path.basename(resolvedCandidate))) {
    throw new Error(`agent-temp candidate has an unsupported lifecycle prefix: ${candidate}`);
  }
  return resolvedCandidate;
}

export async function registerAgentTempCleanupPending(
  candidate: string,
  configuredRoot?: string,
): Promise<void> {
  const resolvedCandidate = await validateAgentTempCandidate(candidate, configuredRoot);
  const marker = path.join(resolvedCandidate, AGENT_TEMP_PENDING_MARKER);
  await writeFile(marker, `${AGENT_TEMP_PENDING_MARKER_VALUE}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function markAgentTempCleanupReady(
  candidate: string,
  configuredRoot?: string,
): Promise<void> {
  const resolvedCandidate = await validateAgentTempCandidate(candidate, configuredRoot);
  const pendingMarker = path.join(resolvedCandidate, AGENT_TEMP_PENDING_MARKER);
  let hasPendingMarker = false;
  try {
    const pendingStats = await lstat(pendingMarker);
    if (!pendingStats.isFile() || pendingStats.isSymbolicLink()) {
      throw new Error(`cleanup-pending marker must be a regular file: ${pendingMarker}`);
    }
    const pending = (await readFile(pendingMarker, "utf8")).replace(/\n+$/u, "");
    if (pending !== AGENT_TEMP_PENDING_MARKER_VALUE) {
      throw new Error(`cleanup-pending marker has an unexpected value: ${pendingMarker}`);
    }
    hasPendingMarker = true;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const marker = path.join(resolvedCandidate, AGENT_TEMP_CLEANUP_MARKER);
  try {
    await writeFile(marker, `${AGENT_TEMP_CLEANUP_MARKER_VALUE}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const markerStats = await lstat(marker);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      throw new Error(`cleanup-ready marker must be a regular file: ${marker}`, { cause: error });
    }
    const existing = (await readFile(marker, "utf8")).replace(/\n+$/u, "");
    if (existing !== AGENT_TEMP_CLEANUP_MARKER_VALUE) {
      throw new Error(`cleanup-ready marker has an unexpected value: ${marker}`, { cause: error });
    }
  }

  if (hasPendingMarker) {
    await unlink(pendingMarker);
  }
}
