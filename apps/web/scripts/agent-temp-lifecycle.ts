import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export const AGENT_TEMP_CLEANUP_MARKER = ".wcdraft-agent-cleanup-ready";
export const AGENT_TEMP_CLEANUP_MARKER_VALUE = "cleanup-ready-v1";

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

export async function markAgentTempCleanupReady(
  candidate: string,
  configuredRoot?: string,
): Promise<void> {
  const configuredRoots = configuredRoot
    ? [configuredRoot]
    : process.env.WCDRAFT_AGENT_TEMP_ROOT
      ? [process.env.WCDRAFT_AGENT_TEMP_ROOT]
      : ["/private/tmp", tmpdir()];
  const roots = [
    ...new Set(await Promise.all(configuredRoots.map(async (root) => realpath(root)))),
  ];
  const candidateStats = await lstat(candidate);
  if (!candidateStats.isDirectory() || candidateStats.isSymbolicLink()) {
    throw new Error(`cleanup-ready candidate must be a real directory: ${candidate}`);
  }
  const resolvedCandidate = await realpath(candidate);
  if (!roots.includes(path.dirname(resolvedCandidate))) {
    throw new Error(
      `cleanup-ready candidate must be a direct child of ${roots.join(" or ")}: ${candidate}`,
    );
  }
  if (!/^(?:wcdraft|terrace|wave2)-/u.test(path.basename(resolvedCandidate))) {
    throw new Error(`cleanup-ready candidate has an unsupported lifecycle prefix: ${candidate}`);
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
}
