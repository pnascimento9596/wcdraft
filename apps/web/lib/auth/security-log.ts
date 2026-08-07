import { randomUUID } from "node:crypto";

import { AuthError } from "./errors";

export type SecurityEventCode =
  | "AUTH_UNEXPECTED_ERROR"
  | "AUTH_CONFIGURATION_ERROR"
  | "AUTH_EMAIL_DELIVERY_FAILED"
  | "AUTH_EMAIL_BOOKKEEPING_FAILED"
  | "AUTH_POST_SESSION_HOOK_FAILED";

type SafeErrorClass = "auth" | "database" | "network" | "timeout" | "unexpected";

export function createCorrelationId(): string {
  return randomUUID();
}

/** Structured and deliberately message-free: raw DB/provider errors may contain PII. */
export function logSecurityEvent(args: {
  readonly code: SecurityEventCode;
  readonly correlationId: string;
  readonly error?: unknown;
}): void {
  console.error(
    "[security]",
    JSON.stringify({
      code: args.code,
      correlation_id: args.correlationId,
      error_class: classifyError(args.error),
    }),
  );
}

/**
 * Coarse, PII-free classification for structured security logs. Prefer name /
 * SQLSTATE / known driver markers over free-text messages; when message is
 * consulted it is never logged — only the resulting class leaves the process.
 */
export function classifyError(error: unknown): SafeErrorClass {
  if (error instanceof AuthError) return "auth";
  if (!(error instanceof Error)) return "unexpected";
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  if (name.includes("timeout") || name === "aborterror" || message.includes("timeout")) {
    return "timeout";
  }
  if (
    name.includes("postgres") ||
    name.includes("database") ||
    name.includes("drizzle") ||
    name.includes("neon") ||
    name === "neondberror" ||
    message.includes("postgres") ||
    message.includes("database") ||
    message.includes("neon") ||
    message.includes("connection") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("websocket") ||
    hasSqlState(error)
  ) {
    return "database";
  }
  if (error instanceof TypeError || name.includes("fetch") || name.includes("network")) {
    return "network";
  }
  return "unexpected";
}

function hasSqlState(error: Error): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code);
}
