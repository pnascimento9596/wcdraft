import type { RunOgModel, RunOgRevealModel } from "./run-og-model";
import type { RunRecordVersions } from "./versions";

export const RUN_OG_SIGNING_SECRET_ENV = "WCDRAFT_OG_SIGNING_SECRET" as const;
export const RUN_OG_SIGNING_SECRET_MIN_CHARS = 32 as const;
export const SIGNED_RUN_OG_PREFIX = "ogs1." as const;
export const SIGNED_RUN_OG_MAX_LEN = 12000 as const;
export const SIGNED_FRIEND_CHALLENGE_PREFIX = "fc1." as const;
// `fc1.` + 64 lowercase hex chars + `.` + a canonical unpadded 32-byte
// base64url HMAC. Keeping this exact prevents alternate wire encodings from
// becoming separate accepted challenge identifiers.
export const SIGNED_FRIEND_CHALLENGE_MAX_LEN = 112 as const;

export interface SignedRunOgPayload {
  v: 1;
  token_hash: string;
  versions: RunRecordVersions;
  model: RunOgModel;
}

/**
 * Stateless proof that a canonical run token passed server replay when the
 * challenge was created. The run token itself remains the seed/config/pick
 * authority; this compact payload only binds its hash. S7 has no dedicated
 * verified display claim in a run token, so recipients render "a friend".
 */
export interface SignedFriendChallengePayload {
  v: 1;
  token_hash: string;
}

const HEX_64 = /^[0-9a-f]{64}$/u;
const SIGNED_FRIEND_CHALLENGE = /^fc1\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/u;
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

export function assertOgSigningSecretPresent(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = readOgSigningSecret(env);
  if (secret) return secret;
  throw new Error(
    `${RUN_OG_SIGNING_SECRET_ENV} is required for signed OG rendering; set one stable server-only secret with at least ${RUN_OG_SIGNING_SECRET_MIN_CHARS.toString()} characters.`,
  );
}

function usableSecret(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  // HMAC accepts any byte string, but short secrets invite offline guessing if
  // a signed URL leaks. Keep the same practical floor as the auth cookie helper.
  return trimmed.length >= RUN_OG_SIGNING_SECRET_MIN_CHARS ? trimmed : null;
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

export async function signFriendChallengePayload(
  payload: SignedFriendChallengePayload,
  secret: string,
): Promise<string> {
  const normalized = assertSignedFriendChallengePayload(payload);
  const sig = await hmac(friendChallengeSigningMessage(normalized.token_hash), secret);
  return `${SIGNED_FRIEND_CHALLENGE_PREFIX}${normalized.token_hash}.${base64UrlEncode(sig)}`;
}

export async function verifySignedFriendChallengePayload(
  value: string,
  secret: string,
): Promise<SignedFriendChallengePayload | null> {
  if (!isLikelySignedFriendChallenge(value)) return null;
  const rest = value.slice(SIGNED_FRIEND_CHALLENGE_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot !== 64 || dot === rest.length - 1 || rest.indexOf(".", dot + 1) !== -1) return null;
  const tokenHash = rest.slice(0, dot);
  if (!HEX_64.test(tokenHash)) return null;
  const signature = rest.slice(dot + 1);
  let supplied: Uint8Array;
  try {
    supplied = base64UrlDecode(signature);
  } catch {
    return null;
  }
  if (supplied.length !== 32 || base64UrlEncode(supplied) !== signature) return null;
  const expected = await hmac(friendChallengeSigningMessage(tokenHash), secret);
  if (!constantTimeEqual(supplied, expected)) return null;
  return { v: 1, token_hash: tokenHash };
}

export function isLikelySignedFriendChallenge(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length !== SIGNED_FRIEND_CHALLENGE_MAX_LEN ||
    !SIGNED_FRIEND_CHALLENGE.test(value)
  ) {
    return false;
  }
  try {
    const signature = value.slice(-43);
    const decoded = base64UrlDecode(signature);
    return decoded.length === 32 && base64UrlEncode(decoded) === signature;
  } catch {
    return false;
  }
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

function assertSignedFriendChallengePayload(
  value: SignedFriendChallengePayload,
): SignedFriendChallengePayload {
  if (value.v !== 1 || !HEX_64.test(value.token_hash)) {
    throw new TypeError("signed friend challenge payload failed validation");
  }
  return { v: 1, token_hash: value.token_hash };
}

function friendChallengeSigningMessage(tokenHash: string): string {
  // Domain-separated from the OG envelope HMAC. A valid `ogs1` signature can
  // never be substituted for an `fc1` proof, even under the same secret.
  return `wcdraft:friend-challenge:v1:${tokenHash}`;
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
  const reveal = normalizeReveal(o.reveal);
  if (narrative === null) return null;
  if (reveal === undefined) return null;
  if (
    isText(o.team_name) &&
    (o.mode_label === "Classic" ||
      o.mode_label === "Memory" ||
      o.mode_label === "Open" ||
      o.mode_label === "Blind Open") &&
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
    return { ...o, narrative, reveal };
  }
  return null;
}

function normalizeReveal(value: unknown): RunOgRevealModel | null | undefined {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  if (
    !isRevealNumber(o.squad_before) ||
    !isRevealNumber(o.squad_after) ||
    o.squad_before !== null ||
    !Array.isArray(o.lines) ||
    o.lines.length > 4 ||
    !o.lines.every(isRevealLine) ||
    !Array.isArray(o.top_reveals) ||
    o.top_reveals.length > 3 ||
    !o.top_reveals.every(isRevealPick)
  ) {
    return undefined;
  }
  return {
    squad_before: o.squad_before,
    squad_after: o.squad_after,
    lines: o.lines as RunOgRevealModel["lines"],
    top_reveals: o.top_reveals as RunOgRevealModel["top_reveals"],
  };
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
    isShortString(o.nation_code) &&
    (o.overall === undefined || isRevealNumber(o.overall))
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

function isRevealLine(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    isShortString(o.label) &&
    o.before === null &&
    isRevealNumber(o.before) &&
    isRevealNumber(o.after)
  );
}

function isRevealPick(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    isText(o.name) &&
    isShortString(o.nation_code) &&
    o.before_overall === null &&
    isRevealNumber(o.before_overall) &&
    isRevealNumber(o.after_overall)
  );
}

function isRevealNumber(value: unknown): value is number | null {
  return value === null || isInt(value, 0, 99);
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
