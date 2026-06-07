// F-2 — secure token + hash primitives.
//
// Magic-link tokens, session ids, csrf secrets, and rate-limit bucket
// fingerprints all go through these helpers so there's exactly ONE place
// the entropy size and the encoding live. 256 bits via base64url gives a
// 43-character opaque string that's URL- and cookie-safe.
//
// Hashing for `magic_link_tokens.token_hash`: sha-256, lowercase hex (so
// equality comparisons in SQL stay collation-stable). We NEVER store the
// raw token, only its hash; the link in the email is the only place it
// exists.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 bytes of CSPRNG entropy, base64url-encoded (no padding). */
export function generateOpaqueToken(): string {
  return base64UrlEncode(randomBytes(32));
}

/** SHA-256 of a string (hex, lowercase). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Generate a token AND its server-side hash in one shot. */
export function generateToken(): { token: string; tokenHash: string } {
  const token = generateOpaqueToken();
  return { token, tokenHash: sha256Hex(token) };
}

/**
 * Timing-safe equality. Both inputs are coerced to Buffer of the SAME
 * length — different-length inputs return false without leaking the length
 * difference via timing. Use for cookie/header/CSRF comparisons.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** base64url encode without padding. */
export function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
