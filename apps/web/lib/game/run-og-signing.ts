import type { RunOgModel } from "./run-og-model";
import type { RunRecordVersions } from "./versions";

export const RUN_OG_SIGNING_SECRET_ENV = "WCDRAFT_OG_SIGNING_SECRET" as const;
export const SIGNED_RUN_OG_PREFIX = "ogs1." as const;
export const SIGNED_RUN_OG_MAX_LEN = 12000 as const;

export interface SignedRunOgPayload {
  v: 1;
  token_hash: string;
  versions: RunRecordVersions;
  model: RunOgModel;
}

const HEX_64 = /^[0-9a-f]{64}$/u;
const TEXT_MAX = 160;
const LABEL_MAX = 64;

export function hasUsableOgSigningSecret(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return usableSecret(env[RUN_OG_SIGNING_SECRET_ENV]) !== null;
}

export function readOgSigningSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return usableSecret(env[RUN_OG_SIGNING_SECRET_ENV]);
}

function usableSecret(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  // HMAC accepts any byte string, but short secrets invite offline guessing if
  // a signed URL leaks. Keep the same practical floor as the auth cookie helper.
  return trimmed.length >= 32 ? trimmed : null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signRunOgPayload(
  payload: SignedRunOgPayload,
  secret: string,
): Promise<string> {
  const normalized = assertSignedRunOgPayload(payload);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(normalized));
  const payloadB64 = base64UrlEncode(payloadBytes);
  const sig = await hmac(payloadB64, secret);
  return `${SIGNED_RUN_OG_PREFIX}${payloadB64}.${base64UrlEncode(sig)}`;
}

export async function verifySignedRunOgPayload(
  value: string,
  secret: string,
): Promise<SignedRunOgPayload | null> {
  if (!isLikelySignedRunOg(value)) return null;
  const rest = value.slice(SIGNED_RUN_OG_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0 || dot === rest.length - 1) return null;
  const payloadB64 = rest.slice(0, dot);
  const sigB64 = rest.slice(dot + 1);
  let supplied: Uint8Array;
  try {
    supplied = base64UrlDecode(sigB64);
  } catch {
    return null;
  }
  const expected = await hmac(payloadB64, secret);
  if (!constantTimeEqual(supplied, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  return normalizeSignedRunOgPayload(parsed);
}

export function isLikelySignedRunOg(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > SIGNED_RUN_OG_PREFIX.length + 2 &&
    value.length <= SIGNED_RUN_OG_MAX_LEN &&
    value.startsWith(SIGNED_RUN_OG_PREFIX)
  );
}

function normalizeSignedRunOgPayload(value: unknown): SignedRunOgPayload | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.token_hash !== "string" || !HEX_64.test(o.token_hash)) return null;
  if (!isVersions(o.versions)) return null;
  const model = normalizeModel(o.model);
  if (!model) return null;
  return {
    v: 1,
    token_hash: o.token_hash,
    versions: o.versions,
    model,
  };
}

function assertSignedRunOgPayload(value: SignedRunOgPayload): SignedRunOgPayload {
  const normalized = normalizeSignedRunOgPayload(value);
  if (!normalized) {
    throw new TypeError("signed run OG payload failed validation");
  }
  return normalized;
}

function isVersions(value: unknown): value is RunRecordVersions {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    isShortString(o.schema_version) &&
    isShortString(o.dataset_version) &&
    isShortString(o.rating_version) &&
    isShortString(o.engine_version) &&
    isShortString(o.ruleset_version) &&
    typeof o.data_bundle_hash === "string" &&
    o.data_bundle_hash.length > 0 &&
    o.data_bundle_hash.length <= 180
  );
}

function normalizeModel(value: unknown): RunOgModel | null {
  if (!value || typeof value !== "object") return null;
  const o = value as RunOgModel;
  const narrative = isText(o.narrative)
    ? o.narrative
    : isShortString(o.result_label)
      ? o.result_label
      : null;
  if (narrative === null) return null;
  if (
    isText(o.team_name) &&
    (o.mode_label === "Classic" || o.mode_label === "Memory") &&
    isShortString(o.formation_name) &&
    isShortString(o.result_label) &&
    isShortString(o.record) &&
    isSummary(o.summary) &&
    Array.isArray(o.badges) &&
    o.badges.length <= 4 &&
    o.badges.every(
      (b) =>
        b &&
        typeof b === "object" &&
        isShortString((b as { axis?: unknown }).axis) &&
        isShortString((b as { label?: unknown }).label),
    ) &&
    Array.isArray(o.lineup) &&
    o.lineup.length === 11 &&
    o.lineup.every(isLineupSlot) &&
    Array.isArray(o.stars) &&
    o.stars.length <= 3 &&
    o.stars.every(isStar) &&
    (o.manager === null || isManager(o.manager))
  ) {
    return { ...o, narrative };
  }
  return null;
}

function isSummary(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    isInt(o.w, 0, 8) &&
    isInt(o.l, 0, 8) &&
    isInt(o.mp, 3, 8) &&
    isInt(o.gf, 0, 99) &&
    isInt(o.ga, 0, 99) &&
    typeof o.rr === "string" &&
    ["G1", "G2", "G3", "R32", "R16", "QF", "SF", "F"].includes(o.rr) &&
    typeof o.ch === "boolean" &&
    isInt(o.sw, 0, 8)
  );
}

function isLineupSlot(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    isShortString(o.slot_id) &&
    isShortString(o.slot_label) &&
    ["GK", "DF", "MF", "FW"].includes(String(o.position)) &&
    ["square", "circle", "triangle", "diamond"].includes(String(o.shape)) &&
    isPct(o.x_pct) &&
    isPct(o.y_pct) &&
    isText(o.name) &&
    isShortString(o.nation_code)
  );
}

function isStar(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return isText(o.name) && isShortString(o.nation_code) && isInt(o.overall, 0, 99);
}

function isManager(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return isText(o.name) && isShortString(o.nation_code);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isPct(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -10 && value <= 110;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= TEXT_MAX;
}

function isShortString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= LABEL_MAX;
}

async function hmac(message: string, secret: string): Promise<Uint8Array> {
  const key = await subtle().importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle().sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function subtle(): SubtleCrypto {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto subtle API is unavailable");
  return cryptoImpl.subtle;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
