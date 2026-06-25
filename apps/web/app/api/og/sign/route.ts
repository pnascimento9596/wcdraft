import { NextResponse } from "next/server";

import { getValidationData } from "@/lib/leaderboard/server-data";
import { buildRunOgCacheKey } from "@/lib/game/run-og-metadata";
import { verifyRunTokenForOg } from "@/lib/game/run-og-server";
import {
  readOgSigningSecret,
  sha256Hex,
  signRunOgPayload,
  type SignedRunOgPayload,
} from "@/lib/game/run-og-signing";
import { RUN_TOKEN_MAX_LEN } from "@/lib/game/run-token";
import { readClientIp } from "@/lib/http/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIGN_BODY_BYTES = RUN_TOKEN_MAX_LEN + 512;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const SIGN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SIGN_CACHE_MAX_ENTRIES = 512;
const SIGN_RATE_WINDOW_MS = 60 * 1000;
const SIGN_RATE_MAX_PER_WINDOW = 30;
const SIGN_RATE_BUCKET_MAX_ENTRIES = 512;

interface SignedOgCacheEntry {
  readonly signed: string;
  readonly cacheKey: string;
  readonly expiresAt: number;
}

interface SignRateBucket {
  windowStart: number;
  count: number;
}

const signedOgCache = new Map<string, SignedOgCacheEntry>();
const signRateBuckets = new Map<string, SignRateBucket>();

export async function POST(request: Request): Promise<Response> {
  const secret = readOgSigningSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "OG_SIGNING_UNAVAILABLE" },
      { status: 503, headers: NO_STORE },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_SIGN_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "BODY_TOO_LARGE" },
      { status: 413, headers: NO_STORE },
    );
  }

  const bodyRead = await readBoundedText(request, MAX_SIGN_BODY_BYTES);
  if (bodyRead.status === "too_large") {
    return NextResponse.json(
      { ok: false, error: "BODY_TOO_LARGE" },
      { status: 413, headers: NO_STORE },
    );
  }
  if (bodyRead.status === "invalid") {
    return NextResponse.json(
      { ok: false, error: "INVALID_BODY" },
      { status: 400, headers: NO_STORE },
    );
  }
  const raw = bodyRead.value;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON" },
      { status: 400, headers: NO_STORE },
    );
  }
  const run = body && typeof body === "object" ? (body as { run?: unknown }).run : undefined;
  if (typeof run !== "string" || run.length === 0 || run.length > RUN_TOKEN_MAX_LEN) {
    return NextResponse.json(
      { ok: false, error: "INVALID_RUN" },
      { status: 400, headers: NO_STORE },
    );
  }

  const now = Date.now();
  const tokenHash = await sha256Hex(run);
  const secretHash = await sha256Hex(secret);
  const cached = readSignedOgCache(`${secretHash}:${tokenHash}`, now);
  if (cached) {
    return NextResponse.json(
      {
        ok: true,
        signed: cached.signed,
        cache_key: cached.cacheKey,
      },
      { status: 200, headers: NO_STORE },
    );
  }

  const retryAfterSeconds = consumeInMemorySignRateLimit(readClientIp(request), now);
  if (retryAfterSeconds !== null) {
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  const data = getValidationData();
  const verified = verifyRunTokenForOg(run, data);
  if (verified.status !== "accepted") {
    return NextResponse.json(
      { ok: false, error: verified.reason },
      { status: 422, headers: NO_STORE },
    );
  }

  const payload: SignedRunOgPayload = {
    v: 1,
    token_hash: tokenHash,
    versions: data.gameData.versions,
    model: verified.model,
  };
  let signed: string;
  try {
    signed = await signRunOgPayload(payload, secret);
  } catch {
    return NextResponse.json(
      { ok: false, error: "CANONICAL_MODEL_INVALID" },
      { status: 422, headers: NO_STORE },
    );
  }
  const cacheKey = buildRunOgCacheKey(data.gameData.versions);
  writeSignedOgCache(`${secretHash}:${tokenHash}`, {
    signed,
    cacheKey,
    expiresAt: now + SIGN_CACHE_TTL_MS,
  });
  return NextResponse.json(
    {
      ok: true,
      signed,
      cache_key: cacheKey,
    },
    { status: 200, headers: NO_STORE },
  );
}

function readSignedOgCache(key: string, now: number): SignedOgCacheEntry | null {
  const entry = signedOgCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    signedOgCache.delete(key);
    return null;
  }
  signedOgCache.delete(key);
  signedOgCache.set(key, entry);
  return entry;
}

function writeSignedOgCache(key: string, entry: SignedOgCacheEntry): void {
  signedOgCache.set(key, entry);
  while (signedOgCache.size > SIGN_CACHE_MAX_ENTRIES) {
    const oldest = signedOgCache.keys().next().value;
    if (!oldest) break;
    signedOgCache.delete(oldest);
  }
}

function consumeInMemorySignRateLimit(ip: string, now: number): number | null {
  const windowStart = now - (now % SIGN_RATE_WINDOW_MS);
  const bucket = signRateBuckets.get(ip);
  if (!bucket || bucket.windowStart !== windowStart) {
    signRateBuckets.set(ip, { windowStart, count: 1 });
    trimRateBuckets();
    return null;
  }
  bucket.count += 1;
  if (bucket.count <= SIGN_RATE_MAX_PER_WINDOW) return null;
  return Math.max(1, Math.ceil((windowStart + SIGN_RATE_WINDOW_MS - now) / 1000));
}

function trimRateBuckets(): void {
  while (signRateBuckets.size > SIGN_RATE_BUCKET_MAX_ENTRIES) {
    const oldest = signRateBuckets.keys().next().value;
    if (!oldest) break;
    signRateBuckets.delete(oldest);
  }
}

async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<{ status: "ok"; value: string } | { status: "too_large" } | { status: "invalid" }> {
  const body = request.body;
  if (!body) return { status: "ok", value: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "invalid" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", value: new TextDecoder().decode(bytes) };
}
