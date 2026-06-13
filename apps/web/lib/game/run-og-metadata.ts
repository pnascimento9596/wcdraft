import type { RunRecordVersions } from "./data";
import {
  decodeRunToken,
  runTokenOgSummary,
  versionsAgree,
  type RunTokenOgSummary,
} from "./run-token";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_IMAGE_ALT } from "../site-metadata";

export const RUN_OG_IMAGE_ROUTE = "/api/og/run" as const;
export const RUN_OG_WIDTH = 1200 as const;
export const RUN_OG_HEIGHT = 630 as const;

export interface RunOgImageDescriptor {
  url: string;
  width: typeof RUN_OG_WIDTH;
  height: typeof RUN_OG_HEIGHT;
  alt: string;
  dynamic: boolean;
}

export function defaultRunOgImage(): RunOgImageDescriptor {
  return {
    url: OG_DEFAULT_IMAGE,
    width: RUN_OG_WIDTH,
    height: RUN_OG_HEIGHT,
    alt: OG_DEFAULT_IMAGE_ALT,
    dynamic: false,
  };
}

export function buildRunOgCacheKey(
  versions: RunRecordVersions,
  env: Record<string, string | undefined> = process.env,
): string {
  const deploy =
    env.WCDRAFT_DEPLOY_REVISION ??
    env.VERCEL_GIT_COMMIT_SHA ??
    env.VERCEL_DEPLOYMENT_ID ??
    env.VERCEL_URL ??
    "dev";
  const bundleHash = versions.data_bundle_hash
    .split("+")
    .map((part) => part.slice(0, 12))
    .join(".");
  return `${deploy}.${bundleHash}`.replace(/[^A-Za-z0-9_.-]/gu, "-").slice(0, 96);
}

export function buildRunOgImagePath(runValue: string, cacheKey: string): string {
  const params = new URLSearchParams({ run: runValue, v: cacheKey });
  return `${RUN_OG_IMAGE_ROUTE}?${params.toString()}`;
}

export function shareOgImageForRunValue(
  runValue: string | string[] | null | undefined,
  currentVersions: RunRecordVersions,
  env: Record<string, string | undefined> = process.env,
): RunOgImageDescriptor {
  const value = typeof runValue === "string" ? runValue : null;
  if (!value) return defaultRunOgImage();

  const decoded = decodeRunToken(value);
  if (!decoded || decoded.v !== 2 || !versionsAgree(decoded, currentVersions)) {
    return defaultRunOgImage();
  }

  const summary = runTokenOgSummary(decoded);
  if (!summary) return defaultRunOgImage();

  const cacheKey = buildRunOgCacheKey(currentVersions, env);
  return {
    url: buildRunOgImagePath(value, cacheKey),
    width: RUN_OG_WIDTH,
    height: RUN_OG_HEIGHT,
    alt: runOgAltText(decoded.tn, decoded.md, summary),
    dynamic: true,
  };
}

export function formatRunOgResult(summary: RunTokenOgSummary): string {
  const record = `${summary.w}-${summary.l}`;
  if (summary.ch && summary.w === 8 && summary.l === 0 && summary.mp === 8) {
    return `${record} - PERFECT`;
  }
  if (summary.ch) return `${record}, CHAMPIONS`;
  return `${record}, ${shortRoundLabel(summary.rr)}`;
}

export function shortRoundLabel(round: RunTokenOgSummary["rr"]): string {
  switch (round) {
    case "G1":
    case "G2":
    case "G3":
      return "GROUP";
    case "F":
      return "FINAL";
    default:
      return round;
  }
}

function runOgAltText(
  teamName: string,
  mode: "classic" | "hidden",
  summary: RunTokenOgSummary,
): string {
  const modeLabel = mode === "hidden" ? "Memory" : "Classic";
  return `wcdraft run preview for ${truncate(teamName, 48)}: ${formatRunOgResult(summary)} in ${modeLabel}`;
}

function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}
