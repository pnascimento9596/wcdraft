import { decodeRunToken, type RunTokenOgSummary } from "./run-token";
import { isLikelySignedRunOg, SIGNED_RUN_OG_PREFIX, SIGNED_RUN_OG_VERSION } from "./run-og-signing";
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

export function buildRunOgCacheKey(tokenHash: string, signedModelVersion: number): string {
  if (!/^[0-9a-f]{64}$/u.test(tokenHash) || !Number.isSafeInteger(signedModelVersion)) {
    return "invalid";
  }
  return `ogs${signedModelVersion.toString()}.${tokenHash.slice(0, 32)}`;
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
): RunOgImageDescriptor {
  void currentVersions;
  const value = typeof runValue === "string" ? runValue : null;
  const signed = typeof signedValue === "string" ? signedValue : null;
  if (!value) return defaultRunOgImage();
  if (!signed || !isLikelySignedRunOg(signed)) return defaultRunOgImage();

  const decoded = decodeRunToken(value);
  if (!decoded || (decoded.v !== 3 && decoded.v !== 4)) {
    return defaultRunOgImage();
  }
  const signedHint = readSignedRunOgCacheHint(signed);
  if (!signedHint) return defaultRunOgImage();

  const cacheKey = buildRunOgCacheKey(signedHint.tokenHash, signedHint.version);
  return {
    url: buildRunOgImagePath(value, signed, cacheKey),
    width: RUN_OG_WIDTH,
    height: RUN_OG_HEIGHT,
    alt: "Verified wcdraft run preview",
    dynamic: true,
  };
}

function readSignedRunOgCacheHint(value: string): { tokenHash: string; version: number } | null {
  if (!isLikelySignedRunOg(value)) return null;
  const rest = value.slice(SIGNED_RUN_OG_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = rest.slice(0, dot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const payload = parsed as Record<string, unknown>;
  if (payload.v !== SIGNED_RUN_OG_VERSION) return null;
  const tokenHash = payload.token_hash;
  if (typeof tokenHash !== "string" || !/^[0-9a-f]{64}$/u.test(tokenHash)) return null;
  return { tokenHash, version: payload.v };
}

function base64UrlDecodeToString(value: string): string {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
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
