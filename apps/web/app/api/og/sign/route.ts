import { NextResponse } from "next/server";
import { getDb } from "@wcdraft/db";

import {
  createDbRunOgSignRateLimiter,
  RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS,
  type RunOgSignRateLimiter,
} from "@/lib/game/run-og-sign-rate-limiter-db";
import { getValidationData } from "@/lib/leaderboard/server-data";
import { buildRunOgCacheKey } from "@/lib/game/run-og-metadata";
import { verifyRunTokenForOg } from "@/lib/game/run-og-server";
import { signVerifiedFriendChallenge } from "@/lib/game/friend-challenge-server";
import {
  readOgSigningSecret,
  sha256Hex,
  SIGNED_RUN_OG_VERSION,
  signRunOgPayload,
  type SignedRunOgPayload,
} from "@/lib/game/run-og-signing";
import { RUN_TOKEN_MAX_LEN } from "@/lib/game/run-token";
import { readClientIp } from "@/lib/http/client-ip";
import { readBoundedText } from "@/lib/http/read-bounded-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIGN_BODY_BYTES = RUN_TOKEN_MAX_LEN + 512;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const SIGN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SIGN_CACHE_MAX_ENTRIES = 512;

interface SignedOgCacheEntry {
  readonly signed: string;
  readonly challengeProof: string | null;
  readonly cacheKey: string;
  readonly expiresAt: number;
}

export interface RunOgSignRouteDeps {
  readonly now: () => number;
  readonly getRateLimiter: () => RunOgSignRateLimiter;
}

const signedOgCache = new Map<string, SignedOgCacheEntry>();

export async function POST(request: Request): Promise<Response> {
  return handleRunOgSignPost(request, defaultRunOgSignRouteDeps());
}

export async function handleRunOgSignPost(
  request: Request,
  deps: RunOgSignRouteDeps,
): Promise<Response> {
  const mediaType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json(
      { ok: false, error: "UNSUPPORTED_MEDIA_TYPE" },
      { status: 415, headers: NO_STORE },
    );
  }

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

  const now = deps.now();
  const tokenHash = await sha256Hex(run);
  const secretHash = await sha256Hex(secret);
  const signatureCacheKey = `${SIGNED_RUN_OG_VERSION.toString()}:${secretHash}:${tokenHash}`;
  const cached = readSignedOgCache(signatureCacheKey, now);
  if (cached) {
    return NextResponse.json(
      {
        ok: true,
        signed: cached.signed,
        challenge_proof: cached.challengeProof,
        cache_key: cached.cacheKey,
      },
      { status: 200, headers: NO_STORE },
    );
  }

  const decision = await checkRateLimit(deps, readClientIp(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(decision.retryAfterSeconds) },
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
    v: SIGNED_RUN_OG_VERSION,
    token_hash: tokenHash,
    versions: data.gameData.versions,
    model: verified.model,
  };
  let signed: string;
  let challengeProof: string | null;
  try {
    signed = await signRunOgPayload(payload, secret);
    challengeProof = await signVerifiedFriendChallenge(run, verified, data, secret);
  } catch {
    return NextResponse.json(
      { ok: false, error: "CANONICAL_MODEL_INVALID" },
      { status: 422, headers: NO_STORE },
    );
  }
  const cacheKey = buildRunOgCacheKey(tokenHash, payload.v);
  writeSignedOgCache(signatureCacheKey, {
    signed,
    challengeProof,
    cacheKey,
    expiresAt: now + SIGN_CACHE_TTL_MS,
  });
  return NextResponse.json(
    {
      ok: true,
      signed,
      challenge_proof: challengeProof,
      cache_key: cacheKey,
    },
    { status: 200, headers: NO_STORE },
  );
}

function defaultRunOgSignRouteDeps(): RunOgSignRouteDeps {
  const now = (): number => Date.now();
  return {
    now,
    getRateLimiter: () =>
      createDbRunOgSignRateLimiter({
        db: getDb(),
        now,
        random: Math.random,
      }),
  };
}

async function checkRateLimit(
  deps: RunOgSignRouteDeps,
  ip: string,
): Promise<Awaited<ReturnType<RunOgSignRateLimiter["checkSign"]>>> {
  try {
    return await deps.getRateLimiter().checkSign({ ip });
  } catch (err) {
    console.error("[run-og] sign rate-limit unavailable - failing CLOSED", err);
    return {
      allowed: false,
      retryAfterSeconds: RUN_OG_SIGN_STORE_ERROR_RETRY_AFTER_SECONDS,
    };
  }
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
