import { decodeRunToken, versionsAgree, type RunTokenOgSummary } from "./run-token";
import { isLikelySignedRunOg } from "./run-og-signing";
import { RUN_OG_HEIGHT, RUN_OG_IMAGE_ROUTE, RUN_OG_WIDTH } from "./run-og-constants";
import type { RunRecordVersions } from "./versions";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_IMAGE_ALT } from "../site-metadata";

export { RUN_OG_HEIGHT, RUN_OG_IMAGE_ROUTE, RUN_OG_WIDTH } from "./run-og-constants";

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

export function buildRunOgImagePath(
  runValue: string,
  signedValue: string,
  cacheKey: string,
): string {
  const params = new URLSearchParams({ run: runValue, og: signedValue, v: cacheKey });
  return `${RUN_OG_IMAGE_ROUTE}?${params.toString()}`;
}

export function shareOgImageForRunValue(
  runValue: string | string[] | null | undefined,
  signedValue: string | string[] | null | undefined,
  currentVersions: RunRecordVersions,
  env: Record<string, string | undefined> = process.env,
): RunOgImageDescriptor {
  const value = typeof runValue === "string" ? runValue : null;
  const signed = typeof signedValue === "string" ? signedValue : null;
  if (!value) return defaultRunOgImage();
  if (!signed || !isLikelySignedRunOg(signed)) return defaultRunOgImage();

  const decoded = decodeRunToken(value);
  if (!decoded || decoded.v !== 3 || !versionsAgree(decoded, currentVersions)) {
    return defaultRunOgImage();
  }

  const cacheKey = buildRunOgCacheKey(currentVersions, env);
  return {
    url: buildRunOgImagePath(value, signed, cacheKey),
    width: RUN_OG_WIDTH,
    height: RUN_OG_HEIGHT,
    alt: "Verified wcdraft run preview",
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
