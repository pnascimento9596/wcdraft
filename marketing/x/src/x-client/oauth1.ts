// OAuth 1.0a user-context request signing for the X API v2.
//
// Dependency-free (node:crypto HMAC-SHA1) so the marketing package pulls in no
// third-party auth library. SECRET HYGIENE: this module receives credentials
// as arguments and returns only the Authorization header value; it never logs,
// echoes, throws, or otherwise surfaces a secret. Callers must keep it that way.

import { createHmac, randomBytes } from "node:crypto";

export interface OAuth1Creds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC-3986 percent-encoding (stricter than encodeURIComponent). */
function pe(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Build the `Authorization: OAuth ...` header for a request. `queryParams` are
 * the URL query parameters (NOT a JSON body — X v2 JSON bodies are excluded
 * from the OAuth signature base string). `nonce`/`timestamp` are injectable
 * for deterministic tests.
 */
export function buildAuthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  creds: OAuth1Creds,
  opts: { nonce?: string; timestamp?: number } = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // Signature base: all oauth_* + query params, percent-encoded, sorted.
  const allParams: Record<string, string> = { ...queryParams, ...oauth };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pe(k)}=${pe(allParams[k]!)}`)
    .join("&");

  const base = `${method.toUpperCase()}&${pe(baseUrl)}&${pe(paramString)}`;
  const signingKey = `${pe(creds.apiSecret)}&${pe(creds.accessSecret)}`;
  const signature = createHmac("sha1", signingKey).update(base).digest("base64");

  const header = {
    ...oauth,
    oauth_signature: signature,
  };
  const headerString = Object.keys(header)
    .sort()
    .map((k) => `${pe(k)}="${pe(header[k as keyof typeof header]!)}"`)
    .join(", ");
  return `OAuth ${headerString}`;
}
