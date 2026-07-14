import { boundedRequest, type RequestSafety } from "@wcdraft/data/client";

import { SIGNED_FRIEND_CHALLENGE_MAX_LEN, SIGNED_RUN_OG_MAX_LEN } from "./run-og-signing";

export const RUN_OG_SIGN_RESPONSE_MAX_BYTES =
  SIGNED_RUN_OG_MAX_LEN + SIGNED_FRIEND_CHALLENGE_MAX_LEN + 512;

export interface RunOgSignClientResult {
  readonly signed: string | null;
  readonly challengeProof: string | null;
}

export interface RequestRunOgSignOptions {
  readonly operation: string;
  readonly timeoutMs: number;
  readonly safety: RequestSafety;
  readonly signal?: AbortSignal;
}

/** Fetch and decode the shared OG-sign response within one time and byte budget. */
export async function requestRunOgSign(
  token: string,
  options: RequestRunOgSignOptions,
): Promise<RunOgSignClientResult | null> {
  return boundedRequest(async (signal) => {
    const response = await fetch("/api/og/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run: token }),
      signal,
    });
    if (!response.ok) return null;

    const raw = await readBoundedResponseText(response, RUN_OG_SIGN_RESPONSE_MAX_BYTES, signal);
    if (raw === null) return null;

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    const value = body as Record<string, unknown>;
    const signed = boundedString(value.signed, SIGNED_RUN_OG_MAX_LEN);
    const challengeProof = boundedString(value.challenge_proof, SIGNED_FRIEND_CHALLENGE_MAX_LEN);
    if (signed === null && challengeProof === null) return null;
    return { signed, challengeProof };
  }, options);
}

function boundedString(value: unknown, maxChars: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars ? value : null;
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && declared !== "") {
    const declaredBytes = Number(declared);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0 || declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    signal.removeEventListener("abort", cancel);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
