import { createHmac } from "node:crypto";

import { base64UrlEncode, timingSafeStringEqual } from "./tokens";

export const RECENT_MAGIC_COOKIE_NAME = "wcdraft_recent_magic";
export const RECENT_MAGIC_TTL_MS = 10 * 60 * 1000;

export function createRecentMagicCookieValue(args: {
  readonly sessionId: string;
  readonly userId: string;
  readonly now: number;
  readonly cookieSecret: string;
}): string {
  const expiresAt = args.now + RECENT_MAGIC_TTL_MS;
  const payload = `${args.sessionId}.${args.userId}.${expiresAt.toString()}`;
  return `${payload}.${sign(payload, args.cookieSecret)}`;
}

export function verifyRecentMagicCookieValue(
  value: string | null | undefined,
  args: {
    readonly sessionId: string;
    readonly userId: string;
    readonly now: number;
    readonly cookieSecret: string;
  },
): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  const [sessionId, userId, expiresRaw, sig] = parts;
  if (!sessionId || !userId || !expiresRaw || !sig) return false;
  if (sessionId !== args.sessionId || userId !== args.userId) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= args.now) return false;
  const payload = `${sessionId}.${userId}.${expiresRaw}`;
  return timingSafeStringEqual(sig, sign(payload, args.cookieSecret));
}

function sign(payload: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(payload, "utf8").digest());
}
